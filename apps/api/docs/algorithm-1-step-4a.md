# Algorithm 1 — Step 4A: Laravel/PostgreSQL shadow validation

Completed November 22, 2026. **Actual PostgreSQL validation was performed** against
a newly initialized, disposable PostgreSQL 16.4 cluster. Shadow remains default-OFF;
SQL remains authoritative. No customer activation or Step 4B implementation occurred.

## Exact files changed in Step 4A

Modified test support only:

- `tests/Support/ReservationIntervalFixtures.php`: fixture loading accepts Laravel's
  common Connection type; existing SQLite fixtures retain their previous behavior.
- `tests/Support/AvailabilityShadowTestEnvironment.php`: permits injection of a verified
  disposable connection and the real PostgreSQL snapshot reader.
- `tests/Support/IsolatedAvailabilityHttpApplication.php`: permits injected fixtures
  and use of the actual production service-provider shadow binding. SQLite tests
  retain their controlled-reader default.

Created:

- `tests/Support/DisposablePostgresCluster.php`: ownership-verified connection/bootstrap
  guard with no application configuration or database fallback.
- `tests/Support/PostgresShadowFixture.php`: isolated schemas using PostgreSQL
  timestamp/date types and representative production availability indexes.
- `tests/Postgres/run-shadow-validation.ps1`: creates, independently verifies, tests,
  stops, and removes only its newly owned temporary cluster.
- `tests/Postgres/bootstrap-fixture.php`: verifies the fresh server and creates its
  uniquely named fixture database and ownership marker.
- `tests/Postgres/ReservationAvailabilityPostgresTest.php`: real PostgreSQL compatibility,
  concurrency, transaction, OFF-mode, and authenticated API validation.
- `tests/Postgres/measure-shadow.php`: real PostgreSQL service and authenticated
  calendar-request query/latency measurements.
- `docs/algorithm-1-step-4a.md`: this report.

No production service, controller, route, UI source, migration, or configuration was
edited in Step 4A. Earlier uncommitted modifications remain in the worktree. No commits,
pushes, production/development records, application credentials, or `.env` changes occurred.
Frontend build artifacts are generated/ignored output, not UI-source changes.

## Disposable PostgreSQL isolation

