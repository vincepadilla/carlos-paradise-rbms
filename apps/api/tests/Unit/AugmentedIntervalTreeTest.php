<?php

declare(strict_types=1);

namespace Tests\Unit;

use App\Services\Algorithms\AugmentedIntervalTree;
use App\Services\Algorithms\AugmentedIntervalTreeNode;
use InvalidArgumentException;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Random\Engine\Mt19937;
use Random\Randomizer;
use ReflectionProperty;
use TypeError;

final class AugmentedIntervalTreeTest extends TestCase
{
    public function test_empty_tree_has_no_overlap(): void
    {
        $this->assertFalse((new AugmentedIntervalTree)->hasOverlap(10, 20));
    }

    #[DataProvider('overlapCases')]
    public function test_half_open_overlap_rules(array $intervals, int $start, int $end, bool $expected): void
    {
        $this->assertSame($expected, (new AugmentedIntervalTree($intervals))->hasOverlap($start, $end));
    }

    public static function overlapCases(): iterable
    {
        $single = [['start' => 10, 'end' => 20]];

        yield 'identical' => [$single, 10, 20, true];
        yield 'inside' => [$single, 12, 18, true];
        yield 'contains' => [$single, 5, 25, true];
        yield 'crosses start' => [$single, 5, 15, true];
        yield 'crosses end' => [$single, 15, 25, true];
        yield 'adjacent before' => [$single, 0, 10, false];
        yield 'adjacent after' => [$single, 20, 30, false];
        yield 'disjoint before' => [$single, -10, 0, false];
        yield 'disjoint after' => [$single, 30, 40, false];
        yield 'one second overlap' => [$single, 19, 21, true];
        yield 'gap between intervals' => [[['start' => 10, 'end' => 20], ['start' => 30, 'end' => 40]], 20, 30, false];
        yield 'duplicate starts and exact duplicates' => [[['start' => 10, 'end' => 15], ['start' => 10, 'end' => 50], ['start' => 10, 'end' => 15]], 40, 45, true];
        yield 'nested interval reaches past ancestors' => [[['start' => 0, 'end' => 1000], ['start' => 10, 'end' => 20], ['start' => 30, 'end' => 40], ['start' => 50, 'end' => 60]], 900, 901, true];
        yield 'overlapping protected intervals' => [[['start' => 10, 'end' => 30], ['start' => 20, 'end' => 40]], 35, 45, true];
        yield 'left subtree adjacency allows right search' => [[['start' => 0, 'end' => 10], ['start' => 5, 'end' => 10], ['start' => 15, 'end' => 25]], 10, 20, true];
        yield 'pre-epoch timestamps' => [[['start' => -20, 'end' => -10]], -15, -5, true];
        yield 'integer extremes avoid arithmetic overflow' => [[['start' => PHP_INT_MIN, 'end' => PHP_INT_MAX]], PHP_INT_MAX - 1, PHP_INT_MAX, true];
        yield 'negative maxEnd is preserved' => [[['start' => -50, 'end' => -40], ['start' => -30, 'end' => -20]], -20, -10, false];
    }

    #[DataProvider('invalidProtectedIntervals')]
    public function test_rejects_invalid_protected_intervals(array $intervals): void
    {
        $this->expectException(InvalidArgumentException::class);

        new AugmentedIntervalTree($intervals);
    }

    public static function invalidProtectedIntervals(): iterable
    {
        yield 'zero length' => [[['start' => 10, 'end' => 10]]];
        yield 'reversed' => [[['start' => 20, 'end' => 10]]];
        yield 'missing start' => [[['end' => 20]]];
        yield 'missing end' => [[['start' => 10]]];
        yield 'null start' => [[['start' => null, 'end' => 20]]];
        yield 'null end' => [[['start' => 10, 'end' => null]]];
        yield 'string start' => [[['start' => '10', 'end' => 20]]];
        yield 'string end' => [[['start' => 10, 'end' => '20']]];
        yield 'float start' => [[['start' => 10.5, 'end' => 20]]];
        yield 'float end' => [[['start' => 10, 'end' => 20.5]]];
        yield 'boolean endpoint' => [[['start' => false, 'end' => 20]]];
        yield 'non-array entry' => [[10]];
        yield 'non-list input' => [['reservation' => ['start' => 10, 'end' => 20]]];
        yield 'invalid entry after valid entry' => [[['start' => 10, 'end' => 20], ['start' => 30, 'end' => 25]]];
    }

    #[DataProvider('invalidQueries')]
    public function test_rejects_invalid_queries_even_on_empty_trees(array $intervals, int $start, int $end): void
    {
        $tree = new AugmentedIntervalTree($intervals);
        $this->expectException(InvalidArgumentException::class);

        $tree->hasOverlap($start, $end);
    }

