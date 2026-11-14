<?php

namespace App\Services;

use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

class QueueReport
{
    public const STATUSES = ['queued', 'awaiting_deposit', 'payment_review', 'confirmed', 'expired', 'cancelled', 'rejected'];

    public function filters(array $data): array
    {
        $range = $data['date_range'] ?? 'this_month';
        $today = CarbonImmutable::now('Asia/Manila');
        $start = $end = null;
        if ($range === 'this_month') { $start = $today->startOfMonth(); $end = $today->endOfMonth(); }
        elseif ($range === 'last_month') { $month = $today->subMonthNoOverflow(); $start = $month->startOfMonth(); $end = $month->endOfMonth(); }
        elseif ($range === 'this_year') { $start = $today->startOfYear(); $end = $today->endOfYear(); }
        elseif ($range === 'custom') {
            $start = CarbonImmutable::createFromFormat('!Y-m-d', $data['start_date'], 'Asia/Manila');
            $end = CarbonImmutable::createFromFormat('!Y-m-d', $data['end_date'], 'Asia/Manila');
        }
        return [
            'search' => trim($data['search'] ?? ''), 'date_range' => $range,
            'status' => $data['status'] ?? '', 'start_date' => $start?->toDateString(),
            'period' => $data['period'] ?? '',
            'category' => $data['category'] ?? '',
            'end_date' => $end?->toDateString(),
            'date_label' => $range === 'all' ? 'All Dates' : ($start?->format('M j, Y').' – '.$end?->format('M j, Y')),
        ];
    }

    public function query(array $filters): Builder
    {
        $eventSql = 'COALESCE((SELECT MAX(changed_at) FROM reservation_status_history WHERE reservation_id = reservation.id), reservation.requested_at)';
        $eventDate = DB::raw($eventSql);
        $query = DB::table('reservations as reservation')->where('reservation.villa_id', 1)
            ->where(function (Builder $queue) {
                $queue->where('reservation.status', 'queued')->orWhereExists(function (Builder $history) {
                    $history->selectRaw('1')->from('reservation_status_history as queued_history')
                        ->whereColumn('queued_history.reservation_id', 'reservation.id')
                        ->where(function (Builder $status) {
                            $status->where('queued_history.to_status', 'queued')->orWhere('queued_history.from_status', 'queued');
                        });
                });
            })
            ->select([
                'reservation.id', 'reservation.booking_reference', 'reservation.check_in_date',
                'reservation.check_out_date', 'reservation.status', 'reservation.requested_at',
                'reservation.deadline',
            ])->selectRaw('CASE WHEN reservation.status = ? THEN (SELECT COUNT(*) + 1 FROM reservations earlier WHERE earlier.villa_id = reservation.villa_id AND earlier.status = ? AND earlier.requested_at < reservation.requested_at AND earlier.starts_at < reservation.ends_at AND earlier.ends_at > reservation.starts_at) ELSE NULL END as queue_position', ['queued', 'queued'])
            ->selectSub(DB::table('reservation_opportunities as opportunity')
                ->select('opportunity.deposit_deadline')->whereColumn('opportunity.reservation_id', 'reservation.id')
                ->orderByDesc('opportunity.id')->limit(1), 'opportunity_deadline')
            ->selectRaw('COALESCE((SELECT MAX(changed_at) FROM reservation_status_history WHERE reservation_id = reservation.id), reservation.requested_at) as event_date');
        if ($filters['search'] !== '') {
            $pattern = '%'.$filters['search'].'%';
            $query->whereLike('reservation.booking_reference', $pattern, caseSensitive: false);
        }
        if ($filters['status'] !== '') $query->where('reservation.status', $filters['status']);
        if (($filters['category'] ?? '') === 'waiting') {
            $query->where('reservation.status', 'queued');
        } elseif (($filters['category'] ?? '') === 'moved_from_queue') {
            $query->where('reservation.status', '<>', 'queued');
        } elseif (in_array(($filters['category'] ?? ''), ['active_opportunities', 'expired_opportunities'], true)) {
            $opportunityStatus = $filters['category'] === 'active_opportunities' ? 'active' : 'expired';
            $query->whereExists(function (Builder $opportunity) use ($opportunityStatus) {
                $opportunity->selectRaw('1')->from('reservation_opportunities as filtered_opportunity')
                    ->whereColumn('filtered_opportunity.reservation_id', 'reservation.id')
                    ->where('filtered_opportunity.status', $opportunityStatus);
            });
        }
        if ($filters['start_date'] !== null) $query->whereDate($eventDate, '>=', $filters['start_date']);
        if ($filters['end_date'] !== null) $query->whereDate($eventDate, '<=', $filters['end_date']);
        if (($filters['period'] ?? '') !== '') {
            $query->whereRaw((strlen($filters['period']) === 7 ? 'CAST('.$eventSql.' AS TEXT) LIKE ?' : 'DATE('.$eventSql.') = ?'), [strlen($filters['period']) === 7 ? $filters['period'].'%' : $filters['period']]);
        }
        return $query->orderByDesc($eventDate)->orderByDesc('reservation.id');
    }

