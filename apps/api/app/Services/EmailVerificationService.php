<?php

namespace App\Services;

use App\Jobs\SendEmailVerificationCode;
use App\Models\EmailVerificationCode;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Symfony\Component\HttpKernel\Exception\HttpException;

class EmailVerificationService
{
    public const PURPOSE = 'guest_registration';

    public const LIFETIME_SECONDS = 300;

    public const RESEND_COOLDOWN_SECONDS = 60;

    public const SESSION_KEY = 'pending_email_verification';

    public function beginPending(Request $request, User $user, bool $forceNewCode = true): array
    {
        $this->ensureEligiblePendingGuest($user);
        $verification = $this->issue($user, $forceNewCode);

        $request->session()->put(self::SESSION_KEY, [
            'token' => $verification['token'],
            'user_id' => (int) $user->id,
        ]);

        unset($verification['token']);

        return $verification;
    }

    public function pendingStatus(Request $request): array
    {
        [$token, $userId] = $this->pendingCredentials($request);
        $verification = $this->findByToken($token, false, $userId);
        $this->ensureEligiblePendingGuest($verification->user);

        return $this->publicPayload($verification);
    }

    public function resendPending(Request $request): array
    {
        [$token, $userId] = $this->pendingCredentials($request);
        $verification = $this->resend($token, $userId);

        $request->session()->put(self::SESSION_KEY, [
            'token' => $verification['token'],
            'user_id' => $userId,
        ]);

        unset($verification['token']);

        return $verification;
    }

    public function verifyPending(Request $request, string $code): User
    {
        [$token, $userId] = $this->pendingCredentials($request);

        return $this->verify($token, $code, $userId);
    }

    public function clearPending(Request $request): void
    {
        $request->session()->forget(self::SESSION_KEY);
    }

    public function issue(User $user, bool $forceNewCode = true): array
    {
        $plainToken = $this->newAccessToken();
        $plainCode = null;

        $verification = DB::transaction(function () use ($user, $forceNewCode, $plainToken, &$plainCode) {
            $verification = EmailVerificationCode::query()
                ->where('user_id', $user->id)
                ->where('purpose', self::PURPOSE)
                ->lockForUpdate()
                ->first();

            $needsCode = $forceNewCode || ! $verification || $verification->expires_at->isPast() || $verification->consumed_at;

            if (! $needsCode) {
                $verification->update(['access_token_hash' => hash('sha256', $plainToken)]);

                return $verification->fresh();
            }

            $plainCode = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
            $values = [
                'access_token_hash' => hash('sha256', $plainToken),
                'code_hash' => Hash::make($plainCode),
                'generation' => (string) Str::uuid(),
                'attempts' => 0,
                'max_attempts' => 5,
                'delivery_status' => 'queued',
                'last_sent_at' => null,
                'expires_at' => now()->addSeconds(self::LIFETIME_SECONDS),
                'resend_available_at' => now()->addSeconds(self::RESEND_COOLDOWN_SECONDS),
                'consumed_at' => null,
            ];

            if ($verification) {
                $verification->update($values);

                return $verification->fresh();
            }

            return EmailVerificationCode::create($values + [
                'user_id' => $user->id,
                'purpose' => self::PURPOSE,
            ]);
        }, 3);

        if ($plainCode !== null) {
            $this->dispatch($verification, $plainCode);
        }

        return $this->payload($verification->fresh(), $plainToken);
    }

    public function resume(User $user): array
    {
        return $this->issue($user, false);
    }

    private function resend(string $plainToken, int $expectedUserId): array
    {
        $newToken = $this->newAccessToken();
        $plainCode = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);

        $verification = DB::transaction(function () use ($plainToken, $expectedUserId, $newToken, $plainCode) {
            $current = $this->findByToken($plainToken, true, $expectedUserId);
            $this->ensureEligiblePendingGuest($current->user);

            if ($current->consumed_at || $current->user->email_verified_at) {
                throw new HttpException(409, 'This verification code has already been used.');
            }
            if ($current->resend_available_at->isFuture()) {
                throw new HttpException(429, 'Please wait before requesting another code.', null, [
                    'Retry-After' => (string) now()->diffInSeconds($current->resend_available_at),
                ]);
            }

            $current->update([
                'access_token_hash' => hash('sha256', $newToken),
                'code_hash' => Hash::make($plainCode),
                'generation' => (string) Str::uuid(),
                'attempts' => 0,
                'delivery_status' => 'queued',
                'last_sent_at' => null,
                'expires_at' => now()->addSeconds(self::LIFETIME_SECONDS),
                'resend_available_at' => now()->addSeconds(self::RESEND_COOLDOWN_SECONDS),
                'consumed_at' => null,
            ]);

            return $current->fresh();
        }, 3);

