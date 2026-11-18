<?php

namespace Tests\Feature;

use App\Jobs\SendEmailVerificationCode;
use App\Mail\EmailVerificationCodeMail;
use App\Models\EmailVerificationCode;
use App\Models\User;
use App\Services\EmailVerificationService;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Queue;
use Tests\TestCase;

class EmailVerificationTest extends TestCase
{
    use RefreshDatabase;

    public function test_registration_verification_signs_guest_in_regenerates_session_and_logout_persists(): void
    {
        [$response, $code] = $this->registerAndCaptureCode();

        $response->assertCreated()
            ->assertJsonPath('verification.masked_email', 'gu•••@example.com')
            ->assertJsonMissingPath('user.id')
            ->assertJsonMissingPath('verification.code')
            ->assertJsonMissingPath('verification.token');

        $expiry = CarbonImmutable::parse($response->json('verification.expires_at'));
        $this->assertSame('+08:00', $expiry->format('P'));
        $this->assertEqualsWithDelta(300, now()->diffInSeconds($expiry), 2);
        $this->assertGuest('web');

        $user = User::where('email', 'guest@example.com')->firstOrFail();
        $this->assertNull($user->email_verified_at);
        $record = EmailVerificationCode::where('user_id', $user->id)->firstOrFail();
        $this->assertTrue(Hash::check($code, $record->code_hash));

        $pending = $this->app['session']->get(EmailVerificationService::SESSION_KEY);
        $this->assertIsArray($pending);
        $this->assertSame($user->id, $pending['user_id']);
        $restrictedSessionId = $this->app['session']->getId();

        $this->postJson('/api/email-verification/verify', ['code' => $code])
            ->assertOk()
            ->assertJsonPath('verified', true);

        $this->assertAuthenticatedAs($user->fresh(), 'web');
        $this->assertNotNull($user->fresh()->email_verified_at);
        $this->assertNotSame($restrictedSessionId, $this->app['session']->getId());
        $this->assertNull($this->app['session']->get(EmailVerificationService::SESSION_KEY));

        // Consecutive session checks represent redirect confirmation and refresh persistence.
        $this->getJson('/auth/user')->assertOk()
            ->assertJsonPath('user.name', 'Guest User')
            ->assertJsonPath('user.role', 'guest');
        $this->getJson('/auth/user')->assertOk()->assertJsonPath('user.id', $user->id);

        $this->postJson('/auth/logout')->assertNoContent();
        $this->getJson('/auth/user')->assertUnauthorized();
    }

    public function test_expired_and_incorrect_codes_attempt_limit_and_replay_are_rejected(): void
    {
        [$registration, $code] = $this->registerAndCaptureCode();
        $user = User::where('email', 'guest@example.com')->firstOrFail();
        $pending = $this->app['session']->get(EmailVerificationService::SESSION_KEY);
        $wrongCode = $code === '000000' ? '111111' : '000000';

        for ($attempt = 1; $attempt <= 4; $attempt++) {
            $this->postJson('/api/email-verification/verify', ['code' => $wrongCode])
                ->assertUnprocessable();
        }
        $this->postJson('/api/email-verification/verify', ['code' => $wrongCode])
            ->assertStatus(429);
        $this->postJson('/api/email-verification/verify', ['code' => $code])
            ->assertStatus(429);
        $this->assertGuest('web');
        $this->assertNull($user->fresh()->email_verified_at);

        $this->travel(61)->seconds();
        Queue::fake();
        $this->postJson('/api/email-verification/resend')->assertOk();
        $newJob = null;
        Queue::assertPushed(SendEmailVerificationCode::class, function ($job) use (&$newJob) {
            $newJob = $job;

            return true;
        });
        $newCode = Crypt::decryptString($newJob->encryptedCode);
        $replayPending = $this->app['session']->get(EmailVerificationService::SESSION_KEY);

        $this->postJson('/api/email-verification/verify', ['code' => $newCode])->assertOk();
        $this->postJson('/auth/logout')->assertNoContent();

        $this->withSession([EmailVerificationService::SESSION_KEY => $replayPending])
            ->postJson('/api/email-verification/verify', ['code' => $newCode])
            ->assertStatus(409);
        $this->assertGuest('web');

        // A separate pending account verifies expiration independently.
        $second = $this->registrationPayload();
        $second['email'] = 'expired@example.com';
        Queue::fake();
        $this->postJson('/api/register', $second)->assertCreated();
        $expiredJob = null;
        Queue::assertPushed(SendEmailVerificationCode::class, function ($job) use (&$expiredJob) {
            $expiredJob = $job;

            return true;
        });
        $expiredCode = Crypt::decryptString($expiredJob->encryptedCode);
        $this->travel(301)->seconds();
        $this->postJson('/api/email-verification/verify', ['code' => $expiredCode])
            ->assertStatus(410);
        $this->assertNull(User::where('email', 'expired@example.com')->firstOrFail()->email_verified_at);
        $this->assertGuest('web');
    }

