<?php

namespace App\Services;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class ApplicationBackup
{
    // Explicit inclusion prevents session, OAuth, queue and infrastructure secrets from entering exports.
    public const TABLES = ['roles', 'users', 'villas', 'reservations', 'reservation_opportunities',
        'reservation_status_history', 'reservation_extension_access', 'reservation_damages',
        'payment_methods', 'payments', 'payment_reviews', 'availability_blocks', 'ocular_visits',
        'admin_notifications', 'admin_notification_recipients', 'outgoing_emails',
        'document_versions', 'active_documents', 'audit_events', 'audit_chain_heads'];

    public function snapshot(): array
    {
        return DB::transaction(function () {
            // One coherent snapshot across tables while the live application continues operating.
            if (DB::getDriverName() === 'pgsql') DB::statement('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
            $tables = [];
            foreach (self::TABLES as $table) {
                if (!Schema::hasTable($table)) continue;
                $columns = $table === 'users'
                    ? ['id', 'name', 'email', 'phone', 'address', 'role_id', 'is_active', 'email_verified_at', 'created_at', 'updated_at']
                    : Schema::getColumnListing($table);
                $columns = array_values(array_filter($columns, fn ($column) =>
                    !preg_match('/password|token|secret|google_|storage_path|sync_error/i', $column)));
                $tables[$table] = DB::table($table)->orderBy($table === 'active_documents' ? 'document_key' : 'id')->get($columns)
                    ->map(function ($row) {
                        foreach ($row as $key => $value) {
                            if (!is_string($value)) continue;
                            $json = json_decode($value, true);
                            if (is_array($json)) $row->$key = json_encode($this->redact($json), JSON_THROW_ON_ERROR);
                        }
                        return $row;
                    })->all();
            }
            return ['format' => 'carlos-paradise-application-export', 'version' => 1,
                'generated_at' => now('Asia/Manila')->toIso8601String(), 'tables' => $tables,
                'limitations' => ['Data export only. Automatic restore is not supported.',
                    'Passwords, tokens, OAuth connections, private file paths and file contents are excluded.',
                    'Audit context may be redacted in this export; verify the original database, not redacted export hashes.',
                    'Keep a separate verified database and private-file backup for disaster recovery.']];
        });
    }

    private function redact(array $values): array
    {
        $safe = [];
        foreach ($values as $key => $value) {
            if (is_string($key) && preg_match('/password|token|secret|(?:^|_)path$|^disk$|google_/i', $key)) continue;
            $safe[$key] = is_array($value) ? $this->redact($value) : $value;
        }
        return $safe;
    }
}
