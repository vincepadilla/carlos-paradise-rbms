<?php

declare(strict_types=1);

namespace Tests\Unit;

use App\Services\Algorithms\PblIntervalPolicy;
use App\Services\Algorithms\ReservationIntervalMode as Mode;
use App\Services\Algorithms\ReservationIntervalNormalizer;
use App\Services\Algorithms\ReservationIntervalTreeBuilder;
use App\Services\Algorithms\ReservationIntervalTrees;
use Carbon\CarbonImmutable;
use DateTimeImmutable;
use DateTimeZone;
use Illuminate\Database\SQLiteConnection;
use InvalidArgumentException;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Tests\Support\ReservationIntervalFixtures as Fixtures;

final class ReservationIntervalTreeBuilderTest extends TestCase
{
    private SQLiteConnection $database;

    private ReservationIntervalTreeBuilder $builder;

    protected function setUp(): void
    {
        parent::setUp();
        $this->assertSame('testing', getenv('APP_ENV'));
        $this->assertSame('sqlite', getenv('DB_CONNECTION'));
        $this->assertSame(':memory:', getenv('DB_DATABASE'));
        $this->assertSame('', getenv('DB_URL'));
        $this->database = Fixtures::database();
        $this->builder = new ReservationIntervalTreeBuilder($this->database);
    }

    protected function tearDown(): void
    {
        $this->database->disconnect();
        parent::tearDown();
    }

    #[DataProvider('currentCases')]
    public function test_current_builder_preserves_existing_compatibility_cases(array $fixture, string $start, string $end, string $expected): void
    {
        Fixtures::load($this->database, $fixture);
        $trees = $this->builder->build(1, CarbonImmutable::parse(Fixtures::NOW));
        $this->assertSame($expected, $trees->classify($start, $end, 'day_tour'));
    }

    public static function currentCases(): iterable
    {
        foreach (ReservationIntervalTreeCompatibilityTest::currentRuleCases() as $name => $case) {
            yield $name => array_slice($case, 0, 4);
        }
    }

    #[DataProvider('storedCleaningCases')]
    public function test_stored_cleaning_is_exactly_once_and_opt_in(string $type, bool $requiresCleaning, string $start, string $expected): void
    {
        Fixtures::load($this->database, ['reservations' => [Fixtures::reservation(['type' => $type])]]);
        $policy = new PblIntervalPolicy($requiresCleaning ? [1] : []);
        $pbl = $this->builder->build(1, CarbonImmutable::parse(Fixtures::NOW), Mode::Pbl, $policy);
        $current = $this->builder->build(1, CarbonImmutable::parse(Fixtures::NOW));
        $end = (new DateTimeImmutable($start))->modify('+30 minutes')->format(DATE_ATOM);
        $this->assertSame($expected, $pbl->classify($start, $end, 'day_tour', true));
        $this->assertSame('available', $current->classify($start, $end, 'day_tour'));
        // Rebuilding starts with raw DB boundaries, never the previous protected end.
        $this->assertSame($expected, $this->builder->build(1, CarbonImmutable::parse(Fixtures::NOW), Mode::Pbl, $policy)->classify($start, $end, 'day_tour'));
    }

    public static function storedCleaningCases(): iterable
    {
        yield '11 AM checkout protects noon' => ['overnight', true, '2026-12-01T12:00:00+08:00', 'blocked'];
        yield '11 AM checkout permits 1 PM equality' => ['overnight', true, '2026-12-01T13:00:00+08:00', 'available'];
        yield 'one second before cleaning end' => ['overnight', true, '2026-12-01T12:59:59+08:00', 'blocked'];
        yield 'no cleaning requirement' => ['overnight', false, '2026-12-01T12:00:00+08:00', 'available'];
        yield 'day tour flag never extends stay' => ['day_tour', true, '2026-12-01T12:00:00+08:00', 'available'];
    }

