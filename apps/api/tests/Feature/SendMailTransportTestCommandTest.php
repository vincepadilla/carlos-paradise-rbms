<?php

namespace Tests\Feature;

use App\Mail\TransportTestMail;
use Illuminate\Support\Facades\Mail;
use Tests\TestCase;

class SendMailTransportTestCommandTest extends TestCase
{
    public function test_it_rejects_development_only_mailers(): void
    {
        config(['mail.default' => 'log']);

        $this->artisan('mail:test', ['recipient' => 'test@example.com'])
            ->expectsOutput('The [log] mailer is development-only and does not transmit email.')
            ->assertFailed();
    }

    public function test_it_reports_transport_acceptance_without_claiming_delivery(): void
    {
        config([
            'mail.default' => 'smtp',
            'mail.mailers.smtp.host' => 'smtp.example.com',
            'mail.mailers.smtp.username' => 'smtp-user',
            'mail.mailers.smtp.password' => 'smtp-password',
            'mail.from.address' => 'sender@example.com',
        ]);
        Mail::fake();

        $this->artisan('mail:test', ['recipient' => 'test@example.com'])
            ->expectsOutput('The [smtp] transport accepted the test message for sending.')
            ->expectsOutput('This confirms transport acceptance only; it does not confirm inbox delivery or reading.')
            ->assertSuccessful();

        Mail::assertSent(TransportTestMail::class, fn (TransportTestMail $mail) => $mail->hasTo('test@example.com'));
    }
}
