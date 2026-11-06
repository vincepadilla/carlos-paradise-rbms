<?php

namespace Tests\Feature;

use App\Models\Role;
use App\Models\User;
use Database\Seeders\ReservationSetupSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class AdminReservationDetailsTest extends TestCase
{
    use RefreshDatabase;

    protected function beforeRefreshingDatabase(): void
    {
        if (config('database.default') !== 'sqlite' || config('database.connections.sqlite.database') !== ':memory:') {
            throw new \RuntimeException('Reservation detail tests require isolated SQLite :memory:.');
        }
    }

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(ReservationSetupSeeder::class);
    }

    public function test_detail_uses_saved_prices_and_allowlisted_metadata_with_real_reservation_and_payments(): void
    {
        $guest = $this->account('guest');
        $id = $this->reservation($guest);
        $method = DB::table('payment_methods')->insertGetId(['name' => 'GCash', 'account_name' => 'Test Resort', 'account_number' => 'TEST-ACCOUNT', 'created_at' => now(), 'updated_at' => now()]);
        DB::table('payments')->insert(['reservation_id' => $id, 'payment_method_id' => $method, 'reference_number' => 'ACTUAL-RECEIPT', 'amount' => 5000, 'status' => 'approved', 'receipt_storage_path' => 'private/receipt.png', 'submitted_by' => $guest->id, 'submitted_at' => now(), 'created_at' => now(), 'updated_at' => now()]);
        $this->actingAs($this->account('admin'))->getJson('/api/reservations/'.$id)->assertOk()
            ->assertJsonPath('reservation.id', $id)->assertJsonPath('reservation.reference', 'DETAIL-'.$guest->id)
            ->assertJsonPath('reservation.payments.0.reference', 'ACTUAL-RECEIPT')
            ->assertJsonPath('details.inquiry_source', 'Phone Call')->assertJsonPath('details.pricing.base', '15000.00')
            ->assertJsonPath('details.pricing.bonfire', '800.00')->assertJsonPath('details.pricing.charcoal', '90.00')
            ->assertJsonPath('details.pricing.security_deposit', '2500.00')
            ->assertJsonMissingPath('details.policy_snapshot')->assertJsonMissingPath('details.pricing.total')
            ->assertJsonMissingPath('reservation.payments.0.receipt_storage_path');
    }

    public function test_metadata_does_not_expand_guest_access_and_invalid_ids_are_safe(): void
    {
        $guest = $this->account('guest');
        $id = $this->reservation($guest);
        $this->getJson('/api/reservations/'.$id)->assertUnauthorized();
        $this->actingAs($guest)->getJson('/api/reservations/'.$id)->assertOk()->assertJsonMissingPath('details');
        $this->actingAs($this->account('guest'))->getJson('/api/reservations/'.$id)->assertForbidden();
        $this->actingAs($this->account('admin'))->getJson('/api/reservations/999999')->assertNotFound();
    }

    public function test_missing_snapshots_and_unreconciled_optional_charges_do_not_invent_prices(): void
    {
        $id = $this->reservation($this->account('guest'), ['pricing_snapshot' => '{}', 'policy_snapshot' => '{}']);
        $this->actingAs($this->account('admin'))->getJson('/api/reservations/'.$id)->assertOk()
            ->assertJsonPath('details.pricing.base', null)->assertJsonPath('details.pricing.security_deposit', null)
            ->assertJsonPath('details.pricing.bonfire', null)->assertJsonPath('details.pricing.charcoal', null);
        DB::table('reservations')->where('id', $id)->update(['pricing_snapshot' => json_encode(['optional_fee' => 100]), 'policy_snapshot' => json_encode(['settings' => ['bonfire_price' => 400, 'charcoal_price' => 30]])]);
        $this->getJson('/api/reservations/'.$id)->assertOk()->assertJsonPath('details.pricing.optional_fee', '100.00')
            ->assertJsonPath('details.pricing.bonfire', null)->assertJsonPath('details.pricing.charcoal', null);
    }

    public function test_existing_day_tour_terms_persist_and_reject_invalid_or_unsupported_edits(): void
    {
        $guest = $this->account('guest');
        $admin = $this->account('admin');
        $id = $this->reservation($guest, ['type' => 'day_tour', 'status' => 'pending', 'price_agreed' => false]);
        $this->actingAs($guest)->patchJson('/api/reservations/'.$id.'/terms', ['total' => 7000])->assertForbidden();
        $this->actingAs($admin)->patchJson('/api/reservations/'.$id.'/terms', ['total' => 4999.99])->assertUnprocessable();
        $this->patchJson('/api/reservations/'.$id.'/terms', ['total' => 7250.50])->assertOk();
        $this->assertDatabaseHas('reservations', ['id' => $id, 'quoted_total' => 7250.50, 'price_agreed' => true, 'processed_by' => $admin->id]);
        $this->getJson('/api/reservations/'.$id)->assertOk()->assertJsonPath('reservation.total', '7250.50');
        DB::table('reservations')->where('id', $id)->update(['type' => 'overnight']);
        $this->patchJson('/api/reservations/'.$id.'/terms', ['total' => 8000])->assertUnprocessable();
        $this->assertDatabaseHas('reservations', ['id' => $id, 'quoted_total' => 7250.50]);
    }

    public function test_existing_extension_review_persists_actual_deadline_and_active_opportunity(): void
    {
        $admin = $this->account('admin');
        $requested = now('Asia/Manila')->addDays(5);
        $id = $this->reservation($this->account('guest'), ['status' => 'awaiting_deposit', 'extension_status' => 'pending', 'extension_date' => $requested->toDateString(), 'deadline' => now('Asia/Manila')->addDay()->toIso8601String()]);
        DB::table('reservation_opportunities')->insert(['reservation_id' => $id, 'granted_at' => now(), 'deposit_deadline' => now()->addDay(), 'status' => 'active', 'granted_by' => $admin->id, 'created_at' => now(), 'updated_at' => now()]);
        $this->actingAs($admin)->postJson('/api/reservations/'.$id.'/extension/review', ['decision' => 'approved'])->assertOk()->assertJsonPath('reservation.extension_status', 'approved');
        $deadline = $requested->endOfDay()->toIso8601String();
        $this->assertDatabaseHas('reservations', ['id' => $id, 'extension_status' => 'approved', 'deadline' => $deadline]);
        $this->assertDatabaseHas('reservation_opportunities', ['reservation_id' => $id, 'deposit_deadline' => $deadline]);
        $this->postJson('/api/reservations/'.$id.'/extension/review', ['decision' => 'rejected'])->assertUnprocessable();
        DB::table('reservations')->where('id', $id)->update(['extension_status' => 'pending']);
        $this->postJson('/api/reservations/'.$id.'/extension/review', ['decision' => 'rejected'])->assertOk();
        $this->assertDatabaseHas('reservations', ['id' => $id, 'extension_status' => 'rejected', 'deadline' => $deadline]);
    }

    private function account(string $role): User
    {
        return User::factory()->create(['role_id' => Role::where('name', $role)->sole()->id])->fresh();
    }

    private function reservation(User $user, array $overrides = []): int
    {
        $start = now('Asia/Manila')->addDays(20)->setTime(14, 0);
        $end = $start->copy()->addDay()->setTime(11, 0);
        return DB::table('reservations')->insertGetId(array_merge([
            'booking_reference' => 'DETAIL-'.$user->id, 'user_id' => $user->id, 'villa_id' => 1, 'type' => 'overnight',
            'check_in_date' => $start->toDateString(), 'check_out_date' => $end->toDateString(), 'starts_at' => $start->toIso8601String(), 'ends_at' => $end->toIso8601String(),
            'contact_name' => $user->name, 'contact_email' => $user->email, 'contact_phone' => '09171234567', 'inquiry_source' => 'Phone Call', 'adults' => 2,
            'status' => 'confirmed', 'price_agreed' => true, 'quoted_total' => 15890, 'required_deposit' => 5000, 'bonfire_qty' => 2, 'charcoal_qty' => 3,
            'pricing_snapshot' => json_encode(['base' => 15000, 'extra_fee' => 0, 'holiday_fee' => 0, 'cleaning_fee' => 0, 'optional_fee' => 890, 'security_deposit' => 2500]),
            'policy_snapshot' => json_encode(['settings' => ['bonfire_price' => 400, 'charcoal_price' => 30, 'security_deposit' => 3000], 'private' => 'not exposed']),
            'requested_at' => now(), 'created_at' => now(), 'updated_at' => now(),
        ], $overrides));
    }
}
