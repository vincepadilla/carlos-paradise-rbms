<?php

namespace App\Services;

use Carbon\CarbonImmutable;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class StaffDepositReviewEditing
{
    public function __construct(private ReservationWorkflow $flow, private ReservationPricing $pricing) {}

    public function eligible(object $reservation): bool
    {
        if (($reservation->creation_source ?? null) !== 'staff_portal' || ! $reservation->created_by) return false;

        return DB::table('users as creator')->join('roles as role', 'role.id', '=', 'creator.role_id')
            ->where('creator.id', $reservation->created_by)->whereIn('role.name', ['admin', 'owner'])->exists();
    }

    private function requireEligible(object $reservation): void
    {
        abort_unless($this->eligible($reservation), 403, 'Expanded editing is only available for reservations saved through the staff portal by a staff member.');
    }

    private function checkRevision(object $reservation, int $revision): void
    {
        abort_unless((int) $reservation->admin_revision === $revision, 409, 'This reservation changed in another session. Reload its latest details before saving.');
    }

    public function canApprovePayments(object $user): bool
    {
        $role = DB::table('roles')->where('id', $user->role_id)->value('name');

        return in_array($role, config('reservations.payment_approval_roles', ['admin', 'owner']), true);
    }

    public function recordCash(int $reservationId, object $actor, array $data, ?UploadedFile $receipt): array
    {
        $newPath = null;
        try {
            return $this->flow->locked(function () use ($reservationId, $actor, $data, $receipt, &$newPath) {
                $record = $this->flow->reservation($reservationId, true);
                $this->requireEligible($record);
                abort_if(in_array($record->status, ['cancelled', 'rejected', 'expired', 'completed'], true), 422, 'Cash cannot be recorded against a closed reservation.');

                $existing = DB::table('payments')->where('submitted_by', $actor->id)->where('request_key', $data['request_key'])->first();
                if ($existing) {
                    abort_unless((int) $existing->reservation_id === $reservationId, 409, 'This cash-payment request key was already used for another reservation.');
                    return ['payment_id' => $existing->id, 'approved' => $existing->status === 'approved', 'duplicate' => true];
                }
                $this->checkRevision($record, $data['revision']);
                $hasOpportunity = DB::table('reservation_opportunities')->where('reservation_id', $reservationId)->where('status', 'active')->exists();
                abort_unless($record->status === 'confirmed' || $hasOpportunity, 422,
                    'Cash can only be recorded after this reservation receives its active deposit opportunity. Its queue position is unchanged.');

                $receivedAt = CarbonImmutable::parse($data['received_at'], 'Asia/Manila');
                abort_if($receivedAt->gt($this->flow->now()), 422, 'The received date and time cannot be in the future.');
                $amount = ReservationPricing::money(ReservationPricing::cents($data['amount']));
                $approvedBefore = DB::table('payments')->where('reservation_id', $reservationId)->where('status', 'approved')->lockForUpdate()->get(['amount'])
                    ->sum(fn ($payment) => ReservationPricing::cents($payment->amount));
                $prospective = $approvedBefore + ReservationPricing::cents($amount);
                $required = ReservationPricing::cents($record->required_deposit);
                abort_if($prospective < $required && ! $record->partial_payment_authorized, 422,
                    'A cash amount below the remaining required deposit needs authorized partial-payment terms.');

                $method = DB::table('payment_methods')->where('name', 'Cash')->first();
                if (! $method) {
                    $methodId = DB::table('payment_methods')->insertGetId([
                        'name' => 'Cash', 'account_name' => null, 'account_number' => null, 'instructions' => null,
                        'is_active' => false, 'created_at' => $this->flow->stamp(), 'updated_at' => $this->flow->stamp(),
                    ]);
                    $method = DB::table('payment_methods')->where('id', $methodId)->first();
                }
                $receiptNumber = strtoupper(trim($data['receipt_number']));
                abort_if(DB::table('payments')->where('payment_method_id', $method->id)
                    ->whereRaw('UPPER(TRIM(reference_number)) = ?', [$receiptNumber])->exists(), 422, 'This cash receipt number has already been recorded.');

                if ($receipt) {
                    $newPath = $this->flow->disk()->putFile('', $receipt);
                    abort_unless($newPath, 500, 'The optional cash receipt attachment could not be saved.');
                }
                $canApprove = $this->canApprovePayments($actor);
                $status = $canApprove ? 'approved' : 'submitted';
                $paymentId = DB::table('payments')->insertGetId([
                    'reservation_id' => $reservationId, 'opportunity_id' => DB::table('reservation_opportunities')->where('reservation_id', $reservationId)->where('status', 'active')->value('id'),
                    'payment_method_id' => $method->id, 'payment_kind' => 'deposit', 'amount' => $amount, 'currency' => 'PHP',
                    'reference_number' => $receiptNumber, 'receipt_storage_path' => $newPath, 'payment_date' => $receivedAt->toDateString(),
                    'staff_notes' => isset($data['notes']) ? trim($data['notes']) ?: null : null, 'staff_revision' => 0, 'request_key' => $data['request_key'],
                    'submitted_at' => $receivedAt->toIso8601String(), 'status' => $status, 'submitted_by' => $actor->id,
                    'created_at' => $this->flow->stamp(), 'updated_at' => $this->flow->stamp(),
                ]);

                if ($canApprove) {
                    $reviewId = DB::table('payment_reviews')->insertGetId([
                        'payment_id' => $paymentId, 'reviewed_by' => $actor->id, 'decision' => 'approved',
                        'notes' => 'Cash received and recorded by authenticated staff.', 'reviewed_at' => $this->flow->now()->toIso8601String(),
                        'created_at' => $this->flow->stamp(), 'updated_at' => $this->flow->stamp(),
                    ]);
                    app(AuditChain::class)->recordSource('payment_reviews', $reviewId);
                }

                $coverageMet = $prospective >= $required;
                $stateChanged = false;
                $activeOpportunity = DB::table('reservation_opportunities')->where('reservation_id', $reservationId)->where('status', 'active')->exists();
                if (! $canApprove && in_array($record->status, ['awaiting_deposit', 'held'], true)) {
                    $this->flow->state($record, 'payment_review', $actor->id, 'Cash payment #'.$paymentId.' recorded for authorized review.');
                    $stateChanged = true;
                } elseif ($canApprove && $coverageMet && in_array($record->status, ['awaiting_deposit', 'held', 'payment_review'], true) && $activeOpportunity) {
                    $available = true;
                    try { $this->flow->available($record, false); } catch (ValidationException) { $available = false; }
                    if ($available && $record->price_agreed && CarbonImmutable::parse($record->ends_at)->gt($this->flow->now())) {
                        $this->flow->state($record, 'confirmed', $actor->id, 'Cash payment #'.$paymentId.' verified; the required deposit is covered.');
                        $this->flow->closeOpportunity($reservationId, 'completed');
                        $this->flow->cancelQueuedOverlaps($record);
                        $stateChanged = true;
                    }
                } elseif ($canApprove && ! $coverageMet && $record->status === 'payment_review'
                    && ! DB::table('payments')->where('reservation_id', $reservationId)->where('status', 'submitted')->exists()) {
                    $this->flow->state($record, 'awaiting_deposit', $actor->id, 'Authorized partial cash payment #'.$paymentId.' recorded; the remaining deposit is still due.');
                    $stateChanged = true;
                }
                if (! $stateChanged) {
                    DB::table('reservations')->where('id', $reservationId)->update(['admin_revision' => $record->admin_revision + 1, 'updated_at' => $this->flow->stamp()]);
                }
                $after = ['payment_id' => $paymentId, 'amount' => $amount, 'method' => 'Cash', 'receipt_number' => $receiptNumber,
                    'received_at' => $receivedAt->toIso8601String(), 'status' => $status, 'attachment' => (bool) $newPath, 'recorded_by' => $actor->id];
                $this->flow->history($reservationId, $record->status, $stateChanged ? DB::table('reservations')->where('id', $reservationId)->value('status') : $record->status,
                    $actor->id, 'Cash received and recorded by authenticated staff.', 'staff_cash_payment_recorded', ['before' => [], 'after' => $after]);

                return ['payment_id' => $paymentId, 'approved' => $canApprove, 'duplicate' => false];
            });
        } catch (\Throwable $exception) {
            if ($newPath) $this->flow->disk()->delete($newPath);
            throw $exception;
        }
    }

    public function updateReservation(int $id, int $actor, array $data): void
    {
        $this->flow->locked(function () use ($id, $actor, $data) {
            $record = $this->flow->reservation($id, true);
            $this->requireEligible($record);
            $this->checkRevision($record, $data['revision']);
            abort_if(in_array($record->status, ['cancelled', 'rejected', 'expired', 'completed'], true), 422, 'A closed reservation cannot be edited from deposit review.');

            $start = CarbonImmutable::parse($data['checkin'].' '.$data['checkin_time'], 'Asia/Manila');
            $end = CarbonImmutable::parse($data['checkout'].' '.$data['checkout_time'], 'Asia/Manila');
            if (! $end->gt($start) || $end->lte($this->flow->now()) || $end->gt($this->flow->now()->addYears(2)) || $end->diffInDays($start) > 30) {
                throw ValidationException::withMessages(['checkout' => 'The stay must end after arrival, last at most 30 days, and end within the next two years.']);
            }
            if (($data['type'] === 'day_tour' && $data['checkin'] !== $data['checkout']) || ($data['type'] === 'overnight' && $data['checkout'] <= $data['checkin'])) {
                throw ValidationException::withMessages(['checkout' => 'Day tours use one date; overnight stays require a later check-out date.']);
            }
            $settings = app(\App\Http\Controllers\ReservationSettingsController::class)->index()->getData(true)['settings'];
            if ($data['adults'] + $data['children'] > $settings['max_guests']) {
                throw ValidationException::withMessages(['adults' => 'The total number of guests exceeds the villa capacity.']);
            }

            $candidate = (object) [...(array) $record, 'starts_at' => $start->toIso8601String(), 'ends_at' => $end->toIso8601String()];
            $scheduleChanged = $start->toIso8601String() !== CarbonImmutable::parse($record->starts_at)->toIso8601String()
                || $end->toIso8601String() !== CarbonImmutable::parse($record->ends_at)->toIso8601String();
            if ($scheduleChanged) $this->flow->available($candidate, ! in_array($record->status, ['pending', 'queued'], true));

            $snapshot = json_decode($record->pricing_snapshot ?: '{}', true);
            $snapshot = is_array($snapshot) ? $snapshot : [];
            $prices = $this->pricing->calculate($data['pricing'], $data['discount'], $record->required_deposit);
            $prices['discount']['applied_by'] = $actor;
            $prices['discount']['applied_at'] = $this->flow->now()->toIso8601String();
            $updates = [
                'contact_name' => trim($data['contact_name']), 'contact_email' => mb_strtolower(trim($data['contact_email'])),
                'contact_phone' => trim($data['contact_phone']), 'type' => $data['type'],
                'check_in_date' => $data['checkin'], 'check_out_date' => $data['checkout'],
                'starts_at' => $start->toIso8601String(), 'ends_at' => $end->toIso8601String(),
                'adults' => $data['adults'], 'children' => $data['children'], 'pets' => $data['pets'],
                'bonfire_qty' => $data['bonfire_qty'], 'charcoal_qty' => $data['charcoal_qty'], 'liquor_qty' => $data['liquor_qty'],
                'special_requests' => isset($data['notes']) ? trim($data['notes']) ?: null : null,
                'quoted_total' => $prices['total'], 'pricing_snapshot' => json_encode(array_replace($snapshot, $prices), JSON_THROW_ON_ERROR),
                'processed_by' => $actor, 'processed_at' => $this->flow->now()->toIso8601String(),
                'admin_revision' => $record->admin_revision + 1, 'updated_at' => $this->flow->stamp(),
            ];
            $before = array_intersect_key((array) $record, $updates);
            DB::table('reservations')->where('id', $id)->update($updates);
            $this->flow->history($id, $record->status, $record->status, $actor, trim($data['reason']), 'staff_reservation_corrected', ['before' => $before, 'after' => $updates]);
        });
    }

    public function updateTerms(int $id, int $actor, array $data): void
    {
        $this->flow->locked(function () use ($id, $actor, $data) {
            $record = $this->flow->reservation($id, true);
            $this->requireEligible($record);
            $this->checkRevision($record, $data['revision']);
            abort_if(in_array($record->status, ['cancelled', 'rejected', 'expired', 'completed'], true), 422, 'Deposit terms for a closed reservation cannot be changed.');
            abort_if(ReservationPricing::cents($data['required_deposit']) > ReservationPricing::cents($record->quoted_total), 422, 'The required deposit cannot exceed the reservation total.');
            $deadline = CarbonImmutable::parse($data['deadline'], 'Asia/Manila');
            abort_unless($deadline->gt($this->flow->now()) && $deadline->lt(CarbonImmutable::parse($record->starts_at)), 422, 'The deposit deadline must be in the future and before check-in.');
            $terms = $data['partial_payment_authorized'] ? trim((string) ($data['partial_payment_terms'] ?? '')) : null;
            if ($data['partial_payment_authorized'] && mb_strlen($terms) < 3) {
                throw ValidationException::withMessages(['partial_payment_terms' => 'Describe the authorized partial-payment terms.']);
            }
            $before = ['required_deposit' => $record->required_deposit, 'deadline' => $record->deadline,
                'partial_payment_authorized' => (bool) $record->partial_payment_authorized, 'partial_payment_terms' => $record->partial_payment_terms];
            $after = ['required_deposit' => ReservationPricing::money(ReservationPricing::cents($data['required_deposit'])),
                'deadline' => $deadline->toIso8601String(), 'partial_payment_authorized' => $data['partial_payment_authorized'], 'partial_payment_terms' => $terms];
            DB::table('reservations')->where('id', $id)->update([...$after, 'admin_revision' => $record->admin_revision + 1, 'updated_at' => $this->flow->stamp()]);
            DB::table('reservation_opportunities')->where('reservation_id', $id)->where('status', 'active')
                ->update(['deposit_deadline' => $after['deadline'], 'updated_at' => $this->flow->stamp()]);
            $this->flow->history($id, $record->status, $record->status, $actor, trim($data['reason']), 'staff_deposit_terms_corrected', ['before' => $before, 'after' => $after]);
        });
    }

    public function updatePayment(int $reservationId, int $paymentId, int $actor, array $data, ?UploadedFile $receipt): void
    {
        $newPath = null;
        try {
            if ($receipt) {
                $newPath = $this->flow->disk()->putFile('', $receipt);
                abort_unless($newPath, 500, 'The replacement receipt could not be saved.');
            }
            $this->flow->locked(function () use ($reservationId, $paymentId, $actor, $data, $newPath) {
                $record = $this->flow->reservation($reservationId, true);
                $this->requireEligible($record);
                $this->checkRevision($record, $data['revision']);
                $payment = DB::table('payments')->where('id', $paymentId)->where('reservation_id', $reservationId)->lockForUpdate()->first();
                abort_unless($payment, 404, 'Payment not found for this reservation.');
                abort_unless($payment->status === 'submitted', 422, 'Only a pending payment can be edited. Verified and rejected records are preserved.');
                abort_unless((int) $payment->staff_revision === $data['payment_revision'], 409, 'This payment changed in another session. Reload before saving.');
                $staffSubmitter = DB::table('users as submitter')->join('roles as role', 'role.id', '=', 'submitter.role_id')
                    ->where('submitter.id', $payment->submitted_by)->whereIn('role.name', ['admin', 'owner'])->exists();
                abort_unless($staffSubmitter, 403, 'Guest-submitted payment details cannot be edited. Staff corrections are recorded separately.');
                $method = DB::table('payment_methods')->where('name', $data['method'])->where('is_active', true)->first();
                abort_unless($method, 422, 'Select an active payment method.');
                $reference = strtoupper(trim($data['reference']));
                abort_if(DB::table('payments')->where('id', '!=', $paymentId)->whereIn('payment_method_id', DB::table('payment_methods')->where('name', $data['method'])->select('id'))
                    ->whereRaw('UPPER(TRIM(reference_number)) = ?', [$reference])->exists(), 422, 'This transfer reference has already been recorded.');
                $before = ['amount' => $payment->amount, 'method' => DB::table('payment_methods')->where('id', $payment->payment_method_id)->value('name'),
                    'reference' => $payment->reference_number, 'payment_date' => $payment->payment_date, 'notes' => $payment->staff_notes,
                    'receipt_replaced' => false, 'revision' => (int) $payment->staff_revision];
                $after = ['amount' => ReservationPricing::money(ReservationPricing::cents($data['amount'])), 'method' => $method->name,
                    'reference' => $reference, 'payment_date' => $data['payment_date'], 'notes' => isset($data['notes']) ? trim($data['notes']) ?: null : null,
                    'receipt_replaced' => (bool) $newPath, 'revision' => (int) $payment->staff_revision + 1];
                DB::table('payments')->where('id', $paymentId)->update(['amount' => $after['amount'], 'payment_method_id' => $method->id,
                    'reference_number' => $reference, 'payment_date' => $after['payment_date'], 'staff_notes' => $after['notes'],
                    'receipt_storage_path' => $newPath ?: $payment->receipt_storage_path, 'staff_revision' => $after['revision'], 'updated_at' => $this->flow->stamp()]);
                DB::table('reservations')->where('id', $reservationId)->update(['admin_revision' => $record->admin_revision + 1, 'updated_at' => $this->flow->stamp()]);
                DB::table('payment_adjustments')->insert(['payment_id' => $paymentId, 'reservation_id' => $reservationId, 'adjusted_by' => $actor,
                    'reason' => trim($data['reason']), 'before_values' => json_encode($before, JSON_THROW_ON_ERROR), 'after_values' => json_encode($after, JSON_THROW_ON_ERROR),
                    'previous_receipt_storage_path' => $newPath ? $payment->receipt_storage_path : null, 'adjusted_at' => $this->flow->now()->toIso8601String(),
                    'created_at' => $this->flow->stamp(), 'updated_at' => $this->flow->stamp()]);
                $this->flow->history($reservationId, $record->status, $record->status, $actor, trim($data['reason']), 'staff_payment_corrected', ['payment_id' => $paymentId, 'before' => $before, 'after' => $after]);
            });
        } catch (\Throwable $exception) {
            if ($newPath) $this->flow->disk()->delete($newPath);
            throw $exception;
        }
    }
}
