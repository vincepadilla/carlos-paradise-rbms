<?php

declare(strict_types=1);

namespace App\Services\Algorithms;

use InvalidArgumentException;

/**
 * Immutable index of protected half-open intervals in integer Unix seconds.
 *
 * Construction: O(m log m) comparison sorting, then O(m) balanced construction.
 * Boolean overlap lookup: O(log m). Storage: O(m).
 */
final class AugmentedIntervalTree
{
    private readonly ?AugmentedIntervalTreeNode $root;

    /**
     * @param  list<array{start: int, end: int}>  $intervals
     *
     * @throws InvalidArgumentException
     */
    public function __construct(array $intervals = [])
    {
        if (! array_is_list($intervals)) {
            throw new InvalidArgumentException('Protected intervals must be a list.');
        }

        foreach ($intervals as $index => $interval) {
            if (! is_array($interval)
                || ! isset($interval['start'], $interval['end'])
                || ! is_int($interval['start'])
                || ! is_int($interval['end'])) {
                throw new InvalidArgumentException("Interval at index {$index} must have integer start and end timestamps.");
            }

            self::validateInterval($interval['start'], $interval['end']);
        }

        usort($intervals, static fn (array $a, array $b): int => ($a['start'] <=> $b['start']) ?: ($a['end'] <=> $b['end'])
        );

        $this->root = self::build($intervals, 0, count($intervals));
    }

    /**
     * @throws InvalidArgumentException if start is not strictly before end.
     */
    public function hasOverlap(int $start, int $end): bool
    {
        self::validateInterval($start, $end);
        $node = $this->root;

        while ($node !== null) {
            if ($node->start < $end && $node->end > $start) {
                return true;
            }

            // Equality cannot overlap: a subtree ending at start is adjacent.
            $node = $node->left !== null && $node->left->maxEnd > $start
                ? $node->left
                : $node->right;
        }

        return false;
    }

    private static function validateInterval(int $start, int $end): void
    {
        if ($start >= $end) {
            throw new InvalidArgumentException('Interval start must be strictly before end.');
        }
    }

    /**
     * Build from index bounds without copying array slices at each level.
     *
     * @param  list<array{start: int, end: int}>  $intervals
     */
    private static function build(array $intervals, int $from, int $to): ?AugmentedIntervalTreeNode
    {
        if ($from >= $to) {
            return null;
        }

        $middle = $from + intdiv($to - $from, 2);

        return new AugmentedIntervalTreeNode(
            $intervals[$middle]['start'],
            $intervals[$middle]['end'],
            self::build($intervals, $from, $middle),
            self::build($intervals, $middle + 1, $to),
        );
    }
}
