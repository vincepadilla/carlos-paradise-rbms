<?php

namespace App\Services;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class ReservationAvailability
{
    /** @return array{availability: 'available'|'queue'|'blocked', queue_position: int|null} */
    public function forInterval(CarbonImmutable $start, CarbonImmutable $end): array
    {
        // Half-open comparisons permit checkout/check-in turnover at the same time.
        $overlapping = DB::table('reservations')->where('villa_id', 1)
            ->where('starts_at', '<', $end->toIso8601String())->where('ends_at', '>', $start->toIso8601String());
        $confirmed = (clone $overlapping)->whereIn('status', ['confirmed', 'reserved'])->exists();
        // An unpaid hold only counts when its opportunity is actually active.
        $opportunity = (clone $overlapping)->where(function ($query) {
            $query->where('status', 'payment_review')->orWhere(function ($held) {
                $held->whereIn('status', ['held', 'awaiting_deposit'])->whereExists(function ($active) {
                    $active->selectRaw('1')->from('reservation_opportunities as opportunity')
                        ->whereColumn('opportunity.reservation_id', 'reservations.id')->where('opportunity.status', 'active')
                        ->where('opportunity.deposit_deadline', '>', CarbonImmutable::now('Asia/Manila')->toIso8601String());
                });
            });
        })->exists();
        $blocked = Schema::hasTable('availability_blocks') && DB::table('availability_blocks')
            ->where('villa_id', 1)->whereNull('released_at')->where('starts_on', '<=', $end->subSecond()->toDateString())
            ->where('ends_on', '>', $start->toDateString())->exists();
        $category = match (true) {
            $confirmed || $blocked => 'blocked', $opportunity => 'queue', default => 'available'
        };
        $position = null;
        if ($category === 'queue') {
            $position = (clone $overlapping)->where(function ($query) {
                $query->whereIn('status', ['pending', 'queued', 'payment_review'])->orWhere(function ($held) {
                    $held->whereIn('status', ['held', 'awaiting_deposit'])->whereExists(function ($active) {
                        $active->selectRaw('1')->from('reservation_opportunities as opportunity')
                            ->whereColumn('opportunity.reservation_id', 'reservations.id')->where('opportunity.status', 'active')
                            ->where('opportunity.deposit_deadline', '>', CarbonImmutable::now('Asia/Manila')->toIso8601String());
                    });
                });
            })->count() + 1;
        }

        return ['availability' => $category, 'queue_position' => $position];
    }
}
