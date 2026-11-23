<?php

declare(strict_types=1);

namespace Tests\Support;

use App\Services\Algorithms\ReservationIntervalMode;
use App\Services\Algorithms\ReservationIntervalNormalizer;
use App\Services\Algorithms\ReservationIntervalTreeBuilder;
use Carbon\CarbonImmutable;
use Illuminate\Database\Connection;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Events\Dispatcher;
use RuntimeException;

/** One deterministic CURRENT dataset/proposal definition shared by every benchmark mode. */
final class ReadinessBenchmarkDataset
{
    public static function seed(Connection $database, int $protected): array
    {
        if (! in_array($protected, [100, 1000, 10000], true)) {
            throw new RuntimeException('Unsupported readiness dataset size.');
        }
        $base = CarbonImmutable::parse(ReservationIntervalFixtures::START);
        $fixture = ['reservations' => [], 'reservation_opportunities' => [], 'availability_blocks' => []];
        for ($i = 0; $i < $protected; $i++) {
            $start = $base->addDays(2 * $i);
            if ($i % 4 === 3) {
                $fixture['availability_blocks'][] = ['id' => $i + 1, 'villa_id' => 1,
                    'starts_on' => $start->toDateString(), 'ends_on' => $start->addDay()->toDateString(), 'released_at' => null];

                continue;
            }
            // Same interval in BLOCKED and QUEUE proves precedence without changing total size.
            if ($i === 1) {
                $start = $base;
            }
            $fixture['reservations'][] = ReservationIntervalFixtures::reservation(['id' => $i + 1,
                'status' => ['confirmed', 'payment_review', 'awaiting_deposit'][$i % 4],
                'starts_at' => $start->toIso8601String(), 'ends_at' => $start->addHours(21)->toIso8601String()]);
            if ($i % 4 === 2) {
                $fixture['reservation_opportunities'][] = ReservationIntervalFixtures::opportunity(['id' => $i + 1, 'reservation_id' => $i + 1]);
            }
        }
        // Former holds on otherwise empty days have already been released by staff.
        for ($i = 0; $i < intdiv($protected, 10); $i++) {
            $id = $protected + $i + 1;
            $start = $base->addDays(2 * $i + 1);
            $fixture['reservations'][] = ReservationIntervalFixtures::reservation(['id' => $id, 'status' => 'expired',
                'starts_at' => $start->toIso8601String(), 'ends_at' => $start->addHours(21)->toIso8601String()]);
            $fixture['reservation_opportunities'][] = ReservationIntervalFixtures::opportunity(['id' => $id, 'reservation_id' => $id,
                'status' => 'revoked', 'deposit_deadline' => ReservationIntervalFixtures::NOW, 'closed_at' => ReservationIntervalFixtures::NOW]);
        }
        $summary = ['checksum' => hash('sha256', json_encode($fixture, JSON_THROW_ON_ERROR)),
            'protected_intervals' => $protected, 'physical_rows' => array_map('count', $fixture),
            'protected_breakdown' => ['confirmed' => intdiv($protected, 4), 'payment_review' => intdiv($protected, 4),
                'active_opportunities' => intdiv($protected, 4), 'admin_blocks' => intdiv($protected, 4)],
            'extra_expired_reservations' => intdiv($protected, 10)];
        foreach ($fixture as $table => $rows) {
            foreach (array_chunk($rows, 200) as $chunk) {
                ReservationIntervalFixtures::load($database, [$table => $chunk]);
            }
            $database->statement('ANALYZE '.$table);
        }

        return $summary;
    }

    public static function proposals(): array
    {
        $queries = [];
        $base = CarbonImmutable::parse(ReservationIntervalFixtures::START);
        for ($i = 0; $i < 43; $i++) {
            $start = $base->addDays($i);
            $queries[] = [$start, $start->addHours(21)];
        }

        return $queries;
    }

    public static function httpQuery(): array
    {
        $base = CarbonImmutable::parse(ReservationIntervalFixtures::START);

        return ['start' => $base->toDateString(), 'end' => $base->addDays(42)->toDateString(), 'type' => 'overnight',
            'duration_days' => 1, 'checkin_time' => '14:00', 'checkout_time' => '11:00'];
    }

    /** Capture the builder's actual public-query event; no copied policy SQL or reflection. */
    public static function capturePreparation(Connection $database): array
    {
        $previous = $database->getEventDispatcher();
        $database->setEventDispatcher(new Dispatcher);
        $queries = [];
        $database->listen(function (QueryExecuted $query) use (&$queries): void {
            $queries[] = ['sql' => $query->sql, 'bindings' => $query->bindings];
        });
        try {
            $prepared = (new ReservationIntervalTreeBuilder($database))->prepare(1, CarbonImmutable::parse(ReservationIntervalFixtures::NOW));
        } finally {
            if ($previous === null) {
                $database->unsetEventDispatcher();
            } else {
                $database->setEventDispatcher($previous);
            }
        }
        if (count($queries) !== 1 || ! preg_match('/^\s*\(*\s*select\b/i', $queries[0]['sql'])) {
            throw new RuntimeException('Expected exactly one read-only builder query.');
        }

        return $queries[0] + ['prepared' => $prepared];
    }

    /** Benchmark-only phase split, using the unchanged normalizer in CURRENT mode. */
    public static function normalize(array $records): array
    {
        $normalizer = new ReservationIntervalNormalizer;
        $intervals = ['blocked' => [], 'queue' => []];
        foreach ($records as $record) {
            $intervals[$record->category][] = $normalizer->interval($record->starts_at, $record->ends_at,
                ReservationIntervalMode::Current, $record->source === 'reservation' ? $record->type : null);
        }

        return $intervals;
    }
}
