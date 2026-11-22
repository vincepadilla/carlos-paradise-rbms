<?php

declare(strict_types=1);

namespace Tests\Unit;

use App\Http\Controllers\ReservationAvailabilityController;
use App\Http\Controllers\ReservationSettingsController;
use App\Providers\AppServiceProvider;
use App\Services\Algorithms\PostgresAvailabilitySnapshotReader;
use App\Services\Algorithms\ReservationAvailabilityShadow;
use App\Services\Algorithms\ReservationIntervalMode;
use App\Services\Algorithms\ReservationIntervalTrees;
use App\Services\ReservationAvailability;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Routing\ResponseFactory as ResponseFactoryContract;
use Illuminate\Contracts\View\Factory as ViewFactory;
use Illuminate\Database\Connectors\ConnectionFactory;
use Illuminate\Database\DatabaseManager;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Database\PostgresConnection;
use Illuminate\Database\QueryException;
use Illuminate\Events\Dispatcher;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Routing\Redirector;
use Illuminate\Routing\ResponseFactory;
use PDO;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Psr\Log\LoggerInterface;
use RuntimeException;
use Tests\Support\AvailabilityShadowTestEnvironment;
use Tests\Support\ReservationIntervalFixtures as Fixtures;

final class ReservationAvailabilityShadowTest extends TestCase
{
    private AvailabilityShadowTestEnvironment $environment;

    protected function setUp(): void
    {
        parent::setUp();
        $this->assertSame('testing', getenv('APP_ENV'));
        $this->assertSame('sqlite', getenv('DB_CONNECTION'));
        $this->assertSame(':memory:', getenv('DB_DATABASE'));
        $this->assertSame('', getenv('DB_URL'));
        $this->environment = new AvailabilityShadowTestEnvironment;
    }

    protected function tearDown(): void
    {
        $this->environment->close();
        parent::tearDown();
    }

    public function test_disabled_shadow_does_no_work_and_leaves_the_sql_response_and_queries_unchanged(): void
    {
        Fixtures::load($this->environment->database, ['reservations' => [Fixtures::reservation(['status' => 'payment_review'])]]);
        $this->environment->database->enableQueryLog();
        $original = $this->call(new ReservationAvailability);
        $originalQueries = $this->environment->database->getQueryLog();
        $this->environment->database->flushQueryLog();
        $shadow = $this->environment->shadow(false, fn () => throw new RuntimeException('Must not build.'));
        $this->assertSame($original, $this->call(new ReservationAvailability($shadow)));
        $this->assertSame(array_column($originalQueries, 'query'), array_column($this->environment->database->getQueryLog(), 'query'));
        $this->assertSame(0, $shadow->counts()['comparisons']);
        $this->assertSame(0, $this->environment->snapshots->reads);
        $this->assertSame([], $this->environment->logger->events);
    }

    #[DataProvider('currentCases')]
    public function test_current_policy_matches_all_existing_cases_and_preserves_queue_positions(array $fixture, string $start, string $end, string $category, ?int $position): void
    {
        Fixtures::load($this->environment->database, $fixture);
        $shadow = $this->environment->shadow();
        $this->assertSame(['availability' => $category, 'queue_position' => $position],
            (new ReservationAvailability($shadow))->forInterval(CarbonImmutable::parse($start), CarbonImmutable::parse($end)));
        $this->assertSame(1, $shadow->counts()['matches']);
        $this->assertSame(0, $shadow->counts()['mismatches']);
        $this->assertSame($category, $this->lastEvent()['tree']);
    }

    public static function currentCases(): iterable
    {
        foreach (ReservationIntervalTreeCompatibilityTest::currentRuleCases() as $name => $case) {
            yield $name => array_slice($case, 0, 5);
        }
    }

