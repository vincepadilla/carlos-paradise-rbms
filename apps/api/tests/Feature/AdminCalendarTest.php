<?php

namespace Tests\Feature;

use App\Models\Role;
use App\Models\User;
use Database\Seeders\ReservationSetupSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class AdminCalendarTest extends TestCase
{
    use RefreshDatabase;

    protected function beforeRefreshingDatabase(): void
    {
        if (config('database.default') !== 'sqlite' || config('database.connections.sqlite.database') !== ':memory:') {
            throw new \RuntimeException('Calendar tests require isolated SQLite :memory:.');
        }
    }

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(ReservationSetupSeeder::class);
    }

    public function test_calendar_and_block_mutations_require_an_active_admin(): void
    {
        $this->getJson('/api/admin/calendar?start=2027-01-01&end=2027-02-01')->assertUnauthorized();
        $this->postJson('/api/admin/availability-blocks', [])->assertUnauthorized();
        $this->postJson('/api/admin/ocular-visits', [])->assertUnauthorized();
        foreach (['guest', 'owner'] as $role) {
            $this->actingAs($this->account($role));
            $this->getJson('/api/admin/calendar?start=2027-01-01&end=2027-02-01')->assertForbidden();
            $this->postJson('/api/admin/availability-blocks', [])->assertForbidden();
            $this->postJson('/api/admin/ocular-visits', [])->assertStatus($role === 'owner' ? 422 : 403);
            $this->patchJson('/api/admin/availability-blocks/1', ['reason' => 'Forged'])->assertForbidden();
            $this->postJson('/api/admin/availability-blocks/1/release')->assertForbidden();
        }
        $inactive = $this->account('admin');
        $inactive->forceFill(['is_active' => false])->save();
        $this->actingAs($inactive)->postJson('/api/admin/availability-blocks', [])->assertForbidden();
    }

    public function test_calendar_validates_bounded_ranges(): void
    {
        $this->actingAs($this->account('admin'));
        foreach (['', '?start=invalid&end=2027-02-01', '?start=2027-01-01&end=2027-01-01', '?start=2027-01-01&end=2028-01-01'] as $query) {
            $this->getJson('/api/admin/calendar'.$query)->assertUnprocessable();
        }
    }

    public function test_calendar_returns_the_complete_period_beyond_the_guest_list_limit(): void
    {
        $admin = $this->account('admin');
        $day = now('Asia/Manila')->addDays(60)->startOfDay();
        $records = [];
        for ($index = 0; $index < 501; $index++) {
            $records[] = $this->reservation($admin, $day->copy()->addHours(14), $day->copy()->addDay()->addHours(11), 'completed', 'CAL-'.$index);
        }
        DB::table('reservations')->insert($records);
        DB::table('reservations')->insert($this->reservation($admin, $day->copy()->subDays(5), $day->copy()->subDays(4), 'completed', 'OUTSIDE'));
        DB::table('reservations')->insert($this->reservation($admin, $day, $day->copy()->addDay(), 'cancelled', 'CANCELLED'));

        $this->actingAs($admin)->getJson('/api/admin/calendar?start='.$day->toDateString().'&end='.$day->copy()->addDays(2)->toDateString())
            ->assertOk()->assertJsonCount(501, 'reservations')->assertJsonCount(0, 'blocks');
    }

    public function test_block_creation_persists_reason_notes_and_exclusive_end_for_real_availability(): void
    {
        $admin = $this->account('admin');
        $day = now('Asia/Manila')->addDays(30)->startOfDay();
        $reason = "Maintenance\n\nTeam access only";
        $id = $this->actingAs($admin)->postJson('/api/admin/availability-blocks', [
            'date' => $day->toDateString(), 'reason' => $reason, 'created_by' => 99999,
        ])->assertCreated()->assertJsonPath('block.ends_on', $day->copy()->addDay()->toDateString())->json('block.id');

        $this->assertDatabaseHas('availability_blocks', ['id' => $id, 'reason' => $reason, 'created_by' => $admin->id, 'released_at' => null]);
        $this->getJson('/api/admin/calendar?start='.$day->toDateString().'&end='.$day->copy()->addDays(2)->toDateString())->assertOk()->assertJsonPath('blocks.0.id', $id);
        $this->postJson('/api/admin/availability-blocks', ['date' => $day->toDateString(), 'reason' => 'Duplicate'])->assertUnprocessable();

        $this->actingAs($this->account('guest'))->postJson('/api/quote', [
            'type' => 'overnight', 'checkin' => $day->toDateString(), 'checkout' => $day->copy()->addDay()->toDateString(),
            'checkin_time' => '14:00', 'checkout_time' => '11:00', 'adults' => 2, 'children' => 0, 'pets' => 0, 'bonfire_qty' => 0, 'charcoal_qty' => 0,
        ])->assertOk()->assertJsonPath('availability', 'blocked');
    }

    public function test_blocks_reuse_booking_conflict_rules_for_confirmed_and_active_holds(): void
    {
        $admin = $this->account('admin');
        $day = now('Asia/Manila')->addDays(40)->startOfDay();
        foreach (['confirmed', 'payment_review', 'awaiting_deposit'] as $index => $status) {
            $start = $day->copy()->addDays($index * 3);
            $record = $this->reservation($admin, $start->copy()->addHours(14), $start->copy()->addDay()->addHours(11), $status, 'CONFLICT-'.$index);
            $record['deadline'] = now('Asia/Manila')->addDay()->toIso8601String();
            DB::table('reservations')->insert($record);
            $this->actingAs($admin)->postJson('/api/admin/availability-blocks', ['date' => $start->toDateString(), 'reason' => 'Conflict'])->assertUnprocessable();
        }
        $this->assertDatabaseCount('availability_blocks', 0);
    }

    public function test_edit_preserves_dates_and_release_preserves_history(): void
    {
        $day = now('Asia/Manila')->addDays(50)->toDateString();
        $this->actingAs($this->account('admin'));
        $id = $this->postJson('/api/admin/availability-blocks', ['date' => $day, 'reason' => 'Original'])->assertCreated()->json('block.id');
        $this->patchJson('/api/admin/availability-blocks/'.$id, ['reason' => "Updated\n\nNotes", 'date' => '2099-01-01'])
            ->assertOk()->assertJsonPath('block.starts_on', $day)->assertJsonPath('block.reason', "Updated\n\nNotes");
        $this->postJson('/api/admin/availability-blocks/'.$id.'/release')->assertOk();
        $this->assertDatabaseCount('availability_blocks', 1);
        $this->assertNotNull(DB::table('availability_blocks')->where('id', $id)->value('released_at'));
        $this->getJson('/api/admin/availability-blocks')->assertJsonPath('total', 0);
        $this->postJson('/api/admin/availability-blocks/'.$id.'/release')->assertNotFound();
    }

    public function test_invalid_block_fields_and_past_dates_are_rejected(): void
    {
        $this->actingAs($this->account('admin'));
        $this->postJson('/api/admin/availability-blocks', ['date' => 'bad', 'reason' => 'Maintenance'])->assertUnprocessable();
        $this->postJson('/api/admin/availability-blocks', ['date' => now('Asia/Manila')->subDay()->toDateString(), 'reason' => 'Maintenance'])->assertUnprocessable();
        $this->postJson('/api/admin/availability-blocks', ['date' => now('Asia/Manila')->toDateString(), 'reason' => '   '])->assertUnprocessable();
        $this->assertDatabaseCount('availability_blocks', 0);
    }

    public function test_ocular_visit_detail_approval_reschedule_and_cancellation_workflow(): void
    {
        $owner = $this->account('owner');
        $admin = $this->account('admin');
        $day = now('Asia/Manila')->addDays(20)->toDateString();
        $nextDay = now('Asia/Manila')->addDays(21)->toDateString();
        $payload = ['guest_name' => 'Maria Santos', 'contact_details' => '09171234567',
            'visit_date' => $day, 'start_time' => '10:00', 'end_time' => '11:30',
            'status' => 'pending_review', 'inquiry_source' => 'Facebook Messenger', 'notes' => 'Bring two guests.'];

        $created = $this->actingAs($owner)->postJson('/api/admin/ocular-visits', $payload)
            ->assertCreated()->assertJsonPath('ocular_visit.creator_name', $owner->name)
            ->assertJsonPath('ocular_visit.revision', 1)->json('ocular_visit');
        $id = $created['id'];

        $this->getJson('/api/admin/ocular-visits/'.$id)->assertOk()->assertJsonPath('ocular_visit.id', $id);
        $this->postJson('/api/admin/ocular-visits/'.$id.'/approve', ['revision' => 1])
            ->assertOk()->assertJsonPath('ocular_visit.status', 'approved')->assertJsonPath('ocular_visit.revision', 2);
        $this->patchJson('/api/admin/ocular-visits/'.$id, [...$payload, 'visit_date' => $nextDay, 'revision' => 1])->assertConflict();

        $this->patchJson('/api/admin/ocular-visits/'.$id, [...$payload, 'guest_name' => 'Maria Updated',
            'visit_date' => $nextDay, 'start_time' => '13:00', 'end_time' => '14:00', 'revision' => 2])
            ->assertOk()->assertJsonPath('ocular_visit.status', 'approved')->assertJsonPath('ocular_visit.revision', 3);
        $this->assertDatabaseHas('ocular_visits', ['id' => $id, 'guest_name' => 'Maria Updated', 'status' => 'approved', 'revision' => 3]);

        $this->actingAs($admin)->getJson('/api/admin/calendar?start='.$day.'&end='.now('Asia/Manila')->addDays(22)->toDateString())
            ->assertOk()->assertJsonPath('ocular_visits.0.visit_date', $nextDay);
        $this->postJson('/api/admin/ocular-visits/'.$id.'/cancel', ['revision' => 3])
            ->assertOk()->assertJsonPath('ocular_visit.status', 'cancelled')->assertJsonPath('ocular_visit.revision', 4);
        $this->getJson('/api/admin/calendar?start='.$day.'&end='.now('Asia/Manila')->addDays(22)->toDateString())
            ->assertOk()->assertJsonCount(0, 'ocular_visits');
        $this->assertDatabaseHas('ocular_visits', ['id' => $id, 'status' => 'cancelled']);
        $this->postJson('/api/admin/ocular-visits/'.$id.'/cancel', ['revision' => 4])->assertUnprocessable();
    }

    public function test_ocular_visit_rejects_invalid_times_and_past_dates(): void
    {
        $this->actingAs($this->account('admin'));
        $this->postJson('/api/admin/ocular-visits', ['guest_name' => 'Guest', 'contact_details' => 'Phone',
            'visit_date' => now('Asia/Manila')->subDay()->toDateString(), 'start_time' => '11:00',
            'end_time' => '10:00', 'status' => 'unknown'])->assertUnprocessable();
        $this->assertDatabaseCount('ocular_visits', 0);
    }

    private function account(string $role): User
    {
        return User::factory()->create(['role_id' => Role::where('name', $role)->sole()->id])->fresh();
    }

    private function reservation(User $user, $start, $end, string $status, string $reference): array
    {
        return ['booking_reference' => $reference, 'user_id' => $user->id, 'villa_id' => 1, 'type' => 'overnight',
            'check_in_date' => $start->toDateString(), 'check_out_date' => $end->toDateString(), 'starts_at' => $start->toIso8601String(), 'ends_at' => $end->toIso8601String(),
            'contact_name' => $user->name, 'contact_email' => $user->email, 'contact_phone' => '09171234567', 'adults' => 2, 'inquiry_source' => 'Website',
            'status' => $status, 'price_agreed' => true, 'quoted_total' => 16000, 'pricing_snapshot' => '{}', 'policy_snapshot' => '{}',
            'requested_at' => now(), 'created_at' => now(), 'updated_at' => now()];
    }
}
