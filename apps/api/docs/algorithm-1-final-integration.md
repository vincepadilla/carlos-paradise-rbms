# Algorithm 1: selectable customer-calendar classification

Implemented November 23, 2026. Default remains **SQL**. Nothing was activated in
production. Steps 3A-4B reports remain historical records of their original scope.

## What now works

The existing React date picker already calls `GET /api/availability`. When Laravel
configuration selects `tree`, that real endpoint now returns classifications from
the existing Augmented Interval Tree, without executing the per-date SQL classifier
on a successful tree evaluation. The existing JSON contract stays
`{"dates":{"YYYY-MM-DD":"blocked|queue|available"}}` (one actual category per date).
Authentication, validation, invalid-date handling and chronological date order stay
unchanged. No frontend changes are needed.

For the presentation: retrieve relevant protected intervals once, build BLOCKED and
QUEUE trees once, then check BLOCKED before QUEUE for every proposed stay. The
trees use the existing tested Manila normalization and half-open overlap logic.
They are discarded after the request.

CURRENT rules apply: confirmed/reserved reservations and unreleased administrative
blocks are BLOCKED; payment review and held/awaiting-deposit stays with an active,
future-deadline opportunity are QUEUE. Everything else is AVAILABLE. Expired
opportunities, approved ocular visits and cleaning extensions retain their existing
production behavior. PBL proposals stay separately tested and cannot be selected by
this calendar engine.

## Configuration and fallback

For local testing only, supply this Laravel environment setting and restart the
local application (refresh locally cached configuration if applicable):

```dotenv
ALGOCOM_AVAILABILITY_ENGINE=tree
ALGOCOM_AVAILABILITY_SHADOW_ENABLED=false
```

Use `ALGOCOM_AVAILABILITY_ENGINE=sql` to return to SQL. Missing or unrecognized values
also select SQL. No `.env` file was edited. With shadow also disabled, SQL mode does
not resolve the optional calendar engine or execute snapshot probes or tree queries.

Shadow diagnostics remain a separate default-OFF switch. They still observe
`ReservationAvailability::forInterval()` SQL calls. A successful tree calendar
batch does not invoke that SQL method merely to generate shadow comparisons; use
SQL plus shadow when SQL/tree diagnostic comparisons are desired.

One PostgreSQL UNION ALL SELECT extracts relevant reservations and blocks. Each
candidate lies inside the minimum-start/maximum-end envelope. A reservation can
overlap a candidate only if `starts_at < envelope_end AND ends_at > envelope_start`.
The block predicate uses the original whole-second Manila date boundaries:
`starts_on <= date(envelope_end - 1 second) AND ends_on > date(envelope_start)`.
Long intervals crossing the entire window remain included. There is no LIMIT,
silent truncation or persistent cache. Unbounded preparation remains available to
existing shadow/PBL callers.

Two existing PostgreSQL snapshot probes bound the entire build/classification
batch, rather than each calendar date. Changed visibility/connection context,
unsupported transactions/standbys, snapshot exceptions, non-CURRENT trees, changed
deadline seconds or tree failures discard the entire batch and invoke the original
SQL classifier. A fixed notice contains no exception details or guest information;
even logger failure cannot prevent fallback. Optional service initialization failure
also falls back. Errors from the original SQL fallback propagate normally.

## Reservation writes stay SQL-protected

`forInterval()`, quote classification, queue counting/positions and
`ReservationWorkflow::available()` keep their original SQL logic. The calendar
engine is resolved lazily only by `forCalendar()`. Creation retains its existing
villa transaction/row lock and SQL quote recheck. Confirmations, payments, FIFO and
opportunity mutations were not changed. A calendar snapshot never authorizes a
reservation write.

## Files changed in this integration

Relative to `apps/api/` (earlier uncommitted step files were preserved):

