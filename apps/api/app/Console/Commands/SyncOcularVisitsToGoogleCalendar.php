<?php

namespace App\Console\Commands;

use App\Services\CalendarSyncState;
use App\Services\GoogleCalendarService;
use Carbon\CarbonImmutable;
use Google\Service\Calendar;
use Google\Service\Calendar\Event;
use Google\Service\Exception as GoogleException;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use RuntimeException;
use Throwable;

class SyncOcularVisitsToGoogleCalendar extends Command
{
    protected $signature = 'calendar:sync-ocular-visits';
    protected $description = 'Create, update, and remove Google Calendar ocular-visit events';
    private const REMOVED_HASH = 'removed';

    public function handle(GoogleCalendarService $google): int
    {
        $lock = Cache::lock('google-calendar-ocular-visits-sync', 3600);
        if (! $lock->get()) {
            $this->info('Another ocular-visit sync is running.');
            return self::SUCCESS;
        }

        try {
            $calendarId = $google->calendarId();
            $calendar = $google->calendar();
            $changed = $unchanged = $failed = 0;

            DB::table('ocular_visits')->where('villa_id', 1)
                ->where(function ($query) {
                    $query->whereIn('status', CalendarSyncState::OCULAR_PUBLISH_STATUSES)
                        ->orWhere(function ($remove) {
                            $remove->whereNotIn('status', CalendarSyncState::OCULAR_PUBLISH_STATUSES)
                                ->whereNotNull('google_event_id')
                                ->where(function ($pending) {
                                    $pending->whereNull('google_sync_hash')
                                        ->orWhere('google_sync_hash', '!=', self::REMOVED_HASH);
                                });
                        });
                })->chunkById(100, function ($rows) use ($calendar, $calendarId, &$changed, &$unchanged, &$failed) {
                    foreach ($rows as $row) {
                        try {
                            if ($this->sync($row, $calendar, $calendarId)) {
                                $changed++;
                                $action = in_array($row->status, CalendarSyncState::OCULAR_PUBLISH_STATUSES, true) ? 'Synced' : 'Removed event for';
                                $this->info("{$action} ocular visit {$row->id}.");
                            } else {
                                $unchanged++;
                            }
                        } catch (Throwable $exception) {
                            $failed++;
                            $this->error("Ocular visit {$row->id} failed: ".get_class($exception)." (code {$exception->getCode()}).");
                        }
                    }
                });

            $this->info("Changed: {$changed}. Unchanged: {$unchanged}. Failed: {$failed}.");
            return $failed > 0 ? self::FAILURE : self::SUCCESS;
        } finally {
            $lock->release();
        }
    }

    private function sync(object $row, Calendar $calendar, string $calendarId): bool
    {
        if ($row->google_calendar_id && $row->google_calendar_id !== $calendarId) {
            throw new RuntimeException('The ocular visit is linked to another Google calendar.');
        }
        if (! in_array($row->status, CalendarSyncState::OCULAR_PUBLISH_STATUSES, true)) {
            return $this->removeEvent($row, $calendar, $calendarId);
        }

        $start = CarbonImmutable::parse($row->visit_date.' '.$row->start_time, 'Asia/Manila');
        $end = CarbonImmutable::parse($row->visit_date.' '.$row->end_time, 'Asia/Manila');
        if ($end->lessThanOrEqualTo($start)) {
            throw new RuntimeException('Ocular visit times are invalid.');
        }

        $payload = [
            'summary' => "Carlos Paradise - Ocular Visit - {$row->guest_name}",
            'description' => "Ocular visit #{$row->id}\nStatus: {$row->status}",
            'start' => ['dateTime' => $start->toRfc3339String(), 'timeZone' => 'Asia/Manila'],
            'end' => ['dateTime' => $end->toRfc3339String(), 'timeZone' => 'Asia/Manila'],
            'transparency' => 'opaque',
            'reminders' => ['useDefault' => false],
        ];
        $hash = hash('sha256', json_encode($payload, JSON_THROW_ON_ERROR));
        if ($row->google_event_id && $row->google_calendar_id === $calendarId && $row->google_sync_hash === $hash) {
            return false;
        }

        $eventId = ($row->google_sync_hash !== self::REMOVED_HASH ? $row->google_event_id : null) ?: 'cpo'.bin2hex(random_bytes(16));
        DB::table('ocular_visits')->where('id', $row->id)->update([
            'google_event_id' => $eventId, 'google_calendar_id' => $calendarId, 'google_sync_hash' => null,
        ]);

        try {
            $calendar->events->patch($calendarId, $eventId, new Event($payload));
        } catch (GoogleException $exception) {
            if ((int) $exception->getCode() !== 404) throw $exception;
            try {
                $calendar->events->insert($calendarId, new Event(['id' => $eventId] + $payload));
            } catch (GoogleException $insertException) {
                if ((int) $insertException->getCode() !== 409) throw $insertException;
                $calendar->events->patch($calendarId, $eventId, new Event($payload));
            }
        }

        DB::table('ocular_visits')->where('id', $row->id)->update(['google_sync_hash' => $hash, 'google_synced_at' => now()]);
        return true;
    }

    private function removeEvent(object $row, Calendar $calendar, string $calendarId): bool
    {
        if (! $row->google_event_id || $row->google_sync_hash === self::REMOVED_HASH) return false;
        if ($row->google_calendar_id !== $calendarId) {
            throw new RuntimeException('Cannot remove an event without a matching calendar mapping.');
        }
        try {
            $calendar->events->delete($calendarId, $row->google_event_id);
        } catch (GoogleException $exception) {
            if (! in_array((int) $exception->getCode(), [404, 410], true)) throw $exception;
        }
        DB::table('ocular_visits')->where('id', $row->id)->update(['google_sync_hash' => self::REMOVED_HASH, 'google_synced_at' => now()]);
        return true;
    }
}
