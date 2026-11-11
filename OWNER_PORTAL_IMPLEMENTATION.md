# Owner Portal implementation report

Implemented locally on November 11, 2026. Changes are uncommitted; nothing was pushed or deployed. The pre-existing untracked `docs/` reference project was not modified.

The original routing issue was in `loginDestination`: every account except Admin was sent to the customer portal. The shared staff pages also contained Admin-only navigation destinations. Owner now has an explicit destination, a protected parent route, and shared navigation/API adapters that retain the Owner namespace without duplicating operational pages.

## 1. Files modified

The complete inventory appears at the end of this report. Most shared-page changes replace navigation imports with the shared staff navigation adapter. The existing operational components and business rules remain shared.

## 2. Files created

The complete inventory appears at the end of this report. New production files provide Owner authorization, management endpoints, persistence, routing adapters, and Owner-only screens. Test fixtures are confined to `tests/` and `scripts/`.

## 3. Migration added

`apps/api/database/migrations/2026_11_11_000002_create_owner_portal_tables.php`

- Creates `document_versions`, `active_documents`, and `audit_events`.
- Preserves immutable PDF versions, an atomic active-version pointer, and Owner action history.
- Applied successfully with `php artisan migrate --no-interaction`.
- No existing reservation/payment records were rewritten and the local database was not reset. Laravel tests use guarded SQLite in-memory databases.

## 4. Owner routes added

Frontend navigation:

```text
/owner/dashboard
/owner/reservations
/owner/reservations/:id
/owner/reservations/:reservationId/payment-review
/owner/queue
/owner/calendar
/owner/guests
/owner/guests/:id
/owner/guests/:id/reservations
/owner/guests/:id/payments
/owner/guests/:id/activity
/owner/reports
/owner/database
/owner/notifications
/owner/settings
/owner/admin-management
/owner/audit-trail
/owner/help
```

`/owner` redirects to the dashboard. Unknown Owner paths render the protected not-found view. Document Management is a System Settings section, accessible directly with `/owner/settings?section=Document+Management`.

Owner-only API endpoints:

| Method | Path |
| --- | --- |
| GET, PATCH | `/api/owner/settings` |
| GET, POST | `/api/owner/payment-methods` |
| GET, POST | `/api/owner/admins` |
| PATCH | `/api/owner/admins/{admin}` |
| GET, POST | `/api/owner/documents` |
| GET | `/api/owner/documents/{document}/download` |
| GET | `/api/owner/audit-trail` |
| GET | `/api/owner/database/backup` |
| POST | `/api/owner/database/validate` |

The shared operational route definitions in `routes/admin.php` are also registered under `/api/owner/operations`, protected by `RequireOwner`. These include reservation management, creation, payment reviews/receipts, reports/exports, guests, calendar blocks, ocular visits, notifications, and outgoing email. Existing reservation endpoints continue to use their existing ownership/staff checks. There is no database restore endpoint.

## 5. Shared Admin components reused

- `AdminLayout`, sidebar/header, sign-out, session hook/context, notification provider, page headers, loading/error views, and pagination.
- Dashboard, reservations/details/creation, deposit review, queue, calendar/ocular visits, guest directory/details/history, reports, and Notifications pages.
- `AdminApi`, reservation transport/CSRF handling, and Laravel operational controllers/services.
- Existing scoped staff styles, typography, design tokens, brand logo, and icons.

`StaffRouting` maps existing operational destinations into the authenticated portal. `OperationalApi` selects the Owner operational namespace from the current route; backend middleware independently authorizes every request. Internal navigation retains the parent session and shell.

## 6. Owner-only pages and components

- `OwnerDatabasePage`: download an application export; choose and validate an export; explain unavailable automatic restore.
- `OwnerSettingsPage`: ten collapsible sections for Resort Information, Reservation Settings, Guest Capacity, Payment Settings, Amenities & Inclusions, Landing Page Content, Pricing, Policies, Notifications, and Document Management.
- `OwnerPaymentAccounts`: create/edit/enable/disable receiving accounts without deleting payment history.
- `OwnerDocuments`: separate House Rules & Policies and Waiver Form cards, current version, protected Preview/Download, replacement PDFs, notes, and retained version history.
- `OwnerAdminsPage`: paginated/searchable Admin accounts, create/edit, and confirmed enable/disable.
- `OwnerAuditPage`: real history with search, Manila date, module, action, and pagination.

## 7. Backend authorization

- Every `/api/owner/*` route requires the existing web session plus an active account whose server-side role is exactly `owner`.
- Anonymous requests receive 401; Guests, Admins, and inactive Owners receive 403. Client-supplied roles do not grant access.
- Owner responses are private and marked `no-store`. Mutations retain web CSRF protection and throttling.
- Existing `/api/admin/*` authorization remains unchanged, including the distinction between existing Admin-only routes and previously shared Admin/Owner routes.
- Admin Management targets only accounts already holding the Admin role. Forged Owner/Guest IDs are rejected; role changes are prohibited. Passwords are hashed through the existing model and are never returned.
- Disabling an Admin blocks existing sessions through the existing active-account checks.
- PDFs remain on private local storage and are available only through Owner-protected endpoints. Uploads require validated PDFs, have a 10 MB limit, and use unique stored paths. Activation is transactional and serialized through a stable parent lock.

