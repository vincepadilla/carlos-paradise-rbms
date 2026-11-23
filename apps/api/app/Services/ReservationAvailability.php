<?php

namespace App\Services;

use App\Services\Algorithms\ProtectedOpportunity;
use App\Services\Algorithms\ReservationAvailabilityShadow;
use App\Services\Algorithms\ReservationIntervalNormalizer;
use Carbon\CarbonImmutable;
use Closure;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Throwable;

class ReservationAvailability
{
    public function __construct(
        private readonly ?ReservationAvailabilityShadow $shadow = null,
        private readonly ?Closure $calendar = null,
        private readonly ?ReservationQueueAllocation $queueAllocation = null,
    ) {}

    /**
     * Calendar endpoint only. Quotes and all writes continue to use their existing SQL paths.
     *
     * @param  array<string, array{start: CarbonImmutable, end: CarbonImmutable}>  $intervals
     * @return array<string, 'blocked'|'queue'|'available'>
     */
    public function forCalendar(array $intervals, ?string $stayType = null): array
    {
        $dates = $this->calendarClassifications($intervals);
        if ($this->queueAllocation === null || $stayType === null || ! in_array('available', $dates, true)) {
            return $dates;
        }

        $pending = $this->queueAllocation->pendingCandidateIntervals(
            min(array_column($intervals, 'start')),
            ReservationIntervalNormalizer::queueCalendarEnd(max(array_column($intervals, 'end')), $stayType)
        );
        foreach ($intervals as $key => $interval) {
            $end = ReservationIntervalNormalizer::queueCalendarEnd($interval['end'], $stayType);
            if ($dates[$key] === 'available' && $pending->hasOverlap($interval['start']->timestamp, $end->timestamp)) {
                $dates[$key] = 'queue';
            }
        }

        return $dates;
    }

    private function calendarClassifications(array $intervals): array
    {
        $sql = function () use ($intervals): array {
            $dates = [];
            foreach ($intervals as $key => $interval) {
                $dates[$key] = $this->forInterval($interval['start'], $interval['end'])['availability'];
            }

            return $dates;
        };
        if ($this->calendar !== null && $intervals !== []) {
            try {
                $calendar = ($this->calendar)();
            } catch (Throwable) {
                // Includes optional engine initialization failure; original SQL still decides.
                return $sql();
            }
            if ($calendar instanceof CalendarAvailability) {
                return $calendar->classify($intervals, $sql);
            }
        }

        return $sql();
    }

    /** @return array{availability: 'available'|'queue'|'blocked', queue_position: int|null} */
    public function forInterval(CarbonImmutable $start, CarbonImmutable $end, ?string $stayType = null): array
    {
        $observation = $this->shadow?->begin($start, $end);

        // Half-open comparisons permit checkout/check-in turnover at the same time.
        $overlapping = DB::table('reservations')->where('villa_id', 1)
            ->where('starts_at', '<', $end->toIso8601String())->where('ends_at', '>', $start->toIso8601String());
        $confirmed = (clone $overlapping)->whereIn('status', ['confirmed', 'reserved'])->exists();
        $opportunity = (clone $overlapping)->where(function ($query) {
            $query->where('status', 'payment_review')->orWhere(ProtectedOpportunity::whereUnreleased(...));
        })->exists();
        $blocked = Schema::hasTable('availability_blocks') && DB::table('availability_blocks')
            ->where('villa_id', 1)->whereNull('released_at')->where('starts_on', '<=', $end->subSecond()->toDateString())
            ->where('ends_on', '>', $start->toDateString())->exists();
        $category = match (true) {
            $confirmed || $blocked => 'blocked', $opportunity => 'queue', default => 'available'
        };
        $this->shadow?->observe($observation, $category);
        if ($category === 'available' && $stayType !== null && $this->queueAllocation !== null) {
            $effectiveEnd = ReservationIntervalNormalizer::queueCalendarEnd($end, $stayType);
            $pending = $this->queueAllocation->pendingCandidateIntervals($start, $effectiveEnd);
            if ($pending->hasOverlap($start->timestamp, $effectiveEnd->timestamp)) {
                $category = 'queue';
            }
        }
        $position = null;
        if ($category === 'queue') {
            $position = (clone $overlapping)->where(function ($query) {
                $query->whereIn('status', ['pending', 'queued', 'payment_review'])
                    ->orWhere(ProtectedOpportunity::whereUnreleased(...));
            })->count() + 1;
        }

        return ['availability' => $category, 'queue_position' => $position];
    }

    /** Count individually available overnight dates using the same commitment, opportunity, and block rules. */
    public function availableNights(CarbonImmutable $startDate, CarbonImmutable $endDate): int
    {
        if ($endDate->lt($startDate)) {
            return 0;
        }

        $rangeStart = $startDate->startOfDay()->addHours(14);
        $rangeEnd = $endDate->addDay()->startOfDay()->addHours(12);
        $commitments = DB::table('reservations')->where('villa_id', 1)
            ->where('starts_at', '<', $rangeEnd->toIso8601String())
            ->where('ends_at', '>', $rangeStart->toIso8601String())
            ->where(function ($query) {
                $query->whereIn('status', ['confirmed', 'reserved', 'payment_review'])
                    ->orWhere(ProtectedOpportunity::whereUnreleased(...));
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
        return $commitments->contains(fn ($record) => CarbonImmutable::parse($record->starts_at)->lt($end)
            && CarbonImmutable::parse($record->ends_at)->gt($start)
        );
    }
}
