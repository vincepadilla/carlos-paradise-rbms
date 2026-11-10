<?php

namespace Tests\Feature;

use App\Models\Role;
use App\Models\User;
use App\Services\AdminNotificationService;
use Database\Seeders\ReservationSetupSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class AdminNotificationsTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(ReservationSetupSeeder::class);
    }

    public function test_notification_access_is_limited_to_active_admins_and_owners(): void
    {
        $guest = $this->userWithRole('guest');
        $admin = $this->userWithRole('admin');
        $owner = $this->userWithRole('owner');
        app(AdminNotificationService::class)->create(
            'test:access', 'reservation_request', 'New reservation request',
            'CP-111026-001 was submitted.', null, '/admin/reservations/1',
        );

        $this->actingAs($guest)->getJson('/api/admin/notifications')->assertForbidden();
        $this->actingAs($admin)->getJson('/api/admin/notifications')
            ->assertOk()->assertJsonPath('total', 1)->assertJsonPath('data.0.title', 'New reservation request');
        $this->actingAs($owner)->getJson('/api/admin/notifications/unread-count')
            ->assertOk()->assertJsonPath('unread_count', 1);

        $owner->forceFill(['is_active' => false])->save();
        $this->actingAs($owner)->getJson('/api/admin/notifications')->assertForbidden();
    }

    public function test_read_status_is_owned_by_each_recipient_and_duplicate_events_are_ignored(): void
    {
        $admin = $this->userWithRole('admin');
        $owner = $this->userWithRole('owner');
        $service = app(AdminNotificationService::class);
        $service->create('test:dedupe', 'payment_proof', 'Payment proof submitted', 'Ready for review.', null, '/admin/payment-review');
        $service->create('test:dedupe', 'payment_proof', 'Duplicate title', 'Duplicate description.', null, '/admin/payment-review');

        $this->assertDatabaseCount('admin_notifications', 1);
        $this->assertDatabaseCount('admin_notification_recipients', 2);
        $id = DB::table('admin_notifications')->value('id');

        $this->actingAs($admin)->postJson('/api/admin/notifications/'.$id.'/read')
            ->assertOk()->assertJsonPath('read_at', fn ($value) => is_string($value));
        $this->getJson('/api/admin/notifications/unread-count')->assertJsonPath('unread_count', 0);
        $this->actingAs($owner)->getJson('/api/admin/notifications/unread-count')->assertJsonPath('unread_count', 1);
        $this->postJson('/api/admin/notifications/'.$id.'/read')->assertOk();
        $this->postJson('/api/admin/notifications/999999/read')->assertNotFound();
    }

    public function test_notifications_are_newest_first_and_paginated(): void
    {
        $admin = $this->userWithRole('admin');
        $service = app(AdminNotificationService::class);
        $service->create('test:older', 'queue_waiting', 'Older', 'Older event.', null, '/admin/queue', '2026-11-09T08:00:00+08:00');
        $service->create('test:newer', 'deposit_deadline', 'Newer', 'Newer event.', null, '/admin/reservations/2', '2026-11-10T08:00:00+08:00');

        $this->actingAs($admin)->getJson('/api/admin/notifications?per_page=1')
            ->assertOk()->assertJsonPath('total', 2)->assertJsonPath('last_page', 2)
            ->assertJsonPath('data.0.title', 'Newer')
            ->assertJsonPath('data.0.occurred_at', fn ($value) => str_ends_with($value, '+08:00'));
    }

    private function userWithRole(string $role): User
    {
        return User::factory()->create(['role_id' => Role::query()->where('name', $role)->sole()->id])->fresh();
    }
}
