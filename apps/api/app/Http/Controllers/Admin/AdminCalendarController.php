<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Services\CalendarSyncState;
use App\Services\ReservationWorkflow;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class AdminCalendarController extends Controller
{
    public function index(Request $request, ReservationWorkflow $flow, CalendarSyncState $sync): JsonResponse
    {
        $data = $request->validate([
            'start' => ['required', 'date_format:Y-m-d'],
            'end' => ['required', 'date_format:Y-m-d', 'after:start'],
        ]);
        $start = CarbonImmutable::parse($data['start'], 'Asia/Manila')->startOfDay();
        $end = CarbonImmutable::parse($data['end'], 'Asia/Manila')->startOfDay();
        if ($start->diffInDays($end) > 62) {
            throw ValidationException::withMessages(['end' => 'Request a calendar range of at most 62 days.']);
        }

        return $flow->locked(function () use ($start, $end, $flow, $sync, $data) {
            $reservations = DB::table('reservations')->where('villa_id', 1)
                ->where('starts_at', '<', $end->toIso8601String())
                ->where('ends_at', '>', $start->toIso8601String())
                ->whereIn('status', ['confirmed', 'reserved', 'completed', 'pending', 'queued', 'awaiting_deposit', 'held', 'payment_review'])
                ->orderBy('starts_at')->orderBy('id')->get()
                ->map(fn ($record) => [
                    ...$flow->present($record),
                    'google_sync' => $sync->record(
                        $record,
                        in_array($record->status, CalendarSyncState::RESERVATION_PUBLISH_STATUSES, true),
                    ),
                ]);

            $blocks = DB::table('availability_blocks')->where('villa_id', 1)->whereNull('released_at')
                ->where('starts_on', '<', $data['end'])->where('ends_on', '>', $data['start'])
                ->orderBy('starts_on')->orderBy('id')
                ->get(['id', 'starts_on', 'ends_on', 'reason', 'updated_at', 'google_event_id', 'google_sync_hash', 'google_synced_at'])
                ->map(fn ($block) => [
                    'id' => $block->id,
                    'starts_on' => $block->starts_on,
                    'ends_on' => $block->ends_on,
                    'reason' => $block->reason,
                    'google_sync' => $sync->record($block, true),
                ]);

            $ocularVisits = DB::table('ocular_visits as ocular')
                ->join('users as creator', 'creator.id', '=', 'ocular.created_by')
                ->where('ocular.villa_id', 1)->where('ocular.status', '!=', 'cancelled')
                ->where('ocular.visit_date', '>=', $data['start'])->where('ocular.visit_date', '<', $data['end'])
                ->orderBy('ocular.visit_date')->orderBy('ocular.start_time')->orderBy('ocular.id')
                ->get([
                    ...AdminOcularVisitsController::columns(),
                    'ocular.google_event_id', 'ocular.google_sync_hash', 'ocular.google_synced_at',
                ])->map(function ($visit) use ($sync) {
                    $data = (array) $visit;
                    unset($data['google_event_id'], $data['google_sync_hash'], $data['google_synced_at']);
                    $data['google_sync'] = $sync->record(
                        $visit,
                        in_array($visit->status, CalendarSyncState::OCULAR_PUBLISH_STATUSES, true),
                    );

                    return $data;
                });

            return response()->json([
                'reservations' => $reservations,
                'blocks' => $blocks,
                'ocular_visits' => $ocularVisits,
                'google_calendar' => $sync->integration(),
            ]);
        });
    }
}
