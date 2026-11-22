<?php

declare(strict_types=1);

namespace Tests\Unit;

use App\Services\Algorithms\ReservationAvailabilityShadow;
use Illuminate\Contracts\View\Factory as ViewFactory;
use Illuminate\Routing\Redirector;
use Illuminate\Routing\ResponseFactory;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use RuntimeException;
use Tests\Support\IsolatedAvailabilityHttpApplication;
use Tests\Support\ReservationIntervalFixtures as Fixtures;

final class ReservationAvailabilityShadowHttpTest extends TestCase
{
    private IsolatedAvailabilityHttpApplication $http;

    private const QUERY = ['start' => '2026-11-30', 'end' => '2026-12-02', 'type' => 'overnight',
        'duration_days' => 1, 'checkin_time' => '14:00', 'checkout_time' => '11:00'];

    protected function setUp(): void
    {
        parent::setUp();
        $this->assertSame('testing', getenv('APP_ENV'));
        $this->assertSame('sqlite', getenv('DB_CONNECTION'));
        $this->assertSame(':memory:', getenv('DB_DATABASE'));
        $this->http = new IsolatedAvailabilityHttpApplication(
            new ResponseFactory($this->createMock(ViewFactory::class), $this->createMock(Redirector::class)));
    }

    protected function tearDown(): void
    {
        $this->http->close();
        parent::tearDown();
    }

    #[DataProvider('authenticatedRoles')]
    public function test_session_authenticated_guest_and_staff_receive_identical_api_output(int $user): void
    {
        Fixtures::load($this->http->fixtures->database, ['reservations' => [Fixtures::reservation(['status' => 'payment_review'])]]);
        $session = $this->http->login($user);
        $before = $this->http->fixtures->database->table('reservations')->get()->all();
        $original = $this->http->get('/api/availability', self::QUERY, $session);
        $this->assertSame(200, $original->getStatusCode(), $original->getContent());
        $this->assertFalse($this->http->app->resolved(ReservationAvailabilityShadow::class));
        $this->assertSame(0, $this->http->fixtures->snapshots->reads);
        $this->assertSame([], $this->http->fixtures->logger->events);
        $enabled = $this->http->get('/api/availability', self::QUERY, $session, shadow: true);
        $this->assertSame(200, $enabled->getStatusCode(), $enabled->getContent());
        $this->assertSame($original->getContent(), $enabled->getContent());
        $this->assertSame(['dates' => ['2026-11-30' => 'queue', '2026-12-01' => 'available', '2026-12-02' => 'available']], json_decode($enabled->getContent(), true, flags: JSON_THROW_ON_ERROR));
        $shadow = $this->http->app->make(ReservationAvailabilityShadow::class);
        $this->assertSame(3, $shadow->counts()['matches']);
        $this->assertSame(1, $shadow->counts()['builds']);
        $this->assertSame(5, $shadow->counts()['snapshot_probes']);
        $this->assertEquals($before, $this->http->fixtures->database->table('reservations')->get()->all());
    }

    public static function authenticatedRoles(): iterable
    {
        yield 'verified guest' => [1];
        yield 'admin without guest email verification' => [3];
        yield 'owner without guest email verification' => [4];
    }

    #[DataProvider('deniedRequests')]
    public function test_real_authorization_denies_requests_before_shadow_evaluation(?int $user, string $uri, int $status): void
    {
        $session = $user === null ? null : $this->http->login($user);
        foreach ([false, true] as $enabled) {
            $response = $this->http->get($uri, self::QUERY, $session, shadow: $enabled);
            $this->assertSame($status, $response->getStatusCode(), $response->getContent());
            $this->assertSame(0, $this->http->fixtures->snapshots->reads);
            $this->assertFalse($this->http->app->resolved(ReservationAvailabilityShadow::class));
        }
    }

    public static function deniedRequests(): iterable
    {
        yield 'unauthenticated calendar' => [null, '/api/availability', 401];
        yield 'unverified guest calendar' => [2, '/api/availability', 403];
        yield 'guest on admin API' => [1, '/api/admin/reports/reservations', 403];
        yield 'guest on owner API' => [1, '/api/owner/operations/reports/reservations', 403];
        yield 'owner on exact-admin API' => [4, '/api/admin/reports/reservations', 403];
        yield 'admin on exact-owner API' => [3, '/api/owner/operations/reports/reservations', 403];
        yield 'inactive admin on staff API' => [5, '/api/admin/reports/reservations', 403];
    }

