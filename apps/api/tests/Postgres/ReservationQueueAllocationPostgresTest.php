<?php

declare(strict_types=1);

namespace Tests\Postgres;

use App\Models\User;
use App\Services\AdminNotificationService;
use App\Services\Algorithms\EligibilityConstrainedFifo;
use App\Services\Algorithms\ReservationIntervalNormalizer;
use App\Services\ReservationQueueAllocation;
use App\Services\ReservationWorkflow;
use Carbon\CarbonImmutable;
use Illuminate\Config\Repository;
use Illuminate\Container\Container;
use Illuminate\Database\Connectors\ConnectionFactory;
use Illuminate\Database\DatabaseManager;
use Illuminate\Database\PostgresConnection;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Application;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Facade;
use PHPUnit\Framework\TestCase;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Tests\Support\DisposablePostgresCluster;

final class ReservationQueueAllocationPostgresTest extends TestCase
{
    public function test_competing_grants_serialize_and_retry_without_double_allocation(): void
    {
        if (! getenv('RBMS_STEP4A_MANIFEST')) {
            $this->markTestSkipped('Use the disposable PostgreSQL runner.');
        }
        $cluster = new DisposablePostgresCluster;
        $schema = 'queue_test_'.bin2hex(random_bytes(16));
        $setup = $cluster->connection();
        $setup->statement('CREATE SCHEMA "'.$schema.'"');
        $previousFacade = Facade::getFacadeApplication();
        $previousContainer = Container::getInstance();
        $previousNow = CarbonImmutable::getTestNow();
        try {
            // No application bootstrap or .env: each session must pass the cluster ownership checks.
            $app = new Application(dirname(__DIR__, 2));
            $settings = ['driver' => 'pgsql', 'database' => $setup->getDatabaseName(), 'search_path' => $schema];
            $app->instance('config', new Repository(['database' => [
                'default' => 'first', 'connections' => ['first' => $settings, 'competitor' => $settings],
            ]]));
            $manager = new DatabaseManager($app, new ConnectionFactory($app));
            $manager->extend('pgsql', static function () use ($cluster, $schema, $settings) {
                $verified = $cluster->connection();
                $connection = new PostgresConnection($verified->getPdo(), $verified->getDatabaseName(), '', $settings);
                $connection->statement('SET search_path TO "'.$schema.'"');
                $connection->statement("SET TIME ZONE 'Asia/Manila'");

                return $connection;
            });
            $app->instance('db', $manager);
            $app->instance('db.schema', $manager->connection()->getSchemaBuilder());
            Facade::clearResolvedInstances();
            Facade::setFacadeApplication($app);
            CarbonImmutable::setTestNow('2030-01-05T12:00:00+08:00');
            foreach ([
                '0001_01_01_000000_create_users_table',
                '2026_10_24_065050_add_google_auth_fields_to_users_table',
                '2026_10_24_065650_create_roles_and_add_role_id_to_users',
                '2026_10_28_133004_create_reservation_tables',
                '2026_10_29_010216_create_reservation_support_tables',
                '2026_11_06_000001_add_reservation_admin_management',
                '2026_11_08_130000_create_ocular_visits_table',
                '2026_11_10_000001_create_admin_notifications_tables',
                '2026_11_23_000001_create_reservation_queue_releases',
            ] as $migration) {
                (require dirname(__DIR__, 2).'/database/migrations/'.$migration.'.php')->up();
            }
            $admin = $this->account('admin');
            $owner = $this->account('owner');
            DB::table('villas')->insert(['id' => 1, 'name' => 'Fixture', 'address' => 'Fixture']);
            $holder = $this->reservation($admin->id, 'held', 'A');
            $first = $this->reservation($admin->id, 'queued', 'B');
            $next = $this->reservation($owner->id, 'queued', 'C');
            DB::table('reservation_opportunities')->insert([
                'reservation_id' => $holder, 'status' => 'active', 'granted_at' => '2030-01-04T14:00:00+08:00',
                'deposit_deadline' => '2030-01-05T14:00:00+08:00',
            ]);
            $flow = new ReservationWorkflow(new AdminNotificationService);
            $allocation = new ReservationQueueAllocation($flow, new EligibilityConstrainedFifo, new ReservationIntervalNormalizer);
            $decision = $flow->locked(fn () => $allocation->release($holder, $admin));
            $releaseId = $decision['release_id'];
            $this->assertSame($first, $decision['selected_reservation_id']);
            $this->assertSame(2, $decision['eligible_candidates']);
            $this->assertSame($releaseId, $flow->locked(fn () => $allocation->release($holder, $owner))['release_id']);

            $competing = $manager->connection('competitor');
            $this->assertNotSame(DB::selectOne('select pg_backend_pid() as pid')->pid, $competing->selectOne('select pg_backend_pid() as pid')->pid);
            $competing->statement("SET lock_timeout TO '200ms'");
            $flow->locked(function () use ($allocation, $flow, $manager, $admin, $owner, $releaseId, $first): void {
                $allocation->grant($releaseId, $first, $admin);
                // The first grant is still uncommitted while the second server session tries to enter.
                try {
                    $manager->usingConnection('competitor', fn () => $flow->locked(fn () => $allocation->grant($releaseId, $first, $owner)));
                    $this->fail('The competing transaction entered before the first grant committed.');
                } catch (QueryException $error) {
                    $this->assertSame('55P03', $error->errorInfo[0]); // PostgreSQL lock_not_available
                }
            });
            $manager->usingConnection('competitor', function () use ($allocation, $flow, $owner, $releaseId, $first, $next): void {
                $retry = $flow->locked(fn () => $allocation->grant($releaseId, $first, $owner));
                $this->assertSame($first, (int) $retry->id);
                try {
                    $flow->locked(fn () => $allocation->grant($releaseId, $next, $owner));
                    $this->fail('The release granted an opportunity to a second guest.');
                } catch (HttpException $error) {
                    $this->assertSame(409, $error->getStatusCode());
                }
            });
            $this->assertSame(1, DB::table('reservation_opportunities')->where('status', 'active')->count());
            $this->assertSame(1, DB::table('reservation_opportunities')->where('reservation_id', $first)->count());
            $this->assertSame('queued', DB::table('reservations')->where('id', $next)->value('status'));
            $this->assertSame($admin->id, DB::table('reservation_queue_releases')->where('id', $releaseId)->value('approved_by'));
        } finally {
            CarbonImmutable::setTestNow($previousNow);
            Facade::clearResolvedInstances();
            Facade::setFacadeApplication($previousFacade);
            Container::setInstance($previousContainer);
            $setup->statement('DROP SCHEMA "'.$schema.'" CASCADE');
            $setup->disconnect();
        }
    }

    private function account(string $role): User
    {
        $roleId = DB::table('roles')->where('name', $role)->value('id');
        $id = DB::table('users')->insertGetId(['name' => $role, 'email' => $role.'@example.invalid', 'role_id' => $roleId]);

        return (new User)->forceFill(['id' => $id, 'role_id' => $roleId, 'is_active' => true]);
    }

    private function reservation(int $user, string $status, string $reference): int
    {
        return DB::table('reservations')->insertGetId([
            'booking_reference' => $reference, 'user_id' => $user, 'villa_id' => 1,
            'contact_name' => 'Test', 'contact_email' => 'queue@example.invalid', 'contact_phone' => '09123456789',
            'type' => 'overnight', 'starts_at' => '2030-01-10T14:00:00+08:00', 'ends_at' => '2030-01-11T11:00:00+08:00',
            'check_in_date' => '2030-01-10', 'check_out_date' => '2030-01-11', 'requested_at' => '2030-01-04T12:00:00+08:00',
            'adults' => 2, 'inquiry_source' => 'Website', 'status' => $status, 'price_agreed' => true,
            'quoted_total' => 16000, 'required_deposit' => 5000, 'pricing_snapshot' => '{}', 'policy_snapshot' => '{}',
        ]);
    }
}
