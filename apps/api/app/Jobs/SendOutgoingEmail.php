<?php

namespace App\Jobs;

use App\Mail\OutgoingGuestMail;
use App\Services\GuestEmailCatalog;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Throwable;

class SendOutgoingEmail implements ShouldQueue
{
    use Queueable;

    public int $tries = 1;

    public function __construct(public int $outgoingEmailId) {}

    public function handle(GuestEmailCatalog $catalog): void
    {
        $record = DB::transaction(function () {
            $record = DB::table('outgoing_emails')->where('id', $this->outgoingEmailId)->lockForUpdate()->first();
            if (! $record || in_array($record->status, ['sent', 'failed'], true) || $record->processing_at) {
                return null;
            }

            $now = now('Asia/Manila')->toIso8601String();
            DB::table('outgoing_emails')->where('id', $record->id)->update([
                'status' => 'queued',
                'processing_at' => $now,
                'queued_at' => $record->queued_at ?? $now,
                'updated_at' => now('Asia/Manila')->format('Y-m-d H:i:s'),
            ]);

            return DB::table('outgoing_emails')->where('id', $record->id)->first();
        });

        if (! $record) {
            return;
        }

        try {
            if (! $catalog->transportConfigured()) {
                throw new \RuntimeException('Mail transport is not configured for external delivery.');
            }
            $attachments = json_decode($record->attachments ?? '[]', true);
            Mail::to($record->recipient_email, $record->recipient_name)
                ->send(new OutgoingGuestMail($record, is_array($attachments) ? $attachments : []));

            DB::table('outgoing_emails')->where('id', $record->id)->update([
                'status' => 'sent',
                'sent_at' => now('Asia/Manila')->toIso8601String(),
                'failure_message' => null,
                'updated_at' => now('Asia/Manila')->format('Y-m-d H:i:s'),
            ]);
        } catch (Throwable $exception) {
            Log::error('Outgoing email transport failed.', [
                'outgoing_email_id' => $record->id,
                'exception' => $exception,
            ]);
            DB::table('outgoing_emails')->where('id', $record->id)->update([
                'status' => 'failed',
                'failed_at' => now('Asia/Manila')->toIso8601String(),
                'failure_message' => 'Mail transport rejected the message. Check server logs for details.',
                'updated_at' => now('Asia/Manila')->format('Y-m-d H:i:s'),
            ]);
        }
    }
}
