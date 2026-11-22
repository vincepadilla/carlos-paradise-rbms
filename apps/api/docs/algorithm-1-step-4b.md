# Algorithm 1 — Step 4B: controlled readiness validation

Completed November 22, 2026. **NO-GO for authoritative integration.** CURRENT
classification equivalence passed, but the tree does not implement the complete
availability/queue contract or mutation-time concurrency policy, and end-to-end
performance is not established. Shadow remains default-OFF and SQL authoritative.

## Exact files changed

Modified:

- `tests/Postgres/run-shadow-validation.ps1`: adds PostgreSQL-only `-Readiness`
  discovery and a guarded `-BenchmarkOnly` option. The existing disposable ownership,
  loopback verification, credential isolation, and cleanup safeguards are retained.

Created:

- `tests/Support/ReadinessBenchmarkDataset.php`: common deterministic mixed dataset,
  proposals, actual builder-query capture, and benchmark-only normalization phase split.
- `tests/Postgres/ReservationReadinessPostgresTest.php`: mixed-dataset parity,
  PostgreSQL fallback, PBL-mode rejection, mismatch detection, and OFF-mode/API checks.
- `tests/Postgres/ReservationPblPolicyPostgresTest.php`: explicitly labeled proposed
  PBL tests with an independent PostgreSQL projection over raw records.
- `tests/Postgres/readiness-worker.php`: fresh-process, phased timing/memory worker.
- `tests/Postgres/measure-readiness.php`: orchestrates six modes at three sizes and
  checks dataset checksums before saving measurements.
- `docs/algorithm-1-step-4b-results.json`: measured results, latest raw samples,
  preparation plans, counters, and the preserved initial run.
- `docs/algorithm-1-step-4b.md`: this report.

No production algorithm/service, availability endpoint, API contract, role/auth code,
booking rule, FIFO, payment, cleaning/release policy, React source, migration, or `.env`
was edited. Existing uncommitted changes from previous steps were retained. No commits,
pushes, application database connections, or customer activation occurred.

## Scope and disposable validation

Steps 3A, 3B, 3C and 4A sources/reports were reviewed, including the two-tree builder,
normalizer, CURRENT/PBL separation, snapshot lower-bound reuse, default-OFF provider
binding, and PostgreSQL fixture/HTTP harness.

All database-writing tests in this step ran only against new, verified disposable
PostgreSQL 16.4 clusters. The existing runner independently checked the process,
loopback listener and data directory before connecting, then checked the database
ownership marker before fixture writes. Each cluster was stopped and removed, and
the final cleanup check found no remaining owned temporary cluster directories.
No existing PostgreSQL service, application credentials, or environment file was used.

The prior SQLite-writing suites were retained but not rerun: this step explicitly
requires PostgreSQL for database-writing tests. Database-free tree tests ran separately.
The PostgreSQL fixtures use representative production timestamp/date types, relevant
indexes, actual Laravel services, the production shadow binding, real snapshot
functions, and session-authenticated routing. They are not a full migrated copy of
all production constraints, triggers, permissions, or deployment infrastructure.

