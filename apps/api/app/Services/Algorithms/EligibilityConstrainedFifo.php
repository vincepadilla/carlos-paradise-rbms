<?php

declare(strict_types=1);

namespace App\Services\Algorithms;

use InvalidArgumentException;

final class EligibilityConstrainedFifo
{
    public function __construct(
        private readonly ReservationIntervalNormalizer $normalizer = new ReservationIntervalNormalizer,
    ) {}

    /**
     * Evaluate a verified release against a snapshot with the released hold removed.
     *
     * @param  iterable<object>  $requests  Reservation rows in any order.
     * @return array{selected_reservation_id: ?int, eligible_candidates: int}
     */
    public function select(
        iterable $requests,
        string $releaseStart,
        string $releaseEnd,
        string $decisionTime,
        ReservationIntervalTrees $protected,
    ): array {
        if ($protected->mode === ReservationIntervalMode::Current) {
            throw new InvalidArgumentException('Queue selection requires the protected calendar for the release policy.');
        }

        $release = $this->normalizer->interval($releaseStart, $releaseEnd, $protected->mode);
        $decision = $this->normalizer->epoch($decisionTime);
        $first = null;
        $eligible = 0;
        $stayTimes = [];

        foreach ($requests as $request) {
            if (! in_array($request->status, ['pending', 'queued'], true)
                || ! in_array($request->type, ['overnight', 'day_tour'], true)) {
                continue;
            }

            try {
                // Waiting guests often request the same check-in and checkout times.
                $start = $stayTimes[$request->starts_at] ??= $this->normalizer->epoch((string) $request->starts_at);
                $end = $stayTimes[$request->ends_at] ??= $this->normalizer->epoch((string) $request->ends_at);
                if ($start >= $end || $decision > $start || $end <= $release['start'] || $start >= $release['end']) {
                    continue;
                }
                $submitted = $this->normalizer->epoch((string) $request->requested_at);
            } catch (InvalidArgumentException) {
                // A malformed waiting request cannot prevent a later guest from qualifying.
                continue;
            }

            // Cleaning affects conflicts with the remaining calendar, never release matching.
            $effectiveEnd = $this->normalizer->effectiveEnd($end, $protected->mode, $request->type, true);
            if ($submitted > $decision || $protected->classifyEpoch($start, $effectiveEnd) !== 'available') {
                continue;
            }

            $eligible++;
            $key = [$submitted, (int) $request->id];
            if ($first === null || $key < $first) {
                $first = $key;
            }
        }

        return ['selected_reservation_id' => $first[1] ?? null, 'eligible_candidates' => $eligible];
    }
}