    #[DataProvider('proposedCleaningCases')]
    public function test_proposed_stays_use_the_same_cleaning_rule(string $type, bool $cleaning, string $protectedStart, string $expected): void
    {
        // The stored interval is unextended: only the NEW proposal's cleaning can conflict.
        Fixtures::load($this->database, ['reservations' => [Fixtures::reservation([
            'type' => 'day_tour', 'starts_at' => $protectedStart, 'ends_at' => '2026-12-01T17:00:00+08:00',
        ])]]);
        $pbl = $this->builder->build(1, CarbonImmutable::parse(Fixtures::NOW), Mode::Pbl, new PblIntervalPolicy);
        $current = $this->builder->build(1, CarbonImmutable::parse(Fixtures::NOW));
        foreach (range(1, 2) as $_) {
            $this->assertSame($expected, $pbl->classify(Fixtures::START, Fixtures::END, $type, $cleaning));
        }
        $this->assertSame('available', $current->classify(Fixtures::START, Fixtures::END, $type, $cleaning));
    }

    public static function proposedCleaningCases(): iterable
    {
        yield 'new overnight protects noon' => ['overnight', true, '2026-12-01T12:00:00+08:00', 'blocked'];
        yield 'new overnight permits 1 PM equality' => ['overnight', true, '2026-12-01T13:00:00+08:00', 'available'];
        yield 'new overnight without cleaning' => ['overnight', false, '2026-12-01T12:00:00+08:00', 'available'];
        yield 'new day use does not extend' => ['day_tour', true, '2026-12-01T12:00:00+08:00', 'available'];
    }

    #[DataProvider('releaseCases')]
    public function test_expired_opportunities_require_verified_staff_release(string $status, string $opportunityStatus, ?string $role, bool $verified, string $expected): void
    {
        Fixtures::load($this->database, [
            'reservations' => [Fixtures::reservation(['status' => $status])],
            'reservation_opportunities' => [Fixtures::opportunity(['status' => $opportunityStatus, 'deposit_deadline' => Fixtures::NOW, 'closed_at' => Fixtures::NOW])],
        ]);
        $evidence = $role === null ? [] : [['opportunity_id' => 1, 'actor_role' => $role, 'verified' => $verified]];
        $policy = new PblIntervalPolicy([1], $evidence);
        $trees = $this->builder->build(1, CarbonImmutable::parse(Fixtures::NOW), Mode::Pbl, $policy);
        $this->assertSame($expected, $trees->classify('2026-12-01T12:00:00+08:00', '2026-12-01T13:00:00+08:00', 'day_tour'));
        $this->assertSame('queue', $this->builder->build(1, CarbonImmutable::parse(Fixtures::NOW))->classify(Fixtures::START, Fixtures::END, 'day_tour'));
    }

    public static function releaseCases(): iterable
    {
        foreach ([['held', 'active'], ['awaiting_deposit', 'active'], ['expired', 'expired']] as [$status, $opportunity]) {
            foreach ([[null, false, 'queue'], ['guest', true, 'queue'], ['admin', false, 'queue'], ['owner', false, 'queue'], ['admin', true, 'available'], ['owner', true, 'available']] as [$role, $verified, $expected]) {
                yield "$status / ".($role ?? 'no evidence')." / verified=$verified" => [$status, $opportunity, $role, $verified, $expected];
            }
        }
    }

    public function test_release_is_scoped_to_one_opportunity_and_does_not_promote_waiters(): void
    {
        Fixtures::load($this->database, [
            'reservations' => [Fixtures::reservation(['status' => 'expired']), Fixtures::reservation(['id' => 2, 'status' => 'queued'])],
            'reservation_opportunities' => [Fixtures::opportunity(['status' => 'expired']), Fixtures::opportunity(['id' => 2, 'status' => 'expired'])],
        ]);
        $policy = new PblIntervalPolicy([], [['opportunity_id' => 1, 'actor_role' => 'owner', 'verified' => true]]);
        $trees = $this->builder->build(1, CarbonImmutable::parse(Fixtures::NOW), Mode::Pbl, $policy);
        $this->assertSame('queue', $trees->classify(Fixtures::START, Fixtures::END, 'day_tour'));
        $this->assertSame('queued', $this->database->table('reservations')->where('id', 2)->value('status'));
        $this->assertSame(2, $this->database->table('reservation_opportunities')->count());
    }

    #[DataProvider('ocularCases')]
    public function test_oculars_are_protected_only_at_approved_visit_times(string $status, string $start, string $end, string $expected): void
    {
        Fixtures::load($this->database, ['ocular_visits' => [[
            'id' => 1, 'villa_id' => 1, 'status' => $status, 'visit_date' => '2026-11-30', 'start_time' => '15:00:00', 'end_time' => '16:00:00',
        ]]]);
        $trees = $this->builder->build(1, CarbonImmutable::parse(Fixtures::NOW), Mode::Pbl, new PblIntervalPolicy([1]));
        $this->assertSame($expected, $trees->classify($start, $end, 'day_tour'));
        $this->assertSame('available', $this->builder->build(1, CarbonImmutable::parse(Fixtures::NOW))->classify($start, $end, 'day_tour'));
    }

