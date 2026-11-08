<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Services\ReservationWorkflow;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class AdminCalendarController extends Controller
{
    public function index(Request $request, ReservationWorkflow $flow): JsonResponse
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

        return $flow->locked(function () use ($start, $end, $flow, $data) {
            $reservations = DB::table('reservations')->where('villa_id', 1)
                ->where('starts_at', '<', $end->toIso8601String())
                ->where('ends_at', '>', $start->toIso8601String())
                ->whereIn('status', ['confirmed', 'reserved', 'completed', 'pending', 'queued', 'awaiting_deposit', 'held', 'payment_review'])
                ->orderBy('starts_at')->orderBy('id')->get()
                ->map(fn ($record) => $flow->present($record));

            $blocks = DB::table('availability_blocks')->where('villa_id', 1)->whereNull('released_at')
                ->where('starts_on', '<', $data['end'])->where('ends_on', '>', $data['start'])
                ->orderBy('starts_on')->orderBy('id')->get(['id', 'starts_on', 'ends_on', 'reason']);

            $ocularVisits = DB::table('ocular_visits as ocular')
                ->join('users as creator', 'creator.id', '=', 'ocular.created_by')
                ->where('ocular.villa_id', 1)->where('ocular.status', '!=', 'cancelled')
                ->where('ocular.visit_date', '>=', $data['start'])->where('ocular.visit_date', '<', $data['end'])
                ->orderBy('ocular.visit_date')->orderBy('ocular.start_time')->orderBy('ocular.id')
                ->get(AdminOcularVisitsController::columns());

            return response()->json(['reservations' => $reservations, 'blocks' => $blocks, 'ocular_visits' => $ocularVisits]);
        });
    }
}
