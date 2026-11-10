<?php

namespace Tests\Feature;

use App\Jobs\SendOutgoingEmail;
use App\Mail\OutgoingGuestMail;
use App\Models\Role;
use App\Models\User;
use Database\Seeders\ReservationSetupSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class AdminOutgoingEmailsTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(ReservationSetupSeeder::class);
    }

    public function test_recipient_search_is_authorized_and_guest_safe(): void
    {
        $guest = $this->user('guest');
        $reservation = $this->reservation($guest, 'SAFE-SEARCH-001');
        $this->actingAs($guest)->getJson('/api/admin/email-recipients?q=safe')->assertForbidden();

        $this->actingAs($this->user('admin'))->getJson('/api/admin/email-recipients?q=safe')
            ->assertOk()->assertJsonPath('recipients.0.reservation_id', $reservation)
            ->assertJsonPath('recipients.0.reservation_reference', 'SAFE-SEARCH-001')
            ->assertJsonMissingPath('recipients.0.status')
            ->assertJsonMissingPath('recipients.0.queue_position')
            ->assertJsonMissingPath('recipients.0.special_requests');
    }

    public function test_immediate_email_is_persisted_and_marked_sent_only_after_mail_acceptance(): void
    {
        config(['mail.default' => 'smtp', 'queue.default' => 'sync']);
        Mail::fake();
        $guest = $this->user('guest');
        $reservation = $this->reservation($guest, 'SEND-001');
        $payload = $this->payload($reservation, '11111111-1111-4111-8111-111111111111');

        $this->actingAs($this->user('admin'))->postJson('/api/admin/outgoing-emails/send', $payload)
            ->assertCreated();

        Mail::assertSent(OutgoingGuestMail::class, fn (OutgoingGuestMail $mail) => $mail->hasTo($guest->email));
        $this->assertDatabaseHas('outgoing_emails', [
            'reservation_id' => $reservation, 'status' => 'sent', 'recipient_email' => $guest->email,
        ]);
        $this->assertNotNull(DB::table('outgoing_emails')->value('sent_at'));
    }

    public function test_unconfigured_transport_is_recorded_as_failed_and_never_reported_sent(): void
    {
        config(['mail.default' => 'log']);
        Mail::fake();
        $guest = $this->user('guest');
        $reservation = $this->reservation($guest, 'FAILED-001');

        $this->actingAs($this->user('admin'))->postJson('/api/admin/outgoing-emails/send',
            $this->payload($reservation, '22222222-2222-4222-8222-222222222222'))
            ->assertStatus(503)->assertJsonPath('email.status', 'failed');
        Mail::assertNothingSent();
        $this->assertDatabaseHas('outgoing_emails', ['reservation_id' => $reservation, 'status' => 'failed']);
    }

    public function test_scheduling_requires_a_future_time_and_is_idempotent(): void
    {
        Queue::fake();
        $guest = $this->user('guest');
        $reservation = $this->reservation($guest, 'SCHEDULE-001');
        $admin = $this->user('admin');
        $payload = $this->payload($reservation, '33333333-3333-4333-8333-333333333333');

        $this->actingAs($admin)->postJson('/api/admin/outgoing-emails/schedule', [
            ...$payload, 'scheduled_for' => now('Asia/Manila')->subMinute()->toIso8601String(),
        ])->assertUnprocessable();
        $future = now('Asia/Manila')->addDay()->toIso8601String();
        $this->postJson('/api/admin/outgoing-emails/schedule', [...$payload, 'scheduled_for' => $future])
            ->assertCreated()->assertJsonPath('email.status', 'scheduled');
        $this->postJson('/api/admin/outgoing-emails/schedule', [...$payload, 'scheduled_for' => $future])
            ->assertOk()->assertJsonPath('email.status', 'scheduled');

        $this->assertDatabaseCount('outgoing_emails', 1);
        Queue::assertPushed(SendOutgoingEmail::class, 1);
    }

    public function test_history_and_details_are_paginated_and_authorized(): void
    {
        config(['mail.default' => 'log']);
        $guest = $this->user('guest');
        $reservation = $this->reservation($guest, 'HISTORY-EMAIL-001');
        $admin = $this->user('admin');
        $this->actingAs($admin)->postJson('/api/admin/outgoing-emails/send',
            $this->payload($reservation, '44444444-4444-4444-8444-444444444444'))->assertStatus(503);
        $id = DB::table('outgoing_emails')->value('id');

        $this->getJson('/api/admin/outgoing-emails?per_page=1')->assertOk()
            ->assertJsonPath('total', 1)->assertJsonPath('data.0.reservation_reference', 'HISTORY-EMAIL-001')
            ->assertJsonMissingPath('data.0.message');
        $this->getJson('/api/admin/outgoing-emails/'.$id)->assertOk()
            ->assertJsonPath('email.message', 'Hello guest,'.PHP_EOL.PHP_EOL.'Your reservation is confirmed.')
            ->assertJsonPath('email.sender_name', $admin->name)
            ->assertJsonPath('email.attachments', []);
        $this->actingAs($guest)->getJson('/api/admin/outgoing-emails')->assertForbidden();
    }

    public function test_only_explicitly_selected_configured_documents_are_persisted(): void
    {
        Queue::fake();
        Storage::fake('local');
        Storage::disk('local')->put('guest-documents/waiver.pdf', 'waiver');
        $settings = json_decode(DB::table('villas')->where('id', 1)->value('settings'), true);
        $settings['email_documents'] = [[
            'key' => 'waiver', 'label' => 'Guest Waiver.pdf',
            'disk' => 'local', 'path' => 'guest-documents/waiver.pdf',
        ]];
        DB::table('villas')->where('id', 1)->update(['settings' => json_encode($settings)]);
        $guest = $this->user('guest');
        $reservation = $this->reservation($guest, 'ATTACHMENT-001');
        $admin = $this->user('admin');

        $this->actingAs($admin)->getJson('/api/admin/email-compose-options')
            ->assertOk()->assertJsonPath('documents.0.key', 'waiver')
            ->assertJsonMissingPath('documents.0.path');
        $payload = $this->payload($reservation, '55555555-5555-4555-8555-555555555555');
        $this->postJson('/api/admin/outgoing-emails/schedule', [
            ...$payload, 'attachments' => ['waiver'],
            'scheduled_for' => now('Asia/Manila')->addDay()->toIso8601String(),
        ])->assertCreated();
        $this->assertStringContainsString('Guest Waiver.pdf', DB::table('outgoing_emails')->value('attachments'));
    }

    // TESTS
    private function user(string $role): User
    {
        return User::factory()->create(['role_id' => Role::where('name', $role)->sole()->id])->fresh();
    }

    private function reservation(User $guest, string $reference): int
    {
        $start = now('Asia/Manila')->addDays(20);

        return DB::table('reservations')->insertGetId([
            'booking_reference' => $reference, 'user_id' => $guest->id, 'villa_id' => 1,
            'contact_name' => $guest->name, 'contact_email' => $guest->email,
            'contact_phone' => '09171234567', 'type' => 'overnight',
            'check_in_date' => $start->toDateString(), 'check_out_date' => $start->addDay()->toDateString(),
            'starts_at' => $start->toIso8601String(), 'ends_at' => $start->addDay()->toIso8601String(),
            'adults' => 2, 'inquiry_source' => 'Website', 'status' => 'confirmed',
            'price_agreed' => true, 'quoted_total' => 16000, 'required_deposit' => 5000,
            'pricing_snapshot' => '{}', 'policy_snapshot' => '{}', 'requested_at' => now(),
            'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    private function payload(int $reservation, string $key): array
    {
        return [
            'reservation_id' => $reservation, 'category' => 'reservation_update',
            'subject' => 'Your reservation update',
            'message' => 'Hello guest,'.PHP_EOL.PHP_EOL.'Your reservation is confirmed.',
            'attachments' => [], 'idempotency_key' => $key,
        ];
    }
}
