<?php

namespace App\Services;

use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

class PaymentReport
{
    public const DATE_RANGES = ['all', 'this_month', 'last_month', 'this_year', 'custom'];

    public const STATUSES = ['unpaid', 'awaiting_review', 'partially_verified', 'verified', 'rejected'];

    public function filters(array $data): array
    {
        $range = $data['date_range'] ?? 'this_month';
        $today = CarbonImmutable::now('Asia/Manila');
        $start = null;
        $end = null;

        if ($range === 'this_month') {
            $start = $today->startOfMonth();
            $end = $today->endOfMonth();
        } elseif ($range === 'last_month') {
            $month = $today->subMonthNoOverflow();
            $start = $month->startOfMonth();
            $end = $month->endOfMonth();
        } elseif ($range === 'this_year') {
            $start = $today->startOfYear();
            $end = $today->endOfYear();
        } elseif ($range === 'custom') {
            $start = CarbonImmutable::createFromFormat('!Y-m-d', $data['start_date'], 'Asia/Manila');
            $end = CarbonImmutable::createFromFormat('!Y-m-d', $data['end_date'], 'Asia/Manila');
        }

        return [
            'search' => trim($data['search'] ?? ''),
            'date_range' => $range,
            'payment_status' => $data['payment_status'] ?? '',
            'start_date' => $start?->toDateString(),
            'end_date' => $end?->toDateString(),
            'date_label' => $this->dateLabel($range, $start, $end),
        ];
    }

    public function query(array $filters): Builder
    {
        $query = DB::table('reservations as reservation')
            ->where('reservation.villa_id', 1)
            ->select([
                'reservation.id',
                'reservation.booking_reference',
                'reservation.check_in_date',
                'reservation.check_out_date',
                'reservation.adults',
                'reservation.children',
                'reservation.required_deposit',
                'reservation.requested_at',
            ])
            ->selectSub($this->sumQuery('submitted'), 'submitted_amount')
            ->selectSub($this->sumQuery('approved'), 'verified_amount');

        if ($filters['search'] !== '') {
            $pattern = '%'.$filters['search'].'%';
            $numericId = ctype_digit($filters['search']) ? (int) $filters['search'] : null;
            $query->where(function (Builder $search) use ($pattern, $numericId) {
                $search->whereLike('reservation.booking_reference', $pattern, caseSensitive: false)
                    ->orWhereExists(function (Builder $payment) use ($pattern) {
                        $payment->selectRaw('1')
                            ->from('payments as searched_payment')
                            ->whereColumn('searched_payment.reservation_id', 'reservation.id')
                            ->whereLike('searched_payment.reference_number', $pattern, caseSensitive: false);
                    });

                if ($numericId !== null && $numericId > 0) {
                    $search->orWhere('reservation.id', $numericId);
                }
            });
        }

        if ($filters['start_date'] !== null) {
            $query->whereDate('reservation.check_in_date', '>=', $filters['start_date']);
        }

        if ($filters['end_date'] !== null) {
            $query->whereDate('reservation.check_in_date', '<=', $filters['end_date']);
        }

        $this->applyStatus($query, $filters['payment_status']);

        return $query->orderByDesc('reservation.requested_at')->orderByDesc('reservation.id');
    }