    public function test_mismatch_is_recorded_but_never_replaces_sql_blocked_precedence(): void
    {
        Fixtures::load($this->environment->database, ['reservations' => [Fixtures::reservation(), Fixtures::reservation(['id' => 2, 'status' => 'payment_review'])]]);
        // Inject a simulated algorithm regression: a queue-only tree for a BLOCKED SQL result.
        $shadow = $this->environment->shadow(factory: fn () => new ReservationIntervalTrees([
            'blocked' => [], 'queue' => [['start' => CarbonImmutable::parse(Fixtures::START)->getTimestamp(), 'end' => CarbonImmutable::parse(Fixtures::END)->getTimestamp()]],
        ]));
        $this->assertSame(['availability' => 'blocked', 'queue_position' => null], $this->call(new ReservationAvailability($shadow)));
        $this->assertSame(1, $shadow->counts()['mismatches']);
        $this->assertSame('queue', $this->lastEvent()['tree']);
        $this->assertSame('warning', $this->environment->logger->events[0]['level']);
    }

    public function test_algorithm_exception_falls_back_and_does_not_log_sensitive_exception_text(): void
    {
        Fixtures::load($this->environment->database, ['reservations' => [Fixtures::reservation(['status' => 'payment_review']), Fixtures::reservation(['id' => 2, 'status' => 'queued'])]]);
        $shadow = $this->environment->shadow(factory: fn () => throw new RuntimeException('PRIVATE_TEST_MARKER: guest@example.invalid / payment / password'));
        $this->assertSame(['availability' => 'queue', 'queue_position' => 3], $this->call(new ReservationAvailability($shadow)));
        $this->assertSame(1, $shadow->counts()['errors']);
        $this->assertSame('evaluation_error', $this->lastEvent()['reason']);
        $serialized = json_encode($this->environment->logger->events, JSON_THROW_ON_ERROR);
        foreach (['PRIVATE_TEST_MARKER', 'guest@', 'password', '2026-', 'starts_at', 'reservation_id', 'isolated-fixture-state', 'isolated-fixture-autocommit'] as $private) {
            $this->assertStringNotContainsString($private, $serialized);
        }
    }

    public function test_real_normalization_failure_is_diagnostic_only(): void
    {
        Fixtures::load($this->environment->database, ['reservations' => [Fixtures::reservation(['ends_at' => '2026-12-01T11:00:00.1+08:00'])]]);
        $original = $this->call(new ReservationAvailability);
        $shadow = $this->environment->shadow();
        $this->assertSame($original, $this->call(new ReservationAvailability($shadow)));
        $this->assertSame(1, $shadow->counts()['errors']);
    }

    public function test_a_failed_build_is_not_repeated_for_every_date_in_the_same_state(): void
    {
        $shadow = $this->environment->shadow(factory: fn () => throw new RuntimeException('Synthetic build failure.'));
        $availability = new ReservationAvailability($shadow);
        for ($i = 0; $i < 43; $i++) {
            $start = CarbonImmutable::parse(Fixtures::START)->addDays($i);
            $end = CarbonImmutable::parse(Fixtures::END)->addDays($i);
            $this->assertSame(['availability' => 'available', 'queue_position' => null], $availability->forInterval($start, $end));
        }
        $this->assertSame(43, $shadow->counts()['errors']);
        $this->assertSame(1, $shadow->counts()['build_attempts']);
        $this->assertSame('previous_build_error', $this->lastEvent()['reason']);
    }

    public function test_logging_failure_cannot_change_the_original_response(): void
    {
        $this->environment->logger->fail = true;
        $shadow = $this->environment->shadow();
        $this->assertSame(['availability' => 'available', 'queue_position' => null], $this->call(new ReservationAvailability($shadow)));
        $this->assertSame(1, $shadow->counts()['matches']);
        $this->assertSame(1, $shadow->counts()['log_failures']);
    }

    #[DataProvider('snapshotChanges')]
    public function test_snapshot_changes_are_inconclusive_instead_of_mismatches(array $tokens, string $reason, int $builds): void
    {
        $this->environment->snapshots->onRead = fn (int $read) => $tokens[$read - 1] ?? end($tokens);
        $shadow = $this->environment->shadow();
        $this->assertSame(['availability' => 'available', 'queue_position' => null], $this->call(new ReservationAvailability($shadow)));
        $this->assertSame(1, $shadow->counts()['inconclusive']);
        $this->assertSame(0, $shadow->counts()['mismatches']);
        $this->assertSame($builds, $shadow->counts()['builds']);
        $this->assertSame($reason, $this->lastEvent()['reason']);
    }

