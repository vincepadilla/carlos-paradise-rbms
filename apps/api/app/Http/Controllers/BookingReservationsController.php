<?php

namespace App\Http\Controllers;

use App\Services\ReservationWorkflow;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class BookingReservationsController extends Controller
{
    public function __construct(
        private ReservationWorkflow $flow
    ) {}

    /*
     * GET /api/reservations
     *
     * Guests see their own reservations.
     * Staff can view all reservations for the villa.
     */
    public function index(Request $request)
    {
        $this->flow->active($request->user());

        return $this->flow->locked(function () use ($request) {
            $query = DB::table('reservations')
                ->where('villa_id', 1);

            if (! $this->flow->staff($request->user())) {
                $query->where('user_id', $request->user()->id);
            }

            $reservations = $query
                ->orderByDesc('id')
                ->limit(500)
                ->get()
                ->map(
                    fn ($reservation) => $this->flow->present($reservation)
                );

            return response()->json([
                'reservations' => $reservations,
            ]);
        });
    }

    /*
     * GET /api/reservations/{reservation}
     */
    public function show(
        Request $request,
        int $reservation
    ) {
        $record = $this->flow->reservation($reservation);

        $this->flow->own(
            $request->user(),
            $record
        );

        return $this->flow->locked(function () use ($reservation) {
            return response()->json([
                'reservation' => $this->flow->present(
                    $this->flow->reservation($reservation)
                ),
            ]);
        });
    }

    /*
     * POST /api/reservations
     */
    public function store(
        Request $request,
        ReservationSettingsController $settingsController,
        ReservationQuoteController $quoteController
    ) {
        $this->flow->active($request->user());

        $contact = $request->validate([
            'contact_name' => 'required|string|max:255',
            'contact_email' => 'required|email|max:255',
            'contact_phone' => 'required|string|max:30',
            'inquiry_source' => 'required|string|max:100',
            'terms' => 'accepted',
            'queue_acknowledged' => 'sometimes|boolean',
            'expected_total' => 'sometimes|nullable|numeric|min:0|max:99999999',
            'request_key' => 'sometimes|uuid',
        ]);

        return $this->flow->locked(function ($villa) use (
            $request,
            $settingsController,
            $quoteController,
            $contact
        ) {
            abort_unless(
                $villa->is_active,
                422,
                'The villa is not accepting new requests.'
            );

            /*
             * Return the original reservation when the browser retries.
             * A retry must not create another booking reference.
             */
            if ($request->filled('request_key')) {
                $existing = DB::table('reservations')
                    ->where('user_id', $request->user()->id)
                    ->where(
                        'request_key',
                        $request->input('request_key')
                    )
                    ->first();

                if ($existing) {
                    return response()->json([
                        'reservation' => $this->flow->present($existing),
                    ], 201);
                }
            }

            /*
             * Revalidate the schedule and calculate the server price.
             */
            $result = $quoteController
                ->quote($request, $settingsController)
                ->getData(true);

            $quote = $result['quote'];
            $availability = $result['availability'];

            if ($availability === 'blocked') {
                throw ValidationException::withMessages([
                    'dates' => 'These dates are no longer available.',
                ]);
            }

            if (
                $availability === 'queue' &&
                ! $request->boolean('queue_acknowledged')
            ) {
                throw ValidationException::withMessages([
                    'dates' => 'Availability changed. Review the waiting notice and acknowledge it before submitting.',
                ]);
            }

            /*
             * Require another price review if the quote changed.
             */
            if (
                $request->has('expected_total') &&
                $quote['total'] !== null
            ) {
                $expectedCents = (int) round(
                    (float) $request->input('expected_total') * 100
                );

                $actualCents = (int) round(
                    (float) $quote['total'] * 100
                );

                if ($expectedCents !== $actualCents) {
                    throw ValidationException::withMessages([
                        'expected_total' => 'Prices changed. Review the updated quote before submitting.',
                    ]);
                }
            }

            $settings = $settingsController
                ->index()
                ->getData(true)['settings'];

            $start = CarbonImmutable::parse(
                $request->input('checkin').' '.
                $request->input('checkin_time'),
                'Asia/Manila'
            );

            $end = CarbonImmutable::parse(
                $request->input('checkout').' '.
                $request->input('checkout_time'),
                'Asia/Manila'
            );

            $status = $availability === 'queue'
                ? 'queued'
                : 'awaiting_deposit';

            /*
             * Use the same submission timestamp for the reference
             * date and the stored requested_at value.
             */
            $requestedAt = $this->flow->now();

            $reservationId = DB::table('reservations')
                ->insertGetId([
                    'booking_reference' => $this->nextBookingReference($requestedAt),

                    'user_id' => $request->user()->id,
                    'villa_id' => 1,

                    // Booking contacts do not change the user profile.
                    'contact_name' => trim($contact['contact_name']),

                    'contact_email' => trim($contact['contact_email']),

                    'contact_phone' => trim($contact['contact_phone']),

                    'inquiry_source' => $contact['inquiry_source'],

                    'type' => $request->input('type'),

                    'check_in_date' => $request->input('checkin'),

                    'check_out_date' => $request->input('checkout'),

                    'starts_at' => $start->toIso8601String(),
                    'ends_at' => $end->toIso8601String(),

                    'adults' => $request->integer('adults'),
                    'children' => $request->integer('children'),
                    'pets' => $request->integer('pets'),

                    'bonfire_qty' => $request->integer('bonfire_qty'),

                    'charcoal_qty' => $request->integer('charcoal_qty'),

                    'special_requests' => $request->input('notes'),

                    'status' => $status,

                    // Always use the server-calculated amounts.
                    'quoted_total' => $quote['total'] ?? 0,
                    'required_deposit' => $quote['deposit'],
                    'currency' => 'PHP',

                    // Staff must agree the final day-tour price.
                    'price_agreed' => $request->input('type') === 'overnight',

                    'pricing_snapshot' => json_encode(
                        $quote,
                        JSON_THROW_ON_ERROR
                    ),

                    'policy_snapshot' => json_encode([
                        'accepted_at' => $requestedAt->toIso8601String(),
                        'settings' => $settings,
                    ], JSON_THROW_ON_ERROR),

                    'requested_at' => $requestedAt->toIso8601String(),

                    'deposit_window_hours' => $settings['opportunity_hours'],

                    'request_key' => $request->input('request_key'),

                    'created_at' => $this->flow->stamp(),
                    'updated_at' => $this->flow->stamp(),
                ]);

            if ($status === 'awaiting_deposit') {
                $record = $this->flow->reservation(
                    $reservationId,
                    true
                );

                $deadline = $this->flow->createOpportunity($record);

                DB::table('reservations')
                    ->where('id', $reservationId)
                    ->update([
                        'deadline' => $deadline->toIso8601String(),
                        'updated_at' => $this->flow->stamp(),
                    ]);
            }

            $this->flow->history(
                $reservationId,
                null,
                $status,
                $request->user()->id,
                'Guest submitted a reservation request.'
            );

            return response()->json([
                'reservation' => $this->flow->present(
                    $this->flow->reservation($reservationId)
                ),
            ], 201);
        });
    }

    /*
     * PATCH /api/reservations/{reservation}/terms
     *
     * Staff agree the final day-tour total.
     */
    public function terms(
        Request $request,
        int $reservation
    ) {
        $this->flow->requireStaff($request->user());

        $data = $request->validate([
            'total' => 'required|numeric|min:1|max:99999999',
        ]);

        return $this->flow->locked(function () use (
            $request,
            $reservation,
            $data
        ) {
            $record = $this->flow->reservation(
                $reservation,
                true
            );

            abort_unless(
                $record->type === 'day_tour' &&
                in_array(
                    $record->status,
                    ['pending', 'queued', 'awaiting_deposit'],
                    true
                ),
                422,
                'Only active unpaid day tours can have their price agreed.'
            );

            abort_if(
                (float) $data['total'] <
                    (float) $record->required_deposit,
                422,
                'The total must cover the required deposit.'
            );

            $snapshot = json_decode(
                $record->pricing_snapshot,
                true
            ) ?? [];

            $snapshot['total'] = (float) $data['total'];

            DB::table('reservations')
                ->where('id', $record->id)
                ->update([
                    'quoted_total' => $data['total'],
                    'price_agreed' => true,

                    'pricing_snapshot' => json_encode(
                        $snapshot,
                        JSON_THROW_ON_ERROR
                    ),

                    'processed_by' => $request->user()->id,
                    'processed_at' => $this->flow->now()->toIso8601String(),

                    'updated_at' => $this->flow->stamp(),
                ]);

            return response()->json([
                'reservation' => $this->flow->present(
                    $this->flow->reservation($record->id)
                ),
            ]);
        });
    }

    /*
     * POST /api/reservations/{reservation}/opportunity
     */
    public function opportunity(
        Request $request,
        int $reservation
    ) {
        $this->flow->requireStaff($request->user());

        return $this->flow->locked(function () use (
            $request,
            $reservation
        ) {
            $record = $this->flow->reservation(
                $reservation,
                true
            );

            abort_unless(
                in_array(
                    $record->status,
                    ['pending', 'queued'],
                    true
                ),
                422,
                'Only pending or queued requests can receive an opportunity.'
            );

            abort_unless(
                $record->price_agreed &&
                (float) $record->required_deposit > 0 &&
                (float) $record->quoted_total >=
                    (float) $record->required_deposit,
                422,
                'Agree the day-tour price or correct the booking amounts first.'
            );

            abort_unless(
                $this->flow->queuePosition($record) === 1,
                422,
                'An earlier overlapping reservation is ahead in the queue.'
            );

            $this->flow->available($record);

            $deadline = $this->flow->createOpportunity(
                $record,
                $request->user()->id
            );

            $this->flow->state(
                $record,
                'awaiting_deposit',
                $request->user()->id,
                'Staff granted a deposit opportunity.',
                [
                    'deadline' => $deadline->toIso8601String(),

                    'processed_by' => $request->user()->id,

                    'processed_at' => $this->flow->now()->toIso8601String(),
                ]
            );

            return response()->json([
                'reservation' => $this->flow->present(
                    $this->flow->reservation($record->id)
                ),
            ]);
        });
    }

    /*
     * POST /api/reservations/{reservation}/extension
     *
     * A guest request never changes the active deposit deadline.
     */
    public function requestExtension(
        Request $request,
        int $reservation
    ) {
        $this->flow->active($request->user());

        $data = $request->validate([
            'reason' => 'required|string|min:3|max:2000',
            'requested_date' => [
                'required',
                'date_format:Y-m-d',
                'after:'.$this->flow->now()->toDateString(),
            ],
            'message' => 'nullable|string|max:2000',
        ]);

        return $this->flow->locked(function () use (
            $request,
            $reservation,
            $data
        ) {
            $record = $this->flow->reservation($reservation, true);
            $this->flow->own($request->user(), $record);

            abort_unless(
                $record->status === 'awaiting_deposit' &&
                $record->deadline &&
                CarbonImmutable::parse(
                    $record->deadline,
                    'Asia/Manila'
                )->gt($this->flow->now()),
                422,
                'Only an active deposit opportunity can be extended.'
            );

            abort_if(
                $record->extension_status === 'pending',
                422,
                'An extension request is already pending for this reservation.'
            );

            $requestedDate = CarbonImmutable::parse(
                $data['requested_date'],
                'Asia/Manila'
            );

            $stayStarts = CarbonImmutable::parse(
                $record->starts_at,
                'Asia/Manila'
            );

            if (
                $requestedDate->endOfDay()->lte(
                    CarbonImmutable::parse(
                        $record->deadline,
                        'Asia/Manila'
                    )
                )
            ) {
                throw ValidationException::withMessages([
                    'requested_date' =>
                        'The requested payment date must extend the current deadline.',
                ]);
            }

            if ($requestedDate->endOfDay()->gte($stayStarts)) {
                throw ValidationException::withMessages([
                    'requested_date' =>
                        'The requested payment date must be before check-in.',
                ]);
            }

            DB::table('reservations')
                ->where('id', $record->id)
                ->update([
                    'extension_date' =>
                        $requestedDate->toIso8601String(),
                    'extension_reason' => trim($data['reason']),
                    'extension_message' => isset($data['message'])
                        ? trim($data['message'])
                        : null,
                    'extension_status' => 'pending',
                    'updated_at' => $this->flow->stamp(),
                ]);

            return response()->json([
                'message' => 'Your deadline extension request was submitted.',
                'reservation' => $this->flow->present(
                    $this->flow->reservation($record->id)
                ),
            ], 201);
        });
    }

    /*
     * POST /api/reservations/{reservation}/extension/review
     *
     * Only approval changes the real reservation and opportunity deadline.
     */
    public function reviewExtension(
        Request $request,
        int $reservation
    ) {
        $this->flow->requireStaff($request->user());

        $data = $request->validate([
            'decision' => 'required|in:approved,rejected',
        ]);

        return $this->flow->locked(function () use (
            $request,
            $reservation,
            $data
        ) {
            $record = $this->flow->reservation($reservation, true);

            abort_unless(
                $record->extension_status === 'pending' &&
                $record->extension_date,
                422,
                'This reservation has no pending extension request.'
            );

            $updates = [
                'extension_status' => $data['decision'],
                'processed_by' => $request->user()->id,
                'processed_at' => $this->flow->now()->toIso8601String(),
                'updated_at' => $this->flow->stamp(),
            ];

            if ($data['decision'] === 'approved') {
                abort_unless(
                    $record->status === 'awaiting_deposit',
                    422,
                    'The deposit opportunity is no longer active.'
                );

                $deadline = CarbonImmutable::parse(
                    $record->extension_date,
                    'Asia/Manila'
                )->endOfDay();

                $stayStarts = CarbonImmutable::parse(
                    $record->starts_at,
                    'Asia/Manila'
                );

                abort_unless(
                    $deadline->gt($this->flow->now()) &&
                    $deadline->lt($stayStarts),
                    422,
                    'The requested payment date is no longer valid.'
                );

                $updates['deadline'] = $deadline->toIso8601String();

                DB::table('reservation_opportunities')
                    ->where('reservation_id', $record->id)
                    ->where('status', 'active')
                    ->update([
                        'deposit_deadline' =>
                            $deadline->toIso8601String(),
                        'updated_at' => $this->flow->stamp(),
                    ]);
            }

            DB::table('reservations')
                ->where('id', $record->id)
                ->update($updates);

            return response()->json([
                'reservation' => $this->flow->present(
                    $this->flow->reservation($record->id)
                ),
            ]);
        });
    }

    /*
     * POST /api/reservations/{reservation}/cancel
     */
    public function cancel(
        Request $request,
        int $reservation
    ) {
        $this->flow->own(
            $request->user(),
            $this->flow->reservation($reservation)
        );

        return $this->flow->locked(function () use (
            $request,
            $reservation
        ) {
            $record = $this->flow->reservation(
                $reservation,
                true
            );

            $allowed = $this->flow->staff($request->user())
                ? [
                    'pending',
                    'queued',
                    'awaiting_deposit',
                    'payment_review',
                    'confirmed',
                ]
                : [
                    'pending',
                    'queued',
                    'awaiting_deposit',
                ];

            abort_unless(
                in_array($record->status, $allowed, true),
                422,
                'Contact staff for cancellation of paid or reviewed bookings.'
            );

            $this->flow->state(
                $record,
                'cancelled',
                $request->user()->id,
                'Reservation cancelled. Any refund must be arranged separately.'
            );

            $this->flow->closeOpportunity(
                $record->id,
                'revoked'
            );

            $this->flow->promoteQueuedLocked();

            return response()->json([
                'reservation' => $this->flow->present(
                    $this->flow->reservation($record->id)
                ),
            ]);
        });
    }

    /*
     * Generate CP-MMDDYY-### inside the reservation transaction.
     *
     * Old ULID references are ignored.
     * Cancelled reservations still retain their references.
     */
    private function nextBookingReference(
        CarbonImmutable $requestedAt
    ): string {
        if (DB::transactionLevel() === 0) {
            throw new \LogicException(
                'Booking references must be generated inside a transaction.'
            );
        }

        $date = $requestedAt->setTimezone('Asia/Manila');
        $prefix = 'CP-'.$date->format('mdy').'-';

        /*
         * PostgreSQL transaction lock:
         * simultaneous submissions for this date allocate
         * their references one at a time.
         *
         * The lock lasts until the reservation transaction ends.
         */
        DB::select(
            'SELECT pg_advisory_xact_lock(?, ?)',
            [112933, (int) $date->format('Ymd')]
        );

        $result = DB::table('reservations')
            ->whereRaw(
                'booking_reference ~ ?',
                ['^'.$prefix.'[0-9]{3}$']
            )
            ->selectRaw(
                'COALESCE(MAX(CAST(RIGHT(booking_reference, 3) AS INTEGER)), 0) AS last_sequence'
            )
            ->first();

        $next = (int) ($result->last_sequence ?? 0) + 1;

        if ($next > 999) {
            throw ValidationException::withMessages([
                'booking_reference' => 'The daily reservation reference limit has been reached. Contact the resort for assistance.',
            ]);
        }

        return $prefix.str_pad(
            (string) $next,
            3,
            '0',
            STR_PAD_LEFT
        );
    }
}
