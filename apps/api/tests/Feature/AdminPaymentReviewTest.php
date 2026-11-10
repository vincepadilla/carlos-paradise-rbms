<?php

namespace Tests\Feature;

use App\Models\Role;
use App\Models\User;
use App\Services\ReservationWorkflow;
use Database\Seeders\ReservationSetupSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Str;
use Tests\TestCase;

class AdminPaymentReviewTest extends TestCase
{
    use RefreshDatabase;

    private string $receiptRoot;

    private const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';

    protected function beforeRefreshingDatabase(): void
    {
        if (config('database.default') !== 'sqlite' || config('database.connections.sqlite.database') !== ':memory:') {
            throw new \RuntimeException('Payment review tests require isolated SQLite :memory:.');
        }
    }

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(ReservationSetupSeeder::class);
        $this->receiptRoot = storage_path('framework/testing/payment-review-'.Str::uuid());
        config(['reservations.receipt_root' => $this->receiptRoot]);
    }

    protected function tearDown(): void
    {
        if (isset($this->receiptRoot) && str_starts_with($this->receiptRoot, storage_path('framework/testing/payment-review-'))) {
            File::deleteDirectory($this->receiptRoot);
        }
        parent::tearDown();
    }

    public function test_only_active_admin_can_read_preview_or_review_including_legacy_http_endpoint(): void
    {
        [$id, $payment] = $this->fixture();
        $this->getJson($this->page($id))->assertUnauthorized();
        $this->getJson('/api/admin/payment-reviews')->assertUnauthorized();
        $this->postJson($this->review($id, $payment), $this->decision())->assertUnauthorized();
        foreach (['guest', 'owner'] as $role) {
            $this->actingAs($this->account($role))->getJson($this->page($id))->assertForbidden();
            $this->getJson('/api/admin/payment-reviews')->assertForbidden();
            $this->getJson($this->receipt($id, $payment))->assertForbidden();
            $this->postJson($this->review($id, $payment), $this->decision())->assertForbidden();
            $this->postJson('/api/payments/'.$payment.'/review', $this->decision('rejected'))->assertForbidden();
        }
        $admin = $this->account('admin');
        $admin->forceFill(['is_active' => false])->save();
        $this->actingAs($admin)->postJson($this->review($id, $payment), $this->decision())->assertForbidden();
        $this->assertDatabaseHas('payments', ['id' => $payment, 'status' => 'submitted']);
        $this->assertDatabaseCount('payment_reviews', 0);
    }

    public function test_admin_loads_actual_submission_without_private_paths_and_receipt_is_scoped_to_reservation(): void
    {
        [$id, $payment, $guest] = $this->fixture();
        [$other] = $this->fixture();
        $this->actingAs($this->account('admin'))->getJson($this->page($id))->assertOk()->assertHeader('Cache-Control', 'no-store, private')
            ->assertJsonPath('reservation.id', $id)->assertJsonPath('reservation.payments.0.id', $payment)
            ->assertJsonPath('reservation.payments.0.payment_date', now('Asia/Manila')->toDateString())
            ->assertJsonPath('reservation.payments.0.reviewed_at', null)->assertJsonPath('receipts.'.$payment.'.available', true)
            ->assertJsonPath('receipts.'.$payment.'.mime', 'image/png')->assertJsonMissingPath('reservation.payments.0.receipt_storage_path');
        $this->getJson($this->page(99999))->assertNotFound();
        $this->getJson($this->receipt($other, $payment))->assertNotFound();
        $this->postJson($this->review($other, $payment), $this->decision())->assertNotFound();
        $this->get($this->receipt($id, $payment))->assertOk()->assertHeader('Content-Type', 'image/png')
            ->assertHeader('X-Content-Type-Options', 'nosniff')->assertHeader('Cache-Control', 'no-store, private');
        $this->actingAs($this->account('guest'))->getJson('/api/payments/'.$payment.'/receipt')->assertForbidden();
        $this->actingAs($guest)->getJson('/api/payments/'.$payment.'/receipt')->assertUnprocessable()
            ->assertJsonPath('message', 'The official receipt is available after payment approval.');
    }

    public function test_approval_persists_payment_review_and_confirmation_and_all_read_models_agree(): void
    {
        [$id, $payment, $guest] = $this->fixture();
        $admin = $this->account('admin');
        $this->actingAs($admin)->postJson($this->review($id, $payment), $this->decision())->assertOk()
            ->assertJsonPath('reservation.status', 'confirmed')->assertJsonPath('reservation.deposit_paid', '5000.00');
        $this->assertDatabaseHas('payments', ['id' => $payment, 'amount' => 5000, 'status' => 'approved']);
        $this->assertDatabaseHas('payment_reviews', ['payment_id' => $payment, 'reviewed_by' => $admin->id, 'decision' => 'approved', 'notes' => 'Transfer verified.']);
        $this->assertNotNull(DB::table('payment_reviews')->where('payment_id', $payment)->value('reviewed_at'));
        $this->assertDatabaseHas('reservation_opportunities', ['reservation_id' => $id, 'status' => 'completed']);
        $this->assertDatabaseHas('reservation_status_history', ['reservation_id' => $id, 'changed_by' => $admin->id, 'to_status' => 'confirmed']);
        $this->getJson('/api/reservations/'.$id)->assertOk()->assertJsonPath('reservation.payments.0.status', 'approved')
            ->assertJsonPath('reservation.payments.0.reviewed_by', $admin->id)->assertJsonPath('reservation.deposit_paid', '5000.00');
        $this->getJson($this->calendar())->assertOk()->assertJsonPath('reservations.0.id', $id)->assertJsonPath('reservations.0.status', 'confirmed');
        $this->getJson('/api/reservations')->assertOk()->assertJsonPath('reservations.0.payments.0.status', 'approved');
        $this->getJson('/api/admin/payment-reviews')->assertOk()->assertJsonPath('total', 0)->assertJsonCount(0, 'data');
        $this->actingAs($guest)->getJson('/api/reservations/'.$id)->assertOk()->assertJsonPath('reservation.status', 'confirmed')->assertJsonPath('reservation.deposit_paid', '5000.00');
        $official = $this->get('/api/payments/'.$payment.'/receipt');
        $receiptNumber = 'CPR-'.now('Asia/Manila')->format('Y').'-'.str_pad((string) $payment, 6, '0', STR_PAD_LEFT);
        $official->assertOk()->assertHeader('Content-Type', 'application/pdf')
            ->assertHeader('Content-Disposition', 'attachment; filename="official-receipt-'.$receiptNumber.'.pdf"')
            ->assertHeader('X-Content-Type-Options', 'nosniff');
        $this->assertStringStartsWith('%PDF-1.4', $official->getContent());
        $this->assertStringContainsString('OFFICIAL PAYMENT RECEIPT', $official->getContent());
        $this->assertStringNotContainsString(base64_decode(self::PNG), $official->getContent());
        $this->assertDatabaseCount('payments', 1);
        $this->assertTrue(app(ReservationWorkflow::class)->disk()->exists('proof-'.$payment.'.png'));
    }

    public function test_excess_deposit_is_approved_in_full_and_applied_to_the_reservation_balance(): void
    {
        [$id, $payment] = $this->fixture([], ['amount' => 6000]);

        $this->actingAs($this->account('admin'))
            ->postJson($this->review($id, $payment), $this->decision())
            ->assertOk()
            ->assertJsonPath('reservation.status', 'confirmed')
            ->assertJsonPath('reservation.deposit_paid', '6000.00')
            ->assertJsonPath('reservation.amount_due', '10000.00');

        $this->assertDatabaseHas('payments', [
            'id' => $payment,
            'amount' => 6000,
            'status' => 'approved',
        ]);
    }

    public function test_existing_approved_payments_and_selected_submission_meet_the_minimum_once(): void
    {
        [$id, $payment] = $this->fixture([], ['amount' => 3000]);
        $prior = (array) DB::table('payments')->where('id', $payment)->first();
        unset($prior['id']);
        $prior['amount'] = 2000;
        $prior['reference_number'] = 'PRIOR-APPROVED-'.Str::uuid();
        $prior['receipt_storage_path'] = 'prior-approved.png';
        $prior['status'] = 'approved';
        $prior['created_at'] = now();
        $prior['updated_at'] = now();
        $priorId = DB::table('payments')->insertGetId($prior);

        $this->actingAs($this->account('admin'))
            ->postJson($this->review($id, $payment), $this->decision())
            ->assertOk()
            ->assertJsonPath('reservation.status', 'confirmed')
            ->assertJsonPath('reservation.deposit_paid', '5000.00')
            ->assertJsonPath('reservation.amount_due', '11000.00');

        $this->assertDatabaseHas('payments', ['id' => $priorId, 'amount' => 2000, 'status' => 'approved']);
        $this->assertDatabaseHas('payments', ['id' => $payment, 'amount' => 3000, 'status' => 'approved']);
    }

    public function test_other_pending_and_rejected_payments_do_not_satisfy_the_minimum(): void
    {
        [$id, $payment] = $this->fixture([], ['amount' => 3000]);
        $base = (array) DB::table('payments')->where('id', $payment)->first();
        unset($base['id']);

        foreach ([
            ['status' => 'approved', 'amount' => 1000, 'reference_number' => 'PRIOR-'.Str::uuid()],
            ['status' => 'submitted', 'amount' => 9000, 'reference_number' => 'OTHER-PENDING-'.Str::uuid()],
            ['status' => 'rejected', 'amount' => 9000, 'reference_number' => 'REJECTED-'.Str::uuid()],
        ] as $index => $values) {
            DB::table('payments')->insert([
                ...$base,
                ...$values,
                'receipt_storage_path' => 'other-'.$index.'.png',
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }

        $this->actingAs($this->account('admin'))
            ->postJson($this->review($id, $payment), $this->decision())
            ->assertUnprocessable()
            ->assertJsonPath('message', 'The prospective verified total is below the minimum required deposit. Remaining deposit: PHP 1,000.00.');

        $this->assertDatabaseHas('payments', ['id' => $payment, 'status' => 'submitted']);
        $this->assertDatabaseHas('reservations', ['id' => $id, 'status' => 'payment_review']);
        $this->assertDatabaseCount('payment_reviews', 0);
    }

    public function test_rejection_preserves_reason_history_and_receipt_and_customer_can_resubmit_then_be_verified(): void
    {
        [$id, $payment, $guest] = $this->fixture();
        $admin = $this->account('admin');
        $this->actingAs($admin)->postJson($this->review($id, $payment), ['decision' => 'rejected', 'note' => '  Unreadable receipt.  '])->assertOk()
            ->assertJsonPath('reservation.status', 'awaiting_deposit')->assertJsonPath('reservation.payments.0.review_note', 'Unreadable receipt.');
        $this->assertDatabaseHas('payment_reviews', ['payment_id' => $payment, 'reviewed_by' => $admin->id, 'notes' => 'Unreadable receipt.', 'decision' => 'rejected']);
        $this->assertDatabaseHas('payments', ['id' => $payment, 'status' => 'rejected']);
        $this->assertTrue(app(ReservationWorkflow::class)->disk()->exists('proof-'.$payment.'.png'));
        $payload = ['amount' => 5000, 'method' => 'GCash', 'reference' => 'NEW-TRANSFER-1234', 'payment_date' => now('Asia/Manila')->toDateString(), 'receipt' => UploadedFile::fake()->createWithContent('receipt.png', base64_decode(self::PNG))];
        $new = $this->actingAs($guest)->post('/api/reservations/'.$id.'/payments', $payload, ['Accept' => 'application/json'])->assertCreated()
            ->assertJsonPath('reservation.status', 'payment_review')->json('payment.id');
        $this->assertDatabaseCount('payments', 2);
        $this->actingAs($admin)->postJson($this->review($id, $new), $this->decision())->assertOk()->assertJsonPath('reservation.status', 'confirmed');
        $this->actingAs($guest)->getJson('/api/reservations/'.$id)->assertOk()->assertJsonCount(2, 'reservation.payments')->assertJsonPath('reservation.payments.1.status', 'rejected');
    }

    public function test_customer_entered_payment_amount_is_preserved_for_staff_review(): void
    {
        [$id, $payment, $guest] = $this->fixture();
        $admin = $this->account('admin');
        $this->actingAs($admin)->postJson($this->review($id, $payment), [
            'decision' => 'rejected',
            'note' => 'Submit the actual transferred amount.',
        ])->assertOk();

        $payload = [
            'amount' => 4250.75,
            'method' => 'GCash',
            'reference' => 'CUSTOM-AMOUNT-425075',
            'payment_date' => now('Asia/Manila')->toDateString(),
            'receipt' => UploadedFile::fake()->createWithContent('custom-amount.png', base64_decode(self::PNG)),
        ];
        $newPayment = $this->actingAs($guest)
            ->post('/api/reservations/'.$id.'/payments', $payload, ['Accept' => 'application/json'])
            ->assertCreated()
            ->assertJsonPath('reservation.status', 'payment_review')
            ->json('payment.id');

        $this->assertDatabaseHas('payments', [
            'id' => $newPayment,
            'amount' => 4250.75,
            'status' => 'submitted',
        ]);
        $this->actingAs($admin)
            ->postJson($this->review($id, $newPayment), $this->decision())
            ->assertUnprocessable();
    }

    public function test_duplicate_and_contradictory_decisions_cannot_create_another_review(): void
    {
        [$id, $payment] = $this->fixture();
        $this->actingAs($this->account('admin'))->postJson($this->review($id, $payment), $this->decision())->assertOk();
        $this->postJson($this->review($id, $payment), $this->decision())->assertUnprocessable();
        $this->postJson('/api/payments/'.$payment.'/review', $this->decision('rejected'))->assertUnprocessable();
        $this->assertDatabaseCount('payment_reviews', 1);
        $this->assertDatabaseHas('reservations', ['id' => $id, 'status' => 'confirmed']);
    }

    public function test_mismatched_amount_invalid_currency_unagreed_total_and_missing_proof_cannot_confirm(): void
    {
        $this->actingAs($this->account('admin'));
        foreach ([['amount' => 4999.99], ['amount' => 0], ['currency' => 'USD'], ['payment_kind' => 'balance']] as $overrides) {
            [$id, $payment] = $this->fixture([], $overrides);
            $this->postJson($this->review($id, $payment), $this->decision())->assertUnprocessable();
            $this->assertDatabaseHas('payments', ['id' => $payment, 'status' => 'submitted']);
        }
        [$id, $payment] = $this->fixture(['price_agreed' => false]);
        $this->postJson($this->review($id, $payment), $this->decision())->assertUnprocessable();
        [$id, $payment] = $this->fixture();
        app(ReservationWorkflow::class)->disk()->delete('proof-'.$payment.'.png');
        $this->getJson($this->page($id))->assertJsonPath('receipts.'.$payment.'.available', false);
        $this->getJson($this->receipt($id, $payment))->assertNotFound();
        $this->postJson($this->review($id, $payment), $this->decision())->assertUnprocessable();
        $this->assertDatabaseCount('payment_reviews', 0);
    }

    public function test_unsafe_receipt_bytes_are_not_trusted_from_the_extension_and_upload_validation_remains_strict(): void
    {
        [$id, $payment, $guest] = $this->fixture();
        app(ReservationWorkflow::class)->disk()->put('proof-'.$payment.'.png', '<script>alert(1)</script>');
        $this->actingAs($this->account('admin'))->getJson($this->receipt($id, $payment))->assertStatus(415);
        $this->postJson($this->review($id, $payment), $this->decision())->assertUnprocessable();
        $this->postJson($this->review($id, $payment), $this->decision('rejected'))->assertOk();
        $fakePath = $this->receiptRoot.'/bad-upload.png';
        File::put($fakePath, '<script>bad</script>');
        // A real UploadedFile uses content sniffing; Laravel's fake derives MIME from its supplied name.
        $upload = new UploadedFile($fakePath, 'fake.png', 'image/png', UPLOAD_ERR_OK, true);
        $this->actingAs($guest)->post('/api/reservations/'.$id.'/payments', ['amount' => 5000, 'method' => 'GCash', 'reference' => 'BAD-UPLOAD-123', 'payment_date' => now()->toDateString(), 'receipt' => $upload], ['Accept' => 'application/json'])->assertUnprocessable();
        $this->assertDatabaseCount('payments', 1);
    }

    public function test_rejection_reason_and_transition_are_validated_and_conflicts_rollback_every_change(): void
    {
        [$id, $payment] = $this->fixture();
        $this->actingAs($this->account('admin'));
        foreach (['', '   ', 'ab', str_repeat('x', 1001), ['bad']] as $note) {
            $this->postJson($this->review($id, $payment), ['decision' => 'rejected', 'note' => $note])->assertUnprocessable();
        }
        DB::table('reservations')->where('id', $id)->update(['status' => 'cancelled']);
        $this->postJson($this->review($id, $payment), $this->decision())->assertUnprocessable();
        DB::table('reservations')->where('id', $id)->update(['status' => 'payment_review']);
        $this->fixture(['status' => 'confirmed']);
        $this->postJson($this->review($id, $payment), $this->decision())->assertUnprocessable();
        $this->assertDatabaseHas('payments', ['id' => $payment, 'status' => 'submitted']);
        $this->assertDatabaseCount('payment_reviews', 0);
        $this->assertDatabaseCount('reservation_status_history', 0);
    }

    public function test_rejection_after_stay_start_expires_instead_of_allowing_late_resubmission(): void
    {
        [$id, $payment] = $this->fixture(['starts_at' => now()->subHour()->toIso8601String(), 'ends_at' => now()->addHour()->toIso8601String()]);
        $this->actingAs($this->account('admin'))->postJson($this->review($id, $payment), $this->decision('rejected'))->assertOk()->assertJsonPath('reservation.status', 'expired');
        $this->assertDatabaseHas('reservation_opportunities', ['reservation_id' => $id, 'status' => 'expired']);
    }

    public function test_pdf_is_served_as_pdf_and_rejection_restores_a_missing_opportunity(): void
    {
        [$id, $payment] = $this->fixture();
        app(ReservationWorkflow::class)->disk()->put('proof-'.$payment.'.png', "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF");
        DB::table('reservation_opportunities')->where('reservation_id', $id)->update(['status' => 'revoked']);
        $this->actingAs($this->account('admin'))->get($this->receipt($id, $payment))->assertOk()->assertHeader('Content-Type', 'application/pdf');
        $this->postJson($this->review($id, $payment), $this->decision('rejected'))->assertOk()->assertJsonPath('reservation.opportunity.status', 'active');
    }

    public function test_paginated_review_queue_includes_old_pending_payments_beyond_the_reservation_list_limit(): void
    {
        [$id, $payment] = $this->fixture();
        $record = (array) DB::table('reservations')->where('id', $id)->first();
        unset($record['id']);
        $record['status'] = 'completed';
        $rows = [];
        for ($i = 0; $i < 501; $i++) {
            $rows[] = [...$record, 'booking_reference' => 'NEWER-'.$i];
        }
        foreach (array_chunk($rows, 50) as $chunk) {
            DB::table('reservations')->insert($chunk);
        }
        $this->actingAs($this->account('admin'))->getJson('/api/admin/payment-reviews?per_page=2')->assertOk()
            ->assertJsonPath('total', 1)->assertJsonPath('data.0.reservation.id', $id)->assertJsonPath('data.0.payment.id', $payment);
        $this->getJson('/api/admin/payment-reviews?per_page=0')->assertUnprocessable();
        $this->getJson('/api/admin/payment-reviews?page=-1')->assertUnprocessable();
        $this->getJson('/api/admin/payment-reviews?per_page=51')->assertUnprocessable();
        for ($i = 0; $i < 2; $i++) {
            $this->fixture();
        }
        $this->getJson('/api/admin/payment-reviews?per_page=2&page=2')->assertOk()->assertJsonPath('total', 3)->assertJsonPath('last_page', 2)
            ->assertJsonCount(1, 'data')->assertJsonPath('data.0.payment.id', $payment);
    }

    public function test_all_records_scope_searches_filters_aggregates_and_includes_unpaid_reservations(): void
    {
        [$id, $payment] = $this->fixture(['contact_name' => 'Searchable Deposit Guest']);
        $second = (array) DB::table('payments')->where('id', $payment)->first();
        unset($second['id']);
        $second['amount'] = 1250;
        $second['reference_number'] = 'FILTER-PAYMENT-REFERENCE';
        $second['status'] = 'rejected';
        $second['submitted_at'] = now()->addMinute();
        $second['receipt_storage_path'] = 'filter-proof.png';
        $second['created_at'] = now();
        $second['updated_at'] = now();
        $secondPayment = DB::table('payments')->insertGetId($second);

        $unpaid = (array) DB::table('reservations')->where('id', $id)->first();
        unset($unpaid['id']);
        $unpaid['booking_reference'] = 'UNPAID-DEPOSIT-RECORD';
        $unpaid['contact_name'] = 'No Payment Guest';
        $unpaid['status'] = 'awaiting_deposit';
        $unpaid['created_at'] = now();
        $unpaid['updated_at'] = now();
        $unpaidId = DB::table('reservations')->insertGetId($unpaid);

        $this->actingAs($this->account('admin'));
        $this->getJson('/api/admin/payment-reviews?scope=all')->assertOk()
            ->assertJsonPath('total', 2)
            ->assertJsonPath('filters.statuses.0.value', 'verified')
            ->assertJsonFragment(['reservation_id' => $unpaidId, 'status' => 'not_paid', 'total_submitted' => null])
            ->assertJsonFragment([
                'reservation_id' => $id,
                'total_submitted' => '6250.00',
                'status' => 'awaiting_review',
                'latest_payment_id' => $secondPayment,
            ]);
        $this->getJson('/api/admin/payment-reviews?scope=all&search=FILTER-PAYMENT-REFERENCE')->assertOk()
            ->assertJsonPath('total', 1)->assertJsonPath('data.0.reservation_id', $id);
        $this->getJson('/api/admin/payment-reviews?scope=all&search='.$id)->assertOk()
            ->assertJsonPath('total', 1)->assertJsonPath('data.0.reservation_id', $id);
        $this->getJson('/api/admin/payment-reviews?scope=all&search=No%20Payment%20Guest')->assertOk()
            ->assertJsonPath('total', 1)->assertJsonPath('data.0.reservation_id', $unpaidId);
        $this->getJson('/api/admin/payment-reviews?scope=all&status=not_paid')->assertOk()
            ->assertJsonPath('total', 1)->assertJsonPath('data.0.reservation_id', $unpaidId);
        $this->getJson('/api/admin/payment-reviews?scope=all&status=awaiting_review&method=GCash')->assertOk()
            ->assertJsonPath('total', 1)->assertJsonPath('data.0.reservation_id', $id);
        $this->getJson('/api/admin/payment-reviews?scope=all&per_page=1&page=2')->assertOk()
            ->assertJsonPath('total', 2)->assertJsonPath('current_page', 2)->assertJsonCount(1, 'data');

        DB::table('payments')->where('id', $payment)->update(['status' => 'approved']);
        $this->getJson('/api/admin/payment-reviews?scope=all&status=verified')->assertOk()
            ->assertJsonPath('total', 1)->assertJsonPath('data.0.reservation_id', $id);
        DB::table('payments')->where('id', $payment)->update(['status' => 'rejected']);
        $this->getJson('/api/admin/payment-reviews?scope=all&status=rejected')->assertOk()
            ->assertJsonPath('total', 1)->assertJsonPath('data.0.reservation_id', $id);

        $this->getJson('/api/admin/payment-reviews?scope=unsupported')->assertUnprocessable();
        $this->getJson('/api/admin/payment-reviews?scope=all&status=confirmed')->assertUnprocessable();
    }

    private function fixture(array $reservation = [], array $payment = []): array
    {
        $guest = $this->account('guest');
        $start = now('Asia/Manila')->addDays(10)->setTime(14, 0);
        $end = $start->copy()->addDay()->setTime(11, 0);
        $id = DB::table('reservations')->insertGetId(array_merge([
            'booking_reference' => 'PAY-'.Str::uuid(), 'user_id' => $guest->id, 'villa_id' => 1, 'type' => 'overnight', 'check_in_date' => $start->toDateString(), 'check_out_date' => $end->toDateString(),
            'starts_at' => $start->toIso8601String(), 'ends_at' => $end->toIso8601String(), 'contact_name' => $guest->name, 'contact_email' => $guest->email, 'contact_phone' => '09171234567',
            'inquiry_source' => 'Website', 'adults' => 2, 'status' => 'payment_review', 'price_agreed' => true, 'quoted_total' => 16000, 'required_deposit' => 5000,
            'pricing_snapshot' => '{}', 'policy_snapshot' => '{}', 'deadline' => now()->addDay()->toIso8601String(), 'requested_at' => now(), 'created_at' => now(), 'updated_at' => now(),
        ], $reservation));
        $opportunity = DB::table('reservation_opportunities')->insertGetId(['reservation_id' => $id, 'status' => 'active', 'granted_at' => now(), 'deposit_deadline' => now()->addDay(), 'created_at' => now(), 'updated_at' => now()]);
        $method = DB::table('payment_methods')->value('id') ?? DB::table('payment_methods')->insertGetId(['name' => 'GCash', 'account_name' => 'Resort', 'account_number' => 'TEST-ONLY', 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]);
        $paymentId = DB::table('payments')->insertGetId(array_merge(['reservation_id' => $id, 'opportunity_id' => $opportunity, 'payment_method_id' => $method, 'payment_kind' => 'deposit', 'currency' => 'PHP',
            'reference_number' => 'REF-'.Str::uuid(), 'amount' => 5000, 'receipt_storage_path' => 'pending', 'payment_date' => now('Asia/Manila')->toDateString(), 'submitted_at' => now(), 'submitted_by' => $guest->id,
            'status' => 'submitted', 'created_at' => now(), 'updated_at' => now()], $payment));
        DB::table('payments')->where('id', $paymentId)->update(['receipt_storage_path' => 'proof-'.$paymentId.'.png']);
        app(ReservationWorkflow::class)->disk()->put('proof-'.$paymentId.'.png', base64_decode(self::PNG));

        return [$id, $paymentId, $guest];
    }

    private function account(string $role): User
    {
        return User::factory()->create(['role_id' => Role::where('name', $role)->sole()->id])->fresh();
    }

    private function page(int $id): string
    {
        return '/api/admin/reservations/'.$id.'/payment-review';
    }

    private function review(int $id, int $payment): string
    {
        return '/api/admin/reservations/'.$id.'/payments/'.$payment.'/review';
    }

    private function receipt(int $id, int $payment): string
    {
        return '/api/admin/reservations/'.$id.'/payments/'.$payment.'/receipt';
    }

    private function decision(string $decision = 'approved'): array
    {
        return ['decision' => $decision, 'note' => 'Transfer verified.'];
    }

    private function calendar(): string
    {
        return '/api/admin/calendar?start='.now('Asia/Manila')->toDateString().'&end='.now('Asia/Manila')->addDays(30)->toDateString();
    }
}
