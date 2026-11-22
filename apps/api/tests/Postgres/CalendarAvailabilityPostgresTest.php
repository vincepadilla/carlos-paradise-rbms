<?php

declare(strict_types=1);

namespace Tests\Postgres;

use App\Services\Algorithms\AvailabilitySnapshotReader;
use App\Services\Algorithms\PostgresAvailabilitySnapshotReader;
use App\Services\Algorithms\ReservationIntervalMode;
use App\Services\Algorithms\ReservationIntervalTreeBuilder;
use App\Services\Algorithms\ReservationIntervalTrees;
use App\Services\CalendarAvailability;
use App\Services\ReservationAvailability;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\View\Factory as ViewFactory;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Routing\Redirector;
use Illuminate\Routing\ResponseFactory;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use RuntimeException;
use Tests\Support\AvailabilityShadowTestEnvironment;
use Tests\Support\DisposablePostgresCluster;
use Tests\Support\IsolatedAvailabilityHttpApplication;
use Tests\Support\PostgresShadowFixture;
use Tests\Support\ReservationIntervalFixtures as Fixtures;
use Tests\Unit\ReservationIntervalTreeCompatibilityTest;

final class CalendarAvailabilityPostgresTest extends TestCase
{
    private ?PostgresShadowFixture $fixture = null;

    private ?AvailabilityShadowTestEnvironment $environment = null;

    private ?IsolatedAvailabilityHttpApplication $http = null;

    protected function setUp(): void
    {
        if (! getenv('RBMS_STEP4A_MANIFEST')) {
            $this->markTestSkipped('Requires the verified disposable PostgreSQL runner.');
        }
        $this->fixture = new PostgresShadowFixture(new DisposablePostgresCluster);
        $this->environment = new AvailabilityShadowTestEnvironment($this->fixture->database,
            new PostgresAvailabilitySnapshotReader($this->fixture->database));
    }

    protected function tearDown(): void
    {
        if ($this->http !== null) {
            $this->http->close();
        } else {
            $this->environment?->close();
        }
        $this->fixture?->close();
    }

    #[DataProvider('currentCases')]
    public function test_bounded_calendar_tree_matches_current_sql_and_preserves_queue_positions(array $records, string $start, string $end, string $expected, ?int $position): void
    {
        Fixtures::load($this->fixture->database, $records);
        $intervals = ['date' => ['start' => CarbonImmutable::parse($start)->setTimezone('Asia/Manila'),
            'end' => CarbonImmutable::parse($end)->setTimezone('Asia/Manila')]];
        $builds = 0;
        $engine = $this->engine(function ($from, $until, $asOf) use (&$builds) {
            $builds++;

            return (new ReservationIntervalTreeBuilder($this->fixture->database))->buildForWindow(1, $asOf, $from, $until);
        });
        $service = new ReservationAvailability(calendar: fn () => $engine);
        $this->fixture->database->enableQueryLog();
        $this->assertSame(['date' => $expected], $service->forCalendar($intervals));
        $this->assertSame(1, $builds);
        $this->assertCount(3, $this->fixture->database->getQueryLog()); // Two guards, one bounded UNION SELECT.
        $this->assertSame([], $this->environment->logger->events);
        $this->assertSame(['availability' => $expected, 'queue_position' => $position], $service->forInterval(...array_values($intervals['date'])));
        $this->assertSame(1, $builds); // Quote/write entry point never calls the calendar tree.
        $this->assertSame((new ReservationAvailability)->forCalendar($intervals), $service->forCalendar($intervals));
        $this->assertReadOnly();
    }

    public static function currentCases(): iterable
    {
        foreach (ReservationIntervalTreeCompatibilityTest::currentRuleCases() as $name => $case) {
            yield $name => array_slice($case, 0, 5);
        }
    }

