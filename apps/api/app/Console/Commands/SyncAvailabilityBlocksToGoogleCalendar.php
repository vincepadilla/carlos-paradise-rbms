<?php

namespace App\Console\Commands;

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

class SyncAvailabilityBlocksToGoogleCalendar extends Command
{
    protected $signature = 'calendar:sync-blocks';

    protected $description =
        'Create, update, and remove Google Calendar blocked-date events';

    private const REMOVED_HASH = 'removed';

    public function handle(GoogleCalendarService $google): int
    {
        $lock = Cache::lock('google-calendar-blocks-sync', 3600);

        if (! $lock->get()) {
            $this->info('Another blocked-date sync is running.');

            return self::SUCCESS;
        }

        try {
            $calendarId = $google->calendarId();
            $calendar = $google->calendar();

            $changed = 0;
            $unchanged = 0;
            $failed = 0;

            DB::table('availability_blocks')
                ->where('villa_id', 1)
                ->where(function ($query) {
                    $query
                        ->whereNull('released_at')
                        ->orWhere(function ($released) {
                            $released
                                ->whereNotNull('released_at')
                                ->whereNotNull('google_event_id')
                                ->where(function ($pending) {
                                    $pending
                                        ->whereNull('google_sync_hash')
                                        ->orWhere(
                                            'google_sync_hash',
                                            '!=',
                                            self::REMOVED_HASH
                                        );
                                });
                        });
                })
                ->chunkById(100, function ($rows) use (
                    $calendar,
                    $calendarId,
                    &$changed,
                    &$unchanged,
                    &$failed
                ) {
                    foreach ($rows as $row) {
                        try {
                            if ($this->sync($row, $calendar, $calendarId)) {
                                $changed++;

                                $action = $row->released_at !== null
                                    ? 'Removed event for'
                                    : 'Synced';

                                $this->info(
                                    "{$action} date block {$row->id}."
                                );
                            } else {
                                $unchanged++;
                            }
                        } catch (Throwable $exception) {
                            $failed++;

                            // Avoid printing tokens or HTTP response bodies.
                            $this->error(
                                "Date block {$row->id} failed: "
                                . get_class($exception)
                                . " (code {$exception->getCode()})."
                            );
                        }
                    }
                });

            $this->info(
                "Changed: {$changed}. "
                . "Unchanged: {$unchanged}. "
                . "Failed: {$failed}."
            );

            return $failed > 0 ? self::FAILURE : self::SUCCESS;
        } finally {
            $lock->release();
        }
    }

    private function sync(
        object $row,
        Calendar $calendar,
        string $calendarId
    ): bool {
        if (
            $row->google_calendar_id
            && $row->google_calendar_id !== $calendarId
        ) {
            throw new RuntimeException(
                'This block is linked to another Google calendar.'
            );
        }

        if ($row->released_at !== null) {
            return $this->removeEvent($row, $calendar, $calendarId);
        }

        if (! $row->starts_on || ! $row->ends_on) {
            throw new RuntimeException('Blocked dates are missing.');
        }

        $start = CarbonImmutable::parse(
            $row->starts_on,
            'Asia/Manila'
        )->startOfDay();

        $end = CarbonImmutable::parse(
            $row->ends_on,
            'Asia/Manila'
        )->startOfDay();

        if ($end->lessThanOrEqualTo($start)) {
            throw new RuntimeException(
                'Block end must be after its start.'
            );
        }

        $payload = [
            'summary' => "Carlos Paradise - Blocked Date #{$row->id}",
            'description' => trim((string) $row->reason),
            'start' => [
                'date' => $start->toDateString(),
            ],
            'end' => [
                'date' => $end->toDateString(),
            ],
            'transparency' => 'opaque',
            'reminders' => [
                'useDefault' => false,
            ],
        ];

        $hash = hash(
            'sha256',
            json_encode($payload, JSON_THROW_ON_ERROR)
        );

        if (
            $row->google_event_id
            && $row->google_calendar_id === $calendarId
            && $row->google_sync_hash === $hash
        ) {
            return false;
        }

        $eventId = (
            $row->google_sync_hash !== self::REMOVED_HASH
                ? $row->google_event_id
                : null
        ) ?: 'cpb' . bin2hex(random_bytes(16));

        // Save before contacting Google so retries reuse the same ID.
        DB::table('availability_blocks')
            ->where('id', $row->id)
            ->update([
                'google_event_id' => $eventId,
                'google_calendar_id' => $calendarId,
                'google_sync_hash' => null,
            ]);

        try {
            $calendar->events->patch(
                $calendarId,
                $eventId,
                new Event($payload)
            );
        } catch (GoogleException $exception) {
            if ((int) $exception->getCode() !== 404) {
                throw $exception;
            }

            try {
                $calendar->events->insert(
                    $calendarId,
                    new Event(['id' => $eventId] + $payload)
                );
            } catch (GoogleException $insertException) {
                if ((int) $insertException->getCode() !== 409) {
                    throw $insertException;
                }

                $calendar->events->patch(
                    $calendarId,
                    $eventId,
                    new Event($payload)
                );
            }
        }

        DB::table('availability_blocks')
            ->where('id', $row->id)
            ->update([
                'google_sync_hash' => $hash,
                'google_synced_at' => now(),
            ]);

        return true;
    }

    private function removeEvent(
        object $row,
        Calendar $calendar,
        string $calendarId
    ): bool {
        if (
            ! $row->google_event_id
            || $row->google_sync_hash === self::REMOVED_HASH
        ) {
            return false;
        }

        if ($row->google_calendar_id !== $calendarId) {
            throw new RuntimeException(
                'Cannot remove an event without a matching calendar mapping.'
            );
        }

        try {
            $calendar->events->delete(
                $calendarId,
                $row->google_event_id
            );
        } catch (GoogleException $exception) {
            if (! in_array(
                (int) $exception->getCode(),
                [404, 410],
                true
            )) {
                throw $exception;
            }
        }

        DB::table('availability_blocks')
            ->where('id', $row->id)
            ->update([
                'google_sync_hash' => self::REMOVED_HASH,
                'google_synced_at' => now(),
            ]);

        return true;
    }
}