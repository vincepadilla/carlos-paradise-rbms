<?php

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Attachment;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

class OutgoingGuestMail extends Mailable
{
    use Queueable, SerializesModels;

    public function __construct(public object $record, public array $selectedAttachments) {}

    public function envelope(): Envelope
    {
        return new Envelope(subject: $this->record->subject);
    }

    public function content(): Content
    {
        return new Content(view: 'emails.guest-update');
    }

    public function attachments(): array
    {
        return collect($this->selectedAttachments)->map(
            fn (array $document) => Attachment::fromStorageDisk($document['disk'], $document['path'])
                ->as($document['label'])
        )->all();
    }
}
