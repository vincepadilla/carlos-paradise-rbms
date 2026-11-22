<?php

declare(strict_types=1);

namespace App\Services;

use App\Services\Algorithms\AvailabilitySnapshotReader;
use App\Services\Algorithms\ReservationIntervalMode;
use App\Services\Algorithms\ReservationIntervalTrees;
use Carbon\CarbonImmutable;
use Closure;
use LogicException;
use Psr\Log\LoggerInterface;
use Throwable;

/** Optional read-only calendar engine. Never used to authorize a reservation write. */
final class CalendarAvailability
{
    /** @param Closure(CarbonImmutable, CarbonImmutable, CarbonImmutable): ReservationIntervalTrees $buildTrees */
    public function __construct(
        private readonly AvailabilitySnapshotReader $snapshots,
        private readonly Closure $buildTrees,
        private readonly LoggerInterface $logger,
    ) {}

    /**
     * @param  array<string, array{start: CarbonImmutable, end: CarbonImmutable}>  $intervals
     * @param  Closure(): array<string, string>  $sqlFallback
     * @return array<string, 'blocked'|'queue'|'available'>
     */
    public function classify(array $intervals, Closure $sqlFallback): array
    {
        try {
            $asOf = CarbonImmutable::now('Asia/Manila')->startOfSecond();
            $start = null;
            $end = null;
            foreach ($intervals as $interval) {
                foreach (['start', 'end'] as $boundary) {
                    if (! (($interval[$boundary] ?? null) instanceof CarbonImmutable)
                        || $interval[$boundary]->format('u') !== '000000' || $interval[$boundary]->format('P') !== '+08:00') {
                        throw new LogicException('Unsupported calendar boundaries.');
                    }
                }
                if (! $interval['end']->gt($interval['start'])) {
                    throw new LogicException('Invalid calendar interval.');
                }
                $start = $start === null || $interval['start']->lt($start) ? $interval['start'] : $start;
                $end = $end === null || $interval['end']->gt($end) ? $interval['end'] : $end;
            }
            if ($start === null || $end === null) {
                return [];
            }
            $context = $this->snapshots->context();
            $before = $context === null ? null : $this->snapshots->read();
            if ($before === null || $context !== $this->snapshots->context()) {
                throw new LogicException('Calendar snapshot unavailable.');
            }
            $trees = ($this->buildTrees)($start, $end, $asOf);
            if ($trees->mode !== ReservationIntervalMode::Current) {
                throw new LogicException('Calendar engine requires CURRENT policy.');
            }
            $dates = [];
            foreach ($intervals as $key => $interval) {
                $dates[$key] = $trees->classifyEpoch($interval['start']->getTimestamp(), $interval['end']->getTimestamp());
            }
            // One bound around the entire batch: a changed state or deadline second
            // discards every tree result before any response is sent to the customer.
            if ($before !== $this->snapshots->read() || $context !== $this->snapshots->context()
                || ! $asOf->equalTo(CarbonImmutable::now('Asia/Manila')->startOfSecond())) {
                throw new LogicException('Calendar snapshot or deadline clock changed.');
            }

            return $dates;
        } catch (Throwable) {
            try {
                $this->logger->notice('calendar_tree_sql_fallback', ['reason' => 'tree_unavailable_or_unreliable']);
            } catch (Throwable) {
                // Logging must never prevent the SQL fallback.
            }
        }

        return $sqlFallback();
    }
}
