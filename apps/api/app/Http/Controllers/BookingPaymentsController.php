<?php

namespace App\Http\Controllers;

use App\Services\AdminNotificationService;
use App\Services\OfficialPaymentReceipt;
use App\Services\PaymentReceiptStorage;
use App\Services\ReservationPricing;
use App\Services\ReservationWorkflow;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class BookingPaymentsController extends Controller
{
    public function __construct(
        private ReservationWorkflow $flow,
        private PaymentReceiptStorage $receipts,
        private OfficialPaymentReceipt $officialReceipts,
        private AdminNotificationService $notifications,
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
            'amount' => ['required', 'numeric', 'decimal:0,2', 'min:1', 'max:99999999'],

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
                 * Preserve the amount the guest says was transferred. Staff
                 * still compare it with the required deposit during review.
                 */
                $submittedCents = (int) round(
                    (float) $data['amount'] * 100
                );
                $submittedAmount = number_format(
                    $submittedCents / 100,
                    2,
                    '.',
                    ''
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

                        'amount' => $submittedAmount,
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

                $this->notifications->paymentSubmitted(
                    $record,
                    $paymentId,
                    $submittedAmount,
                );

                $this->flow->cancelQueuedOverlaps($record);

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
     * Only the booking owner or staff can download the server-generated
     * official receipt, and only after staff approve the payment.
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

        return $this->officialReceipts->download($record);
    }

    /*
     * POST /api/payments/{payment}/review
     *
     * HTTP routes require an active Admin. The existing staff CLI also reuses this workflow.
     */
    public function review(
        Request $request,
        int $payment,
        ?int $expectedReservation = null
    ) {
        $this->flow->requireStaff(
            $request->user()
        );

        if (is_string($request->input('note'))) {
            $request->merge(['note' => trim($request->input('note'))]);
        }
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
            $data,
            $expectedReservation
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
            abort_if($expectedReservation !== null && (int) $paymentRecord->reservation_id !== $expectedReservation, 404, 'Payment not found for this reservation.');

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
                $this->validateApproval($paymentRecord, $reservation);
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
                    'Payment #'.$paymentRecord->id.' approved: '.$data['note']
                );

                $this->flow->closeOpportunity(
                    $reservation->id,
                    'completed'
                );

                // Idempotent safety for receipts submitted before the
                // queue was closed at submission time.
                $this->flow->cancelQueuedOverlaps($reservation);

            } elseif (! DB::table('payments')->where('reservation_id', $reservation->id)->where('status', 'submitted')->exists()) {
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
                    'Payment #'.$paymentRecord->id.' rejected: '.$data['note'],
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
                    $activeOpportunity = DB::table('reservation_opportunities')
                        ->where('reservation_id', $reservation->id)
                        ->where('status', 'active')
                        ->exists();
                    if (! $activeOpportunity) {
                        $this->flow->createOpportunity($reservation, $request->user()->id);
                    }
                    DB::table('reservation_opportunities')
                        ->where('reservation_id', $reservation->id)
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

    private function validateApproval(object $payment, object $reservation): void
    {
        $submittedCents = ReservationPricing::cents($payment->amount);
        $requiredCents = ReservationPricing::cents($reservation->required_deposit);
        abort_unless(
            $payment->payment_kind === 'deposit'
                && $payment->currency === 'PHP'
                && $requiredCents > 0
                && $submittedCents > 0,
            422,
            'This submission is not a valid PHP deposit payment.'
        );

        $approvedCents = DB::table('payments')
            ->where('reservation_id', $reservation->id)
            ->where('status', 'approved')
            ->where('id', '!=', $payment->id)
            ->lockForUpdate()
            ->get(['id', 'amount'])
            ->sum(fn ($approved): int => ReservationPricing::cents($approved->amount));
        $prospectiveCents = $approvedCents + $submittedCents;
        $remainingCents = max(0, $requiredCents - $prospectiveCents);

        abort_if(
            $remainingCents > 0,
            422,
            'The prospective verified total is below the minimum required deposit. Remaining deposit: PHP '.number_format($remainingCents / 100, 2, '.', ',').'.'
        );
        abort_unless($reservation->price_agreed, 422, 'The reservation total must be agreed before confirming payment.');
        abort_unless(CarbonImmutable::parse($reservation->ends_at)->gt($this->flow->now()), 422, 'An ended reservation cannot be confirmed.');
        $receipt = $this->receipts->describe($payment);
        abort_unless($receipt['available'] && in_array($receipt['mime'], PaymentReceiptStorage::PREVIEW_TYPES, true), 422, 'A valid uploaded receipt is required before approval.');
    }
}