    #[DataProvider('users')]
    public function test_real_authenticated_calendar_contract_and_one_build_for_43_dates(int $user): void
    {
        Fixtures::load($this->fixture->database, ['reservations' => [Fixtures::reservation(),
            Fixtures::reservation(['id' => 2, 'status' => 'payment_review', 'starts_at' => '2026-12-01T14:00:00+08:00', 'ends_at' => '2026-12-02T11:00:00+08:00'])]]);
        $http = $this->http();
        $session = $http->login($user);
        $query = $this->query();
        $query['end'] = '2027-01-11';
        $database = $this->fixture->database;
        $database->enableQueryLog();
        $sqlStart = hrtime(true);
        $sql = $http->get('/api/availability', $query, $session);
        $sqlMs = (hrtime(true) - $sqlStart) / 1e6;
        $sqlQueries = count($database->getQueryLog());
        $this->assertSame(200, $sql->getStatusCode());
        $http->app['config']->set('algocom.availability_engine', 'tree');
        $database->flushQueryLog();
        $treeStart = hrtime(true);
        $tree = $http->get('/api/availability', $query, $session);
        $treeMs = (hrtime(true) - $treeStart) / 1e6;
        $log = $database->getQueryLog();
        $this->assertSame($sql->getContent(), $tree->getContent());
        $dates = json_decode($tree->getContent(), true, flags: JSON_THROW_ON_ERROR)['dates'];
        $this->assertCount(43, $dates);
        $this->assertSame(['blocked', 'queue', 'available'], array_slice(array_values($dates), 0, 3));
        $this->assertCount(1, array_filter($log, fn ($q) => str_contains(strtolower($q['query']), 'union all')));
        $this->assertCount(2, array_filter($log, fn ($q) => str_contains($q['query'], 'pg_current_snapshot')));
        $this->assertCount(0, array_filter($log, fn ($q) => str_starts_with(strtolower($q['query']), 'select exists(select * from "reservations"')));
        $this->assertSame([], $this->environment->logger->events);
        $this->assertReadOnly();
        echo PHP_EOL.'CALENDAR_SMOKE '.json_encode(['role_id' => $user, 'dates' => 43,
            'sql_selects' => $sqlQueries, 'tree_selects' => count($log), 'sql_ms' => round($sqlMs, 3), 'tree_ms' => round($treeMs, 3)], JSON_THROW_ON_ERROR).PHP_EOL;
    }

    public static function users(): iterable
    {
        yield 'verified guest' => [1];
        yield 'admin' => [3];
        yield 'owner' => [4];
    }

    public function test_default_sql_and_unknown_selector_never_resolve_optional_engine(): void
    {
        $http = $this->http();
        $resolutions = 0;
        $http->app->scoped(CalendarAvailability::class, function () use (&$resolutions) {
            $resolutions++;

            throw new RuntimeException('SQL must not initialize the tree engine.');
        });
        $session = $http->login(1);
        $database = $this->fixture->database;
        $database->enableQueryLog();
        $default = $http->get('/api/availability', $this->query(), $session);
        $baseline = array_column($database->getQueryLog(), 'query');
        foreach (['sql', 'invalid'] as $mode) {
            $http->app['config']->set('algocom.availability_engine', $mode);
            $database->flushQueryLog();
            $this->assertSame($default->getContent(), $http->get('/api/availability', $this->query(), $session)->getContent());
            $this->assertSame($baseline, array_column($database->getQueryLog(), 'query'));
        }
        $this->assertStringNotContainsString('pg_current_snapshot', implode(' ', $baseline));
        $this->assertStringNotContainsString('union all', strtolower(implode(' ', $baseline)));
        $this->assertSame([], $this->environment->logger->events);
        $this->assertSame(0, $resolutions);
        // Read the shipped config without loading .env or honoring process overrides.
        $this->assertStringContainsString("env('ALGOCOM_AVAILABILITY_ENGINE', 'sql')", file_get_contents(dirname(__DIR__, 2).'/config/algocom.php'));
    }