Inspection found installed PostgreSQL 16.4 binaries and PHP's `pdo_pgsql` extension.
An isolated runtime could therefore be created without using an existing service,
application connection string, or database account. `initdb` creates an independent
database cluster, and `pg_ctl` controls the server associated with its data directory.
See the [initdb reference](https://www.postgresql.org/docs/16/app-initdb.html) and
[pg_ctl reference](https://www.postgresql.org/docs/16/app-pg-ctl.html).

The runner:

1. Creates a unique temporary directory, refuses an existing directory, and writes
   an ownership marker.
2. Uses a dynamically selected free high port and starts a new PostgreSQL process
   bound only to `127.0.0.1`. It does not register a Windows service or use Docker.
3. Verifies the new postmaster PID, executable path, PID-file port, and owning loopback
   TCP listener before making any database connection.
4. Verifies server data directory, address, port, database name, and primary status
   before fixture writes. Database creation additionally requires a freshly initialized
   cluster. Every subsequent connection verifies the unique database ownership marker.
5. Creates separate random fixture schemas and independent reader/writer connections.
   Schema cleanup re-verifies ownership and restricts DROP to that generated schema.
6. Stops only the server belonging to the generated data directory, verifies the
   temporary path/marker, and removes that owned directory in a finally block.

The current runner clears inherited libpq connection/credential overrides inside its
dedicated child PowerShell process without reading their values. Empty owned pass/service
files and explicit fixture connection parameters prevent application credential fallback.
The test cluster uses trust authentication only on loopback and contains synthetic
fixtures only; it is temporary and is never an application authentication configuration.
All temporary clusters from the validation attempts were stopped and removed; the
final check found zero remaining `rbms-step4a-*` directories.

Autovacuum is disabled only on the disposable server to avoid unrelated background
transaction changes in deterministic snapshot cases. The test server uses 16 maximum
connections and 32 MB shared buffers. Durability settings were not disabled. No normal
Laravel environment/configuration bootstrap, migrations, or application seeds were run.

Run from `apps/api` in a child process:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests/Postgres/run-shadow-validation.ps1
```

`-ExecutionPolicy Bypass` applies to this child process, not a persisted machine policy.
Use `-SkipBenchmark` to run the PostgreSQL tests without measurements. Without the
owned runner manifest, the PostgreSQL test class skips and the helper has no fallback
to any configured database. The fixture database is always created anew, never accepted
as an arbitrary caller-supplied PostgreSQL DSN.

## What was validated against PostgreSQL

All 32 existing CURRENT-policy compatibility fixtures ran against real PostgreSQL
types and the unchanged SQL/tree services. They cover confirmed and legacy reserved
conflicts, available dates, active payment opportunities, expired deadlines/statuses,
payment review, unreleased/released administrative blocks, BLOCKED-over-QUEUE precedence,
half-open adjacency, villa isolation, duplicate holds, waiting counts, and queue positions.
Approved oculars and the proposed cleaning/release changes remain inactive under CURRENT.

Stored timestamps use `timestamp(0) with time zone`, administrative dates use `date`,
and opportunity deadlines use timezone-aware timestamps. The fixtures reproduce the
relevant B-tree indexes and one-active-opportunity partial unique index. Mixed UTC and
numeric-offset records were checked with Manila proposals under Manila, UTC, and New York
server-session timezones. Half-open checkout adjacency matched in each session.

The fixture schema is deliberately limited to the columns/indexes used by availability,
auth, and calendar routing. It is not a migrated replica of every production table,
constraint, trigger, permission, or reservation lifecycle. That limitation is separate
from the verified use of the real PostgreSQL driver, Laravel query grammar, snapshot
functions, service-provider binding, and session-authenticated HTTP routing.

## Concurrency and snapshot findings

Separate real PostgreSQL connections performed controlled fixture writes/commits:

- A confirmed reservation committed between the original SQL reads preserved that
  call's original AVAILABLE response, produced INCONCLUSIVE, and matched BLOCKED on
  the next stable check.
- A commit after tree extraction but before its verification produced INCONCLUSIVE,
  never MATCH or MISMATCH.
- An opportunity expired between SQL classification and its queue-count query.
  The original SQL result, including its concurrency-affected queue position, was
  preserved and the comparison was INCONCLUSIVE. Diagnostics did not repair or
  reinterpret the authoritative result.
- An uncommitted writer remained invisible to the reader and matched AVAILABLE.
  Committing it invalidated the cached comparison; a later stable check rebuilt
  and matched BLOCKED.
- Existing READ COMMITTED, REPEATABLE READ, and SERIALIZABLE reader transactions
  each yielded INCONCLUSIVE with zero snapshot probes. Own transactional writes
  stayed visible to the original SQL, and transaction level/isolation were preserved
  until the fixture explicitly rolled back.

PostgreSQL's statement snapshots under Read Committed and visibility of a transaction's
own writes explain why these cases need different guards; see the
[isolation reference](https://www.postgresql.org/docs/16/transaction-iso.html).

These observations validate the Step 3C lower-bound reuse behavior on this primary,
direct, autocommit connection architecture. No isolation changes or locks were added
to production code. They do not establish correctness for an untested deployment's
replicas, connection pool/failover routing, custom RLS/session behavior, or triggers.

## Actual tests and comparison counts

Final PostgreSQL run: **46 tests, 516 assertions passed; zero failed**.

PostgreSQL diagnostic totals across those tests:

| Outcome/work | Count |
| --- | ---: |
| Comparisons | 100 |
| MATCH | 93 |
| MISMATCH | 0 |
| INCONCLUSIVE | 7 |
| Shadow errors | 0 |
| Tree constructions | 43 |
| Snapshot probes | 183 |

The seven inconclusive observations are the four expected concurrent-state changes
and three unsupported existing-transaction cases. No unreliable case was reported
as a successful match. Each stable 43-check test produced 43 matches, one build,
45 probes, and no diagnostic writes. Disabled mode issued exactly the same SQL
statements/bindings as the original service, with zero probes/builds/log events.

Guest, Admin, and Owner were authenticated through the existing Laravel session guard
and Eloquent user/role provider against the PostgreSQL fixture. Each role received
identical ON/OFF HTTP status and calendar JSON using the actual production shadow
binding. The original `dates` API fields and SQL queue-position service contract were
preserved. Fixture record snapshots remained unchanged by evaluation.

Existing focused suites after the support changes: **262 tests, 13,888 assertions
passed; zero failed**. Across both runs: **308 tests, 14,404 assertions passed**.
The retained suite includes authorization denial, validation, initialization/algorithm/
snapshot/logger fallback, redaction, and no-mutation regression checks.

An early ownership-bootstrap attempt stopped at its guard before fixture writes;
loopback-address/path normalization was hardened. The first full PostgreSQL suite
then reported one test-harness failure: the read-only assertion expected SELECT at
the first character, while Laravel's PostgreSQL UNION grammar emits parenthesized
SELECTs. That assertion was corrected; no algorithm or SQL availability rule was changed.
The final repeated PostgreSQL run passed all 46 cases with the same comparison totals.

Pint passed for all eight Step 4A PHP files. `git diff --check` passed. The relevant
regression command remains:

```powershell
php -d extension=pdo_sqlite vendor/phpunit/phpunit/phpunit --do-not-cache-result --filter 'AugmentedIntervalTreeTest|ReservationIntervalTreeCompatibilityTest|ReservationIntervalTreeBuilderTest|ReservationAvailabilityShadow'
```

Frontend TypeScript and Vite build checks also passed:

```powershell
.\node_modules\.bin\tsc.cmd -b
node --input-type=module --eval "import('vite').then(({build}) => build({envDir:false}))"
```

Those commands run from `apps/web`; `envDir:false` explicitly prevents Vite from
loading application `.env` files. The build transformed 201 modules and retained
the existing advisory for a minified chunk larger than 500 kB. No UI source was edited.

## Measured PostgreSQL queries and latency

Measurements used actual PostgreSQL 16.4 loopback connections and the real snapshot
functions, not substitute SELECT probes. Each size used one warm-up and seven measured
SQL/shadow pairs with a frozen application clock, warm data, and in-memory logging.
Fixture insertion and ANALYZE were outside measured work. The benchmark ran serially,
without PHPUnit/Pint/build processes competing for resources.

Median milliseconds for 43 service checks:

| Protected records | SQL only | SQL + shadow | Added time, paired median | Full extraction/normalization/build | All tree queries |
| --- | ---: | ---: | ---: | ---: | ---: |
| 100 | 105.919 | 126.991 | 22.540 | 2.031 | 0.198 |
| 1,000 | 93.938 | 126.579 | 32.641 | 10.286 | 0.209 |
| 10,000 | 94.701 | 232.425 | 139.821 | 114.726 | 0.262 |

For each size, SQL-only issued **186 SELECTs**, shadow-enabled issued **232 SELECTs**:
**46 additional queries = 45 snapshot probes + 1 tree-record SELECT**. Each request
recorded 43 matches, zero mismatches/inconclusive/errors, and one tree construction.
The disabled path added zero queries. The service workload mixes BLOCKED, QUEUE, and
AVAILABLE intervals; fixtures contain equal confirmed/payment-review record counts.

The authenticated Guest HTTP benchmark used 1,000 records and the real 43-date calendar
route, validation, session guard, settings reads, and JSON construction:

| Mode | SELECTs | Median response work |
| --- | ---: | ---: |
| SQL only | 197 | 114.748 ms |
| SQL + shadow | 243 | 144.978 ms |

The paired added-time median was **30.307 ms**. Each enabled request produced 43 matches,
zero mismatches/inconclusive/errors, one build, and 45 probes. This is in-process HTTP
routing/response latency, not browser-to-network-server latency. Admin/Owner response
equivalence was validated by the separate authenticated tests, not inferred from Guest.

Medians are computed independently; displayed medians need not subtract to the paired
added-time median. Results show diagnostic overhead, not an algorithm speedup. Larger
trees add material full-build cost even though individual tree queries are cheap. Remote
database round trips, deployed log I/O, real histories, permissions, deployment load,
and clock/state invalidations can increase overhead or inconclusive rates.

## Step 4B readiness

**Step 4A validation gate passed for proceeding to a separately scoped, controlled
Step 4B shadow-validation/rollout stage.** SQL must remain authoritative; the default-OFF
switch was preserved and no deployed setting was enabled.

Remaining concerns before broader rollout or any authoritative activation:

- The extra 46 SELECTs and full per-request tree build have measurable cost; production
  latency, logging, and acceptable inconclusive rates still need controlled deployment
  measurements and explicit acceptance criteria.
- Real replicas/pools/failover, custom RLS, production-equivalent triggers/permissions,
  and the full migrated reservation schema/lifecycle were not tested here.
- Authentication checks used real session/routing code in an isolated in-process app;
  browser login, TLS, cookie encryption, CSRF mutation flows, and a deployed HTTP server
  remain outside this validation.
- No result proves booking mutation atomicity or supports replacing current conflict
  checks/locks. No PBL cleaning or opportunity-release policy was activated.

There is no remaining disposable-PostgreSQL availability blocker. No Step 4B actions
or customer-facing/authoritative activation were performed.
