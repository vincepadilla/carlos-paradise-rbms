<?php

namespace Tests\Feature;

use App\Models\Role;
use App\Models\User;
use Database\Seeders\ReservationSetupSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

class AdminReservationManagementTest extends TestCase
{
    use RefreshDatabase;

    protected function beforeRefreshingDatabase(): void
    {
        if (config('database.default') !== 'sqlite' || config('database.connections.sqlite.database') !== ':memory:') throw new \RuntimeException('Management tests require isolated SQLite :memory:.');
    }

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(ReservationSetupSeeder::class);
    }

    public function test_admin_edits_booking_snapshot_and_schedule_without_changing_customer_or_verified_payments(): void
    {
        [$id, $guest] = $this->reservation(); $admin = $this->account('admin');
        $payments = DB::table('payments')->get()->toArray();
        $data = $this->payload($id); $data['contact_name'] = 'Booking Contact'; $data['contact_address'] = 'Updated booking address';
        $data['checkin'] = now('Asia/Manila')->addDays(20)->toDateString(); $data['checkout'] = now('Asia/Manila')->addDays(21)->toDateString(); $data['checkin_time'] = '15:00';
        $this->actingAs($admin)->patchJson('/api/admin/reservations/'.$id, $data)->assertOk()
            ->assertJsonPath('reservation.contact_name', 'Booking Contact')->assertJsonPath('details.contact_address', 'Updated booking address')->assertJsonPath('details.revision', 1);
        $this->assertEquals($payments, DB::table('payments')->get()->toArray());
        $this->assertDatabaseHas('users', ['id' => $guest->id, 'name' => $guest->name, 'email' => $guest->email]);
        $this->getJson('/api/admin/calendar?start='.$data['checkin'].'&end='.now('Asia/Manila')->addDays(22)->toDateString())->assertOk()->assertJsonPath('reservations.0.starts_at', $data['checkin'].'T15:00:00+08:00');
        $this->actingAs($guest)->getJson('/api/reservations/'.$id)->assertOk()->assertJsonPath('reservation.starts_at', $data['checkin'].'T15:00:00+08:00');
        $this->assertDatabaseHas('reservation_status_history', ['reservation_id' => $id, 'event' => 'reservation_edited', 'changed_by' => $admin->id]);
        $this->assertDatabaseHas('reservation_status_history', ['reservation_id' => $id, 'event' => 'schedule_changed']);
        $this->assertNotNull(json_decode(DB::table('reservation_status_history')->where('event', 'reservation_edited')->value('changes'), true)['before']);
    }

    public function test_guests_owners_and_inactive_admins_cannot_mutate_any_management_action(): void
    {
        [$id] = $this->reservation();
        $this->patchJson('/api/admin/reservations/'.$id, $this->payload($id))->assertUnauthorized();
        foreach (['guest', 'owner', 'inactive'] as $role) {
            $actor = $this->account($role === 'inactive' ? 'admin' : $role);
            if ($role === 'inactive') $actor->forceFill(['is_active' => false])->save();
            $this->actingAs($actor)->patchJson('/api/admin/reservations/'.$id, $this->payload($id))->assertForbidden();
            $this->postJson('/api/admin/reservations/'.$id.'/complete', ['revision' => 0])->assertForbidden();
            $this->postJson('/api/admin/reservations/'.$id.'/extension-access', [])->assertForbidden();
            $this->deleteJson('/api/admin/reservations/'.$id.'/extension-access', [])->assertForbidden();
        }
    }

    public function test_completed_cancelled_expired_past_and_unverified_reservations_are_read_only(): void
    {
        $this->actingAs($this->account('admin'));
        foreach (['completed', 'cancelled', 'expired', 'pending', 'awaiting_deposit', 'payment_review'] as $status) {
            [$id] = $this->reservation(['status' => $status]);
            $this->patchJson('/api/admin/reservations/'.$id, $this->payload($id))->assertUnprocessable();
        }
        [$id] = $this->reservation(['ends_at' => now()->subDay()->toIso8601String(), 'starts_at' => now()->subDays(2)->toIso8601String()]);
        $this->patchJson('/api/admin/reservations/'.$id, $this->payload($id))->assertUnprocessable();
        [$id] = $this->reservation(); DB::table('payments')->where('reservation_id', $id)->update(['status' => 'submitted']);
        $this->patchJson('/api/admin/reservations/'.$id, $this->payload($id))->assertUnprocessable();
    }

    public function test_secured_and_blocked_conflicts_are_rejected_without_partial_updates(): void
    {
        [$id] = $this->reservation(); $admin = $this->account('admin');
        [$other] = $this->reservation();
        $this->actingAs($admin)->patchJson('/api/admin/reservations/'.$id, [...$this->payload($id), 'contact_name' => 'Must not save'])->assertUnprocessable();
        $this->assertDatabaseMissing('reservations', ['contact_name' => 'Must not save']);
        DB::table('reservations')->where('id', $other)->update(['status' => 'cancelled']);
        $data = $this->payload($id);
        DB::table('availability_blocks')->insert(['villa_id' => 1, 'starts_on' => $data['checkin'], 'ends_on' => now('Asia/Manila')->addDays(12)->toDateString(), 'reason' => 'Maintenance', 'created_by' => $admin->id, 'created_at' => now(), 'updated_at' => now()]);
        $this->patchJson('/api/admin/reservations/'.$id, $data)->assertUnprocessable();
        $this->assertDatabaseCount('reservation_status_history', 0);
    }

    public function test_server_calculates_all_charges_and_base_only_percentage_discount_in_cents(): void
    {
        [$id] = $this->reservation(); $data = $this->payload($id);
        $data['pricing'] = ['base' => '20000.00', 'holiday_fee' => '2000.00', 'extra_fee' => '500.00', 'cleaning_fee' => '1000.00', 'bonfire' => '400.00', 'charcoal' => '90.00', 'liquor' => '1100.00', 'other' => '50.50'];
        $data['discount'] = ['type' => 'percentage', 'value' => '10', 'justification' => 'Returning customer agreement'];
        $this->actingAs($this->account('admin'))->patchJson('/api/admin/reservations/'.$id, $data)->assertOk()
            ->assertJsonPath('reservation.total', '23140.50')->assertJsonPath('details.pricing.discount.amount', '2000.00')
            ->assertJsonPath('details.pricing.liquor', '1100.00')->assertJsonPath('details.pricing.other', '50.50')->assertJsonPath('details.pricing.security_deposit', '2500.00');
        $this->assertDatabaseHas('reservations', ['id' => $id, 'quoted_total' => 23140.50, 'required_deposit' => 5000]);
        $this->assertDatabaseHas('reservation_status_history', ['reservation_id' => $id, 'event' => 'discount_changed']);
    }

    public function test_invalid_money_discounts_and_immutable_fields_are_rejected(): void
    {
        [$id] = $this->reservation(); $this->actingAs($this->account('admin'));
        foreach (['-1', '1.001', 'not money', '100000000'] as $amount) {
            $data = $this->payload($id); $data['pricing']['liquor'] = $amount;
            $this->patchJson('/api/admin/reservations/'.$id, $data)->assertUnprocessable();
        }
        foreach ([['percentage', 101, 'Reason'], ['percentage', -1, 'Reason'], ['fixed', 20000, 'Reason'], ['fixed', 100, ''], ['percentage', 10, '   ']] as [$type, $value, $reason]) {
            $data = $this->payload($id); $data['discount'] = ['type' => $type, 'value' => $value, 'justification' => $reason];
            $this->patchJson('/api/admin/reservations/'.$id, $data)->assertUnprocessable();
        }
        foreach (['status' => 'confirmed', 'payments' => [['status' => 'approved']], 'total' => 1, 'required_deposit' => 0, 'user_id' => 999] as $field => $value) {
            $this->patchJson('/api/admin/reservations/'.$id, [...$this->payload($id), $field => $value])->assertUnprocessable();
        }
        $this->assertDatabaseHas('reservations', ['id' => $id, 'quoted_total' => 16000, 'admin_revision' => 0]);
    }

    public function test_count_email_and_schedule_validation_and_day_tour_rules(): void
    {
        [$id] = $this->reservation(); $this->actingAs($this->account('admin'));
        foreach (['adults' => 0, 'children' => -1, 'pets' => 11, 'contact_email' => 'bad', 'checkout' => 'invalid', 'checkin_time' => '25:00'] as $field => $value) $this->patchJson('/api/admin/reservations/'.$id, [...$this->payload($id), $field => $value])->assertUnprocessable();
        $this->patchJson('/api/admin/reservations/'.$id, [...$this->payload($id), 'adults' => 30, 'children' => 20])->assertUnprocessable();
        $data = $this->payload($id); $data['type'] = 'day_tour';
        $this->patchJson('/api/admin/reservations/'.$id, $data)->assertUnprocessable();
        $data['checkout'] = $data['checkin']; $data['checkin_time'] = '09:00'; $data['checkout_time'] = '18:00';
        $this->patchJson('/api/admin/reservations/'.$id, $data)->assertOk()->assertJsonPath('reservation.type', 'day_tour');
    }

    public function test_revision_conflicts_prevent_silent_overwrites(): void
    {
        [$id] = $this->reservation(); $data = $this->payload($id); $this->actingAs($this->account('admin'));
        $this->patchJson('/api/admin/reservations/'.$id, $data)->assertOk();
        $this->patchJson('/api/admin/reservations/'.$id, [...$data, 'contact_name' => 'Stale editor'])->assertStatus(409);
        $this->assertDatabaseMissing('reservations', ['contact_name' => 'Stale editor']);
    }

    public function test_extension_grant_revoke_and_guest_consumption_are_separate_from_actual_deadline(): void
    {
        [$id, $guest] = $this->reservation(['status' => 'awaiting_deposit']); $admin = $this->account('admin');
        $original = DB::table('reservations')->where('id', $id)->value('deadline'); $date = now('Asia/Manila')->addDays(3)->toDateString();
        DB::table('reservation_opportunities')->insert(['reservation_id' => $id, 'granted_at' => now(), 'deposit_deadline' => $original, 'status' => 'active', 'created_at' => now(), 'updated_at' => now()]);
        $this->actingAs($guest)->postJson('/api/reservations/'.$id.'/extension', ['requested_date' => $date, 'reason' => 'Need more time'])->assertUnprocessable();
        $this->actingAs($admin)->postJson('/api/admin/reservations/'.$id.'/extension-access', ['revision' => 0, 'agreed_deadline' => $date])->assertOk()->assertJsonPath('reservation.extension_access.enabled', 1);
        $this->assertDatabaseHas('reservations', ['id' => $id, 'deadline' => $original]);
        $this->deleteJson('/api/admin/reservations/'.$id.'/extension-access', ['revision' => 1])->assertOk();
        $this->postJson('/api/admin/reservations/'.$id.'/extension-access', ['revision' => 2, 'agreed_deadline' => $date])->assertOk();
        $this->actingAs($guest)->postJson('/api/reservations/'.$id.'/extension', ['requested_date' => $date, 'reason' => 'Agreed with admin'])->assertCreated()->assertJsonPath('reservation.extension_status', 'pending');
        $this->assertDatabaseHas('reservations', ['id' => $id, 'deadline' => $original]);
        $this->actingAs($admin)->deleteJson('/api/admin/reservations/'.$id.'/extension-access', ['revision' => 4])->assertUnprocessable();
        $this->postJson('/api/reservations/'.$id.'/extension/review', ['decision' => 'approved'])->assertOk();
        $this->assertDatabaseMissing('reservations', ['id' => $id, 'deadline' => $original]);
        $this->assertDatabaseHas('reservation_status_history', ['reservation_id' => $id, 'event' => 'extension_access_consumed']);
    }

    public function test_damage_changes_are_ongoing_only_audited_and_subtract_verified_payments_from_amount_due(): void
    {
        [$id, $guest] = $this->reservation(); $admin = $this->account('admin'); $this->actingAs($admin);
        $data = $this->payload($id); $data['damages'] = [$this->damage()];
        $this->patchJson('/api/admin/reservations/'.$id, $data)->assertUnprocessable();
        $this->assertDatabaseCount('reservation_damages', 0); $this->assertDatabaseCount('reservation_status_history', 0);
        DB::table('reservations')->where('id', $id)->update(['starts_at' => now('Asia/Manila')->subHour()->toIso8601String(), 'ends_at' => now('Asia/Manila')->addDay()->toIso8601String(), 'type' => 'overnight']);
        $data = $this->payload($id); $data['damages'] = [$this->damage()];
        $damageId = $this->patchJson('/api/admin/reservations/'.$id, $data)->assertOk()->assertJsonPath('details.totals.damage_total', '1200.50')->assertJsonPath('details.totals.amount_due', '12200.50')->json('details.damages.0.id');
        $this->actingAs($guest)->getJson('/api/reservations/'.$id)->assertOk()->assertJsonPath('reservation.damage_total', '1200.50')->assertJsonPath('reservation.amount_due', '12200.50');
        $this->actingAs($admin);
        $data['revision'] = 1; $data['damages'] = [['id' => $damageId, ...$this->damage(), 'amount' => 500]];
        $this->patchJson('/api/admin/reservations/'.$id, $data)->assertOk()->assertJsonPath('details.totals.damage_total', '500.00');
        $data['revision'] = 2; $data['damages'] = [];
        $this->patchJson('/api/admin/reservations/'.$id, $data)->assertOk()->assertJsonPath('details.totals.damage_total', '0.00');
        $this->assertDatabaseCount('reservation_damages', 1); $this->assertNotNull(DB::table('reservation_damages')->where('id', $damageId)->value('deleted_at'));
        foreach (['damage_added', 'damage_edited', 'damage_removed'] as $event) $this->assertDatabaseHas('reservation_status_history', ['reservation_id' => $id, 'event' => $event]);
    }

    public function test_foreign_damage_id_rolls_back_booking_pricing_and_audit_together(): void
    {
        [$id] = $this->reservation(['starts_at' => now('Asia/Manila')->subHour()->toIso8601String(), 'ends_at' => now('Asia/Manila')->addDay()->toIso8601String()]);
        $data = $this->payload($id); $data['contact_name'] = 'Do not save'; $data['damages'] = [['id' => 999999, ...$this->damage()]];
        $this->actingAs($this->account('admin'))->patchJson('/api/admin/reservations/'.$id, $data)->assertUnprocessable();
        $this->assertDatabaseMissing('reservations', ['contact_name' => 'Do not save']); $this->assertDatabaseCount('reservation_status_history', 0);
    }

    public function test_future_cannot_complete_but_ongoing_and_past_stays_complete_and_become_read_only(): void
    {
        $this->actingAs($this->account('admin')); [$future] = $this->reservation();
        $this->postJson('/api/admin/reservations/'.$future.'/complete', ['revision' => 0])->assertUnprocessable();
        foreach ([now('Asia/Manila')->addDay(), now('Asia/Manila')->subHour()] as $end) {
            [$id] = $this->reservation(['starts_at' => now('Asia/Manila')->subDay()->toIso8601String(), 'ends_at' => $end->toIso8601String()]);
            $this->postJson('/api/admin/reservations/'.$id.'/complete', ['revision' => 0])->assertOk()->assertJsonPath('reservation.status', 'completed')->assertJsonPath('details.capabilities.can_edit', false);
            $this->assertNotNull(DB::table('reservations')->where('id', $id)->value('completed_at'));
            $this->patchJson('/api/admin/reservations/'.$id, $this->payload($id))->assertUnprocessable();
            $this->postJson('/api/admin/reservations/'.$id.'/complete', ['revision' => 1])->assertUnprocessable();
            $this->getJson('/api/admin/calendar?start='.now('Asia/Manila')->subDays(2)->toDateString().'&end='.now('Asia/Manila')->addDays(2)->toDateString())->assertOk()->assertJsonFragment(['id' => $id, 'status' => 'completed']);
        }
    }

    public function test_multiple_verified_payments_are_summed_and_fixed_discounts_persist(): void
    {
        [$id, $guest] = $this->reservation();
        $payment = (array) DB::table('payments')->where('reservation_id', $id)->first(); unset($payment['id']);
        DB::table('payments')->insert([...$payment, 'amount' => '2000.25', 'reference_number' => 'ADDITIONAL-VERIFIED']);
        $data = $this->payload($id); $data['discount'] = ['type' => 'fixed', 'value' => '100.50', 'justification' => 'Agreed booking discount'];
        $this->actingAs($this->account('admin'))->patchJson('/api/admin/reservations/'.$id, $data)->assertOk()->assertJsonPath('reservation.total', '15899.50')
            ->assertJsonPath('details.pricing.discount.amount', '100.50')->assertJsonPath('details.totals.paid', '7000.25')->assertJsonPath('details.totals.amount_due', '8899.25');
    }

    public function test_ongoing_edits_preserve_arrival_seconds_when_postgres_returns_utc_timestamps(): void
    {
        $start = now()->subHour()->setSecond(17); $end = now()->addDay()->setSecond(31);
        [$id] = $this->reservation(['starts_at' => $start->toIso8601String(), 'ends_at' => $end->toIso8601String()]);
        $this->actingAs($this->account('admin'))->patchJson('/api/admin/reservations/'.$id, $this->payload($id))->assertOk();
        $this->assertTrue(\Carbon\CarbonImmutable::parse(DB::table('reservations')->where('id', $id)->value('starts_at'))->equalTo($start->setMicrosecond(0)));
    }

    public function test_extension_dates_outside_the_agreement_are_rejected_without_consuming_permission(): void
    {
        [$id, $guest] = $this->reservation(['status' => 'awaiting_deposit']); $admin = $this->account('admin');
        $this->actingAs($admin)->postJson('/api/admin/reservations/'.$id.'/extension-access', ['revision' => 0, 'agreed_deadline' => now('Asia/Manila')->toDateString()])->assertUnprocessable();
        $this->postJson('/api/admin/reservations/'.$id.'/extension-access', ['revision' => 0, 'agreed_deadline' => now('Asia/Manila')->addDays(15)->toDateString()])->assertUnprocessable();
        $this->postJson('/api/admin/reservations/'.$id.'/extension-access', ['revision' => 0, 'agreed_deadline' => now('Asia/Manila')->addDays(3)->toDateString()])->assertOk();
        $this->actingAs($guest)->postJson('/api/reservations/'.$id.'/extension', ['requested_date' => now('Asia/Manila')->addDays(4)->toDateString(), 'reason' => 'A later date'])->assertUnprocessable();
        $this->assertDatabaseHas('reservation_extension_access', ['reservation_id' => $id, 'enabled' => true, 'consumed_at' => null]);
    }

    private function damage(): array { return ['description' => 'Broken chair', 'item_area' => 'Poolside', 'amount' => '1200.50', 'notes' => 'Verified at checkout']; }
    private function account(string $role): User { return User::factory()->create(['role_id' => Role::where('name', $role)->sole()->id])->fresh(); }

    private function reservation(array $overrides = []): array
    {
        $guest = $this->account('guest'); $start = now('Asia/Manila')->addDays(10)->setTime(14, 0); $end = $start->copy()->addDay()->setTime(11, 0);
        $id = DB::table('reservations')->insertGetId([...[
            'booking_reference' => 'MANAGE-'.Str::uuid(), 'user_id' => $guest->id, 'villa_id' => 1, 'type' => 'overnight', 'check_in_date' => $start->toDateString(), 'check_out_date' => $end->toDateString(), 'starts_at' => $start->toIso8601String(), 'ends_at' => $end->toIso8601String(),
            'contact_name' => $guest->name, 'contact_email' => $guest->email, 'contact_phone' => '09171234567', 'inquiry_source' => 'Website', 'adults' => 2, 'status' => 'confirmed', 'price_agreed' => true, 'quoted_total' => 16000, 'required_deposit' => 5000,
            'pricing_snapshot' => json_encode(['base' => 16000, 'holiday_fee' => 0, 'extra_fee' => 0, 'cleaning_fee' => 0, 'optional_fee' => 0, 'security_deposit' => 2500]), 'policy_snapshot' => '{}', 'deadline' => now('Asia/Manila')->addDay()->toIso8601String(), 'requested_at' => now(), 'created_at' => now(), 'updated_at' => now(),
        ], ...$overrides]);
        $method = DB::table('payment_methods')->value('id') ?? DB::table('payment_methods')->insertGetId(['name' => 'GCash', 'account_name' => 'Resort', 'account_number' => 'MANAGEMENT-TEST', 'created_at' => now(), 'updated_at' => now()]);
        DB::table('payments')->insert(['reservation_id' => $id, 'payment_method_id' => $method, 'payment_kind' => 'deposit', 'amount' => 5000, 'reference_number' => 'VERIFIED-'.Str::uuid(), 'receipt_storage_path' => 'not-used', 'status' => 'approved', 'submitted_by' => $guest->id, 'submitted_at' => now(), 'created_at' => now(), 'updated_at' => now()]);
        return [$id, $guest];
    }

    private function payload(int $id): array
    {
        $r = DB::table('reservations')->where('id', $id)->first();
        $start = \Carbon\CarbonImmutable::parse($r->starts_at, 'Asia/Manila')->setTimezone('Asia/Manila'); $end = \Carbon\CarbonImmutable::parse($r->ends_at, 'Asia/Manila')->setTimezone('Asia/Manila');
        return ['revision' => $r->admin_revision, 'contact_name' => $r->contact_name, 'contact_email' => $r->contact_email, 'contact_phone' => $r->contact_phone, 'contact_address' => null, 'inquiry_source' => 'Website', 'type' => $r->type,
            'checkin' => $start->toDateString(), 'checkout' => $end->toDateString(), 'checkin_time' => $start->format('H:i'), 'checkout_time' => $end->format('H:i'), 'adults' => 2, 'children' => 0, 'pets' => 0, 'notes' => null,
            'pricing' => ['base' => '16000', 'holiday_fee' => '0', 'extra_fee' => '0', 'cleaning_fee' => '0', 'bonfire' => '0', 'charcoal' => '0', 'liquor' => '0', 'other' => '0'], 'discount' => ['type' => 'none', 'value' => '0', 'justification' => null]];
    }
}
