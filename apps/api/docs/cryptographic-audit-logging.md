# Cryptographic audit logging

`audit_events` is the shared SHA-256 chain. `OwnerAudit` delegates to `AuditChain`; reservation status history and payment reviews are copied into it with a snapshot of their original row. The Audit Trail uses these sealed copies instead of joining live user names into historical events. User names and roles are preserved as they were recorded.

Each hash includes a versioned, deterministically serialized envelope: primary key, sequence, previous hash, actor ID/name/role, action, module, details, normalized UTC timestamp, context, and source reference. Object keys in context are sorted recursively. The chain uses a fixed zero hash as its genesis value. A singleton `audit_chain_heads` row is locked for every append, including the first append. Explicit event IDs are allocated under this lock; application callers must use the writer rather than inserting audit rows themselves.

## Coverage

- Owner account management, settings, payment settings, document uploads, and backup downloads use the shared writer.
- Reservation status changes and before/after edit history use `ReservationWorkflow::history` and are sealed in the same transaction as the original history insert.
- Payment reviews, including automatically approved cash payments, are sealed with their original review rows.
- Staff-created guest accounts and staff edits to guest profiles have explicit events. Guest edits include before/after values.
- Successful mutating admin and owner portal requests use `AuditStaffMutation`. The middleware wraps the database work and audit write in one transaction, and emits a fallback event if that authenticated actor has not emitted an explicit event during the request. The safe request context includes the route template, route target IDs, and SHA-256/size of uploaded files. Request bodies, passwords, access tokens, and file contents are not copied into request context. Read-only POST operations, such as previews, are also recorded as completed staff requests.
- Existing guest/system reservation workflow events are sealed too. System events may have a null actor ID.

Fallback events establish that an action occurred; they are not full before/after snapshots of every changed business row. New domain operations should prefer explicit semantic events with safe target and change information. Background jobs and new routes outside these groups must call the writer explicitly. External side effects (mail delivery and filesystem writes) do not become transactional merely because database writes are transactional.

## Deployment

1. Back up the database and deploy during a maintenance window. Stop writes and workers while migrating. Use a migration account with DDL privileges.
2. From `apps/api`, run `php artisan migrate`. The migration retains and seals existing owner events, reservation history, and payment reviews. Legacy rows are marked as a baseline in context; sealing them does not establish authenticity before migration. This migration intentionally does not roll back retained security history.
3. Run `php artisan audit:verify`. A nonzero exit code or `broken` status needs investigation; do not repair history by recalculating its hashes.
4. Run `php artisan audit:checkpoint <new-file.json>` and move/store the resulting receipt independently of the database and application. The command refuses to overwrite an existing file. A checkpoint records a trusted prefix, so it remains valid as new events are appended. Protect the checkpoint's authenticity and retain versioned receipts.
5. Set `AUDIT_CHECKPOINT_PATH` to the readable, protected checkpoint file used for verification. Refresh Laravel's configuration cache if used. Run `php artisan audit:verify --checkpoint=<file.json>` to check a specific receipt. An absent or invalid configured file fails verification.
6. Keep Laravel's scheduler running. `audit:verify` runs hourly and writes critical Laravel log messages on failed or incomplete verification. Route these messages and failed scheduler commands to the deployment's monitoring/alerting system. The owner page verifies the database chain when loaded or when **Verify again** is selected; it does not load an external checkpoint.

Use separate runtime and migration database roles. The runtime role must not own the audit table, alter/drop/disable its triggers, truncate it, or perform schema changes. Grant it only SELECT/INSERT on `audit_events` and the required SELECT/UPDATE privileges on `audit_chain_heads`. Apply ordinary business-table privileges separately. SQLite has file-level access rather than this role separation: protect the database file and its backups at the operating system level.

Database triggers reject UPDATE and DELETE on SQLite, PostgreSQL, MySQL, and MariaDB. PostgreSQL also rejects TRUNCATE through its trigger. MySQL/MariaDB TRUNCATE bypasses row triggers, so the runtime role must lack DROP/DDL privileges. These protections cannot constrain a database owner or someone who can replace the SQLite file. PostgreSQL/MySQL behavior should be validated on a staging database using the deployed runtime role; automated feature tests use isolated SQLite databases.

## Verification and limits

Verification checks the entire chain, sequence/link continuity, event hashes, the saved head (including tail deletion), source reservation/payment snapshots, and history rows that have no sealed event. Filters and pagination do not reduce verification scope. It holds a shared head lock during its scan to avoid false failures from concurrent appends. Verification performs a full scan and source lookups, so plan monitoring frequency and request latency as retained history grows.

SHA-256 chaining provides evidence of changes to recorded history. It does not prevent a fully privileged attacker from rewriting all hashes and the local head. An independently trusted checkpoint detects changes to the protected prefix; events after the latest checkpoint have a smaller protection boundary. Issue and retain new receipts at a cadence appropriate for operations.

Direct changes to arbitrary business records (reservations, users, settings, document bytes, and payment amounts) are not automatically detected just because an audit chain exists. The verifier reconciles original reservation-history and payment-review rows with sealed snapshots. Wider detection requires database change capture or explicit reconciliation against recorded business/file values. Uploaded file hashes record the bytes received; verification does not re-read all stored files.

Application JSON exports include chain/head data but may redact private paths and other sensitive context. They are not an unmodified forensic copy and cannot be used to validate the original chain hashes. Keep a separately protected database backup and private-file backup.

## Validation

Run `php vendor/phpunit/phpunit/phpunit` from `apps/api` and `npm run build` from `apps/web`. Audit feature tests exercise linking and hash coverage, database update/delete rejection, privileged mutation detection, truncation/checkpoints, rollback, source reconciliation, unsealed history, account/profile actions, and migration of retained history. Database concurrency and production role enforcement require staging checks on the actual database engine.