## 8. Real persisted features

- Resort information, reservation deposit/opportunity duration/lead time, check-in/check-out times, reservation/payment-deadline instructions, capacity, payment instructions, rates/fees, amenities/inclusions, landing content, and policies persist in the existing villa columns/settings JSON.
- Guest forms, the quote validator, and staff reservation creation use persisted schedules; existing booking snapshots are preserved. Landing content, public rates/policies, and guest instructions consume saved settings.
- Receiving accounts persist in `payment_methods`; active accounts appear in guest payment options.
- PDF files and version metadata persist separately. The active versions feed the existing guest-email attachment catalog; previously queued/sent messages retain their original file paths.
- Admin account changes persist in `users` and are audited.
- Audit Trail combines existing `reservation_status_history` with new Owner events for settings, Admin accounts, documents, receiving accounts, and backup generation. Historical reservation roles reflect the actor's current role where a historical role snapshot does not exist.
- JSON application export reads 19 explicitly included operational tables in a consistent PostgreSQL snapshot. It excludes credentials, OAuth connections, private-file paths, and file contents; nested JSON secret/path fields are redacted.

## 9. Intentionally unsupported actions and limits

- Automatic database restore is disabled. This credential-free, file-free application export cannot reconstruct a complete database safely. Choosing/validating a file is read-only; no destructive restore is performed.
- SHA-256 chained audit logging is not implemented. PDF SHA-256 values are file checksums, not a cryptographic audit chain.
- Notifications reuses the existing inbox and manual send/schedule workflows. The reference's additional automatic reminder/confirmation/7-day PDF scheduling switches are not simulated; SMTP credentials and workers remain server configuration.
- Previously uploaded PDF versions can be previewed/downloaded; this implementation activates replacements on upload and does not expose historical reactivation.
- Live CAPTCHA login and external Google OAuth were not exercised in the browser checks. The installed vendor tree lacks the declared Socialite package, so provider integration remains an environment verification limit; the existing callback's role destination was updated without changing OAuth verification.

## 10. Frontend build

`npm.cmd run build` passes. Vite reports its existing warning about a main bundle exceeding 500 kB; no new dependencies were added.

## 11. Laravel tests

The full suite passes: **108 tests, 1,200 assertions**, including 14 Owner tests and all existing Admin tests.

```text
cd apps/api
php -d extension=pdo_sqlite vendor/phpunit/phpunit/phpunit
```

Coverage includes all registered Owner routes rejecting unauthorized roles, login/session restoration, shared operations, Admin account protections, settings/receiving-account persistence, booking schedule validation, PDF validation/version retention, active email documents, audit history/filtering/Manila midnight boundaries, backup authorization/redaction, and non-destructive export validation.

A separate read-only check against the local PostgreSQL database verified the Owner audit query and all 19 application-export tables.

## 12. Frontend and browser tests

- Frontend unit regressions: **27 passed**.
- Existing Admin browser regressions: **99 passed**.
- Owner browser regressions: **19 passed**.
- Owner browser checks cover identity/navigation, shared routes and API namespaces, shell/session retention, saved forms, Admin account dialogs, PDF history, audit filters, backup validation, authorization redirects, restored sessions, and mobile/tablet layouts.
- Browser sessions and API data are isolated fixtures. Backend tests verify real authorization/storage behavior. No live credentials were submitted and CAPTCHA was not bypassed.
- Existing stale test expectations were updated to the current operational table, ocular form, payment helper, and warning copy. Asynchronous checks wait for server-driven UI updates.

```text
cd apps/web
node --test scripts/admin-dashboard.test.mjs scripts/admin-calendar.test.mjs scripts/reservation-details.test.mjs scripts/payment-review.test.mjs
node scripts/check-admin.mjs
node scripts/check-admin.mjs --owner --capture
```

Screenshots are generated under ignored `apps/web/node_modules/.tmp/admin-visual/owner-*.png`.

## 13. Figma comparison and remaining differences

Compared the implementation with the local Figma Make source in `docs/src/app/(frontend)/CarlosParadiseApp.tsx` and `styles.css`, and inspected generated desktop/mobile screenshots. Reused the chocolate staff sidebar, cream/off-white surfaces, brown actions, sage accents, typography, assets, and spacing. Owner settings uses collapsible sections; official documents use two versioned cards; Database uses the paired backup/restore-card hierarchy.

Remaining differences are functional and explicit: restore is unavailable, audit integrity language describes actual logging, Audit uses an Apply Filters action, and settings save/reset per section. The broader prototype's social-link/logo editors, advanced special-date/rate-rule dialogs, landing draft/publish previews, automatic notification switches, and printable audit-detail modal are not reproduced. Real account data and history replace prototype sample records. No standalone Figma screenshots/file URL were attached for a pixel-exact comparison.

