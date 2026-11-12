<?php

namespace Tests\Feature;

use App\Jobs\SendEmailVerificationCode;
use App\Mail\EmailVerificationCodeMail;
use App\Models\EmailVerificationCode;
use App\Models\User;
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

    public function test_registration_creates_no_session_and_code_can_be_verified_once(): void
    {
        Queue::fake();
        Http::fake(['google.com/recaptcha/*' => Http::response(['success' => true])]);

        $response = $this->postJson('/api/register', $this->registrationPayload());

        $response->assertCreated()
            ->assertJsonPath('verification.masked_email', 'gu•••@example.com')
            ->assertJsonMissingPath('user.id')
            ->assertJsonMissingPath('verification.code');
        $expiry = CarbonImmutable::parse($response->json('verification.expires_at'));
        $this->assertSame('+08:00', $expiry->format('P'));
        $this->assertEqualsWithDelta(300, now()->diffInSeconds($expiry), 2);
        $this->assertGuest('web');

        $user = User::where('email', 'guest@example.com')->firstOrFail();
        $this->assertNull($user->email_verified_at);
        $record = EmailVerificationCode::where('user_id', $user->id)->firstOrFail();

        $job = null;
        Queue::assertPushed(SendEmailVerificationCode::class, function ($queued) use (&$job) {
            $job = $queued;
            return true;
        });
        $code = Crypt::decryptString($job->encryptedCode);
        $this->assertSame(6, strlen($code));
        $this->assertMatchesRegularExpression('/^[0-9]{6}$/', $code);
        $this->assertNotSame($code, $record->code_hash);
        $this->assertTrue(Hash::check($code, $record->code_hash));

        $token = $response->json('verification.token');
        $this->postJson('/api/email-verification/verify', ['token' => $token, 'code' => $code])
            ->assertOk();
        $this->assertNotNull($user->fresh()->email_verified_at);
        $this->postJson('/api/email-verification/verify', ['token' => $token, 'code' => $code])
            ->assertStatus(409);
    }

    public function test_unverified_login_resumes_without_authenticating_and_protected_routes_reject_it(): void
    {
        Queue::fake();
        Http::fake(['google.com/recaptcha/*' => Http::response(['success' => true])]);
        $registration = $this->postJson('/api/register', $this->registrationPayload())->assertCreated();

        $login = $this->postJson('/auth/login', [
            'email' => 'guest@example.com',
            'password' => 'password123',
            'remember' => false,
            'captcha_token' => 'valid-token',
        ]);

        $login->assertStatus(409)->assertJsonPath('message', 'Email verification is required.');
        $this->assertNotSame($registration->json('verification.token'), $login->json('verification.token'));
        $this->assertGuest('web');

        $user = User::where('email', 'guest@example.com')->firstOrFail();
        $this->actingAs($user, 'web')->getJson('/api/profile')->assertForbidden();
    }

    public function test_resend_cooldown_rotates_code_and_stale_job_does_not_send(): void
    {
        Queue::fake();
        Http::fake(['google.com/recaptcha/*' => Http::response(['success' => true])]);
        $registration = $this->postJson('/api/register', $this->registrationPayload())->assertCreated();
        $oldToken = $registration->json('verification.token');

        $jobs = [];
        Queue::assertPushed(SendEmailVerificationCode::class, function ($job) use (&$jobs) {
            $jobs[] = $job;
            return true;
        });
        $oldJob = $jobs[0];
        $oldCode = Crypt::decryptString($oldJob->encryptedCode);

        $this->postJson('/api/email-verification/resend', ['token' => $oldToken])->assertStatus(429);
        $this->travel(61)->seconds();
        $resend = $this->postJson('/api/email-verification/resend', ['token' => $oldToken])->assertOk();
        $newToken = $resend->json('verification.token');

        $jobs = [];
        Queue::assertPushed(SendEmailVerificationCode::class, function ($job) use (&$jobs) {
            $jobs[] = $job;
            return true;
        });
        $newJob = $jobs[array_key_last($jobs)];
        $newCode = Crypt::decryptString($newJob->encryptedCode);

        Mail::fake();
        $oldJob->handle();
        Mail::assertNothingSent();
        $newJob->handle();
        Mail::assertSent(EmailVerificationCodeMail::class);

        $this->postJson('/api/email-verification/verify', ['token' => $newToken, 'code' => $oldCode])
            ->assertUnprocessable();
        $this->postJson('/api/email-verification/verify', ['token' => $newToken, 'code' => $newCode])
            ->assertOk();
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
