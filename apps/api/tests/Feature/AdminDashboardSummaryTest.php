<?php

namespace Tests\Feature;

use App\Models\Role;
use App\Models\User;
use Database\Seeders\ReservationSetupSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class AdminDashboardSummaryTest extends TestCase
{
    use RefreshDatabase;

    protected function beforeRefreshingDatabase(): void
    {
        if (config('database.default') !== 'sqlite' || config('database.connections.sqlite.database') !== ':memory:') {
            throw new \RuntimeException('Dashboard summary tests require isolated SQLite :memory:.');
        }
    }

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(ReservationSetupSeeder::class);
    }

    public function test_summary_uses_complete_records_and_operational_status_rules(): void
    {
        $admin = $this->account('admin');
        $owner = $this->account('owner');
        $firstGuest = $this->account('guest');
        $secondGuest = $this->account('guest');
        $this->reservation($firstGuest, 'CP-DASH-WAITING', 'queued');
        $review = $this->reservation($firstGuest, 'CP-DASH-REVIEW', 'payment_review');
        $confirmed = $this->reservation($secondGuest, 'CP-DASH-CONFIRMED', 'confirmed');
        $method = DB::table('payment_methods')->insertGetId([
            'name' => 'Dashboard Test Transfer',
            'account_name' => 'Carlos Paradise',
            'account_number' => 'DASHBOARD-TEST',
            'is_active' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->payment($review, $firstGuest, $method, 'submitted', 'DASH-SUBMITTED');
        $this->payment($confirmed, $secondGuest, $method, 'approved', 'DASH-APPROVED');

        $expected = [
            'total_reservations' => 3,
            'total_guests' => 2,
            'payments_to_review' => 1,
            'waiting_requests' => 1,
        ];

        $monthIndex = now('Asia/Manila')->addDays(14)->month - 1;
        $month = now('Asia/Manila')->addDays(14)->format('Y-m');
        $this->actingAs($admin)->getJson('/api/admin/dashboard/summary')
            ->assertOk()->assertJson($expected)->assertJsonStructure(['generated_at'])
            ->assertJsonPath('reservation_statuses.0.key', 'confirmed')
            ->assertJsonPath('reservation_statuses.0.count', 1)
            ->assertJsonPath('reservations_per_month.'.$monthIndex.'.month', $month)
            ->assertJsonPath('reservations_per_month.'.$monthIndex.'.count', 3)
            ->assertJsonPath('ongoing_reservation', null)
            ->assertJsonPath('upcoming_movement.kind', 'Check-in')
            ->assertJsonPath('upcoming_movement.reservation.reference', 'CP-DASH-CONFIRMED');
        $this->getJson('/api/admin/reservations?check_in_month='.$month)
            ->assertOk()->assertJsonPath('total', 3);
        $this->actingAs($owner)->getJson('/api/owner/operations/dashboard/summary')
            ->assertOk()->assertJson($expected);
        $this->actingAs($firstGuest)->getJson('/api/admin/dashboard/summary')->assertForbidden();
    }

    private function account(string $role): User
    {
        return User::factory()->create(['role_id' => Role::where('name', $role)->sole()->id])->fresh();
    }

    private function reservation(User $guest, string $reference, string $status): int
    {
        $start = now('Asia/Manila')->addDays(14)->setTime(14, 0);
        $end = $start->copy()->addDay()->setTime(11, 0);

        return (int) DB::table('reservations')->insertGetId([
            'booking_reference' => $reference,
            'user_id' => $guest->id,
            'villa_id' => 1,
            'contact_name' => $guest->name,
            'contact_email' => $guest->email,
            'contact_phone' => '09171234567',
            'type' => 'overnight',
            'check_in_date' => $start->toDateString(),
            'check_out_date' => $end->toDateString(),
            'starts_at' => $start->toIso8601String(),
            'ends_at' => $end->toIso8601String(),
            'adults' => 2,
            'children' => 0,
            'pets' => 0,
            'inquiry_source' => 'Website',
            'status' => $status,
            'quoted_total' => 16000,
            'required_deposit' => 5000,
            'price_agreed' => true,
            'pricing_snapshot' => '{}',
            'policy_snapshot' => '{}',
            'requested_at' => now('Asia/Manila'),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function payment(int $reservation, User $guest, int $method, string $status, string $reference): void
    {
        DB::table('payments')->insert([
            'reservation_id' => $reservation,
            'payment_method_id' => $method,
            'payment_kind' => 'deposit',
            'amount' => 5000,
            'currency' => 'PHP',
            'reference_number' => $reference,
            'receipt_storage_path' => 'dashboard-summary-test.png',
            'payment_date' => now('Asia/Manila')->toDateString(),
            'submitted_at' => now(),
            'status' => $status,
            'submitted_by' => $guest->id,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
}
