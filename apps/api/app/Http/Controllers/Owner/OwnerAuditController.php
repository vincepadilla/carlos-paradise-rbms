<?php

namespace App\Http\Controllers\Owner;

use App\Http\Controllers\Controller;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class OwnerAuditController extends Controller
{
    public function index(Request $request)
    {
        $data = $request->validate([
            'search' => ['nullable', 'string', 'max:200'], 'date' => ['nullable', 'date_format:Y-m-d'],
            'module' => ['nullable', 'string', 'max:60'], 'action' => ['nullable', 'string', 'max:80'],
        ]);
        $events = DB::table('audit_events')->select('id', 'occurred_at', 'user_name', 'role', 'action', 'module', 'details')
            ->selectRaw("'audit' as source");
        $history = DB::table('reservation_status_history as h')
            ->leftJoin('users as u', 'u.id', '=', 'h.changed_by')->leftJoin('roles as r', 'r.id', '=', 'u.role_id')
            ->selectRaw("h.id, h.changed_at as occurred_at, coalesce(u.name, 'System') as user_name,
                coalesce(r.name, 'system') as role, coalesce(h.event, 'status_changed') as action,
                'Reservations' as module, h.reason as details, 'reservation_history' as source");
        $union = $events->unionAll($history);
        $all = DB::query()->fromSub($union, 'entries');
        $modules = (clone $all)->distinct()->orderBy('module')->pluck('module');
        $actions = (clone $all)->distinct()->orderBy('action')->pluck('action');
        $search = trim($data['search'] ?? '');
        $all->when($search !== '', fn ($q) => $q->where(function ($q) use ($search) {
            foreach (['user_name', 'role', 'action', 'module', 'details'] as $field) {
                $q->orWhereRaw('lower('.$field.') like ?', ['%'.strtolower($search).'%']);
            }
        }));
        if (!empty($data['date'])) {
            if (DB::getDriverName() === 'pgsql') {
                $all->whereRaw("(occurred_at AT TIME ZONE 'Asia/Manila')::date = ?", [$data['date']]);
            } elseif (DB::getDriverName() === 'sqlite') {
                $all->whereRaw("date(occurred_at, '+8 hours') = ?", [$data['date']]);
            } else {
                $day = CarbonImmutable::parse($data['date'], 'Asia/Manila');
                $all->where('occurred_at', '>=', $day->utc())->where('occurred_at', '<', $day->addDay()->utc());
            }
        }
        foreach (['module', 'action'] as $filter) if (!empty($data[$filter])) $all->where($filter, $data[$filter]);
        $page = $all->orderByDesc('occurred_at')->orderByDesc('id')->orderBy('source')->paginate(5);
        $page->through(function ($entry) {
            $entry->occurred_at = CarbonImmutable::parse($entry->occurred_at)->setTimezone('Asia/Manila')->toIso8601String();
            return $entry;
        });
        return response()->json([...$page->toArray(), 'filters' => ['modules' => $modules, 'actions' => $actions],
            'integrity' => 'Standard application history; cryptographic audit chaining is not implemented.']);
    }
}