        $this->dispatch($verification, $plainCode);

        return $this->payload($verification->fresh(), $newToken);
    }

    private function verify(string $plainToken, string $code, int $expectedUserId): User
    {
        $result = DB::transaction(function () use ($plainToken, $code, $expectedUserId) {
            $verification = $this->findByToken($plainToken, true, $expectedUserId);
            $user = User::query()->with('role')->lockForUpdate()->find($verification->user_id);

            if (! $user || ! $user->is_active || $user->role?->name !== 'guest') {
                return [null, 403, 'This account is not eligible for guest verification.'];
            }
            if ($verification->consumed_at || $user->email_verified_at) {
                return [null, 409, 'This verification code has already been used.'];
            }
            if ($verification->expires_at->isPast()) {
                return [null, 410, 'This verification code has expired. Request a new code.'];
            }
            if ($verification->attempts >= $verification->max_attempts) {
                return [null, 429, 'Too many incorrect attempts. Request a new code.'];
            }

            if (! Hash::check($code, $verification->code_hash)) {
                $attempts = $verification->attempts + 1;
                $verification->update(['attempts' => $attempts]);

                return $attempts >= $verification->max_attempts
                    ? [null, 429, 'Too many incorrect attempts. Request a new code.']
                    : [null, 422, 'The verification code is incorrect.'];
            }

            $now = now();
            $user->forceFill(['email_verified_at' => $now])->save();
            $verification->update(['consumed_at' => $now]);

            return [$user->fresh('role'), null, null];
        }, 3);

        if (! $result[0]) {
            throw new HttpException($result[1], $result[2]);
        }

        return $result[0];
    }

    private function pendingCredentials(Request $request): array
    {
        $pending = $request->session()->get(self::SESSION_KEY);
        if (! is_array($pending) || ! is_string($pending['token'] ?? null) || ! is_int($pending['user_id'] ?? null)) {
            throw new HttpException(404, 'Verification session not found.');
        }

        return [$pending['token'], $pending['user_id']];
    }

    private function findByToken(string $plainToken, bool $lock = false, ?int $expectedUserId = null): EmailVerificationCode
    {
        $query = EmailVerificationCode::query()
            ->with('user.role')
            ->where('purpose', self::PURPOSE)
            ->where('access_token_hash', hash('sha256', $plainToken));
        if ($expectedUserId !== null) {
            $query->where('user_id', $expectedUserId);
        }
        if ($lock) {
            $query->lockForUpdate();
        }

        $verification = $query->first();
        if (! $verification) {
            throw new HttpException(404, 'Verification request not found.');
        }

        return $verification;
    }

    private function ensureEligiblePendingGuest(User $user): void
    {
        $user->loadMissing('role');
        if (! $user->is_active || $user->role?->name !== 'guest') {
            throw new HttpException(403, 'This account is not eligible for guest verification.');
        }
        if ($user->email_verified_at) {
            throw new HttpException(409, 'This email address is already verified.');
        }
    }

    private function dispatch(EmailVerificationCode $verification, string $plainCode): void
    {
        try {
            SendEmailVerificationCode::dispatch(
                $verification->id,
                $verification->generation,
                Crypt::encryptString($plainCode),
            );
        } catch (\Throwable) {
            $verification->update(['delivery_status' => 'failed']);
        }
    }

    private function payload(EmailVerificationCode $verification, string $plainToken): array
    {
        return ['token' => $plainToken] + $this->publicPayload($verification);
    }

    private function publicPayload(EmailVerificationCode $verification): array
    {
        return [
            'masked_email' => $this->maskEmail($verification->user->email),
            'expires_at' => $verification->expires_at->toIso8601String(),
            'resend_available_at' => $verification->resend_available_at->toIso8601String(),
            'delivery_status' => $verification->delivery_status,
        ];
    }

    private function newAccessToken(): string
    {
        return rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
    }

    private function maskEmail(string $email): string
    {
        [$local, $domain] = explode('@', $email, 2);
        $visible = mb_substr($local, 0, min(2, mb_strlen($local)));

        return $visible.str_repeat('•', max(3, mb_strlen($local) - mb_strlen($visible))).'@'.$domain;
    }
}
