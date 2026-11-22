<?php

declare(strict_types=1);

namespace Tests\Postgres;

use App\Services\Algorithms\AvailabilitySnapshotReader;
use App\Services\Algorithms\PostgresAvailabilitySnapshotReader;
use App\Services\Algorithms\ReservationAvailabilityShadow;
use App\Services\Algorithms\ReservationIntervalMode;
use App\Services\Algorithms\ReservationIntervalTreeBuilder;
use App\Services\Algorithms\ReservationIntervalTrees;
use App\Services\ReservationAvailability;
use Carbon\CarbonImmutable;
use Closure;
use Illuminate\Contracts\View\Factory as ViewFactory;
use Illuminate\Routing\Redirector;
use Illuminate\Routing\ResponseFactory;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use RuntimeException;
use Tests\Support\AvailabilityShadowTestEnvironment;
use Tests\Support\DisposablePostgresCluster;
use Tests\Support\IsolatedAvailabilityHttpApplication;
use Tests\Support\PostgresShadowFixture;
use Tests\Support\ReadinessBenchmarkDataset as Dataset;
use Tests\Support\ReservationIntervalFixtures as Fixtures;

final class ReservationReadinessPostgresTest extends TestCase
{
    private ?PostgresShadowFixture $fixture = null;

    private ?AvailabilityShadowTestEnvironment $environment = null;

    private ?IsolatedAvailabilityHttpApplication $http = null;

    private array $tracked = [];

    private static array $counts = ['comparisons' => 0, 'matches' => 0, 'mismatches' => 0, 'inconclusive' => 0,
        'errors' => 0, 'log_failures' => 0, 'deliberately_injected_mismatches' => 0];

    protected function setUp(): void
    {
        parent::setUp();
        if (! getenv('RBMS_STEP4A_MANIFEST')) {
            $this->markTestSkipped('Requires the verified disposable PostgreSQL runner.');
        }
        $this->fixture = new PostgresShadowFixture(new DisposablePostgresCluster);
        $this->environment = new AvailabilityShadowTestEnvironment($this->fixture->database,
            new PostgresAvailabilitySnapshotReader($this->fixture->database));
    }