    public function present(Collection $records): Collection
    {
        return $records->map(fn ($record) => [
            'id' => (int) $record->id, 'booking_reference' => $record->booking_reference,
            'check_in_date' => $record->check_in_date, 'check_out_date' => $record->check_out_date,
            'queue_position' => $record->queue_position === null ? null : (int) $record->queue_position,
            'status' => $record->status, 'event_date' => CarbonImmutable::parse($record->event_date)->setTimezone('Asia/Manila')->toIso8601String(),
            'deadline' => $record->opportunity_deadline ?: $record->deadline,
        ]);
    }

    public function analytics(array $filters): array
    {
        $base = [...$filters, 'status' => '', 'period' => '', 'category' => ''];
        $records = $this->query($base)->get();
        $daily = $filters['start_date'] && $filters['end_date']
            && CarbonImmutable::parse($filters['start_date'])->diffInDays(CarbonImmutable::parse($filters['end_date'])) <= 31;
        return [
            'scope_label' => 'Base search and queue event date scope',
            'cards' => [
                ['key' => 'waiting', 'label' => 'Waiting Requests', 'value' => $records->where('status', 'queued')->count(), 'filter_field' => 'category', 'filter_value' => 'waiting'],
                ['key' => 'active_opportunities', 'label' => 'Active Reservation Opportunities', 'value' => $this->query([...$base, 'category' => 'active_opportunities'])->reorder()->count('reservation.id'), 'filter_field' => 'category', 'filter_value' => 'active_opportunities'],
                ['key' => 'moved_from_queue', 'label' => 'Requests Moved from Queue', 'value' => $records->where('status', '<>', 'queued')->count(), 'filter_field' => 'category', 'filter_value' => 'moved_from_queue'],
                ['key' => 'expired_opportunities', 'label' => 'Expired Reservation Opportunities', 'value' => $this->query([...$base, 'category' => 'expired_opportunities'])->reorder()->count('reservation.id'), 'filter_field' => 'category', 'filter_value' => 'expired_opportunities'],
            ],
            'status' => $records->groupBy('status')->map->count()->map(fn ($value, $key) => [
                'key' => $key, 'label' => ucwords(str_replace('_', ' ', $key)), 'value' => $value,
            ])->values()->all(),
            'trend' => $records->groupBy(fn ($record) => CarbonImmutable::parse($record->event_date)->setTimezone('Asia/Manila')->format($daily ? 'Y-m-d' : 'Y-m'))
                ->map(fn ($items, $key) => [
                    'key' => $key, 'label' => CarbonImmutable::parse($key.($daily ? '' : '-01'))->format($daily ? 'M j' : 'M Y'),
                    'value' => $items->count(),
                ])->sortBy('key')->values()->all(),
        ];
    }
}