## Complete file inventory

### Modified (47)

```text
apps/api/app/Http/Controllers/Auth/GoogleAuthController.php
apps/api/app/Http/Controllers/ReservationQuoteController.php
apps/api/app/Http/Controllers/ReservationSettingsController.php
apps/api/app/Services/GuestEmailCatalog.php
apps/api/routes/admin.php
apps/api/routes/web.php
apps/web/scripts/check-admin.mjs
apps/web/scripts/payment-review.test.mjs
apps/web/src/App.tsx
apps/web/src/api.ts
apps/web/src/components/admin/AdminHeader.tsx
apps/web/src/components/admin/AdminLayout.tsx
apps/web/src/components/admin/AdminReservationTable.tsx
apps/web/src/components/admin/AdminSidebar.tsx
apps/web/src/components/admin/AdminSignOutButton.tsx
apps/web/src/components/admin/calendar/CalendarGrid.tsx
apps/web/src/components/admin/calendar/OcularVisitDialog.tsx
apps/web/src/components/admin/dashboard/DepositReviewPreview.tsx
apps/web/src/components/admin/dashboard/OngoingStayCard.tsx
apps/web/src/components/admin/dashboard/ReservationQueuePreview.tsx
apps/web/src/components/admin/dashboard/UpcomingMovementCard.tsx
apps/web/src/components/admin/payment-review/DepositReviewList.tsx
apps/web/src/components/admin/payment-review/PaymentReview.tsx
apps/web/src/components/admin/payment-review/ReceiptPreview.tsx
apps/web/src/components/admin/reports/PaymentReport.tsx
apps/web/src/components/admin/reports/ReservationReport.tsx
apps/web/src/components/admin/reservation-create/AdminReservationModal.tsx
apps/web/src/components/admin/reservation-details/ReservationDetails.tsx
apps/web/src/components/admin/reservation-details/ReservationInformation.tsx
apps/web/src/components/admin/reservation-details/ReservationPayments.tsx
apps/web/src/components/admin/reservation-details/ReservationPriceSummary.tsx
apps/web/src/components/auth/RequireAdmin.tsx
apps/web/src/pages/LandingPage.tsx
apps/web/src/pages/MakeReservationPage.tsx
apps/web/src/pages/PaymentPage.tsx
apps/web/src/pages/ReservationRoute.tsx
apps/web/src/pages/admin/AdminDashboardPage.tsx
apps/web/src/pages/admin/AdminGuestDetailsPage.tsx
apps/web/src/pages/admin/AdminGuestHistoryPage.tsx
apps/web/src/pages/admin/AdminGuestsPage.tsx
apps/web/src/pages/admin/AdminHelpPage.tsx
apps/web/src/pages/admin/AdminNotificationsPage.tsx
apps/web/src/pages/admin/AdminQueuePage.tsx
apps/web/src/pages/admin/AdminReservationsPage.tsx
apps/web/src/pages/admin/AdminRoutes.tsx
apps/web/src/services/AdminApi.ts
apps/web/src/types/auth.ts
```

### Created (28)

```text
OWNER_PORTAL_IMPLEMENTATION.md
apps/api/app/Http/Controllers/Owner/OwnerAdminsController.php
apps/api/app/Http/Controllers/Owner/OwnerAuditController.php
apps/api/app/Http/Controllers/Owner/OwnerDatabaseController.php
apps/api/app/Http/Controllers/Owner/OwnerDocumentsController.php
apps/api/app/Http/Controllers/Owner/OwnerSettingsController.php
apps/api/app/Http/Middleware/RequireOwner.php
apps/api/app/Services/ApplicationBackup.php
apps/api/app/Services/OwnerAudit.php
apps/api/database/migrations/2026_11_11_000002_create_owner_portal_tables.php
apps/api/routes/owner.php
apps/api/tests/Feature/OwnerPortalTest.php
apps/web/scripts/owner-browser-checks.mjs
apps/web/src/components/admin/StaffRouting.tsx
apps/web/src/components/auth/RequireOwner.tsx
apps/web/src/hooks/useOwnerAction.ts
apps/web/src/pages/owner/OwnerAdminsPage.tsx
apps/web/src/pages/owner/OwnerAuditPage.tsx
apps/web/src/pages/owner/OwnerDatabasePage.tsx
apps/web/src/pages/owner/OwnerDocuments.tsx
apps/web/src/pages/owner/OwnerPaymentAccounts.tsx
apps/web/src/pages/owner/OwnerSettingsPage.tsx
apps/web/src/pages/owner/OwnerUI.tsx
apps/web/src/pages/owner/owner.css
apps/web/src/pages/owner/ownerSettingsFields.ts
apps/web/src/services/OperationalApi.ts
apps/web/src/services/OwnerApi.ts
apps/web/src/types/owner.ts
```