    #[DataProvider('failures')]
    public function test_unreliable_tree_discards_whole_batch_and_falls_back_to_sql(string $failure): void
    {
        Fixtures::load($this->fixture->database, ['reservations' => [Fixtures::reservation()]]);
        $intervals = ['date' => ['start' => CarbonImmutable::parse(Fixtures::START), 'end' => CarbonImmutable::parse(Fixtures::END)]];
        $snapshots = new PostgresAvailabilitySnapshotReader($this->fixture->database);
        if ($failure === 'snapshot') {
            $snapshots = new class implements AvailabilitySnapshotReader
            {
                public function context(): ?string
                {
                    return 'fixture';
                }

                public function read(): ?string
                {
                    throw new RuntimeException('Synthetic snapshot error');
                }
            };
        }
        $builds = 0;
        $engine = $this->engine(function ($from, $until, $asOf) use ($failure, &$builds) {
            $builds++;
            if (in_array($failure, ['builder', 'logger'], true)) {
                throw new RuntimeException('Synthetic tree error');
            }
            if ($failure === 'concurrent') {
                // Separate connection commits after the lower bound: no stale AVAILABLE response.
                $this->fixture->writer->table('reservations')->insert(Fixtures::reservation(['id' => 2, 'status' => 'payment_review']));
            }
            if ($failure === 'clock') {
                CarbonImmutable::setTestNow($asOf->addSecond());
            }

            return new ReservationIntervalTrees(['blocked' => [], 'queue' => []],
                $failure === 'policy' ? ReservationIntervalMode::Pbl : ReservationIntervalMode::Current);
        }, $snapshots);
        if ($failure === 'logger') {
            $this->environment->logger->fail = true;
        }
        if ($failure === 'transaction') {
            $this->fixture->database->beginTransaction();
        }
        $this->fixture->database->enableQueryLog();
        try {
            $this->assertSame(['date' => 'blocked'], (new ReservationAvailability(calendar: fn () => $engine))->forCalendar($intervals));
            $this->assertSame(in_array($failure, ['snapshot', 'transaction'], true) ? 0 : 1, $builds);
            $this->assertCount($failure === 'logger' ? 0 : 1, $this->environment->logger->events);
            $this->assertReadOnly();
        } finally {
            if ($failure === 'transaction') {
                $this->fixture->database->rollBack();
            }
        }
    }

    public static function failures(): iterable
    {
        foreach (['builder', 'snapshot', 'concurrent', 'clock', 'policy', 'transaction', 'logger'] as $failure) {
            yield $failure => [$failure];
        }
    }

    public function test_engine_initialization_failure_preserves_guest_json(): void
    {
        Fixtures::load($this->fixture->database, ['reservations' => [Fixtures::reservation()]]);
        $http = $this->http();
        $session = $http->login(1);
        $sql = $http->get('/api/availability', $this->query(), $session);
        $http->app['config']->set('algocom.availability_engine', 'tree');
        $http->app->scoped(CalendarAvailability::class, fn () => throw new RuntimeException('Synthetic initialization error'));
        $this->assertSame($sql->getContent(), $http->get('/api/availability', $this->query(), $session)->getContent());
    }

    public function test_checkout_calendar_invalid_dates_and_crossing_intervals_remain_equivalent(): void
    {
        Fixtures::load($this->fixture->database, ['reservations' => [Fixtures::reservation([
            'starts_at' => '2026-11-01T00:00:00Z', 'ends_at' => '2026-12-20T00:00:00Z'])]]);
        $http = $this->http();
        $session = $http->login(1);
        $query = array_replace($this->query(), ['date_role' => 'checkout', 'anchor_date' => '2026-11-30']);
        $sql = $http->get('/api/availability', $query, $session);
        $http->app['config']->set('algocom.availability_engine', 'tree');
        $this->assertSame($sql->getContent(), $http->get('/api/availability', $query, $session)->getContent());
        $this->assertSame(['2026-11-30' => 'blocked', '2026-12-01' => 'blocked', '2026-12-02' => 'blocked'], json_decode($sql->getContent(), true)['dates']);
    }

