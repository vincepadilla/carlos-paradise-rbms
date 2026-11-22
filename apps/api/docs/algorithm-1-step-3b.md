# Algorithm 1 — Step 3B: safe shadow integration

Implemented November 22, 2026. Shadow mode is **OFF by default**. PostgreSQL SQL
availability remains authoritative. No Step 4 activation is included.

## Exact files changed in Step 3B

Modified:

- `app/Services/ReservationAvailability.php`: optional observation hooks immediately
  before and after the original `forInterval()` logic. Existing SQL predicates,
  precedence, counts, queue positions, and returned fields are retained. Pint also
  normalized imports and existing whitespace/braces; `availableNights()` behavior
  is unchanged and is not shadowed.
- `app/Providers/AppServiceProvider.php`: request-scoped bindings for availability
  and its shadow coordinator, lazy CURRENT tree construction, and safe initialization
  fallback.

Created:

- `app/Services/Algorithms/AvailabilitySnapshotReader.php`
- `app/Services/Algorithms/PostgresAvailabilitySnapshotReader.php`
- `app/Services/Algorithms/ReservationAvailabilityShadow.php`
- `config/algocom.php`
- `tests/Support/AvailabilityShadowTestEnvironment.php`
- `tests/Unit/ReservationAvailabilityShadowTest.php`
- `tests/Benchmarks/reservation-availability-shadow.php`
- `docs/algorithm-1-step-3b.md`

The Step 3A sources, tests, benchmark, and report were inspected and preserved.
Controllers, routes, authorization middleware, migrations, React, status transitions,
payments, expiration, cleaning rules, and FIFO/promotion code were not modified.
All work remains uncommitted. Existing unrelated untracked work was retained.

## Configuration and authoritative result

`config/algocom.php` exposes `algocom.availability_shadow.enabled`, sourced from
`ALGOCOM_AVAILABILITY_SHADOW_ENABLED` with a default of `false`. No environment file
or deployed configuration was changed. Opt-in configuration would use:

```text
ALGOCOM_AVAILABILITY_SHADOW_ENABLED=true
```

Normal Laravel configuration-cache deployment rules apply. Enabling this setting
does not make tree results authoritative. With the setting OFF, the provider supplies
no shadow object: no snapshot SELECTs, tree builds, timers, counters, or diagnostic
events execute. Direct existing `new ReservationAvailability` callers also retain
the original behavior.

When enabled, `forInterval()` runs its original SQL logic and computes its original
`['availability' => ..., 'queue_position' => ...]` array. The shadow sees only the
classification and cannot replace the return value. Calendar `dates` responses and
quote callers continue to receive their existing fields. Queue positions still use
the original SQL count, including waiting requests and duplicate holds.

The tree factory explicitly selects `ReservationIntervalMode::Current`, with no PBL
policy supplied. The coordinator also rejects any returned PBL-mode tree. No
cleaning extension, ocular protection, or verified-release policy is activated.

## Equivalent-state comparisons

The existing SQL code performs several separate reads and samples the opportunity
clock itself. Changing those queries, freezing the original clock, or introducing
transactions/locks would change the baseline being observed. Instead, the shadow:

1. Captures a PostgreSQL snapshot identity before the unchanged SQL reads.
2. Checks snapshot identity again after all authoritative reads, including queue count.
3. For a new tree, reads protected records through the preserved Step 3A builder's
   single SELECT, then verifies snapshot identity once more.
4. Compares classifications only after those checks pass.

