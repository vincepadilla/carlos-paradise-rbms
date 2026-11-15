<?php

namespace App\Services;

use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

class OcularVisitReport
{
    public const DATE_RANGES = ['all', 'this_month', 'last_month', 'this_year', 'custom'];
    public const STATUSES = ['pending_review', 'approved', 'cancelled'];

    public function filters(array $data): array
    {
        $range = $data['date_range'] ?? 'this_month';
        $today = CarbonImmutable::now('Asia/Manila');
        $start = $end = null;
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
            'start_date' => $start?->toDateString(),
            'end_date' => $end?->toDateString(),
            'date_label' => $range === 'all' ? 'All Dates' : sprintf(
                '%s - %s',
                $start?->format('M j, Y'),
                $end?->format('M j, Y')
            ),
        ];
    }

    public function query(array $filters): Builder
    {
        $query = DB::table('ocular_visits as ocular')
            ->join('users as staff', 'staff.id', '=', 'ocular.created_by')
            ->where('ocular.villa_id', 1)
            ->select([
                'ocular.id', 'ocular.guest_name', 'ocular.contact_details', 'ocular.visit_date',
                'ocular.start_time', 'ocular.end_time', 'ocular.status', 'ocular.created_by',
                'staff.name as assigned_staff',
            ]);

        if ($filters['search'] !== '') {
            $pattern = '%'.$filters['search'].'%';
            $referenceId = preg_match('/^(?:OV-0*|0*)(\d+)$/i', $filters['search'], $match) ? (int) $match[1] : null;
            $query->where(function (Builder $search) use ($pattern, $referenceId) {
                $search->whereLike('ocular.guest_name', $pattern, caseSensitive: false)
                    ->orWhereLike('ocular.contact_details', $pattern, caseSensitive: false)
                    ->orWhereLike('staff.name', $pattern, caseSensitive: false);
                if ($referenceId) $search->orWhere('ocular.id', $referenceId);
            });
        }
        if ($filters['status'] !== '') $query->where('ocular.status', $filters['status']);
        if ($filters['start_date']) $query->whereDate('ocular.visit_date', '>=', $filters['start_date']);
        if ($filters['end_date']) $query->whereDate('ocular.visit_date', '<=', $filters['end_date']);
        if ($filters['period'] !== '') {
            $operator = strlen($filters['period']) === 7 ? 'like' : '=';
            $query->where('ocular.visit_date', $operator, $filters['period'].($operator === 'like' ? '%' : ''));
        }

        return $query->orderByDesc('ocular.visit_date')->orderByDesc('ocular.start_time')->orderByDesc('ocular.id');
    }

    public function present(Collection $records): Collection
    {
        return $records->map(fn ($record) => [
            'id' => (int) $record->id,
            'visit_reference' => 'OV-'.str_pad((string) $record->id, 6, '0', STR_PAD_LEFT),
            'visitor_name' => $record->guest_name,
            'visit_date' => $record->visit_date,
            'start_time' => $record->start_time,
            'end_time' => $record->end_time,
            'status' => $record->status,
            'assigned_staff' => $record->assigned_staff,
        ]);
    }

    public function analytics(array $filters): array
    {
        $records = $this->query([...$filters, 'status' => '', 'period' => ''])->get();
        $daily = $filters['start_date'] && $filters['end_date']
            && CarbonImmutable::parse($filters['start_date'])->diffInDays(CarbonImmutable::parse($filters['end_date'])) <= 31;

        return [
            'scope_label' => 'Base search and ocular visit date scope',
            'cards' => [
                ['key' => 'all_visits', 'label' => 'Total Visits', 'value' => $records->count(), 'filter_field' => 'status', 'filter_value' => ''],
                ['key' => 'pending_visits', 'label' => 'Pending Review', 'value' => $records->where('status', 'pending_review')->count(), 'filter_field' => 'status', 'filter_value' => 'pending_review'],
                ['key' => 'approved_visits', 'label' => 'Approved Visits', 'value' => $records->where('status', 'approved')->count(), 'filter_field' => 'status', 'filter_value' => 'approved'],
                ['key' => 'cancelled_visits', 'label' => 'Cancelled Visits', 'value' => $records->where('status', 'cancelled')->count(), 'filter_field' => 'status', 'filter_value' => 'cancelled'],
            ],
            'status' => collect(self::STATUSES)->map(fn ($status) => [
                'key' => $status,
                'label' => ucwords(str_replace('_', ' ', $status)),
                'value' => $records->where('status', $status)->count(),
            ])->all(),
            'trend' => $records->groupBy(fn ($record) => CarbonImmutable::parse($record->visit_date, 'Asia/Manila')->format($daily ? 'Y-m-d' : 'Y-m'))
                ->map(fn ($items, $key) => [
                    'key' => $key,
                    'label' => CarbonImmutable::parse($key.($daily ? '' : '-01'))->format($daily ? 'M j' : 'M Y'),
                    'value' => $items->count(),
                ])->sortBy('key')->values()->all(),
        ];
    }
}