Reproduce from `apps/api`:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests/Postgres/run-shadow-validation.ps1 -Readiness
```

`-Readiness -SkipBenchmark` runs the PostgreSQL cases only.
`-Readiness -BenchmarkOnly` repeats measurements only, still in a fresh owned cluster.
The process-specific execution-policy option does not change machine policy. Without
the verified disposable manifest, PostgreSQL tests skip rather than use application DBs.

## Actual automated results

| Suite | Tests passed | Assertions | Failed |
| --- | ---: | ---: | ---: |
| PostgreSQL CURRENT, readiness, and separately labeled PBL | 79 | 954 | 0 |
| Database-free augmented interval tree | 46 | 10,832 | 0 |
| Step 4B total | 125 | 11,786 | 0 |

The final PostgreSQL run took 19.210 seconds / 62 MB. The initial run, before adding
one additional PBL-mode rejection guard test, passed 78 tests / 950 assertions.
Pint passed for all five new PHP files. TypeScript `tsc -b`, Vite build with
`envDir:false`, and `git diff --check` passed. Vite transformed 201 modules and retained
its existing advisory for a minified chunk over 500 kB. No UI source was changed or
environment file loaded by the build.

Commands for the database-free and build checks:

```powershell
# apps/api
php vendor/phpunit/phpunit/phpunit --do-not-cache-result tests/Unit/AugmentedIntervalTreeTest.php
# apps/web
.\node_modules\.bin\tsc.cmd -b
node --input-type=module --eval "import('vite').then(({build}) => build({envDir:false}))"
```

CURRENT diagnostic counts across both PostgreSQL CURRENT test classes:

| Observation | Count | Interpretation |
| --- | ---: | --- |
| Comparisons | 365 | Includes deliberate diagnostic fault tests |
| MATCH | 352 | Valid CURRENT classifications |
| MISMATCH | 1 | Deliberately injected empty/wrong tree; detected without replacing SQL |
| Unexpected MISMATCH | 0 | No genuine parity discrepancy observed |
| INCONCLUSIVE | 10 | Seven real concurrency/transaction cases plus three injected probe failures |
| Diagnostic ERROR | 2 | Injected algorithm failure and rejected PBL-mode tree |
| Logger failure | 1 | Injected logging failure; valid SQL response preserved |

These expected diagnostic outcomes are not PHPUnit failures. Record snapshots and
query checks confirm that evaluation did not mutate reservations/opportunities.

The PBL group separately produced **28 PostgreSQL/tree matches** and **nine intentional
differences from CURRENT policy**. Its 20 test cases never enable PBL in shadow mode.

## CURRENT SQL versus Interval Tree comparison

| Booking scenario | Original SQL | CURRENT tree/shadow result |
| --- | --- | --- |
| No protected overlap | AVAILABLE | MATCH: AVAILABLE |
| Confirmed / legacy reserved overlap | BLOCKED | MATCH: BLOCKED |
| Held/awaiting deposit with active future-deadline opportunity | QUEUE | MATCH: QUEUE |
| Payment review | QUEUE | MATCH: QUEUE |
| Unreleased administrative block | BLOCKED | MATCH: BLOCKED |
| Both BLOCKED and QUEUE overlap | BLOCKED | MATCH: BLOCKED |
| Expired opportunity/deadline under CURRENT calendar rules | AVAILABLE when no other protection exists | MATCH; no proposed release retention |
| Adjacent half-open boundaries | AVAILABLE when no other protection exists | MATCH; equality is not overlap |
| Overlapping intervals | BLOCKED or QUEUE according to record state | MATCH; duplicate intervals retained |
| Queue positions and waiting counts | Existing SQL count/position | Original value returned unchanged; tree has no count/position implementation |
| Concurrent commit between SQL reads or during extraction | Original SQL result retained | INCONCLUSIVE; no false successful match |
| Existing reader transaction in three isolation levels | Own writes remain visible to original SQL | INCONCLUSIVE, zero snapshot probes, isolation unchanged |
| Guest/Admin/Owner calendar requests | Existing authorized JSON/status | Exact ON/OFF equality through real session/routing/provider code |
| Algorithm/probe/logger failure | Existing SQL response | Preserved; error or INCONCLUSIVE diagnostics only |
| Shadow OFF, including after ON | Original SQL statements/bindings and JSON | Zero additional SELECTs/builds/log events |

The 32 established CURRENT scenarios and real separate-connection concurrency cases
from Step 4A were rerun. The new mixed datasets add 43 identical proposals at each
size. UTC/offset records, Manila/UTC/New York sessions, admin midnight boundaries,
legacy states, pending/queued counts, and duplicate holds remain covered.

## Proposed PBL policy — separate evaluation only

| Policy fixture | CURRENT | Proposed PBL |
| --- | --- | --- |
| Qualifying stored overnight, 11 AM checkout, noon request | AVAILABLE | BLOCKED through cleaning |
| Same stay, request starts at exactly 1 PM | AVAILABLE | AVAILABLE |
| New qualifying overnight ends 11 AM before a noon protected interval | AVAILABLE | BLOCKED after adding 120 minutes to the new proposal |
| Day tour or fixed administrative block | Raw fixed end | Same end, no cleaning extension |
| Approved ocular during visit time | Ignored | BLOCKED only during the timed visit |
| Pending/cancelled ocular or adjacent visit boundary | Ignored/no overlap | No protection outside approved timed interval |
| Unreleased expired opportunity | Ignored | QUEUE until verified staff release evidence |
| Guest or unverified staff release evidence | Ignored | Does not release protection |
| Verified Admin/Owner release evidence | Ignored | Removes only that opportunity's proposed protection |

The independent SQL reference derives epochs/extensions directly from raw PostgreSQL
records and separately supplied policy facts. It never reads prepared tree inputs.
Repeated construction/query checks ensure cleaning is not accumulated. PBL evaluation
does not change stored times, statuses, opportunities, or promote waiting requests.
The existing policy accepts trusted fixture metadata; it is not an authenticated,
durable release/cleaning workflow. That persistence/verification gap remains unresolved.

## Benchmark design and fairness

For each of 100, 1,000 and 10,000 **protected intervals**, datasets contain equal
numbers of confirmed stays, payment-review stays, active opportunities/holds, and
administrative blocks. Expired reservations/opportunities add 10% non-protective
reservation rows to verify CURRENT exclusion. Physical source rows are therefore
1.45 times the protected count, excluding ownership metadata and HTTP auth tables. Every size has
one duplicated BLOCKED/QUEUE interval and 43 common proposals yielding **16 BLOCKED,
17 AVAILABLE, 10 QUEUE** results.

Each mode uses identical deterministic fixture bytes, verified by checksum. Each
dataset/mode runs in a separate PHP process to isolate peaks and retained objects.
Every batch rebuilds both trees; no persistent/prebuilt tree is hidden in the timing.
One warm-up and seven measured runs are used. Fixture loading, ANALYZE, reference
answers, query capture, EXPLAIN and worker/bootstrap startup are outside timers.

Modes and limits:

- `sql`: existing service including its SQL queue-position/count work.
- `tree_compute`: normalized intervals already in memory; timed work is BOTH builds
  plus all classifications. The excluded input's memory and preparation are disclosed.
- `tree_pipeline`: actual builder SELECT, conversion using the unchanged normalizer,
  BOTH builds and classifications. Before measurement, its prepared interval values
  are checked against the existing builder. It is a benchmark-only classification
  pipeline; it does not implement queue positions, authentication or an API endpoint.
- `shadow`: original SQL service plus actual CURRENT shadow guards/extraction/build/query.
- `http_sql` / `http_shadow`: complete in-process calendar route/response handling,
  including session/user resolution, validation, settings, SQL and JSON. Small benchmark
  result extraction is included equally. Application bootstrap and browser/server/TLS
  transport are excluded.

No tree-only customer endpoint exists or was created. Its complete authenticated API
latency is therefore **not available**; computation/pipeline timings cannot stand in
for that missing contract or justify an end-to-end activation speedup.

SELECTs and query-duration sums are counted through QueryExecuted events without
retaining query logs during timed work. Allocated-PHP peaks are reset per sample;
baseline scopes and prior HTTP trees are released before each measurement. Memory
figures exclude OS RSS, PostgreSQL server memory, and untracked native allocations.
See PHP's [peak-reset](https://www.php.net/manual/en/function.memory-reset-peak-usage.php)
and [allocation measurement](https://www.php.net/manual/en/function.memory-get-usage.php)
references. The in-memory log sink's retained diagnostic events are included.

## Measured phases and query counts

Latest run, median milliseconds for 43 proposals:

| Protected intervals | Tree compute: rebuild + queries | Fetch + normalize + rebuild + queries | SQL service | SQL + shadow service | SQL HTTP | SQL + shadow HTTP |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 0.186 | 1.799 | 112.974 | 121.564 | 108.176 | 128.889 |
| 1,000 | 2.511 | 11.453 | 97.586 | 134.655 | 108.557 | 146.266 |
| 10,000 | 28.215 | 115.903 | 103.690 | 246.212 | 116.359 | 2,332.731* |

*The large HTTP shadow median is part of observed run-to-run variability, discussed
below. It was not removed or replaced with a faster sample.

Phase split of the benchmark-only full tree pipeline:

| Intervals | Retrieval/fetch | Normalization | BOTH constructions | 43 tree queries |
| --- | ---: | ---: | ---: | ---: |
| 100 | 1.092 | 0.495 | 0.142 | 0.056 |
| 1,000 | 3.309 | 5.848 | 2.239 | 0.096 |
| 10,000 | 20.732 | 61.252 | 30.156 | 0.129 |

Retrieval includes PDO transfer/fetch; normalization is directly timed conversion
using the existing normalizer. Construction includes disposal of temporary normalized
lists after creating the immutable nodes. Individual medians need not add to the
median total. Pure computation construction medians were 0.125 / 2.414 / 28.073 ms;
its query medians were 0.050 / 0.094 / 0.123 ms.

SELECT counts were identical at all three sizes:

| Mode | SELECTs per 43 checks |
| --- | ---: |
| SQL service | 182 |
| Tree computation only | 0; normalized input supplied outside timer |
| Full classification-only tree pipeline | 1 |
| SQL + shadow service | 228 |
| SQL HTTP | 186 |
| SQL + shadow HTTP | 232 |

Enabled overhead remains **46 SELECTs = 45 snapshot probes + one extraction**.
OFF adds zero. Counts differ from Step 4A because this identical mixed workload has
10 QUEUE proposals rather than the previous distribution; SQL queue counting is
retained, not removed to favor a benchmark mode.

Each measured batch reproduced all 43 SQL classifications. Shadow batches recorded
43 matches, zero mismatches/inconclusive/errors, and one build. Latest-run totals
are 5,418 reference checks, including 1,806 baseline SQL repeat checks and 3,612
tree/pipeline/shadow cross-checks. These are repeated checks of the disclosed 43
proposals, not 5,418 independent booking scenarios. Test fault counts above are separate.

## Additional PHP memory

Latest-run median peak increments over each worker's pre-request baseline, in KiB:

| Intervals | SQL service | Tree compute | Full tree pipeline | SQL + shadow | SQL HTTP | Shadow HTTP |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 42.13 | 14.80 | 106.33 | 131.54 | 97.21 | 151.83 |
| 1,000 | 42.13 | 137.34 | 1,043.57 | 1,066.18 | 97.21 | 1,088.20 |
| 10,000 | 42.13 | 1,382.34 | 10,505.99 | 10,528.60 | 97.21 | 10,550.62 |

Computation-only additionally receives normalized input occupying about **39.70 /
391.66 / 3,936.35 KiB**, excluded from its incremental baseline and timer. Full
pipeline/shadow figures include that preparation and temporary fetched rows. Memory
does not disappear merely because the final index query needs no SQL.

## Variability and bottleneck investigation

Both measured runs are retained in the JSON artifact. In the initial run, the
10,000-record service shadow median was **2,273.713 ms**, while HTTP shadow was
**272.093 ms**. The repeat measured service shadow at **246.212 ms** and HTTP shadow
at **2,332.731 ms**. Latest HTTP shadow samples ranged **275.116–2,462.850 ms**;
six were above two seconds. Dataset checksums, query counts, outputs and plan node
structure stayed the same. No samples were selected out of the median.

The slowdown affected retrieval/server plan execution, PHP preparation/build, and
tree-query timings together. Normal extraction-plan execution was around 7–9 ms;
slow workers recorded around 73–75 ms, with the same Append/bitmap/index/sequence
scan structure. See PostgreSQL's [EXPLAIN reference](https://www.postgresql.org/docs/16/using-explain.html)
for the scope of plan execution measurements. The captured 10,000-record plans scan
opportunities once, not once per protected record. No missing-index or changed-plan explanation
was established by these samples.

The root cause of this broad timing variability remains **unproven**. It is not
evidence of a classification error, nor a basis for claiming a stable speedup. The
artifact preserves the anomaly, repeat, plan summaries and latest raw samples.

Stable phase measurements identify these costs:

1. At 10,000 intervals, normalization takes about 61 ms versus 30 ms construction
   and 21 ms retrieval; the approximately 0.13 ms lookup batch is not the main cost.
2. Every request indexes the full protected history/future set, even though only
   43 candidate dates are queried. The benchmark tail extends beyond that window.
3. Snapshot safety adds 45 metadata round trips to the original SQL workload.
4. Full preparation peaks around 10 MiB additional PHP allocation at 10,000 records.
5. Fixed-clock samples guarantee one asOf bucket. Real slow requests crossing
   opportunity-clock seconds can rebuild more often or become INCONCLUSIVE; these
   measurements do not include that additional cost.

## Specific recommendations, not implemented here

- Profile/cache an immutable Manila DateTimeZone object and evaluate removing the
  redundant timezone conversion before getTimestamp, with all naive/offset/invalid
  input tests retained. Per-record normalization is the largest stable CPU phase.
- Design request-window-limited extraction with explicit coverage bounds and rebuild
  on out-of-window queries. Preserve crossing intervals, administrative midnight
  semantics and snapshot guards; do not silently truncate protected records.
- Evaluate request-batch snapshot verification or controlled diagnostic sampling
  to reduce metadata round trips. Require whole-batch invalidation and deadline-clock
  tests before replacing the current per-comparison verification scheme.
- Aggregate successful diagnostic logs per request while retaining anomaly detail,
  then measure against the real deployed logger rather than this in-memory sink.
- Establish row/memory/time budgets that skip diagnostics as INCONCLUSIVE before
  expensive allocation. Catchable-exception fallback is tested; process-level memory
  exhaustion/timeouts are not made safe by a Throwable catch alone.
- Repeat on controlled deployment-equivalent hardware with resource telemetry,
  non-frozen clock, full schema, permissions and real logging. Resolve the observed
  slow-worker variability and set explicit latency/memory/inconclusive acceptance limits.

No production optimization was applied in this step, and no SQL/index change is
justified solely by these samples.

## Remaining gaps and GO / NO-GO

**NO-GO for authoritative integration.** Supporting evidence:

- The tree provides boolean classification only. Queue positions include pending/
  queued rows absent from these protected trees; they still come from SQL. A complete
  replacement or hybrid contract and its end-to-end cost have not been implemented.
- `ReservationWorkflow::available()` excludes a candidate ID, can exclude unpaid
  commitments, and uses reservation-deadline rules distinct from the calendar's
  opportunity predicate. The tree currently targets `forInterval()` compatibility,
  not every mutation-time availability decision. FIFO/eligibility is a separate layer.
- No new authoritative transaction/locking design or full concurrent booking-write
  validation is supplied. Safe shadow INCONCLUSIVE behavior is not atomic booking proof.
- The complete shadow path adds queries, memory and latency; its slow-run behavior
  remains unexplained. Classification-only prototype timings omit required contract
  work and cannot establish a production API speedup.
- Deployment pools/replicas/failover, custom RLS, full schema/triggers, browser/TLS/
  cookie/CSRF flows and production logging/load remain outside these fixtures.
- PBL cleaning/release eligibility and durable verified release evidence remain
  separately proposed policy questions, not CURRENT algorithm defects.

**GO only for continued controlled, non-authoritative shadow investigation** under
the existing safety boundary. This step did not activate even that configuration:
the switch remains default-OFF, customer responses remain original SQL, and no work
beyond Step 4B was performed.