    public function test_pending_session_selects_account_and_ineligible_account_is_not_authenticated(): void
    {
        [$registration, $code] = $this->registerAndCaptureCode();
        $pendingUser = User::where('email', 'guest@example.com')->firstOrFail();
        $other = User::factory()->create(['email_verified_at' => null]);

        // A client-supplied ID is ignored; the server-side pending session selects the account.
        $this->postJson('/api/email-verification/verify', [
            'code' => $code,
            'user_id' => $other->id,
        ])->assertOk();
        $this->assertAuthenticatedAs($pendingUser->fresh(), 'web');
        $this->assertNull($other->fresh()->email_verified_at);
        $this->postJson('/auth/logout')->assertNoContent();

        $payload = $this->registrationPayload();
        $payload['email'] = 'disabled@example.com';
        Queue::fake();
        $this->postJson('/api/register', $payload)->assertCreated();
        $disabledJob = null;
        Queue::assertPushed(SendEmailVerificationCode::class, function ($job) use (&$disabledJob) {
            $disabledJob = $job;

            return true;
        });
        $disabledCode = Crypt::decryptString($disabledJob->encryptedCode);
        $disabled = User::where('email', 'disabled@example.com')->firstOrFail();
        $disabled->forceFill(['is_active' => false])->save();

        $this->postJson('/api/email-verification/verify', ['code' => $disabledCode])
            ->assertForbidden();
        $this->assertNull($disabled->fresh()->email_verified_at);
        $this->assertGuest('web');
    }

    public function test_unverified_login_resumes_restricted_session_without_authenticating(): void
    {
        [$registration] = $this->registerAndCaptureCode();

        Http::fake(['google.com/recaptcha/*' => Http::response(['success' => true])]);
        $login = $this->postJson('/auth/login', [
            'email' => 'guest@example.com',
            'password' => 'password123',
            'remember' => false,
            'captcha_token' => 'valid-token',
        ]);

        $login->assertStatus(409)
            ->assertJsonPath('message', 'Email verification is required.')
            ->assertJsonMissingPath('verification.token');
        $this->assertGuest('web');
        $this->assertIsArray($this->app['session']->get(EmailVerificationService::SESSION_KEY));

        $user = User::where('email', 'guest@example.com')->firstOrFail();
        $this->actingAs($user, 'web')->getJson('/api/profile')->assertForbidden();
    }

    public function test_resend_rotates_code_and_stale_delivery_job_does_not_send(): void
    {
        [$registration, $oldCode, $oldJob] = $this->registerAndCaptureCode();

        $this->postJson('/api/email-verification/resend')->assertStatus(429);
        $this->travel(61)->seconds();
        Queue::fake();
        $this->postJson('/api/email-verification/resend')
            ->assertOk()
            ->assertJsonMissingPath('verification.token');

        $newJob = null;
        Queue::assertPushed(SendEmailVerificationCode::class, function ($job) use (&$newJob) {
            $newJob = $job;

            return true;
        });
        $newCode = Crypt::decryptString($newJob->encryptedCode);

        Mail::fake();
        $oldJob->handle();
        Mail::assertNothingSent();
        $newJob->handle();
        Mail::assertSent(EmailVerificationCodeMail::class);

        $this->postJson('/api/email-verification/verify', ['code' => $oldCode])
            ->assertUnprocessable();
        $this->postJson('/api/email-verification/verify', ['code' => $newCode])
            ->assertOk();
        $this->assertAuthenticated('web');
    }

    private function registerAndCaptureCode(): array
    {
        Queue::fake();
        Http::fake(['google.com/recaptcha/*' => Http::response(['success' => true])]);

        $response = $this->postJson('/api/register', $this->registrationPayload());
        $job = null;
        Queue::assertPushed(SendEmailVerificationCode::class, function ($queued) use (&$job) {
            $job = $queued;

            return true;
        });

        return [$response, Crypt::decryptString($job->encryptedCode), $job];
    }

    private function registrationPayload(): array
    {
        return [
            'name' => 'Guest User',
            'email' => 'guest@example.com',
            'phone' => '09123456789',
            'terms' => true,
            'captcha_token' => 'valid-token',
            'password' => 'password123',
            'password_confirmation' => 'password123',
        ];
    }
}