    public function presentCollection(Collection $records): Collection
    {
        $ids = $records->pluck('id')->map(fn ($id) => (int) $id)->all();
        $payments = empty($ids)
            ? collect()
            : DB::table('payments as payment')
                ->leftJoin('payment_methods as method', 'method.id', '=', 'payment.payment_method_id')
                ->whereIn('payment.reservation_id', $ids)
                ->orderBy('payment.id')
                ->get([
                    'payment.reservation_id',
                    'payment.status',
                    'payment.amount',
                    'method.name as method_name',
                ])
                ->groupBy('reservation_id');

        return $records->map(function (object $record) use ($payments): array {
            $reservationPayments = $payments->get($record->id, collect());
            $methods = $reservationPayments
                ->pluck('method_name')
                ->filter(fn ($name) => is_string($name) && trim($name) !== '')
                ->map(fn ($name) => trim($name))
                ->unique()
                ->values()
                ->all();
            $submitted = $this->amount($record->submitted_amount) ?? '0.00';
            $verified = $this->amount($record->verified_amount) ?? '0.00';
            $required = $this->amount($record->required_deposit);

            return [
                'id' => (int) $record->id,
                'booking_reference' => $record->booking_reference,
                'check_in_date' => $record->check_in_date,
                'check_out_date' => $record->check_out_date,
                'guest_count' => (int) $record->adults + (int) $record->children,
                'adults' => (int) $record->adults,
                'children' => (int) $record->children,
                'payment_status' => $this->paymentState(
                    $submitted,
                    $verified,
                    $required,
                    $reservationPayments->contains('status', 'rejected')
                ),
                'submitted_amount' => $submitted,
                'verified_amount' => $verified,
                'required_amount' => $required,
                'methods' => $methods,
                'requested_at' => CarbonImmutable::parse($record->requested_at, 'Asia/Manila')
                    ->setTimezone('Asia/Manila')
                    ->toIso8601String(),
            ];
        });
    }

    private function sumQuery(string $status): Builder
    {
        return DB::table('payments as amount_payment')
            ->selectRaw('COALESCE(SUM(amount_payment.amount), 0)')
            ->whereColumn('amount_payment.reservation_id', 'reservation.id')
            ->where('amount_payment.status', $status);
    }

    private function applyStatus(Builder $query, string $status): void
    {
        if ($status === '') {
            return;
        }

        $submitted = "(SELECT COALESCE(SUM(payment.amount), 0) FROM payments payment WHERE payment.reservation_id = reservation.id AND payment.status = 'submitted')";
        $verified = "(SELECT COALESCE(SUM(payment.amount), 0) FROM payments payment WHERE payment.reservation_id = reservation.id AND payment.status = 'approved')";
        $required = 'COALESCE(reservation.required_deposit, 0)';
        $rejected = "EXISTS (SELECT 1 FROM payments payment WHERE payment.reservation_id = reservation.id AND payment.status = 'rejected')";

        match ($status) {
            'unpaid' => $query->whereRaw("$submitted = 0 AND $verified = 0 AND NOT $rejected"),
            'awaiting_review' => $query->whereRaw("$submitted > 0 AND $verified = 0"),
            'partially_verified' => $query->whereRaw("$verified > 0 AND $verified < $required"),
            'verified' => $query->whereRaw("$verified > 0 AND $verified >= $required"),
            'rejected' => $query->whereRaw("$submitted = 0 AND $verified = 0 AND $rejected"),
            default => null,
        };
    }

    private function paymentState(string $submitted, string $verified, ?string $required, bool $hasRejected): string
    {
        $submittedCents = ReservationPricing::cents($submitted);
        $verifiedCents = ReservationPricing::cents($verified);
        $requiredCents = ReservationPricing::cents($required ?? 0);

        if ($verifiedCents > 0 && $verifiedCents >= $requiredCents) {
            return 'verified';
        }

        if ($verifiedCents > 0) {
            return 'partially_verified';
        }

        if ($submittedCents > 0) {
            return 'awaiting_review';
        }

        if ($hasRejected) {
            return 'rejected';
        }

        return 'unpaid';
    }

    private function amount(mixed $value): ?string
    {
        if (! is_numeric($value) || ! is_finite((float) $value) || (float) $value < 0) {
            return null;
        }

        return number_format((float) $value, 2, '.', '');
    }

    private function dateLabel(string $range, ?CarbonImmutable $start, ?CarbonImmutable $end): string
    {
        if ($range === 'all') {
            return 'All Dates';
        }

        $prefix = match ($range) {
            'this_month' => 'This Month',
            'last_month' => 'Last Month',
            'this_year' => 'This Year',
            default => 'Custom Range',
        };

        return sprintf('%s · %s – %s', $prefix, $start?->format('M j, Y'), $end?->format('M j, Y'));
    }
}
