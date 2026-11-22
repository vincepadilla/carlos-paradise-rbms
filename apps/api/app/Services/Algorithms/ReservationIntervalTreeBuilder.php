<?php

declare(strict_types=1);

namespace App\Services\Algorithms;

use Carbon\CarbonImmutable;
use Illuminate\Database\ConnectionInterface;
use Illuminate\Database\Query\Builder;
use InvalidArgumentException;

/** Read-only preparation from authoritative tables. No workflow calls or persistent cache. */
final class ReservationIntervalTreeBuilder
{
    public function __construct(
        private readonly ConnectionInterface $database,
        private readonly ReservationIntervalNormalizer $normalizer = new ReservationIntervalNormalizer,
    ) {}

    public function build(
        int $villaId,
        CarbonImmutable $asOf,
        ReservationIntervalMode $mode = ReservationIntervalMode::Current,
        ?PblIntervalPolicy $pbl = null,
    ): ReservationIntervalTrees {
        return new ReservationIntervalTrees($this->prepare($villaId, $asOf, $mode, $pbl), $mode, $this->normalizer);
    }

    /** Relevant CURRENT intervals only; no row limit, truncation or PBL cleaning assumptions. */
    public function buildForWindow(int $villaId, CarbonImmutable $asOf, CarbonImmutable $start, CarbonImmutable $end): ReservationIntervalTrees
    {
        $this->normalizer->interval($start->format('Y-m-d\TH:i:s.uP'), $end->format('Y-m-d\TH:i:s.uP'), ReservationIntervalMode::Current);

        return new ReservationIntervalTrees($this->prepareIntervals($villaId, $asOf, ReservationIntervalMode::Current, null,
            $start->setTimezone('Asia/Manila'), $end->setTimezone('Asia/Manila')));
    }

    /**
     * One UNION ALL SELECT gives PostgreSQL statement-snapshot consistency. No date
     * prefilter: even a stay ending before a query may overlap through PBL cleaning.
     * Duplicate records remain distinct; EXISTS avoids multiplying a stay by its opportunities.
     *
     * @return array{blocked: list<array{start: int, end: int}>, queue: list<array{start: int, end: int}>}
     */
    public function prepare(
        int $villaId,
        CarbonImmutable $asOf,
        ReservationIntervalMode $mode = ReservationIntervalMode::Current,
        ?PblIntervalPolicy $pbl = null,
    ): array {
        return $this->prepareIntervals($villaId, $asOf, $mode, $pbl);
    }

    private function prepareIntervals(
        int $villaId,
        CarbonImmutable $asOf,
        ReservationIntervalMode $mode,
        ?PblIntervalPolicy $pbl,
        ?CarbonImmutable $windowStart = null,
        ?CarbonImmutable $windowEnd = null,
    ): array {
        if ($villaId <= 0) {
            throw new InvalidArgumentException('A positive villa ID is required.');
        }
        if ($mode === ReservationIntervalMode::Current && $pbl !== null) {
            throw new InvalidArgumentException('PBL metadata is only valid in PBL comparison mode.');
        }
        if ($mode === ReservationIntervalMode::Pbl && $pbl === null) {
            throw new InvalidArgumentException('PBL mode requires an explicit cleaning/release policy.');
        }

        $reservations = $this->reservationQuery($villaId, $asOf, $mode, $pbl);
        $blocks = $this->database->table('availability_blocks')->where('villa_id', $villaId)->whereNull('released_at')
            ->selectRaw("id, NULL AS type, CAST(starts_on AS TEXT) AS starts_at, CAST(ends_on AS TEXT) AS ends_at, 'blocked' AS category, 'block' AS source");
        if ($windowStart !== null && $windowEnd !== null) {
            // Any candidate is contained in this envelope. An interval disjoint from
            // the envelope cannot overlap a candidate; crossing intervals remain included.
            $reservations->where('starts_at', '<', $windowEnd->toIso8601String())
                ->where('ends_at', '>', $windowStart->toIso8601String());
            $blocks->where('starts_on', '<=', $windowEnd->subSecond()->toDateString())
                ->where('ends_on', '>', $windowStart->toDateString());
        }
        $records = $reservations->unionAll($blocks);

        if ($mode === ReservationIntervalMode::Pbl) {
            $records->unionAll($this->database->table('ocular_visits')->where('villa_id', $villaId)->where('status', 'approved')
                ->selectRaw("id, NULL AS type, CAST(visit_date AS TEXT) || ' ' || CAST(start_time AS TEXT) AS starts_at,
                    CAST(visit_date AS TEXT) || ' ' || CAST(end_time AS TEXT) AS ends_at, 'blocked' AS category, 'ocular' AS source"));
        }

        $intervals = ['blocked' => [], 'queue' => []];
        foreach ($records->get() as $record) {
            $intervals[$record->category][] = $this->normalizer->interval(
                $record->starts_at,
                $record->ends_at,
                $mode,
                $record->source === 'reservation' ? $record->type : null,
                $record->source === 'reservation' && ($pbl?->requiresCleaning((int) $record->id) ?? false),
            );
        }

        return $intervals;
    }

    private function reservationQuery(
        int $villaId,
        CarbonImmutable $asOf,
        ReservationIntervalMode $mode,
        ?PblIntervalPolicy $pbl,
    ): Builder {
        return $this->database->table('reservations')->where('villa_id', $villaId)
            ->selectRaw("id, type, CAST(starts_at AS TEXT) AS starts_at, CAST(ends_at AS TEXT) AS ends_at,
                CASE WHEN status IN ('confirmed', 'reserved') THEN 'blocked' ELSE 'queue' END AS category,
                'reservation' AS source")
            ->where(function (Builder $protected) use ($asOf, $mode, $pbl): void {
                $protected->whereIn('status', ['confirmed', 'reserved', 'payment_review'])
                    ->orWhere(function (Builder $held) use ($asOf, $mode, $pbl): void {
                        $held->whereIn('status', $mode === ReservationIntervalMode::Pbl
                            ? ['held', 'awaiting_deposit', 'expired'] : ['held', 'awaiting_deposit'])
                            ->whereExists(function (Builder $opportunity) use ($asOf, $mode, $pbl): void {
                                $opportunity->selectRaw('1')->from('reservation_opportunities AS opportunity')
                                    ->whereColumn('opportunity.reservation_id', 'reservations.id');
                                if ($mode === ReservationIntervalMode::Current) {
                                    $opportunity->where('opportunity.status', 'active')
                                        ->where('opportunity.deposit_deadline', '>', $asOf->setTimezone('Asia/Manila')->toIso8601String());
                                } else {
                                    $opportunity->whereIn('opportunity.status', ['active', 'expired'])
                                        ->whereNotIn('opportunity.id', $pbl->releasedOpportunityIds());
                                }
                            });
                    });
            });
    }
}
