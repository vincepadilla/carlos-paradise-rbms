<?php

namespace Tests\Feature;

use App\Models\Role;
use App\Models\User;
use Database\Seeders\ReservationSetupSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class AdminOcularVisitReportTest extends TestCase
{
    use RefreshDatabase;

    protected function beforeRefreshingDatabase(): void
    {
        if (config('database.default') !== 'sqlite' || config('database.connections.sqlite.database') !== ':memory:') {
            throw new \RuntimeException('Ocular visit report tests require isolated SQLite :memory:.');
        }
    }

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(ReservationSetupSeeder::class);
    }

    public function test_admin_and_owner_can_access_the_ocular_visit_report_namespaces(): void
    {
        $this->getJson('/api/admin/reports/ocular-visits')->assertUnauthorized();
        $this->actingAs($this->account('guest'))->getJson('/api/admin/reports/ocular-visits')->assertForbidden();
        $this->actingAs($this->account('admin'))->getJson('/api/admin/reports/ocular-visits')->assertOk();
        $this->actingAs($this->account('owner'))->getJson('/api/owner/operations/reports/ocular-visits')->assertOk();
    }

    public function test_ocular_report_filters_paginates_prints_and_exports_actual_visits(): void
    {
        $admin = $this->account('admin');
        $firstDate = now('Asia/Manila')->startOfMonth()->addDays(3);
        $ids = [];
        foreach (['pending_review', 'approved', 'cancelled'] as $index => $status) {
            $ids[] = DB::table('ocular_visits')->insertGetId([
                'villa_id' => 1,
                'guest_name' => $index === 1 ? '=Approved Visitor' : 'Visitor '.$index,
                'contact_details' => '0917000000'.$index,
                'visit_date' => $firstDate->copy()->addDays($index)->toDateString(),
                'start_time' => '09:00',
                'end_time' => '10:00',
                'status' => $status,
                'inquiry_source' => 'Phone Call',
                'notes' => null,
                'created_by' => $admin->id,
                'revision' => 1,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }

        $this->actingAs($admin)->getJson('/api/admin/reports/ocular-visits?date_range=all&per_page=1')
            ->assertOk()
            ->assertJsonPath('total', 3)
            ->assertJsonPath('last_page', 3)
            ->assertJsonCount(1, 'data')
            ->assertJsonCount(3, 'analytics.status')
            ->assertJsonFragment(['key' => 'approved', 'label' => 'Approved', 'value' => 1])
            ->assertJsonFragment(['assigned_staff' => $admin->name]);

        $reference = 'OV-'.str_pad((string) $ids[1], 6, '0', STR_PAD_LEFT);
        $this->getJson('/api/admin/reports/ocular-visits?date_range=all&search='.$reference)
            ->assertOk()->assertJsonPath('total', 1)->assertJsonPath('data.0.visit_reference', $reference);
        $this->getJson('/api/admin/reports/ocular-visits/print?date_range=all&status=approved')
            ->assertOk()->assertJsonPath('total', 1)->assertJsonPath('data.0.status', 'approved');

        $csv = $this->get('/api/admin/reports/ocular-visits/export?date_range=all&status=approved')
            ->assertOk()->assertHeader('Content-Type', 'text/csv; charset=UTF-8')->streamedContent();
        $this->assertStringContainsString($reference, $csv);
        $this->assertStringContainsString("'=Approved Visitor", str_replace('"', '', $csv));
        $this->assertStringNotContainsString('Visitor 0', $csv);
    }

    public function test_reservation_analytics_expose_all_statuses_and_separate_availability_measures(): void
    {
        $admin = $this->account('admin');
        $start = now('Asia/Manila')->addDays(10)->startOfDay();
        DB::table('availability_blocks')->insert([
            'villa_id' => 1,
            'starts_on' => $start->toDateString(),
            'ends_on' => $start->copy()->addDay()->toDateString(),
            'reason' => 'Maintenance',
            'created_by' => $admin->id,
            'released_at' => null,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->actingAs($admin)->getJson('/api/admin/reports/reservations?dashboard=1&date_range=custom&start_date='.
            $start->toDateString().'&end_date='.$start->copy()->addDay()->toDateString())
            ->assertOk()
            ->assertJsonCount(10, 'analytics.status')
            ->assertJsonFragment(['key' => 'expired', 'label' => 'Expired', 'value' => 0])
            ->assertJsonPath('analytics.availability.0.key', 'available_nights')
            ->assertJsonPath('analytics.availability.0.value', 1)
            ->assertJsonPath('analytics.availability.0.unit', 'nights')
            ->assertJsonPath('analytics.availability.1.key', 'completed_reservations')
            ->assertJsonPath('analytics.availability.1.value', 0)
            ->assertJsonPath('analytics.availability.1.unit', 'reservations');
    }

    private function account(string $role): User
    {
        return User::factory()->create([
            'role_id' => Role::where('name', $role)->sole()->id,
        ])->fresh();
    }
}
