# Algorithm 1 — Step 3A (November 22, 2026)

Status: standalone interval preparation and comparison only. No endpoint uses this
service. The existing augmented interval tree and compatibility tests are preserved.
The November 22 rules supplied in the task are the specification for this step;
no separate updated PBL document was available locally or through connected documents.

## Files added

- `app/Services/Algorithms/ReservationIntervalMode.php`: explicit CURRENT/PBL selection.
- `app/Services/Algorithms/ReservationIntervalNormalizer.php`: half-open boundaries,
  Manila normalization, and one 120-minute overnight cleaning extension.
- `app/Services/Algorithms/PblIntervalPolicy.php`: isolated cleaning IDs and verified
  staff-release fixture metadata, independent of persisted reservation state.
- `app/Services/Algorithms/ReservationIntervalTrees.php`: separate BLOCKED/QUEUE
  trees and BLOCKED-first boolean classification; no queue-position or FIFO logic.
- `app/Services/Algorithms/ReservationIntervalTreeBuilder.php`: read-only preparation
  and fresh tree construction from authoritative tables.
- `tests/Support/ReservationIntervalFixtures.php`: disposable SQLite schemas and fixtures.
- `tests/Unit/ReservationIntervalTreeBuilderTest.php`: service compatibility, policy
  boundaries, independent SQL reference, and read-only evaluation checks.
- `tests/Benchmarks/reservation-interval-trees.php`: reproducible PHP cost measurements.
- `docs/algorithm-1-step-3a.md`: this implementation and validation report.

No existing files were edited. In particular, the existing tree, node, tree tests,
compatibility tests, controllers, routes, migrations, UI, payment handling,
expiration, cleaning, and FIFO promotion implementations were not changed.
Pre-existing untracked work remains in place. No commits or pushes were made.

## Service contract

Laravel can resolve `ReservationIntervalTreeBuilder` through the existing database
connection binding. `build(villaId, asOf)` defaults to CURRENT comparison behavior.
`build(villaId, asOf, ReservationIntervalMode::Pbl, policy)` requires an explicit
`PblIntervalPolicy`. Supplying PBL metadata to CURRENT mode is rejected.

The builder issues one parameterized `UNION ALL SELECT` over reservations,
opportunities, unreleased administrative blocks, and (in PBL mode) approved oculars.
On PostgreSQL this uses one statement snapshot. An `EXISTS` subquery protects a
reservation once even if multiple matching opportunities exist. Distinct duplicate
reservations remain distinct intervals. All queries are scoped to the requested villa.
Date/time boundaries are cast to text before the union: block dates must retain
Manila midnight semantics rather than inherit a database session timezone through
implicit conversion to `timestamptz`.

`prepare()` exposes the two normalized interval lists so extraction/normalization
and tree construction can be measured separately. Every build reads authoritative
records again. There is no persistent cache, table mutation, migration, expiry call,
promotion call, or lock acquisition. A built object is only an ephemeral snapshot;
it must not be treated as a later authoritative availability decision.

`classify(rawStart, rawEnd, type, requiresCleaning)` normalizes a new proposal once.
`classifyEpoch(start, end)` accepts already-normalized whole-second boundaries and
does not apply cleaning. Stored intervals are always derived from raw database
boundaries. Neither operation modifies the tree or the database. Passing previously
extended timestamps as raw inputs violates the contract; timestamps alone cannot
prove that a caller has already added cleaning.

Naive timestamps and administrative date boundaries use Asia/Manila. Explicit UTC
and numeric offsets represent absolute instants. Invalid/reversed/empty intervals,
relative timestamps, invalid dates, and nonzero fractional seconds fail explicitly.
The preserved tree indexes integer seconds; subsecond precision is rejected instead
of silently truncated. A malformed protected record aborts the build.

## CURRENT versus PROPOSED PBL

CURRENT refers specifically to `ReservationAvailability::forInterval()`. The
separate mutation-time `ReservationWorkflow::available()` has different opportunity
predicates; the existing compatibility suite continues to document those differences.

| Record or boundary | CURRENT calendar comparison | PROPOSED PBL comparison |
| --- | --- | --- |
| Confirmed / legacy reserved stay | BLOCKED through raw end | BLOCKED; overnight requiring cleaning extends raw end by 120 minutes |
| Payment review | QUEUE, regardless of opportunity deadline | QUEUE; same cleaning policy |
| Held / awaiting deposit | QUEUE only with active opportunity whose deposit deadline is strictly after `asOf` | QUEUE with active or expired opportunity unless that opportunity has verified Admin/Owner release evidence |
| Expired reservation with expired opportunity | Ignored | QUEUE until verified Admin/Owner release |
| Opportunity `closed_at` set during expiry | Active status/deadline govern calendar classification | Closing/expiry alone is not verified release |
| Approved ocular | Ignored | BLOCKED for its exact visit time, with half-open boundaries |
| Pending / cancelled ocular | Ignored | Ignored |
| Day tour, including one with a cleaning flag | Raw end | Raw end; never extended |
| Fixed unreleased administrative block | Manila midnight date interval | Same fixed interval; never extended |
| Newly proposed overnight requiring cleaning | Raw proposal end | Proposal end plus 120 minutes, exactly once per raw normalization |
| 11 AM overnight checkout; day use starts at noon | No raw overlap | Cleaning conflict until 1 PM |
| Same checkout; day use starts at exactly 1 PM | No raw overlap | No overlap at the half-open cleaning boundary |
| Both trees overlap proposal | BLOCKED | BLOCKED |

