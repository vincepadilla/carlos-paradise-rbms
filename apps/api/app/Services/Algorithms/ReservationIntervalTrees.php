<?php

declare(strict_types=1);

namespace App\Services\Algorithms;

use InvalidArgumentException;

/** Read-only snapshot shared by calendar classification and queue eligibility checks. */
final class ReservationIntervalTrees
{
    public readonly AugmentedIntervalTree $blocked;

    public readonly AugmentedIntervalTree $queue;

    /**
     * @param  array{blocked: list<array{start: int, end: int}>, queue: list<array{start: int, end: int}>}  $intervals
     */
    public function __construct(
        array $intervals,
        public readonly ReservationIntervalMode $mode = ReservationIntervalMode::Current,
        private readonly ReservationIntervalNormalizer $normalizer = new ReservationIntervalNormalizer,
    ) {
        $this->blocked = new AugmentedIntervalTree($intervals['blocked']);
        $this->queue = new AugmentedIntervalTree($intervals['queue']);
    }

    /**
     * Always pass raw proposed boundaries, never a previously protected interval.
     *
     * @return 'blocked'|'queue'|'available'
     */
    public function classify(
        string $start,
        string $end,
        string $type,
        bool $requiresCleaning = false,
    ): string {
        if (! in_array($type, ['overnight', 'day_tour'], true)) {
            throw new InvalidArgumentException('Expected overnight or day_tour proposal type.');
        }
        $interval = $this->normalizer->interval($start, $end, $this->mode, $type, $requiresCleaning);

        return $this->classifyEpoch($interval['start'], $interval['end']);
    }

    /** Query already-normalized half-open boundaries, without applying cleaning again. */
    public function classifyEpoch(int $start, int $end): string
    {
        if ($this->blocked->hasOverlap($start, $end)) {
            return 'blocked';
        }

        return $this->queue->hasOverlap($start, $end) ? 'queue' : 'available';
    }
}