1. `app/Services/CalendarAvailability.php` — new guarded batch tree classifier.
2. `app/Services/ReservationAvailability.php` — calendar-only dispatch and SQL fallback.
3. `app/Providers/AppServiceProvider.php` — lazy, scoped engine binding/selection.
4. `app/Http/Controllers/ReservationAvailabilityController.php` — batch valid calendar intervals.
5. `app/Services/Algorithms/ReservationIntervalTreeBuilder.php` — shared preparation plus safe CURRENT window extraction.
6. `app/Services/Algorithms/ReservationIntervalTrees.php` — update its scope comment.
7. `config/algocom.php` — default-SQL selector; shadow default unchanged.
8. `tests/Postgres/CalendarAvailabilityPostgresTest.php` — new focused integration coverage.
9. `tests/Support/IsolatedAvailabilityHttpApplication.php` — test-only POST dispatch through the existing real routes.
10. `docs/algorithm-1-final-integration.md` — this report.

## Validation

Actual PostgreSQL validation used a fresh disposable PostgreSQL 16.4 cluster, with
independently verified executable/process, loopback port, data directory and
ownership marker. Application configuration, `.env`, development/production
databases and production migrations were not loaded. The cluster was stopped and
its owned directory removed afterward.

Commands from `apps/api/`:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests/Postgres/run-shadow-validation.ps1 -Readiness -SkipBenchmark
php -d extension=pdo_sqlite vendor/phpunit/phpunit/phpunit --do-not-cache-result tests/Unit
```

The PostgreSQL suite includes 46 new cases: all 32 CURRENT compatibility scenarios,
real authenticated Guest/Admin/Owner calendar calls, default/invalid configuration,
seven failure/concurrency cases, initialization failure, checkout-anchor/date order,
and the real conflicting reservation POST. The latter injects an empty calendar
tree that reports AVAILABLE, then verifies the POST still locks and rejects with
SQL's original 422 dates error. Read-only paths assert SELECT-only database activity.
Queue positions 2, 3 and 4 remain SQL-derived and unchanged.

The first PostgreSQL run found one test-harness assertion failure: the test expected
a thrown validation exception while Laravel's route pipeline renders the expected
422 JSON. The assertion was corrected to inspect the actual response. No booking
logic was changed to address it.

Latest results:

- Disposable PostgreSQL: **125 tests, 1,770 assertions, zero failures**.
- Entire Unit directory: **263 tests, 13,889 assertions, zero failures**; database
  fixtures here are explicitly in-memory SQLite, independently of PostgreSQL tests.
- Total for those two suites: **388 tests, 15,659 assertions**. The earlier standalone
  tree-only run also passed 46 tests / 10,832 assertions and is included in Unit,
  so it is not counted twice.
- Pint `--test`: passed on all nine changed PHP files.
- TypeScript `tsc -b`: passed.
- Vite build with `envDir:false`: passed, 201 modules; existing >500 kB chunk advisory.
- `git diff --check`: passed.

Existing PostgreSQL diagnostics also passed: shadow 93 MATCHED / 0 MISMATCHED / 7
expected INCONCLUSIVE; readiness 259 MATCHED / 1 deliberately injected MISMATCHED /
3 INCONCLUSIVE / 2 injected errors / 1 injected logger failure. Separately labeled
PBL tests reported 28/28 matches and nine intentional CURRENT-policy differences.
None of those expected diagnostic outcomes are test failures.

## Smoke measurements and limits

One authenticated 43-date route request per role, using the same two synthetic
protected reservations, returned byte-identical SQL/tree JSON with BLOCKED, QUEUE
and AVAILABLE dates:

| Role | SQL SELECTs | Tree SELECTs | SQL route ms | Tree route ms |
| --- | ---: | ---: | ---: | ---: |
| Guest | 177 | 7 | 153.870 | 12.587 |
| Admin | 177 | 7 | 119.453 | 11.435 |
| Owner | 177 | 7 | 141.254 | 13.304 |

Tree totals include two snapshot probes, one bounded extraction/build, and ordinary
authentication/settings queries. These are individual in-process Laravel route
smoke observations, not a new benchmark or a production speedup claim. They omit
network/browser latency; authentication uses isolated session fixtures rather than
live login/CAPTCHA. No full browser session against a running frontend and isolated
backend was performed. TypeScript/build and the real customer-route smoke passed.

The snapshot guard is intentionally conservative: unrelated concurrent transactions
or crossing a clock-second boundary can cause SQL fallback. Trees remain advisory
calendar views: a change after the final probe is possible, as with any calendar
response. Production pooling/replicas/RLS/load are outside this fixture validation.
Existing SQL mutations remain the safety boundary. No broader authoritative write
integration or Algorithm 2 was implemented.
