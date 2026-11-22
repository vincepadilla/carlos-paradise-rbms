<?php

declare(strict_types=1);

namespace App\Services\Algorithms;

use Carbon\CarbonImmutable;
use Closure;
use LogicException;
use Psr\Log\LoggerInterface;
use Throwable;

/** Request-scoped diagnostics only. No result from this service controls availability. */
final class ReservationAvailabilityShadow
{
    private ?ReservationIntervalTrees $trees = null;

    private ?string $treeKey = null;

    private ?string $failedTreeKey = null;

    private ?string $lastSnapshot = null;

    private ?string $snapshotContext = null;

    private array $counts = ['comparisons' => 0, 'matches' => 0, 'mismatches' => 0, 'inconclusive' => 0,
        'errors' => 0, 'build_attempts' => 0, 'builds' => 0, 'log_failures' => 0,
        'snapshot_probes' => 0, 'snapshot_reuses' => 0, 'snapshot_failures' => 0];

    /**
     * The factory must build fresh CURRENT trees from the same connection as the SQL path.
     * It is lazy so disabled/unsupported comparisons never extract records or build trees.
     *
     * @param  Closure(CarbonImmutable): ReservationIntervalTrees  $buildTrees
     */
    public function __construct(
        private readonly bool $enabled,
        private readonly AvailabilitySnapshotReader $snapshots,
        private readonly Closure $buildTrees,
        private readonly LoggerInterface $logger,
    ) {}

    /** @return array<string, mixed>|null */
    public function begin(CarbonImmutable $start, CarbonImmutable $end): ?array
    {
        if (! $this->enabled) {
            return null;
        }

        $started = hrtime(true);
        $observation = ['start' => $start, 'end' => $end, 'as_of' => CarbonImmutable::now('Asia/Manila')->startOfSecond(),
            'snapshot' => null, 'context' => null, 'reason' => null, 'error' => false];
        try {
            if (! $end->gt($start) || $start->format('u') !== '000000' || $end->format('u') !== '000000'
                || $start->format('P') !== '+08:00' || $end->format('P') !== '+08:00') {
                // The legacy block predicate uses the caller's local date and subSecond().
                $observation['reason'] = 'unsupported_input';
            } else {
                $context = $this->snapshots->context();
                if ($context !== null && $context === $this->snapshotContext && $this->lastSnapshot !== null) {
                    // The prior verified snapshot is already a lower bound for this SQL call.
                    // A fresh post-SQL probe must still prove unchanged committed visibility.
                    $observation['snapshot'] = $this->lastSnapshot;
                    $this->counts['snapshot_reuses']++;
                } else {
                    $observation['snapshot'] = $this->readSnapshot();
                }
                $observation['context'] = $this->snapshotContext;
                if ($observation['snapshot'] === null) {
                    $observation['reason'] = 'snapshot_unavailable';
                }
            }
        } catch (Throwable) {
            $this->invalidateSnapshot();
            $this->counts['snapshot_failures']++;
            $observation['reason'] = 'snapshot_error';
            $observation['error'] = true;
        }
        $observation['begin_ms'] = self::milliseconds($started);
        $observation['sql_started'] = hrtime(true);

        return $observation;
    }

    /** The SQL response is observed by value and never returned or modified here. */
    public function observe(?array $observation, string $sqlCategory): void
    {
        if (! $this->enabled || $observation === null) {
            return;
        }

        $started = hrtime(true);
        $this->counts['comparisons']++;
        $event = ['outcome' => 'inconclusive', 'reason' => $observation['reason'],
            'sql' => $sqlCategory, 'tree' => null, 'build_ms' => 0.0, 'query_ms' => 0.0,
            'sql_ms' => ($started - $observation['sql_started']) / 1_000_000];
        try {
            if ($observation['error']) {
                $event['outcome'] = 'inconclusive';
            } elseif ($event['reason'] === null) {
                $this->compare($observation, $event);
            }
        } catch (Throwable) {
            $this->trees = null;
            $this->treeKey = null;
            $event['outcome'] = 'error';
            $event['reason'] = 'evaluation_error';
            // Never log exception messages, SQL bindings, traces, IDs, or proposed dates.
        }

        $counter = match ($event['outcome']) {
            'match' => 'matches', 'mismatch' => 'mismatches', 'error' => 'errors', default => 'inconclusive',
        };
        $this->counts[$counter]++;
        $event['shadow_ms'] = $observation['begin_ms'] + self::milliseconds($started);
        $event['counts'] = $this->counts;
        try {
            $this->logger->log(in_array($event['outcome'], ['error', 'mismatch'], true) || $event['reason'] === 'snapshot_error' ? 'warning' : 'info',
                'reservation_availability_shadow', $event);
        } catch (Throwable) {
            $this->counts['log_failures']++;
        }
    }

