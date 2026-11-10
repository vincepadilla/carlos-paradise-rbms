<?php

namespace App\Services;

use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

class ReservationReport
{
    public const DATE_RANGES = ['all', 'this_month', 'last_month', 'this_year', 'custom'];

    public const STATUSES = [
        'pending',
        'queued',
        'awaiting_deposit',
        'payment_review',
        'confirmed',
        'ongoing',
        'completed',
        'cancelled',
        'rejected',
        'expired',
    ];

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
            'status' => $data['status'] ?? '',
            'start_date' => $start?->toDateString(),
            'end_date' => $end?->toDateString(),
            'date_label' => $this->dateLabel($range, $start, $end),
        ];
    }

    public function query(array $filters): Builder
    {
        $submitted = DB::table('payments as submitted_payment')
            ->selectRaw('COALESCE(SUM(submitted_payment.amount), 0)')
            ->whereColumn('submitted_payment.reservation_id', 'reservation.id')
            ->where('submitted_payment.status', 'submitted');

        $verified = DB::table('payments as verified_payment')
            ->selectRaw('COALESCE(SUM(verified_payment.amount), 0)')
            ->whereColumn('verified_payment.reservation_id', 'reservation.id')
            ->where('verified_payment.status', 'approved');

        $query = DB::table('reservations as reservation')
            ->where('reservation.villa_id', 1)
            ->select([
                'reservation.id',
                'reservation.booking_reference',
                'reservation.contact_name',
                'reservation.check_in_date',
                'reservation.check_out_date',
                'reservation.adults',
                'reservation.children',
                'reservation.status',
                'reservation.required_deposit',
                'reservation.quoted_total',
                'reservation.price_agreed',
                'reservation.pricing_snapshot',
                'reservation.requested_at',
            ])
            ->selectSub($submitted, 'submitted_amount')
            ->selectSub($verified, 'verified_amount');

        if ($filters['search'] !== '') {
            $pattern = '%'.$filters['search'].'%';
            $numericId = ctype_digit($filters['search']) ? (int) $filters['search'] : null;
            $query->where(function (Builder $search) use ($pattern, $numericId) {
                $search->whereLike('reservation.contact_name', $pattern, caseSensitive: false)
                    ->orWhereLike('reservation.booking_reference', $pattern, caseSensitive: false);

                if ($numericId !== null && $numericId > 0) {
                    $search->orWhere('reservation.id', $numericId);
                }
            });
        }

        if ($filters['status'] !== '') {
            $query->where('reservation.status', $filters['status']);
        }

        if ($filters['start_date'] !== null) {
            $query->whereDate('reservation.check_in_date', '>=', $filters['start_date']);
        }

        if ($filters['end_date'] !== null) {
            $query->whereDate('reservation.check_in_date', '<=', $filters['end_date']);
        }

        return $query->orderByDesc('reservation.requested_at')->orderByDesc('reservation.id');
    }

    public function presentCollection(Collection $records): Collection
    {
        return $records->map(fn (object $record): array => $this->present($record));
    }

    public function present(object $record): array
    {
        $pricing = json_decode($record->pricing_snapshot ?? '{}', true);
        $pricing = is_array($pricing) ? $pricing : [];
        $discount = is_array($pricing['discount'] ?? null) ? $pricing['discount'] : null;
        $submitted = $this->amount($record->submitted_amount) ?? '0.00';
        $verified = $this->amount($record->verified_amount) ?? '0.00';
        $required = $this->amount($record->required_deposit);

        return [
            'id' => (int) $record->id,
            'booking_reference' => $record->booking_reference,
            'guest_name' => $record->contact_name,
            'check_in_date' => $record->check_in_date,
            'check_out_date' => $record->check_out_date,
            'guest_count' => (int) $record->adults + (int) $record->children,
            'adults' => (int) $record->adults,
            'children' => (int) $record->children,
            'status' => $record->status,
            'payment' => [
                'state' => $this->paymentState($submitted, $verified, $required),
                'submitted_amount' => $submitted,
                'verified_amount' => $verified,
                'required_amount' => $required,
            ],
            'pricing' => [
                'base_amount' => $this->amount($pricing['base'] ?? null),
                'discount_amount' => $this->amount($discount['amount'] ?? null),
                'discount_type' => is_string($discount['type'] ?? null) ? $discount['type'] : null,
                'discount_confirmed_none' => ($discount['type'] ?? null) === 'none',
                'final_amount' => $this->amount($pricing['total'] ?? $record->quoted_total),
            ],
            'requested_at' => CarbonImmutable::parse($record->requested_at, 'Asia/Manila')
                ->setTimezone('Asia/Manila')
                ->toIso8601String(),
        ];
    }

    private function paymentState(string $submitted, string $verified, ?string $required): string
    {
        $submittedCents = ReservationPricing::cents($submitted);
        $verifiedCents = ReservationPricing::cents($verified);
        $requiredCents = ReservationPricing::cents($required ?? 0);

        if ($verifiedCents > 0) {
            return $requiredCents > 0 && $verifiedCents < $requiredCents
                ? 'partially_verified'
                : 'verified';
        }

        if ($submittedCents > 0) {
            return $requiredCents > 0 && $submittedCents < $requiredCents
                ? 'partial_submission'
                : 'submitted';
        }

        return 'not_submitted';
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
