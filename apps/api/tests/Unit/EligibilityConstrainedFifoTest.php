<?php

declare(strict_types=1);

namespace Tests\Unit;

use App\Services\Algorithms\EligibilityConstrainedFifo;
use App\Services\Algorithms\ReservationIntervalMode;
use App\Services\Algorithms\ReservationIntervalTrees;
use DateTimeImmutable;
use InvalidArgumentException;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class EligibilityConstrainedFifoTest extends TestCase
{
    private const SUBMITTED = '2026-11-23T07:00:00+08:00';

    private const DECISION = '2026-11-23T08:00:00+08:00';

    private const CHECKIN = '2026-11-24T14:00:00+08:00';

    private const CHECKOUT = '2026-11-25T11:00:00+08:00';

    public function test_selects_one_earliest_eligible_guest_and_counts_candidates_regardless_of_input_order(): void
    {
        $requests = [
            $this->request(2, ['requested_at' => self::DECISION]),
            $this->request(20),
            $this->request(10, ['status' => 'pending', 'requested_at' => '2026-11-22T23:00:00Z']),
            $this->request(4, ['status' => 'cancelled']),
            $this->request(3, ['requested_at' => '2026-11-22T15:30:00Z', 'starts_at' => 'not-a-date']),
            $this->request(1, ['requested_at' => '2026-11-22T15:30:00Z', 'type' => 'invalid']),
        ];

        foreach ([$requests, array_reverse($requests)] as $rows) {
            $this->assertSame(['selected_reservation_id' => 10, 'eligible_candidates' => 3], $this->select($rows));
        }
    }

    #[DataProvider('eligibilityCases')]
    public function test_release_and_waiting_time_boundaries(array $overrides, bool $eligible): void
    {
        $result = $this->select([$this->request(1, $overrides)]);
        $this->assertSame($eligible ? 1 : null, $result['selected_reservation_id']);
        $this->assertSame((int) $eligible, $result['eligible_candidates']);
    }

    public static function eligibilityCases(): iterable
    {
        yield 'submitted exactly at decision' => [['requested_at' => self::DECISION], true];
        yield 'check-in exactly at decision' => [['starts_at' => self::DECISION], true];
        yield 'submitted after decision' => [['requested_at' => '2026-11-23T08:00:01+08:00'], false];
        yield 'already checked in' => [['starts_at' => '2026-11-23T07:59:59+08:00'], false];
        yield 'invalid zero-length stay' => [['ends_at' => self::CHECKIN], false];
        yield 'invalid reverse stay' => [['ends_at' => self::DECISION], false];
        yield 'raw stay starts at release endpoint' => [[
            'starts_at' => self::CHECKOUT, 'ends_at' => '2026-11-26T11:00:00+08:00',
        ], false];
        yield 'only candidate cleaning overlaps the release' => [[
            'starts_at' => '2026-11-23T14:00:00+08:00', 'ends_at' => self::CHECKIN,
        ], false];
    }

    public function test_proposed_overnight_cleaning_uses_both_trees_and_allows_touching_endpoints(): void
    {
        $noon = $this->epoch('2026-11-25T12:00:00+08:00');
        $one = $noon + 3600;
        $night = $this->request(1);
        $dayUse = $this->request(2, ['type' => 'day_tour', 'starts_at' => '2026-11-25T09:00:00+08:00']);
        foreach (['blocked', 'queue'] as $category) {
            $intervals = ['blocked' => [], 'queue' => []];
            $intervals[$category][] = ['start' => $noon, 'end' => $one];
            $this->assertSame(['selected_reservation_id' => 2, 'eligible_candidates' => 1], $this->select([$night, $dayUse], $intervals));
            $intervals[$category] = [['start' => $one, 'end' => $one + 60]];
            $this->assertSame(['selected_reservation_id' => 1, 'eligible_candidates' => 2], $this->select([$night, $dayUse], $intervals));
        }
    }

    public function test_empty_queue_returns_null_and_no_candidates(): void
    {
        $this->assertSame(['selected_reservation_id' => null, 'eligible_candidates' => 0], $this->select([]));
    }

    public function test_refuses_current_calendar_policy(): void
    {
        $this->expectException(InvalidArgumentException::class);
        (new EligibilityConstrainedFifo)->select([], self::CHECKIN, self::CHECKOUT, self::DECISION,
            new ReservationIntervalTrees(['blocked' => [], 'queue' => []]));
    }

    private function request(int $id, array $overrides = []): object
    {
        return (object) array_replace([
            'id' => $id, 'status' => 'queued', 'requested_at' => self::SUBMITTED,
            'starts_at' => self::CHECKIN, 'ends_at' => self::CHECKOUT, 'type' => 'overnight',
        ], $overrides);
    }

    private function select(array $rows, array $intervals = ['blocked' => [], 'queue' => []]): array
    {
        return (new EligibilityConstrainedFifo)->select($rows, self::CHECKIN, self::CHECKOUT, self::DECISION,
            new ReservationIntervalTrees($intervals, ReservationIntervalMode::Pbl));
    }

    private function epoch(string $time): int
    {
        return (new DateTimeImmutable($time))->getTimestamp();
    }
}
