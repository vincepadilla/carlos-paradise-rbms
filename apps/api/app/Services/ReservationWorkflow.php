<?php

namespace App\Services;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\ValidationException;

class ReservationWorkflow
{
    public function now(): CarbonImmutable
    {
        return CarbonImmutable::now('Asia/Manila');
    }

    public function stamp(): string
    {
        return $this->now()->format('Y-m-d H:i:s');
    }

    /*
     * Lock the villa while changing reservations or payments.
     * This prevents competing requests from taking the same dates.
     */
    public function locked(callable $callback)
    {
        return DB::transaction(function () use ($callback) {
            $villa = DB::table('villas')
                ->where('id', 1)
                ->lockForUpdate()
                ->first();

            abort_unless(
                $villa,
                503,
                'The villa has not been configured yet.'
            );

            $this->expireLocked();

            return $callback($villa);
        });
    }

    /*
     * Account and permission checks.
     */
    public function active($user): void
    {
        abort_unless($user, 401, 'Unauthenticated.');

        abort_if(
            isset($user->is_active) && ! $user->is_active,
            403,
            'This account is inactive.'
        );
    }

    public function staff($user): bool
    {
        if (! $user) {
            return false;
        }

        return DB::table('roles')
            ->where('id', $user->role_id)
            ->whereIn('name', ['admin', 'owner'])
            ->exists();
    }

    public function requireStaff($user): void
    {
        $this->active($user);

        abort_unless(
            $this->staff($user),
            403,
            'Staff access is required.'
        );
    }

    /*
     * Retrieve a reservation.
     */
    public function reservation(
        int $id,
        bool $lock = false
    ): object {
        $query = DB::table('reservations')
            ->where('id', $id);

        if ($lock) {
            $query->lockForUpdate();
        }

        $reservation = $query->first();

        abort_unless(
            $reservation,
            404,
            'Reservation not found.'
        );

        return $reservation;
    }

    /*
     * Only the booking owner or staff can access it.
     */
    public function own($user, object $reservation): void
    {
        $this->active($user);

        $isOwner =
            (int) $reservation->user_id ===
            (int) $user->id;

        abort_unless(
            $isOwner || $this->staff($user),
            403,
            'This reservation belongs to another account.'
        );
    }

    /*
     * Update the reservation and record its status change.
     */
    public function state(
        object $reservation,
        string $status,
        ?int $actor,
        string $reason = '',
        array $extra = []
    ): void {
        DB::table('reservations')
            ->where('id', $reservation->id)
            ->update([
                ...$extra,
                'status' => $status,
                'updated_at' => $this->stamp(),
            ]);

        if ($status !== $reservation->status) {
            $this->history(
                $reservation->id,
                $reservation->status,
                $status,
                $actor,
                $reason
            );
        }
    }

    public function history(
        int $reservationId,
        ?string $from,
        string $to,
        ?int $actor,
        string $reason
    ): void {
        /*
         * These mappings also support the history status
         * constraints from the original uploaded SQL.
         */
        $map = [
            'queued' => 'pending',
            'awaiting_deposit' => 'held',
            'payment_review' => 'reserved',
            'completed' => 'confirmed',
        ];

        DB::table('reservation_status_history')->insert([
            'reservation_id' => $reservationId,
            'from_status' => $from === null
                ? null
                : ($map[$from] ?? $from),
            'to_status' => $map[$to] ?? $to,
            'changed_by' => $actor,

            'reason' => $reason.' [application status: '.$to.']',

            'changed_at' => $this->now()->toIso8601String(),
            'created_at' => $this->stamp(),
            'updated_at' => $this->stamp(),
        ]);
    }

    /*
     * Close an active deposit opportunity.
     */
    public function closeOpportunity(
        int $reservationId,
        string $status
    ): void {
        DB::table('reservation_opportunities')
            ->where('reservation_id', $reservationId)
            ->where('status', 'active')
            ->update([
                'status' => $status,
                'closed_at' => $this->now()->toIso8601String(),
                'updated_at' => $this->stamp(),
            ]);
    }

    /*
     * Expire unpaid opportunities.
     * Call this inside a transaction holding the villa lock.
     *
     * Receipts under review are deliberately excluded.
     */
    public function expireLocked(): int
    {
        $reservations = DB::table('reservations')
            ->where('villa_id', 1)
            ->whereIn('status', [
                'held',
                'awaiting_deposit',
            ])
            ->whereNotNull('deadline')
            ->where(
                'deadline',
                '<=',
                $this->now()->toIso8601String()
            )
            ->lockForUpdate()
            ->get();

        foreach ($reservations as $reservation) {
            $this->state(
                $reservation,
                'expired',
                null,
                'Unpaid deposit opportunity expired.'
            );

            $this->closeOpportunity(
                $reservation->id,
                'expired'
            );
        }

        if ($reservations->isNotEmpty()) {
            $this->promoteQueuedLocked();
        }

        return $reservations->count();
    }

