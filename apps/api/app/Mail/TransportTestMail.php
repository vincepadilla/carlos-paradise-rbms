<?php

namespace App\Mail;

use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;

class TransportTestMail extends Mailable
{
    public function envelope(): Envelope
    {
        return new Envelope(subject: 'Carlos Paradise mail transport test');
    }

    public function content(): Content
    {
        return new Content(
            htmlString: '<p>This is a mail transport test from Carlos Paradise.</p>'
                .'<p>No guest or reservation data is included.</p>',
        );
    }
}