    public function test_algorithm_failure_preserves_authenticated_api_response_and_records(): void
    {
        Fixtures::load($this->http->fixtures->database, ['reservations' => [Fixtures::reservation()]]);
        $session = $this->http->login(1);
        $original = $this->http->get('/api/availability', self::QUERY, $session);
        $enabled = $this->http->get('/api/availability', self::QUERY, $session, shadow: true,
            treeFactory: fn () => throw new RuntimeException('PRIVATE_HTTP_FAILURE'));
        $this->assertSame(200, $enabled->getStatusCode(), $enabled->getContent());
        $this->assertSame($original->getContent(), $enabled->getContent());
        $shadow = $this->http->app->make(ReservationAvailabilityShadow::class);
        $this->assertSame(3, $shadow->counts()['errors']);
        $this->assertSame(1, $shadow->counts()['build_attempts']);
        $this->assertSame('confirmed', $this->http->fixtures->database->table('reservations')->value('status'));
        $this->assertSame(0, $this->http->fixtures->database->table('reservation_opportunities')->count());
        $this->assertStringNotContainsString('PRIVATE_HTTP_FAILURE', $enabled->getContent());
        $this->assertStringNotContainsString('PRIVATE_HTTP_FAILURE', json_encode($this->http->fixtures->logger->events, JSON_THROW_ON_ERROR));
    }

    public function test_disabled_http_request_after_an_enabled_request_still_has_zero_shadow_work(): void
    {
        $session = $this->http->login(1);
        $database = $this->http->fixtures->database;
        $database->enableQueryLog();
        $original = $this->http->get('/api/availability', self::QUERY, $session);
        $queries = array_map(fn (array $query) => [$query['query'], $query['bindings']], $database->getQueryLog());
        $this->http->get('/api/availability', self::QUERY, $session, shadow: true);
        $reads = $this->http->fixtures->snapshots->reads;
        $events = count($this->http->fixtures->logger->events);
        $database->flushQueryLog();
        $disabled = $this->http->get('/api/availability', self::QUERY, $session);
        $this->assertSame(200, $disabled->getStatusCode(), $disabled->getContent());
        $this->assertSame($original->getContent(), $disabled->getContent());
        $this->assertSame($queries, array_map(fn (array $query) => [$query['query'], $query['bindings']], $database->getQueryLog()));
        $this->assertSame($reads, $this->http->fixtures->snapshots->reads);
        $this->assertSame($events, count($this->http->fixtures->logger->events));
        foreach ($database->getQueryLog() as $query) {
            $this->assertMatchesRegularExpression('/^select\b/i', $query['query']);
        }
    }

    public function test_invalid_authenticated_input_preserves_validation_output_without_evaluation(): void
    {
        $session = $this->http->login(1);
        $query = array_replace(self::QUERY, ['duration_days' => 0]);
        $original = $this->http->get('/api/availability', $query, $session);
        $enabled = $this->http->get('/api/availability', $query, $session, shadow: true);
        $this->assertSame(422, $original->getStatusCode(), $original->getContent());
        $this->assertSame($original->getStatusCode(), $enabled->getStatusCode());
        $this->assertSame($original->getContent(), $enabled->getContent());
        $this->assertSame(0, $this->http->fixtures->snapshots->reads);
        $this->assertSame([], $this->http->fixtures->logger->events);
    }

    public function test_snapshot_failure_returns_original_authenticated_json_and_is_inconclusive(): void
    {
        Fixtures::load($this->http->fixtures->database, ['reservations' => [Fixtures::reservation(['status' => 'payment_review'])]]);
        $session = $this->http->login(1);
        $original = $this->http->get('/api/availability', self::QUERY, $session);
        $this->http->fixtures->snapshots->onRead = fn () => throw new RuntimeException('PRIVATE_HTTP_SNAPSHOT_FAILURE');
        $response = $this->http->get('/api/availability', self::QUERY, $session, shadow: true);
        $this->assertSame(200, $response->getStatusCode(), $response->getContent());
        $this->assertSame($original->getContent(), $response->getContent());
        $shadow = $this->http->app->make(ReservationAvailabilityShadow::class);
        $this->assertSame(3, $shadow->counts()['inconclusive']);
        $this->assertSame(3, $shadow->counts()['snapshot_failures']);
        $this->assertSame(0, $shadow->counts()['mismatches']);
        $this->assertSame(0, $shadow->counts()['build_attempts']);
        $this->assertStringNotContainsString('PRIVATE_HTTP_SNAPSHOT_FAILURE', json_encode($this->http->fixtures->logger->events, JSON_THROW_ON_ERROR));
    }
}
