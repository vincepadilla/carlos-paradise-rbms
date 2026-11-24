<?php

namespace Tests\Feature;

use App\Models\User;
use Carbon\CarbonImmutable;
use Database\Seeders\ReservationSetupSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
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

    public function test_reservation_requires_an_eleven_digit_mobile_number_beginning_with_zero_nine(): void
    {
        $guest = User::factory()->create();
        $payload = $this->reservationPayload();

        foreach (['0917123456', '091712345678', '0917abc4567', '08171234567', '+639171234567'] as $phone) {
            $this->actingAs($guest)
                ->postJson('/api/reservations', [
                    ...$payload,
                    'contact_phone' => $phone,
                ])
                ->assertUnprocessable()
                ->assertJsonValidationErrors('contact_phone');
        }

        $this->assertDatabaseCount('reservations', 0);
    }

    public function test_guest_cancellation_leaves_the_hold_protected_for_staff_release(): void
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
            'status' => 'queued',
        ]);
        $this->assertDatabaseMissing('reservation_opportunities', ['reservation_id' => $secondId]);
        $this->assertDatabaseCount('reservation_queue_releases', 0);
        $this->postJson('/api/quote', $payload)->assertOk()->assertJsonPath('availability', 'queue');

        $url = "/api/reservations/$firstId/opportunity/release";
        $this->postJson($url)->assertForbidden();
        $this->actingAs($this->staff('admin'))->postJson($url)->assertOk()
            ->assertJsonPath('selected_reservation_id', $secondId)->assertJsonPath('approval_required', true);
        $this->assertDatabaseMissing('reservation_opportunities', ['reservation_id' => $secondId]);
    }

    public function test_staff_approve_one_fifo_candidate_and_new_bookings_cannot_jump_the_queue(): void
    {
        $this->recommendation(1)->assertUnauthorized();
        $payload = $this->reservationPayload();
        $leader = $this->book($payload);
        $first = $this->book($payload);
        $second = $this->book($payload);
        // Both waiters submitted in the same second. The lower reservation ID wins.
        DB::table('reservations')->whereIn('id', [$first, $second])
            ->update(['requested_at' => CarbonImmutable::now('Asia/Manila')->subMinute()->toIso8601String()]);
        $admin = $this->staff('admin');
        $owner = $this->staff('owner');
        $releaseUrl = "/api/reservations/$leader/opportunity/release";
        $this->actingAs($admin)->postJson("/api/reservations/$first/opportunity")->assertUnprocessable();
        $release = $this->postJson($releaseUrl)->assertOk()->assertJsonPath('eligible_candidates', 2)
            ->assertJsonPath('selected_reservation_id', $first)->assertJsonPath('selection_policy', 'FIFO')->json('release_id');
        $this->getJson("/api/reservations/$leader")->assertOk()->assertJsonPath('reservation.opportunity.release_id', $release);
        $this->postJson($releaseUrl)->assertOk()->assertJsonPath('release_id', $release);
        $this->assertDatabaseCount('reservation_queue_releases', 1);
        $this->assertDatabaseMissing('reservation_opportunities', ['reservation_id' => $first]);
        $this->assertDatabaseMissing('reservation_opportunities', ['reservation_id' => $second]);

        $guest = User::factory()->create();
        $this->actingAs($guest)->recommendation($release)->assertForbidden();
        $this->postJson("/api/reservations/$first/opportunity", ['release_id' => $release])->assertForbidden();
        $this->postJson('/api/quote', $payload)->assertOk()->assertJsonPath('availability', 'queue');
        $this->postJson('/api/reservations', $payload)->assertUnprocessable()->assertJsonValidationErrors('dates');
        $late = $this->book($payload);
        $this->assertDatabaseHas('reservations', ['id' => $late, 'status' => 'queued']);

        $this->actingAs($owner)->recommendation($release + 1000)->assertNotFound();
        $certificate = $this->recommendation($release)->assertOk()
            ->assertJsonPath('operation', 'queue_select')->assertJsonPath('status', 'ok')
            ->assertJsonPath('approval_required', true)->assertJsonPath('result.release_id', $release)
            ->assertJsonPath('result.eligible_candidates', 2)->assertJsonPath('result.selected_reservation_id', $first);
        $this->assertIsNumeric($certificate->json('execution_time_ms'));
        $this->assertDatabaseMissing('reservation_opportunities', ['reservation_id' => $first]);
        $this->assertDatabaseHas('reservation_queue_releases', ['id' => $release, 'granted_reservation_id' => null]);
        $this->postJson("/api/reservations/$second/opportunity", ['release_id' => $release])->assertConflict();
        $this->postJson("/api/reservations/$first/opportunity", ['release_id' => $release])->assertOk()
            ->assertJsonPath('reservation.status', 'awaiting_deposit');
        $this->postJson("/api/reservations/$first/opportunity", ['release_id' => $release])->assertOk();
        $this->postJson("/api/reservations/$second/opportunity", ['release_id' => $release])->assertConflict();
        $this->recommendation($release)->assertOk()->assertJsonPath('result.granted_reservation_id', $first);
        $this->assertSame(1, DB::table('reservation_opportunities')->where('reservation_id', $first)->count());
        $this->assertDatabaseHas('reservation_queue_releases', ['id' => $release,
            'released_by' => $admin->id, 'approved_by' => $owner->id, 'granted_reservation_id' => $first]);
    }

    public function test_grant_rechecks_cleaning_conflicts_and_ignores_waiters_outside_the_released_stay(): void
    {
        $short = $this->reservationPayload();
        $start = CarbonImmutable::parse($short['checkin'], 'Asia/Manila');
        $leader = $this->book([...$short, 'checkout' => $start->addDays(2)->toDateString()]);
        $first = $this->book($short);
        $second = $this->book([...$short, 'checkin' => $start->addDay()->toDateString(), 'checkout' => $start->addDays(2)->toDateString()]);
        $unrelated = [...$short, 'checkin' => $start->addDays(5)->toDateString(), 'checkout' => $start->addDays(6)->toDateString()];
        $this->book($unrelated);
        $unrelatedWaiter = $this->book($unrelated);

        $this->actingAs($this->staff('admin'));
        $release = $this->postJson("/api/reservations/$leader/opportunity/release")->assertOk()
            ->assertJsonPath('eligible_candidates', 2)->assertJsonPath('selected_reservation_id', $first)->json('release_id');
        // Scheduling now protects the FIFO candidate, including its cleaning time.
        $visit = ['guest_name' => 'Site visit', 'contact_details' => 'Front desk',
            'visit_date' => $short['checkout'], 'start_time' => '12:00', 'end_time' => '12:30',
            'status' => 'approved'];
        $this->postJson('/api/admin/ocular-visits', $visit)->assertUnprocessable();
        // Simulate an external calendar change to verify grant-time revalidation as well.
        DB::table('ocular_visits')->insert([...$visit, 'villa_id' => 1, 'created_by' => auth()->id()]);
        $this->recommendation($release)->assertOk()
            ->assertJsonPath('result.eligible_candidates', 1)->assertJsonPath('result.selected_reservation_id', $second);
        $this->postJson("/api/reservations/$first/opportunity", ['release_id' => $release])->assertConflict();
        $this->postJson("/api/reservations/$unrelatedWaiter/opportunity", ['release_id' => $release])->assertConflict();
        $this->postJson("/api/reservations/$second/opportunity", ['release_id' => $release])->assertOk();
        $this->assertDatabaseMissing('reservation_opportunities', ['reservation_id' => $first]);
    }

    public function test_staff_can_extend_an_expired_unreleased_opportunity_or_release_it_with_no_candidate(): void
    {
        $payload = $this->reservationPayload();
        $leader = $this->book($payload);
        $opportunity = DB::table('reservation_opportunities')->where('reservation_id', $leader)->value('id');
        $past = CarbonImmutable::now('Asia/Manila')->subHour()->toIso8601String();
        DB::table('reservations')->where('id', $leader)->update(['deadline' => $past]);
        DB::table('reservation_opportunities')->where('id', $opportunity)->update(['deposit_deadline' => $past]);
        $newDeadline = CarbonImmutable::now('Asia/Manila')->addDay()->format('Y-m-d\TH:i');

        $this->getJson("/api/reservations/$leader")->assertOk()->assertJsonPath('reservation.status', 'expired');
        $this->postJson('/api/quote', $payload)->assertOk()->assertJsonPath('availability', 'queue');
        $this->postJson("/api/reservations/$leader/opportunity/extend", ['deadline' => $newDeadline])->assertForbidden();
        $this->actingAs($this->staff('owner'))->postJson("/api/reservations/$leader/opportunity/extend", ['deadline' => $newDeadline])
            ->assertOk()->assertJsonPath('reservation.opportunity.status', 'active')->assertJsonPath('reservation.opportunity.id', $opportunity);
        $this->assertDatabaseCount('reservation_queue_releases', 0);
        $release = $this->postJson("/api/reservations/$leader/opportunity/release")->assertOk()
            ->assertJsonPath('selected_reservation_id', null)->assertJsonPath('eligible_candidates', 0)
            ->assertJsonPath('approval_required', false)->json('release_id');
        $this->recommendation($release)->assertOk()->assertJsonPath('result.candidate_found', false);
        $this->postJson("/api/reservations/$leader/opportunity/extend", ['deadline' => $newDeadline])->assertUnprocessable();
        $this->postJson('/api/quote', $payload)->assertOk()->assertJsonPath('availability', 'available');
    }

    public function test_waiter_whose_checkin_passes_after_release_does_not_hold_up_the_next_guest(): void
    {
        $payload = $this->reservationPayload();
        $start = CarbonImmutable::parse($payload['checkin'].' 14:00', 'Asia/Manila');
        $leader = $this->book([...$payload, 'checkout' => $start->addDays(2)->toDateString()]);
        $earlier = $this->book($payload);
        $later = $this->book([...$payload, 'checkin' => $start->addDay()->toDateString(),
            'checkout' => $start->addDays(2)->toDateString()]);
        $this->actingAs($this->staff('owner'));
        $release = $this->postJson("/api/reservations/$leader/opportunity/release")
            ->assertOk()->assertJsonPath('selected_reservation_id', $earlier)->json('release_id');

        CarbonImmutable::withTestNow($start->addMinute(), function () use ($release, $earlier, $later) {
            $this->postJson("/api/reservations/$earlier/opportunity", ['release_id' => $release])->assertConflict();
            $this->recommendation($release)->assertOk()
                ->assertJsonPath('result.eligible_candidates', 1)->assertJsonPath('result.selected_reservation_id', $later);
            $this->postJson("/api/reservations/$later/opportunity", ['release_id' => $release])->assertOk();
            $this->assertDatabaseMissing('reservation_opportunities', ['reservation_id' => $earlier]);
        });
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
        ])->fresh();

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
            ->postJson('/api/admin/reservations/'.$firstId.'/payments/'.$paymentId.'/review', [
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

    private function book(array $payload): int
    {
        return $this->actingAs(User::factory()->create())->postJson('/api/reservations', [
            ...$payload, 'queue_acknowledged' => true, 'request_key' => (string) Str::uuid(),
        ])->assertCreated()->json('reservation.id');
    }

    private function staff(string $role): User
    {
        return User::factory()->create(['role_id' => DB::table('roles')->where('name', $role)->value('id')])->fresh();
    }

    private function recommendation(int $releaseId): TestResponse
    {
        return $this->postJson('/api/v1/algorithm/solve', ['operation' => 'queue_select', 'release_id' => $releaseId]);
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
