<?php

declare(strict_types=1);

// Run from apps/api: php -d extension=pdo_sqlite tests/Benchmarks/reservation-interval-trees.php
// Composer only: no application bootstrap, .env, production connection or migrations.
require dirname(__DIR__, 2).'/vendor/autoload.php';

use App\Services\Algorithms\PblIntervalPolicy;
use App\Services\Algorithms\ReservationIntervalMode as Mode;
use App\Services\Algorithms\ReservationIntervalTreeBuilder;
use App\Services\Algorithms\ReservationIntervalTrees;
use Carbon\CarbonImmutable;
use Tests\Support\ReservationIntervalFixtures as Fixtures;

function median(array $values): float
{
    sort($values);

    return round($values[intdiv(count($values), 2)], 3);
}

function milliseconds(int $started): float
{
    return (hrtime(true) - $started) / 1_000_000;
}

$results = [];
$base = (new DateTimeImmutable(Fixtures::START))->getTimestamp();
$asOf = CarbonImmutable::parse(Fixtures::NOW);
foreach ([100, 1000, 10000] as $size) {
    $database = Fixtures::database();
    $builder = new ReservationIntervalTreeBuilder($database);
    $rows = [];
    for ($i = 0; $i < $size; $i++) {
        $rows[] = Fixtures::reservation([
            'id' => $i + 1, 'status' => $i % 2 === 0 ? 'confirmed' : 'payment_review',
            'starts_at' => gmdate('Y-m-d\TH:i:s\Z', $base + $i * 86400),
            'ends_at' => gmdate('Y-m-d\TH:i:s\Z', $base + $i * 86400 + 21 * 3600),
        ]);
    }
    foreach (array_chunk($rows, 200) as $chunk) {
        Fixtures::load($database, ['reservations' => $chunk]);
    }
    unset($rows);
    foreach ([Mode::Current, Mode::Pbl] as $mode) {
        $policy = $mode === Mode::Pbl ? new PblIntervalPolicy(range(1, $size)) : null;
        $queries = [];
        $distribution = ['blocked' => 0, 'queue' => 0, 'available' => 0];
        for ($q = 0; $q < 1000; $q++) {
            $index = ($q * 37) % $size;
            $start = $base + $index * 86400 + ($q % 3 === 2 ? 23 : 1) * 3600;
            $expected = $q % 3 === 2 ? 'available' : ($index % 2 === 0 ? 'blocked' : 'queue');
            $distribution[$expected]++;
            $queries[] = [$start, $start + 1800, gmdate('Y-m-d\TH:i:s\Z', $start), gmdate('Y-m-d\TH:i:s\Z', $start + 1800), $expected];
        }
        $samples = ['read_normalize_ms' => [], 'build_both_ms' => [], 'query_both_1000_ms' => [], 'classify_1000_ms' => [], 'build_plus_classify_1000_ms' => []];
        for ($run = 0; $run < 8; $run++) {
            $started = hrtime(true);
            $prepared = $builder->prepare(1, $asOf, $mode, $policy);
            $prepareMs = milliseconds($started);
            $started = hrtime(true);
            $trees = new ReservationIntervalTrees($prepared, $mode);
            $buildMs = milliseconds($started);
            $started = hrtime(true);
            foreach ($queries as [$start, $end]) {
                // Always query BOTH trees, even when BLOCKED could short-circuit classification.
                $trees->blocked->hasOverlap($start, $end);
                $trees->queue->hasOverlap($start, $end);
            }
            $queryMs = milliseconds($started);
            $started = hrtime(true);
            foreach ($queries as [, , $start, $end, $expected]) {
                if ($trees->classify($start, $end, 'day_tour') !== $expected) {
                    throw new RuntimeException('Benchmark fixture classification mismatch.');
                }
            }
            $classifyMs = milliseconds($started);
            if ($run !== 0) { // One warm-up; seven measured runs, no performance assertions.
                $samples['read_normalize_ms'][] = $prepareMs;
                $samples['build_both_ms'][] = $buildMs;
                $samples['query_both_1000_ms'][] = $queryMs;
                $samples['classify_1000_ms'][] = $classifyMs;
                $samples['build_plus_classify_1000_ms'][] = $prepareMs + $buildMs + $classifyMs;
            }
            unset($trees, $prepared);
        }
        $results[] = ['mode' => $mode->value, 'protected_records' => $size, 'blocked_records' => intdiv($size, 2),
            'queue_records' => intdiv($size, 2), 'query_distribution' => $distribution] + array_map('median', $samples);
    }
    $database->disconnect();
}
echo json_encode([
    'php' => PHP_VERSION, 'os' => PHP_OS_FAMILY, 'database' => 'disposable SQLite :memory:',
    'samples' => 7, 'warmups' => 1, 'units' => 'median milliseconds',
    'scope' => 'Synthetic PHP costs only. No PostgreSQL latency, production speedup, or Python comparison.',
    'results' => $results,
], JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR).PHP_EOL;