    public static function snapshotChanges(): iterable
    {
        yield 'unsupported snapshot' => [[null], 'snapshot_unavailable', 0];
        yield 'calendar changes during SQL' => [['before', 'after'], 'calendar_snapshot_changed', 0];
        yield 'calendar changes during build' => [['before', 'before', 'after'], 'tree_snapshot_changed', 1];
    }

    public function test_snapshot_probe_failure_does_not_prevent_the_original_sql_from_running(): void
    {
        $this->environment->snapshots->onRead = fn () => throw new RuntimeException('Synthetic snapshot failure.');
        $shadow = $this->environment->shadow();
        $this->assertSame(['availability' => 'available', 'queue_position' => null], $this->call(new ReservationAvailability($shadow)));
        $this->assertSame('snapshot_error', $this->lastEvent()['reason']);
        $this->assertSame(1, $shadow->counts()['inconclusive']);
        $this->assertSame(1, $shadow->counts()['snapshot_failures']);
    }

    public function test_a_deadline_clock_change_makes_the_comparison_inconclusive(): void
    {
        $shadow = $this->environment->shadow();
        $observation = $shadow->begin(CarbonImmutable::parse(Fixtures::START), CarbonImmutable::parse(Fixtures::END));
        CarbonImmutable::setTestNow(CarbonImmutable::parse(Fixtures::NOW)->addSecond());
        $shadow->observe($observation, 'available');
        $this->assertSame(1, $shadow->counts()['inconclusive']);
        $this->assertSame('deadline_clock_changed', $this->lastEvent()['reason']);
        $this->assertSame(0, $shadow->counts()['builds']);
    }

    public function test_an_actual_fixture_change_after_sql_is_inconclusive_and_the_next_call_rebuilds(): void
    {
        $this->environment->snapshots->onRead = function (int $read): string {
            if ($read === 2) {
                // Controlled concurrent-writer simulation in the disposable fixture only.
                Fixtures::load($this->environment->database, ['reservations' => [Fixtures::reservation()]]);
            }

            return $read === 1 ? 'before-writer' : 'after-writer';
        };
        $shadow = $this->environment->shadow();
        $availability = new ReservationAvailability($shadow);
        $this->assertSame(['availability' => 'available', 'queue_position' => null], $this->call($availability));
        $this->assertSame(1, $shadow->counts()['inconclusive']);
        $this->assertSame(0, $shadow->counts()['mismatches']);
        $this->assertSame(0, $shadow->counts()['builds']);
        $this->assertSame(['availability' => 'blocked', 'queue_position' => null], $this->call($availability));
        $this->assertSame(1, $shadow->counts()['matches']);
        $this->assertSame(1, $shadow->counts()['builds']);
    }

    public function test_incompatible_inputs_are_not_reported_as_algorithm_mismatches(): void
    {
        $shadow = $this->environment->shadow();
        $start = CarbonImmutable::parse(Fixtures::START)->utc();
        $end = CarbonImmutable::parse(Fixtures::END)->utc();
        $original = (new ReservationAvailability)->forInterval($start, $end);
        $this->assertSame($original, (new ReservationAvailability($shadow))->forInterval($start, $end));
        $this->assertSame('unsupported_input', $this->lastEvent()['reason']);
        $this->assertSame(1, $shadow->counts()['inconclusive']);
    }

    public function test_pbl_trees_are_rejected_in_shadow_mode(): void
    {
        $shadow = $this->environment->shadow(factory: fn () => new ReservationIntervalTrees(['blocked' => [], 'queue' => []], ReservationIntervalMode::Pbl));
        $this->assertSame(['availability' => 'available', 'queue_position' => null], $this->call(new ReservationAvailability($shadow)));
        $this->assertSame(1, $shadow->counts()['errors']);
    }

