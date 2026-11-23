<?php

namespace App\Providers;

use App\Services\Algorithms\PostgresAvailabilitySnapshotReader;
use App\Services\Algorithms\ReservationAvailabilityShadow;
use App\Services\Algorithms\ReservationIntervalMode;
use App\Services\Algorithms\ReservationIntervalTreeBuilder;
use App\Services\CalendarAvailability;
use App\Services\ReservationAvailability;
use App\Services\ReservationQueueAllocation;
use Carbon\CarbonImmutable;
use Illuminate\Support\ServiceProvider;
use Psr\Log\LoggerInterface;
use Throwable;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        $this->app->scoped(CalendarAvailability::class, function ($app) {
            $database = $app['db']->connection();

            return new CalendarAvailability(
                new PostgresAvailabilitySnapshotReader($database),
                fn (CarbonImmutable $start, CarbonImmutable $end, CarbonImmutable $asOf) => (new ReservationIntervalTreeBuilder($database))->buildForWindow(1, $asOf, $start, $end),
                $app->make(LoggerInterface::class),
            );
        });
        $this->app->scoped(ReservationAvailabilityShadow::class, function ($app) {
            $database = $app['db']->connection();

            return new ReservationAvailabilityShadow(
                enabled: (bool) $app['config']->get('algocom.availability_shadow.enabled', false),
                snapshots: new PostgresAvailabilitySnapshotReader($database),
                buildTrees: fn (CarbonImmutable $asOf) => (new ReservationIntervalTreeBuilder($database))
                    ->build(1, $asOf, ReservationIntervalMode::Current),
                logger: $app->make(LoggerInterface::class),
            );
        });
        $this->app->scoped(ReservationAvailability::class, function ($app) {
            $shadow = null;
            if ($app['config']->get('algocom.availability_shadow.enabled', false)) {
                try {
                    $shadow = $app->make(ReservationAvailabilityShadow::class);
                } catch (Throwable) {
                    // Diagnostics must not make an otherwise valid SQL service unresolvable.
                    try {
                        $app->make(LoggerInterface::class)->warning('reservation_availability_shadow',
                            ['outcome' => 'error', 'reason' => 'initialization_error']);
                    } catch (Throwable) {
                        // A failing logging backend must also leave SQL availability intact.
                    }
                }
            }

            $calendar = $app['config']->get('algocom.availability_engine', 'sql') === 'tree'
                ? fn () => $app->make(CalendarAvailability::class)
                : null;

            return new ReservationAvailability($shadow, $calendar, $app->make(ReservationQueueAllocation::class));
        });
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        //
    }
}
