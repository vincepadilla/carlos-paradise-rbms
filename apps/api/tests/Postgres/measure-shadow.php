<?php

declare(strict_types=1);

require dirname(__DIR__, 2).'/vendor/autoload.php';

use App\Services\Algorithms\PostgresAvailabilitySnapshotReader;
use App\Services\Algorithms\ReservationAvailabilityShadow;
use App\Services\ReservationAvailability;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\View\Factory as ViewFactory;
use Illuminate\Routing\Redirector;
use Illuminate\Routing\ResponseFactory;
use Tests\Support\AvailabilityShadowTestEnvironment;
use Tests\Support\DisposablePostgresCluster;
use Tests\Support\IsolatedAvailabilityHttpApplication;
use Tests\Support\PostgresShadowFixture;
use Tests\Support\ReservationIntervalFixtures as Fixtures;

function pgMedian(array $values): float
{
    sort($values);

    return round($values[intdiv(count($values), 2)], 3);
}

$cluster = new DisposablePostgresCluster;
$results = [];
$httpResult = null;
foreach ([100, 1000, 10000] as $size) {
    $fixture = new PostgresShadowFixture($cluster);
    $environment = new AvailabilityShadowTestEnvironment($fixture->database, new PostgresAvailabilitySnapshotReader($fixture->database));
    $http = null;
    try {
        $base = CarbonImmutable::parse(Fixtures::START);
        $rows = [];
        for ($i = 0; $i < $size; $i++) {
            $rows[] = Fixtures::reservation(['id' => $i + 1, 'status' => $i % 2 === 0 ? 'confirmed' : 'payment_review',
                'starts_at' => $base->addDays($i)->toIso8601String(), 'ends_at' => $base->addDays($i)->addHours(21)->toIso8601String()]);
        }
        foreach (array_chunk($rows, 200) as $chunk) {
            Fixtures::load($fixture->database, ['reservations' => $chunk]);
        }
        unset($rows);
        // Statistics work is confined to the disposable schema and excluded from timings.
        $fixture->database->statement('ANALYZE reservations');
        $queries = [];
        for ($i = 0; $i < 43; $i++) {
            $start = $base->addDays($i)->addHours($i % 3 === 2 ? 23 : 1);
            $queries[] = [$start, $start->addMinutes(30)];
        }
        $database = $fixture->database;
        $database->enableQueryLog();
        $original = new ReservationAvailability;
        foreach ($queries as $query) {
            $original->forInterval(...$query);
        }
        $baselineCount = count($database->getQueryLog());
        $database->flushQueryLog();
        $shadow = $environment->shadow();
        $availability = new ReservationAvailability($shadow);
        foreach ($queries as $query) {
            $availability->forInterval(...$query);
        }
        $enabledCount = count($database->getQueryLog());
        $database->disableQueryLog();
        $database->flushQueryLog();
        $samples = ['sql_ms' => [], 'shadow_ms' => [], 'added_ms' => [], 'build_ms' => [], 'tree_queries_ms' => []];
        for ($run = 0; $run < 8; $run++) {
            $original = new ReservationAvailability;
            $started = hrtime(true);
            $expected = array_map(fn ($query) => $original->forInterval(...$query), $queries);
            $sqlMs = (hrtime(true) - $started) / 1_000_000;
            $environment->logger->events = [];
            $shadow = $environment->shadow();
            $availability = new ReservationAvailability($shadow);
            $started = hrtime(true);
            $actual = array_map(fn ($query) => $availability->forInterval(...$query), $queries);
            $shadowMs = (hrtime(true) - $started) / 1_000_000;
            if ($actual !== $expected || $shadow->counts()['matches'] !== 43 || $shadow->counts()['builds'] !== 1) {
                throw new RuntimeException('PostgreSQL benchmark response/consistency/reuse check failed.');
            }
            $events = array_column($environment->logger->events, 'context');
            if ($run > 0) {
                $samples['sql_ms'][] = $sqlMs;
                $samples['shadow_ms'][] = $shadowMs;
                $samples['added_ms'][] = $shadowMs - $sqlMs;
                $samples['build_ms'][] = array_sum(array_column($events, 'build_ms'));
                $samples['tree_queries_ms'][] = array_sum(array_column($events, 'query_ms'));
            }
        }
        $results[] = ['records' => $size, 'checks' => 43, 'sql_queries' => $baselineCount, 'shadow_queries' => $enabledCount,
            'extra_queries' => $enabledCount - $baselineCount, 'counts' => $shadow->counts()] + array_map('pgMedian', $samples);

        if ($size === 1000) {
            $http = new IsolatedAvailabilityHttpApplication(
                new ResponseFactory(Mockery::mock(ViewFactory::class), Mockery::mock(Redirector::class)),
                $environment, productionShadow: true);
            $session = $http->login(1);
            $query = ['start' => $base->toDateString(), 'end' => $base->addDays(42)->toDateString(),
                'type' => 'overnight', 'duration_days' => 1, 'checkin_time' => '14:00', 'checkout_time' => '11:00'];
            $database->enableQueryLog();
            $http->get('/api/availability', $query, $session);
            $sqlCount = count($database->getQueryLog());
            $database->flushQueryLog();
            $http->get('/api/availability', $query, $session, shadow: true);
            $shadowCount = count($database->getQueryLog());
            $database->disableQueryLog();
            $database->flushQueryLog();
            $latency = ['sql_ms' => [], 'shadow_ms' => [], 'added_ms' => []];
            for ($run = 0; $run < 8; $run++) {
                $started = hrtime(true);
                $originalResponse = $http->get('/api/availability', $query, $session);
                $sqlMs = (hrtime(true) - $started) / 1_000_000;
                $environment->logger->events = [];
                $started = hrtime(true);
                $shadowResponse = $http->get('/api/availability', $query, $session, shadow: true);
                $shadowMs = (hrtime(true) - $started) / 1_000_000;
                $requestShadow = $http->app->make(ReservationAvailabilityShadow::class);
                if ($originalResponse->getStatusCode() !== 200 || $shadowResponse->getStatusCode() !== 200
                    || $originalResponse->getContent() !== $shadowResponse->getContent() || $requestShadow->counts()['matches'] !== 43) {
                    throw new RuntimeException('PostgreSQL authenticated HTTP response comparison failed.');
                }
                if ($run > 0) {
                    $latency['sql_ms'][] = $sqlMs;
                    $latency['shadow_ms'][] = $shadowMs;
                    $latency['added_ms'][] = $shadowMs - $sqlMs;
                }
            }
            $httpResult = ['records' => $size, 'calendar_dates' => 43, 'sql_queries' => $sqlCount,
                'shadow_queries' => $shadowCount, 'extra_queries' => $shadowCount - $sqlCount,
                'counts' => $requestShadow->counts()] + array_map('pgMedian', $latency);
        }
    } finally {
        if ($http !== null) {
            $http->close();
            Mockery::close();
        } else {
            $environment->close();
        }
        $fixture->close();
    }
}
echo 'POSTGRES_SHADOW_MEASUREMENTS '.json_encode(['version' => $cluster->version(), 'samples' => 7,
    'warmups' => 1, 'units' => 'median milliseconds', 'service' => $results, 'authenticated_http' => $httpResult,
    'limits' => 'Fresh loopback cluster, representative column/index fixtures, frozen clock, warm data, in-memory logs; excludes browser/TLS and deployed logging/network latency.',
], JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR).PHP_EOL;
