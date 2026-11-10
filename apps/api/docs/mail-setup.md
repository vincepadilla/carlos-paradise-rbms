# Laravel SMTP setup

The Notification Center uses Laravel 12's built-in Symfony SMTP transport. No
provider-specific package or separate email API key is required.

## Local environment

Replace the mail section in `apps/api/.env` with:

```dotenv
MAIL_MAILER=smtp
MAIL_SCHEME=smtp
MAIL_HOST=your-smtp-host
MAIL_PORT=587
MAIL_USERNAME=your-smtp-username
MAIL_PASSWORD="your-smtp-password"
MAIL_REQUIRE_TLS=true
MAIL_TIMEOUT=30
MAIL_FROM_ADDRESS="your-verified-sender@example.com"
MAIL_FROM_NAME="Carlos Paradise"
```

Replace `MAIL_HOST`, `MAIL_USERNAME`, and `MAIL_PASSWORD` with the SMTP values
from the transactional email provider's SMTP/relay credentials page. Replace
`MAIL_FROM_ADDRESS` with a sender address or domain verified with that provider.
Some providers require DNS verification before accepting mail from the address.

This application consumes `MAIL_SCHEME`; `MAIL_ENCRYPTION` is not read by
`config/mail.php`. The documented `smtp` scheme on port 587 uses STARTTLS and
`MAIL_REQUIRE_TLS=true` prevents an unencrypted SMTP session. If a provider
specifically requires implicit TLS on port 465, use `MAIL_SCHEME=smtps` and
`MAIL_PORT=465` instead.

Keep these values only in `apps/api/.env` or the production backend secret
store. Do not add them to frontend `VITE_*` variables or commit `.env`.

## Database, configuration, worker, and scheduler

From the repository root:

```powershell
cd apps/api
php artisan migrate
php artisan config:clear
php artisan queue:restart
php artisan queue:work --queue=default --tries=1 --timeout=60
```

Run the local scheduler in a second terminal:

```powershell
cd apps/api
php artisan schedule:work
```

The existing `database` queue connection is persistent, and the repository
already includes migrations for `jobs`, `job_batches`, and `failed_jobs`.
Compose Email schedules one delayed `SendOutgoingEmail` job. The database queue
releases it at `scheduled_for`; the idempotency key, row lock, processing marker,
and terminal status checks prevent duplicate application dispatches. A running
queue worker is what sends delayed email. The scheduler remains required for the
project's calendar and notification synchronization commands.

In production, keep `queue:work` under Supervisor, systemd, or an equivalent
process monitor. Run Laravel's scheduler every minute, for example on Linux:

```cron
* * * * * cd /absolute/path/to/apps/api && php artisan schedule:run >> /dev/null 2>&1
```

After every backend environment or deployment configuration change:

```bash
cd /absolute/path/to/apps/api
php artisan config:clear
php artisan config:cache
php artisan queue:restart
```

## Transport verification

No test email is sent automatically. After configuring a real recipient, run:

```powershell
cd apps/api
php artisan mail:test recipient@example.com
```

The command sends synchronously. Success means the configured SMTP transport
accepted the message for sending; it does not prove inbox delivery or reading.
Authentication and transport errors return a failure exit code without printing
credentials. The `log` and `array` transports are explicitly rejected by this
command because they are development-only and do not transmit email.

Inspect application and transport failures in `storage/logs/laravel.log`.
Inspect queue-level failures with:

```powershell
php artisan queue:failed
php artisan queue:retry <failed-job-uuid>
```

Compose Email also records safe failure details in Sent History. A transport
failure handled by `SendOutgoingEmail` is recorded on the outgoing email itself;
infrastructure-level job failures may additionally appear in `failed_jobs`.
