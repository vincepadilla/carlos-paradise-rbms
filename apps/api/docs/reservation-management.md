# Reservation management

Admin mutations use the existing web session, CSRF transport, `RequireAdmin` middleware, villa lock, and database transactions. Apply the additive migration with `php artisan migrate`. It does not backfill or modify existing booking/payment values.

## Persistence and pricing

Booking contact fields, including `contact_address`, are reservation snapshots. Editing them never updates the associated user account. The existing `pricing_snapshot` remains the historical price record; no parallel pricing table was added. Its version 2 format explicitly records `base`, `holiday_fee`, `extra_fee`, `cleaning_fee`, `bonfire`, `charcoal`, `liquor`, `other`, `optional_fee`, `total`, `deposit`, and discount metadata. Existing policy/security-deposit keys are preserved.

Laravel accepts itemized amounts and discount inputs, calculates cents and the final total, and updates `quoted_total` in the same transaction. Client totals, reservation status, payments, deposit requirements, and user IDs cannot be changed through this endpoint. Discounts apply to the base price only. A nonzero discount requires justification. The final price must cover the saved required deposit. Legacy missing amounts stay unknown until the Admin explicitly records them.

The security deposit uses the saved pricing or policy snapshot first. If neither recorded an amount, the UI labels the fallback as the current configured policy from `ReservationSettingsController`/villa settings. It remains separate from the booking price.

## Eligibility and settlement

Full editing requires `confirmed`, a satisfied verified deposit, and a checkout later than the server's current time. Changed future schedules respect the configured lead time, two-year booking horizon, capacity, same-day tour/later-day overnight rules, and a maximum 30-day duration. Admins can adjust booking times; guest quote defaults remain unchanged. Ongoing stays retain their recorded arrival and visit type. Secured reservations and blocked periods are checked by the existing availability service, excluding the reservation being edited.

Only ongoing confirmed stays can change damages. Damage additions/edits/removals are submitted with the booking update and committed atomically. Removed damage rows are retained with deletion actor/time. Final amount due is `max(0, booking price + active damage charges - verified payments)`. An overpayment is shown separately as recorded credit; neither a refund nor a security-deposit deduction is automatically recorded.

Completion requires a verified confirmed booking whose stay has started. Future bookings cannot complete. Completion records `completed_at` and makes booking/damages read only; it does not imply that an outstanding balance was paid. The existing Calendar and Dashboard derive their state from the changed reservation.

## Extension permissions

`reservation_extension_access` is permission to submit one request, not the actual deposit deadline. An Admin can grant/revoke unconsumed permission during an active unpaid opportunity. The agreed date must extend the actual deadline, be after today, and precede check-in. The guest's existing extension endpoint validates and consumes that permission when submitting the request. Only the existing Admin extension approval action changes the actual reservation/opportunity deadline. Rejected requests require a fresh grant. Existing pending requests remain reviewable.

Partial-deposit authorization is not introduced: the existing exact-deposit policy and transfer-reference uniqueness remain in effect. “Manage in Deposit Review” opens the dedicated payment workflow.

## Concurrency and audit

`admin_revision` prevents stale management forms from overwriting newer edits. Booking state transitions, full edits, extension permissions and requests increment it. Important management actions append events and structured before/after changes to the existing `reservation_status_history`; payments continue using `payment_reviews`. No second audit system was introduced.

New routes: `PATCH /api/admin/reservations/{id}`, `POST /api/admin/reservations/{id}/complete`, and `POST`/`DELETE /api/admin/reservations/{id}/extension-access`. Damage changes belong to the full booking PATCH so failed updates cannot partially save damage or price changes.

Tests require SQLite `:memory:` and fail before migrations if pointed at another database. Live PostgreSQL booking/payment records are not used as test fixtures.
