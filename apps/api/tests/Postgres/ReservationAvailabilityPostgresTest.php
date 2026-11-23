<?php

declare(strict_types=1);

namespace Tests\Postgres;

use App\Services\Algorithms\PostgresAvailabilitySnapshotReader;
use App\Services\Algorithms\ReservationAvailabilityShadow;
use App\Services\Algorithms\ReservationIntervalTreeBuilder;
use App\Services\ReservationAvailability;
use Carbon\CarbonImmutable;
use Closure;
use Illuminate\Contracts\View\Factory as ViewFactory;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Events\Dispatcher;
use Illuminate\Routing\Redirector;
use Illuminate\Routing\ResponseFactory;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Tests\Support\AvailabilityShadowTestEnvironment;
use Tests\Support\DisposablePostgresCluster;
use Tests\Support\IsolatedAvailabilityHttpApplication;
use Tests\Support\PostgresShadowFixture;
use Tests\Support\ReservationIntervalFixtures as Fixtures;
use Tests\Unit\ReservationIntervalTreeCompatibilityTest;

final class ReservationAvailabilityPostgresTest extends TestCase
{
    private ?PostgresShadowFixture $fixture = null;

    private ?AvailabilityShadowTestEnvironment $environment = null;

    private ?IsolatedAvailabilityHttpApplication $http = null;

    /** @var array<int, ReservationAvailabilityShadow> */
    private array $shadows = [];

    private static array $totals = ['comparisons' => 0, 'matches' => 0, 'mismatches' => 0, 'inconclusive' => 0,
        'errors' => 0, 'builds' => 0, 'snapshot_probes' => 0];

    protected function setUp(): void
    {
        parent::setUp();
        if (! getenv('RBMS_STEP4A_MANIFEST')) {
            $this->markTestSkipped('Run only through the verified disposable PostgreSQL runner.');
        }
        $this->fixture = new PostgresShadowFixture(new DisposablePostgresCluster);
        $this->environment = new AvailabilityShadowTestEnvironment($this->fixture->database,
            new PostgresAvailabilitySnapshotReader($this->fixture->database));
    }

    protected function tearDown(): void
    {
        foreach ($this->shadows as $shadow) {
            foreach (array_keys(self::$totals) as $key) {
                self::$totals[$key] += $shadow->counts()[$key];
            }
        }
        if ($this->http !== null) {
            $this->http->close();
        } else {
            $this->environment?->close();
        }
        $this->fixture?->close();
        parent::tearDown();
    }

    public static function tearDownAfterClass(): void
    {
        echo PHP_EOL.'POSTGRES_SHADOW_COUNTS '.json_encode(self::$totals, JSON_THROW_ON_ERROR).PHP_EOL;
        parent::tearDownAfterClass();
    }

    #[DataProvider('currentCases')]
    public function test_current_policy_and_queue_positions_match_on_postgres(array $records, string $start, string $end, string $expected, ?int $position): void
    {
        Fixtures::load($this->fixture->database, $records);
        $before = $this->recordState();
        $shadow = $this->shadow();
        $result = (new ReservationAvailability($shadow))->forInterval(CarbonImmutable::parse($start), CarbonImmutable::parse($end));
        $this->assertSame(['availability' => $expected, 'queue_position' => $position], $result);
        $this->assertSame(1, $shadow->counts()['matches']);
        $this->assertSame(0, $shadow->counts()['mismatches']);
        $this->assertSame($before, $this->recordState());
    }

    public static function currentCases(): iterable
    {
        foreach (ReservationIntervalTreeCompatibilityTest::currentRuleCases() as $name => $case) {
            yield $name => array_slice($case, 0, 5);
        }
    }

    public function test_disabled_mode_adds_no_postgres_queries_and_43_checks_build_once_when_enabled(): void
    {
        Fixtures::load($this->fixture->database, ['reservations' => [Fixtures::reservation(['status' => 'payment_review'])]]);
        $database = $this->fixture->database;
        $database->enableQueryLog();
        $original = $this->check(new ReservationAvailability);
        $baseline = array_map(fn (array $query) => [$query['query'], $query['bindings']], $database->getQueryLog());
        $database->flushQueryLog();
        $disabled = $this->shadow(false);
        $this->assertSame($original, $this->check(new ReservationAvailability($disabled)));
        $this->assertSame($baseline, array_map(fn (array $query) => [$query['query'], $query['bindings']], $database->getQueryLog()));
        $this->assertSame(0, $disabled->counts()['snapshot_probes']);
        $this->assertSame(0, $disabled->counts()['builds']);
        $this->assertSame([], $this->environment->logger->events);
        $database->flushQueryLog();
        $shadow = $this->shadow();
        $availability = new ReservationAvailability($shadow);
        for ($i = 0; $i < 43; $i++) {
            $this->assertSame($original, $this->check($availability));
        }
        $this->assertSame(43, $shadow->counts()['matches']);
        $this->assertSame(45, $shadow->counts()['snapshot_probes']);
        $this->assertSame(1, $shadow->counts()['builds']);
        $this->assertCount(43 * count($baseline) + 46, $database->getQueryLog());
        foreach ($database->getQueryLog() as $query) {
            $this->assertMatchesRegularExpression('/^\s*\(*\s*select\b/i', $query['query']);
        }
    }