    public function depositDeadline(object $reservation): CarbonImmutable
    {
        $start = CarbonImmutable::parse(
            $reservation->starts_at,
            'Asia/Manila'
        );

        $deadline = $this->now()->addHours(
            $reservation->deposit_window_hours
        );

        return $deadline->gte($start)
            ? $start->subMinute()
            : $deadline;
    }

    public function createOpportunity(
        object $reservation,
        ?int $actor = null
    ): CarbonImmutable {
        $deadline = $this->depositDeadline($reservation);

        abort_unless(
            $deadline->gt($this->now()),
            422,
            'The stay is too close or has already started.'
        );

        DB::table('reservation_opportunities')->insert([
            'reservation_id' => $reservation->id,
            'granted_at' => $this->now()->toIso8601String(),
            'deposit_deadline' => $deadline->toIso8601String(),
            'status' => 'active',
            'granted_by' => $actor,
            'created_at' => $this->stamp(),
            'updated_at' => $this->stamp(),
        ]);

        return $deadline;
    }

    /*
     * Check that no other booking or blocked period
     * overlaps this reservation.
     */
    public function available(
        object $reservation,
        bool $includeUnpaid = true
    ): void {
        $start = CarbonImmutable::parse(
            $reservation->starts_at,
            'Asia/Manila'
        )->setTimezone('Asia/Manila');

        $end = CarbonImmutable::parse(
            $reservation->ends_at,
            'Asia/Manila'
        )->setTimezone('Asia/Manila');

        $conflict = DB::table('reservations')
            ->where('villa_id', $reservation->villa_id)
            ->where('id', '!=', $reservation->id)
            ->where(
                'starts_at',
                '<',
                $end->toIso8601String()
            )
            ->where(
                'ends_at',
                '>',
                $start->toIso8601String()
            )
            ->where(function ($query) use ($includeUnpaid) {
                $query->whereIn('status', [
                    'confirmed',
                    'reserved',
                ]);

                if ($includeUnpaid) {
                    $query
                        ->orWhere('status', 'payment_review')
                        ->orWhere(function ($held) {
                            $held
                                ->whereIn('status', [
                                    'held',
                                    'awaiting_deposit',
                                ])
                                ->where(function ($deadline) {
                                    $deadline
                                        ->whereNull('deadline')
                                        ->orWhere(
                                            'deadline',
                                            '>',
                                            $this->now()->toIso8601String()
                                        );
                                });
                        });
                }
            })
            ->exists();

        $blocked = DB::table('availability_blocks')
            ->where('villa_id', $reservation->villa_id)
            ->whereNull('released_at')
            ->where(
                'starts_on',
                '<=',
                $end->subSecond()->toDateString()
            )
            ->where(
                'ends_on',
                '>',
                $start->toDateString()
            )
            ->exists();

        if ($conflict || $blocked) {
            throw ValidationException::withMessages([
                'dates' => 'These dates overlap another active commitment or blocked period.',
            ]);
        }
    }

    public function queuePosition(object $reservation): ?int
    {
        if (! in_array($reservation->status, ['pending', 'queued'], true)) {
            return null;
        }

        $ahead = DB::table('reservations')
            ->where('villa_id', $reservation->villa_id)
            ->where('id', '!=', $reservation->id)
            ->where('starts_at', '<', $reservation->ends_at)
            ->where('ends_at', '>', $reservation->starts_at)
            ->where(function ($query) use ($reservation) {
                $query
                    ->whereIn('status', [
                        'awaiting_deposit',
                        'held',
                        'payment_review',
                    ])
                    ->orWhere(function ($queued) use ($reservation) {
                        $queued
                            ->whereIn('status', ['pending', 'queued'])
                            ->where(function ($earlier) use ($reservation) {
                                $earlier
                                    ->where(
                                        'requested_at',
                                        '<',
                                        $reservation->requested_at
                                    )
                                    ->orWhere(function ($sameTime) use ($reservation) {
                                        $sameTime
                                            ->where(
                                                'requested_at',
                                                $reservation->requested_at
                                            )
                                            ->where('id', '<', $reservation->id);
                                    });
                            });
                    });
            })
            ->count();

        return $ahead + 1;
    }

