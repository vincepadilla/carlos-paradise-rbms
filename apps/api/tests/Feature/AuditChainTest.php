<?php

namespace Tests\Feature;

use App\Models\Role;
use App\Models\User;
use App\Services\AuditChain;
use App\Services\OwnerAudit;
use App\Services\ReservationWorkflow;
use Carbon\CarbonImmutable;
use Database\Seeders\ReservationSetupSeeder;
use Illuminate\Database\QueryException;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class AuditChainTest extends TestCase
{
    use RefreshDatabase;

    protected function beforeRefreshingDatabase(): void
    {
        if (config('database.default') !== 'sqlite' || config('database.connections.sqlite.database') !== ':memory:') {
            throw new \RuntimeException('Audit tests require an isolated SQLite :memory: database.');
        }
    }

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(ReservationSetupSeeder::class);
    }

    private function owner(): User
    {
        return User::factory()->create(['role_id' => Role::where('name', 'owner')->value('id'), 'is_active' => true]);
    }

    public function test_events_link_and_cover_actor_timestamp_context_and_details(): void
    {
        $owner = $this->owner();
        app(OwnerAudit::class)->record($owner, 'admin_created', 'Admin Management', 'Created administrator.', ['target_id' => 42]);
        app(OwnerAudit::class)->record($owner, 'settings_updated', 'System Settings', 'Updated settings.');
        $rows = DB::table('audit_events')->orderBy('sequence')->get();
        $this->assertSame(AuditChain::GENESIS, $rows[0]->previous_hash);
        $this->assertSame($rows[0]->event_hash, $rows[1]->previous_hash);
        $this->assertSame($owner->id, $rows[0]->user_id);
        $this->assertSame('verified', app(AuditChain::class)->verify()['status']);
        $sameInstant = clone $rows[0];
        $sameInstant->occurred_at = CarbonImmutable::parse($sameInstant->occurred_at)->setTimezone('Asia/Manila')->toIso8601String();
        $this->assertSame($rows[0]->event_hash, AuditChain::digest($sameInstant));
        foreach (['id', 'user_id', 'user_name', 'role', 'action', 'module', 'details', 'occurred_at', 'context', 'sequence', 'previous_hash'] as $field) {
            $altered = clone $rows[0];
            $altered->$field = match ($field) {
                'id', 'user_id', 'sequence' => 999,
                'occurred_at' => '2025-01-01 00:00:00',
                default => 'altered',
            };
            $this->assertNotSame($rows[0]->event_hash, AuditChain::digest($altered), $field);
        }
        $this->assertSame(AuditChain::canonical(['a' => ['x' => 1, 'y' => 2], 'b' => 3]), AuditChain::canonical(['b' => 3, 'a' => ['y' => 2, 'x' => 1]]));
    }

    public function test_database_rejects_updates(): void
    {
        app(OwnerAudit::class)->record($this->owner(), 'test', 'Tests', 'Original.');
        $this->expectException(QueryException::class);
        DB::table('audit_events')->update(['details' => 'Changed.']);
    }

    public function test_database_rejects_deletions(): void
    {
        app(OwnerAudit::class)->record($this->owner(), 'test', 'Tests', 'Original.');
        $this->expectException(QueryException::class);
        DB::table('audit_events')->delete();
    }

    public function test_privileged_tampering_is_detected_even_after_bypassing_update_protection(): void
    {
        app(OwnerAudit::class)->record($this->owner(), 'test', 'Tests', 'Original.');
        DB::unprepared('DROP TRIGGER audit_events_no_update');
        DB::table('audit_events')->update(['details' => 'Tampered.']);
        $result = app(AuditChain::class)->verify();
        $this->assertSame('broken', $result['status']);
        $this->assertSame(1, $result['failure']['entry_id']);
        Log::spy();
        $this->artisan('audit:verify')->assertExitCode(1);
        Log::shouldHaveReceived('critical')->once();
    }

    public function test_tail_deletion_and_rewritten_head_are_detected_using_a_checkpoint(): void
    {
        $owner = $this->owner();
        app(OwnerAudit::class)->record($owner, 'first', 'Tests', 'First.');
        app(OwnerAudit::class)->record($owner, 'second', 'Tests', 'Second.');
        $head = DB::table('audit_chain_heads')->first();
        $checkpoint = ['sequence' => (int) $head->sequence, 'event_hash' => $head->event_hash];
        DB::unprepared('DROP TRIGGER audit_events_no_delete');
        DB::table('audit_events')->where('sequence', 2)->delete();
        $this->assertSame('broken', app(AuditChain::class)->verify()['status']);
        $first = DB::table('audit_events')->first();
        DB::table('audit_chain_heads')->update(['sequence' => 1, 'event_hash' => $first->event_hash]);
        $this->assertSame('verified', app(AuditChain::class)->verify()['status']);
        $this->assertSame('broken', app(AuditChain::class)->verify($checkpoint)['status']);
    }

    public function test_rollback_leaves_no_event_or_advanced_head(): void
    {
        try {
            DB::transaction(function () {
                app(OwnerAudit::class)->record($this->owner(), 'test', 'Tests', 'Rolled back.');
                throw new \RuntimeException('Rollback fixture');
            });
        } catch (\RuntimeException $exception) {
            $this->assertSame('Rollback fixture', $exception->getMessage());
        }
        $this->assertDatabaseCount('audit_events', 0);
        $this->assertSame(0, (int) DB::table('audit_chain_heads')->value('sequence'));
        $this->assertSame('verified', app(AuditChain::class)->verify()['status']);
    }

    public function test_reservation_source_is_sealed_and_source_tampering_is_detected(): void
    {
        $id = $this->reservation();
        app(ReservationWorkflow::class)->history($id, null, 'queued', null, 'Original history.');
        $this->assertSame('verified', app(AuditChain::class)->verify()['status']);
        DB::table('reservation_status_history')->update(['reason' => 'Altered original.']);
        $result = app(AuditChain::class)->verify();
        $this->assertSame('broken', $result['status']);
        $this->assertSame('Original history was modified or deleted.', $result['failure']['reason']);
    }

    public function test_unsealed_history_is_detected(): void
    {
        DB::table('reservation_status_history')->insert(['reservation_id' => $this->reservation(),
            'from_status' => null, 'to_status' => 'pending', 'reason' => 'Unlogged insert.',
            'changed_at' => now(), 'created_at' => now(), 'updated_at' => now()]);
        $this->assertSame('broken', app(AuditChain::class)->verify()['status']);
    }

    public function test_guest_edits_are_atomic_audited_and_do_not_log_passwords(): void
    {
        $owner = $this->owner();
        $guest = User::factory()->create(['role_id' => Role::where('name', 'guest')->value('id')]);
        $this->actingAs($owner)->patchJson('/api/owner/operations/guests/'.$guest->id,
            ['name' => 'Updated guest', 'email' => $guest->email, 'is_active' => true])->assertOk();
        $event = DB::table('audit_events')->where('action', 'guest_updated')->first();
        $this->assertSame($owner->id, $event->user_id);
        $context = json_decode($event->context, true);
        $this->assertSame($guest->name, $context['before']['name']);
        $this->assertSame('Updated guest', $context['after']['name']);
        $this->assertStringNotContainsString('password', $event->context);
        $this->getJson('/api/owner/audit-trail?search=absent')->assertOk()
            ->assertJsonPath('total', 0)->assertJsonPath('integrity.status', 'verified')->assertJsonPath('integrity.verified_entries', 1);
        $this->mock(AuditChain::class)->shouldReceive('append')->andThrow(new \RuntimeException('Audit unavailable'));
        $this->withoutExceptionHandling();
        try {
            $this->patchJson('/api/owner/operations/guests/'.$guest->id,
                ['name' => 'Must roll back', 'email' => $guest->email, 'is_active' => true]);
            $this->fail('Audit failure must stop the mutation.');
        } catch (\RuntimeException $error) {
            $this->assertSame('Audit unavailable', $error->getMessage());
        }
        $this->assertSame('Updated guest', $guest->fresh()->name);
    }

    public function test_fallback_logs_staff_actions_with_route_target_and_excludes_failed_requests(): void
    {
        $owner = $this->owner();
        $response = $this->actingAs($owner)->postJson('/api/owner/operations/availability-blocks',
            ['date' => now('Asia/Manila')->addDays(60)->toDateString(), 'reason' => 'Maintenance'])->assertCreated();
        $id = $response->json('block.id');
        $this->patchJson('/api/owner/operations/availability-blocks/'.$id, ['reason' => 'Updated maintenance'])->assertOk();
        $this->patchJson('/api/owner/operations/availability-blocks/'.$id, ['reason' => ''])->assertUnprocessable();
        $this->assertDatabaseCount('audit_events', 2);
        $event = DB::table('audit_events')->orderByDesc('sequence')->first();
        $this->assertSame('staff_request_completed', $event->action);
        $this->assertSame($owner->id, $event->user_id);
        $this->assertSame((string) $id, json_decode($event->context, true)['targets']['block']);
        $this->assertSame('verified', app(AuditChain::class)->verify()['status']);
    }

    public function test_checkpoint_command_never_overwrites_and_verifies_a_growing_chain(): void
    {
        $path = sys_get_temp_dir().DIRECTORY_SEPARATOR.'audit-checkpoint-'.bin2hex(random_bytes(8)).'.json';
        try {
            $owner = $this->owner();
            app(OwnerAudit::class)->record($owner, 'test', 'Tests', 'First.');
            $this->artisan('audit:checkpoint', ['path' => $path])->assertExitCode(0);
            $original = file_get_contents($path);
            app(OwnerAudit::class)->record($owner, 'test', 'Tests', 'Second.');
            $this->artisan('audit:checkpoint', ['path' => $path])->assertExitCode(1);
            $this->assertSame($original, file_get_contents($path));
            $this->artisan('audit:verify', ['--checkpoint' => $path])->assertExitCode(0);
            config(['audit.checkpoint_path' => $path.'.missing']);
            $this->artisan('audit:verify')->assertExitCode(1);
        } finally {
            if (is_file($path)) {
                unlink($path);
            }
        }
    }

    public function test_migration_seals_existing_owner_and_reservation_history(): void
    {
        DB::unprepared('DROP TRIGGER audit_events_no_update');
        DB::unprepared('DROP TRIGGER audit_events_no_delete');
        Schema::drop('audit_events');
        Schema::drop('audit_chain_heads');
        Schema::create('audit_events', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('user_id')->nullable();
            $table->string('user_name');
            $table->string('role');
            $table->string('action');
            $table->string('module');
            $table->text('details');
            $table->timestampTz('occurred_at');
        });
        $owner = $this->owner();
        DB::table('audit_events')->insert(['user_id' => $owner->id, 'user_name' => $owner->name, 'role' => 'owner',
            'action' => 'legacy_event', 'module' => 'Tests', 'details' => 'Preserve original.', 'occurred_at' => now()]);
        DB::table('reservation_status_history')->insert(['reservation_id' => $this->reservation(),
            'from_status' => null, 'to_status' => 'pending', 'reason' => 'Legacy reservation.',
            'changed_at' => now(), 'created_at' => now(), 'updated_at' => now()]);
        $migration = require database_path('migrations/2026_11_25_000001_chain_audit_events.php');
        $migration->up();
        $this->assertDatabaseHas('audit_events', ['action' => 'legacy_event', 'details' => 'Preserve original.']);
        $this->assertSame(2, app(AuditChain::class)->verify()['verified_entries']);
        $this->assertSame('verified', app(AuditChain::class)->verify()['status']);
    }

    private function reservation(): int
    {
        $start = now('Asia/Manila')->addDays(10);

        return DB::table('reservations')->insertGetId([
            'booking_reference' => 'AUDIT-'.bin2hex(random_bytes(4)), 'user_id' => $this->owner()->id, 'villa_id' => 1,
            'contact_name' => 'Guest', 'contact_email' => 'guest@example.test', 'contact_phone' => '09171234567',
            'type' => 'overnight', 'check_in_date' => $start->toDateString(), 'check_out_date' => $start->copy()->addDay()->toDateString(),
            'starts_at' => $start->toIso8601String(), 'ends_at' => $start->copy()->addDay()->toIso8601String(),
            'adults' => 2, 'inquiry_source' => 'Website', 'status' => 'queued', 'requested_at' => now(),
            'pricing_snapshot' => '{}', 'policy_snapshot' => '{}', 'created_at' => now(), 'updated_at' => now(),
        ]);
    }
}
