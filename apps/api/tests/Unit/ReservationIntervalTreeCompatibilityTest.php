<?php

declare(strict_types=1);

namespace Tests\Unit;

use App\Services\AdminNotificationService;
use App\Services\Algorithms\AugmentedIntervalTree;
use App\Services\ReservationAvailability;
use App\Services\ReservationWorkflow;
use Carbon\CarbonImmutable;
use DateTimeImmutable;
use DateTimeZone;
use Illuminate\Container\Container;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\SQLiteConnection;
use Illuminate\Support\Facades\Facade;
use Illuminate\Translation\ArrayLoader;
use Illuminate\Translation\Translator;
use Illuminate\Validation\Factory as ValidatorFactory;
use Illuminate\Validation\ValidationException;
use PDO;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * Uses real read-only service methods against a disposable, minimal SQLite schema.
 * Does not boot Laravel, load .env, run migrations, or call expiry/promotion code.
 */
final class ReservationIntervalTreeCompatibilityTest extends TestCase
{
    private const NOW = '2026-11-21T10:00:00+08:00';

    private const START = '2026-11-30T14:00:00+08:00';

    private const END = '2026-12-01T11:00:00+08:00';

    private ?SQLiteConnection $database = null;

    private mixed $previousFacadeApplication = null;

    private mixed $previousTestNow = null;

    private string $previousTimezone;

