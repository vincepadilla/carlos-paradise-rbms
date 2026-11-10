<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Jobs\SendOutgoingEmail;
use App\Services\GuestEmailCatalog;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Validation\Rule;
use Throwable;

class AdminOutgoingEmailsController extends Controller
{
    public function options(GuestEmailCatalog $catalog): JsonResponse
    {
        return response()->json([
            'categories' => $catalog->categories(),
            'documents' => collect($catalog->documents())->map(fn (array $document) => [
                'key' => $document['key'], 'label' => $document['label'],
            ])->values(),
        ]);
    }

    public function recipients(Request $request): JsonResponse
    {
        $data = $request->validate(['q' => ['sometimes', 'nullable', 'string', 'max:100']]);
        $search = trim((string) ($data['q'] ?? ''));
        $query = DB::table('reservations as r')->join('users as u', 'u.id', '=', 'r.user_id')
            ->where('u.is_active', true)
            ->orderByDesc('r.requested_at')->orderByDesc('r.id');

        if ($search !== '') {
            $like = '%'.mb_strtolower($search).'%';
            $query->where(function ($where) use ($like) {
                $where->whereRaw('LOWER(r.contact_name) LIKE ?', [$like])
                    ->orWhereRaw('LOWER(r.contact_email) LIKE ?', [$like])
                    ->orWhereRaw('LOWER(u.name) LIKE ?', [$like])
                    ->orWhereRaw('LOWER(u.email) LIKE ?', [$like])
                    ->orWhereRaw('LOWER(r.booking_reference) LIKE ?', [$like]);
            });
        }

        return response()->json(['recipients' => $query->limit(20)->get([
            'r.id as reservation_id', 'r.user_id as recipient_user_id',
            'r.contact_name as name', 'r.contact_email as email',
            'r.booking_reference as reservation_reference', 'r.check_in_date', 'r.starts_at',
        ])]);
    }

    public function send(Request $request, GuestEmailCatalog $catalog): JsonResponse
    {
        return $this->submit($request, $catalog, false);
    }

    public function schedule(Request $request, GuestEmailCatalog $catalog): JsonResponse
    {
        return $this->submit($request, $catalog, true);
    }

    private function submit(Request $request, GuestEmailCatalog $catalog, bool $scheduled): JsonResponse
    {
        $rules = [
            'reservation_id' => ['required', 'integer', 'min:1'],
            'category' => ['required', Rule::in(array_keys(GuestEmailCatalog::CATEGORIES))],
            'subject' => ['required', 'string', 'max:200'],
            'message' => ['required', 'string', 'max:10000'],
            'attachments' => ['sometimes', 'array', 'max:10'],
            'attachments.*' => ['string', 'distinct', 'max:80'],
            'idempotency_key' => ['required', 'uuid'],
        ];
        if ($scheduled) {
            $rules['scheduled_for'] = ['required', 'date', 'after:now'];
        }
        $data = $request->validate($rules);
        $reservation = DB::table('reservations as r')->join('users as u', 'u.id', '=', 'r.user_id')
            ->where('r.id', $data['reservation_id'])->where('u.is_active', true)
            ->first(['r.id', 'r.user_id', 'r.booking_reference', 'r.contact_name', 'r.contact_email']);
        abort_unless($reservation, 422, 'The selected reservation recipient is unavailable.');

        $attachments = $catalog->selectedDocuments($data['attachments'] ?? []);
        $now = now('Asia/Manila');
        $scheduledFor = $scheduled
            ? CarbonImmutable::parse($data['scheduled_for'])->setTimezone('Asia/Manila')
            : null;
        $inserted = DB::table('outgoing_emails')->insertOrIgnore([
            'idempotency_key' => $data['idempotency_key'],
            'sender_id' => $request->user()->id,
            'recipient_user_id' => $reservation->user_id,
            'reservation_id' => $reservation->id,
            'recipient_name' => $reservation->contact_name,
            'recipient_email' => $reservation->contact_email,
            'category' => $data['category'],
            'subject' => trim($data['subject']),
            'message' => trim($data['message']),
            'attachments' => json_encode($attachments, JSON_THROW_ON_ERROR),
            'status' => $scheduled ? 'scheduled' : 'queued',
            'scheduled_for' => $scheduledFor?->toIso8601String(),
            'queued_at' => $scheduled ? null : $now->toIso8601String(),
            'created_at' => $now->format('Y-m-d H:i:s'),
            'updated_at' => $now->format('Y-m-d H:i:s'),
        ]);
        $record = DB::table('outgoing_emails')->where('sender_id', $request->user()->id)
            ->where('idempotency_key', $data['idempotency_key'])->first();
        abort_unless($record, 500, 'The outgoing email could not be recorded.');

        return $this->dispatchRecorded($record, $inserted === 1, $scheduled, $catalog);
    }

