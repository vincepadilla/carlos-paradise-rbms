<?php

namespace App\Console\Commands;

use App\Services\GoogleCalendarService;
use App\Services\CalendarSyncState;
use Carbon\CarbonImmutable;
use Google\Service\Calendar;
use Google\Service\Calendar\Event;
use Google\Service\Exception as GoogleException;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use RuntimeException;
use Throwable;

class SyncReservationsToGoogleCalendar extends Command
{
    protected $signature = 'calendar:sync-reservations';

    protected $description =
        'Create, update, and remove Google Calendar reservation events';

    private const REMOVED_HASH = 'removed';

    public function handle(GoogleCalendarService $google): int
    {
        $lock = Cache::lock(
            'google-calendar-reservations-sync',
            3600
        );

        if (! $lock->get()) {
            $this->info('Another reservation sync is running.');

            return self::SUCCESS;
        }

        try {
            $calendarId = $google->calendarId();
            $calendar = $google->calendar();

            $changed = 0;
            $unchanged = 0;
            $failed = 0;

            DB::table('reservations')
                ->where('villa_id', 1)
                ->where(function ($query) {
                    $query
                        ->whereIn('status', CalendarSyncState::RESERVATION_PUBLISH_STATUSES)
                        ->orWhere(function ($terminal) {
                            $terminal
                                ->whereIn(
                                    'status',
                                    CalendarSyncState::RESERVATION_REMOVE_STATUSES
                                )
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
                            if ($this->sync(
                                $row,
                                $calendar,
                                $calendarId
                            )) {
                                $changed++;

                                $action = in_array(
                                    $row->status,
                                    CalendarSyncState::RESERVATION_REMOVE_STATUSES,
                                    true
                                ) ? 'Removed event for' : 'Synced';

                                $this->info(
                                    "{$action} reservation {$row->id}."
                                );
                            } else {
                                $unchanged++;
                            }
                        } catch (Throwable $exception) {
                            $failed++;

                            // Do not print tokens or HTTP response bodies.
                            $this->error(
                                "Reservation {$row->id} failed: "
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

            return $failed > 0
                ? self::FAILURE
                : self::SUCCESS;
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
                'The reservation is linked to another Google calendar.'
            );
        }

        if (in_array(
            $row->status,
            CalendarSyncState::RESERVATION_REMOVE_STATUSES,
            true
        )) {
            return $this->removeEvent(
                $row,
                $calendar,
                $calendarId
            );
        }

        if (! in_array(
            $row->status,
            CalendarSyncState::RESERVATION_PUBLISH_STATUSES,
            true
        )) {
            return false;
        }

        if (! $row->starts_at || ! $row->ends_at) {
            throw new RuntimeException(
                'Reservation dates are missing.'
            );
        }

        $start = CarbonImmutable::parse(
            $row->starts_at,
            'Asia/Manila'
        )->setTimezone('Asia/Manila');

        $end = CarbonImmutable::parse(
            $row->ends_at,
            'Asia/Manila'
        )->setTimezone('Asia/Manila');

        if ($end->lessThanOrEqualTo($start)) {
            throw new RuntimeException(
                'Reservation end must be after its start.'
            );
        }

        $reference = $row->booking_reference
            ?: "Reservation {$row->id}";

        $payload = [
            'summary' => "Carlos Paradise - {$reference}",
            'description' =>
                "Booking: {$reference}\nStatus: {$row->status}",
            'start' => [
                'dateTime' => $start->toRfc3339String(),
                'timeZone' => 'Asia/Manila',
            ],
            'end' => [
                'dateTime' => $end->toRfc3339String(),
                'timeZone' => 'Asia/Manila',
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

        // Reuse an existing ID for retries.
        // Reactivated reservations receive a fresh event ID.
        $eventId = (
            $row->google_sync_hash !== self::REMOVED_HASH
                ? $row->google_event_id
                : null
        ) ?: 'cp' . bin2hex(random_bytes(16));

        // Persist before calling Google so retries use the same ID.
        // Do not change the reservation's business revision or updated_at.
        DB::table('reservations')
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
                // A prior attempt may have created the event
                // before its response was received.
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

        DB::table('reservations')
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
            // Treat missing or already-deleted events as removed.
            if (! in_array(
                (int) $exception->getCode(),
                [404, 410],
                true
            )) {
                throw $exception;
            }
        }

        // Retain the mapping for reference and mark deletion complete.
        DB::table('reservations')
            ->where('id', $row->id)
            ->update([
                'google_sync_hash' => self::REMOVED_HASH,
                'google_synced_at' => now(),
            ]);

        return true;
    }
}
