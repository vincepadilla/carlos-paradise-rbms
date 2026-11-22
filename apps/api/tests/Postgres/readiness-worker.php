<?php

declare(strict_types=1);

// One process per dataset/mode prevents memory peaks and retained objects crossing modes.
require dirname(__DIR__, 2).'/vendor/autoload.php';

use App\Services\Algorithms\PostgresAvailabilitySnapshotReader;
use App\Services\Algorithms\ReservationAvailabilityShadow;
use App\Services\Algorithms\ReservationIntervalTrees;
use App\Services\ReservationAvailability;
use Illuminate\Contracts\View\Factory as ViewFactory;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Events\Dispatcher;
use Illuminate\Routing\Redirector;
use Illuminate\Routing\ResponseFactory;
use Tests\Support\AvailabilityShadowTestEnvironment;
use Tests\Support\DisposablePostgresCluster;
use Tests\Support\IsolatedAvailabilityHttpApplication;
use Tests\Support\PostgresShadowFixture;
use Tests\Support\ReadinessBenchmarkDataset as Dataset;

function readinessMedian(array $values): float
{
    sort($values);

    return round($values[intdiv(count($values), 2)], 4);
}

function readinessMs(int $start): float
{
    return (hrtime(true) - $start) / 1_000_000;
}

function readinessPlanNodes(array $node): array
{
    $nodes = [['type' => $node['Node Type'], 'relation' => $node['Relation Name'] ?? null,
        'actual_rows' => $node['Actual Rows'] ?? null, 'loops' => $node['Actual Loops'] ?? null]];
    foreach ($node['Plans'] ?? [] as $child) {
        array_push($nodes, ...readinessPlanNodes($child));
    }

    return $nodes;
}

