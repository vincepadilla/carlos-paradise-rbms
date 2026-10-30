<?php

namespace App\Http\Controllers;

use App\Services\ReservationWorkflow;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class BookingPaymentsController extends Controller
{
    public function __construct(
        private ReservationWorkflow $flow
    ) {}

    /*
     * POST /api/reservations/{reservation}/payments
     *
     * Submit a deposit receipt.
     * Uploading a receipt does not confirm the booking.
     */
    public function store(
        Request $request,
        int $reservation
    ) {
        $this->flow->own(
            $request->user(),
            $this->flow->reservation($reservation)
        );

        $data = $request->validate([
            'amount' => 'required|numeric|min:1|max:99999999',

            'method' => [
                'required',
                Rule::in(['GCash', 'MariBank']),
            ],

            'reference' => 'required|string|min:5|max:100',

            'payment_date' => [
                'required',
                'date_format:Y-m-d',
                'before_or_equal:'.
                    $this->flow->now()->toDateString(),
            ],

            'receipt' => [
                'required',
                'file',
                'mimes:jpg,jpeg,png,pdf',
                'max:5120',
            ],
        ]);

        $path = null;

        try {
            return $this->flow->locked(function () use (
                $request,
                $reservation,
                $data,
                &$path
            ) {
                $record = $this->flow->reservation(
                    $reservation,
                    true
                );

                $activeOpportunity =
                    $record->status === 'awaiting_deposit' &&
                    $record->deadline &&
                    CarbonImmutable::parse(
                        $record->deadline,
                        'Asia/Manila'
                    )->gt($this->flow->now());

                abort_unless(
                    $activeOpportunity,
                    422,
                    'This reservation does not have an active deposit opportunity.'
                );

                /*
                 * Require the exact deposit calculated by Laravel.
                 */
                $submittedCents = (int) round(
                    (float) $data['amount'] * 100
                );

                $requiredCents = (int) round(
                    (float) $record->required_deposit * 100
                );

                abort_unless(
                    $submittedCents === $requiredCents,
                    422,
                    'Submit the exact deposit shown on your reservation.'
                );

                /*
                 * Only use an active receiving account.
                 */
                $method = DB::table('payment_methods')
                    ->where('name', $data['method'])
                    ->where('is_active', true)
                    ->first();

                abort_unless(
                    $method,
                    422,
                    'This receiving account has not been configured. Contact staff.'
                );

                /*
                 * Normalize the reference and prevent reuse,
                 * including across older accounts of the same provider.
                 */
                $reference = strtoupper(
                    trim($data['reference'])
                );

                $duplicate = DB::table('payments')
                    ->whereIn(
                        'payment_method_id',
                        DB::table('payment_methods')
                            ->where('name', $data['method'])
                            ->select('id')
                    )
                    ->whereRaw(
                        'UPPER(TRIM(reference_number)) = ?',
                        [$reference]
                    )
                    ->exists();

                abort_if(
                    $duplicate,
                    422,
                    'This transfer reference has already been submitted.'
                );

                $opportunity = DB::table(
                    'reservation_opportunities'
                )
                    ->where('reservation_id', $record->id)
                    ->where('status', 'active')
                    ->first();

                abort_unless(
                    $opportunity,
                    422,
                    'There is no active deposit opportunity. Contact staff.'
                );

                /*
                 * Store the file privately.
                 */
                $path = $this->flow->disk()->putFile(
                    '',
                    $request->file('receipt')
                );

                abort_unless(
                    $path,
                    500,
                    'The receipt could not be saved. Please try again.'
                );

                $paymentId = DB::table('payments')
                    ->insertGetId([
                        'reservation_id' => $record->id,
                        'opportunity_id' => $opportunity->id,
                        'payment_method_id' => $method->id,

                        'payment_kind' => 'deposit',

                        // Use the stored server-calculated amount.
                        'amount' => $record->required_deposit,
                        'currency' => 'PHP',

                        'reference_number' => $reference,
                        'receipt_storage_path' => $path,

                        'payment_date' => $data['payment_date'],

                        'submitted_at' => $this->flow->now()->toIso8601String(),

                        'status' => 'submitted',
                        'submitted_by' => $request->user()->id,

                        'created_at' => $this->flow->stamp(),
                        'updated_at' => $this->flow->stamp(),
                    ]);

                $this->flow->state(
                    $record,
                    'payment_review',
                    $request->user()->id,
                    'Receipt submitted. Staff must verify the actual transfer.'
                );

                return response()->json([
                    'payment' => [
                        'id' => $paymentId,
                        'status' => 'submitted',
                    ],

                    'reservation' => $this->flow->present(
                        $this->flow->reservation($record->id)
                    ),
                ], 201);
            });
        } catch (\Throwable $exception) {
            /*
             * Remove the uploaded file if saving the transaction fails.
             */
            if ($path) {
                $this->flow->disk()->delete($path);
            }

            throw $exception;
        }
    }

    /*
     * GET /api/payments/{payment}/receipt
     *
     * Only the booking owner or staff can download it.
     */
    public function receipt(
        Request $request,
        int $payment
    ) {
        $record = DB::table('payments')
            ->where('id', $payment)
            ->first();

        abort_unless(
            $record,
            404,
            'Payment not found.'
        );

        $this->flow->own(
            $request->user(),
            $this->flow->reservation(
                $record->reservation_id
            )
        );

        $path = $record->receipt_storage_path;

        abort_unless(
            $path &&
            $this->flow->disk()->exists($path),
            404,
            'Receipt file not found.'
        );

        $extension = pathinfo(
            $path,
            PATHINFO_EXTENSION
        );

        return $this->flow->disk()->download(
            $path,
            'receipt-'.$record->id.'.'.$extension
        );
    }

    /*
     * POST /api/payments/{payment}/review
     *
     * Only an active admin or owner can review a receipt.
     */
    public function review(
        Request $request,
        int $payment
    ) {
        $this->flow->requireStaff(
            $request->user()
        );

        $data = $request->validate([
            'decision' => [
                'required',
                Rule::in(['approved', 'rejected']),
            ],

            'note' => 'required|string|min:3|max:1000',
        ]);

        return $this->flow->locked(function () use (
            $request,
            $payment,
            $data
        ) {
            $paymentRecord = DB::table('payments')
                ->where('id', $payment)
                ->lockForUpdate()
                ->first();

            abort_unless(
                $paymentRecord,
                404,
                'Payment not found.'
            );

            $reservation = $this->flow->reservation(
                $paymentRecord->reservation_id,
                true
            );

            abort_unless(
                $paymentRecord->status === 'submitted' &&
                $reservation->status === 'payment_review',
                422,
                'This payment has already been reviewed or the reservation was cancelled.'
            );

            /*
             * Recheck availability before confirming.
             */
            if ($data['decision'] === 'approved') {
                // Unpaid opportunities remain queued candidates. Only an
                // already confirmed booking can prevent this confirmation.
                $this->flow->available($reservation, false);
            }

            DB::table('payments')
                ->where('id', $paymentRecord->id)
                ->update([
                    'status' => $data['decision'],
                    'updated_at' => $this->flow->stamp(),
                ]);

            DB::table('payment_reviews')->insert([
                'payment_id' => $paymentRecord->id,
                'reviewed_by' => $request->user()->id,

                'decision' => $data['decision'],
                'notes' => $data['note'],

                'reviewed_at' => $this->flow->now()->toIso8601String(),

                'created_at' => $this->flow->stamp(),
                'updated_at' => $this->flow->stamp(),
            ]);

            if ($data['decision'] === 'approved') {
                /*
                 * Staff verified the transfer.
                 */
                $this->flow->state(
                    $reservation,
                    'confirmed',
                    $request->user()->id,
                    $data['note']
                );

                $this->flow->closeOpportunity(
                    $reservation->id,
                    'completed'
                );

                $this->flow->rejectQueuedOverlaps($reservation);
            } else {
                /*
                 * Allow correction before a renewed deadline.
                 * The deadline must remain before the stay.
                 */
                $start = CarbonImmutable::parse(
                    $reservation->starts_at,
                    'Asia/Manila'
                );

                $deadline = $this->flow->now()->addHours(
                    $reservation->deposit_window_hours
                );

                if ($deadline->gte($start)) {
                    $deadline = $start->subMinute();
                }

                $status = $deadline->gt($this->flow->now())
                    ? 'awaiting_deposit'
                    : 'expired';

                $this->flow->state(
                    $reservation,
                    $status,
                    $request->user()->id,
                    $data['note'],
                    [
                        'deadline' => $deadline->toIso8601String(),
                    ]
                );

                if ($status === 'expired') {
                    $this->flow->closeOpportunity(
                        $reservation->id,
                        'expired'
                    );
                } else {
                    DB::table('reservation_opportunities')
                        ->where(
                            'id',
                            $paymentRecord->opportunity_id
                        )
                        ->where('status', 'active')
                        ->update([
                            'deposit_deadline' => $deadline->toIso8601String(),

                            'updated_at' => $this->flow->stamp(),
                        ]);
                }
            }

            return response()->json([
                'reservation' => $this->flow->present(
                    $this->flow->reservation(
                        $reservation->id
                    )
                ),
            ]);
        });
    }
}
