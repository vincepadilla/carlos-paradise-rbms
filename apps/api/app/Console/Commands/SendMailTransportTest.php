<?php

namespace App\Console\Commands;

use App\Mail\TransportTestMail;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Mail;
use Throwable;

class SendMailTransportTest extends Command
{
    protected $signature = 'mail:test {recipient : Explicit recipient email address}';

    protected $description = 'Send a synchronous test message through the configured mail transport';

    public function handle(): int
    {
        $recipient = trim((string) $this->argument('recipient'));
        if (! filter_var($recipient, FILTER_VALIDATE_EMAIL)) {
            $this->error('The recipient must be a valid email address.');

            return self::INVALID;
        }

        $mailer = (string) config('mail.default');
        if (in_array($mailer, ['array', 'log', 'null'], true)) {
            $this->error("The [{$mailer}] mailer is development-only and does not transmit email.");

            return self::FAILURE;
        }

        if ($mailer === 'smtp' && ! $this->smtpConfigurationIsReady()) {
            $this->error('SMTP configuration is incomplete or still contains example placeholders.');

            return self::FAILURE;
        }

        try {
            Mail::mailer($mailer)->to($recipient)->send(new TransportTestMail);
        } catch (Throwable $exception) {
            report($exception);
            $this->error('The mail transport rejected the test message. No success was recorded.');
            $this->line('Review storage/logs/laravel.log for the server-side error details.');

            return self::FAILURE;
        }

        $this->info("The [{$mailer}] transport accepted the test message for sending.");
        $this->line('This confirms transport acceptance only; it does not confirm inbox delivery or reading.');

        return self::SUCCESS;
    }

    private function smtpConfigurationIsReady(): bool
    {
        $values = [
            config('mail.mailers.smtp.host'),
            config('mail.mailers.smtp.username'),
            config('mail.mailers.smtp.password'),
            config('mail.from.address'),
        ];

        foreach ($values as $value) {
            if (! is_string($value) || trim($value) === '' || str_contains($value, 'your-')) {
                return false;
            }
        }

        return filter_var(config('mail.from.address'), FILTER_VALIDATE_EMAIL) !== false;
    }
}
