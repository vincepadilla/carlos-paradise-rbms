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
            ->assertOk()->assertJsonCount(501, 'reservations')->assertJsonCount(0, 'blocks')
            ->assertJsonPath('reservations.0.google_sync.state', 'pending')
            ->assertJsonPath('google_calendar.direction', 'one_way')
            ->assertJsonPath('google_calendar.schedule', 'every_minute');
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
        $this->getJson('/api/admin/calendar?start='.$day->toDateString().'&end='.$day->copy()->addDays(2)->toDateString())
            ->assertOk()->assertJsonPath('blocks.0.id', $id)->assertJsonPath('blocks.0.google_sync.state', 'pending');
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

        DB::table('ocular_visits')->where('id', $id)->update([
            'google_event_id' => 'cpotestmapping', 'google_calendar_id' => 'test-calendar',
            'google_sync_hash' => str_repeat('a', 64), 'google_synced_at' => now()->addSecond(),
        ]);

        $this->actingAs($admin)->getJson('/api/admin/calendar?start='.$day.'&end='.now('Asia/Manila')->addDays(22)->toDateString())
            ->assertOk()->assertJsonPath('ocular_visits.0.visit_date', $nextDay)
            ->assertJsonPath('ocular_visits.0.google_sync.state', 'synced')
            ->assertJsonMissingPath('ocular_visits.0.google_event_id');
        $this->actingAs($owner)->getJson('/api/owner/operations/calendar?start='.$day.'&end='.now('Asia/Manila')->addDays(22)->toDateString())
            ->assertOk()->assertJsonPath('ocular_visits.0.google_sync.state', 'synced');
        $this->postJson('/api/admin/ocular-visits/'.$id.'/cancel', ['revision' => 3])
            ->assertOk()->assertJsonPath('ocular_visit.status', 'cancelled')->assertJsonPath('ocular_visit.revision', 4);
        $this->actingAs($admin)->getJson('/api/admin/calendar?start='.$day.'&end='.now('Asia/Manila')->addDays(22)->toDateString())
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

    public function test_ocular_suggestions_and_consecutive_visits_work_for_admin_and_owner(): void
    {
        foreach (['admin' => '/api/admin', 'owner' => '/api/owner/operations'] as $role => $prefix) {
            $this->actingAs($this->account($role));
            $payload = $this->ocularPayload(now('Asia/Manila')->addDays($role === 'admin' ? 30 : 31)->toDateString());
            $url = $prefix.'/ocular-visits';
            $this->getJson($url.'/suggested-slot?date='.$payload['visit_date'])->assertOk()
                ->assertJsonPath('suggested_slot', ['start_time' => '10:00', 'end_time' => '11:00']);
            $this->postJson($url, $payload)->assertCreated();
            $this->getJson($url.'/suggested-slot?date='.$payload['visit_date'])->assertOk()
                ->assertJsonPath('suggested_slot', ['start_time' => '11:00', 'end_time' => '12:00']);
            $this->postJson($url, [...$payload, 'start_time' => '11:00', 'end_time' => '12:00', 'status' => 'approved'])->assertCreated();
            $this->postJson($url, [...$payload, 'start_time' => '09:00', 'end_time' => '10:00'])->assertCreated();
            $this->postJson($url, [...$payload, 'start_time' => '10:30', 'end_time' => '11:30'])
                ->assertUnprocessable()->assertJsonValidationErrors('start_time');
        }
    }

    public function test_ocular_conflicts_cover_containment_cancelled_visits_and_rescheduling_self(): void
    {
        $this->actingAs($this->account('admin'));
        $payload = $this->ocularPayload(now('Asia/Manila')->addDays(30)->toDateString());
        $url = '/api/admin/ocular-visits';
        $id = $this->postJson($url, $payload)->assertCreated()->json('ocular_visit.id');
        foreach ([['10:15', '10:45'], ['09:30', '11:30'], ['09:30', '10:30'], ['10:30', '11:30']] as [$start, $end]) {
            $this->postJson($url, [...$payload, 'start_time' => $start, 'end_time' => $end])
                ->assertUnprocessable()->assertJsonPath('errors.start_time.0', 'This time overlaps an existing ocular visit. Choose another start and end time.');
        }
        $this->patchJson($url.'/'.$id, [...$payload, 'revision' => 1])->assertOk()->assertJsonPath('ocular_visit.revision', 2);
        $other = $this->postJson($url, [...$payload, 'start_time' => '11:00', 'end_time' => '12:00'])->assertCreated()->json('ocular_visit.id');
        $this->patchJson($url.'/'.$id, [...$payload, 'start_time' => '10:30', 'end_time' => '11:30', 'revision' => 2])
            ->assertUnprocessable()->assertJsonValidationErrors('start_time');
        $this->postJson($url.'/'.$other.'/cancel', ['revision' => 1])->assertOk();
        $this->patchJson($url.'/'.$id, [...$payload, 'start_time' => '11:00', 'end_time' => '12:00', 'revision' => 2])->assertOk();
        $this->getJson($url.'/suggested-slot?date='.$payload['visit_date'])->assertOk()
            ->assertJsonPath('suggested_slot.start_time', '10:00');
    }

    public function test_ocular_visits_respect_protected_stays_cleaning_and_blocks(): void
    {
        $admin = $this->account('admin');
        $this->actingAs($admin);
        $day = now('Asia/Manila')->addDays(30)->startOfDay();
        foreach (['confirmed', 'reserved', 'payment_review', 'awaiting_deposit', 'expired', 'cancelled'] as $index => $status) {
            $date = $day->copy()->addDays($index * 2);
            $id = DB::table('reservations')->insertGetId($this->reservation($admin,
                $date->copy()->subDay()->addHours(14), $date->copy()->addHours(11), $status, 'OCULAR-'.$index));
            if (in_array($status, ['awaiting_deposit', 'expired', 'cancelled'], true)) {
                DB::table('reservation_opportunities')->insert(['reservation_id' => $id, 'status' => 'expired',
                    'granted_at' => now()->subDay(), 'deposit_deadline' => now()->subHour()]);
            }
            $payload = $this->ocularPayload($date->toDateString());
            $this->postJson('/api/admin/ocular-visits', $payload)->assertUnprocessable()->assertJsonValidationErrors('start_time');
            $this->postJson('/api/admin/ocular-visits', [...$payload, 'start_time' => '12:00', 'end_time' => '13:00'])
                ->assertUnprocessable()->assertJsonValidationErrors('start_time');
            $this->getJson('/api/admin/ocular-visits/suggested-slot?date='.$date->toDateString())->assertOk()
                ->assertJsonPath('suggested_slot', ['start_time' => '13:00', 'end_time' => '14:00']);
            $this->postJson('/api/admin/ocular-visits', [...$payload, 'start_time' => '13:00', 'end_time' => '14:00'])->assertCreated();
        }
        // A whole-day block leaves no suggested slot. Released blocks do not occupy time.
        $date = $day->copy()->addDays(20);
        $block = DB::table('availability_blocks')->insertGetId(['villa_id' => 1, 'starts_on' => $date->toDateString(),
            'ends_on' => $date->copy()->addDay()->toDateString(), 'reason' => 'Maintenance', 'created_by' => $admin->id]);
        $this->getJson('/api/admin/ocular-visits/suggested-slot?date='.$date->toDateString())->assertOk()->assertJsonPath('suggested_slot', null);
        $this->postJson('/api/admin/ocular-visits', $this->ocularPayload($date->toDateString()))->assertUnprocessable();
        DB::table('availability_blocks')->where('id', $block)->update(['released_at' => now()]);
        $this->getJson('/api/admin/ocular-visits/suggested-slot?date='.$date->toDateString())->assertOk()->assertJsonPath('suggested_slot.start_time', '10:00');
    }

    public function test_ocular_approval_rechecks_new_protected_entries(): void
    {
        $admin = $this->account('admin');
        $this->actingAs($admin);
        $day = now('Asia/Manila')->addDays(30)->startOfDay();
        $payload = $this->ocularPayload($day->toDateString());
        $id = $this->postJson('/api/admin/ocular-visits', $payload)->assertCreated()->json('ocular_visit.id');
        DB::table('reservations')->insert($this->reservation($admin, $day->copy()->addHours(9),
            $day->copy()->addHours(12), 'confirmed', 'OCULAR-APPROVAL'));
        $this->postJson('/api/admin/ocular-visits/'.$id.'/approve', ['revision' => 1])
            ->assertUnprocessable()->assertJsonValidationErrors('start_time');
        $this->assertDatabaseHas('ocular_visits', ['id' => $id, 'status' => 'pending_review', 'revision' => 1]);
    }

    public function test_ocular_slot_suggestions_require_staff_and_reject_past_dates(): void
    {
        $url = '/api/admin/ocular-visits/suggested-slot?date=';
        $this->getJson($url.now('Asia/Manila')->addDay()->toDateString())->assertUnauthorized();
        $this->actingAs($this->account('guest'))->getJson($url.now('Asia/Manila')->addDay()->toDateString())->assertForbidden();
        $this->actingAs($this->account('admin'))->getJson($url.now('Asia/Manila')->subDay()->toDateString())->assertUnprocessable();
    }

    public function test_ocular_suggestions_skip_partial_gaps_and_use_custom_visit_end_times(): void
    {
        $this->actingAs($this->account('admin'));
        $payload = $this->ocularPayload(now('Asia/Manila')->addDays(30)->toDateString());
        $this->postJson('/api/admin/ocular-visits', [...$payload, 'end_time' => '10:30'])->assertCreated();
        $this->postJson('/api/admin/ocular-visits', [...$payload, 'start_time' => '11:00', 'end_time' => '12:15'])->assertCreated();
        $this->getJson('/api/admin/ocular-visits/suggested-slot?date='.$payload['visit_date'])->assertOk()
            ->assertJsonPath('suggested_slot', ['start_time' => '12:15', 'end_time' => '13:15']);
    }

    public function test_ocular_suggestions_today_are_in_the_future_in_manila(): void
    {
        $this->actingAs($this->account('admin'));
        \Carbon\CarbonImmutable::withTestNow('2030-01-05T10:30:30+08:00', function () {
            $this->getJson('/api/admin/ocular-visits/suggested-slot?date=2030-01-05')->assertOk()
                ->assertJsonPath('suggested_slot', ['start_time' => '10:31', 'end_time' => '11:31']);
        });
    }

    public function test_an_ordinary_waiting_request_does_not_block_an_ocular_visit(): void
    {
        $admin = $this->account('admin');
        $this->actingAs($admin);
        $day = now('Asia/Manila')->addDays(30)->startOfDay();
        DB::table('reservations')->insert($this->reservation($admin, $day->copy()->addHours(9),
            $day->copy()->addHours(12), 'queued', 'OCULAR-QUEUED'));
        $this->postJson('/api/admin/ocular-visits', $this->ocularPayload($day->toDateString()))->assertCreated();
    }

    private function ocularPayload(string $date): array
    {
        return ['guest_name' => 'Visitor', 'contact_details' => '09171234567', 'visit_date' => $date,
            'start_time' => '10:00', 'end_time' => '11:00', 'status' => 'pending_review'];
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