    public function test_multiple_calendar_checks_build_once_and_issue_no_mutations(): void
    {
        Fixtures::load($this->environment->database, ['reservations' => [Fixtures::reservation()]]);
        $before = $this->environment->database->table('reservations')->get()->all();
        $this->environment->database->enableQueryLog();
        $shadow = $this->environment->shadow();
        $availability = new ReservationAvailability($shadow);
        for ($i = 0; $i < 43; $i++) {
            $start = CarbonImmutable::parse(Fixtures::START)->addDays($i);
            $end = CarbonImmutable::parse(Fixtures::END)->addDays($i);
            $this->assertSame((new ReservationAvailability)->forInterval($start, $end), $availability->forInterval($start, $end));
        }
        $queries = $this->environment->database->getQueryLog();
        $this->assertSame(1, $shadow->counts()['builds']);
        $this->assertSame(43, $shadow->counts()['matches']);
        $this->assertSame(0, $shadow->counts()['mismatches']);
        $this->assertCount(1, array_filter($queries, fn (array $query) => str_contains(strtolower($query['query']), 'union all')));
        foreach ($queries as $query) {
            $this->assertMatchesRegularExpression('/^select\b/i', $query['query']);
        }
        $this->assertEquals($before, $this->environment->database->table('reservations')->get()->all());
    }

    public function test_snapshot_and_clock_changes_between_calls_invalidate_request_local_trees(): void
    {
        $shadow = $this->environment->shadow();
        $availability = new ReservationAvailability($shadow);
        $this->call($availability);
        Fixtures::load($this->environment->database, ['reservations' => [Fixtures::reservation()]]);
        $this->environment->snapshots->token = 'new-fixture-state';
        $this->assertSame(['availability' => 'blocked', 'queue_position' => null], $this->call($availability));
        CarbonImmutable::setTestNow(CarbonImmutable::parse(Fixtures::NOW)->addSecond());
        $this->call($availability);
        $this->assertSame(2, $shadow->counts()['builds']);
        $this->assertSame(2, $shadow->counts()['matches']);
        $this->assertSame(1, $shadow->counts()['inconclusive']);
    }

    public function test_calendar_controller_returns_identical_json_and_reuses_one_tree(): void
    {
        Fixtures::load($this->environment->database, ['reservations' => [Fixtures::reservation()]]);
        $this->environment->container->instance(ResponseFactoryContract::class,
            new ResponseFactory($this->createMock(ViewFactory::class), $this->createMock(Redirector::class)));
        $settings = new class extends ReservationSettingsController
        {
            public function index()
            {
                return new JsonResponse(['settings' => ['min_lead_days' => 0]]);
            }
        };
        $request = new class extends Request
        {
            public function validate(array $rules): array
            {
                return app('validator')->make($this->all(), $rules)->validate();
            }
        };
        $request->query->add(['start' => '2026-11-30', 'end' => '2026-12-02', 'type' => 'overnight',
            'duration_days' => 1, 'checkin_time' => '14:00', 'checkout_time' => '11:00']);
        $controller = new ReservationAvailabilityController;
        $original = $controller->index($request, new ReservationAvailability, $settings);
        $shadow = $this->environment->shadow();
        $response = $controller->index($request, new ReservationAvailability($shadow), $settings);
        $this->assertSame(200, $response->getStatusCode());
        $this->assertSame($original->getContent(), $response->getContent());
        $this->assertSame(['dates' => ['2026-11-30' => 'blocked', '2026-12-01' => 'available', '2026-12-02' => 'available']], $response->getData(true));
        $this->assertSame(1, $shadow->counts()['builds']);
        $this->assertSame(3, $shadow->counts()['matches']);
    }