Pending, queued, cancelled, rejected, and completed reservations do not become
protected merely because a stale opportunity exists. A release targets only its
opportunity ID; another unreleased opportunity still protects that stay. Releasing
an opportunity does not remove a confirmed or payment-review commitment or promote
a waiting request. These policy differences are intentional, not algorithm errors.

## Focused validation

Run from `apps/api`:

```powershell
php -d extension=pdo_sqlite vendor/phpunit/phpunit/phpunit --filter 'AugmentedIntervalTreeTest|ReservationIntervalTreeCompatibilityTest|ReservationIntervalTreeBuilderTest'
```

Result: **181 tests, 12,653 assertions passed**, PHP 8.4.27 / PHPUnit 11.5.57.
The existing suites are included unchanged. New coverage includes stored AND
proposed cleaning, noon/1 PM equality and one-second overlap, duplicate intervals,
BLOCKED/QUEUE precedence, verified/unverified/guest release evidence, unreleased
expired opportunities, timed oculars, fixed blocks, villa isolation, mixed offsets,
invalid raw intervals, one-SELECT builds, no evaluation I/O, and fresh rebuilds.
An independent SQLite SQL projection derives intervals directly from raw mixed
records and compares both tree flags and classification for 250 proposals.

Fixtures use a literal `sqlite::memory:` DSN and Composer autoloading only. They do
not boot Laravel, load `.env`, run migrations, or access production records/secrets.
Fixture setup writes occur only in the disposable test database. Tree preparation
and evaluation issue no database writes. Pint passed for all eight new PHP files.

## PHP benchmark

```powershell
php -d extension=pdo_sqlite tests/Benchmarks/reservation-interval-trees.php
```

November 22 local sample: PHP 8.4.27, Windows, SQLite `:memory:`, one warm-up and
seven measured runs per size/mode. Values below are median milliseconds. Each
dataset is 50% confirmed / 50% payment-review overnight reservations; all stays
require cleaning in PBL mode. The fixture has no administrative blocks, oculars,
or opportunity-history rows. The 1,000 day-tour proposals yield 333 BLOCKED,
334 QUEUE, and 333 AVAILABLE results. Every result is checked against its expected
fixture classification. Fixture insertion is outside measured work.

| Mode | Protected records | Read + normalize | Build BOTH trees | 1,000 queries of BOTH trees | 1,000 raw proposal classifications | Read + build + 1,000 classifications |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| CURRENT | 100 | 3.992 | 0.147 | 1.516 | 34.489 | 38.910 |
| PBL | 100 | 3.923 | 0.136 | 1.469 | 33.153 | 37.255 |
| CURRENT | 1,000 | 35.671 | 1.701 | 2.273 | 34.203 | 73.232 |
| PBL | 1,000 | 36.037 | 1.740 | 2.306 | 36.255 | 74.195 |
| CURRENT | 10,000 | 374.726 | 24.507 | 3.322 | 37.960 | 435.565 |
| PBL | 10,000 | 354.369 | 23.343 | 3.299 | 36.353 | 414.336 |

The BOTH-query column performs two overlap lookups per proposal, even if BLOCKED
would permit classification to stop early. Raw classification includes timestamp
normalization and BLOCKED-first short-circuiting. The final column includes
read/normalization, BOTH builds, and classifications, but not the additional
diagnostic BOTH-query batch. Medians are calculated per column; the median total
need not equal the sum of the other medians.

For `b` BLOCKED intervals and `q` QUEUE intervals, combined tree construction is
`O(b log b + q log q)` with `O(b + q)` tree storage; boolean classification requires
at most two `O(log m)` overlap searches. Extraction and normalization are additional
costs, and database query-plan cost is separate. A single proposal after a fresh
build pays extraction plus construction as well as its query cost. These fixtures
do not measure PostgreSQL execution/network latency, real opportunity histories,
production contention, or a SQL baseline. There is **no measured production
speedup claim and no transfer of a Python speedup to Laravel**.

## Remaining limits and blockers

- No production activation is part of Step 3A. PostgreSQL remains authoritative;
  actual PostgreSQL execution and production performance were not exercised.
- The schema has no authoritative `requires_cleaning` flag or verified staff
  opportunity-release event. The isolated policy therefore accepts explicit
  cleaning reservation IDs and trusted release evidence supplied by a comparison
  caller. An empty cleaning list means no stay was declared to require cleaning;
  it is not evidence that all real stays need no cleaning. Missing release evidence
  keeps active/expired opportunities protected.
- `PblIntervalPolicy` checks `verified === true` and an `admin`/`owner` role, but
  does not itself verify actor identity or authenticate that evidence. Current
  role, `granted_by`, deadline, and `closed_at` do not prove release. A future
  authoritative verification source would be needed before any production use;
  this step adds no schema or release workflow.
- The full separate November 22 PBL document was unavailable. This implementation
  covers the explicit task rules; no claim is made about additional unseen rules.

Step 3A stops here. Customer-facing endpoints continue to use existing decisions.
