<?php

namespace Tests\Feature;

use App\Models\Role;
use App\Models\User;
use Database\Seeders\ReservationSetupSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class AdminIntegrationTest extends TestCase
{
    use RefreshDatabase;

    protected function beforeRefreshingDatabase(): void
    {
        // Fail before migrations if local configuration ever points at real data.
        if (config('database.default') !== 'sqlite' || config('database.connections.sqlite.database') !== ':memory:') {
            throw new \RuntimeException('Admin integration tests require an isolated SQLite :memory: database.');
        }
    }

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(ReservationSetupSeeder::class);
    }

    public function test_admin_read_endpoints_require_an_authenticated_session(): void
    {
        foreach ($this->adminPaths() as $path) {
            $this->getJson($path)->assertUnauthorized();
        }
    }

    public function test_guest_cannot_use_admin_endpoints_or_supply_an_admin_role(): void
    {
        $this->actingAs($this->userWithRole('guest'));

        foreach ($this->adminPaths() as $path) {
            $this->getJson($path.'?role=admin')->assertForbidden();
        }
    }

    public function test_owner_is_not_implicitly_granted_new_admin_permissions(): void
    {
        $this->actingAs($this->userWithRole('owner'));

        foreach ($this->adminPaths() as $path) {
            $this->getJson($path)->assertForbidden();
        }
    }

    public function test_inactive_admin_cannot_read_admin_information(): void
    {
        $admin = $this->userWithRole('admin');
        $admin->forceFill(['is_active' => false])->save();
        $this->actingAs($admin)->getJson('/api/admin/guests')->assertForbidden();
    }

    public function test_admin_can_read_guest_accounts_without_private_authentication_fields(): void
    {
        $guest = $this->userWithRole('guest');
        $admin = $this->userWithRole('admin');
        $owner = $this->userWithRole('owner');

        $this->actingAs($admin)->getJson('/api/admin/guests')
            ->assertOk()
            ->assertHeader('Cache-Control', 'no-store, private')
            ->assertJsonPath('total', 1)
            ->assertJsonPath('data.0.id', $guest->id)
            ->assertJsonMissingPath('data.0.password')
            ->assertJsonMissingPath('data.0.remember_token')
            ->assertJsonMissingPath('data.0.google_id');

        $this->getJson('/api/admin/guests/'.$guest->id)
            ->assertOk()->assertJsonPath('guest.id', $guest->id)->assertJsonPath('reservation', null);
        $this->getJson('/api/admin/guests/'.$admin->id)->assertNotFound();
        $this->getJson('/api/admin/guests/'.$owner->id)->assertNotFound();
        $this->getJson('/api/admin/guests/999999')->assertNotFound();
        $this->getJson('/api/admin/guests/not-a-number')->assertNotFound();
        $this->getJson('/api/admin/guests?page=-1')->assertUnprocessable();
    }

    public function test_admin_guests_are_paginated(): void
    {
        User::factory()->count(26)->create();

        $this->actingAs($this->userWithRole('admin'))
            ->getJson('/api/admin/guests?page=2')
            ->assertOk()
            ->assertJsonPath('current_page', 2)
            ->assertJsonPath('total', 26)
            ->assertJsonCount(1, 'data');
    }

    public function test_admin_can_search_guest_profiles_and_reservation_contacts_and_references(): void
    {
        $profileMatch = $this->userWithRole('guest');
        $profileMatch->forceFill([
            'name' => 'Searchable Profile',
            'email' => 'profile-match@example.test',
            'phone' => '09171112222',
        ])->save();
        $reservationMatch = $this->userWithRole('guest');
        $reservationId = $this->createReservation($reservationMatch, 10);
        DB::table('reservations')->where('id', $reservationId)->update([
            'booking_reference' => 'BOOKING-FIND-ME',
            'contact_name' => 'Archived Contact',
            'contact_email' => 'archived@example.test',
            'contact_phone' => '09998887777',
        ]);
        $withoutReservation = $this->userWithRole('guest');
        $admin = $this->userWithRole('admin');

        $this->actingAs($admin)->getJson('/api/admin/guests?search=searchable')
            ->assertOk()->assertJsonPath('total', 1)->assertJsonPath('data.0.id', $profileMatch->id);
        $this->getJson('/api/admin/guests?search=09998887777')
            ->assertOk()->assertJsonPath('total', 1)->assertJsonPath('data.0.id', $reservationMatch->id);
        $this->getJson('/api/admin/guests?search=archived%40example.test')
            ->assertOk()->assertJsonPath('total', 1)->assertJsonPath('data.0.id', $reservationMatch->id);
        $this->getJson('/api/admin/guests?search=find-me')
            ->assertOk()->assertJsonPath('total', 1)
            ->assertJsonPath('data.0.latest_booking_reference', 'BOOKING-FIND-ME');
        $this->getJson('/api/admin/guests/'.$reservationMatch->id)
            ->assertOk()
            ->assertJsonPath('reservation.booking_reference', 'BOOKING-FIND-ME')
            ->assertJsonPath('reservation.status', 'confirmed');
        $this->getJson('/api/admin/guests')
            ->assertOk()->assertJsonFragment(['id' => $withoutReservation->id, 'latest_booking_reference' => null]);
    }

    public function test_guest_details_returns_ordered_reservation_history_with_verified_payment_totals(): void
    {
        $guest = $this->userWithRole('guest');
        $older = $this->createReservation($guest, 10);
        DB::table('reservations')->where('id', $older)->update(['booking_reference' => 'HISTORY-OLDER']);
        $current = $this->createReservation($guest, 20);
        DB::table('reservations')->where('id', $current)->update(['booking_reference' => 'HISTORY-CURRENT']);
        DB::table('payments')->insert([
            'reservation_id' => $current,
            'opportunity_id' => null,
            'payment_method_id' => DB::table('payment_methods')->value('id'),
            'payment_kind' => 'deposit',
            'amount' => 5000,
            'currency' => 'PHP',
            'reference_number' => 'HISTORY-PAYMENT',
            'receipt_storage_path' => 'test/history-payment.jpg',
            'payment_date' => now()->toDateString(),
            'submitted_at' => now(),
            'status' => 'approved',
            'submitted_by' => $guest->id,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->actingAs($this->userWithRole('admin'))
            ->getJson('/api/admin/guests/'.$guest->id)
            ->assertOk()
            ->assertJsonCount(2, 'reservations')
            ->assertJsonPath('reservation.booking_reference', 'HISTORY-CURRENT')
            ->assertJsonPath('reservation.payment_status', 'Verified')
            ->assertJsonPath('reservation.payment_amount', '5000.00')
            ->assertJsonPath('reservations.1.booking_reference', 'HISTORY-OLDER')
            ->assertJsonCount(1, 'payments')
            ->assertJsonPath('payments.0.booking_reference', 'HISTORY-CURRENT')
            ->assertJsonPath('payments.0.reference', 'HISTORY-PAYMENT')
            ->assertJsonFragment(['event' => 'account_created', 'kind' => 'account']);
    }

    public function test_admin_can_update_a_guest_profile_and_email_uniqueness_excludes_that_guest(): void
    {
        $guest = $this->userWithRole('guest');
        $otherGuest = $this->userWithRole('guest');
        $admin = $this->userWithRole('admin');

        $payload = [
            'name' => 'Updated Guest',
            'email' => $guest->email,
            'phone' => '09171234567',
            'address' => '123 Updated Street, Laguna',
            'is_active' => false,
        ];

        $this->actingAs($admin)->patchJson('/api/admin/guests/'.$guest->id, $payload)
            ->assertOk()
            ->assertHeader('Cache-Control', 'no-store, private')
            ->assertJsonPath('guest.name', 'Updated Guest')
            ->assertJsonPath('guest.address', '123 Updated Street, Laguna')
            ->assertJsonPath('guest.is_active', false);

        $this->assertDatabaseHas('users', [
            'id' => $guest->id,
            'name' => 'Updated Guest',
            'phone' => '09171234567',
            'address' => '123 Updated Street, Laguna',
            'is_active' => false,
        ]);

        $this->patchJson('/api/admin/guests/'.$guest->id, [...$payload, 'email' => $otherGuest->email])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('email');
        $this->patchJson('/api/admin/guests/'.$guest->id, [...$payload, 'email' => 'changed@example.test'])
            ->assertOk()
            ->assertJsonPath('guest.email', 'changed@example.test');
    }

    public function test_only_active_admins_and_owners_can_update_guest_profiles(): void
    {
        $guest = $this->userWithRole('guest');
        $payload = [
            'name' => 'Staff Updated Guest',
            'email' => $guest->email,
            'phone' => null,
            'address' => null,
            'is_active' => true,
        ];

        $this->patchJson('/api/admin/guests/'.$guest->id, $payload)->assertUnauthorized();
        $this->actingAs($this->userWithRole('guest'))
            ->patchJson('/api/admin/guests/'.$guest->id, $payload)->assertForbidden();
        $this->actingAs($this->userWithRole('owner'))
            ->patchJson('/api/admin/guests/'.$guest->id, $payload)
            ->assertOk()
            ->assertJsonPath('guest.name', 'Staff Updated Guest');
    }

    public function test_admin_calendar_only_exposes_unreleased_blocks(): void
    {
        $admin = $this->userWithRole('admin');
        $block = [
            'villa_id' => 1,
            'starts_on' => '2027-01-10',
            'ends_on' => '2027-01-12',
            'reason' => 'Scheduled maintenance',
            'created_by' => $admin->id,
            'created_at' => now(),
            'updated_at' => now(),
        ];
        DB::table('availability_blocks')->insert($block);
        DB::table('availability_blocks')->insert([...$block, 'reason' => 'Released block', 'released_at' => now()]);

        $this->actingAs($admin)->getJson('/api/admin/availability-blocks')
            ->assertOk()->assertJsonPath('total', 1)
            ->assertJsonPath('data.0.reason', 'Scheduled maintenance');
    }

    public function test_existing_staff_reservation_visibility_and_guest_ownership_are_preserved(): void
    {
        $firstGuest = $this->userWithRole('guest');
        $secondGuest = $this->userWithRole('guest');
        $firstId = $this->createReservation($firstGuest, 10);
        $this->createReservation($secondGuest, 12);

        $this->actingAs($secondGuest)->getJson('/api/reservations')->assertOk()->assertJsonCount(1, 'reservations');
        $this->getJson('/api/reservations/'.$firstId)->assertForbidden();
        $this->actingAs($this->userWithRole('admin'))->getJson('/api/reservations')->assertOk()->assertJsonCount(2, 'reservations');
        $this->getJson('/api/reservations/'.$firstId)->assertOk()->assertJsonPath('reservation.id', $firstId);
        $this->actingAs($this->userWithRole('owner'))->getJson('/api/reservations')->assertOk()->assertJsonCount(2, 'reservations');
    }

    public function test_existing_staff_mutations_reject_guests(): void
    {
        $this->actingAs($this->userWithRole('guest'));
        $this->patchJson('/api/reservations/1/terms', ['total' => 10000])->assertForbidden();
        $this->postJson('/api/reservations/1/opportunity')->assertForbidden();
        $this->postJson('/api/reservations/1/extension/review', ['decision' => 'approved'])->assertForbidden();
        $this->postJson('/api/payments/1/review', ['decision' => 'approved', 'note' => 'Verified'])->assertForbidden();
    }

    public function test_admin_login_session_survives_revalidation_and_logout_invalidates_it(): void
    {
        $this->assertLoginSession('admin');
        $this->postJson('/auth/logout')->assertNoContent();
        Auth::forgetGuards();
        $this->getJson('/auth/user')->assertUnauthorized();
        $this->getJson('/api/admin/guests')->assertUnauthorized();
    }

    public function test_guest_login_keeps_the_existing_guest_session_contract(): void
    {
        $this->assertLoginSession('guest');
    }

    private function assertLoginSession(string $role): void
    {
        $user = $this->userWithRole($role);
        // Fake only the external provider in this isolated test, never application verification.
        Http::preventStrayRequests();
        Http::fake(['www.google.com/recaptcha/api/siteverify' => Http::response(['success' => true])]);

        $this->postJson('/auth/login', [
            'email' => $user->email,
            'password' => 'password',
            'remember' => false,
            'captcha_token' => 'isolated-test-provider-token',
        ])->assertOk()->assertJsonPath('user.role', $role)
            ->assertSessionHas(Auth::guard('web')->getName(), $user->id);

        Auth::forgetGuards();
        $this->getJson('/auth/user')->assertOk()->assertJsonPath('user.role', $role)->assertJsonPath('user.id', $user->id);
        Http::assertSentCount(1);
    }

    private function userWithRole(string $role): User
    {
        return User::factory()->create(['role_id' => Role::where('name', $role)->sole()->id])->fresh();
    }

    private function adminPaths(): array
    {
        return ['/api/admin/guests', '/api/admin/guests/1', '/api/admin/availability-blocks'];
    }

    private function createReservation(User $guest, int $days): int
    {
        $start = now('Asia/Manila')->addDays($days);
        $end = $start->copy()->addDay();

        // Read/authorization fixture; booking creation uses PostgreSQL-specific locks.
        return DB::table('reservations')->insertGetId([
            'booking_reference' => 'ADMIN-TEST-'.$guest->id,
            'user_id' => $guest->id,
            'villa_id' => 1,
            'type' => 'overnight',
            'check_in_date' => $start->toDateString(),
            'check_out_date' => $end->toDateString(),
            'starts_at' => $start->toIso8601String(),
            'ends_at' => $end->toIso8601String(),
            'adults' => 2,
            'contact_name' => $guest->name,
            'contact_email' => $guest->email,
            'contact_phone' => '09171234567',
            'inquiry_source' => 'Website',
            'status' => 'confirmed',
            'price_agreed' => true,
            'quoted_total' => 16000,
            'pricing_snapshot' => '{}',
            'policy_snapshot' => '{}',
            'requested_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
}