    public function test_provider_defaults_off_and_scoped_state_is_discarded_between_requests(): void
    {
        (new AppServiceProvider($this->environment->container))->register();
        $availability = $this->environment->container->make(ReservationAvailability::class);
        $this->assertSame(['availability' => 'available', 'queue_position' => null], $this->call($availability));
        $this->assertFalse($this->environment->container->resolved(ReservationAvailabilityShadow::class));
        $firstShadow = $this->environment->shadow();
        $this->environment->container->scoped(ReservationAvailabilityShadow::class, fn () => $this->environment->shadow());
        $this->environment->container->instance(ReservationAvailabilityShadow::class, $firstShadow);
        $this->environment->container['config']->set('algocom.availability_shadow.enabled', true);
        $this->environment->container->forgetScopedInstances();
        $first = $this->environment->container->make(ReservationAvailability::class);
        $this->call($first);
        $shadow = $this->environment->container->make(ReservationAvailabilityShadow::class);
        $this->assertSame(1, $shadow->counts()['matches']);
        $this->assertSame($first, $this->environment->container->make(ReservationAvailability::class));
        $this->environment->container->forgetScopedInstances();
        $second = $this->environment->container->make(ReservationAvailability::class);
        $this->assertNotSame($first, $second);
        $this->assertNotSame($shadow, $this->environment->container->make(ReservationAvailabilityShadow::class));
        $this->call($second);
        $this->assertSame(1, $this->environment->container->make(ReservationAvailabilityShadow::class)->counts()['builds']);
    }

    public function test_real_snapshot_reader_declines_sqlite_and_existing_transactions(): void
    {
        $this->assertNull((new PostgresAvailabilitySnapshotReader($this->environment->database))->read());
        $database = $this->createMock(PostgresConnection::class);
        $database->method('getDriverName')->willReturn('pgsql');
        $database->method('transactionLevel')->willReturn(1);
        $database->expects($this->never())->method('selectOne');
        $database->expects($this->never())->method('getReadPdo');
        $this->assertNull((new PostgresAvailabilitySnapshotReader($database))->read());
    }

    public function test_shadow_initialization_failure_does_not_break_container_resolution_or_sql(): void
    {
        (new AppServiceProvider($this->environment->container))->register();
        $this->environment->container['config']->set('algocom.availability_shadow.enabled', true);
        $this->environment->container->instance(LoggerInterface::class, $this->environment->logger);
        $this->environment->container->scoped(ReservationAvailabilityShadow::class,
            fn () => throw new RuntimeException('PRIVATE_INITIALIZATION_MARKER'));
        $availability = $this->environment->container->make(ReservationAvailability::class);
        $this->assertSame(['availability' => 'available', 'queue_position' => null], $this->call($availability));
        $this->assertSame(['outcome' => 'error', 'reason' => 'initialization_error'], $this->lastEvent());
        $this->assertStringNotContainsString('PRIVATE_INITIALIZATION_MARKER', json_encode($this->environment->logger->events, JSON_THROW_ON_ERROR));
    }

    public function test_real_provider_wiring_enables_shadow_but_does_not_claim_sqlite_snapshot_equivalence(): void
    {
        $container = $this->environment->container;
        $container['config']->set('algocom.availability_shadow.enabled', true);
        $container['config']->set('database.default', 'fixture');
        $container['config']->set('database.connections.fixture', ['driver' => 'sqlite', 'database' => ':memory:']);
        $manager = new DatabaseManager($container, new ConnectionFactory($container));
        $manager->extend('fixture', fn () => $this->environment->database);
        $container->instance('db', $manager);
        $container->instance(LoggerInterface::class, $this->environment->logger);
        (new AppServiceProvider($container))->register();
        $this->assertSame(['availability' => 'available', 'queue_position' => null], $this->call($container->make(ReservationAvailability::class)));
        $shadow = $container->make(ReservationAvailabilityShadow::class);
        $this->assertSame(1, $shadow->counts()['inconclusive']);
        $this->assertSame(0, $shadow->counts()['builds']);
        $this->assertSame('snapshot_unavailable', $this->lastEvent()['reason']);
    }