    public function test_real_creation_rechecks_sql_even_when_calendar_tree_says_available(): void
    {
        Fixtures::load($this->fixture->database, ['reservations' => [Fixtures::reservation()]]);
        $http = $this->http();
        $database = $this->fixture->database;
        $villa = ['is_active' => true, 'name' => 'Synthetic villa', 'address' => 'Fixture', 'check_in_time' => '14:00',
            'check_out_time' => '11:00', 'base_nightly_rate' => '16000', 'included_guests' => '20',
            'maximum_guests' => '40', 'extra_guest_rate' => '500', 'deposit_amount' => '5000', 'deposit_window_hours' => '24'];
        $database->getSchemaBuilder()->table('villas', function (Blueprint $table) use ($villa): void {
            foreach ($villa as $key => $value) {
                if (is_bool($value)) {
                    $table->boolean($key);
                } else {
                    $table->string($key);
                }
            }
        });
        $database->table('villas')->insert(['id' => 1] + $villa);
        $http->app['config']->set('algocom.availability_engine', 'tree');
        $builds = 0;
        $http->app->scoped(CalendarAvailability::class, function () use (&$builds) {
            return $this->engine(function () use (&$builds) {
                $builds++;

                return new ReservationIntervalTrees(['blocked' => [], 'queue' => []]);
            });
        });
        $session = $http->login(1);
        $this->assertSame('available', json_decode($http->get('/api/availability', $this->query(), $session)->getContent(), true)['dates']['2026-11-30']);
        $database->enableQueryLog();
        $response = $http->post('/api/reservations', ['contact_name' => 'Fixture', 'contact_email' => 'guest@example.invalid',
            'contact_phone' => '09123456789', 'inquiry_source' => 'Referral', 'terms' => true,
            'type' => 'overnight', 'checkin' => '2026-11-30', 'checkout' => '2026-12-01',
            'checkin_time' => '14:00', 'checkout_time' => '11:00', 'adults' => 2, 'children' => 0,
            'pets' => 0, 'bonfire_qty' => 0, 'charcoal_qty' => 0], $session);
        $this->assertSame(422, $response->getStatusCode(), $response->getContent());
        $this->assertSame(['dates' => ['These dates are no longer available.']], json_decode($response->getContent(), true)['errors']);
        $this->assertSame(1, $builds); // The POST did not resolve/build a calendar tree.
        $log = $database->getQueryLog();
        $this->assertNotEmpty(array_filter($log, fn ($q) => str_contains($q['query'], 'for update')));
        $this->assertNotEmpty(array_filter($log, fn ($q) => str_starts_with(strtolower($q['query']), 'select exists(select * from "reservations"')));
        $this->assertReadOnly();
        $this->assertSame(1, $database->table('reservations')->count());
    }

    private function engine(\Closure $builder, ?AvailabilitySnapshotReader $snapshots = null): CalendarAvailability
    {
        return new CalendarAvailability($snapshots ?? $this->environment->snapshots, $builder, $this->environment->logger);
    }

    private function http(): IsolatedAvailabilityHttpApplication
    {
        return $this->http = new IsolatedAvailabilityHttpApplication(new ResponseFactory(
            $this->createMock(ViewFactory::class), $this->createMock(Redirector::class)), $this->environment, true);
    }

    private function query(): array
    {
        return ['start' => '2026-11-30', 'end' => '2026-12-02', 'type' => 'overnight',
            'duration_days' => 1, 'checkin_time' => '14:00', 'checkout_time' => '11:00'];
    }

    private function assertReadOnly(): void
    {
        foreach ($this->fixture->database->getQueryLog() as $query) {
            $this->assertMatchesRegularExpression('/^\s*\(*\s*select\b/i', $query['query']);
        }
    }
}