$size = (int) ($argv[1] ?? 0);
$mode = $argv[2] ?? '';
if (! in_array($size, [100, 1000, 10000], true)
    || ! in_array($mode, ['sql', 'tree_compute', 'tree_pipeline', 'shadow', 'http_sql', 'http_shadow'], true)) {
    throw new RuntimeException('Explicit readiness dataset and mode are required.');
}
$cluster = new DisposablePostgresCluster;
$fixture = new PostgresShadowFixture($cluster);
$environment = new AvailabilityShadowTestEnvironment($fixture->database, new PostgresAvailabilitySnapshotReader($fixture->database));
$http = null;
try {
    $dataset = Dataset::seed($fixture->database, $size);
    $database = $fixture->database;
    $queries = Dataset::proposals();
    $referenceService = new ReservationAvailability;
    $referenceResponses = array_map(fn ($query) => $referenceService->forInterval(...$query), $queries);
    $referenceClasses = array_column($referenceResponses, 'availability');
    $distribution = array_count_values($referenceClasses);

    // Split the exact existing builder SELECT into fetch and normalization phases.
    $capture = Dataset::capturePreparation($database);
    $raw = $database->select($capture['sql'], $capture['bindings']);
    $beforeInputs = memory_get_usage(false);
    $inputs = Dataset::normalize($raw);
    $inputBytes = memory_get_usage(false) - $beforeInputs;
    $canonical = function (array $values): array {
        foreach (['blocked', 'queue'] as $category) {
            usort($values[$category], fn ($a, $b) => ($a['start'] <=> $b['start']) ?: ($a['end'] <=> $b['end']));
        }

        return $values;
    };
    if ($canonical($inputs) !== $canonical($capture['prepared']) || count($inputs['blocked']) + count($inputs['queue']) !== $size) {
        throw new RuntimeException('Phase split differs from the existing CURRENT builder.');
    }
    $planRow = $database->selectOne('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) '.$capture['sql'], $capture['bindings']);
    $plan = json_decode($planRow->{'QUERY PLAN'}, true, flags: JSON_THROW_ON_ERROR)[0];
    $planSummary = ['postgres_execution_ms' => $plan['Execution Time'], 'planning_ms' => $plan['Planning Time'],
        'nodes' => readinessPlanNodes($plan['Plan'])];
    unset($raw, $capture['prepared'], $plan, $planRow);
    if ($mode !== 'tree_compute') {
        unset($inputs);
        $inputs = null;
    }
    if (str_starts_with($mode, 'http_')) {
        $http = new IsolatedAvailabilityHttpApplication(
            new ResponseFactory(Mockery::mock(ViewFactory::class), Mockery::mock(Redirector::class)),
            $environment, productionShadow: true);
        $session = $http->login(1);
        $referenceHttp = $http->get('/api/availability', Dataset::httpQuery(), $session);
        if ($referenceHttp->getStatusCode() !== 200) {
            throw new RuntimeException('Reference authenticated HTTP request failed.');
        }
        $referenceJson = $referenceHttp->getContent();
        unset($referenceHttp);
    }
    if ($database->getEventDispatcher() === null) {
        $database->setEventDispatcher(new Dispatcher);
    }
    $monitor = false;
    $databaseStats = [];
    $database->listen(function (QueryExecuted $query) use (&$monitor, &$databaseStats): void {
        if (! $monitor) {
            return;
        }
        if (! preg_match('/^\s*\(*\s*select\b/i', $query->sql)) {
            throw new RuntimeException('A measured request attempted a database mutation.');
        }
        $databaseStats['selects']++;
        $databaseStats['db_query_ms'] += $query->time;
        if (str_contains(strtolower($query->sql), 'union all')) {
            $databaseStats['tree_selects']++;
            $databaseStats['tree_select_ms'] += $query->time;
        }
    });

    $samples = [];
    $aggregate = ['reference_checks' => 0, 'matches' => 0, 'mismatches' => 0, 'inconclusive' => 0, 'errors' => 0];
    for ($run = 0; $run < 8; $run++) {
        $environment->logger->events = [];
        if ($http !== null) {
            // Do not count last request's retained tree as part of the new baseline.
            $http->app->forgetScopedInstances();
            $http->app['auth']->forgetGuards();
        }
        $databaseStats = ['selects' => 0, 'db_query_ms' => 0.0, 'tree_selects' => 0, 'tree_select_ms' => 0.0];
        gc_collect_cycles();
        $baselineMemory = memory_get_usage(false);
        memory_reset_peak_usage();
        $phases = ['retrieval_ms' => null, 'normalization_ms' => null, 'construction_ms' => null, 'query_work_ms' => 0.0];
        $monitor = true;
        $started = hrtime(true);
        $counts = null;
        if ($mode === 'sql' || $mode === 'shadow') {
            $shadow = $mode === 'shadow' ? $environment->shadow() : null;
            $availability = new ReservationAvailability($shadow);
            $queryStarted = hrtime(true);
            $responses = array_map(fn ($query) => $availability->forInterval(...$query), $queries);
            $phases['query_work_ms'] = readinessMs($queryStarted);
            $classes = array_column($responses, 'availability');
            $counts = $shadow?->counts();
        } elseif ($mode === 'tree_compute' || $mode === 'tree_pipeline') {
            if ($mode === 'tree_pipeline') {
                $phaseStarted = hrtime(true);
                $raw = $database->select($capture['sql'], $capture['bindings']);
                $phases['retrieval_ms'] = readinessMs($phaseStarted);
                $phaseStarted = hrtime(true);
                $prepared = Dataset::normalize($raw);
                $phases['normalization_ms'] = readinessMs($phaseStarted);
                unset($raw);
            } else {
                $prepared = $inputs;
                $phases['retrieval_ms'] = 0.0;
                $phases['normalization_ms'] = 0.0;
            }
            $phaseStarted = hrtime(true);
            $trees = new ReservationIntervalTrees($prepared);
            unset($prepared);
            $phases['construction_ms'] = readinessMs($phaseStarted);
            $phaseStarted = hrtime(true);
            $classes = array_map(fn ($query) => $trees->classifyEpoch($query[0]->getTimestamp(), $query[1]->getTimestamp()), $queries);
            $phases['query_work_ms'] = readinessMs($phaseStarted);
        } else {
            $response = $http->get('/api/availability', Dataset::httpQuery(), $session, shadow: $mode === 'http_shadow');
            $counts = $mode === 'http_shadow' ? $http->app->make(ReservationAvailabilityShadow::class)->counts() : null;
            $classes = array_values(json_decode($response->getContent(), true, flags: JSON_THROW_ON_ERROR)['dates'] ?? []);
        }
        $totalMs = readinessMs($started);
        $monitor = false;
        $peakDelta = memory_get_peak_usage(false) - $baselineMemory;
        $retainedDelta = memory_get_usage(false) - $baselineMemory;

        if ($classes !== $referenceClasses
            || (isset($responses) && $responses !== $referenceResponses)
            || (isset($response) && ($response->getStatusCode() !== 200 || $response->getContent() !== $referenceJson))) {
            throw new RuntimeException('Readiness result differs from the unchanged SQL reference.');
        }
        if ($counts !== null && ($counts['matches'] !== 43 || $counts['builds'] !== 1 || $counts['errors'] !== 0)) {
            throw new RuntimeException('Shadow consistency/reuse assertion failed in benchmark.');
        }
        $events = array_column($environment->logger->events, 'context');
        $fullShadowBuildMs = $counts === null ? null : array_sum(array_column($events, 'build_ms'));
        $shadowTreeQueriesMs = $counts === null ? null : array_sum(array_column($events, 'query_ms'));
        if ($run > 0) {
            $sample = ['total_ms' => $totalMs, 'peak_php_delta_bytes' => $peakDelta, 'retained_php_delta_bytes' => $retainedDelta,
                'baseline_php_bytes' => $baselineMemory, 'shadow_full_prepare_build_ms' => $fullShadowBuildMs,
                'shadow_tree_queries_ms' => $shadowTreeQueriesMs] + $phases + $databaseStats;
            $samples[] = $sample;
            $aggregate['reference_checks'] += 43;
            $aggregate['matches'] += 43;
        }
        $lastCounts = $counts;
        unset($responses, $response, $classes, $trees, $prepared, $availability, $shadow, $events);
    }
    $medians = [];
    foreach (array_keys($samples[0]) as $key) {
        $values = array_column($samples, $key);
        $medians[$key] = $values[0] === null ? null : readinessMedian($values);
    }
    echo json_encode(['mode' => $mode, 'records' => $size, 'dataset' => $dataset,
        'proposal_distribution' => $distribution, 'proposals' => 43, 'samples' => 7, 'warmups' => 1,
        'prepared_input_bytes_outside_compute_timer' => $mode === 'tree_compute' ? $inputBytes : 0,
        'median' => $medians, 'measured_comparison_counts' => $aggregate, 'last_shadow_counts' => $lastCounts,
        'sample_details' => $samples,
        'preparation_query_plan' => $planSummary], JSON_THROW_ON_ERROR).PHP_EOL;
} finally {
    if ($http !== null) {
        $http->close();
        Mockery::close();
    } else {
        $environment->close();
    }
    $fixture->close();
}
