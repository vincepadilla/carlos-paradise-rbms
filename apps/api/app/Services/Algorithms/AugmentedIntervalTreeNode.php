<?php

declare(strict_types=1);

namespace App\Services\Algorithms;

/** @internal Tree nodes are created by AugmentedIntervalTree. */
final readonly class AugmentedIntervalTreeNode
{
    public int $maxEnd;

    public function __construct(
        public int $start,
        public int $end,
        public ?self $left = null,
        public ?self $right = null,
    ) {
        $this->maxEnd = max($end, $left?->maxEnd ?? $end, $right?->maxEnd ?? $end);
    }
}
