<?php

declare(strict_types=1);

namespace Tests\Postgres;

use App\Services\Algorithms\PblIntervalPolicy;
use App\Services\Algorithms\ReservationIntervalMode;
use App\Services\Algorithms\ReservationIntervalTreeBuilder;
use App\Services\ReservationAvailability;
use Carbon\CarbonImmutable;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\TestCase;
use Tests\Support\AvailabilityShadowTestEnvironment;
use Tests\Support\DisposablePostgresCluster;
use Tests\Support\PostgresShadowFixture;
use Tests\Support\ReservationIntervalFixtures as Fixtures;

/** Proposed policy projections only; differences from CURRENT are not algorithm mismatches. */
#[Group('proposed-pbl')]
final class ReservationPblPolicyPostgresTest extends TestCase
{
    private ?PostgresShadowFixture $fixture = null;

    private ?AvailabilityShadowTestEnvironment $environment = null;

    private static array $counts = ['proposed_comparisons' => 0, 'sql_tree_matches' => 0, 'intentional_current_policy_differences' => 0];

    protected function setUp(): void
    {
        parent::setUp();
        if (! getenv('RBMS_STEP4A_MANIFEST')) {
            $this->markTestSkipped('Requires the verified disposable PostgreSQL runner.');
        }
        $this->fixture = new PostgresShadowFixture(new DisposablePostgresCluster);
        $this->environment = new AvailabilityShadowTestEnvironment($this->fixture->database);
    }

    protected function tearDown(): void
    {
        $this->environment?->close();
        $this->fixture?->close();
        parent::tearDown();
    }

    public static function tearDownAfterClass(): void
    {
        echo PHP_EOL.'PROPOSED_PBL_COUNTS '.json_encode(self::$counts, JSON_THROW_ON_ERROR).PHP_EOL;
        parent::tearDownAfterClass();
    }

    #[DataProvider('cleaningCases')]
    public function test_proposed_pbl_cleaning_is_separate_from_current_and_applied_once(
        array $stored, array $cleaningIds, string $start, string $end, string $proposalType, bool $cleaning, string $expected,
    ): void {
        Fixtures::load($this->fixture->database, ['reservations' => [$stored]]);
        $before = $this->state();
        $this->compare($start, $end, $proposalType, $cleaning, $cleaningIds, [], 'available', $expected);
        $this->compare($start, $end, $proposalType, $cleaning, $cleaningIds, [], 'available', $expected);
        $this->assertSame($before, $this->state());
    }

    public static function cleaningCases(): iterable
    {
        $stay = Fixtures::reservation();
        yield 'stored overnight protects noon' => [$stay, [1], '2026-12-01T12:00:00+08:00', '2026-12-01T12:30:00+08:00', 'day_tour', false, 'blocked'];
        yield 'stored overnight ends protection at 1 PM' => [$stay, [1], '2026-12-01T13:00:00+08:00', '2026-12-01T14:00:00+08:00', 'day_tour', false, 'available'];
        yield 'stored overnight without cleaning metadata' => [$stay, [], '2026-12-01T12:00:00+08:00', '2026-12-01T12:30:00+08:00', 'day_tour', false, 'available'];
        $day = Fixtures::reservation(['type' => 'day_tour', 'starts_at' => '2026-12-01T08:00:00+08:00']);
        yield 'stored day tour flag never extends' => [$day, [1], '2026-12-01T12:00:00+08:00', '2026-12-01T12:30:00+08:00', 'day_tour', false, 'available'];
        $following = Fixtures::reservation(['type' => 'day_tour', 'starts_at' => '2026-12-01T12:00:00+08:00', 'ends_at' => '2026-12-01T17:00:00+08:00']);
        yield 'new overnight protects noon' => [$following, [], Fixtures::START, Fixtures::END, 'overnight', true, 'blocked'];
        yield 'new overnight without cleaning metadata' => [$following, [], Fixtures::START, Fixtures::END, 'overnight', false, 'available'];
        yield 'new overnight permits 1 PM equality' => [array_replace($following, ['starts_at' => '2026-12-01T13:00:00+08:00']), [], Fixtures::START, Fixtures::END, 'overnight', true, 'available'];
        yield 'new day tour flag never extends' => [$following, [], '2026-12-01T08:00:00+08:00', Fixtures::END, 'day_tour', true, 'available'];
    }

