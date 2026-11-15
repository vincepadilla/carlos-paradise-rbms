<?php

namespace App\Services;

use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

class ReservationReport
{
    public function __construct(private ReservationAvailability $availability) {}

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
            'period' => $data['period'] ?? '',
            'guest_type' => $data['guest_type'] ?? '',
            'frequency' => $data['frequency'] ?? '',
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
                'reservation.user_id',
                'reservation.booking_reference',
                'reservation.contact_name',
                'reservation.contact_email',
                'reservation.contact_phone',
                'reservation.type',
                'reservation.check_in_date',
                'reservation.check_out_date',
                'reservation.adults',
                'reservation.children',
                'reservation.pets',
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
        if (($filters['period'] ?? '') !== '') {
            $operator = strlen($filters['period']) === 7 ? 'like' : '=';
            $query->where('reservation.check_in_date', $operator, $filters['period'].($operator === 'like' ? '%' : ''));
        }

        return $query->orderByDesc('reservation.requested_at')->orderByDesc('reservation.id');
    }

    public function presentCollection(Collection $records): Collection
    {
        return $records->map(fn (object $record): array => $this->present($record));
    }

    public function analytics(array $filters): array
    {
        $records = $this->query([...$filters, 'status' => '', 'period' => ''])->get();
        [$availabilityStart, $availabilityEnd] = $this->availabilityBounds($filters);
        return [
            'scope_label' => 'Base search and reservation check-in date scope',
            'status' => collect(self::STATUSES)->map(fn ($status) => [
                'key' => $status,
                'label' => ucwords(str_replace('_', ' ', $status)),
                'value' => $records->where('status', $status)->count(),
            ])->all(),
            'availability' => [
                ['key' => 'available_nights', 'label' => 'Available Nights', 'value' => $this->availability->availableNights($availabilityStart, $availabilityEnd), 'unit' => 'nights'],
                ['key' => 'completed_reservations', 'label' => 'Completed Reservations', 'value' => $records->where('status', 'completed')->count(), 'unit' => 'reservations'],
            ],
            'availability_period' => [
                'start' => $availabilityStart->toDateString(),
                'end' => $availabilityEnd->toDateString(),
            ],
            'trend' => $this->trend($records, $filters),
        ];
    }

    /** @return array{CarbonImmutable, CarbonImmutable} */
    private function availabilityBounds(array $filters): array
    {
        if ($filters['start_date'] && $filters['end_date']) {
            return [
                CarbonImmutable::createFromFormat('!Y-m-d', $filters['start_date'], 'Asia/Manila'),
                CarbonImmutable::createFromFormat('!Y-m-d', $filters['end_date'], 'Asia/Manila'),
            ];
        }

        $reservationStart = DB::table('reservations')->where('villa_id', 1)->min('check_in_date');
        $reservationEnd = DB::table('reservations')->where('villa_id', 1)->max('check_out_date');
        $blockStart = DB::table('availability_blocks')->where('villa_id', 1)->whereNull('released_at')->min('starts_on');
        $blockEnd = DB::table('availability_blocks')->where('villa_id', 1)->whereNull('released_at')->max('ends_on');
        $today = CarbonImmutable::now('Asia/Manila')->startOfDay();
        $starts = collect([$reservationStart, $blockStart])->filter()->map(fn ($date) => CarbonImmutable::parse($date, 'Asia/Manila'));
        $ends = collect([$reservationEnd, $blockEnd])->filter()->map(fn ($date) => CarbonImmutable::parse($date, 'Asia/Manila')->subDay());
        $start = $starts->isEmpty() ? $today : $starts->sort()->first();
        $end = $ends->isEmpty() ? $today : $ends->sort()->last();

        return [$start, $end->lt($start) ? $start : $end];
    }

    public function guestQuery(array $filters): Builder
    {
        $query = DB::table('reservations as reservation')
            ->where('reservation.villa_id', 1)
            ->select([
                'reservation.user_id',
                DB::raw('MAX(reservation.id) as associated_reservation_id'),
                DB::raw('MAX(reservation.contact_name) as guest_name'),
                DB::raw('MAX(reservation.contact_email) as guest_email'),
                DB::raw('MAX(reservation.contact_phone) as guest_phone'),
                DB::raw('COUNT(*) as reservation_count'),
                DB::raw('MIN(reservation.check_in_date) as first_stay_date'),
                DB::raw('MAX(reservation.check_in_date) as latest_stay_date'),
                DB::raw('SUM(CASE WHEN reservation.status IN (\'confirmed\',\'ongoing\',\'completed\') THEN 1 ELSE 0 END) as successful_reservations'),
            ]);
        $this->applyReservationFilters($query, $filters);
        if (($filters['guest_type'] ?? '') !== '') {
            if ($filters['start_date'] === null) {
                if ($filters['guest_type'] === 'returning') $query->whereRaw('1 = 0');
            } else {
                $method = $filters['guest_type'] === 'returning' ? 'whereExists' : 'whereNotExists';
                $query->{$method}(function (Builder $prior) use ($filters) {
                    $prior->selectRaw('1')->from('reservations as prior_reservation')
                        ->whereColumn('prior_reservation.user_id', 'reservation.user_id')
                        ->whereDate('prior_reservation.check_in_date', '<', $filters['start_date']);
                });
            }
        }
        if (($filters['frequency'] ?? '') !== '') {
            $condition = match ($filters['frequency']) {
                '1' => '= 1', '2' => '= 2', '2+' => '>= 2', '3-4' => 'BETWEEN 3 AND 4', default => '>= 5',
            };
            $query->havingRaw('COUNT(*) '.$condition);
        }
        return $query->groupBy('reservation.user_id')
            ->orderByDesc('latest_stay_date')->orderByDesc('associated_reservation_id');
    }

    public function presentGuestCollection(Collection $records): Collection
    {
        $reservationIds = $records->pluck('associated_reservation_id')->map(fn ($id) => (int) $id)->all();
        $references = empty($reservationIds) ? collect() : DB::table('reservations')
            ->whereIn('id', $reservationIds)->pluck('booking_reference', 'id');
        $userIds = $records->pluck('user_id')->map(fn ($id) => (int) $id)->all();
        $history = empty($userIds) ? collect() : DB::table('reservations')
            ->where('villa_id', 1)->whereIn('user_id', $userIds)
            ->selectRaw('user_id, COUNT(*) as total')->groupBy('user_id')->pluck('total', 'user_id');

        return $records->map(fn (object $record): array => [
            'user_id' => (int) $record->user_id,
            'guest_name' => $record->guest_name,
            'guest_email' => $record->guest_email,
            'guest_phone' => $record->guest_phone,
            'reservation_count' => (int) $record->reservation_count,
            'successful_reservations' => (int) $record->successful_reservations,
            'history_reservation_count' => (int) ($history[$record->user_id] ?? $record->reservation_count),
            'first_stay_date' => $record->first_stay_date,
            'latest_stay_date' => $record->latest_stay_date,
            'associated_reservation_id' => (int) $record->associated_reservation_id,
            'associated_booking_reference' => $references[$record->associated_reservation_id] ?? null,
        ]);
    }

    public function guestAnalytics(array $filters): array
    {
        $records = $this->query([...$filters, 'status' => '', 'period' => '', 'guest_type' => '', 'frequency' => ''])->get();
        $byGuest = $records->groupBy('user_id');
        $priorUsers = $filters['start_date'] === null ? collect() : DB::table('reservations')
            ->where('villa_id', 1)->whereDate('check_in_date', '<', $filters['start_date'])
            ->whereIn('user_id', $byGuest->keys())->pluck('user_id')->flip();
        $classification = collect(['new' => 0, 'returning' => 0]);
        $frequency = collect(['1' => 0, '2' => 0, '3-4' => 0, '5+' => 0]);
        foreach ($byGuest as $userId => $guestRecords) {
            $guestType = $priorUsers->has($userId) ? 'returning' : 'new';
            $classification->put($guestType, $classification->get($guestType) + 1);
            $count = $guestRecords->count();
            $bucket = $count === 1 ? '1' : ($count === 2 ? '2' : ($count < 5 ? '3-4' : '5+'));
            $frequency->put($bucket, $frequency->get($bucket) + 1);
        }
        return [
            'scope_label' => 'Each guest counted once in the base search and reservation check-in date scope',
            'cards' => [
                ['key' => 'total_guests', 'label' => 'Total Guests', 'value' => $byGuest->count(), 'filter_field' => 'guest_type', 'filter_value' => ''],
                ['key' => 'first_time_guests', 'label' => 'First-time Guests', 'value' => $classification->get('new'), 'filter_field' => 'guest_type', 'filter_value' => 'new'],
                ['key' => 'returning_guests', 'label' => 'Returning Guests', 'value' => $classification->get('returning'), 'filter_field' => 'guest_type', 'filter_value' => 'returning'],
                ['key' => 'multiple_reservations', 'label' => 'Guests with Multiple Reservations', 'value' => $byGuest->filter(fn ($items) => $items->count() >= 2)->count(), 'filter_field' => 'frequency', 'filter_value' => '2+'],
            ],
            'classification' => $classification->map(fn ($value, $key) => ['key' => $key, 'label' => ucfirst($key), 'value' => $value])->values()->all(),
            'frequency' => $frequency->map(fn ($value, $key) => ['key' => $key, 'label' => $key.' reservation'.($key === '1' ? '' : 's'), 'value' => $value])->values()->all(),
        ];
    }

    private function trend(Collection $records, array $filters): array
    {
        $daily = $filters['start_date'] && $filters['end_date']
            && CarbonImmutable::parse($filters['start_date'])->diffInDays(CarbonImmutable::parse($filters['end_date'])) <= 31;
        return $records->groupBy(fn ($record) => CarbonImmutable::parse($record->check_in_date, 'Asia/Manila')->format($daily ? 'Y-m-d' : 'Y-m'))
            ->map(fn ($items, $key) => [
                'key' => $key,
                'label' => CarbonImmutable::parse($key.($daily ? '' : '-01'))->format($daily ? 'M j' : 'M Y'),
                'value' => $items->count(),
            ])->sortBy('key')->values()->all();
    }

    private function applyReservationFilters(Builder $query, array $filters): void
    {
        if ($filters['search'] !== '') {
            $pattern = '%'.$filters['search'].'%';
            $query->where(function (Builder $search) use ($pattern) {
                $search->whereLike('reservation.contact_name', $pattern, caseSensitive: false)
                    ->orWhereLike('reservation.contact_email', $pattern, caseSensitive: false)
                    ->orWhereLike('reservation.contact_phone', $pattern, caseSensitive: false)
                    ->orWhereLike('reservation.booking_reference', $pattern, caseSensitive: false);
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
        if (($filters['period'] ?? '') !== '') {
            $operator = strlen($filters['period']) === 7 ? 'like' : '=';
            $query->where('reservation.check_in_date', $operator, $filters['period'].($operator === 'like' ? '%' : ''));
        }
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
            'guest_email' => $record->contact_email,
            'guest_phone' => $record->contact_phone,
            'reservation_type' => $record->type,
            'check_in_date' => $record->check_in_date,
            'check_out_date' => $record->check_out_date,
            'guest_count' => (int) $record->adults + (int) $record->children,
            'adults' => (int) $record->adults,
            'children' => (int) $record->children,
            'pets' => (int) $record->pets,
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
                'additional_charges' => collect($pricing)
                    ->only(['holiday_fee', 'extra_fee', 'cleaning_fee', 'bonfire', 'charcoal', 'liquor', 'other'])
                    ->filter(fn ($value) => is_numeric($value) && (float) $value > 0)
                    ->map(fn ($value, $key) => ['label' => ucwords(str_replace('_', ' ', $key)), 'amount' => $this->amount($value)])
                    ->values()->all(),
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