    private function dispatchRecorded(object $record, bool $created, bool $scheduled, GuestEmailCatalog $catalog): JsonResponse
    {
        if ($created && ! $scheduled && ! $catalog->transportConfigured()) {
            $this->fail($record->id, 'Mail transport is not configured for external delivery.');
        } elseif ($created) {
            try {
                $dispatch = SendOutgoingEmail::dispatch($record->id);
                if ($scheduled && $record->scheduled_for) {
                    $dispatch->delay(CarbonImmutable::parse($record->scheduled_for));
                }
            } catch (Throwable $exception) {
                Log::error('Outgoing email could not be queued.', [
                    'outgoing_email_id' => $record->id,
                    'exception' => $exception,
                ]);
                $this->fail($record->id, 'The email queue is unavailable. Check server logs for details.');
            }
        }

        $record = DB::table('outgoing_emails')->where('id', $record->id)->first();
        if ($record->status === 'failed') {
            return response()->json([
                'message' => $record->failure_message,
                'email' => $this->present($record, true),
            ], 503);
        }

        return response()->json(['email' => $this->present($record, true)], $created ? 201 : 200);
    }

    private function fail(int $id, string $message): void
    {
        DB::table('outgoing_emails')->where('id', $id)->update([
            'status' => 'failed',
            'failed_at' => now('Asia/Manila')->toIso8601String(),
            'failure_message' => mb_substr($message, 0, 1000),
            'updated_at' => now('Asia/Manila')->format('Y-m-d H:i:s'),
        ]);
    }

    public function index(Request $request): JsonResponse
    {
        $data = $request->validate([
            'page' => ['sometimes', 'integer', 'min:1'],
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:50'],
        ]);
        $page = DB::table('outgoing_emails as email')
            ->join('users as sender', 'sender.id', '=', 'email.sender_id')
            ->join('reservations as reservation', 'reservation.id', '=', 'email.reservation_id')
            ->orderByDesc('email.created_at')->orderByDesc('email.id')
            ->select(['email.*', 'sender.name as sender_name', 'sender.email as sender_email',
                'reservation.booking_reference'])
            ->paginate($data['per_page'] ?? 20);
        $page->through(fn (object $record) => $this->present($record, false));

        return response()->json($page);
    }

    public function show(int $outgoingEmail): JsonResponse
    {
        $record = DB::table('outgoing_emails as email')
            ->join('users as sender', 'sender.id', '=', 'email.sender_id')
            ->join('reservations as reservation', 'reservation.id', '=', 'email.reservation_id')
            ->where('email.id', $outgoingEmail)
            ->first(['email.*', 'sender.name as sender_name', 'sender.email as sender_email',
                'reservation.booking_reference']);
        abort_unless($record, 404, 'Outgoing email not found.');

        return response()->json(['email' => $this->present($record, true)]);
    }

    private function present(object $record, bool $detail): array
    {
        $attachments = json_decode($record->attachments ?? '[]', true);
        $senderName = $record->sender_name ?? DB::table('users')->where('id', $record->sender_id)->value('name');
        $senderEmail = $record->sender_email ?? DB::table('users')->where('id', $record->sender_id)->value('email');
        $reference = $record->booking_reference ?? DB::table('reservations')
            ->where('id', $record->reservation_id)->value('booking_reference');
        $result = [
            'id' => $record->id,
            'recipient_name' => $record->recipient_name,
            'recipient_email' => $record->recipient_email,
            'reservation_id' => $record->reservation_id,
            'reservation_reference' => $reference,
            'category' => $record->category,
            'category_label' => GuestEmailCatalog::CATEGORIES[$record->category] ?? $record->category,
            'subject' => $record->subject,
            'status' => $record->status,
            'scheduled_for' => $this->timestamp($record->scheduled_for),
            'queued_at' => $this->timestamp($record->queued_at),
            'sent_at' => $this->timestamp($record->sent_at),
            'failed_at' => $this->timestamp($record->failed_at),
            'created_at' => $this->timestamp($record->created_at),
        ];

        if ($detail) {
            $result += [
                'message' => $record->message,
                'sender_name' => $senderName,
                'sender_email' => $senderEmail,
                'attachments' => collect(is_array($attachments) ? $attachments : [])->map(fn ($item) => [
                    'key' => $item['key'], 'label' => $item['label'],
                ])->values()->all(),
                'failure_message' => $record->failure_message,
            ];
        }

        return $result;
    }

    private function timestamp(?string $value): ?string
    {
        return $value ? CarbonImmutable::parse($value)->setTimezone('Asia/Manila')->toIso8601String() : null;
    }
}