    #[DataProvider('timezones')]
    public function test_timestamptz_offsets_and_manila_half_open_boundaries(string $timezone): void
    {
        $this->fixture->database->statement("SET TIME ZONE '".$timezone."'");
        Fixtures::load($this->fixture->database, ['reservations' => [Fixtures::reservation([
            'starts_at' => '2026-11-30T06:00:00Z', 'ends_at' => '2026-11-30T22:00:00-05:00',
        ])]]);
        $shadow = $this->shadow();
        $availability = new ReservationAvailability($shadow);
        $this->assertSame(['availability' => 'blocked', 'queue_position' => null], $this->check($availability));
        $this->assertSame(['availability' => 'available', 'queue_position' => null], $availability->forInterval(
            CarbonImmutable::parse(Fixtures::END), CarbonImmutable::parse('2026-12-01T12:00:00+08:00')));
        $this->assertSame(2, $shadow->counts()['matches']);
    }

    public static function timezones(): iterable
    {
        yield 'Manila session' => ['Asia/Manila'];
        yield 'UTC session' => ['UTC'];
        yield 'New York session' => ['America/New_York'];
    }

    public function test_committed_change_between_original_sql_reads_is_inconclusive(): void
    {
        $reader = $this->fixture->database;
        $reader->setEventDispatcher(new Dispatcher($this->environment->container));
        $changed = false;
        $reader->listen(function (QueryExecuted $query) use (&$changed): void {
            if (! $changed && str_contains($query->sql, 'select exists') && str_contains($query->sql, 'reservations')) {
                $changed = true;
                Fixtures::load($this->fixture->writer, ['reservations' => [Fixtures::reservation()]]);
            }
        });
        $shadow = $this->shadow();
        $availability = new ReservationAvailability($shadow);
        $this->assertSame(['availability' => 'available', 'queue_position' => null], $this->check($availability));
        $this->assertTrue($changed);
        $this->assertSame(1, $shadow->counts()['inconclusive']);
        $this->assertSame(0, $shadow->counts()['matches']);
        $this->assertSame(0, $shadow->counts()['mismatches']);
        $this->assertSame(['availability' => 'blocked', 'queue_position' => null], $this->check($availability));
        $this->assertSame(1, $shadow->counts()['matches']);
    }

    public function test_committed_change_during_tree_construction_is_inconclusive(): void
    {
        $shadow = $this->shadow(factory: function (CarbonImmutable $asOf) {
            $trees = (new ReservationIntervalTreeBuilder($this->fixture->database))->build(1, $asOf);
            Fixtures::load($this->fixture->writer, ['reservations' => [Fixtures::reservation()]]);

            return $trees;
        });
        $this->assertSame(['availability' => 'available', 'queue_position' => null], $this->check(new ReservationAvailability($shadow)));
        $this->assertSame(1, $shadow->counts()['inconclusive']);
        $this->assertSame(0, $shadow->counts()['matches']);
        $this->assertSame(0, $shadow->counts()['mismatches']);
    }

    public function test_opportunity_change_between_classification_and_count_preserves_original_response(): void
    {
        Fixtures::load($this->fixture->database, [
            'reservations' => [Fixtures::reservation(['status' => 'awaiting_deposit'])],
            'reservation_opportunities' => [Fixtures::opportunity()],
        ]);
        $changed = false;
        $this->fixture->database->setEventDispatcher(new Dispatcher($this->environment->container));
        $this->fixture->database->listen(function (QueryExecuted $query) use (&$changed): void {
            if (! $changed && str_contains($query->sql, 'select exists') && str_contains($query->sql, 'reservation_opportunities')) {
                $changed = true;
                $this->fixture->writer->table('reservation_opportunities')->update(['status' => 'revoked']);
            }
        });
        $shadow = $this->shadow();
        $this->assertSame(['availability' => 'queue', 'queue_position' => 1], $this->check(new ReservationAvailability($shadow)));
        $this->assertTrue($changed);
        $this->assertSame(1, $shadow->counts()['inconclusive']);
        $this->assertSame(0, $shadow->counts()['matches']);
    }

