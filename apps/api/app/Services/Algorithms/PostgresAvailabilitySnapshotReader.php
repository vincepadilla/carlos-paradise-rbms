<?php

declare(strict_types=1);

namespace App\Services\Algorithms;

use Illuminate\Database\Connection;

final class PostgresAvailabilitySnapshotReader implements AvailabilitySnapshotReader
{
    public function __construct(private readonly Connection $database) {}

    public function context(): ?string
    {
        // Never change isolation or open a transaction around the authoritative queries.
        // Own writes inside an existing transaction cannot be detected by snapshot equality.
        if ($this->database->getDriverName() !== 'pgsql' || $this->database->transactionLevel() !== 0
            || $this->database->getReadPdo()->inTransaction()) {
            return null;
        }

        return spl_object_id($this->database).':'.spl_object_id($this->database->getReadPdo());
    }

    public function read(): ?string
    {
        $context = $this->context();
        if ($context === null) {
            return null;
        }

        $state = $this->database->selectOne(<<<'SQL'
            SELECT pg_current_snapshot()::text AS snapshot,
                pg_backend_pid() AS backend_pid,
                pg_postmaster_start_time()::text AS server_started,
                inet_server_addr()::text AS server_address,
                inet_server_port() AS server_port,
                CASE WHEN pg_is_in_recovery() THEN 1 ELSE 0 END AS in_recovery,
                current_user AS database_user,
                current_setting('search_path') AS search_path,
                current_setting('row_security') AS row_security
            SQL);

        // Standby replay equivalence is outside this guard's supported primary-only scope.
        if ($state === null || ! isset($state->snapshot, $state->backend_pid, $state->server_started, $state->in_recovery)
            || (int) $state->in_recovery !== 0 || $context !== $this->context()) {
            return null;
        }

        // Includes backend/server identity to reject reconnects and pooled backend changes.
        // The token remains private to this request and is never logged.
        return hash('sha256', serialize([
            $state->snapshot, $state->backend_pid, $state->server_started,
            $state->server_address ?? null, $state->server_port ?? null,
            $state->database_user ?? null, $state->search_path ?? null, $state->row_security ?? null,
        ]));
    }
}
