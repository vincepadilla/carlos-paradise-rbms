<?php

declare(strict_types=1);

namespace Tests\Support;

use App\Services\Algorithms\AvailabilitySnapshotReader;
use App\Services\Algorithms\ReservationAvailabilityShadow;
use App\Services\Algorithms\ReservationIntervalMode;
use App\Services\Algorithms\ReservationIntervalTreeBuilder;
use Carbon\CarbonImmutable;
use Closure;
use Illuminate\Config\Repository;
use Illuminate\Container\Container;
use Illuminate\Database\Connection;
use Illuminate\Support\Facades\Facade;
use Illuminate\Translation\ArrayLoader;
use Illuminate\Translation\Translator;
use Illuminate\Validation\Factory;
use Psr\Log\AbstractLogger;
use Psr\Log\LoggerInterface;
use RuntimeException;
use Stringable;

/** Minimal isolated container: no application bootstrap, .env, migrations or app DB configuration. */
final class AvailabilityShadowTestEnvironment
{
    public readonly Connection $database;

    public readonly Container $container;

    public readonly AvailabilitySnapshotReader $snapshots;

    public readonly LoggerInterface $logger;

    private mixed $previousFacade;

    private Container $previousContainer;

    private mixed $previousNow;

    private string $previousTimezone;

    public function __construct(?Connection $database = null, ?AvailabilitySnapshotReader $snapshots = null)
    {
        $this->previousFacade = Facade::getFacadeApplication();
        $this->previousContainer = Container::getInstance();
        $this->previousNow = CarbonImmutable::getTestNow();
        $this->previousTimezone = date_default_timezone_get();
        $this->database = $database ?? ReservationIntervalFixtures::database();
        $this->container = new Container;
        $this->container->instance('db', $this->database);
        $this->container->instance('db.schema', $this->database->getSchemaBuilder());
        $this->container->instance('config', new Repository);
        $this->container->instance('validator', new Factory(new Translator(new ArrayLoader, 'en')));
        Container::setInstance($this->container);
        Facade::clearResolvedInstances();
        Facade::setFacadeApplication($this->container);
        date_default_timezone_set('Asia/Manila');
        CarbonImmutable::setTestNow(CarbonImmutable::parse(ReservationIntervalFixtures::NOW));

        // Deterministic test identity, valid only because fixture writes are controlled.
        // Production NEVER uses this reader for SQLite or substitutes a record fingerprint.
        $this->snapshots = $snapshots ?? new class implements AvailabilitySnapshotReader
        {
            public int $reads = 0;

            public ?string $token = 'isolated-fixture-state';

            public ?Closure $onRead = null;

            public ?string $connectionContext = 'isolated-fixture-autocommit';

            public function context(): ?string
            {
                return $this->connectionContext;
            }

            public function read(): ?string
            {
                $this->reads++;

                return $this->onRead !== null ? ($this->onRead)($this->reads) : $this->token;
            }
        };
        $this->logger = new class extends AbstractLogger
        {
            public array $events = [];

            public bool $fail = false;

            public function log($level, string|Stringable $message, array $context = []): void
            {
                if ($this->fail) {
                    throw new RuntimeException('Synthetic logger failure.');
                }
                $this->events[] = ['level' => $level, 'message' => (string) $message, 'context' => $context];
            }
        };
    }

    public function shadow(bool $enabled = true, ?Closure $factory = null): ReservationAvailabilityShadow
    {
        return new ReservationAvailabilityShadow($enabled, $this->snapshots,
            $factory ?? fn (CarbonImmutable $asOf) => (new ReservationIntervalTreeBuilder($this->database))
                ->build(1, $asOf, ReservationIntervalMode::Current),
            $this->logger);
    }

    public function close(): void
    {
        $this->database->disconnect();
        Facade::clearResolvedInstances();
        Facade::setFacadeApplication($this->previousFacade);
        Container::setInstance($this->previousContainer);
        CarbonImmutable::setTestNow($this->previousNow);
        date_default_timezone_set($this->previousTimezone);
    }
}