    protected function setUp(): void
    {
        parent::setUp();
        $this->previousFacadeApplication = Facade::getFacadeApplication();
        $this->previousTestNow = CarbonImmutable::getTestNow();
        $this->previousTimezone = date_default_timezone_get();

        // Fail before connecting unless PHPUnit explicitly configured isolation.
        $this->assertSame('testing', getenv('APP_ENV'));
        $this->assertSame('sqlite', getenv('DB_CONNECTION'));
        $this->assertSame(':memory:', getenv('DB_DATABASE'));
        $this->assertSame('', getenv('DB_URL'));
        if (! extension_loaded('pdo_sqlite')) {
            $this->markTestSkipped('The isolated compatibility tests require pdo_sqlite.');
        }

        // The literal DSN cannot resolve to a development or production database.
        $pdo = new PDO('sqlite::memory:', options: [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        $this->assertSame('', $pdo->query('PRAGMA database_list')->fetch(PDO::FETCH_ASSOC)['file']);
        $this->database = new SQLiteConnection($pdo, ':memory:');
        $container = new Container;
        $container->instance('db', $this->database);
        $container->instance('db.schema', $this->database->getSchemaBuilder());
        $container->instance('validator', new ValidatorFactory(new Translator(new ArrayLoader, 'en')));
        Facade::clearResolvedInstances();
        Facade::setFacadeApplication($container);
        date_default_timezone_set('Asia/Manila');
        CarbonImmutable::setTestNow(CarbonImmutable::parse(self::NOW));
        $this->createFixtureSchema();
    }

    protected function tearDown(): void
    {
        $this->database?->disconnect();
        Facade::clearResolvedInstances();
        Facade::setFacadeApplication($this->previousFacadeApplication);
        CarbonImmutable::setTestNow($this->previousTestNow);
        date_default_timezone_set($this->previousTimezone);
        parent::tearDown();
    }

    #[DataProvider('currentRuleCases')]
    public function test_current_classification_matches_separate_trees_and_sql_reference(
        array $fixture,
        string $start,
        string $end,
        string $expected,
        ?int $position,
        bool $workflowConflict,
    ): void {
        $this->loadFixture($fixture);
        $trees = $this->currentTrees($fixture);
        $flags = [];

        foreach (['blocked', 'queue'] as $category) {
            $flags[$category] = $trees[$category]->hasOverlap(self::epoch($start), self::epoch($end));
            $this->assertSame($this->sqlOverlapReference($category, $start, $end), $flags[$category], $category);
        }

        $this->assertSame($expected, self::classify($flags));
        $this->assertSame(['availability' => $expected, 'queue_position' => $position],
            (new ReservationAvailability)->forInterval(CarbonImmutable::parse($start), CarbonImmutable::parse($end)));
        $this->assertSame($workflowConflict, $this->workflowConflicts($start, $end));
    }

    public static function currentRuleCases(): iterable
    {
        $active = self::opportunity();
        $stay = self::reservation('awaiting_deposit');

        yield 'confirmed reservation' => [['reservations' => [self::reservation('confirmed')]], self::START, self::END, 'blocked', null, true];
        yield 'legacy reserved status is blocked' => [['reservations' => [self::reservation('reserved')]], self::START, self::END, 'blocked', null, true];
        yield 'pending payment with active opportunity' => [['reservations' => [$stay], 'reservation_opportunities' => [$active]], self::START, self::END, 'queue', 2, true];
        yield 'legacy held status with active opportunity' => [['reservations' => [self::reservation('held')], 'reservation_opportunities' => [$active]], self::START, self::END, 'queue', 2, true];
        yield 'payment review survives expired deadline without opportunity' => [['reservations' => [self::reservation('payment_review', ['deadline' => self::NOW])]], self::START, self::END, 'queue', 2, true];
        yield 'overdue opportunity awaits staff release' => [['reservations' => [$stay], 'reservation_opportunities' => [self::opportunity(['deposit_deadline' => '2026-11-20T10:00:00+08:00'])]], self::START, self::END, 'queue', 2, true];
        yield 'unreleased at exact deadline' => [['reservations' => [self::reservation('awaiting_deposit', ['deadline' => self::NOW])], 'reservation_opportunities' => [self::opportunity(['deposit_deadline' => self::NOW])]], self::START, self::END, 'queue', 2, true];
        yield 'expired reservation awaits staff release' => [['reservations' => [self::reservation('expired')], 'reservation_opportunities' => [self::opportunity(['status' => 'expired'])]], self::START, self::END, 'queue', 2, true];
        yield 'cancelled reservation with unreleased hold' => [['reservations' => [self::reservation('cancelled')], 'reservation_opportunities' => [$active]], self::START, self::END, 'queue', 2, true];
        yield 'staff release supersedes earlier expired opportunity' => [[
            'reservations' => [self::reservation('expired')],
            'reservation_opportunities' => [
                self::opportunity(['id' => 2, 'status' => 'revoked']),
                self::opportunity(['id' => 1, 'status' => 'expired']),
            ],
        ], self::START, self::END, 'available', null, false];
        foreach (['rejected', 'completed', 'pending', 'queued'] as $status) {
            yield $status.' does not protect dates even with a stale opportunity' => [['reservations' => [self::reservation($status)], 'reservation_opportunities' => [$active]], self::START, self::END, 'available', null, false];
        }
        yield 'unpaid reservation without opportunity differs from workflow' => [['reservations' => [$stay]], self::START, self::END, 'available', null, true];
        yield 'null deadline without opportunity differs from workflow' => [['reservations' => [self::reservation('held', ['deadline' => null])]], self::START, self::END, 'available', null, true];
        yield 'future opportunity with expired reservation deadline remains protected' => [['reservations' => [self::reservation('held', ['deadline' => self::NOW])], 'reservation_opportunities' => [$active]], self::START, self::END, 'queue', 2, true];
        yield 'revoked opportunity ignored by calendar but not workflow' => [['reservations' => [$stay], 'reservation_opportunities' => [self::opportunity(['status' => 'revoked', 'closed_at' => self::NOW])]], self::START, self::END, 'available', null, true];
        yield 'calendar does not inspect closed_at on active opportunity' => [['reservations' => [$stay], 'reservation_opportunities' => [self::opportunity(['closed_at' => self::NOW])]], self::START, self::END, 'queue', 2, true];
        yield 'unreleased admin block' => [['availability_blocks' => [self::block()]], self::START, self::END, 'blocked', null, true];
        yield 'released admin block' => [['availability_blocks' => [self::block(['released_at' => self::NOW])]], self::START, self::END, 'available', null, false];
        yield 'block exclusive end at next midnight' => [['availability_blocks' => [self::block()]], '2026-12-01T00:00:00+08:00', '2026-12-01T09:00:00+08:00', 'available', null, false];
        yield 'request ends at block start midnight' => [['availability_blocks' => [self::block()]], '2026-11-29T14:00:00+08:00', '2026-11-30T00:00:00+08:00', 'available', null, false];
        yield 'approved ocular visit is currently ignored' => [['ocular_visits' => [self::ocular()]], self::START, self::END, 'available', null, false];
        yield 'adjacent checkout and day use without cleaning protection' => [['reservations' => [self::reservation('confirmed')]], self::END, '2026-12-01T17:00:00+08:00', 'available', null, false];
        yield 'day use overlapping overnight stay' => [['reservations' => [self::reservation('confirmed', ['type' => 'day_tour', 'starts_at' => '2026-11-30T08:00:00+08:00', 'ends_at' => '2026-11-30T17:00:00+08:00'])]], self::START, self::END, 'blocked', null, true];
        yield 'adjacent same day tours' => [['reservations' => [self::reservation('confirmed', ['type' => 'day_tour', 'starts_at' => '2026-11-30T08:00:00+08:00', 'ends_at' => self::START])]], self::START, '2026-11-30T17:00:00+08:00', 'available', null, false];
        yield 'different villa is excluded' => [['reservations' => [self::reservation('confirmed', ['villa_id' => 2])], 'availability_blocks' => [self::block(['villa_id' => 2])]], self::START, self::END, 'available', null, false];
        yield 'blocked takes precedence over queue' => [['reservations' => [self::reservation('payment_review')], 'availability_blocks' => [self::block()]], self::START, self::END, 'blocked', null, true];
        yield 'overlapping duplicate holds do not change classification or lose queue counts' => [['reservations' => [$stay, self::reservation('awaiting_deposit', ['id' => 2])], 'reservation_opportunities' => [$active, self::opportunity(['id' => 2, 'reservation_id' => 2])]], self::START, self::END, 'queue', 3, true];
        yield 'waiting requests count only once a queue conflict exists' => [['reservations' => [$stay, self::reservation('pending', ['id' => 2]), self::reservation('queued', ['id' => 3])], 'reservation_opportunities' => [$active]], self::START, self::END, 'queue', 4, true];
        yield 'nested and overlapping commitments' => [['reservations' => [
            self::reservation('confirmed', ['starts_at' => '2026-11-29T14:00:00+08:00', 'ends_at' => '2026-12-03T11:00:00+08:00']),
            self::reservation('confirmed', ['id' => 2]),
            self::reservation('confirmed', ['id' => 3, 'starts_at' => '2026-11-30T16:00:00+08:00', 'ends_at' => '2026-12-02T11:00:00+08:00']),
        ]], self::START, self::END, 'blocked', null, true];
        yield 'no records' => [[], self::START, self::END, 'available', null, false];
    }

    #[DataProvider('expiredOpportunityCases')]
    public function test_pbl_expired_opportunity_requires_explicit_admin_or_owner_release(
        string $reservationStatus,
        string $opportunityStatus,
        ?string $closedAt,
        ?string $releaseRole,
        bool $protected,
    ): void {
        // The comparison uses simulated release evidence without revoking the stored opportunity.
        $fixture = [
            'reservations' => [self::reservation($reservationStatus, ['deadline' => self::NOW])],
            'reservation_opportunities' => [self::opportunity(['status' => $opportunityStatus, 'deposit_deadline' => self::NOW, 'closed_at' => $closedAt])],
            'pbl_release_events' => $releaseRole === null ? [] : [['opportunity_id' => 1, 'actor_role' => $releaseRole]],
        ];
        $this->loadFixture($fixture);
        $this->assertSame('queue', (new ReservationAvailability)->forInterval(CarbonImmutable::parse(self::START), CarbonImmutable::parse(self::END))['availability']);
        $intervals = $this->pblOpportunityIntervals($fixture);
        $tree = new AugmentedIntervalTree($intervals);
        $this->assertSame($protected, $tree->hasOverlap(self::epoch(self::START), self::epoch(self::END)));
        $this->assertSame($this->sqlPblOpportunityOverlap(self::START, self::END), $tree->hasOverlap(self::epoch(self::START), self::epoch(self::END)));
    }

    public static function expiredOpportunityCases(): iterable
    {
        foreach ([['awaiting_deposit', 'active', null], ['held', 'active', null], ['expired', 'expired', self::NOW]] as [$status, $opportunityStatus, $closedAt]) {
            foreach ([null, 'guest', 'admin', 'owner'] as $role) {
                yield $status.' released by '.($role ?? 'nobody') => [$status, $opportunityStatus, $closedAt, $role, ! in_array($role, ['admin', 'owner'], true)];
            }
        }
    }

    public function test_pbl_release_removes_only_its_target_and_does_not_promote_waiting_requests(): void
    {
        $fixture = [
            'reservations' => [
                self::reservation('expired', ['deadline' => self::NOW]),
                self::reservation('expired', ['id' => 2, 'starts_at' => '2026-11-30T16:00:00+08:00', 'deadline' => self::NOW]),
                self::reservation('queued', ['id' => 3]),
            ],
            'reservation_opportunities' => [
                self::opportunity(['status' => 'expired', 'deposit_deadline' => self::NOW, 'closed_at' => self::NOW]),
                self::opportunity(['id' => 2, 'reservation_id' => 2, 'status' => 'expired', 'deposit_deadline' => self::NOW, 'closed_at' => self::NOW]),
            ],
            'pbl_release_events' => [['opportunity_id' => 1, 'actor_role' => 'admin']],
        ];
        $this->loadFixture($fixture);
        $before = $this->database->table('reservations')->orderBy('id')->get()->all();
        $intervals = $this->pblOpportunityIntervals($fixture);
        $this->assertCount(1, $intervals);
        $tree = new AugmentedIntervalTree($intervals);
        foreach ([['2026-11-30T14:00:00+08:00', '2026-11-30T15:00:00+08:00', false], ['2026-11-30T16:00:00+08:00', self::END, true]] as [$start, $end, $protected]) {
            $this->assertSame($protected, $tree->hasOverlap(self::epoch($start), self::epoch($end)));
            $this->assertSame($this->sqlPblOpportunityOverlap($start, $end), $protected);
        }
        $this->assertEquals($before, $this->database->table('reservations')->orderBy('id')->get()->all());
        $this->assertSame('queued', $this->database->table('reservations')->where('id', 3)->value('status'));
        $this->assertSame(2, $this->database->table('reservation_opportunities')->count());
    }

    #[DataProvider('ocularProjectionCases')]
    public function test_pbl_ocular_projection_is_separate_from_current_behavior(string $status, string $expected): void
    {
        $this->loadFixture(['ocular_visits' => [self::ocular(['status' => $status])]]);
        $this->assertSame('available', (new ReservationAvailability)->forInterval(CarbonImmutable::parse(self::START), CarbonImmutable::parse(self::END))['availability']);
        // The PBL protects approved visit times, not an entire calendar date.
        $intervals = $status === 'approved' ? [
            ['category' => 'blocked', 'start' => '2026-11-30T15:00:00+08:00', 'end' => '2026-11-30T16:00:00+08:00'],
        ] : [];
        $this->assertProtectedProjection($intervals, self::START, self::END, $expected);
        $this->assertProtectedProjection($intervals, self::START, '2026-11-30T15:00:00+08:00', 'available');
        $this->assertProtectedProjection($intervals, '2026-11-30T16:00:00+08:00', '2026-11-30T17:00:00+08:00', 'available');
    }

    public static function ocularProjectionCases(): iterable
    {
        yield 'approved' => ['approved', 'blocked'];
        yield 'pending approval' => ['pending_review', 'available'];
        yield 'cancelled' => ['cancelled', 'available'];
    }

    #[DataProvider('cleaningProjectionCases')]
    public function test_pbl_two_hour_cleaning_buffer_is_opt_in_and_only_for_protected_overnight_stays(string $type, bool $requiresCleaning, string $expected, string $status = 'confirmed'): void
    {
        $reservation = self::reservation($status, ['type' => $type]);
        if ($type === 'day_tour') {
            $reservation['starts_at'] = '2026-12-01T08:00:00+08:00';
        }
        $this->loadFixture(['reservations' => [$reservation], 'reservation_opportunities' => [self::opportunity()]]);
        $start = CarbonImmutable::parse(self::END);
        $end = $start->addMinutes(30);
        $this->assertSame('available', (new ReservationAvailability)->forInterval($start, $end)['availability']);

        // Experimental PBL rule; requiresCleaning is fixture metadata, not a DB column.
        $effectiveEnd = $type === 'overnight' && $requiresCleaning ? $start->addMinutes(120) : $start;
        $category = in_array($status, ['confirmed', 'reserved'], true) ? 'blocked' : 'queue';
        $protection = [
            ['category' => $category, 'start' => $reservation['starts_at'], 'end' => $effectiveEnd->toIso8601String()],
        ];
        $this->assertProtectedProjection($protection, $start->toIso8601String(), $end->toIso8601String(), $expected);
        $this->assertProtectedProjection($protection, '2026-12-01T12:30:00+08:00', '2026-12-01T13:00:00+08:00', $expected);
        $this->assertProtectedProjection($protection, '2026-12-01T13:00:00+08:00', '2026-12-01T14:00:00+08:00', 'available');
    }

    public static function cleaningProjectionCases(): iterable
    {
        yield 'overnight requiring cleaning' => ['overnight', true, 'blocked'];
        yield 'overnight without cleaning requirement' => ['overnight', false, 'available'];
        yield 'day use with a cleaning flag does not receive the overnight policy' => ['day_tour', true, 'available'];
        yield 'day use without cleaning' => ['day_tour', false, 'available'];
        yield 'protected unpaid stay keeps queue classification through cleaning' => ['overnight', true, 'queue', 'awaiting_deposit'];
        yield 'payment review keeps queue classification through cleaning' => ['overnight', true, 'queue', 'payment_review'];
    }

    public function test_normalization_supports_offsets_naive_manila_values_and_midnight_blocks(): void
    {
        $this->assertSame(self::epoch(self::START), self::epoch('2026-11-30T06:00:00Z'));
        $this->assertSame(self::epoch(self::START), self::epoch('2026-11-30 14:00:00'));
        $this->assertSame(self::epoch(self::START), self::epoch('2026-11-30T01:00:00-05:00'));
        $this->assertProtectedProjection([
            ['category' => 'blocked', 'start' => '2026-11-30T06:00:00Z', 'end' => '2026-12-01T03:00:00Z'],
            ['category' => 'blocked', 'start' => '2026-12-02', 'end' => '2026-12-03'],
        ], self::START, self::END, 'blocked');
        $this->assertProtectedProjection([
            ['category' => 'blocked', 'start' => '2026-12-02', 'end' => '2026-12-03'],
        ], '2026-12-01T16:00:00Z', '2026-12-01T17:00:00Z', 'blocked');
    }

    public function test_available_nights_uses_noon_instead_of_the_quoted_eleven_am_checkout(): void
    {
        $this->loadFixture(['reservations' => [self::reservation('confirmed', [
            'type' => 'day_tour', 'starts_at' => '2026-12-01T11:30:00+08:00', 'ends_at' => '2026-12-01T11:45:00+08:00',
        ])]]);
        $service = new ReservationAvailability;
        $this->assertSame('available', $service->forInterval(CarbonImmutable::parse(self::START), CarbonImmutable::parse(self::END))['availability']);
        $date = CarbonImmutable::parse('2026-11-30', 'Asia/Manila');
        $this->assertSame(0, $service->availableNights($date, $date));
    }

    public function test_mixed_offset_records_match_sql_instant_comparisons_independently_of_php_default_timezone(): void
    {
        $fixture = ['reservations' => [
            self::reservation('confirmed', ['starts_at' => '2026-11-30T06:00:00Z', 'ends_at' => '2026-12-01T03:00:00Z']),
            self::reservation('payment_review', ['id' => 2, 'starts_at' => '2026-11-30T01:00:00-05:00', 'ends_at' => '2026-12-01T03:00:00Z']),
        ]];
        $this->loadFixture($fixture);
        date_default_timezone_set('UTC');
        $trees = $this->currentTrees($fixture);
        foreach (['blocked', 'queue'] as $category) {
            $this->assertTrue($this->sqlOverlapReference($category, self::START, self::END));
            $this->assertTrue($trees[$category]->hasOverlap(self::epoch(self::START), self::epoch(self::END)));
            $this->assertFalse($this->sqlOverlapReference($category, self::END, '2026-12-01T12:00:00+08:00'));
            $this->assertFalse($trees[$category]->hasOverlap(self::epoch(self::END), self::epoch('2026-12-01T12:00:00+08:00')));
        }
        $this->assertSame(self::epoch('2026-11-30 14:00:00'), CarbonImmutable::parse('2026-11-30 14:00:00', 'Asia/Manila')->getTimestamp());
    }

    public function test_available_nights_does_not_check_blocks_on_the_checkout_morning(): void
    {
        $this->loadFixture(['availability_blocks' => [self::block(['starts_on' => '2026-12-01', 'ends_on' => '2026-12-02'])]]);
        $service = new ReservationAvailability;
        $this->assertSame('blocked', $service->forInterval(CarbonImmutable::parse(self::START), CarbonImmutable::parse(self::END))['availability']);
        $date = CarbonImmutable::parse('2026-11-30', 'Asia/Manila');
        $this->assertSame(1, $service->availableNights($date, $date));
    }

    public function test_workflow_can_exclude_unpaid_conflicts_and_the_candidate_itself(): void
    {
        $this->loadFixture(['reservations' => [self::reservation('payment_review')]]);
        $this->assertTrue($this->workflowConflicts(self::START, self::END));
        $this->assertFalse($this->workflowConflicts(self::START, self::END, false));
        $flow = new ReservationWorkflow(new AdminNotificationService);
        $flow->available((object) self::reservation('payment_review'));
        $this->addToAssertionCount(1);
        $this->database->table('reservations')->update(['status' => 'confirmed']);
        $this->assertTrue($this->workflowConflicts(self::START, self::END, false));
        $this->database->table('reservations')->delete();
        $this->loadFixture(['availability_blocks' => [self::block()]]);
        $this->assertTrue($this->workflowConflicts(self::START, self::END, false));
    }

    private function createFixtureSchema(): void
    {
        $schema = $this->database->getSchemaBuilder();
        $schema->create('reservations', function (Blueprint $table): void {
            $table->integer('id')->primary();
            $table->integer('villa_id');
            $table->string('status');
            $table->string('type');
            $table->string('starts_at');
            $table->string('ends_at');
            $table->string('deadline')->nullable();
        });
        $schema->create('reservation_opportunities', function (Blueprint $table): void {
            $table->integer('id')->primary();
            $table->integer('reservation_id');
            $table->string('status');
            $table->string('deposit_deadline');
            $table->string('closed_at')->nullable();
        });
        $schema->create('availability_blocks', function (Blueprint $table): void {
            $table->integer('id')->primary();
            $table->integer('villa_id');
            $table->string('starts_on');
            $table->string('ends_on');
            $table->string('released_at')->nullable();
        });
        $schema->create('ocular_visits', function (Blueprint $table): void {
            $table->integer('id')->primary();
            $table->integer('villa_id');
            $table->string('status');
            $table->string('visit_date');
            $table->string('start_time');
            $table->string('end_time');
        });
        $schema->create('pbl_protected_intervals', function (Blueprint $table): void {
            $table->string('category');
            $table->bigInteger('start_epoch');
            $table->bigInteger('end_epoch');
        });
        $schema->create('pbl_release_events', function (Blueprint $table): void {
            $table->integer('opportunity_id');
            $table->string('actor_role');
        });
    }

    private function loadFixture(array $fixture): void
    {
        foreach ($fixture as $table => $records) {
            if ($records !== []) {
                $this->database->table($table)->insert($records);
            }
        }
    }

    /** @return array{blocked: AugmentedIntervalTree, queue: AugmentedIntervalTree} */
    private function currentTrees(array $fixture): array
    {
        $intervals = ['blocked' => [], 'queue' => []];
        foreach ($fixture['reservations'] ?? [] as $reservation) {
            if ($reservation['villa_id'] !== 1) {
                continue;
            }
            $category = match ($reservation['status']) {
                'confirmed', 'reserved' => 'blocked',
                'payment_review' => 'queue',
                default => null,
            };
            if (in_array($reservation['status'], ['held', 'awaiting_deposit', 'expired', 'cancelled'], true)) {
                $latest = null;
                foreach ($fixture['reservation_opportunities'] ?? [] as $opportunity) {
                    if ($opportunity['reservation_id'] === $reservation['id']
                        && ($latest === null || $opportunity['id'] > $latest['id'])) {
                        $latest = $opportunity;
                    }
                }
                if ($latest !== null && in_array($latest['status'], ['active', 'expired'], true)) {
                    $category = 'queue';
                }
            }
            if ($category !== null) {
                $intervals[$category][] = ['start' => self::epoch($reservation['starts_at']), 'end' => self::epoch($reservation['ends_at'])];
            }
        }
        foreach ($fixture['availability_blocks'] ?? [] as $block) {
            if ($block['villa_id'] === 1 && $block['released_at'] === null) {
                $intervals['blocked'][] = ['start' => self::epoch($block['starts_on']), 'end' => self::epoch($block['ends_on'])];
            }
        }

        return ['blocked' => new AugmentedIntervalTree($intervals['blocked']), 'queue' => new AugmentedIntervalTree($intervals['queue'])];
    }

    private function sqlOverlapReference(string $category, string $start, string $end): bool
    {
        // Independent SQL selection over raw records, not the tree's interval list.
        $sql = <<<'SQL'
            SELECT EXISTS (
                SELECT 1 FROM reservations r
                WHERE r.villa_id = 1
                  AND julianday(r.starts_at) < julianday(:end)
                  AND julianday(r.ends_at) > julianday(:start)
                  AND (
                    (:category = 'blocked' AND r.status IN ('confirmed', 'reserved'))
                    OR (:category = 'queue' AND (
                        r.status = 'payment_review'
                        OR (r.status IN ('held', 'awaiting_deposit', 'expired', 'cancelled') AND (
                            SELECT o.status FROM reservation_opportunities o
                            WHERE o.reservation_id = r.id ORDER BY o.id DESC LIMIT 1
                        ) IN ('active', 'expired'))
                    ))
                  )
                UNION ALL
                SELECT 1 FROM availability_blocks b
                WHERE :category = 'blocked' AND b.villa_id = 1 AND b.released_at IS NULL
                  AND julianday(b.starts_on || 'T00:00:00+08:00') < julianday(:end)
                  AND julianday(b.ends_on || 'T00:00:00+08:00') > julianday(:start)
            )
            SQL;
        $statement = $this->database->getPdo()->prepare($sql);
        $statement->execute(['category' => $category, 'start' => $start, 'end' => $end]);

        return (bool) $statement->fetchColumn();
    }

    private function assertProtectedProjection(array $intervals, string $start, string $end, string $expected): void
    {
        $this->database->table('pbl_protected_intervals')->delete();
        $flags = [];
        foreach (['blocked', 'queue'] as $category) {
            $selected = [];
            foreach ($intervals as $interval) {
                if ($interval['category'] === $category) {
                    $selected[] = ['start' => self::epoch($interval['start']), 'end' => self::epoch($interval['end'])];
                    $this->database->table('pbl_protected_intervals')->insert([
                        'category' => $category, 'start_epoch' => self::epoch($interval['start']), 'end_epoch' => self::epoch($interval['end']),
                    ]);
                }
            }
            $flags[$category] = (new AugmentedIntervalTree($selected))->hasOverlap(self::epoch($start), self::epoch($end));
            $statement = $this->database->getPdo()->prepare(
                'SELECT EXISTS (SELECT 1 FROM pbl_protected_intervals WHERE category = ? AND start_epoch < ? AND end_epoch > ?)'
            );
            $statement->execute([$category, self::epoch($end), self::epoch($start)]);
            $this->assertSame((bool) $statement->fetchColumn(), $flags[$category]);
        }
        $this->assertSame($expected, self::classify($flags));
    }

    /** @return list<array{start: int, end: int}> */
    private function pblOpportunityIntervals(array $fixture): array
    {
        $released = [];
        foreach ($fixture['pbl_release_events'] ?? [] as $release) {
            if (in_array($release['actor_role'], ['admin', 'owner'], true)) {
                $released[$release['opportunity_id']] = true;
            }
        }
        $intervals = [];
        foreach ($fixture['reservation_opportunities'] ?? [] as $opportunity) {
            if (isset($released[$opportunity['id']]) || ! in_array($opportunity['status'], ['active', 'expired'], true)) {
                continue;
            }
            foreach ($fixture['reservations'] ?? [] as $reservation) {
                if ($reservation['id'] === $opportunity['reservation_id'] && $reservation['villa_id'] === 1
                    && in_array($reservation['status'], ['held', 'awaiting_deposit', 'expired'], true)) {
                    $intervals[] = ['start' => self::epoch($reservation['starts_at']), 'end' => self::epoch($reservation['ends_at'])];
                }
            }
        }

        return $intervals;
    }

    private function sqlPblOpportunityOverlap(string $start, string $end): bool
    {
        $statement = $this->database->getPdo()->prepare(<<<'SQL'
            SELECT EXISTS (
                SELECT 1 FROM reservations r JOIN reservation_opportunities o ON o.reservation_id = r.id
                WHERE r.villa_id = 1 AND r.status IN ('held', 'awaiting_deposit', 'expired')
                  AND o.status IN ('active', 'expired')
                  AND julianday(r.starts_at) < julianday(:end) AND julianday(r.ends_at) > julianday(:start)
                  AND NOT EXISTS (
                    SELECT 1 FROM pbl_release_events e WHERE e.opportunity_id = o.id AND e.actor_role IN ('admin', 'owner')
                  )
            )
            SQL);
        $statement->execute(['start' => $start, 'end' => $end]);

        return (bool) $statement->fetchColumn();
    }

    private function workflowConflicts(string $start, string $end, bool $includeUnpaid = true): bool
    {
        try {
            (new ReservationWorkflow(new AdminNotificationService))->available((object) [
                'id' => 999, 'villa_id' => 1, 'starts_at' => $start, 'ends_at' => $end,
            ], $includeUnpaid);
        } catch (ValidationException $exception) {
            $this->assertArrayHasKey('dates', $exception->errors());

            return true;
        }

        return false;
    }

    private static function epoch(string $value): int
    {
        // Native DateTime is independent of Carbon used in the real services.
        return (new DateTimeImmutable($value, new DateTimeZone('Asia/Manila')))->getTimestamp();
    }

    private static function classify(array $flags): string
    {
        return $flags['blocked'] ? 'blocked' : ($flags['queue'] ? 'queue' : 'available');
    }

    private static function reservation(string $status, array $overrides = []): array
    {
        return array_replace([
            'id' => 1, 'villa_id' => 1, 'status' => $status, 'type' => 'overnight',
            'starts_at' => self::START, 'ends_at' => self::END, 'deadline' => '2026-11-22T10:00:00+08:00',
        ], $overrides);
    }

    private static function opportunity(array $overrides = []): array
    {
        return array_replace([
            'id' => 1, 'reservation_id' => 1, 'status' => 'active',
            'deposit_deadline' => '2026-11-22T10:00:00+08:00', 'closed_at' => null,
        ], $overrides);
    }

    private static function block(array $overrides = []): array
    {
        return array_replace([
            'id' => 1, 'villa_id' => 1, 'starts_on' => '2026-11-30', 'ends_on' => '2026-12-01', 'released_at' => null,
        ], $overrides);
    }

    private static function ocular(array $overrides = []): array
    {
        return array_replace([
            'id' => 1, 'villa_id' => 1, 'status' => 'approved', 'visit_date' => '2026-11-30',
            'start_time' => '15:00:00', 'end_time' => '16:00:00',
        ], $overrides);
    }
}
