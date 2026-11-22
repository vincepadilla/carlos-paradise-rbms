# Algorithm 1 — Step 3C: shadow audit and optimization

Completed November 22, 2026. SQL remains authoritative and shadow diagnostics remain
default-OFF. No customer-facing algorithm activation or Step 4 work was performed.

## Exact files changed in this step

Modified:

- `app/Services/Algorithms/AvailabilitySnapshotReader.php`: adds a local, SQL-free
  `context()` contract for supported connection/autocommit identity.
- `app/Services/Algorithms/PostgresAvailabilitySnapshotReader.php`: implements that
  context, rejects connection changes during a probe, and includes database role,
  search path, and row-security setting in the opaque snapshot identity.
- `app/Services/Algorithms/ReservationAvailabilityShadow.php`: chains verified
  snapshot lower bounds, retains post-SQL and post-build verification, adds snapshot
  counters, and classifies snapshot failures as INCONCLUSIVE.
- `tests/Support/AvailabilityShadowTestEnvironment.php`: supplies an explicitly
  controlled connection context for disposable test fixtures.
- `tests/Unit/ReservationAvailabilityShadowTest.php`: adds audit/regression coverage
  and updates diagnostic expectations for conservative invalidation and snapshot errors.
- `tests/Benchmarks/reservation-availability-shadow.php`: additionally counts actual
  fixture SQL queries outside timed samples.

Created:

- `tests/Support/IsolatedAvailabilityHttpApplication.php`
- `tests/Unit/ReservationAvailabilityShadowHttpTest.php`
- `docs/algorithm-1-step-3c.md`

`ReservationAvailability.php`, `AppServiceProvider.php`, `config/algocom.php`, and the
Step 3A tree/builder/policy sources were inspected but not edited in Step 3C. Existing
Step 3B modifications still appear in the uncommitted worktree; they are not new
changes from this step. Controllers, routes, middleware, migrations, UI, reservation
workflow, payments, cleaning, expiry/release, and FIFO code were not changed. No
`.env`, configuration activation, actual application records, or Git history was changed.

## Audit findings and correctness boundary