    public function test_original_sql_errors_are_not_swallowed_by_shadow_fallback(): void
    {
        $this->environment->database->getSchemaBuilder()->drop('reservations');
        $shadow = $this->environment->shadow();
        try {
            $this->call(new ReservationAvailability($shadow));
            $this->fail('Original SQL error was swallowed.');
        } catch (QueryException) {
            $this->assertSame(0, $shadow->counts()['comparisons']);
            $this->assertSame([], $this->environment->logger->events);
        }
    }

    public function test_unsupported_snapshot_reader_does_not_poison_a_raw_pdo_transaction(): void
    {
        $database = $this->createMock(PostgresConnection::class);
        $database->method('getDriverName')->willReturn('pgsql');
        $database->method('transactionLevel')->willReturn(0);
        $pdo = new PDO('sqlite::memory:');
        $pdo->beginTransaction();
        $database->method('getReadPdo')->willReturn($pdo);
        $database->expects($this->never())->method('selectOne');
        $this->assertNull((new PostgresAvailabilitySnapshotReader($database))->read());
        $this->assertTrue($pdo->inTransaction());
        $pdo->rollBack();
    }

    public function test_postgres_reader_uses_select_only_and_detects_backend_or_snapshot_changes(): void
    {
        $database = $this->createMock(PostgresConnection::class);
        $database->method('getDriverName')->willReturn('pgsql');
        $database->method('transactionLevel')->willReturn(0);
        $database->method('getReadPdo')->willReturn(new PDO('sqlite::memory:'));
        $states = array_map(fn ($snapshot, $backend) => (object) ['snapshot' => $snapshot, 'backend_pid' => $backend,
            'server_started' => 'test-server-epoch', 'server_address' => null, 'server_port' => null, 'in_recovery' => 0],
            ['10:20:11', '10:20:11', '10:20:11', '10:21:11'], [100, 100, 101, 101]);
        $database->expects($this->exactly(4))->method('selectOne')
            ->with($this->callback(fn (string $sql) => str_starts_with($sql, 'SELECT pg_current_snapshot()') && ! str_contains($sql, 'FOR UPDATE')))
            ->willReturnOnConsecutiveCalls(...$states);
        $reader = new PostgresAvailabilitySnapshotReader($database);
        $first = $reader->read();
        $this->assertSame($first, $reader->read());
        $second = $reader->read();
        $this->assertNotSame($first, $second);
        $this->assertNotSame($second, $reader->read());
    }

    public function test_standby_connections_cannot_claim_conclusive_equivalence(): void
    {
        $database = $this->createMock(PostgresConnection::class);
        $database->method('getDriverName')->willReturn('pgsql');
        $database->method('transactionLevel')->willReturn(0);
        $database->method('getReadPdo')->willReturn(new PDO('sqlite::memory:'));
        $database->method('selectOne')->willReturn((object) ['snapshot' => '10:20:11', 'backend_pid' => 100,
            'server_started' => 'test-server-epoch', 'in_recovery' => 1]);
        $this->assertNull((new PostgresAvailabilitySnapshotReader($database))->read());
    }

    public function test_43_checks_reuse_verified_lower_bounds_and_reduce_actual_query_count(): void
    {
        $database = $this->environment->database;
        Fixtures::load($database, ['reservations' => [Fixtures::reservation(['status' => 'payment_review'])]]);
        $this->environment->snapshots->onRead = function () use ($database): string {
            $database->selectOne('SELECT 1 AS fixture_probe');

            return 'stable';
        };
        $database->enableQueryLog();
        $original = new ReservationAvailability;
        for ($i = 0; $i < 43; $i++) {
            $this->call($original);
        }
        $baseline = count($database->getQueryLog());
        $database->flushQueryLog();
        $shadow = $this->environment->shadow();
        $availability = new ReservationAvailability($shadow);
        for ($i = 0; $i < 43; $i++) {
            $this->assertSame(['availability' => 'queue', 'queue_position' => 2], $this->call($availability));
        }
        $this->assertSame(45, $this->environment->snapshots->reads);
        $this->assertSame(45, $shadow->counts()['snapshot_probes']);
        $this->assertSame(42, $shadow->counts()['snapshot_reuses']);
        $this->assertSame(1, $shadow->counts()['builds']);
        $this->assertSame(43, $shadow->counts()['matches']);
        $this->assertCount($baseline + 46, $database->getQueryLog());
    }

