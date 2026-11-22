<?php

declare(strict_types=1);

namespace App\Services\Algorithms;

use InvalidArgumentException;

/** Test/comparison metadata, deliberately separate from persisted reservation state. */
final class PblIntervalPolicy
{
    /** @var array<int, true> */
    private readonly array $cleaning;

    /** @var list<int> */
    private readonly array $released;

    /**
     * Release evidence must come from a trusted verifier; this class does not authenticate actors.
     * Missing/unverified evidence, closed_at and an expired deadline never imply release.
     *
     * @param  list<int>  $cleaningReservationIds  Raw overnight stays requiring cleaning.
     * @param  list<array{opportunity_id: int, actor_role: string, verified: bool}>  $releaseEvidence
     */
    public function __construct(array $cleaningReservationIds = [], array $releaseEvidence = [])
    {
        $cleaning = [];
        foreach ($cleaningReservationIds as $id) {
            self::validateId($id);
            $cleaning[$id] = true;
        }
        $released = [];
        foreach ($releaseEvidence as $event) {
            if (! is_array($event) || ! isset($event['opportunity_id'], $event['actor_role'], $event['verified'])
                || ! is_string($event['actor_role']) || ! is_bool($event['verified'])) {
                throw new InvalidArgumentException('Malformed PBL release evidence.');
            }
            self::validateId($event['opportunity_id']);
            if ($event['verified'] && in_array($event['actor_role'], ['admin', 'owner'], true)) {
                $released[$event['opportunity_id']] = true;
            }
        }
        $this->cleaning = $cleaning;
        $this->released = array_keys($released);
    }

    public function requiresCleaning(int $reservationId): bool
    {
        return isset($this->cleaning[$reservationId]);
    }

    /** @return list<int> */
    public function releasedOpportunityIds(): array
    {
        return $this->released;
    }

    private static function validateId(mixed $id): void
    {
        if (! is_int($id) || $id <= 0) {
            throw new InvalidArgumentException('PBL metadata requires positive integer IDs.');
        }
    }
}