    public static function invalidQueries(): iterable
    {
        foreach ([[], [['start' => 10, 'end' => 20]]] as $intervals) {
            yield [$intervals, 10, 10];
            yield [$intervals, 20, 10];
        }
    }

    #[DataProvider('nonIntegerQueries')]
    public function test_query_requires_integer_timestamps(mixed $start, mixed $end): void
    {
        $tree = new AugmentedIntervalTree;
        $this->expectException(TypeError::class);

        $tree->hasOverlap($start, $end);
    }

    public static function nonIntegerQueries(): iterable
    {
        yield ['10', 20];
        yield [10, '20'];
        yield [10.5, 20];
        yield [10, 20.5];
        yield [null, 20];
        yield [10, false];
    }

    public function test_build_is_deterministic_balanced_and_augmented_at_every_node(): void
    {
        $intervals = [];

        for ($index = 0; $index < 257; $index++) {
            $intervals[] = ['start' => intdiv($index, 3) - 100, 'end' => 500 - $index];
        }

        $tree = new AugmentedIntervalTree($intervals);
        $root = $this->rootOf($tree);
        $this->assertEquals($root, $this->rootOf(new AugmentedIntervalTree(array_reverse($intervals))));
        $metadata = $this->inspectSubtree($root);

        $this->assertCount(count($intervals), $metadata['intervals']);
        $this->assertSame(9, $metadata['height']);
        $this->assertSame(500, $metadata['maxEnd']);
        usort($intervals, static fn (array $a, array $b): int => ($a['start'] <=> $b['start']) ?: ($a['end'] <=> $b['end'])
        );
        $this->assertSame($intervals, $metadata['intervals']);
    }

    public function test_sort_uses_end_as_tie_breaker_and_retains_duplicates(): void
    {
        $tree = new AugmentedIntervalTree([
            ['start' => 20, 'end' => 30],
            ['start' => 10, 'end' => 50],
            ['start' => 10, 'end' => 15],
            ['start' => 10, 'end' => 15],
        ]);

        $this->assertSame([
            ['start' => 10, 'end' => 15],
            ['start' => 10, 'end' => 15],
            ['start' => 10, 'end' => 50],
            ['start' => 20, 'end' => 30],
        ], $this->inspectSubtree($this->rootOf($tree))['intervals']);
    }

    public function test_seeded_randomized_queries_match_an_independent_sequential_scan(): void
    {
        $random = new Randomizer(new Mt19937(20261121));

        for ($case = 0; $case < 100; $case++) {
            $intervals = [];
            $count = $case === 0 ? 0 : $random->getInt(1, 150);

            for ($index = 0; $index < $count; $index++) {
                $start = 1700000000 + $random->getInt(-200, 200);
                $intervals[] = ['start' => $start, 'end' => $start + $random->getInt(1, 200)];
            }

            $tree = new AugmentedIntervalTree($random->shuffleArray($intervals));

            for ($query = 0; $query < 100; $query++) {
                $start = 1700000000 + $random->getInt(-400, 600);
                $end = $start + $random->getInt(1, 200);

                if ($query % 2 === 0 && $intervals !== []) {
                    $interval = $intervals[$random->getInt(0, $count - 1)];
                    $start = $interval['end'];
                    $end = $start + 1;
                }

                $expected = false;

                // Independent intersection-length criterion, without tree pruning.
                foreach ($intervals as $interval) {
                    if (max($start, $interval['start']) < min($end, $interval['end'])) {
                        $expected = true;
                        break;
                    }
                }

                $this->assertSame($expected, $tree->hasOverlap($start, $end), "Case {$case}, query {$query}: [{$start}, {$end})");
            }
        }
    }

    private function rootOf(AugmentedIntervalTree $tree): ?AugmentedIntervalTreeNode
    {
        return (new ReflectionProperty(AugmentedIntervalTree::class, 'root'))->getValue($tree);
    }

    /** @return array{height: int, maxEnd: ?int, intervals: list<array{start: int, end: int}>} */
    private function inspectSubtree(?AugmentedIntervalTreeNode $node): array
    {
        if ($node === null) {
            return ['height' => 0, 'maxEnd' => null, 'intervals' => []];
        }

        $left = $this->inspectSubtree($node->left);
        $right = $this->inspectSubtree($node->right);
        $maxEnd = max($node->end, $left['maxEnd'] ?? $node->end, $right['maxEnd'] ?? $node->end);

        $this->assertLessThanOrEqual(1, abs($left['height'] - $right['height']));
        $this->assertSame($maxEnd, $node->maxEnd);

        return [
            'height' => 1 + max($left['height'], $right['height']),
            'maxEnd' => $maxEnd,
            'intervals' => [...$left['intervals'], ['start' => $node->start, 'end' => $node->end], ...$right['intervals']],
        ];
    }
}
