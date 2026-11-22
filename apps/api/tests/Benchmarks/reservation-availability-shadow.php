<?php

declare(strict_types=1);

// Run from apps/api: php -d extension=pdo_sqlite tests/Benchmarks/reservation-availability-shadow.php
// Isolated fixtures only. Does not bootstrap Laravel, load .env, or connect to PostgreSQL.
require dirname(__DIR__, 2).'/vendor/autoload.php';

use App\Services\ReservationAvailability;
use Carbon\CarbonImmutable;
use Tests\Support\AvailabilityShadowTestEnvironment;
use Tests\Support\ReservationIntervalFixtures as Fixtures;

function shadowMedian(array $values): float
{
    sort($values);

    return round($values[intdiv(count($values), 2)], 3);
}

$results = [];
foreach ([100, 1000, 10000] as $size) {
    $environment = new AvailabilityShadowTestEnvironment;
    try {
        $base = CarbonImmutable::parse(Fixtures::START);
        $rows = [];
        for ($i = 0; $i < $size; $i++) {
            $rows[] = Fixtures::reservation([
                'id' => $i + 1, 'status' => $i % 2 === 0 ? 'confirmed' : 'payment_review',
                'starts_at' => $base->addDays($i)->toIso8601String(),
                'ends_at' => $base->addDays($i)->addHours(21)->toIso8601String(),
            ]);
        }
        foreach (array_chunk($rows, 200) as $chunk) {
            Fixtures::load($environment->database, ['reservations' => $chunk]);
        }
        unset($rows);
        // Match the production probe count, using local SELECTs instead of PG MVCC functions.
        // This includes local metadata-query overhead, but cannot measure PostgreSQL RTT.
        $environment->snapshots->onRead = function () use ($environment): string {
            $environment->database->selectOne('SELECT 1 AS fixture_probe');

            return 'isolated-unchanged-calendar';
        };
        $queries = [];
        for ($i = 0; $i < 43; $i++) {
            $start = $base->addDays($i)->addHours($i % 3 === 2 ? 23 : 1);
            $queries[] = [$start, $start->addMinutes(30)];
        }
        // Count real fixture queries outside timed samples, including every local probe.
        $environment->database->enableQueryLog();
        $original = new ReservationAvailability;
        foreach ($queries as $query) {
            $original->forInterval(...$query);
        }
        $originalSelects = count($environment->database->getQueryLog());
        $environment->database->flushQueryLog();
        $countedShadow = $environment->shadow();
        $countedAvailability = new ReservationAvailability($countedShadow);
        foreach ($queries as $query) {
            $countedAvailability->forInterval(...$query);
        }
        $shadowSelects = count($environment->database->getQueryLog());
        $environment->database->disableQueryLog();
        $environment->database->flushQueryLog();
        $samples = ['disabled_43_ms' => [], 'enabled_43_ms' => [], 'added_43_ms' => [],
            'full_tree_build_ms' => [], 'all_tree_queries_ms' => [], 'shadow_work_excluding_log_ms' => []];
        $lastCounts = [];
        $probeCount = 0;
        for ($run = 0; $run < 8; $run++) {
            $original = new ReservationAvailability;
            $started = hrtime(true);
            $expected = array_map(fn (array $query) => $original->forInterval(...$query), $queries);
            $disabledMs = (hrtime(true) - $started) / 1_000_000;
            $environment->logger->events = [];
            $environment->snapshots->reads = 0;
            $shadow = $environment->shadow();
            $availability = new ReservationAvailability($shadow);
            $started = hrtime(true);
            $actual = array_map(fn (array $query) => $availability->forInterval(...$query), $queries);
            $enabledMs = (hrtime(true) - $started) / 1_000_000;
            if ($actual !== $expected || $shadow->counts()['matches'] !== 43 || $shadow->counts()['builds'] !== 1) {
                throw new RuntimeException('Benchmark response, consistency or reuse check failed.');
            }
            $events = array_column($environment->logger->events, 'context');
            if ($run !== 0) {
                $samples['disabled_43_ms'][] = $disabledMs;
                $samples['enabled_43_ms'][] = $enabledMs;
                $samples['added_43_ms'][] = $enabledMs - $disabledMs;
                $samples['full_tree_build_ms'][] = array_sum(array_column($events, 'build_ms'));
                $samples['all_tree_queries_ms'][] = array_sum(array_column($events, 'query_ms'));
                $samples['shadow_work_excluding_log_ms'][] = array_sum(array_column($events, 'shadow_ms'));
            }
            $lastCounts = $shadow->counts();
            $probeCount = $environment->snapshots->reads;
        }
        $results[] = ['protected_records' => $size, 'checks_per_request' => 43,
            'snapshot_probes_per_request' => $probeCount, 'extra_tree_selects_per_request' => 1,
            'original_selects' => $originalSelects, 'shadow_selects' => $shadowSelects,
            'extra_selects' => $shadowSelects - $originalSelects,
            'last_request_counts' => $lastCounts] + array_map('shadowMedian', $samples);
    } finally {
        $environment->close();
    }
}
echo json_encode(['php' => PHP_VERSION, 'os' => PHP_OS_FAMILY, 'database' => 'disposable SQLite :memory:',
    'samples' => 7, 'warmups' => 1, 'units' => 'median milliseconds',
    'limitations' => 'Frozen clock; local SELECT snapshot probes; in-memory logger. No PostgreSQL or disk/network logging latency; no production/Python speedup claim.',
    'results' => $results,
], JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR).PHP_EOL;
