<?php

namespace App\Services;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Collection;

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

    /** Count individually available overnight dates using the same commitment, opportunity, and block rules. */
    public function availableNights(CarbonImmutable $startDate, CarbonImmutable $endDate): int
    {
        if ($endDate->lt($startDate)) return 0;

        $rangeStart = $startDate->startOfDay()->addHours(14);
        $rangeEnd = $endDate->addDay()->startOfDay()->addHours(12);
        $now = CarbonImmutable::now('Asia/Manila')->toIso8601String();
        $commitments = DB::table('reservations')->where('villa_id', 1)
            ->where('starts_at', '<', $rangeEnd->toIso8601String())
            ->where('ends_at', '>', $rangeStart->toIso8601String())
            ->where(function ($query) use ($now) {
                $query->whereIn('status', ['confirmed', 'reserved'])
                    ->orWhere('status', 'payment_review')
                    ->orWhere(function ($held) use ($now) {
                        $held->whereIn('status', ['held', 'awaiting_deposit'])
                            ->whereExists(function ($active) use ($now) {
                                $active->selectRaw('1')->from('reservation_opportunities as opportunity')
                                    ->whereColumn('opportunity.reservation_id', 'reservations.id')
                                    ->where('opportunity.status', 'active')
                                    ->where('opportunity.deposit_deadline', '>', $now);
                            });
                    });
            })->get(['starts_at', 'ends_at']);
        $blocks = Schema::hasTable('availability_blocks')
            ? DB::table('availability_blocks')->where('villa_id', 1)->whereNull('released_at')
                ->where('starts_on', '<=', $endDate->toDateString())
                ->where('ends_on', '>', $startDate->toDateString())->get(['starts_on', 'ends_on'])
            : collect();

        $available = 0;
        for ($date = $startDate->startOfDay(); $date->lte($endDate); $date = $date->addDay()) {
            $start = $date->addHours(14);
            $end = $date->addDay()->addHours(12);
            if (! $this->overlapsCommitment($commitments, $start, $end)
                && ! $blocks->contains(fn ($block) => $block->starts_on <= $date->toDateString() && $block->ends_on > $date->toDateString())) {
                $available++;
            }
        }

        return $available;
    }

    private function overlapsCommitment(Collection $commitments, CarbonImmutable $start, CarbonImmutable $end): bool
    {
        return $commitments->contains(fn ($record) =>
            CarbonImmutable::parse($record->starts_at)->lt($end)
            && CarbonImmutable::parse($record->ends_at)->gt($start)
        );
    }
}