PostgreSQL Read Committed gives each SELECT its own view of committed records;
successive reads can therefore disagree when a concurrent transaction commits.
Repeatable Read stabilizes a transaction's snapshot, but that transaction still sees
its own writes. These semantics are documented in the
[PostgreSQL isolation reference](https://www.postgresql.org/docs/17/transaction-iso.html).

The snapshot identity describes transaction visibility through xmin, xmax, and
in-progress transaction IDs. It is neither a calendar-specific revision nor a row
lock. PostgreSQL documents its contents in the
[snapshot function reference](https://www.postgresql.org/docs/17/functions-info.html#FUNCTIONS-PG-SNAPSHOT).

Implementation inference under the supported primary/autocommit connection scope:
if a previously verified visibility identity and a later verification are equal,
the intervening ordinary reads of the authoritative reservation tables have the
same committed visibility. The preceding verification need not occur immediately
before each individual date check. This is the basis for the optimization, rather
than an assumption that request-local trees are always current.

The guard remains conservative:

- No isolation setting is changed, and no transaction or lock is introduced. Any
  existing Laravel or raw PDO transaction is unsupported and yields INCONCLUSIVE,
  regardless of isolation level. This avoids relying on snapshot equality in the
  presence of own writes and avoids aborting caller transactions on diagnostic failure.
- Primary PostgreSQL/autocommit connections are the supported scope. SQLite,
  standby/recovery connections, unavailable snapshot functions, and missing identities
  cannot produce conclusive comparisons through the real reader.
- Connection/PDO context is checked locally before reusing a lower bound and around
  each snapshot probe. Backend/server identity remains part of the token, protecting
  against ordinary backend changes and reconnects.
- Role, search path, and row-security settings are now included in the token because
  they can change visible records without changing reservation transaction IDs.
  This is not a claim to detect every possible custom RLS policy or arbitrary
  mid-call session reconfiguration. Pool/failover and deployed schema behavior still
  require controlled PostgreSQL validation.
- Opportunity comparisons use the existing second-precision clock guard. A change
  during authoritative SQL makes the observation INCONCLUSIVE. A new deadline second
  requires a new tree before comparing again; construction uses the captured `asOf`.
- Unsupported timezone/subsecond/invalid query boundaries remain INCONCLUSIVE without
  changing what the SQL service accepts or returns.

Unrelated database activity can also change identity and cause INCONCLUSIVE. This
is intentional. The index does not prove atomic booking decisions or replace existing
mutation-time SQL/locking. `availableNights()` remains outside shadow comparison
because its current date/block semantics differ from `forInterval()`.

## Why 87 probes became 45

Step 3B used two probes for each of 43 checks plus one after construction:
`2 * 43 + 1 = 87`, followed by one tree-record SELECT outside that probe count.

Step 3C keeps the first pre-SQL probe, every post-SQL probe, and every post-build
probe. Subsequent checks can reuse the last verified snapshot as a lower bound only
while the local connection/autocommit context remains supported. They still require
a fresh post-SQL verification before any classification comparison is recorded.

For a stable request with one build, probes are now `1 + 43 + 1 = 45`. The builder's
single SELECT and both trees are unchanged. This eliminates 42 redundant queries.

When the post-SQL token differs, that check is INCONCLUSIVE; it cannot be known
whether the change happened before or during SQL. The new verified token can bound
the next check, which builds against the new state once stable. This may produce
more INCONCLUSIVE checks after changes between dates than Step 3B, and never upgrades
an uncertain result to MATCH or MISMATCH.

Null identity, probe failure, transaction entry, or unsupported context discards the
tree and lower bound. Reconnection requires establishing another valid bound. A
failed tree build remains suppressed for its snapshot/deadline key, preventing
repeated failed construction on every date. All state remains request-scoped.

Removing the post-SQL verification, treating a request as an immutable database
snapshot, or introducing global Repeatable Read would not preserve the required
comparison/behavior guarantees and was not implemented. Combining snapshot metadata
with the tree SELECT could remove another round trip, but would require changing
the preserved builder/query contract; that is outside this diagnostics-only change.

## Default-OFF and exception behavior

The flag remains `algocom.availability_shadow.enabled`, default false, sourced from
`ALGOCOM_AVAILABILITY_SHADOW_ENABLED`. No setting was activated.

Tests compare complete SQL statements and bindings with the uninstrumented service,
including 43-check requests. OFF mode resolves no shadow coordinator and performs
no context reads, probes, construction, logging, counters, or shadow timing work.
An OFF HTTP request after an enabled request also adds no diagnostic work or queries.
This establishes zero extra database/diagnostic work, not a claim about zero CPU
instructions for the pre-existing optional hook/configuration check.

The SQL result remains the return value. Snapshot errors are now INCONCLUSIVE with
reason `snapshot_error` and a separate `snapshot_failures` counter; warnings remain
safe and contain no exception messages. Algorithm errors retain diagnostic ERROR
status. Initialization/logger error fallback and original SQL-error propagation
remain as implemented in Step 3B. Queue counts/positions and API fields are untouched.

Diagnostic counters now include `snapshot_probes`, `snapshot_reuses`, and
`snapshot_failures`. Reuse counts lower-bound reuse, not a guaranteed tree reuse.
Tokens and connection context are never logged. Counts remain request-local and
cumulative; they are not customer response fields.

## Actual automated results

Before changes: **238 tests / 13,544 assertions passed**.

After changes: **262 tests / 13,888 assertions passed**, PHP 8.4.27 / PHPUnit 11.5.57,
1.763 seconds and 40 MB in the final focused run. This adds 24 cases while retaining
the Step 1–3B suites. Pint passed for all eight changed/created PHP files;
`git diff --check` passed.

Run from `apps/api`:

```powershell
php -d extension=pdo_sqlite vendor/phpunit/phpunit/phpunit --do-not-cache-result --filter 'AugmentedIntervalTreeTest|ReservationIntervalTreeCompatibilityTest|ReservationIntervalTreeBuilderTest|ReservationAvailabilityShadow'
```

Coverage includes:

- 43 stable checks: **43 MATCH, 0 MISMATCH, 1 build, 45 probes, 42 reused lower bounds**.
- A simulated concurrent fixture commit between two original SQL reads: that
  response remains the original SQL value, comparison is INCONCLUSIVE, and the next
  stable call rebuilds and matches. Concurrent changes after SQL/during construction
  and between calls are also covered.
- Probe exceptions after SQL, after building, and with a cached tree: INCONCLUSIVE,
  zero false mismatches, original responses, invalidated reuse, and successful recovery.
- Transaction entry, connection replacement, backend changes, and role/schema
  visibility changes cannot silently reuse a prior comparison identity.
- Algorithm, initialization, and logger failures still return original responses;
  failed builds are not repeated for every date in the same state. Query logs and
  fixture comparisons establish that diagnostic evaluation itself performs no writes.
- The intentionally injected legacy mismatch is still detected; no unexpected
  mismatch occurred.

Fourteen HTTP cases use the real routes, Laravel session guard, Eloquent user/role
provider, StartSession, Authenticate, throttling, and existing guest/Admin/Owner
authorization middleware. Verified Guest, Admin, and Owner receive identical enabled
and disabled calendar JSON. Unauthenticated requests return 401; unverified guests
and wrong/inactive staff access to protected staff routes return 403 before shadow
evaluation. Invalid authorized requests retain 422 JSON. Algorithm and snapshot
failures retain the original authenticated API JSON.

The HTTP harness deliberately skips environment/configuration/package bootstrap.
It uses a literal SQLite `:memory:` database, array sessions/cache, fixture users,
and in-memory diagnostics. Session credentials are created inside the test; no login
passwords, actual sessions, secret keys, or application records are read. Cookie
encryption, browser login, CSRF mutation requests, and a live server are not exercised.
The fixture transport uses a session-ID cookie; it is not a replacement authentication
implementation or a production configuration change.

## Query counts and measured time

Both measurements were run serially, without tests/Pint running concurrently, on
Windows/PHP 8.4.27 with one warm-up and seven measured samples per fixture size.
The same benchmark used the original Step 3B implementation before edits and the
optimized implementation afterward. Each request performs 43 checks, with 50%
confirmed / 50% payment-review stored records. The clock is frozen for stable reuse.
Each probe executes a real local `SELECT 1` in place of PostgreSQL metadata functions.
The logger is in memory; fixture construction is outside timed work.

```powershell
php -d extension=pdo_sqlite tests/Benchmarks/reservation-availability-shadow.php
```

Stable-request query counts:

| Work | Step 3B | Step 3C |
| --- | ---: | ---: |
| Original SQL SELECTs in this fixture | 186 | 186 |
| Snapshot probes | 87 | 45 |
| Tree-record SELECTs | 1 | 1 |
| Extra SELECTs with diagnostics | 88 | 46 |
| Total SELECTs | 274 | 232 |
| Extra SELECTs with diagnostics OFF | 0 | 0 |

The before probe count was recorded by the original benchmark; before total is the
unchanged fixture's SQL count plus those measured probes and tree read. The updated
benchmark additionally logs/counts actual SELECT totals outside timed samples. Counts
depend on queue cases and remain larger if clock/state changes cause additional builds.

Median milliseconds per 43-check request:

| Records | SQL only before / after | Enabled before / after | Added time before / after |
| --- | ---: | ---: | ---: |
| 100 | 25.022 / 23.132 | 30.614 / 28.220 | 5.592 / 4.876 |
| 1,000 | 35.644 / 28.635 | 57.507 / 41.712 | 23.298 / 12.833 |
| 10,000 | 82.799 / 82.984 | 183.299 / 187.469 | 99.784 / 104.639 |

Full extraction/normalization/both-tree-build medians before/after were
1.261/1.139 ms, 10.421/9.268 ms, and 96.149/99.076 ms respectively. The 43 tree-query
totals were 0.156/0.130 ms, 0.277/0.155 ms, and 0.226/0.211 ms.

Each measured request, before and after, produced **43 matches, 0 mismatches,
0 inconclusive, 0 errors, 1 build**. Paired added-time medians are calculated per
sample and need not equal the difference between displayed medians.

The query reduction is deterministic; a universal runtime speedup is not established.
At 10,000 records the after run was slightly slower, with full-tree preparation
dominating cost. The SQL-only timings also vary between runs. These local results
do not measure PostgreSQL round trips, MVCC-function work, deployment load, real
opportunity histories, or disk/network logging. No production or Python-derived
speedup is claimed.

## PostgreSQL test availability and rollout verdict

No existing independently verified disposable PostgreSQL test target was identified
in repository test infrastructure. No PostgreSQL connection was attempted, no
application connection settings or `.env` were read, and no PostgreSQL instance or
test database was created. Real PostgreSQL execution and inter-connection concurrency
remain unverified. Identity/transaction behavior is unit-tested with mocked PostgreSQL
connections and controlled SQLite fixture changes, not represented as live PG proof.

**Ready for controlled isolated/staging validation; keep live rollout OFF.** Before
enabling live diagnostics, separately verify a disposable PostgreSQL target and the
deployment's primary/read-pool behavior, then exercise actual concurrent commits,
transaction refusal, probe failures, clock boundaries, and logging/latency limits.
Busy systems may legitimately produce many INCONCLUSIVE observations. These are
neither successful matches nor algorithm errors.

There is no blocker to completing Step 3C itself. The remaining evidence gaps block
a confident live rollout or authoritative/customer-facing activation. No tree result
has become authoritative, and no PBL policy change has been activated.