    protected function tearDown(): void
    {
        foreach ($this->tracked as $shadow) {
            foreach (array_keys($shadow->counts()) as $key) {
                if (array_key_exists($key, self::$counts)) {
                    self::$counts[$key] += $shadow->counts()[$key];
                }
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
        echo PHP_EOL.'CURRENT_READINESS_COUNTS '.json_encode(self::$counts, JSON_THROW_ON_ERROR).PHP_EOL;
        parent::tearDownAfterClass();
    }

    #[DataProvider('sizes')]
    public function test_identical_current_datasets_match_sql_tree_and_shadow(int $size): void
    {
        $metadata = Dataset::seed($this->fixture->database, $size);
        $capture = Dataset::capturePreparation($this->fixture->database);
        $raw = $this->fixture->database->select($capture['sql'], $capture['bindings']);
        $prepared = Dataset::normalize($raw);
        $this->assertSame($capture['prepared'], $prepared);
        $this->assertSame($size, count($prepared['blocked']) + count($prepared['queue']));
        $this->assertSame($size, $metadata['protected_intervals']);
        $trees = new ReservationIntervalTrees($prepared);
        $shadow = $this->observer();
        $availability = new ReservationAvailability($shadow);
        $seen = [];
        foreach (Dataset::proposals() as [$start, $end]) {
            $reference = (new ReservationAvailability)->forInterval($start, $end);
            $seen[$reference['availability']] = true;
            $this->assertSame($reference['availability'], $trees->classifyEpoch($start->getTimestamp(), $end->getTimestamp()));
            $this->assertSame($reference, $availability->forInterval($start, $end));
        }
        $this->assertCount(3, $seen);
        $this->assertSame(43, $shadow->counts()['matches']);
        $this->assertSame(0, $shadow->counts()['mismatches']);
        $this->assertSame(1, $shadow->counts()['builds']);
        $this->assertSame(45, $shadow->counts()['snapshot_probes']);
        [$start, $end] = Dataset::proposals()[0];
        $this->assertTrue($trees->blocked->hasOverlap($start->getTimestamp(), $end->getTimestamp()));
        $this->assertTrue($trees->queue->hasOverlap($start->getTimestamp(), $end->getTimestamp()));
        $this->assertSame('blocked', $trees->classifyEpoch($start->getTimestamp(), $end->getTimestamp()));
    }

    public static function sizes(): iterable
    {
        yield '100' => [100];
        yield '1000' => [1000];
        yield '10000' => [10000];
    }

    #[DataProvider('failurePhases')]
    public function test_snapshot_faults_are_inconclusive_and_leave_current_queue_response_unchanged(int $failAt): void
    {
        Fixtures::load($this->fixture->database, ['reservations' => [Fixtures::reservation(['status' => 'payment_review'])]]);
        $reader = new class(new PostgresAvailabilitySnapshotReader($this->fixture->database), $failAt) implements AvailabilitySnapshotReader
        {
            private int $reads = 0;

            public function __construct(private readonly AvailabilitySnapshotReader $actual, private readonly int $failAt) {}

            public function context(): ?string
            {
                return $this->actual->context();
            }

            public function read(): ?string
            {
                if (++$this->reads === $this->failAt) {
                    throw new RuntimeException('PRIVATE_READINESS_SNAPSHOT_FAULT');
                }

                return $this->actual->read();
            }
        };
        $before = $this->state();
        $shadow = $this->observer($reader);
        $this->assertSame(['availability' => 'queue', 'queue_position' => 2], $this->check(new ReservationAvailability($shadow)));
        $this->assertSame(1, $shadow->counts()['inconclusive']);
        $this->assertSame(0, $shadow->counts()['mismatches']);
        $this->assertSame(1, $shadow->counts()['snapshot_failures']);
        $this->assertSame($before, $this->state());
        $this->assertStringNotContainsString('PRIVATE_READINESS_SNAPSHOT_FAULT', json_encode($this->environment->logger->events, JSON_THROW_ON_ERROR));
    }

    public static function failurePhases(): iterable
    {
        yield 'before SQL' => [1];
        yield 'after SQL' => [2];
        yield 'after tree construction' => [3];
    }

    public function test_algorithm_failure_preserves_queue_positions_and_records_on_postgres(): void
    {
        Fixtures::load($this->fixture->database, ['reservations' => [Fixtures::reservation(['status' => 'payment_review']),
            Fixtures::reservation(['id' => 2, 'status' => 'queued'])]]);
        $before = $this->state();
        $shadow = $this->observer(factory: fn () => throw new RuntimeException('PRIVATE_READINESS_ALGORITHM_FAULT'));
        $this->assertSame(['availability' => 'queue', 'queue_position' => 3], $this->check(new ReservationAvailability($shadow)));
        $this->assertSame(1, $shadow->counts()['errors']);
        $this->assertSame($before, $this->state());
        $this->assertStringNotContainsString('PRIVATE_READINESS_ALGORITHM_FAULT', json_encode($this->environment->logger->events, JSON_THROW_ON_ERROR));
    }

    public function test_logger_failure_cannot_change_sql_results(): void
    {
        $shadow = $this->observer();
        $this->environment->logger->fail = true;
        $this->assertSame(['availability' => 'available', 'queue_position' => null], $this->check(new ReservationAvailability($shadow)));
        $this->assertSame(1, $shadow->counts()['matches']);
        $this->assertSame(1, $shadow->counts()['log_failures']);
    }

    public function test_current_shadow_rejects_proposed_pbl_trees_and_preserves_sql(): void
    {
        $shadow = $this->observer(factory: fn () => new ReservationIntervalTrees(['blocked' => [], 'queue' => []], ReservationIntervalMode::Pbl));
        $this->assertSame(['availability' => 'available', 'queue_position' => null], $this->check(new ReservationAvailability($shadow)));
        $this->assertSame(1, $shadow->counts()['errors']);
        $this->assertSame(0, $shadow->counts()['matches']);
        $this->assertSame(0, $shadow->counts()['mismatches']);
    }

    public function test_deliberately_injected_mismatch_is_detected_without_changing_the_sql_result(): void
    {
        Fixtures::load($this->fixture->database, ['reservations' => [Fixtures::reservation()]]);
        $shadow = $this->observer(factory: fn () => new ReservationIntervalTrees(['blocked' => [], 'queue' => []]));
        $this->assertSame(['availability' => 'blocked', 'queue_position' => null], $this->check(new ReservationAvailability($shadow)));
        $this->assertSame(1, $shadow->counts()['mismatches']);
        self::$counts['deliberately_injected_mismatches']++;
    }

    #[DataProvider('roles')]
    public function test_disabled_after_enabled_adds_no_postgres_selects_or_api_fields_for_each_role(int $user): void
    {
        $this->http = new IsolatedAvailabilityHttpApplication(
            new ResponseFactory($this->createMock(ViewFactory::class), $this->createMock(Redirector::class)),
            $this->environment, productionShadow: true);
        $session = $this->http->login($user);
        $database = $this->fixture->database;
        $database->enableQueryLog();
        $original = $this->http->get('/api/availability', Dataset::httpQuery(), $session);
        $originalQueries = array_map(fn ($query) => [$query['query'], $query['bindings']], $database->getQueryLog());
        $this->assertSame(200, $original->getStatusCode(), $original->getContent());
        $enabled = $this->http->get('/api/availability', Dataset::httpQuery(), $session, shadow: true);
        $this->assertSame($original->getContent(), $enabled->getContent());
        $shadow = $this->http->app->make(ReservationAvailabilityShadow::class);
        $this->tracked[spl_object_id($shadow)] = $shadow;
        $database->flushQueryLog();
        $events = count($this->environment->logger->events);
        $disabled = $this->http->get('/api/availability', Dataset::httpQuery(), $session);
        $this->assertSame($original->getContent(), $disabled->getContent());
        $this->assertSame($originalQueries, array_map(fn ($query) => [$query['query'], $query['bindings']], $database->getQueryLog()));
        $this->assertSame($events, count($this->environment->logger->events));
        $this->assertSame(43, $shadow->counts()['matches']);
    }

    public static function roles(): iterable
    {
        yield 'Guest' => [1];
        yield 'Admin' => [3];
        yield 'Owner' => [4];
    }

    private function observer(?AvailabilitySnapshotReader $reader = null, ?Closure $factory = null): ReservationAvailabilityShadow
    {
        $shadow = new ReservationAvailabilityShadow(true, $reader ?? new PostgresAvailabilitySnapshotReader($this->fixture->database),
            $factory ?? fn (CarbonImmutable $asOf) => (new ReservationIntervalTreeBuilder($this->fixture->database))->build(1, $asOf),
            $this->environment->logger);
        $this->tracked[spl_object_id($shadow)] = $shadow;

        return $shadow;
    }

    private function check(ReservationAvailability $availability): array
    {
        return $availability->forInterval(CarbonImmutable::parse(Fixtures::START), CarbonImmutable::parse(Fixtures::END));
    }

    private function state(): array
    {
        return array_map(fn ($table) => $this->fixture->database->table($table)->orderBy('id')->get()->map(fn ($row) => (array) $row)->all(),
            ['reservations', 'reservation_opportunities', 'availability_blocks', 'ocular_visits']);
    }
}
