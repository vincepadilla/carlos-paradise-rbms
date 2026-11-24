<?php

namespace App\Services;

use App\Services\Algorithms\ProtectedOpportunity;
use App\Services\Algorithms\ReservationIntervalMode;
use App\Services\Algorithms\ReservationIntervalNormalizer;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class OcularVisitScheduling
{
    public function __construct(
        private ReservationIntervalNormalizer $normalizer,
        private ReservationQueueAllocation $queue,
        private ReservationWorkflow $flow,
    ) {}

    /** Use inside the villa lock so concurrent saves cannot claim the same interval. */
    public function validate(array $data, ?int $excludeId = null): void
    {
        $start = CarbonImmutable::parse($data['visit_date'].' '.$data['start_time'], 'Asia/Manila');
        $end = CarbonImmutable::parse($data['visit_date'].' '.$data['end_time'], 'Asia/Manila');
        if ($end->lte($start)) {
            throw ValidationException::withMessages(['end_time' => 'End time must be later than start time.']);
        }
        if ($start->lte($this->flow->now())) {
            throw ValidationException::withMessages(['start_time' => 'The ocular visit must be scheduled in the future.']);
        }
        foreach ($this->intervals($data['visit_date'], $excludeId) as $interval) {
            if ($interval['start'] < $end->timestamp && $interval['end'] > $start->timestamp) {
                throw ValidationException::withMessages(['start_time' => 'This time overlaps '.$interval['label'].'. Choose another start and end time.']);
            }
        }
        if ($this->queue->pendingCandidateIntervals($start, $end)->hasOverlap($start->timestamp, $end->timestamp)) {
            throw ValidationException::withMessages(['start_time' => 'This time overlaps a protected reservation awaiting staff approval. Choose another start and end time.']);
        }
    }

    public function suggest(string $date): ?array
    {
        $start = CarbonImmutable::parse($date.' 10:00', 'Asia/Manila');
        $limit = $start->startOfDay()->addDay();
        $now = $this->flow->now();
        if ($start->lte($now)) {
            $start = $now->startOfMinute()->addMinute();
        }
        $intervals = $this->intervals($date);
        $pending = $this->queue->pendingCandidateIntervals($start, $limit);
        while ($start->addHour()->lt($limit)) {
            $end = $start->addHour();
            foreach ($intervals as $interval) {
                if ($interval['start'] < $end->timestamp && $interval['end'] > $start->timestamp) {
                    $start = CarbonImmutable::createFromTimestamp($interval['end'], 'Asia/Manila')->ceilMinute();
                    continue 2;
                }
            }
            if ($pending->hasOverlap($start->timestamp, $end->timestamp)) {
                $start = $start->addMinute();
                continue;
            }

            return ['start_time' => $start->format('H:i'), 'end_time' => $end->format('H:i')];
        }

        return null;
    }

    private function intervals(string $date, ?int $excludeId = null): array
    {
        $intervals = [];
        $reservations = DB::table('reservations')->where('villa_id', 1)
            ->where(function ($query) {
                $query->whereIn('status', ['confirmed', 'reserved', 'payment_review'])
                    ->orWhere(ProtectedOpportunity::whereUnreleased(...));
            })->get(['starts_at', 'ends_at', 'type']);
        foreach ($reservations as $reservation) {
            $intervals[] = [...$this->normalizer->interval($reservation->starts_at, $reservation->ends_at,
                ReservationIntervalMode::QueueAllocation, $reservation->type, true), 'label' => 'a protected reservation or its cleaning time'];
        }
        foreach (DB::table('availability_blocks')->where('villa_id', 1)->whereNull('released_at')->get() as $block) {
            $intervals[] = [...$this->normalizer->interval($block->starts_on, $block->ends_on,
                ReservationIntervalMode::QueueAllocation), 'label' => 'a blocked calendar period'];
        }
        $visits = DB::table('ocular_visits')->where('villa_id', 1)->where('visit_date', $date)
            ->whereIn('status', ['pending_review', 'approved'])
            ->when($excludeId !== null, fn ($query) => $query->where('id', '!=', $excludeId))->get();
        foreach ($visits as $visit) {
            $intervals[] = [...$this->normalizer->interval($date.' '.$visit->start_time, $date.' '.$visit->end_time,
                ReservationIntervalMode::QueueAllocation), 'label' => 'an existing ocular visit'];
        }
        usort($intervals, fn ($a, $b) => $a['start'] <=> $b['start']);

        return $intervals;
    }
}
