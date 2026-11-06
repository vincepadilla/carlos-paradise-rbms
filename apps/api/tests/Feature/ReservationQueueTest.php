<?php

namespace Tests\Feature;

use App\Models\User;
use Carbon\CarbonImmutable;
use Database\Seeders\ReservationSetupSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class ReservationQueueTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        $this->seed(ReservationSetupSeeder::class);
    }

    public function test_first_request_gets_opportunity_and_overlaps_are_queued(): void
    {
        $firstGuest = User::factory()->create();
        $secondGuest = User::factory()->create();
        $payload = $this->reservationPayload();

        $first = $this->actingAs($firstGuest)
            ->postJson('/api/reservations', $payload)
            ->assertCreated()
            ->assertJsonPath(
                'reservation.status',
                'awaiting_deposit'
            )
            ->assertJsonPath(
                'reservation.opportunity.status',
                'active'
            );

        $firstId = $first->json('reservation.id');

        $this->actingAs($secondGuest)
            ->postJson('/api/reservations', [
                ...$payload,
                'queue_acknowledged' => true,
                'request_key' => '22222222-2222-4222-8222-222222222222',
            ])
            ->assertCreated()
            ->assertJsonPath('reservation.status', 'queued')
            ->assertJsonPath('reservation.queue_position', 2)
            ->assertJsonPath('reservation.reservations_ahead', 1);

        $this->assertDatabaseHas('reservations', [
            'id' => $firstId,
            'status' => 'awaiting_deposit',
        ]);
    }

    public function test_cancelling_an_unpaid_opportunity_promotes_the_queue(): void
    {
        $firstGuest = User::factory()->create();
        $secondGuest = User::factory()->create();
        $payload = $this->reservationPayload();

        $firstId = $this->actingAs($firstGuest)
            ->postJson('/api/reservations', $payload)
            ->json('reservation.id');

        $secondId = $this->actingAs($secondGuest)
            ->postJson('/api/reservations', [
                ...$payload,
                'queue_acknowledged' => true,
                'request_key' => '22222222-2222-4222-8222-222222222222',
            ])
            ->json('reservation.id');

        $this->actingAs($firstGuest)
            ->postJson('/api/reservations/'.$firstId.'/cancel')
            ->assertOk();

        $this->assertDatabaseHas('reservations', [
            'id' => $secondId,
            'status' => 'awaiting_deposit',
        ]);

        $this->assertDatabaseHas('reservation_opportunities', [
            'reservation_id' => $secondId,
            'status' => 'active',
        ]);
    }

    public function test_paid_queue_leader_enters_review_and_cancels_later_queue_positions(): void
    {
        $firstGuest = User::factory()->create();
        $secondGuest = User::factory()->create();
        $thirdGuest = User::factory()->create();
        $payload = $this->reservationPayload();

        $firstId = $this->actingAs($firstGuest)
            ->postJson('/api/reservations', $payload)
            ->json('reservation.id');

        $secondId = $this->actingAs($secondGuest)
            ->postJson('/api/reservations', [
                ...$payload,
                'queue_acknowledged' => true,
                'request_key' => '22222222-2222-4222-8222-222222222222',
            ])
            ->assertJsonPath('reservation.queue_position', 2)
            ->json('reservation.id');

        $thirdId = $this->actingAs($thirdGuest)
            ->postJson('/api/reservations', [
                ...$payload,
                'queue_acknowledged' => true,
                'request_key' => '33333333-3333-4333-8333-333333333333',
            ])
            ->assertJsonPath('reservation.queue_position', 3)
            ->json('reservation.id');

        DB::table('payment_methods')->insert([
            'name' => 'GCash',
            'account_name' => 'Carlos Paradise',
            'account_number' => '09170000000',
            'is_active' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        config([
            'reservations.receipt_root' => storage_path('framework/testing/reservation-receipts'),
        ]);

        $this->actingAs($firstGuest)
            ->post('/api/reservations/'.$firstId.'/payments', [
                'amount' => 5000,
                'method' => 'GCash',
                'reference' => 'QUEUE-FIRST-DEPOSIT',
                'payment_date' => now()->toDateString(),
                'receipt' => UploadedFile::fake()->create(
                    'receipt.jpg',
                    10,
                    'image/jpeg'
                ),
            ], ['Accept' => 'application/json'])
            ->assertCreated()
            ->assertJsonPath('reservation.status', 'payment_review');

        $this->assertDatabaseHas('reservations', [
            'id' => $firstId,
            'status' => 'payment_review',
        ]);

        foreach ([$secondId, $thirdId] as $cancelledId) {
            $this->assertDatabaseHas('reservations', [
                'id' => $cancelledId,
                'status' => 'cancelled',
            ]);

            $this->assertDatabaseHas('reservation_status_history', [
                'reservation_id' => $cancelledId,
                'to_status' => 'cancelled',
            ]);
        }

        $this->actingAs($secondGuest)
            ->post('/api/reservations/'.$secondId.'/payments', [
                'amount' => 5000,
                'method' => 'GCash',
                'reference' => 'QUEUE-SECOND-DEPOSIT',
                'payment_date' => now()->toDateString(),
                'receipt' => UploadedFile::fake()->create(
                    'receipt.jpg',
                    10,
                    'image/jpeg'
                ),
            ], ['Accept' => 'application/json'])
            ->assertUnprocessable();

        $this->assertDatabaseMissing('payments', [
            'reservation_id' => $secondId,
        ]);

        $this->actingAs($secondGuest)
            ->getJson('/api/reservations')
            ->assertOk()
            ->assertJsonPath('reservations.0.status', 'cancelled')
            ->assertJsonPath(
                'reservations.0.queue_notice',
                'Your reservation opportunity is no longer available because another guest submitted the required deposit for overlapping dates. Please book another available date if you still wish to make a reservation.'
            );
    }

    public function test_admin_can_verify_a_deposit_under_review(): void
    {
        $receiptRoot = storage_path('framework/testing/queue-review-'.\Illuminate\Support\Str::uuid());
        config(['reservations.receipt_root' => $receiptRoot]);
        $this->beforeApplicationDestroyed(fn () => \Illuminate\Support\Facades\File::deleteDirectory($receiptRoot));
        app(\App\Services\ReservationWorkflow::class)->disk()->put('test-receipt.pdf', "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF");
        $firstGuest = User::factory()->create();
        $secondGuest = User::factory()->create();
        $payload = $this->reservationPayload();

        $firstId = $this->actingAs($firstGuest)
            ->postJson('/api/reservations', $payload)
            ->json('reservation.id');

        $secondId = $this->actingAs($secondGuest)
            ->postJson('/api/reservations', [
                ...$payload,
                'queue_acknowledged' => true,
                'request_key' => '22222222-2222-4222-8222-222222222222',
            ])
            ->json('reservation.id');

        $adminRole = DB::table('roles')
            ->where('name', 'admin')
            ->value('id');

        $admin = User::factory()->create([
            'role_id' => $adminRole,
        ]);

        $methodId = DB::table('payment_methods')->insertGetId([
            'name' => 'GCash',
            'account_name' => 'Carlos Paradise',
            'account_number' => '09170000000',
            'is_active' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $opportunityId = DB::table('reservation_opportunities')
            ->where('reservation_id', $firstId)
            ->value('id');

        $paymentId = DB::table('payments')->insertGetId([
            'reservation_id' => $firstId,
            'opportunity_id' => $opportunityId,
            'payment_method_id' => $methodId,
            'payment_kind' => 'deposit',
            'amount' => 5000,
            'currency' => 'PHP',
            'reference_number' => 'TEST-REFERENCE',
            'receipt_storage_path' => 'test-receipt.pdf',
            'payment_date' => now()->toDateString(),
            'submitted_at' => now(),
            'status' => 'submitted',
            'submitted_by' => $firstGuest->id,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('reservations')
            ->where('id', $firstId)
            ->update(['status' => 'payment_review']);

        $this->actingAs($admin)
            ->postJson('/api/payments/'.$paymentId.'/review', [
                'decision' => 'approved',
                'note' => 'Transfer verified.',
            ])
            ->assertOk()
            ->assertJsonPath('reservation.status', 'confirmed');

        $this->assertDatabaseHas('reservations', [
            'id' => $secondId,
            'status' => 'cancelled',
        ]);

        $this->actingAs($secondGuest)
            ->postJson('/api/quote', $payload)
            ->assertOk()
            ->assertJsonPath('availability', 'blocked');
    }

    private function reservationPayload(): array
    {
        $checkin = CarbonImmutable::now('Asia/Manila')
            ->addDays(10);

        return [
            'type' => 'overnight',
            'checkin' => $checkin->toDateString(),
            'checkout' => $checkin->addDay()->toDateString(),
            'checkin_time' => '14:00',
            'checkout_time' => '11:00',
            'adults' => 2,
            'children' => 0,
            'pets' => 0,
            'bonfire_qty' => 0,
            'charcoal_qty' => 0,
            'notes' => null,
            'contact_name' => 'Reservation Guest',
            'contact_email' => 'guest@example.test',
            'contact_phone' => '09171234567',
            'inquiry_source' => 'Website',
            'terms' => true,
            'request_key' => '11111111-1111-4111-8111-111111111111',
        ];
    }
}