    public function test_uncommitted_writer_is_invisible_and_commit_invalidates_cached_trees(): void
    {
        $writer = $this->fixture->writer;
        $writer->beginTransaction();
        try {
            Fixtures::load($writer, ['reservations' => [Fixtures::reservation()]]);
            $shadow = $this->shadow();
            $availability = new ReservationAvailability($shadow);
            $this->assertSame(['availability' => 'available', 'queue_position' => null], $this->check($availability));
            $this->assertSame(1, $shadow->counts()['matches']);
            $writer->commit();
            $this->assertSame(['availability' => 'blocked', 'queue_position' => null], $this->check($availability));
            $this->assertSame(1, $shadow->counts()['inconclusive']);
            $this->assertSame(0, $shadow->counts()['mismatches']);
            $this->check($availability);
            $this->assertSame(2, $shadow->counts()['matches']);
        } finally {
            if ($writer->transactionLevel() > 0) {
                $writer->rollBack();
            }
        }
    }

    #[DataProvider('isolations')]
    public function test_existing_transaction_is_inconclusive_without_changing_its_isolation(string $isolation): void
    {
        $database = $this->fixture->database;
        $database->beginTransaction();
        try {
            $database->statement('SET TRANSACTION ISOLATION LEVEL '.$isolation);
            Fixtures::load($database, ['reservations' => [Fixtures::reservation()]]);
            $shadow = $this->shadow();
            $this->assertSame(['availability' => 'blocked', 'queue_position' => null], $this->check(new ReservationAvailability($shadow)));
            $this->assertSame(1, $shadow->counts()['inconclusive']);
            $this->assertSame(0, $shadow->counts()['snapshot_probes']);
            $this->assertSame(strtolower($isolation), $database->selectOne("SELECT current_setting('transaction_isolation') AS isolation")->isolation);
            $this->assertSame(1, $database->transactionLevel());
        } finally {
            $database->rollBack();
        }
    }

    public static function isolations(): iterable
    {
        yield 'read committed' => ['READ COMMITTED'];
        yield 'repeatable read' => ['REPEATABLE READ'];
        yield 'serializable' => ['SERIALIZABLE'];
    }

    #[DataProvider('authenticatedUsers')]
    public function test_guest_admin_owner_api_on_and_off_use_real_provider_and_postgres(int $user): void
    {
        Fixtures::load($this->fixture->database, ['reservations' => [Fixtures::reservation(['status' => 'payment_review'])]]);
        $this->startHttp();
        $session = $this->http->login($user);
        $query = ['start' => '2026-11-30', 'end' => '2026-12-02', 'type' => 'overnight',
            'duration_days' => 1, 'checkin_time' => '14:00', 'checkout_time' => '11:00'];
        $before = $this->recordState();
        $original = $this->http->get('/api/availability', $query, $session);
        $this->assertSame(200, $original->getStatusCode(), $original->getContent());
        $this->assertFalse($this->http->app->resolved(ReservationAvailabilityShadow::class));
        $this->assertSame([], $this->environment->logger->events);
        $enabled = $this->http->get('/api/availability', $query, $session, shadow: true);
        $this->assertSame(200, $enabled->getStatusCode(), $enabled->getContent());
        $this->assertSame($original->getContent(), $enabled->getContent());
        $this->assertSame(['dates' => ['2026-11-30' => 'queue', '2026-12-01' => 'available', '2026-12-02' => 'available']], json_decode($enabled->getContent(), true, flags: JSON_THROW_ON_ERROR));
        $shadow = $this->http->app->make(ReservationAvailabilityShadow::class);
        $this->shadows[spl_object_id($shadow)] = $shadow;
        $this->assertSame(3, $shadow->counts()['matches']);
        $this->assertSame(0, $shadow->counts()['mismatches']);
        $this->assertSame(1, $shadow->counts()['builds']);
        $this->assertSame($before, $this->recordState());
    }

    public static function authenticatedUsers(): iterable
    {
        yield 'Guest' => [1];
        yield 'Admin' => [3];
        yield 'Owner' => [4];
    }

    private function startHttp(): void
    {
        $this->http = new IsolatedAvailabilityHttpApplication(
            new ResponseFactory($this->createMock(ViewFactory::class), $this->createMock(Redirector::class)),
            $this->environment, productionShadow: true);
    }

    private function shadow(bool $enabled = true, ?Closure $factory = null): ReservationAvailabilityShadow
    {
        $shadow = $this->environment->shadow($enabled, $factory);
        $this->shadows[spl_object_id($shadow)] = $shadow;

        return $shadow;
    }

    private function check(ReservationAvailability $availability): array
    {
        return $availability->forInterval(CarbonImmutable::parse(Fixtures::START), CarbonImmutable::parse(Fixtures::END));
    }

    private function recordState(): array
    {
        return array_map(fn (string $table) => $this->fixture->database->table($table)->orderBy('id')->get()->map(fn ($row) => (array) $row)->all(),
            ['reservations', 'reservation_opportunities', 'availability_blocks', 'ocular_visits']);
    }
}
