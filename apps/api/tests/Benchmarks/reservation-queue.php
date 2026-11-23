<?php

declare(strict_types=1);

// Run: php tests/Benchmarks/reservation-queue.php [--assert-performance]
// Synthetic fixtures only. Each release is an independent decision against the same waiting queue.
require dirname(__DIR__, 2).'/vendor/autoload.php';

use App\Services\Algorithms\EligibilityConstrainedFifo;
use App\Services\Algorithms\ReservationIntervalMode;
use App\Services\Algorithms\ReservationIntervalNormalizer;
use App\Services\Algorithms\ReservationIntervalTrees;
use Random\Engine\Mt19937;
use Random\Randomizer;

const DAY = 86400;
const CLEANING = 7200;
const RELEASES = 24;
const SEEDS = 30;
const TARGET_MS = 100;

function timestamp(int $epoch): string
{
    return gmdate('Y-m-d\TH:i:s\Z', $epoch);
}

function makeDataset(int $size, int $loadPercent, int $seed): array
{
    $rng = new Randomizer(new Mt19937($seed + $size * 1000));
    $base = (new DateTimeImmutable('2026-11-01T00:00:00+08:00'))->getTimestamp();
    $decision = $base + 6000 * 60;
    $rawQueue = [];
    $rows = [];
    for ($id = 1; $id <= $size; $id++) {
        $day = $rng->getInt(0, 9);
        $draw = $rng->getInt(1, 100);
        $nights = match (true) {
            $draw <= 70 => 1,
            $draw <= 90 => 2,
            default => 3,
        };
        $submitted = $base + $rng->getInt(0, 4999) * 60;
        $draw = $rng->getInt(1, 100);
        $status = match (true) {
            $draw <= 78 => 'queued',
            $draw <= 95 => 'pending',
            default => 'cancelled',
        };
        $start = $base + $day * DAY + 14 * 3600;
        $end = $base + ($day + $nights) * DAY + 11 * 3600;
        $rawQueue[] = compact('id', 'status', 'submitted', 'start', 'end');
        $rows[] = (object) [
            'id' => $id, 'status' => $status, 'type' => 'overnight',
            'requested_at' => timestamp($submitted), 'starts_at' => timestamp($start), 'ends_at' => timestamp($end),
        ];
    }

    $days = [];
    for ($day = 0; $day < 12; $day++) {
        if ($rng->getInt(1, 100) <= $loadPercent) {
            $days[] = $day;
        }
    }
    if ($days === []) {
        $days[] = $rng->getInt(0, 9);
    }
    $holds = [];
    foreach ($days as $day) {
        $holds[$day] = [
            'start' => $base + $day * DAY + 14 * 3600,
            'end' => $base + ($day + 1) * DAY + 11 * 3600,
        ];
    }
    $events = [];
    for ($i = 0; $i < RELEASES; $i++) {
        $released = $days[$rng->getInt(0, count($days) - 1)];
        $remaining = $holds;
        unset($remaining[$released]);
        // The released window uses raw checkout; remaining overnight stays still occupy cleaning time.
        $events[] = ['released' => $holds[$released], 'remaining' => array_values($remaining)];
    }

    return [$rawQueue, $rows, $events, $decision];
}

/** Independent reference: compare raw epochs by brute force and explicitly sort all eligible IDs. */
function referenceResult(array $rawQueue, array $released, array $remaining, int $decision): array
{
    $eligible = [];
    foreach ($rawQueue as $row) {
        if (! in_array($row['status'], ['pending', 'queued'], true)
            || $row['submitted'] > $decision || $decision > $row['start'] || $row['end'] <= $row['start']
            || max($released['start'], $row['start']) >= min($released['end'], $row['end'])) {
            continue;
        }

        foreach ($remaining as $hold) {
            // Split guest stay and cleaning to avoid using the selector's normalization or search.
            $protectedEnd = $hold['end'] + CLEANING;
            $guestConflict = max($row['start'], $hold['start']) < min($row['end'], $protectedEnd);
            $cleaningConflict = max($row['end'], $hold['start']) < min($row['end'] + CLEANING, $protectedEnd);
            if ($guestConflict || $cleaningConflict) {
                continue 2;
            }
        }
        $eligible[] = $row;
    }
    usort($eligible, static fn (array $a, array $b): int => ($a['submitted'] <=> $b['submitted']) ?: ($a['id'] <=> $b['id']));

    return ['selected_reservation_id' => $eligible[0]['id'] ?? null, 'eligible_candidates' => count($eligible)];
}