    public static function ocularCases(): iterable
    {
        yield 'approved within time' => ['approved', '2026-11-30T15:30:00+08:00', '2026-11-30T16:30:00+08:00', 'blocked'];
        yield 'ends at visit start' => ['approved', '2026-11-30T14:00:00+08:00', '2026-11-30T15:00:00+08:00', 'available'];
        yield 'starts at visit end' => ['approved', '2026-11-30T16:00:00+08:00', '2026-11-30T17:00:00+08:00', 'available'];
        yield 'pending ignored' => ['pending_review', '2026-11-30T15:30:00+08:00', '2026-11-30T16:30:00+08:00', 'available'];
        yield 'cancelled ignored' => ['cancelled', '2026-11-30T15:30:00+08:00', '2026-11-30T16:30:00+08:00', 'available'];
    }

    public function test_fixed_blocks_are_not_extended_and_villa_scope_is_preserved(): void
    {
        Fixtures::load($this->database, [
            'reservations' => [Fixtures::reservation(['villa_id' => 2])],
            'availability_blocks' => [
                ['id' => 1, 'villa_id' => 1, 'starts_on' => '2026-11-30', 'ends_on' => '2026-12-01', 'released_at' => null],
                ['id' => 2, 'villa_id' => 1, 'starts_on' => '2026-12-01', 'ends_on' => '2026-12-02', 'released_at' => Fixtures::NOW],
            ],
            'ocular_visits' => [['id' => 1, 'villa_id' => 2, 'status' => 'approved', 'visit_date' => '2026-12-01', 'start_time' => '00:00:00', 'end_time' => '02:00:00']],
        ]);
        $trees = $this->builder->build(1, CarbonImmutable::parse(Fixtures::NOW), Mode::Pbl, new PblIntervalPolicy([1, 2]));
        $this->assertSame('blocked', $trees->classify('2026-11-30T23:00:00+08:00', '2026-12-01T00:00:00+08:00', 'day_tour'));
        $this->assertSame('available', $trees->classify('2026-12-01T00:00:00+08:00', '2026-12-01T01:00:00+08:00', 'day_tour'));
    }

    public function test_duplicates_are_preserved_without_opportunity_join_multiplication_and_blocked_wins(): void
    {
        Fixtures::load($this->database, [
            'reservations' => [Fixtures::reservation(), Fixtures::reservation(['id' => 2]), Fixtures::reservation(['id' => 3, 'status' => 'held'])],
            'reservation_opportunities' => [Fixtures::opportunity(['reservation_id' => 3, 'status' => 'expired']), Fixtures::opportunity(['id' => 2, 'reservation_id' => 3])],
        ]);
        $prepared = $this->builder->prepare(1, CarbonImmutable::parse(Fixtures::NOW), Mode::Pbl, new PblIntervalPolicy([1, 2, 3]));
        $this->assertCount(2, $prepared['blocked']);
        $this->assertCount(1, $prepared['queue']);
        $this->assertSame($prepared['blocked'][0], $prepared['blocked'][1]);
        $trees = new ReservationIntervalTrees($prepared, Mode::Pbl);
        $this->assertTrue($trees->blocked->hasOverlap(self::epoch(Fixtures::START), self::epoch(Fixtures::END)));
        $this->assertTrue($trees->queue->hasOverlap(self::epoch(Fixtures::START), self::epoch(Fixtures::END)));
        $this->assertSame('blocked', $trees->classify(Fixtures::START, Fixtures::END, 'overnight', true));
    }

