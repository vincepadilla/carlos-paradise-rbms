<?php

namespace App\Services;

use App\Jobs\SendEmailVerificationCode;
use App\Models\EmailVerificationCode;
use App\Models\User;
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

    public function resend(string $plainToken): array
    {
        $newToken = $this->newAccessToken();
        $plainCode = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);

        $verification = DB::transaction(function () use ($plainToken, $newToken, $plainCode) {
            $current = $this->findByToken($plainToken, true);
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

    public function verify(string $plainToken, string $code): User
    {
        $result = DB::transaction(function () use ($plainToken, $code) {
            $verification = $this->findByToken($plainToken, true);

            if ($verification->consumed_at || $verification->user->email_verified_at) {
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
            $verification->user->forceFill(['email_verified_at' => $now])->save();
            $verification->update(['consumed_at' => $now]);

            return [$verification->user->fresh(), null, null];
        }, 3);

        if (! $result[0]) throw new HttpException($result[1], $result[2]);
        return $result[0];
    }

    public function status(string $plainToken): array
    {
        return $this->payload($this->findByToken($plainToken), $plainToken);
    }

    private function findByToken(string $plainToken, bool $lock = false): EmailVerificationCode
    {
        $query = EmailVerificationCode::query()
            ->with('user')
            ->where('purpose', self::PURPOSE)
            ->where('access_token_hash', hash('sha256', $plainToken));
        if ($lock) $query->lockForUpdate();

        $verification = $query->first();
        if (! $verification) throw new HttpException(404, 'Verification request not found.');
        return $verification;
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
        return [
            'token' => $plainToken,
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