    #[DataProvider('ocularCases')]
    public function test_proposed_pbl_ocular_protects_only_approved_timed_interval(string $status, string $start, string $end, string $expected): void
    {
        Fixtures::load($this->fixture->database, ['ocular_visits' => [[
            'id' => 1, 'villa_id' => 1, 'status' => $status, 'visit_date' => '2026-11-30', 'start_time' => '15:00:00', 'end_time' => '16:00:00',
        ]]]);
        $this->compare($start, $end, 'day_tour', false, [1], [], 'available', $expected);
    }

    public static function ocularCases(): iterable
    {
        yield 'approved conflict' => ['approved', '2026-11-30T15:30:00+08:00', '2026-11-30T16:30:00+08:00', 'blocked'];
        yield 'ends at visit start' => ['approved', '2026-11-30T14:00:00+08:00', '2026-11-30T15:00:00+08:00', 'available'];
        yield 'starts at visit end, no cleaning on visit' => ['approved', '2026-11-30T16:00:00+08:00', '2026-11-30T17:00:00+08:00', 'available'];
        yield 'pending ignored' => ['pending_review', '2026-11-30T15:30:00+08:00', '2026-11-30T16:30:00+08:00', 'available'];
        yield 'cancelled ignored' => ['cancelled', '2026-11-30T15:30:00+08:00', '2026-11-30T16:30:00+08:00', 'available'];
    }

    #[DataProvider('releaseCases')]
    public function test_proposed_pbl_expiry_requires_verified_staff_release(?string $role, bool $verified, string $expected): void
    {
        Fixtures::load($this->fixture->database, [
            'reservations' => [Fixtures::reservation(['status' => 'expired'])],
            'reservation_opportunities' => [Fixtures::opportunity(['status' => 'expired', 'closed_at' => Fixtures::NOW, 'deposit_deadline' => Fixtures::NOW])],
        ]);
        $events = $role === null ? [] : [['opportunity_id' => 1, 'actor_role' => $role, 'verified' => $verified]];
        $before = $this->state();
        $this->compare(Fixtures::START, Fixtures::END, 'overnight', false, [], $events, 'queue', $expected);
        $this->assertSame($before, $this->state());
    }

    public static function releaseCases(): iterable
    {
        yield 'unreleased' => [null, false, 'queue'];
        yield 'guest evidence rejected' => ['guest', true, 'queue'];
        yield 'unverified admin rejected' => ['admin', false, 'queue'];
        yield 'unverified owner rejected' => ['owner', false, 'queue'];
        yield 'verified admin' => ['admin', true, 'available'];
        yield 'verified owner' => ['owner', true, 'available'];
    }

    public function test_proposed_pbl_fixed_blocks_keep_midnight_end_and_no_cleaning_extension(): void
    {
        Fixtures::load($this->fixture->database, ['availability_blocks' => [[
            'id' => 1, 'villa_id' => 1, 'starts_on' => '2026-11-30', 'ends_on' => '2026-12-01', 'released_at' => null,
        ]]]);
        $this->compare('2026-12-01T00:00:00+08:00', '2026-12-01T01:00:00+08:00', 'day_tour', false, [1], [], 'available', 'available');
    }