    public function test_default_off_provider_does_not_resolve_shadow_or_add_any_queries_across_dates(): void
    {
        (new AppServiceProvider($this->environment->container))->register();
        $database = $this->environment->database;
        $database->enableQueryLog();
        $original = new ReservationAvailability;
        for ($i = 0; $i < 43; $i++) {
            $this->call($original);
        }
        $queries = array_map(fn (array $query) => [$query['query'], $query['bindings']], $database->getQueryLog());
        $database->flushQueryLog();
        $availability = $this->environment->container->make(ReservationAvailability::class);
        for ($i = 0; $i < 43; $i++) {
            $this->assertSame(['availability' => 'available', 'queue_position' => null], $this->call($availability));
        }
        $this->assertSame($queries, array_map(fn (array $query) => [$query['query'], $query['bindings']], $database->getQueryLog()));
        $this->assertFalse($this->environment->container->resolved(ReservationAvailabilityShadow::class));
        $this->assertSame(0, $this->environment->snapshots->reads);
        $this->assertSame([], $this->environment->logger->events);
    }

    public function test_a_commit_between_original_sql_reads_is_inconclusive_and_the_next_stable_check_matches(): void
    {
        $database = $this->environment->database;
        $database->setEventDispatcher(new Dispatcher($this->environment->container));
        $changed = false;
        $database->listen(function (QueryExecuted $query) use (&$changed, $database): void {
            if (! $changed && str_contains($query->sql, 'select exists') && str_contains($query->sql, 'reservations')) {
                $changed = true;
                // Concurrent writer simulation only: this write is to the disposable fixture.
                Fixtures::load($database, ['reservations' => [Fixtures::reservation()]]);
                $this->environment->snapshots->token = 'after-concurrent-commit';
            }
        });
        $shadow = $this->environment->shadow();
        $availability = new ReservationAvailability($shadow);
        $this->assertSame(['availability' => 'available', 'queue_position' => null], $this->call($availability));
        $this->assertTrue($changed);
        $this->assertSame(1, $shadow->counts()['inconclusive']);
        $this->assertSame(0, $shadow->counts()['mismatches']);
        $this->assertSame(0, $shadow->counts()['builds']);
        $this->assertSame(['availability' => 'blocked', 'queue_position' => null], $this->call($availability));
        $this->assertSame(1, $shadow->counts()['matches']);
        $this->assertSame(1, $shadow->counts()['builds']);
    }

    #[DataProvider('probeFailurePhases')]
    public function test_probe_failure_is_inconclusive_discards_reuse_and_preserves_sql(int $failureAt): void
    {
        $this->environment->snapshots->onRead = function (int $read) use ($failureAt): string {
            if ($read === $failureAt) {
                throw new RuntimeException('PRIVATE_PROBE_FAILURE');
            }

            return 'stable';
        };
        $shadow = $this->environment->shadow();
        $availability = new ReservationAvailability($shadow);
        $expected = ['availability' => 'available', 'queue_position' => null];
        $this->assertSame($expected, $this->call($availability));
        if ($failureAt === 4) {
            $this->assertSame($expected, $this->call($availability));
        }
        $this->assertSame('inconclusive', $this->lastEvent()['outcome']);
        $this->assertSame('snapshot_error', $this->lastEvent()['reason']);
        $this->assertSame(1, $shadow->counts()['snapshot_failures']);
        $this->assertSame(0, $shadow->counts()['mismatches']);
        $this->assertSame($expected, $this->call($availability));
        $this->assertSame('match', $this->lastEvent()['outcome']);
        $this->assertStringNotContainsString('PRIVATE_PROBE_FAILURE', json_encode($this->environment->logger->events, JSON_THROW_ON_ERROR));
    }

