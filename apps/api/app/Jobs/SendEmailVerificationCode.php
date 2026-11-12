<?php

namespace App\Jobs;

use App\Mail\EmailVerificationCodeMail;
use App\Models\EmailVerificationCode;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Log;
use Throwable;

class SendEmailVerificationCode implements ShouldQueue
{
    use Queueable;

    public int $tries = 1;

    public function __construct(
        public int $verificationId,
        public string $generation,
        public string $encryptedCode,
    ) {}

    public function handle(): void
    {
        try {
            DB::transaction(function () {
                $verification = EmailVerificationCode::query()
                    ->with('user')
                    ->whereKey($this->verificationId)
                    ->lockForUpdate()
                    ->first();

                if (! $verification ||
                    $verification->generation !== $this->generation ||
                    $verification->consumed_at ||
                    $verification->expires_at->isPast() ||
                    $verification->user->email_verified_at) {
                    return;
                }

                $code = Crypt::decryptString($this->encryptedCode);
                Mail::to($verification->user->email, $verification->user->name)
                    ->send(new EmailVerificationCodeMail($code));

                $verification->update([
                    'delivery_status' => 'sent',
                    'last_sent_at' => now(),
                ]);
            }, 3);
        } catch (Throwable $exception) {
            EmailVerificationCode::query()
                ->whereKey($this->verificationId)
                ->where('generation', $this->generation)
                ->whereNull('consumed_at')
                ->update(['delivery_status' => 'failed', 'updated_at' => now()]);

            Log::warning('Email verification delivery failed.', [
                'verification_id' => $this->verificationId,
                'exception_type' => $exception::class,
            ]);
        }
    }
}
