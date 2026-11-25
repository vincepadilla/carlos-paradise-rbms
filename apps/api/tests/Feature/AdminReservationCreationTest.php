<?php

namespace Tests\Feature;

use App\Models\Role;
use App\Models\User;
use Carbon\CarbonImmutable;
use Database\Seeders\ReservationSetupSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class AdminReservationCreationTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(ReservationSetupSeeder::class);
    }

    public function test_creation_endpoints_require_admin_or_owner(): void
    {
        $this->getJson('/api/admin/reservation-create/options')->assertUnauthorized();
        $this->actingAs($this->user('guest'))->getJson('/api/admin/reservation-create/options')->assertForbidden();
        $this->actingAs($this->user('owner'))->getJson('/api/admin/reservation-create/options')
            ->assertOk()->assertJsonPath('timezone', 'Asia/Manila')->assertJsonMissing(['Other']);
    }

    public function test_guest_search_only_returns_active_guest_accounts(): void
    {
        $match = $this->user('guest', ['name' => 'Searchable Guest', 'email' => 'searchable@example.test', 'phone' => '09171234567']);
        $this->user('guest', ['name' => 'Searchable Inactive', 'email' => 'inactive@example.test', 'is_active' => false]);
        $this->user('admin', ['name' => 'Searchable Staff', 'email' => 'staff@example.test']);

        $this->actingAs($this->user('admin'))
            ->getJson('/api/admin/reservation-create/guests?search=Searchable')
            ->assertOk()->assertJsonCount(1, 'guests')->assertJsonPath('guests.0.id', $match->id);
    }

    public function test_staff_can_preview_and_create_for_existing_guest_without_changing_profile(): void
    {
        $guest = $this->user('guest', ['name' => 'Profile Name', 'email' => 'profile@example.test', 'phone' => '09170000000']);
        $admin = $this->user('admin');
        $payload = $this->payload(['guest_id' => $guest->id]);

        $preview = $this->actingAs($admin)->postJson('/api/admin/reservation-create/preview', $payload)
            ->assertOk()->assertJsonPath('availability', 'available')->assertJsonPath('creator.id', $admin->id);
        $total = $preview->json('quote.total');
        $response = $this->postJson('/api/admin/reservations', [
            ...$payload, 'request_key' => '11111111-1111-4111-8111-111111111111', 'expected_total' => $total,
        ])->assertCreated()->assertJsonPath('reservation.status', 'awaiting_deposit');

        $id = $response->json('reservation.id');
        $this->assertDatabaseHas('reservations', [
            'id' => $id, 'user_id' => $guest->id, 'created_by' => $admin->id,
            'contact_name' => 'Reservation Snapshot', 'contact_email' => 'snapshot@example.test',
            'status' => 'awaiting_deposit', 'liquor_qty' => 2,
        ]);
        $this->assertDatabaseHas('reservation_status_history', [
            'reservation_id' => $id, 'changed_by' => $admin->id, 'event' => 'staff_created_reservation',
        ]);
        $this->assertDatabaseHas('reservation_opportunities', ['reservation_id' => $id, 'status' => 'active', 'granted_by' => $admin->id]);
        $this->assertDatabaseHas('users', ['id' => $guest->id, 'name' => 'Profile Name', 'email' => 'profile@example.test', 'phone' => '09170000000']);

        $this->postJson('/api/admin/reservations', [
            ...$payload, 'request_key' => '11111111-1111-4111-8111-111111111111', 'expected_total' => $total,
        ])->assertCreated()->assertJsonPath('reservation.id', $id);
        $this->assertDatabaseCount('reservations', 1);
    }

    public function test_new_guest_creation_uses_null_password_and_rejects_duplicate_email(): void
    {
        $admin = $this->user('admin');
        $payload = $this->payload(['guest_mode' => 'new', 'guest_id' => null]);
        $preview = $this->actingAs($admin)->postJson('/api/admin/reservation-create/preview', $payload)->assertOk();

        $this->postJson('/api/admin/reservations', [
            ...$payload, 'request_key' => '22222222-2222-4222-8222-222222222222', 'expected_total' => $preview->json('quote.total'),
        ])->assertCreated();
        $created = User::where('email', 'snapshot@example.test')->sole();
        $this->assertNull($created->password);
        $this->assertSame('guest', $created->role->name);
        $event = DB::table('audit_events')->where('action', 'guest_created')->sole();
        $this->assertSame($admin->id, $event->user_id);
        $this->assertSame($created->id, json_decode($event->context, true)['guest_id']);
        $this->assertSame('verified', app(\App\Services\AuditChain::class)->verify()['status']);

        $duplicate = $this->payload(['guest_mode' => 'new', 'guest_id' => null, 'contact_email' => 'SNAPSHOT@example.test']);
        $this->postJson('/api/admin/reservation-create/preview', $duplicate)
            ->assertUnprocessable()->assertJsonValidationErrors('contact_email');
    }

    private function payload(array $changes = []): array
    {
        $checkin = CarbonImmutable::now('Asia/Manila')->addDays(10);
        return [
            'guest_mode' => 'existing', 'guest_id' => null,
            'contact_name' => 'Reservation Snapshot', 'contact_email' => 'snapshot@example.test', 'contact_phone' => '09171234567',
            'inquiry_source' => 'Referral', 'type' => 'overnight', 'checkin' => $checkin->toDateString(),
            'checkout' => $checkin->addDay()->toDateString(), 'checkin_time' => '14:00', 'checkout_time' => '11:00',
            'adults' => 2, 'children' => 0, 'pets' => 0, 'bonfire_qty' => 1, 'charcoal_qty' => 2, 'liquor_qty' => 2,
            'notes' => 'Staff-created test reservation.', ...$changes,
        ];
    }

    private function user(string $role, array $values = []): User
    {
        return User::factory()->create([
            'role_id' => Role::where('name', $role)->sole()->id,
            ...$values,
        ])->fresh();
    }
}