    public static function probeFailurePhases(): iterable
    {
        yield 'after SQL' => [2];
        yield 'after build' => [3];
        yield 'after a cached-tree SQL check' => [4];
    }

    public function test_entering_a_transaction_discards_snapshot_chaining_without_extra_probes(): void
    {
        $shadow = $this->environment->shadow();
        $availability = new ReservationAvailability($shadow);
        $this->call($availability);
        $this->environment->snapshots->connectionContext = null;
        $this->assertSame(['availability' => 'available', 'queue_position' => null], $this->call($availability));
        $this->assertSame(3, $this->environment->snapshots->reads);
        $this->assertSame('inconclusive', $this->lastEvent()['outcome']);
        $this->environment->snapshots->connectionContext = 'isolated-fixture-autocommit';
        $this->call($availability);
        $this->assertSame(2, $shadow->counts()['builds']);
        $this->assertSame(2, $shadow->counts()['matches']);
    }

    public function test_context_change_during_sql_rejects_equal_snapshot_tokens(): void
    {
        $this->environment->snapshots->onRead = function (int $read): string {
            if ($read === 2) {
                $this->environment->snapshots->connectionContext = 'replacement-connection';
            }

            return 'same-token';
        };
        $shadow = $this->environment->shadow();
        $this->assertSame(['availability' => 'available', 'queue_position' => null], $this->call(new ReservationAvailability($shadow)));
        $this->assertSame(1, $shadow->counts()['inconclusive']);
        $this->assertSame(0, $shadow->counts()['matches']);
        $this->assertSame(0, $shadow->counts()['builds']);
    }

    public function test_snapshot_reader_rejects_pdo_replacement_during_its_probe(): void
    {
        $database = $this->createMock(PostgresConnection::class);
        $database->method('getDriverName')->willReturn('pgsql');
        $database->method('transactionLevel')->willReturn(0);
        $pdo = new PDO('sqlite::memory:');
        $oldPdo = $pdo;
        $database->method('getReadPdo')->willReturnCallback(function () use (&$pdo) {
            return $pdo;
        });
        $database->method('selectOne')->willReturnCallback(function () use (&$pdo) {
            $pdo = new PDO('sqlite::memory:');

            return (object) ['snapshot' => '10:20:11', 'backend_pid' => 100, 'server_started' => 'test', 'in_recovery' => 0];
        });
        $this->assertNull((new PostgresAvailabilitySnapshotReader($database))->read());
        $this->assertNotSame($oldPdo, $pdo);
    }

    public function test_snapshot_identity_includes_role_and_schema_visibility_settings(): void
    {
        $database = $this->createMock(PostgresConnection::class);
        $database->method('getDriverName')->willReturn('pgsql');
        $database->method('transactionLevel')->willReturn(0);
        $database->method('getReadPdo')->willReturn(new PDO('sqlite::memory:'));
        $base = ['snapshot' => '10:20:11', 'backend_pid' => 100, 'server_started' => 'test', 'in_recovery' => 0,
            'database_user' => 'fixture_role', 'search_path' => 'public', 'row_security' => 'on'];
        $database->method('selectOne')->willReturnOnConsecutiveCalls((object) $base,
            (object) array_replace($base, ['database_user' => 'other_fixture_role']),
            (object) array_replace($base, ['search_path' => 'other_fixture_schema']),
            (object) array_replace($base, ['row_security' => 'off']));
        $reader = new PostgresAvailabilitySnapshotReader($database);
        $first = $reader->read();
        $this->assertNotSame($first, $reader->read());
        $this->assertNotSame($first, $reader->read());
        $this->assertNotSame($first, $reader->read());
    }

    private function call(ReservationAvailability $availability): array
    {
        return $availability->forInterval(CarbonImmutable::parse(Fixtures::START), CarbonImmutable::parse(Fixtures::END));
    }

    private function lastEvent(): array
    {
        return $this->environment->logger->events[array_key_last($this->environment->logger->events)]['context'];
    }
}