The opaque identity includes `pg_current_snapshot()`, backend PID, server start time,
and server address/port. Backend changes or reconnects therefore invalidate reuse.
The underlying snapshot functions are documented in the
[PostgreSQL system information reference](https://www.postgresql.org/docs/17/functions-info.html#FUNCTIONS-PG-SNAPSHOT).
Identity is held in memory only and never logged.

The SQL opportunity clock must remain in the same second from the initial observation
through completion of the original queries. Tree construction uses that captured
`asOf` explicitly, even if building takes longer. Reuse requires both snapshot identity
and this deadline second to match. A new second or changed state requires a fresh
tree before another comparison can be conclusive.

If visibility changes during SQL or tree construction, the result is **inconclusive**,
not a mismatch. Unrelated database transactions can also invalidate the identity;
this intentionally favors inconclusive observations over false mismatch reports.

Existing transactions are declined, including raw PDO transactions: snapshot equality
cannot prove the absence of their own writes, and shadow query failures must not
abort a caller's transaction. No transaction, isolation change, row lock, or advisory
lock is introduced. Non-PostgreSQL connections, standby/recovery connections,
unsupported snapshot functions, and unavailable identities cannot produce conclusive
comparisons. This guard supports PostgreSQL primary connections only.

Comparisons also require positive whole-second intervals with Manila UTC offsets.
Other inputs are marked inconclusive because the original block logic uses the
caller's date and `end->subSecond()`. This does not reject or modify the SQL request.
Malformed stored records that the integer-second tree cannot represent produce a
safe diagnostic error, while the SQL result is retained.

## Request reuse and failures

Both availability and shadow coordinator use Laravel scoped bindings. One request
can share a prepared pair of trees across all calendar-date checks while the guards
remain valid. Scoped instances are discarded between requests, including framework
scoped lifecycle resets used by long-running workers. There is no static, shared,
or persistent tree cache.

A failed build is remembered only for its current snapshot/deadline-second key so
43 dates do not trigger 43 repetitions of the same failed extraction/build. A changed
key permits another attempt. Snapshot invalidation discards previously usable trees.

Snapshot, normalization, tree, initialization, and logger failures are caught within
the diagnostic path. The SQL result remains unchanged. Original SQL failures are
still propagated; diagnostics do not hide authoritative database errors.

## Diagnostics and privacy

Enabled comparisons emit `reservation_availability_shadow` through the existing
application logger. Match and inconclusive outcomes use `info`; mismatches and
errors use `warning`. Initialization errors emit a safe warning when logging works.

Per-comparison context contains only outcome/reason codes, SQL/tree classification,
SQL duration, full tree preparation/build duration, tree query duration, shadow work
duration, and request-local counters. It contains no guest names, contact details,
payment data, credentials, booking IDs, requested dates, snapshot tokens, exception
messages, SQL bindings, or stack traces. Logger filtering can suppress events; an
enabled deployment must retain `info` events to collect successful-comparison metrics.

Counters include comparisons, matches, mismatches, inconclusive observations, errors,
build attempts, successful constructions, and logger failures. The `counts` payload
is cumulative within the request; aggregate outcomes by counting events rather than
summing these cumulative values. Diagnostic fields never enter customer responses.
`shadow_ms` excludes the original SQL and final logger call. The benchmark's wall
clock includes the configured fixture logger. If logging itself fails, its failure
counter remains request-local; diagnostics never escalate that failure to callers.

## Focused automated validation

Run from `apps/api`:

```powershell
php -d extension=pdo_sqlite vendor/phpunit/phpunit/phpunit --do-not-cache-result --filter 'AugmentedIntervalTreeTest|ReservationIntervalTreeCompatibilityTest|ReservationIntervalTreeBuilderTest|ReservationAvailabilityShadowTest'
```

Final result: **238 tests, 13,544 assertions passed**, PHP 8.4.27 /
PHPUnit 11.5.57. This includes the preserved Step 1–3A suites and 57 new shadow test
cases. Pint passed for all nine Step 3B PHP files; `git diff --check` passed.

Observed test counts include:

- All **32 existing CURRENT fixture cases matched**, including BLOCKED precedence,
  active/expired opportunities, cleaning adjacency, and duplicate queue counts.
- **43/43 calendar checks matched with one build**, zero mismatches, and SELECT-only
  query logs. Fixture records remained unchanged.
- **3/3 controller date checks matched with one build** and identical status/JSON,
  retaining the original `dates` response shape.
- **1 deliberately injected BLOCKED-versus-QUEUE mismatch** was detected and logged;
  the original BLOCKED SQL response was returned. No unexpected mismatch was observed.
- A controlled fixture change after SQL produced **1 inconclusive / 0 mismatches**;
  the next stable call rebuilt and matched the updated SQL state.
- One simulated failed build across 43 checks produced **43 diagnostic errors but
  only 1 build attempt**, preserving all 43 SQL responses.

Additional tests cover OFF-mode query equivalence and absence of diagnostic work,
snapshot changes during construction, unsupported snapshots/inputs, deadline-clock
changes, scope resets, backend identity changes, initialization/logger/snapshot errors,
real normalization failure, standby refusal, PBL-mode rejection, and original SQL
exception propagation.

Tests use literal disposable SQLite DSNs and a minimal container. They do not boot
Laravel, load `.env`, run migrations, read secrets, or connect to application databases.
Stable/moving PostgreSQL identities are simulated under controlled fixtures. The real
PostgreSQL reader's SELECT-only contract, backend changes, and transaction refusal are
unit-tested with a mocked connection. The controller contract test invokes the real
controller directly; it does not claim live authentication/middleware coverage.

## Measured overhead

```powershell
php -d extension=pdo_sqlite tests/Benchmarks/reservation-availability-shadow.php
```

Final serial sample: Windows, PHP 8.4.27, SQLite `:memory:`, one warm-up plus seven
measured runs per size. Each simulated request checks 43 intervals against the
unchanged SQL service. Records are 50% confirmed and 50% payment-review stays. The
clock is frozen to isolate same-state request reuse. Each snapshot probe executes
a real local `SELECT 1` through the fixture connection, supplying a controlled
stable test identity. Logging uses an in-memory sink. Fixture insertion is excluded.

Values are median milliseconds:

| Protected records | SQL only, 43 checks | SQL + shadow, 43 checks | Added time, paired median | Full read/normalize/build | All 43 tree queries |
| --- | ---: | ---: | ---: | ---: | ---: |
| 100 | 23.493 | 30.599 | 7.107 | 1.131 | 0.155 |
| 1,000 | 31.134 | 46.419 | 15.285 | 9.463 | 0.171 |
| 10,000 | 98.448 | 201.255 | 104.132 | 103.608 | 0.243 |

All benchmark requests recorded **43 matches, 0 mismatches, 0 inconclusive, 0 errors,
and 1 build**. There are **87 snapshot probes plus 1 tree-record SELECT** beyond
the original queries: three probes for the first comparison and two for each reused
comparison. A single first comparison adds three probes plus the tree SELECT.
Medians are computed separately; the paired median increase need not equal the
difference between the displayed wall-time medians.

These are measured local PHP/SQLite overheads, not production PostgreSQL latency.
Actual PostgreSQL network round trips, snapshot function work, logging I/O, larger
opportunity histories, contention, and clock-boundary invalidations can add overhead
or reduce conclusive comparisons. Tree build includes extraction/normalization and
both constructions; there is no hidden prebuilt-tree assumption. No production or
Python-derived speedup is claimed.

## Remaining limits before authoritative integration

- Step 3B is complete with its switch OFF. Enabling it in a deployed environment
  was not part of this execution, and no live comparison counts were collected.
- PostgreSQL execution, real concurrent transactions, read-replica/pool behavior,
  deployed logger latency, and live HTTP authorization have not been exercised.
  They require separate controlled validation before considering authoritative use.
- PostgreSQL versions without `pg_current_snapshot()` cannot establish conclusive
  comparisons through this reader. Their probe failure is diagnostic only.
- The conservative guard has material extra round-trip cost. Busy databases can
  yield many inconclusive observations; these must not be counted as matches or
  algorithm errors. Current tests/benchmarks establish no production performance benefit.
- The shadow index makes no claim about booking atomicity or authorization and
  cannot replace existing mutation-time SQL checks or locks. `availableNights()` has
  different date semantics and remains outside this comparison.
- Step 3A PBL cleaning/release metadata questions remain separate and unchanged;
  this integration uses CURRENT policy exclusively.

Stop: no authoritative tree decisions or Step 4 changes were made.
