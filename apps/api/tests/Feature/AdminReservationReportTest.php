<?php

namespace Tests\Feature;

use App\Models\Role;
use App\Models\User;
use Database\Seeders\ReservationSetupSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

class AdminReservationReportTest extends TestCase
{
    use RefreshDatabase;

    protected function beforeRefreshingDatabase(): void
    {
        if (config('database.default') !== 'sqlite' || config('database.connections.sqlite.database') !== ':memory:') {
            throw new \RuntimeException('Reservation report tests require isolated SQLite :memory:.');
        }
    }

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(ReservationSetupSeeder::class);
    }

    public function test_only_an_active_admin_can_access_reservation_reports(): void
    {
        $this->getJson('/api/admin/reports/reservations')->assertUnauthorized();

        foreach (['guest', 'owner'] as $role) {
            $this->actingAs($this->account($role))
                ->getJson('/api/admin/reports/reservations')
                ->assertForbidden();
        }

        $admin = $this->account('admin');
        $admin->forceFill(['is_active' => false])->save();
        $this->actingAs($admin)
            ->getJson('/api/admin/reports/reservations')
            ->assertForbidden();
    }

    public function test_report_filters_by_check_in_date_status_search_and_paginates(): void
    {
        $admin = $this->account('admin');
        $guest = $this->account('guest');
        $thisMonth = now('Asia/Manila')->startOfMonth()->addDays(5);
        $lastMonth = now('Asia/Manila')->subMonthNoOverflow()->startOfMonth()->addDays(5);

        $current = $this->reservation($guest, $thisMonth, [
            'booking_reference' => 'CP-CURRENT-101',
            'contact_name' => 'Current Guest',
            'status' => 'confirmed',
        ]);
        $this->reservation($guest, $lastMonth, [
            'booking_reference' => 'CP-OLDER-202',
            'contact_name' => 'Older Guest',
            'status' => 'cancelled',
        ]);

        $this->actingAs($admin)
            ->getJson('/api/admin/reports/reservations')
            ->assertOk()
            ->assertJsonPath('total', 1)
            ->assertJsonPath('data.0.id', $current)
            ->assertJsonPath('filters.applied.date_range', 'this_month');

        $this->getJson('/api/admin/reports/reservations?date_range=last_month&status=cancelled')
            ->assertOk()
            ->assertJsonPath('total', 1)
            ->assertJsonPath('data.0.booking_reference', 'CP-OLDER-202');

        $this->getJson('/api/admin/reports/reservations?date_range=all&search=Current%20Guest&per_page=1')
            ->assertOk()
            ->assertJsonPath('total', 1)
            ->assertJsonPath('per_page', 1);

        $this->getJson('/api/admin/reports/reservations?date_range=all&search='.$current)
            ->assertOk()
            ->assertJsonPath('total', 1)
            ->assertJsonPath('data.0.id', $current);

        $this->getJson('/api/admin/reports/reservations?date_range=custom&start_date='.$thisMonth->toDateString().'&end_date='.$thisMonth->toDateString())
            ->assertOk()
            ->assertJsonPath('total', 1);

        $this->getJson('/api/admin/reports/reservations?date_range=custom&start_date=2026-02-10&end_date=2026-02-01')
            ->assertUnprocessable();
    }

    public function test_report_keeps_payment_states_distinct_uses_saved_pricing_and_does_not_duplicate_rows(): void
    {
        $admin = $this->account('admin');
        $guest = $this->account('guest');
        $id = $this->reservation($guest, now('Asia/Manila')->startOfMonth()->addDays(8), [
            'pricing_snapshot' => json_encode([
                'base' => '16000.00',
                'total' => '14500.00',
                'discount' => ['type' => 'fixed', 'value' => '1500.00', 'amount' => '1500.00', 'justification' => 'Saved promotion'],
            ], JSON_THROW_ON_ERROR),
            'quoted_total' => 14500,
            'required_deposit' => 5000,
        ]);

        $this->payment($id, $guest, 'submitted', 2000);
        $this->payment($id, $guest, 'approved', 3000);
        $this->payment($id, $guest, 'rejected', 9000);

        $this->actingAs($admin)
            ->getJson('/api/admin/reports/reservations?date_range=all')
            ->assertOk()
            ->assertJsonPath('total', 1)
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.payment.state', 'partially_verified')
            ->assertJsonPath('data.0.payment.submitted_amount', '2000.00')
            ->assertJsonPath('data.0.payment.verified_amount', '3000.00')
            ->assertJsonPath('data.0.payment.required_amount', '5000.00')
            ->assertJsonPath('data.0.pricing.base_amount', '16000.00')
            ->assertJsonPath('data.0.pricing.discount_amount', '1500.00')
            ->assertJsonPath('data.0.pricing.final_amount', '14500.00')
            ->assertJsonPath('data.0.pricing.discount_confirmed_none', false);
    }

    public function test_print_and_export_include_all_filtered_rows_and_csv_is_formula_safe(): void
    {
        $admin = $this->account('admin');
        $guest = $this->account('guest');
        $date = now('Asia/Manila')->startOfMonth()->addDays(3);

        foreach (range(1, 18) as $number) {
            $this->reservation($guest, $date->copy()->addHours($number), [
                'booking_reference' => 'CP-EXPORT-'.$number,
                'contact_name' => $number === 1 ? '=HYPERLINK("https://invalid.test")' : 'Export Guest '.$number,
            ]);
        }

        $this->actingAs($admin)
            ->getJson('/api/admin/reports/reservations')
            ->assertOk()
            ->assertJsonPath('total', 18)
            ->assertJsonCount(5, 'data');

        $this->getJson('/api/admin/reports/reservations?per_page=6')->assertUnprocessable();

        $this->getJson('/api/admin/reports/reservations/print')
            ->assertOk()
            ->assertJsonPath('total', 18)
            ->assertJsonCount(18, 'data');

        $response = $this->get('/api/admin/reports/reservations/export');
        $response->assertOk()
            ->assertHeader('Content-Type', 'text/csv; charset=UTF-8');
        $csv = $response->streamedContent();
        $this->assertStringContainsString('reservation-report-', $response->headers->get('Content-Disposition'));
        $this->assertStringContainsString("'=HYPERLINK", str_replace('"', '', $csv));
        $this->assertSame(18, substr_count(trim($csv), "\n"));
    }

    public function test_guest_report_keeps_repeat_guest_reservations_and_uses_guest_print_and_export(): void
    {
        $admin = $this->account('admin');
        $guest = $this->account('guest');
        $date = now('Asia/Manila')->startOfMonth()->addDays(6);
        $first = $this->reservation($guest, $date, [
            'booking_reference' => 'CP-REPEAT-1',
            'contact_name' => 'Repeat Guest',
            'status' => 'confirmed',
        ]);
        $second = $this->reservation($guest, $date->copy()->addDays(2), [
            'booking_reference' => 'CP-REPEAT-2',
            'contact_name' => 'Repeat Guest',
            'status' => 'completed',
        ]);

        $this->actingAs($admin)
            ->getJson('/api/admin/reports/guests?date_range=all&search=Repeat%20Guest&per_page=1')
            ->assertOk()
            ->assertJsonPath('total', 2)
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $second);

        $this->getJson('/api/admin/reports/guests?date_range=all&status=confirmed')
            ->assertOk()
            ->assertJsonPath('total', 1)
            ->assertJsonPath('data.0.id', $first);

        $this->getJson('/api/admin/reports/guests/print?date_range=all&search=Repeat%20Guest')
            ->assertOk()
            ->assertJsonPath('total', 2)
            ->assertJsonCount(2, 'data');

        $response = $this->get('/api/admin/reports/guests/export?date_range=all&search=Repeat%20Guest');
        $response->assertOk()->assertHeader('Content-Type', 'text/csv; charset=UTF-8');
        $csv = $response->streamedContent();
        $this->assertStringContainsString('guest-report-', $response->headers->get('Content-Disposition'));
        $this->assertStringContainsString('CP-REPEAT-1', $csv);
        $this->assertStringContainsString('CP-REPEAT-2', $csv);
        $this->assertStringNotContainsString('Payment State', $csv);
    }

    public function test_dashboard_analytics_group_guests_and_expose_queue_without_duplicate_rows(): void
    {
        $admin = $this->account('admin');
        $guest = $this->account('guest');
        $period = now('Asia/Manila')->startOfMonth()->addDays(6);
        $this->reservation($guest, $period->copy()->subMonth(), ['booking_reference' => 'CP-PRIOR']);
        $first = $this->reservation($guest, $period, ['booking_reference' => 'CP-DASH-1', 'status' => 'confirmed']);
        $moved = $this->reservation($guest, $period->copy()->addDay(), ['booking_reference' => 'CP-DASH-2', 'status' => 'completed']);

        $this->actingAs($admin)->getJson('/api/admin/reports/guests?dashboard=1&date_range=custom&start_date='.$period->toDateString().'&end_date='.$period->copy()->addDay()->toDateString())
            ->assertOk()->assertJsonPath('total', 1)
            ->assertJsonPath('data.0.reservation_count', 2)
            ->assertJsonPath('data.0.history_reservation_count', 3)
            ->assertJsonPath('analytics.classification.1.key', 'returning')
            ->assertJsonPath('analytics.classification.1.value', 1)
            ->assertJsonPath('analytics.frequency.1.value', 1)
            ->assertJsonPath('analytics.cards.0.value', 1)
            ->assertJsonPath('analytics.cards.1.value', 0)
            ->assertJsonPath('analytics.cards.2.value', 1)
            ->assertJsonPath('analytics.cards.3.value', 1)
            ->assertJsonPath('kpis.total_reservations', 2);
        $this->getJson('/api/admin/reports/guests?dashboard=1&date_range=custom&start_date='.$period->toDateString().'&end_date='.$period->copy()->addDay()->toDateString().'&frequency=2%2B')
            ->assertOk()->assertJsonPath('total', 1);
        $this->getJson('/api/admin/reports/guests/print?dashboard=1&date_range=custom&start_date='.$period->toDateString().'&end_date='.$period->copy()->addDay()->toDateString())
            ->assertOk()->assertJsonPath('total', 1)->assertJsonPath('data.0.reservation_count', 2);

        DB::table('reservations')->where('id', $first)->update(['status' => 'queued']);
        DB::table('reservation_status_history')->insert([
            'reservation_id' => $first, 'from_status' => 'pending', 'to_status' => 'queued',
            'changed_at' => now('Asia/Manila'), 'created_at' => now(), 'updated_at' => now(),
        ]);
        DB::table('reservation_status_history')->insert([
            'reservation_id' => $moved, 'from_status' => 'queued', 'to_status' => 'completed',
            'changed_at' => now('Asia/Manila'), 'created_at' => now(), 'updated_at' => now(),
        ]);
        DB::table('reservation_opportunities')->insert([
            ['reservation_id' => $first, 'granted_at' => now(), 'deposit_deadline' => now()->addDay(), 'closed_at' => null, 'status' => 'active', 'created_at' => now(), 'updated_at' => now()],
            ['reservation_id' => $moved, 'granted_at' => now()->subDays(2), 'deposit_deadline' => now()->subDay(), 'closed_at' => now()->subDay(), 'status' => 'expired', 'created_at' => now(), 'updated_at' => now()],
        ]);
        $this->getJson('/api/admin/reports/queue?date_range=all')
            ->assertOk()->assertJsonPath('total', 2)
            ->assertJsonFragment(['id' => $first])
            ->assertJsonFragment(['id' => $moved])
            ->assertJsonPath('analytics.cards.0.value', 1)
            ->assertJsonPath('analytics.cards.1.value', 1)
            ->assertJsonPath('analytics.cards.2.value', 1)
            ->assertJsonPath('analytics.cards.3.value', 1)
            ->assertJsonFragment(['key' => 'queued', 'label' => 'Queued', 'value' => 1])
            ->assertJsonFragment(['key' => 'completed', 'label' => 'Completed', 'value' => 1]);
        $this->getJson('/api/admin/reports/queue?date_range=all&category=expired_opportunities')
            ->assertOk()->assertJsonPath('total', 1)->assertJsonPath('data.0.id', $moved);
        $this->getJson('/api/admin/reports/queue/print?date_range=all')
            ->assertOk()->assertJsonPath('total', 2);
        $queueCsv = $this->get('/api/admin/reports/queue/export?date_range=all')
            ->assertOk()->streamedContent();
        $this->assertStringContainsString('CP-DASH-1', $queueCsv);
    }

    private function account(string $role): User
    {
        return User::factory()->create([
            'role_id' => Role::where('name', $role)->sole()->id,
        ])->fresh();
    }

    private function reservation(User $guest, $date, array $overrides = []): int
    {
        $start = $date->copy()->setTime(14, 0);
        $end = $start->copy()->addDay()->setTime(11, 0);

        return (int) DB::table('reservations')->insertGetId(array_merge([
            'booking_reference' => 'CP-'.Str::upper(Str::random(10)),
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
            'pricing_snapshot' => json_encode([
                'base' => '16000.00',
                'total' => '16000.00',
                'discount' => ['type' => 'none', 'value' => '0.00', 'amount' => '0.00', 'justification' => null],
            ], JSON_THROW_ON_ERROR),
            'policy_snapshot' => '{}',
            'requested_at' => now('Asia/Manila'),
            'created_at' => now(),
            'updated_at' => now(),
        ], $overrides));
    }

    private function payment(int $reservation, User $guest, string $status, int $amount): void
    {
        $method = DB::table('payment_methods')->value('id');
        if (! $method) {
            $method = DB::table('payment_methods')->insertGetId([
                'name' => 'Test Bank',
                'account_name' => 'Carlos Paradise',
                'account_number' => 'TEST-ONLY',
                'is_active' => true,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }

        DB::table('payments')->insert([
            'reservation_id' => $reservation,
            'payment_method_id' => $method,
            'payment_kind' => 'deposit',
            'amount' => $amount,
            'currency' => 'PHP',
            'reference_number' => 'REPORT-'.Str::uuid(),
            'receipt_storage_path' => 'isolated-test-proof.png',
            'payment_date' => now('Asia/Manila')->toDateString(),
            'submitted_at' => now(),
            'status' => $status,
            'submitted_by' => $guest->id,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
}
