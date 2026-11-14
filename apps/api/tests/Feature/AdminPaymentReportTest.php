<?php

namespace Tests\Feature;

use App\Models\Role;
use App\Models\User;
use Database\Seeders\ReservationSetupSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

class AdminPaymentReportTest extends TestCase
{
    use RefreshDatabase;

    protected function beforeRefreshingDatabase(): void
    {
        if (config('database.default') !== 'sqlite' || config('database.connections.sqlite.database') !== ':memory:') {
            throw new \RuntimeException('Payment report tests require isolated SQLite :memory:.');
        }
    }

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(ReservationSetupSeeder::class);
    }

    public function test_payment_report_requires_an_active_admin(): void
    {
        $this->getJson('/api/admin/reports/payments')->assertUnauthorized();

        foreach (['guest', 'owner'] as $role) {
            $this->actingAs($this->account($role))
                ->getJson('/api/admin/reports/payments')
                ->assertForbidden();
        }

        $admin = $this->account('admin');
        $admin->forceFill(['is_active' => false])->save();
        $this->actingAs($admin)
            ->getJson('/api/admin/reports/payments')
            ->assertForbidden();
    }

    public function test_report_includes_unpaid_reservations_and_filters_by_date_status_and_reference(): void
    {
        $admin = $this->account('admin');
        $guest = $this->account('guest');
        $thisMonth = now('Asia/Manila')->startOfMonth()->addDays(4);
        $lastMonth = now('Asia/Manila')->subMonthNoOverflow()->startOfMonth()->addDays(4);
        $unpaid = $this->reservation($guest, $thisMonth, 'CP-UNPAID');
        $submitted = $this->reservation($guest, $thisMonth->copy()->addDay(), 'CP-SUBMITTED');
        $older = $this->reservation($guest, $lastMonth, 'CP-OLDER');
        $rejected = $this->reservation($guest, $lastMonth->copy()->addDay(), 'CP-REJECTED');
        $method = $this->method('GCash');
        $this->payment($submitted, $guest, $method, 'submitted', 2500, 'PAYMENT-SEARCH-123');
        $this->payment($rejected, $guest, $method, 'rejected', 5000, 'PAYMENT-REJECTED');

        $this->actingAs($admin)
            ->getJson('/api/admin/reports/payments')
            ->assertOk()
            ->assertJsonPath('total', 2)
            ->assertJsonPath('filters.applied.date_range', 'this_month');

        $this->getJson('/api/admin/reports/payments?date_range=all&payment_status=unpaid')
            ->assertOk()
            ->assertJsonPath('total', 2)
            ->assertJsonFragment(['id' => $unpaid])
            ->assertJsonFragment(['id' => $older]);

        $this->getJson('/api/admin/reports/payments?date_range=all&payment_status=awaiting_review')
            ->assertOk()
            ->assertJsonPath('total', 1)
            ->assertJsonPath('data.0.id', $submitted);

        $this->getJson('/api/admin/reports/payments?date_range=all&payment_status=rejected')
            ->assertOk()
            ->assertJsonPath('total', 1)
            ->assertJsonPath('data.0.id', $rejected)
            ->assertJsonPath('data.0.verified_amount', '0.00');

        $this->getJson('/api/admin/reports/payments?date_range=all&search=PAYMENT-SEARCH-123')
            ->assertOk()
            ->assertJsonPath('total', 1)
            ->assertJsonPath('data.0.id', $submitted);

        $this->getJson('/api/admin/reports/payments?date_range=custom&start_date='.$thisMonth->toDateString().'&end_date='.$thisMonth->toDateString())
            ->assertOk()
            ->assertJsonPath('total', 1)
            ->assertJsonPath('data.0.id', $unpaid);
    }

    public function test_report_aggregates_methods_and_amounts_without_duplicates_or_rejected_verification(): void
    {
        $admin = $this->account('admin');
        $guest = $this->account('guest');
        $reservation = $this->reservation($guest, now('Asia/Manila')->startOfMonth()->addDays(7), 'CP-MULTI');
        $gcash = $this->method('GCash');
        $bank = $this->method('Bank Transfer');

        $this->payment($reservation, $guest, $gcash, 'submitted', 1500, 'SUBMITTED-REF');
        $this->payment($reservation, $guest, $bank, 'approved', 2000, 'APPROVED-REF');
        $this->payment($reservation, $guest, $bank, 'rejected', 9000, 'REJECTED-REF');

        $this->actingAs($admin)
            ->getJson('/api/admin/reports/payments?date_range=all')
            ->assertOk()
            ->assertJsonPath('total', 1)
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.payment_status', 'partially_verified')
            ->assertJsonPath('data.0.submitted_amount', '1500.00')
            ->assertJsonPath('data.0.verified_amount', '2000.00')
            ->assertJsonPath('data.0.required_amount', '5000.00')
            ->assertJsonPath('data.0.methods', ['GCash', 'Bank Transfer']);

        $this->getJson('/api/admin/reports/payments?date_range=all&payment_status=partially_verified')
            ->assertOk()
            ->assertJsonPath('total', 1)
            ->assertJsonPath('data.0.id', $reservation);
    }

    public function test_verified_filter_and_complete_print_and_export_are_reservation_level(): void
    {
        $admin = $this->account('admin');
        $guest = $this->account('guest');
        $date = now('Asia/Manila')->startOfMonth()->addDays(9);
        $method = $this->method('Card');
        $verified = $this->reservation($guest, $date, 'CP-VERIFIED');
        $this->payment($verified, $guest, $method, 'approved', 5000, 'VERIFIED-REF');
        $this->reservation($guest, $date->copy()->addDay(), 'CP-NO-PAYMENT');

        $this->actingAs($admin)
            ->getJson('/api/admin/reports/payments?date_range=all&per_page=1')
            ->assertOk()
            ->assertJsonPath('total', 2)
            ->assertJsonCount(1, 'data');

        $this->getJson('/api/admin/reports/payments?date_range=all&payment_status=verified')
            ->assertOk()
            ->assertJsonPath('total', 1)
            ->assertJsonPath('data.0.id', $verified);

        $this->getJson('/api/admin/reports/payments/print?date_range=all')
            ->assertOk()
            ->assertJsonPath('total', 2)
            ->assertJsonCount(2, 'data');

        $response = $this->get('/api/admin/reports/payments/export?date_range=all');
        $response->assertOk()->assertHeader('Content-Type', 'text/csv; charset=UTF-8');
        $csv = $response->streamedContent();
        $headers = str_getcsv(strtok($csv, "\n"));
        $this->assertStringContainsString('payment-report-', $response->headers->get('Content-Disposition'));
        $this->assertNotContains('Guest', $headers);
        $this->assertContains('Total Guests', $headers);
        $this->assertStringContainsString('CP-VERIFIED', $csv);
        $this->assertStringContainsString('CP-NO-PAYMENT', $csv);
    }

    public function test_dashboard_is_payment_level_and_verified_kpi_excludes_submitted_and_rejected_amounts(): void
    {
        $admin = $this->account('admin');
        $guest = $this->account('guest');
        $reservation = $this->reservation($guest, now('Asia/Manila')->startOfMonth()->addDays(5), 'CP-DASH-PAY');
        $method = $this->method('Dashboard Bank');
        $this->payment($reservation, $guest, $method, 'submitted', 1500, 'DASH-SUBMITTED');
        $this->payment($reservation, $guest, $method, 'approved', 2000, 'DASH-APPROVED');
        $this->payment($reservation, $guest, $method, 'rejected', 9000, 'DASH-REJECTED');

        $this->actingAs($admin)->getJson('/api/admin/reports/payments?dashboard=1&date_range=all')
            ->assertOk()->assertJsonPath('total', 3)
            ->assertJsonPath('kpis.verified_payments', '2000.00')
            ->assertJsonPath('analytics.cards.0.value', 2000)
            ->assertJsonPath('analytics.cards.1.value', 1500)
            ->assertJsonPath('analytics.cards.2.value', 1)
            ->assertJsonPath('analytics.cards.3.value', 1)
            ->assertJsonMissingPath('data.0.guest_name')
            ->assertJsonFragment(['payment_reference' => 'DASH-APPROVED', 'review_status' => 'verified'])
            ->assertJsonFragment(['payment_reference' => 'DASH-SUBMITTED', 'review_status' => 'awaiting_review']);

        $this->getJson('/api/admin/reports/payments?dashboard=1&date_range=all&payment_status=verified')
            ->assertOk()->assertJsonPath('total', 1)
            ->assertJsonPath('data.0.payment_reference', 'DASH-APPROVED');
        $this->getJson('/api/admin/reports/payments/print?dashboard=1&date_range=all&payment_status=verified')
            ->assertOk()->assertJsonPath('total', 1)
            ->assertJsonPath('data.0.payment_reference', 'DASH-APPROVED');
        $csv = $this->get('/api/admin/reports/payments/export?dashboard=1&date_range=all&payment_status=verified')
            ->assertOk()->streamedContent();
        $this->assertStringContainsString('DASH-APPROVED', $csv);
        $this->assertStringNotContainsString('DASH-SUBMITTED', $csv);
        $this->assertStringNotContainsString('DASH-REJECTED', $csv);
    }

    private function account(string $role): User
    {
        return User::factory()->create([
            'role_id' => Role::where('name', $role)->sole()->id,
        ])->fresh();
    }

    private function reservation(User $guest, $date, string $reference): int
    {
        $start = $date->copy()->setTime(14, 0);
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
            'children' => 1,
            'pets' => 0,
            'inquiry_source' => 'Website',
            'status' => 'confirmed',
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

    private function method(string $name): int
    {
        return (int) DB::table('payment_methods')->insertGetId([
            'name' => $name,
            'account_name' => 'Carlos Paradise',
            'account_number' => 'TEST-'.Str::random(8),
            'is_active' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function payment(int $reservation, User $guest, int $method, string $status, int $amount, string $reference): void
    {
        DB::table('payments')->insert([
            'reservation_id' => $reservation,
            'payment_method_id' => $method,
            'payment_kind' => 'deposit',
            'amount' => $amount,
            'currency' => 'PHP',
            'reference_number' => $reference,
            'receipt_storage_path' => 'isolated-payment-report.png',
            'payment_date' => now('Asia/Manila')->toDateString(),
            'submitted_at' => now(),
            'status' => $status,
            'submitted_by' => $guest->id,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
}
