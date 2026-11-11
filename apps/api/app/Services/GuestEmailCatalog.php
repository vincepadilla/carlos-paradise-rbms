<?php

namespace App\Services;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\ValidationException;

class GuestEmailCatalog
{
    public const CATEGORIES = [
        'general_update' => 'General Update',
        'reservation_update' => 'Reservation Update',
        'deposit_reminder' => 'Deposit Reminder',
        'house_rules_policies' => 'House Rules & Policies',
        'waiver_form' => 'Waiver Form',
    ];

    public function categories(?object $recipient = null): array
    {
        $settings = $this->settings();
        $configured = is_array($settings['email_templates'] ?? null) ? $settings['email_templates'] : [];

        return collect(self::CATEGORIES)->map(function (string $label, string $key) use ($configured, $recipient) {
            $template = is_array($configured[$key] ?? null)
                ? array_replace($this->defaultTemplate($key), $configured[$key])
                : $this->defaultTemplate($key);

            return [
                'key' => $key,
                'label' => $label,
                'subject' => $this->render((string) ($template['subject'] ?? ''), $recipient),
                'message' => $this->render((string) ($template['message'] ?? ''), $recipient),
            ];
        })->values()->all();
    }

    public function documents(): array
    {
        $settings = $this->settings();
        $configured = is_array($settings['email_documents'] ?? null) ? $settings['email_documents'] : [];
        $active = DB::table('active_documents as active')->join('document_versions as version', 'version.id', '=', 'active.version_id')
            ->get(['active.document_key', 'version.storage_path']);
        foreach ($active as $version) {
            $configured = array_values(array_filter($configured, fn ($document) =>
                !is_array($document) || ($document['key'] ?? null) !== $version->document_key));
            $configured[] = ['key' => $version->document_key,
                'label' => ($version->document_key === 'house-rules-policies' ? 'House Rules & Policies' : 'Waiver Form').'.pdf',
                'disk' => 'local', 'path' => $version->storage_path];
        }

        return collect($configured)->filter(function ($document) {
            return is_array($document)
                && is_string($document['key'] ?? null)
                && preg_match('/^[a-z0-9_-]{1,80}$/', $document['key'])
                && is_string($document['label'] ?? null)
                && is_string($document['disk'] ?? null)
                && is_string($document['path'] ?? null)
                && Storage::disk($document['disk'])->exists($document['path']);
        })->map(fn (array $document) => [
            'key' => $document['key'],
            'label' => $document['label'],
            'disk' => $document['disk'],
            'path' => $document['path'],
        ])->values()->all();
    }

    public function selectedDocuments(array $keys): array
    {
        $documents = collect($this->documents())->keyBy('key');
        $missing = collect($keys)->unique()->reject(fn (string $key) => $documents->has($key));
        if ($missing->isNotEmpty()) {
            throw ValidationException::withMessages([
                'attachments' => 'One or more selected documents are unavailable. Refresh and try again.',
            ]);
        }

        return collect($keys)->unique()->map(fn (string $key) => $documents->get($key))->values()->all();
    }

    public function transportConfigured(): bool
    {
        return ! in_array(config('mail.default'), ['array', 'log', 'null'], true);
    }

    private function settings(): array
    {
        $settings = json_decode((string) DB::table('villas')->where('id', 1)->value('settings'), true);

        return is_array($settings) ? $settings : [];
    }

    private function defaultTemplate(string $key): array
    {
        $subjects = [
            'reservation_update' => 'Reservation update - {{reservation_reference}}',
            'deposit_reminder' => 'Deposit reminder - {{reservation_reference}}',
            'house_rules_policies' => 'House rules and policies - {{reservation_reference}}',
            'waiver_form' => 'Waiver form - {{reservation_reference}}',
        ];
        $intros = [
            'reservation_update' => 'We have an update about your reservation {{reservation_reference}}.',
            'deposit_reminder' => 'This is a reminder regarding the deposit for reservation {{reservation_reference}}.',
            'house_rules_policies' => 'Please review the house rules and policies for reservation {{reservation_reference}}.',
            'waiver_form' => 'Please review the waiver information for reservation {{reservation_reference}}.',
        ];

        return [
            'subject' => $subjects[$key] ?? 'Update for {{reservation_reference}}',
            'message' => 'Hello {{guest_name}},'.PHP_EOL.PHP_EOL.($intros[$key] ?? '').PHP_EOL.PHP_EOL,
        ];
    }

    private function render(string $value, ?object $recipient): string
    {
        if (! $recipient) {
            return $value;
        }

        return strtr($value, [
            '{{guest_name}}' => (string) $recipient->recipient_name,
            '{{reservation_reference}}' => (string) $recipient->booking_reference,
            '{{check_in_date}}' => (string) $recipient->check_in_date,
        ]);
    }
}