    public function test_build_is_one_select_evaluation_has_no_io_and_rebuild_reads_fresh_records(): void
    {
        Fixtures::load($this->database, ['reservations' => [Fixtures::reservation()]]);
        $this->database->enableQueryLog();
        $trees = $this->builder->build(1, CarbonImmutable::parse(Fixtures::NOW), Mode::Pbl, new PblIntervalPolicy([1]));
        $this->assertCount(1, $this->database->getQueryLog());
        $this->assertMatchesRegularExpression('/^select\b/i', $this->database->getQueryLog()[0]['query']);
        $this->database->flushQueryLog();
        $this->assertSame('blocked', $trees->classify(Fixtures::START, Fixtures::END, 'overnight', true));
        $this->assertSame([], $this->database->getQueryLog());
        // Only fixture setup changes DB state. Evaluation never mutates it.
        $this->database->table('reservations')->where('id', 1)->update(['status' => 'cancelled']);
        $this->database->flushQueryLog();
        $this->assertSame('available', $this->builder->build(1, CarbonImmutable::parse(Fixtures::NOW))->classify(Fixtures::START, Fixtures::END, 'day_tour'));
        $this->assertCount(1, $this->database->getQueryLog());
        $this->assertSame('blocked', $trees->classify(Fixtures::START, Fixtures::END, 'day_tour'));
    }

    public function test_manila_and_mixed_offsets_do_not_depend_on_process_timezone(): void
    {
        $previousTimezone = date_default_timezone_get();
        try {
            date_default_timezone_set('America/New_York');
            Fixtures::load($this->database, ['reservations' => [Fixtures::reservation([
                'starts_at' => '2026-11-30T06:00:00Z', 'ends_at' => '2026-11-30T22:00:00-05:00',
            ])]]);
            $trees = $this->builder->build(1, CarbonImmutable::parse(Fixtures::NOW), Mode::Pbl, new PblIntervalPolicy([1]));
            $this->assertSame('blocked', $trees->classify('2026-12-01 12:00:00', '2026-12-01 13:00:00', 'day_tour'));
            $this->assertSame('available', $trees->classify('2026-12-01T05:00:00Z', '2026-12-01T06:00:00Z', 'day_tour'));
        } finally {
            date_default_timezone_set($previousTimezone);
        }
    }

    #[DataProvider('invalidBoundaries')]
    public function test_invalid_raw_boundaries_fail_before_cleaning(string $start, string $end): void
    {
        $this->expectException(InvalidArgumentException::class);
        (new ReservationIntervalNormalizer)->interval($start, $end, Mode::Pbl, 'overnight', true);
    }

    public static function invalidBoundaries(): iterable
    {
        yield 'zero length' => [Fixtures::END, Fixtures::END];
        yield 'reversed' => [Fixtures::END, Fixtures::START];
        yield 'relative input' => ['tomorrow', Fixtures::END];
        yield 'invalid date' => ['2026-02-30T14:00:00+08:00', Fixtures::END];
        yield 'subsecond truncation prohibited' => [Fixtures::START, '2026-12-01T11:00:00.1+08:00'];
    }

    public function test_pbl_requires_explicit_policy_and_current_rejects_pbl_metadata(): void
    {
        foreach ([[Mode::Pbl, null], [Mode::Current, new PblIntervalPolicy([1])]] as [$mode, $policy]) {
            try {
                $this->builder->build(1, CarbonImmutable::parse(Fixtures::NOW), $mode, $policy);
                $this->fail('Mixed or missing policy was accepted.');
            } catch (InvalidArgumentException) {
                $this->addToAssertionCount(1);
            }
        }
    }