    private function compare(string $start, string $end, string $type, bool $cleaning, array $ids, array $events, string $current, string $proposed): void
    {
        $this->assertSame($current, (new ReservationAvailability)->forInterval(CarbonImmutable::parse($start), CarbonImmutable::parse($end))['availability']);
        $trees = (new ReservationIntervalTreeBuilder($this->fixture->database))->build(1, CarbonImmutable::parse(Fixtures::NOW),
            ReservationIntervalMode::Pbl, new PblIntervalPolicy($ids, $events));
        $this->assertSame($proposed, $trees->classify($start, $end, $type, $cleaning));
        $this->assertSame($proposed, $this->sqlProjection($start, $end, $type, $cleaning, $ids, $events));
        self::$counts['proposed_comparisons']++;
        self::$counts['sql_tree_matches']++;
        self::$counts['intentional_current_policy_differences'] += $current !== $proposed ? 1 : 0;
    }

    /** Independent PostgreSQL projection from raw records, not normalized tree inputs. */
    private function sqlProjection(string $start, string $end, string $type, bool $cleaning, array $ids, array $events): string
    {
        $cleaningIds = $ids === [] ? 'NULL' : implode(',', array_map('intval', $ids));
        $released = [];
        foreach ($events as $event) {
            if ($event['verified'] === true && in_array($event['actor_role'], ['admin', 'owner'], true)) {
                $released[] = (int) $event['opportunity_id'];
            }
        }
        $releaseFilter = $released === [] ? '' : ' AND o.id NOT IN ('.implode(',', $released).')';
        $sql = <<<SQL
            WITH requested AS (
                SELECT EXTRACT(EPOCH FROM CAST(? AS timestamptz)) AS start_epoch,
                    EXTRACT(EPOCH FROM CAST(? AS timestamptz)) + CAST(? AS integer) AS end_epoch
            ), protected AS (
                SELECT CASE WHEN r.status IN ('confirmed','reserved') THEN 'blocked' ELSE 'queue' END AS category,
                    EXTRACT(EPOCH FROM r.starts_at) AS start_epoch,
                    EXTRACT(EPOCH FROM r.ends_at) + CASE WHEN r.type = 'overnight' AND r.id IN ($cleaningIds) THEN 7200 ELSE 0 END AS end_epoch
                FROM reservations r WHERE r.villa_id = 1 AND (
                    r.status IN ('confirmed','reserved','payment_review')
                    OR (r.status IN ('held','awaiting_deposit','expired') AND EXISTS (
                        SELECT 1 FROM reservation_opportunities o WHERE o.reservation_id = r.id
                            AND o.status IN ('active','expired') $releaseFilter
                    ))
                )
                UNION ALL
                SELECT 'blocked', EXTRACT(EPOCH FROM starts_on::timestamp AT TIME ZONE 'Asia/Manila'),
                    EXTRACT(EPOCH FROM ends_on::timestamp AT TIME ZONE 'Asia/Manila')
                FROM availability_blocks WHERE villa_id = 1 AND released_at IS NULL
                UNION ALL
                SELECT 'blocked', EXTRACT(EPOCH FROM (visit_date + start_time) AT TIME ZONE 'Asia/Manila'),
                    EXTRACT(EPOCH FROM (visit_date + end_time) AT TIME ZONE 'Asia/Manila')
                FROM ocular_visits WHERE villa_id = 1 AND status = 'approved'
            )
            SELECT CASE WHEN EXISTS (SELECT 1 FROM protected p CROSS JOIN requested q
                WHERE p.category = 'blocked' AND p.start_epoch < q.end_epoch AND p.end_epoch > q.start_epoch) THEN 'blocked'
                WHEN EXISTS (SELECT 1 FROM protected p CROSS JOIN requested q
                WHERE p.category = 'queue' AND p.start_epoch < q.end_epoch AND p.end_epoch > q.start_epoch) THEN 'queue'
                ELSE 'available' END AS category
            SQL;

        return $this->fixture->database->selectOne($sql, [$start, $end, $type === 'overnight' && $cleaning ? 7200 : 0])->category;
    }

    private function state(): array
    {
        return array_map(fn ($table) => $this->fixture->database->table($table)->orderBy('id')->get()->map(fn ($row) => (array) $row)->all(),
            ['reservations', 'reservation_opportunities', 'availability_blocks', 'ocular_visits']);
    }
}
