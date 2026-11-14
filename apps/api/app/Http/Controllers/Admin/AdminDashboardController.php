<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Services\ReservationWorkflow;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

class AdminDashboardController extends Controller
{
    public function summary(ReservationWorkflow $flow): JsonResponse
    {
        return $flow->locked(function () use ($flow): JsonResponse {
            $now = CarbonImmutable::now('Asia/Manila');
            $reservations = DB::table('reservations')->where('villa_id', 1);
            $totalReservations = (clone $reservations)->count();
            $statusCounts = (clone $reservations)
                ->select('status', DB::raw('COUNT(*) as aggregate'))
                ->whereNotNull('status')
                ->groupBy('status')
                ->orderBy('status')
                ->get();
            $months = collect(range(1, 12))->mapWithKeys(fn (int $month): array => [
                $now->startOfYear()->addMonths($month - 1)->format('Y-m') => 0,
            ]);
            (clone $reservations)
                ->whereBetween('check_in_date', [$now->startOfYear()->toDateString(), $now->endOfYear()->toDateString()])
                ->pluck('check_in_date')
                ->each(function ($date) use ($months): void {
                    $key = CarbonImmutable::parse($date, 'Asia/Manila')->format('Y-m');
                    $months->put($key, ((int) $months->get($key, 0)) + 1);
                });

            $ongoingRecord = (clone $reservations)
                ->where('status', 'confirmed')
                ->where('starts_at', '<=', $now)
                ->where('ends_at', '>', $now)
                ->orderBy('starts_at')
                ->orderBy('id')
                ->first();
            $movements = (clone $reservations)
                ->where('status', 'confirmed')
                ->where('ends_at', '>', $now)
                ->get(['id', 'starts_at', 'ends_at'])
                ->flatMap(function ($reservation) use ($now): array {
                    $items = [];
                    $start = CarbonImmutable::parse($reservation->starts_at, 'Asia/Manila');
                    $end = CarbonImmutable::parse($reservation->ends_at, 'Asia/Manila');
                    if ($start->greaterThan($now)) {
                        $items[] = ['id' => $reservation->id, 'at' => $start, 'kind' => 'Check-in'];
                    }
                    if ($end->greaterThan($now)) {
                        $items[] = ['id' => $reservation->id, 'at' => $end, 'kind' => 'Check-out'];
                    }

                    return $items;
                })
                ->sortBy(fn (array $movement): string => $movement['at']->format('U.u').($movement['kind'] === 'Check-out' ? '0' : '1'))
                ->first();

            return response()->json([
                'total_reservations' => $totalReservations,
                'total_guests' => DB::table('users as u')
                    ->join('roles as role', 'role.id', '=', 'u.role_id')
                    ->where('role.name', 'guest')
                    ->distinct()
                    ->count('u.id'),
                'payments_to_review' => DB::table('payments as payment')
                    ->join('reservations as reservation', 'reservation.id', '=', 'payment.reservation_id')
                    ->where('reservation.villa_id', 1)
                    ->where('reservation.status', 'payment_review')
                    ->where('payment.payment_kind', 'deposit')
                    ->where('payment.status', 'submitted')
                    ->count('payment.id'),
                'waiting_requests' => DB::table('reservations')
                    ->where('villa_id', 1)
                    ->where('status', 'queued')
                    ->count(),
                'reservation_statuses' => $statusCounts->map(fn ($item): array => [
                    'key' => $item->status,
                    'count' => (int) $item->aggregate,
                    'percentage' => $totalReservations > 0 ? round(((int) $item->aggregate / $totalReservations) * 100, 1) : 0,
                ])->values(),
                'reservations_per_month' => $months->map(fn (int $count, string $month): array => [
                    'month' => $month,
                    'count' => $count,
                ])->values(),
                'status_period_label' => 'All reservation records as of '.$now->format('M j, Y g:i A').' (Asia/Manila)',
                'monthly_period_label' => $now->year.' check-in dates (Asia/Manila)',
                'ongoing_reservation' => $ongoingRecord ? $flow->present($ongoingRecord) : null,
                'upcoming_movement' => $movements ? [
                    'reservation' => $flow->present($flow->reservation((int) $movements['id'])),
                    'at' => $movements['at']->toIso8601String(),
                    'kind' => $movements['kind'],
                ] : null,
                'generated_at' => $now->toIso8601String(),
            ]);
        });
    }
}