    /** Request-local diagnostic counters; never included in customer responses. */
    public function counts(): array
    {
        return $this->counts;
    }

    private function compare(array $observation, array &$event): void
    {
        // The unchanged SQL code samples the opportunity clock itself, at second precision.
        if (! CarbonImmutable::now('Asia/Manila')->startOfSecond()->equalTo($observation['as_of'])) {
            $event['reason'] = 'deadline_clock_changed';

            return;
        }
        $snapshot = $this->verifiedSnapshot($event);
        if ($snapshot === null) {
            return;
        }
        if ($this->snapshotContext !== $observation['context'] || $snapshot !== $observation['snapshot']) {
            $this->trees = null;
            $this->treeKey = null;
            $event['reason'] = 'calendar_snapshot_changed';

            return;
        }

        $key = $observation['snapshot'].':'.$observation['as_of']->getTimestamp();
        if ($this->failedTreeKey === $key) {
            $event['outcome'] = 'error';
            $event['reason'] = 'previous_build_error';

            return;
        }
        if ($this->trees === null || $this->treeKey !== $key) {
            $started = hrtime(true);
            $this->counts['build_attempts']++;
            try {
                $trees = ($this->buildTrees)($observation['as_of']);
                if ($trees->mode !== ReservationIntervalMode::Current) {
                    throw new LogicException('Shadow evaluation requires CURRENT policy.');
                }
            } catch (Throwable $exception) {
                $this->failedTreeKey = $key;
                throw $exception;
            } finally {
                $event['build_ms'] = self::milliseconds($started);
            }
            $this->counts['builds']++;
            $snapshot = $this->verifiedSnapshot($event);
            if ($snapshot === null) {
                return;
            }
            if ($this->snapshotContext !== $observation['context'] || $snapshot !== $observation['snapshot']) {
                $this->trees = null;
                $this->treeKey = null;
                $event['reason'] = 'tree_snapshot_changed';

                return;
            }
            $this->trees = $trees;
            $this->treeKey = $key;
        }

        $started = hrtime(true);
        try {
            $event['tree'] = $this->trees->classifyEpoch($observation['start']->getTimestamp(), $observation['end']->getTimestamp());
        } finally {
            $event['query_ms'] = self::milliseconds($started);
        }
        $event['outcome'] = $event['tree'] === $event['sql'] ? 'match' : 'mismatch';
    }

    private function readSnapshot(): ?string
    {
        $context = $this->snapshots->context();
        if ($context === null) {
            $this->invalidateSnapshot();

            return null;
        }
        $this->counts['snapshot_probes']++;
        $snapshot = $this->snapshots->read();
        if ($snapshot === null || $context !== $this->snapshots->context()) {
            $this->invalidateSnapshot();

            return null;
        }
        $this->lastSnapshot = $snapshot;
        $this->snapshotContext = $context;

        return $snapshot;
    }

    private function verifiedSnapshot(array &$event): ?string
    {
        try {
            $snapshot = $this->readSnapshot();
            if ($snapshot === null) {
                $event['reason'] = 'snapshot_unavailable';
            }

            return $snapshot;
        } catch (Throwable) {
            $this->invalidateSnapshot();
            $this->counts['snapshot_failures']++;
            $event['reason'] = 'snapshot_error';

            return null;
        }
    }

    private function invalidateSnapshot(): void
    {
        $this->trees = null;
        $this->treeKey = null;
        $this->lastSnapshot = null;
        $this->snapshotContext = null;
    }

    private static function milliseconds(int $started): float
    {
        return (hrtime(true) - $started) / 1_000_000;
    }
}