function decideBatch(array $rows, array $events, int $decision): array
{
    $normalizer = new ReservationIntervalNormalizer;
    $fifo = new EligibilityConstrainedFifo($normalizer);
    $mode = ReservationIntervalMode::QueueAllocation;
    $results = [];
    foreach ($events as $event) {
        $holds = [];
        foreach ($event['remaining'] as $hold) {
            $holds[] = [
                'start' => $hold['start'],
                'end' => $normalizer->effectiveEnd($hold['end'], $mode, 'overnight', true),
            ];
        }
        $tree = new ReservationIntervalTrees(['blocked' => [], 'queue' => $holds], $mode);
        $results[] = $fifo->select($rows, timestamp($event['released']['start']), timestamp($event['released']['end']), timestamp($decision), $tree);
    }

    return $results;
}

function median(array $values): float
{
    sort($values);
    $middle = intdiv(count($values), 2);

    return count($values) % 2 === 1 ? $values[$middle] : ($values[$middle - 1] + $values[$middle]) / 2;
}

$groups = [];
$total = 0;
$nonempty = 0;
$targetMet = false;
foreach ([32, 128, 512, 2048] as $size) {
    foreach ([30, 60, 90] as $loadPercent) {
        $seedMedians = [];
        $peaks = [];
        for ($seed = 0; $seed < SEEDS; $seed++) {
            [$rawQueue, $rows, $events, $decision] = makeDataset($size, $loadPercent, $seed);
            $expected = [];
            foreach ($events as $event) {
                $result = referenceResult($rawQueue, $event['released'], $event['remaining'], $decision);
                $expected[] = $result;
                $total++;
                $nonempty += (int) ($result['selected_reservation_id'] !== null);
            }
            $warmup = decideBatch($rows, $events, $decision);
            if ($warmup !== $expected) {
                throw new RuntimeException("Selector differs from reference for size $size, load $loadPercent, seed $seed.");
            }
            $times = [];
            for ($repeat = 0; $repeat < 3; $repeat++) {
                memory_reset_peak_usage();
                $before = memory_get_usage();
                $started = hrtime(true);
                $results = decideBatch($rows, $events, $decision);
                $times[] = (hrtime(true) - $started) / 1000000;
                $peaks[] = (memory_get_peak_usage() - $before) / 1024;
                if ($results !== $expected) {
                    throw new RuntimeException("Repeated decision changed for size $size, load $loadPercent, seed $seed.");
                }
            }
            $seedMedians[] = median($times);
        }
        $mean = array_sum($seedMedians) / SEEDS;
        $variance = array_sum(array_map(static fn (float $time): float => ($time - $mean) ** 2, $seedMedians)) / (SEEDS - 1);
        $groups[] = [
            'requests' => $size, 'load_pct' => $loadPercent,
            'batch_mean_ms' => round($mean, 4), 'batch_median_ms' => round(median($seedMedians), 4),
            'batch_sd_ms' => round(sqrt($variance), 4), 'max_additional_kib' => round(max($peaks), 1),
        ];
        if ($size === 2048 && $loadPercent === 60) {
            $targetMet = $mean <= TARGET_MS;
        }
    }
}
echo json_encode([
    'runtime' => PHP_VERSION.' '.PHP_OS_FAMILY, 'rng' => 'MT19937 (same distributions as Colab, different generated draws)',
    'scope' => 'Fresh protected trees, timestamp normalization, eligibility and selection for 24 releases; excludes database and HTTP.',
    'timing' => 'One warmup and median of three 24-decision batches per seed; aggregate across 30 seeds.',
    'scenarios' => $total, 'nonempty' => $nonempty, 'incorrect_candidate_or_count' => 0, 'nonempty_fifo_compliance_pct' => 100,
    'mean_target_2048_load60_ms' => TARGET_MS, 'target_met' => $targetMet, 'results' => $groups,
], JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR).PHP_EOL;
exit(in_array('--assert-performance', $argv, true) && ! $targetMet ? 1 : 0);