    public function test_pbl_matches_independent_sql_projection_for_mixed_raw_records_and_proposals(): void
    {
        $reservations = [];
        $opportunities = [];
        $cleaning = [];
        $releaseEvidence = [];
        $statuses = ['confirmed', 'reserved', 'payment_review', 'held', 'awaiting_deposit', 'expired', 'queued', 'cancelled'];
        for ($id = 1; $id <= 80; $id++) {
            $start = self::epoch(Fixtures::START) + ($id % 20) * 3600;
            $reservations[] = Fixtures::reservation([
                'id' => $id, 'villa_id' => $id % 7 === 0 ? 2 : 1, 'status' => $statuses[$id % 8],
                'type' => $id % 3 === 0 ? 'day_tour' : 'overnight',
                'starts_at' => gmdate('Y-m-d\TH:i:s\Z', $start), 'ends_at' => gmdate('Y-m-d\TH:i:s\Z', $start + 1800 + ($id % 5) * 3600),
            ]);
            $opportunities[] = Fixtures::opportunity(['id' => $id, 'reservation_id' => $id, 'status' => $id % 6 === 0 ? 'revoked' : 'expired']);
            if ($id % 2 === 0) {
                $cleaning[] = $id;
            }
            if ($id % 4 === 0) {
                $releaseEvidence[] = ['opportunity_id' => $id, 'actor_role' => 'admin', 'verified' => true];
            }
        }
        Fixtures::load($this->database, [
            'reservations' => $reservations, 'reservation_opportunities' => $opportunities,
            'availability_blocks' => [['id' => 1, 'villa_id' => 1, 'starts_on' => '2026-12-02', 'ends_on' => '2026-12-03', 'released_at' => null]],
            'ocular_visits' => [['id' => 1, 'villa_id' => 1, 'status' => 'approved', 'visit_date' => '2026-12-04', 'start_time' => '15:00:00', 'end_time' => '16:00:00']],
        ]);
        $trees = $this->builder->build(1, CarbonImmutable::parse(Fixtures::NOW), Mode::Pbl, new PblIntervalPolicy($cleaning, $releaseEvidence));

        // Independent SQL derives policy from RAW records. It never reads prepared tree inputs.
        $sql = <<<'SQL'
            WITH protected AS (
                SELECT CASE WHEN r.status IN ('confirmed', 'reserved') THEN 'blocked' ELSE 'queue' END AS category,
                    CAST(strftime('%s', r.starts_at) AS INTEGER) AS start_epoch,
                    CAST(strftime('%s', r.ends_at) AS INTEGER)
                        + CASE WHEN r.type = 'overnight' AND r.id % 2 = 0 THEN 7200 ELSE 0 END AS end_epoch
                FROM reservations r
                WHERE r.villa_id = 1 AND (
                    r.status IN ('confirmed', 'reserved', 'payment_review')
                    OR (r.status IN ('held', 'awaiting_deposit', 'expired') AND EXISTS (
                        SELECT 1 FROM reservation_opportunities o WHERE o.reservation_id = r.id
                            AND o.status IN ('active', 'expired') AND o.id % 4 != 0
                    ))
                )
                UNION ALL
                SELECT 'blocked', CAST(strftime('%s', starts_on || 'T00:00:00+08:00') AS INTEGER),
                    CAST(strftime('%s', ends_on || 'T00:00:00+08:00') AS INTEGER)
                FROM availability_blocks WHERE villa_id = 1 AND released_at IS NULL
                UNION ALL
                SELECT 'blocked', CAST(strftime('%s', visit_date || 'T' || start_time || '+08:00') AS INTEGER),
                    CAST(strftime('%s', visit_date || 'T' || end_time || '+08:00') AS INTEGER)
                FROM ocular_visits WHERE villa_id = 1 AND status = 'approved'
            )
            SELECT EXISTS (SELECT 1 FROM protected WHERE category = 'blocked' AND start_epoch < :end AND end_epoch > :start) AS blocked,
                EXISTS (SELECT 1 FROM protected WHERE category = 'queue' AND start_epoch < :end AND end_epoch > :start) AS queue
            SQL;
        $statement = $this->database->getPdo()->prepare($sql);
        for ($i = 0; $i < 250; $i++) {
            $start = self::epoch(Fixtures::START) - 7200 + $i * 1800;
            $rawEnd = $start + 1800;
            $type = $i % 2 === 0 ? 'overnight' : 'day_tour';
            $requiresCleaning = $i % 3 === 0;
            $end = $rawEnd + ($type === 'overnight' && $requiresCleaning ? 7200 : 0);
            $statement->bindValue('start', $start, \PDO::PARAM_INT);
            $statement->bindValue('end', $end, \PDO::PARAM_INT);
            $statement->execute();
            $flags = $statement->fetch(\PDO::FETCH_ASSOC);
            $this->assertSame((bool) $flags['blocked'], $trees->blocked->hasOverlap($start, $end), "blocked query $i");
            $this->assertSame((bool) $flags['queue'], $trees->queue->hasOverlap($start, $end), "queue query $i");
            $expected = $flags['blocked'] ? 'blocked' : ($flags['queue'] ? 'queue' : 'available');
            $this->assertSame($expected, $trees->classify(gmdate('Y-m-d\TH:i:s\Z', $start), gmdate('Y-m-d\TH:i:s\Z', $rawEnd), $type, $requiresCleaning), "classification query $i");
        }
    }

    private static function epoch(string $value): int
    {
        return (new DateTimeImmutable($value, new DateTimeZone('Asia/Manila')))->getTimestamp();
    }
}
