<?php

declare(strict_types=1);

require dirname(__DIR__, 2).'/vendor/autoload.php';

use Tests\Support\DisposablePostgresCluster;

$cluster = new DisposablePostgresCluster;
$results = [];
foreach ([100, 1000, 10000] as $size) {
    $checksums = [];
    foreach (['sql', 'tree_compute', 'tree_pipeline', 'shadow', 'http_sql', 'http_shadow'] as $mode) {
        // No shell interpolation. Each fresh PHP worker has its own fixture schema and peak baseline.
        $process = proc_open([PHP_BINARY, __DIR__.'/readiness-worker.php', (string) $size, $mode],
            [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, dirname(__DIR__, 2));
        if (! is_resource($process)) {
            throw new RuntimeException('Unable to start isolated readiness worker.');
        }
        fclose($pipes[0]);
        $output = stream_get_contents($pipes[1]);
        $error = stream_get_contents($pipes[2]);
        fclose($pipes[1]);
        fclose($pipes[2]);
        if (proc_close($process) !== 0) {
            throw new RuntimeException('Readiness worker failed: '.$mode.' / '.$size.PHP_EOL.$error.PHP_EOL.$output);
        }
        $result = json_decode($output, true, flags: JSON_THROW_ON_ERROR);
        $checksums[] = $result['dataset']['checksum'];
        $results[] = $result;
        printf("READINESS %d %-13s total=%.3f ms SELECTs=%d peak_delta=%.0f bytes\n", $size, $mode,
            $result['median']['total_ms'], $result['median']['selects'], $result['median']['peak_php_delta_bytes']);
    }
    if (count(array_unique($checksums)) !== 1) {
        throw new RuntimeException('Readiness modes used different synthetic datasets.');
    }
}
$artifact = dirname(__DIR__, 2).'/docs/algorithm-1-step-4b-results.json';
$previousRuns = [];
if (is_file($artifact)) {
    $previous = json_decode(file_get_contents($artifact), true, flags: JSON_THROW_ON_ERROR);
    $previousRuns = $previous['previous_runs'] ?? [];
    $previousRuns[] = ['postgres' => $previous['postgres'], 'php' => $previous['php'], 'results' => $previous['results']];
}
file_put_contents($artifact, json_encode(['postgres' => $cluster->version(), 'php' => PHP_VERSION, 'os' => PHP_OS_FAMILY,
    'policy' => 'CURRENT only', 'samples_per_mode' => 7, 'warmups' => 1, 'results' => $results, 'previous_runs' => $previousRuns,
    'limitations' => [
        'Each mode runs in a fresh PHP process; common fixture/bootstrap and process startup are outside request timers.',
        'tree_compute rebuilds both trees from normalized input; input memory and all DB/normalization are separately disclosed.',
        'tree_pipeline includes one exact builder SELECT, normalization, rebuilding and classifications; no queue positions/auth/API endpoint.',
        'SQL and shadow service modes preserve original queue positions; HTTP modes measure the real authenticated route/JSON.',
        'Memory is PHP allocated peak delta, not process RSS or PostgreSQL memory. In-memory log retention is included.',
        'Local primary, fixed clock, warm/analyzed synthetic data, no TLS/browser/network server or deployed log I/O.',
    ]], JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR).PHP_EOL);
echo 'Readiness dataset checksums matched across all modes. Results: docs/algorithm-1-step-4b-results.json'.PHP_EOL;
