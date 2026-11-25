<?php

namespace Tests\Feature;

use App\Models\Role;
use App\Models\User;
use App\Services\OwnerAudit;
use App\Services\GuestEmailCatalog;
use App\Services\ReservationWorkflow;
use Database\Seeders\ReservationSetupSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class OwnerPortalTest extends TestCase
{
    use RefreshDatabase;

    protected function beforeRefreshingDatabase(): void
    {
        if (config('database.default') !== 'sqlite' || config('database.connections.sqlite.database') !== ':memory:') {
            throw new \RuntimeException('Owner tests require an isolated SQLite :memory: database.');
        }
    }

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(ReservationSetupSeeder::class);
    }

    public function test_all_owner_endpoints_reject_guests_admins_anonymous_and_disabled_owners(): void
    {
        $this->withoutMiddleware(\Illuminate\Routing\Middleware\ThrottleRequests::class);
        $routes = collect(app('router')->getRoutes())->filter(fn ($route) => str_starts_with($route->uri(), 'api/owner/'));
        $this->assertGreaterThan(40, $routes->count());
        foreach ([null, $this->account('guest'), $this->account('admin'), $this->account('owner', false)] as $user) {
            Auth::forgetGuards();
            if ($user) $this->actingAs($user);
            foreach ($routes as $route) {
                $path = '/'.preg_replace('/\{[^}]+\}/', '999999', $route->uri());
                $response = $this->json($route->methods()[0], $path, ['role' => 'owner']);
                $user ? $response->assertForbidden() : $response->assertUnauthorized();
            }
        }
    }

    public function test_owner_login_and_session_restore_report_the_correct_role(): void
    {
        $owner = $this->account('owner');
        Http::fake(['www.google.com/recaptcha/api/siteverify' => Http::response(['success' => true])]);
        $this->postJson('/auth/login', ['email' => strtoupper($owner->email), 'password' => 'OwnerPassword123', 'captcha_token' => 'fixture'])
            ->assertOk()->assertJsonPath('user.role', 'owner')->assertJsonMissingPath('user.password');
        $this->getJson('/auth/user')->assertOk()->assertJsonPath('user.id', $owner->id)->assertJsonPath('user.role', 'owner');
        $this->getJson('/api/owner/settings')->assertOk()->assertHeader('Cache-Control', 'no-store, private');
    }

    public function test_owner_uses_shared_operational_controllers_without_relaxing_admin_routes(): void
    {
        $this->actingAs($this->account('owner'));
        foreach (['reservations', 'guests', 'availability-blocks', 'calendar?start=2026-11-01&end=2026-12-01', 'notifications', 'reservation-create/options', 'payment-reviews', 'reports/reservations', 'reports/payments'] as $path) {
            $this->getJson('/api/owner/operations/'.$path)->assertOk();
        }
        $this->getJson('/api/admin/guests')->assertForbidden();
        $this->actingAs($this->account('admin'))->getJson('/api/admin/guests')->assertOk();
    }

    public function test_owner_can_manage_only_admin_accounts_and_disabled_sessions_lose_access(): void
    {
        $owner = $this->account('owner');
        $guest = $this->account('guest');
        $admin = $this->actingAs($owner)->postJson('/api/owner/admins', [
            'name' => 'New Admin', 'email' => 'NEW.ADMIN@example.test', 'password' => 'SecurePassword123',
        ])->assertCreated()->assertJsonMissingPath('admin.password')->json('admin');
        $this->assertDatabaseHas('users', ['id' => $admin['id'], 'role_id' => Role::where('name', 'admin')->value('id')]);
        $this->getJson('/api/owner/admins?search=new.admin')->assertOk()->assertJsonPath('total', 1);
        $this->patchJson('/api/owner/admins/'.$admin['id'], ['name' => 'Edited Admin'])->assertOk()->assertJsonPath('admin.name', 'Edited Admin');
        $this->patchJson('/api/owner/admins/'.$admin['id'], ['is_active' => false])->assertOk()->assertJsonPath('admin.is_active', false);
        foreach ([$owner, $guest] as $protected) $this->patchJson('/api/owner/admins/'.$protected->id, ['is_active' => false])->assertNotFound();
        $this->patchJson('/api/owner/admins/'.$admin['id'], ['role_id' => 3])->assertUnprocessable();
        $this->assertTrue($owner->fresh()->is_active);
        $disabled = User::findOrFail($admin['id']);
        $this->actingAs($disabled)->getJson('/api/admin/guests')->assertForbidden();
        $this->getJson('/auth/user')->assertUnauthorized();
        $this->actingAs($owner)->patchJson('/api/owner/admins/'.$admin['id'], ['is_active' => true])->assertOk();
        $this->actingAs($disabled->fresh())->getJson('/api/admin/guests')->assertOk();
    }

    public function test_admin_creation_validates_password_unique_email_and_role_escalation(): void
    {
        $owner = $this->account('owner');
        $this->actingAs($owner)->postJson('/api/owner/admins', ['name' => 'Admin', 'email' => $owner->email, 'password' => 'weak', 'role_id' => 3])
            ->assertUnprocessable()->assertJsonValidationErrors(['email', 'password', 'role_id']);
    }

    public function test_settings_persist_into_public_configuration_and_operational_columns(): void
    {
        $this->actingAs($this->account('owner'))->patchJson('/api/owner/settings', [
            'name' => 'Carlos Paradise Resort', 'deposit' => 6500, 'opportunity_hours' => 36, 'min_lead_days' => 4,
            'check_in_time' => '15:30', 'check_out_time' => '10:30', 'reservation_instructions' => 'Contact us before arrival.',
            'payment_deadline_instructions' => 'Pay during your opportunity.', 'standard_guests' => 18, 'max_guests' => 35,
            'landing_title' => 'Your private escape', 'amenities' => "Pool\nKitchen", 'policies' => 'Keep the resort clean.',
        ])->assertOk()->assertJsonPath('settings.deposit', 6500)->assertJsonPath('settings.check_in_time', '15:30');
        $this->getJson('/api/settings')->assertOk()->assertJsonPath('settings.min_lead_days', 4)
            ->assertJsonPath('settings.stay_options.0.checkin_time', '15:30')->assertJsonPath('settings.landing_title', 'Your private escape');
        $this->assertDatabaseHas('villas', ['id' => 1, 'deposit_amount' => 6500, 'deposit_window_hours' => 36, 'check_in_time' => '15:30']);
        $this->patchJson('/api/owner/settings', ['standard_guests' => 100, 'max_guests' => 30])->assertUnprocessable();
        $this->patchJson('/api/owner/settings', ['opportunity_hours' => 0, 'check_out_time' => '99:00'])->assertUnprocessable();
        $this->patchJson('/api/owner/settings', ['deposit' => 6500.001])->assertUnprocessable();
        $this->getJson('/api/settings')->assertJsonPath('settings.standard_guests', 18);
        $this->assertDatabaseHas('audit_events', ['module' => 'System Settings', 'action' => 'settings_updated']);
    }

    public function test_updated_schedule_and_lead_time_are_used_by_the_quote_validator(): void
    {
        $this->actingAs($this->account('owner'))->patchJson('/api/owner/settings', [
            'check_in_time' => '15:30', 'check_out_time' => '10:30', 'min_lead_days' => 4, 'deposit' => 6500,
        ])->assertOk();
        $this->actingAs($this->account('guest'));
        $start = now('Asia/Manila')->addDays(5);
        $quote = ['type' => 'overnight', 'checkin' => $start->toDateString(), 'checkout' => $start->addDay()->toDateString(),
            'checkin_time' => '15:30', 'checkout_time' => '10:30', 'adults' => 2, 'children' => 0, 'pets' => 0, 'bonfire_qty' => 0, 'charcoal_qty' => 0];
        $this->postJson('/api/quote', $quote)->assertOk()->assertJsonPath('quote.deposit', 6500);
        $this->postJson('/api/quote', [...$quote, 'checkin_time' => '14:00'])->assertUnprocessable();
        $this->postJson('/api/quote', [...$quote, 'checkin' => now('Asia/Manila')->addDay()->toDateString()])->assertUnprocessable();
    }

    public function test_receiving_account_changes_are_visible_to_guests_and_audited(): void
    {
        $this->actingAs($this->account('owner'))->postJson('/api/owner/payment-methods', [
            'name' => 'Bank Transfer', 'account_name' => 'Resort', 'account_number' => '123456789', 'is_active' => true,
        ])->assertOk();
        $this->getJson('/api/settings')->assertJsonPath('payment_methods.0.account_number', '123456789');
        $id = DB::table('payment_methods')->value('id');
        $this->postJson('/api/owner/payment-methods', ['id' => $id, 'name' => 'Bank Transfer', 'account_name' => 'Resort', 'account_number' => '123456789', 'is_active' => false])->assertOk();
        $this->getJson('/api/settings')->assertJsonCount(0, 'payment_methods');
        $this->assertDatabaseHas('audit_events', ['action' => 'payment_method_saved']);
    }

    public function test_pdf_uploads_keep_previous_versions_and_downloads_are_protected(): void
    {
        Storage::fake('local');
        $owner = $this->account('owner');
        $this->actingAs($owner);
        foreach ([1, 2] as $version) {
            $file = UploadedFile::fake()->createWithContent('agreement.pdf', "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF");
            $this->postJson('/api/owner/documents', ['key' => 'house-rules-policies', 'file' => $file, 'notes' => "Version {$version}"])
                ->assertCreated()->assertJsonPath('versions.0.version', $version)->assertJsonCount($version, 'versions');
        }
        $history = $this->getJson('/api/owner/documents?key=house-rules-policies')->assertOk()->json();
        $this->assertSame($history['versions'][0]['id'], $history['active_version_id']);
        $first = $history['versions'][1]['id'];
        foreach (DB::table('document_versions')->get() as $version) Storage::disk('local')->assertExists($version->storage_path);
        $this->get('/api/owner/documents/'.$first.'/download')->assertOk()->assertHeader('Content-Type', 'application/pdf');
        $this->get('/api/owner/documents/'.$first.'/download?preview=1')->assertOk()->assertHeader('Content-Disposition', 'inline; filename=document-v1.pdf');
        $this->actingAs($this->account('admin'))->getJson('/api/owner/documents/'.$first.'/download')->assertForbidden();
        $this->assertDatabaseCount('document_versions', 2);
        $this->assertDatabaseCount('active_documents', 1);
        $event = DB::table('audit_events')->where('action', 'document_uploaded')->first();
        $context = json_decode($event->context, true);
        $this->assertSame(hash('sha256', "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF"), $context['file_sha256']);
        $this->assertSame($context['file_sha256'], $context['request']['files']['file']['sha256']);
        $this->assertSame('verified', app(\App\Services\AuditChain::class)->verify()['status']);
        $selected = app(GuestEmailCatalog::class)->selectedDocuments(['house-rules-policies']);
        $this->assertSame(DB::table('document_versions')->where('version', 2)->value('storage_path'), $selected[0]['path']);
    }

    public function test_document_validation_rejects_other_files_and_does_not_replace_active_version(): void
    {
        Storage::fake('local');
        $this->actingAs($this->account('owner'))->postJson('/api/owner/documents', [
            'key' => 'house-rules-policies', 'file' => UploadedFile::fake()->createWithContent('fake.pdf', 'not a PDF'),
        ])->assertUnprocessable();
        $this->postJson('/api/owner/documents', ['key' => 'unrecognized', 'file' => UploadedFile::fake()->create('file.pdf', 10241, 'application/pdf')])->assertUnprocessable();
        $this->assertDatabaseCount('document_versions', 0);
        $this->assertSame([], Storage::disk('local')->allFiles());
    }

    public function test_audit_trail_combines_real_history_and_owner_events_and_filters_them(): void
    {
        $owner = $this->account('owner');
        app(OwnerAudit::class)->record($owner, 'settings_updated', 'System Settings', 'Updated deposit.');
        app(OwnerAudit::class)->record($owner, 'admin_created', 'Admin Management', 'Created admin.');
        $this->actingAs($owner)->getJson('/api/owner/audit-trail')->assertOk()->assertJsonPath('total', 2);
        $this->getJson('/api/owner/audit-trail?search=DEPOSIT&module=System%20Settings&action=settings_updated&date='.now('Asia/Manila')->toDateString())
            ->assertOk()->assertJsonPath('total', 1)->assertJsonPath('data.0.user_name', $owner->name)->assertJsonPath('data.0.role', 'owner');
        $this->getJson('/api/owner/audit-trail?search=missing')->assertJsonPath('total', 0);
        $this->getJson('/api/owner/audit-trail?date=invalid')->assertUnprocessable();
        $start = now('Asia/Manila')->addDays(10);
        $reservationId = DB::table('reservations')->insertGetId([
            'booking_reference' => 'OWNER-AUDIT-FIXTURE', 'user_id' => $this->account('guest')->id, 'villa_id' => 1,
            'contact_name' => 'Guest', 'contact_email' => 'guest@example.test', 'contact_phone' => '09171234567',
            'type' => 'overnight', 'check_in_date' => $start->toDateString(), 'check_out_date' => $start->copy()->addDay()->toDateString(),
            'starts_at' => $start->toIso8601String(), 'ends_at' => $start->copy()->addDay()->toIso8601String(),
            'adults' => 2, 'inquiry_source' => 'Website', 'status' => 'confirmed', 'requested_at' => now(),
            'pricing_snapshot' => '{}', 'policy_snapshot' => '{}', 'created_at' => now(), 'updated_at' => now(),
        ]);
        app(ReservationWorkflow::class)->history($reservationId, 'payment_review', 'confirmed', $owner->id,
            'Verified original payment.', 'payment_approved');
        $this->getJson('/api/owner/audit-trail?module=Reservations&action=payment_approved')
            ->assertOk()->assertJsonPath('total', 1)->assertJsonPath('data.0.source', 'reservation_history');
    }

    public function test_audit_trail_paginates_five_rows_at_a_time(): void
    {
        $owner = $this->account('owner');
        foreach (range(1, 7) as $number) {
            app(OwnerAudit::class)->record($owner, 'pagination_event_'.$number, 'Audit Pagination', 'Audit event '.$number.'.');
        }

        $firstPage = $this->actingAs($owner)->getJson('/api/owner/audit-trail?module=Audit%20Pagination')
            ->assertOk()->assertJsonPath('current_page', 1)->assertJsonPath('last_page', 2)
            ->assertJsonPath('per_page', 5)->assertJsonPath('total', 7)->assertJsonCount(5, 'data');
        $secondPage = $this->getJson('/api/owner/audit-trail?module=Audit%20Pagination&page=2')
            ->assertOk()->assertJsonPath('current_page', 2)->assertJsonCount(2, 'data');

        $firstIds = collect($firstPage->json('data'))->pluck('id');
        $secondIds = collect($secondPage->json('data'))->pluck('id');
        $this->assertCount(0, $firstIds->intersect($secondIds));
    }

    public function test_backup_contains_operational_data_and_never_credentials(): void
    {
        $owner = $this->account('owner');
        $owner->forceFill(['remember_token' => 'SENSITIVE-REMEMBER-TOKEN', 'google_id' => 'PRIVATE-GOOGLE-ID'])->save();
        $settings = json_decode(DB::table('villas')->where('id', 1)->value('settings'), true);
        $settings['nested'] = ['api_token' => 'PRIVATE-NESTED-TOKEN', 'path' => 'private/documents/example.pdf', 'label' => 'Allowed metadata'];
        DB::table('villas')->where('id', 1)->update(['settings' => json_encode($settings)]);
        $response = $this->actingAs($owner)->get('/api/owner/database/backup')->assertOk()->assertDownload();
        $body = $response->streamedContent();
        $data = json_decode($body, true, flags: JSON_THROW_ON_ERROR);
        $this->assertSame('carlos-paradise-application-export', $data['format']);
        foreach (['reservations', 'payments', 'reservation_status_history', 'availability_blocks', 'admin_notifications', 'villas', 'audit_events'] as $table) $this->assertArrayHasKey($table, $data['tables']);
        foreach (['password', 'remember_token', 'google_id'] as $column) $this->assertArrayNotHasKey($column, $data['tables']['users'][0]);
        $this->assertStringNotContainsString('SENSITIVE-REMEMBER-TOKEN', $body);
        $this->assertStringNotContainsString('PRIVATE-GOOGLE-ID', $body);
        $this->assertStringNotContainsString($owner->password, $body);
        $this->assertStringNotContainsString('PRIVATE-NESTED-TOKEN', $body);
        $this->assertStringNotContainsString('private/documents/example.pdf', $body);
        $this->assertStringContainsString('Allowed metadata', $body);
        $this->assertArrayNotHasKey('google_calendar_connections', $data['tables']);
        $this->assertDatabaseHas('audit_events', ['action' => 'backup_downloaded']);
    }

    public function test_audit_date_filters_use_manila_dates_at_the_midnight_boundary(): void
    {
        $owner = $this->account('owner');
        $this->travelTo(\Carbon\CarbonImmutable::parse('2026-11-10T16:30:00+00:00'));
        app(OwnerAudit::class)->record($owner, 'settings_updated', 'System Settings', 'Midnight boundary fixture.');
        $this->travelBack();
        $this->actingAs($owner)->getJson('/api/owner/audit-trail?date=2026-11-11')->assertOk()->assertJsonPath('total', 1)
            ->assertJsonPath('data.0.occurred_at', '2026-11-11T00:30:00+08:00');
        $this->getJson('/api/owner/audit-trail?date=2026-11-10')->assertOk()->assertJsonPath('total', 0);
    }

    public function test_backup_validation_is_read_only_and_restore_is_explicitly_unsupported(): void
    {
        $this->actingAs($this->account('owner'));
        $count = DB::table('users')->count();
        $file = UploadedFile::fake()->createWithContent('backup.json', json_encode([
            'format' => 'carlos-paradise-application-export', 'version' => 1, 'tables' => ['roles' => [['id' => 1, 'name' => 'guest']]],
        ]));
        $this->postJson('/api/owner/database/validate', ['file' => $file])->assertOk()->assertJsonPath('restore_supported', false)->assertJsonPath('tables.roles', 1);
        $this->postJson('/api/owner/database/validate', ['file' => UploadedFile::fake()->createWithContent('bad.json', '{invalid')])->assertUnprocessable();
        $this->postJson('/api/owner/database/restore', [])->assertNotFound();
        $this->assertDatabaseCount('users', $count);
    }

    private function account(string $role, bool $active = true): User
    {
        return User::factory()->create(['role_id' => Role::where('name', $role)->value('id'), 'is_active' => $active, 'password' => 'OwnerPassword123']);
    }
}