    public function promoteQueuedLocked(): void
    {
        $queued = DB::table('reservations')
            ->where('villa_id', 1)
            ->whereIn('status', ['pending', 'queued'])
            ->orderBy('requested_at')
            ->orderBy('id')
            ->lockForUpdate()
            ->get();

        foreach ($queued as $reservation) {
            try {
                $this->available($reservation);
            } catch (ValidationException) {
                continue;
            }

            $deadline = $this->createOpportunity($reservation);

            $this->state(
                $reservation,
                'awaiting_deposit',
                null,
                'The next queued reservation received the deposit opportunity.',
                ['deadline' => $deadline->toIso8601String()]
            );
        }
    }

    public function rejectQueuedOverlaps(object $confirmed): void
    {
        $queued = DB::table('reservations')
            ->where('villa_id', $confirmed->villa_id)
            ->where('id', '!=', $confirmed->id)
            ->whereIn('status', ['pending', 'queued'])
            ->where('starts_at', '<', $confirmed->ends_at)
            ->where('ends_at', '>', $confirmed->starts_at)
            ->lockForUpdate()
            ->get();

        foreach ($queued as $reservation) {
            $this->state(
                $reservation,
                'rejected',
                null,
                'An earlier reservation completed its required deposit.'
            );
        }
    }

    /*
     * Private receipt storage.
     * Files are downloaded through an authenticated controller.
     */
    public function disk()
    {
        return Storage::build([
            'driver' => 'local',

            'root' => config(
                'reservations.receipt_root',
                storage_path('app/private/reservation-receipts')
            ),

            'throw' => true,
        ]);
    }

    /*
     * Format database records for ReservationPage.tsx.
     * Private storage paths are not returned to the browser.
     */
    public function present(object $reservation): array
    {

        $opportunity = DB::table('reservation_opportunities')
            ->where('reservation_id', $reservation->id)
            ->orderByDesc('id')
            ->first();

        $payments = DB::table('payments as p')
            ->join(
                'payment_methods as m',
                'm.id',
                '=',
                'p.payment_method_id'
            )
            ->where('p.reservation_id', $reservation->id)
            ->orderByDesc('p.id')
            ->get([
                'p.*',
                'm.name as method',
            ])
            ->map(function ($payment) {
                $reviewNote = DB::table('payment_reviews')
                    ->where('payment_id', $payment->id)
                    ->orderByDesc('id')
                    ->value('notes');

                return [
                    'id' => $payment->id,
                    'method' => $payment->method,
                    'reference' => $payment->reference_number,

                    'amount' => number_format(
                        (float) $payment->amount,
                        2,
                        '.',
                        ''
                    ),

                    'status' => $payment->status,
                    'review_note' => $reviewNote,
                ];
            });

        $queuePosition = $this->queuePosition($reservation);

        return [

            'opportunity' => $opportunity
            ? [
                'id' => $opportunity->id,
                'status' => $opportunity->status,
            ]
            : null,

            'extension_status' => $reservation->extension_status,
            'extension_reason' => $reservation->extension_reason,
            'extension_message' => $reservation->extension_message ?? null,

            'extension_date' => $reservation->extension_date
                ? CarbonImmutable::parse(
                    $reservation->extension_date,
                    'Asia/Manila'
                )->toDateString()
                : null,
            'id' => $reservation->id,
            'user_id' => $reservation->user_id,
            'reference' => $reservation->booking_reference,
            'type' => $reservation->type,
            'status' => $reservation->status,
            'queue_position' => $queuePosition,
            'reservations_ahead' => $queuePosition === null
                ? null
                : $queuePosition - 1,

            'starts_at' => CarbonImmutable::parse(
                $reservation->starts_at,
                'Asia/Manila'
            )->toIso8601String(),

            'ends_at' => CarbonImmutable::parse(
                $reservation->ends_at,
                'Asia/Manila'
            )->toIso8601String(),

            'total' => $reservation->price_agreed
                ? number_format(
                    (float) $reservation->quoted_total,
                    2,
                    '.',
                    ''
                )
                : null,

            'deposit' => number_format(
                (float) $reservation->required_deposit,
                2,
                '.',
                ''
            ),

            'deadline' => $reservation->deadline
                ? CarbonImmutable::parse(
                    $reservation->deadline,
                    'Asia/Manila'
                )->toIso8601String()
                : null,

            'contact_name' => $reservation->contact_name,
            'contact_email' => $reservation->contact_email,
            'contact_phone' => $reservation->contact_phone,

            'adults' => $reservation->adults,
            'children' => $reservation->children,
            'pets' => $reservation->pets,

            'notes' => $reservation->special_requests,
            'payments' => $payments,
        ];
    }
}
