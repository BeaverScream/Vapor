# Phase 6 Code Review

Date: 2026-06-11
Reviewer: Claude (claude-sonnet-4-6)
Scope: phase-6.md spec fidelity, implementation correctness, test coverage gaps, security, and deferred-risk assessment.

**Disposition reviewed with owner: 2026-06-11**
All findings reviewed and actioned — see resolution notes under each section and the [Disposition Summary](#disposition-summary) table at the end.

> **⚠️ Round 2 (post-patch verification, 2026-06-11) appended below.** The 2026-06-11 defect patches introduced **three compile-breaking regressions** (backend runtime crash on fresh deploy + frontend build failure) that the broken `typecheck` script masked. See [Round 2 — Post-Patch Verification Review](#round-2--post-patch-verification-review).

---

## 1. Conflicts (Spec vs. Implementation)

### 1.1 T6.4-03 references non-existent `PeriodAggregate` fields

**Plan says:** "Also verify `avgRssUsedMb` equals the mean of `rssUsedMb` across rows and `peakRssUsedMb` equals the max."

**Reality:** Neither field exists in the `PeriodAggregate` type (`analytics.ts:52–77`) or in `computeAggregate`. The actual test at `admin.unit.test.ts:327–349` does not assert them. The plan overstates test coverage and the feature was never implemented.

**Impact:** Period-level RSS trend data is unavailable in reports and in any future charting of RSS over time. The email report and `PeriodAggregate` have no memory-capacity signal across a period — only point-in-time RSS per row.

**Resolution options:**
- Add `avgRssUsedMb: number` and `peakRssUsedMb: number` to `PeriodAggregate`, compute them in `computeAggregate`, surface them in `buildEmailHtml`, and add assertions to T6.4-03. Track in backlog as `BL-ANALYTICS-RSS-AGG-01`.
- Or explicitly document the omission in the phase spec and remove the misleading T6.4-03 assertion text.

> **✅ FIXED (2026-06-11):** Added `avgRssUsedMb` and `peakRssUsedMb` to `PeriodAggregate`; computed in `computeAggregate`; surfaced in `buildEmailHtml`; T6.4-03 assertions updated. No separate backlog item needed — implemented directly.

---

### 1.2 D-6.2 is stale — per-interval peak tracking is already correctly implemented

**Defect claims:** `peakConcurrentRooms`/`peakConcurrentParticipants` written to each CSV row are all-time high-water marks.

**Reality:** `scheduler.ts:67–69` writes `peakRooms: periodPeaks.periodPeakRooms` using `metrics.getPeriodPeaks()`, then calls `metrics.resetPeriodPeaks()` after the write. `metrics.ts:69–70` and `136–143` implement `periodPeakRooms`/`periodPeakParticipants` as independent counters that are reset after each flush. The per-interval peak mechanism is fully implemented and wired correctly.

**Resolution:** Close D-6.2 and remove it from phase-6.md's known defects table. Mark as resolved in `docs/Todo.md` BL-METRICS-PEAK-01.

> **✅ CONFIRMED (2026-06-11):** Owner verified the implementation is correct. D-6.2 closed in phase-6.md defects table. No code change required.

---

## 2. Active Production Defects

### 2.1 D-6.1 — `participantsJoinedTotal` is permanently 0 in production (BL-METRICS-WIRE-01)

**File:** `backend/src/server.ts:61–72`

`metricsAdapter` wires every counter method onto `newMetrics` except `incrementParticipantsJoined`. Every `join_room` success path calls `metrics.incrementParticipantsJoined?.()` via optional chaining, which silently no-ops. `participantsJoinedTotal` is 0 in every snapshot, dashboard metric card, CSV row, and report email.

**Fix:** Add one line to `metricsAdapter`:
```ts
incrementParticipantsJoined: () => newMetrics.incrementParticipantsJoined(),
```

**Priority:** This is a one-liner. Deferring to Phase 7 means the most prominent user-activity metric in the dashboard and all generated reports is meaningless until fixed. Should be treated as P0 at the start of Phase 7 or pulled into a patch.

> **✅ FIXED (2026-06-11):** Added `incrementParticipantsJoined: () => newMetrics.incrementParticipantsJoined()` to `metricsAdapter` in `server.ts`.

---

### 2.2 D-6.3 — `handleGuestGraceExpired` destroys rooms without recording metrics (BL-METRICS-GRACE-01)

**File:** `backend/src/signaling/registerSocketHandlers.ts` (~line 267–270)

When the last participant's guest-grace timer expires, the room is deleted and `clearRoomArtifacts` is called with no `incrementRoomDestroyed`, `updateRoomLifetimeRolling`, or `recordRoomDestroyed`. This is a distinct code path from the sweeper's `SOLO_HOST_ROOM_TIMEOUT_MS` path.

**Impact:** `roomsCreatedTotal - sum(destroyReasonBreakdown)` diverges permanently over production usage. `avgRoomLifetimeMinutes` silently excludes these rooms, skewing the average lower. Destruction reason totals undercount.

**Fix:** Before `clearRoomArtifacts`, add:
```ts
metrics.incrementRoomDestroyed?.("host_grace_expired");
metrics.updateRoomLifetimeRolling?.(nowTs - room.createdAt);
```

> **✅ FIXED (2026-06-11):** Added `nowTs`, `incrementRoomDestroyed("host_grace_expired")`, and `updateRoomLifetimeRolling` before `state.rooms.delete` / `clearRoomArtifacts` in `handleGuestGraceExpired`.

---

## 3. Missing Test Coverage

### 3.1 `getPeriodPeaks()` and `resetPeriodPeaks()` — zero coverage

A grep across all test files returns no matches for `getPeriodPeaks`, `resetPeriodPeaks`, or `periodPeak`. These methods are the mechanism that makes per-interval peak tracking correct (the substance of D-6.2's fix), yet they have no unit tests.

**Missing tests to add (all in `admin.unit.test.ts`):**

| ID | Assertion |
|---|---|
| T6.1-15 | `updatePeakMarks()` updates `periodPeakRooms`/`periodPeakParticipants` to the current active counts when they exceed prior period peaks. |
| T6.1-16 | `resetPeriodPeaks()` zeroes `periodPeakRooms` and `periodPeakParticipants` without affecting `peakConcurrentRooms`/`peakConcurrentParticipants`. |
| T6.1-17 | `getPeriodPeaks()` returns the correct current period-peak values before and after reset. |

> **✅ FIXED (2026-06-11):** T6.1-15, T6.1-16, and T6.1-17 added to `admin.unit.test.ts` and to the VP-6.1 test plan in phase-6.md.

---

### 3.2 T6.5-07 is in the plan but absent from the test file

**Plan says:** "Verify `peakRooms` and `peakParticipants` in a flushed row reflect the highest concurrent count observed within that flush interval only — after the flush, period-peak counters reset to 0."

The actual `admin.unit.test.ts` has no test with this ID or this assertion. This is the highest-priority missing test: it validates the correct behavior of the entire per-interval peak pipeline (metrics → scheduler → row → reset).

**What the test should do:** Use `createScheduler` with a short `flushIntervalMs`, call `updatePeakMarks()` at a simulated high count, call `flush()`, assert the written row has the correct `peakRooms`/`peakParticipants`, then assert a second flush (at zero active counts) writes `peakRooms: 0`.

> **✅ ALREADY PRESENT:** T6.5-07 was found to already exist in `admin.unit.test.ts` (the plan entry was correct; the earlier grep was incomplete). No action required.

---

### 3.3 T6.1-03 verifies all-time peaks but not period peaks

`T6.1-03` checks that `updatePeakMarks()` only increases `peakConcurrentRooms`/`peakConcurrentParticipants` (all-time watermarks). The test at `admin.unit.test.ts:152–175` reads `getRawCounters()`, which returns `peakConcurrentRooms` — the all-time value. The test never checks that `periodPeakRooms` is also updated. T6.1-15 (above) fills this gap.

> **✅ FIXED (2026-06-11):** Gap closed by T6.1-15.

---

## 4. Security Concerns

### 4.1 VP-6.10 must be a deployment gate, not a backlog item

VP-6.10 injects `ADMIN_API_TOKEN` into the client JavaScript bundle via Vite `define`. The token is visible to anyone who can fetch the bundle. The phase doc correctly documents this in a "Security Trade-off" section, but then tracks the remediation as `BL-ADMIN-TOKEN-SECURITY-01` in a flat backlog list alongside feature requests.

**Risk:** Any public deployment of Vapor with `VITE_ADMIN_TOKEN` set exposes the admin credential to all users via browser DevTools. Bundle scanners and CDN caches can index it permanently.

**Recommendation:** Add an explicit `⚠️ BLOCK FOR PUBLIC RELEASE` label to `BL-ADMIN-TOKEN-SECURITY-01` in `docs/Todo.md` and cross-reference it from the VP-6.10 section in the phase doc. The current framing understates urgency.

> **📋 DEFERRED — ACCEPTED (2026-06-11):** Vapor is a solo open-source project with no public deployment yet. The `⚠️ Pre-production required` label already present on `BL-ADMIN-TOKEN-SECURITY-01` in `docs/Todo.md` is the appropriate gate. No additional action before deployment.

---

### 4.2 `localStorage` token fallback — XSS surface (minor)

VP-6.10.4 falls back to `localStorage` for manual token persistence. For an admin credential on a service advertising zero-persistence and privacy, this creates an inconsistency. XSS on any page in the same origin can exfiltrate the admin token. This is a lower-priority concern for internal/Docker deployments but worth noting for the public-deployment remediation plan.

> **📋 ACCEPTED AS-IS (2026-06-11):** Privacy policy and FAQ already disclose that only aggregate operational data (no user data) is collected — owner confirmed. The XSS risk on the `localStorage` path is acknowledged but negligible for localhost/Docker deployments. Will be addressed as part of the pre-deployment security pass alongside 4.1.

---

## 5. Latent / Deferred Risks

### 5.1 BL-SCHEDULER-MIDNIGHT-01 — high recurrence rate

Any server restart between UTC midnight and the first post-startup flush (60s warmup + up to 30min interval) silently drops that day's daily, weekly, and monthly reports. No error is logged. Maintenance windows commonly overlap with off-peak hours, which in turn overlap with midnight UTC for at least some timezones. This is likely to recur regularly in a deployed service.

The fix (check last CSV row's `recordedAt` on startup, trigger missed reports) is straightforward. The backlog priority seems underweighted given the frequency of occurrence.

> **📋 DEFERRED — ACCEPTED (2026-06-11):** Not high priority before production. Tracked as `BL-SCHEDULER-MIDNIGHT-01` in `docs/Todo.md` — backlog item's user story is sufficient context. Will revisit before deployment.

---

### 5.2 D-6.5 — `appendFileSync` blocks event loop: a one-line fix deferred unnecessarily

`CsvAnalyticsStore.writeSnapshot` is declared `async` but calls `appendFileSync`. The fix is replacing `appendFileSync` with `await fs.promises.appendFile` — one line. The constructor also uses `appendFileSync` for the header write, which is acceptable at startup. Deferring this while shipping Phase 6 means every 30-minute flush blocks the event loop for active WebSocket traffic.

> **✅ FIXED (2026-06-11):** Replaced `appendFileSync` with `await appendFile` (from `node:fs/promises`) in `CsvAnalyticsStore.writeSnapshot`. The method was already `async`; the change is a one-line swap.

---

### 5.3 BL-REPORT-MONTH-01 — structural date anchor divergence is a latent bug

`POST /admin/report/monthly` in `routes.ts:64–66` anchors to `now` (wall-clock, callable any day). The scheduler's `checkReports` in `scheduler.ts:124–129` anchors to `crossedDay` (always the 1st of the new month). Both produce the correct previous-month answer today via the same `getUTCMonth() - 1` arithmetic, but from structurally different reference dates. Any future extension (e.g., `?month=` query param, retry logic) is likely to copy the wrong pattern.

The `getPrevMonthYear(date: Date)` helper extraction resolves this at low risk.

> **📋 ALREADY IN BACKLOG (2026-06-11):** `BL-REPORT-MONTH-01` already exists in `docs/Todo.md` — no action needed.

---

## 6. Minor Notes

### 6.1 T6.6-04 and T6.6-05 are nearly identical

Both test `generateDailyReport` returning `null` when the store's `queryRows` rejects. T6.6-04 adds a logging assertion; T6.6-05 only checks the null return. These should be merged into a single test or T6.6-05 should be removed and its assertion folded into T6.6-04.

> **✅ FIXED (2026-06-11):** T6.6-05 removed from `admin.unit.test.ts`. T6.6-04 already covers the null-return assertion in addition to the logging check. Phase-6.md test plan updated to reflect the merge.

### 6.2 T6.2-08 tests an infeasible scenario

The test verifies "Bearer failure does not fall through to Basic." But a single `Authorization` header can only begin with `Bearer ` or `Basic ` — not both simultaneously. A request sending `Authorization: Bearer wrong-token` will never satisfy `authHeader.startsWith("Basic ")`, so the cross-fallthrough path cannot be triggered via a single header. The test passes for the right reason but the security concern it documents is not achievable through the standard HTTP auth header. The test description should note this constraint or the test scenario should be updated to reflect the actual threat model.

> **📋 DEFERRED — SUPERSEDED (2026-06-11):** Owner is planning to consolidate Bearer token and Basic credentials into a single AND-gate auth requirement (`BL-ADMIN-AUTH-AND-01` in `docs/Todo.md`). T6.2-08 will become irrelevant when that lands. No fix needed now.

### 6.3 VP-6.9 is complete

`CreateVaporServerArgs` in `server.ts:17–26` has no `adminMetricsToken` parameter. No reference to `ADMIN_METRICS_TOKEN` or `adminMetricsToken` is present in the codebase. VP-6.9 is done.

> **✅ CONFIRMED (2026-06-11):** Owner confirmed. "VP-6.9 is complete" is a positive status note, not a finding — no action required for VP-6.9.

### 6.4 Fail-secure startup guard is correctly implemented

`server.ts:89–98` checks `ADMIN_API_TOKEN` (truthy) and `ADMIN_BASIC_USER`/`ADMIN_BASIC_PASS` (both truthy) before registering admin routes. Empty strings are correctly treated as unconfigured via JavaScript truthiness. Matches the spec in VP-6.2.2. ✅

---

## 7. Disposition Summary

> Updated 2026-06-11 after owner review.

| # | Finding | Decision | Outcome |
|---|---|---|---|
| 1.1 | `avgRssUsedMb`/`peakRssUsedMb` missing from `PeriodAggregate` | Fix | ✅ Implemented — fields added, computed, surfaced in email, T6.4-03 updated |
| 1.2 | D-6.2 stale — per-interval peaks already correct | Close | ✅ Confirmed correct; D-6.2 closed in phase-6.md |
| 2.1 | D-6.1: `participantsJoinedTotal` always 0 | Fix | ✅ One-liner added to `metricsAdapter` in `server.ts` |
| 2.2 | D-6.3: `handleGuestGraceExpired` records no metrics on room destruction | Fix | ✅ `incrementRoomDestroyed` + `updateRoomLifetimeRolling` added |
| 3.1 | T6.1-15/16/17 missing — no tests for `getPeriodPeaks`/`resetPeriodPeaks` | Fix | ✅ Three tests added to `admin.unit.test.ts` and VP-6.1 test plan |
| 3.2 | T6.5-07 absent from test file | No action | ✅ Test was already present; finding was incorrect |
| 3.3 | T6.1-03 does not cover period peaks | Fix | ✅ Closed by T6.1-15 |
| 4.1 | VP-6.10 bundle token — needs deployment gate label | Defer | 📋 Solo pre-deployment project; `⚠️ Pre-production required` label already on `BL-ADMIN-TOKEN-SECURITY-01` |
| 4.2 | `localStorage` token — XSS surface | Accept as-is | 📋 Privacy policy covers disclosure; XSS risk negligible for localhost/Docker; part of pre-deployment security pass |
| 5.1 | BL-SCHEDULER-MIDNIGHT-01 — silent report skip on restart | Defer | 📋 Low priority pre-production; backlog item user story is sufficient |
| 5.2 | D-6.5: `appendFileSync` blocks event loop | Fix | ✅ Replaced with `await appendFile` in `CsvAnalyticsStore.writeSnapshot` |
| 5.3 | BL-REPORT-MONTH-01 — date anchor divergence | Already tracked | 📋 `BL-REPORT-MONTH-01` already in `docs/Todo.md`; no new action |
| 6.1 | T6.6-04/T6.6-05 near-duplicate | Fix | ✅ T6.6-05 removed; T6.6-04 covers both assertions |
| 6.2 | T6.2-08 tests infeasible HTTP scenario | Defer | 📋 Will be superseded by `BL-ADMIN-AUTH-AND-01` AND-gate auth rewrite |
| 6.3 | VP-6.9 is complete | No action | ✅ Confirmed; status note only, no work item |
| 6.4 | Fail-secure startup guard is correct | No action | ✅ Implementation matches spec |

---
---

# Round 2 — Post-Patch Verification Review

Date: 2026-06-11
Reviewer: Claude (Fable 5)
Scope: Verification of the 2026-06-11 defect patches, full re-review of all Phase 6 backend modules (`backend/src/admin/*`, `server.ts`, `index.ts`, `registerSocketHandlers.ts`), all admin test suites (`admin.unit.test.ts`, `admin.integration.test.ts`, T6.1 sections of `socket.integration.test.ts`), and the frontend admin feature (`frontend/src/features/admin/*`, `vite.config.ts`, `vite-env.d.ts`, `App.tsx`, `docker-compose.yml`).
Method: Source reading plus `tsc --noEmit` compile verification (build verification only — no test suites were executed, per project guardrail).

## R2.0 Patch Verification Results (Round 1 fixes)

| Round 1 item | Claimed fix | Verified? |
|---|---|---|
| 1.1 `avgRssUsedMb`/`peakRssUsedMb` | Added to `PeriodAggregate`, computed, surfaced in email | ✅ Present in `analytics.ts:69–71`, `computeAggregate` (`analytics.ts:237–238`), `buildEmailHtml` (`emailDelivery.ts:49–50`), T6.4-03 asserts both. **But** the retrofit missed two test stubs and the frontend types — see R2-2 and R2-3. |
| 2.1 (D-6.1) `incrementParticipantsJoined` wiring | One-liner in `metricsAdapter` | ✅ Verified at `server.ts:67`. |
| 2.2 (D-6.3) guest-grace destroy metrics | `incrementRoomDestroyed` + lifetime before delete | ✅ Verified at `registerSocketHandlers.ts:267–273`. |
| 3.1 T6.1-15/16/17 | Added to `admin.unit.test.ts` | ✅ Present at lines 177–262; assertions match the plan. |
| 5.2 (D-6.5) async append | `appendFileSync` → `await appendFile` in `writeSnapshot` | ⚠️ `writeSnapshot` is fixed (`analytics.ts:121`), **but the patch broke the constructor** — see R2-1 (P0). |
| 6.1 T6.6-05 merge | Removed; T6.6-04 covers both | ✅ No T6.6-05 in the file; T6.6-04 (`admin.unit.test.ts:1005`) asserts null return + error logging. |

Additionally verified intact: fail-secure startup guard (`server.ts:90–99`), timing-safe auth comparison with length check (`auth.ts:7–18`), per-interval peak write-then-reset ordering in `flush()` (`scheduler.ts:137–140`), Monday/1st-of-month report anchoring to `crossedDay` (`scheduler.ts:109–129`), docker-compose `mem_limit`/`memswap_limit: 256m` and `env_file` on both services, `vite-env.d.ts` declaration, and `/admin` route isolation in `App.tsx` (reachable only by direct URL, no participant-facing link).

---

## R2.1 Blocking Defects (compile/runtime breakage introduced by the patches)

### R2-1 (P0) — `analytics.ts` no longer compiles; `CsvAnalyticsStore` constructor throws `ReferenceError` at runtime

**File:** `backend/src/admin/analytics.ts:115`

The D-6.5 patch changed the imports to `{ existsSync, mkdirSync, readFileSync }` from `node:fs` plus `{ appendFile }` from `node:fs/promises`, but the constructor's header write still calls `appendFileSync`:

```
src/admin/analytics.ts(115,7): error TS2552: Cannot find name 'appendFileSync'. Did you mean 'appendFile'?
```

Because the backend runs under `tsx` (which strips types without checking), this is not caught at startup — it surfaces as a **runtime `ReferenceError` the first time the constructor runs with a missing CSV file**. Concretely:

- **Production fresh deploy:** `server.ts:94` constructs `CsvAnalyticsStore("./data/vapor-metrics.csv")` whenever admin auth env vars are set. On any host where `./data/vapor-metrics.csv` does not yet exist, `createVaporServer` throws and **the entire backend fails to start**. Existing-file deployments survive only because the `existsSync` guard skips the broken line.
- **Tests:** T6.4-01, -02, -04, -05, -06 each construct the store against a fresh temp dir; all five will fail with `ReferenceError: appendFileSync is not defined` if run.

**Fix (one line):** add `appendFileSync` back to the `node:fs` import (constructor-time sync write at startup was explicitly accepted in Round 1), or switch the header write to `writeFileSync`.

### R2-2 (P0) — `admin.unit.test.ts` no longer compiles: two `PeriodAggregate` stubs miss the new RSS fields

**File:** `backend/tests/admin.unit.test.ts:890` (T6.7-05) and `:1027` (T6.7-08)

The 1.1 patch added required `avgRssUsedMb`/`peakRssUsedMb` to `PeriodAggregate` but did not update the two hand-built stubs:

```
tests/admin.unit.test.ts(890,9): error TS2739: Type '…' is missing the following properties from type 'PeriodAggregate': avgRssUsedMb, peakRssUsedMb
tests/admin.unit.test.ts(1027,9): error TS2739: (same)
```

Under `tsx` the tests still run (and T6.7-08's HTML assertion would render `undefined MB` into the email body without failing), so this is silent type rot rather than a test failure — which is worse. **Fix:** add `avgRssUsedMb: 0, peakRssUsedMb: 0` to both stubs. T6.7-08 should also gain an assertion that the rendered HTML contains the RSS values (guards against `undefined MB`).

### R2-3 (P0) — Frontend production build fails: 3 type errors in the new admin feature

`npx tsc -b` (the first half of `npm run build`) fails. Phase-6-introduced errors:

| File | Error |
|---|---|
| `frontend/src/features/admin/HistoricalCharts.tsx:40` | TS2339: `rssUsedMb` does not exist on type `HourlyRow` — the chart reads the field but `adminApi.ts`'s `HourlyRow` was never given it (the RSS retrofit missed the frontend types entirely; see R2-9). |
| `frontend/src/features/admin/AdminDashboard.tsx:73` | TS2322: `(e: SubmitEvent) => void` is not assignable to the form's `onSubmit` handler type — should be `React.FormEvent<HTMLFormElement>`. |
| `frontend/src/features/admin/LiveMetrics.tsx:1` | TS6133: unused `useRef` import. |

Vite dev mode (what Docker runs) doesn't typecheck, so `/admin` works in dev while `npm run build` is broken. Nine further errors exist in `frontend/src/features/room/*` (unused imports, a `useSocketConnection.ts` return-type error, a socket `"pong"` event-name error) — those appear to predate Phase 6 but mean the build was likely already red; worth a separate sweep.

### R2-4 (P1, root cause) — `npm run typecheck` is broken, which is why R2-1/R2-2/R2-3 shipped

**File:** `backend/tsconfig.json:7`

```
tsconfig.json(7,27): error TS5103: Invalid value for '--ignoreDeprecations'.
```

`"ignoreDeprecations": "6.0"` is rejected by TypeScript 5.7 (only `"5.0"` is valid) — `tsc --noEmit` exits before checking a single file. Every Phase 6 "no TypeScript errors" pass criterion was therefore unverifiable on the backend. Note also that `tsconfig.json`'s `include` covers only `src/**` — `tests/**` is never typechecked even when the script works. **Fix:** set `"ignoreDeprecations": "5.0"` (or remove it), and either add `tests/**/*.ts` to `include` or add a `tsconfig.tests.json`. Recommend wiring `typecheck` into the pre-commit/CI path so this class of regression cannot recur.

---

## R2.2 New Functional Findings (not regressions; present in the shipped design)

### R2-5 (Major) — Peak tracking is starved: `updatePeakMarks()` fires only once per 5 hours in production

`updatePeakMarks()` is called from exactly one production site: the sweep (`registerSocketHandlers.ts:898`). `DEFAULT_SWEEP_INTERVAL_MS = 5 * 60 * 60 * 1000` (5 hours, `registerSocketHandlers.ts:53`) and `server.ts` does not override it.

Consequences:
- `peakRooms`/`peakParticipants` in 30-minute CSV rows are **0 in at least 9 of every 10 rows** — a row only gets a nonzero peak if a 5-hourly sweep happened to land inside its flush window *and* rooms were active at that instant.
- The dashboard's all-time `peakConcurrentRooms`/`peakConcurrentParticipants` and every report's peak figures sample concurrency at 5-hour instants, missing essentially all real peaks.
- The entire per-interval peak pipeline — correctly implemented and now well covered by T6.1-15/16/17 and T6.5-07 — is fed almost no data. The unit tests pass because they call `updatePeakMarks()` by hand; T6.1-14 verifies the sweep wiring but not the cadence.

**Fix (recommended):** call `metrics.updatePeakMarks?.()` at the two points where concurrency can rise — after a successful `create_room` (next to `registerSocketHandlers.ts:342`) and after a successful `join_room` (next to `:463`). Both are O(rooms) reads via the accessor; at Vapor's scale this is negligible. Alternatively decouple peak sampling from the sweep with its own short interval. Suggest backlog ID `BL-METRICS-PEAK-SAMPLING-01` if not fixed inline.

### R2-6 (Moderate) — Manual weekly report trigger is not Monday-aligned

**File:** `backend/src/admin/routes.ts:59–61`

The variable is named `lastMonday` but it is simply `now − 7 days` at UTC midnight — triggered on a Wednesday it generates a Wednesday→Tuesday "week". The spec (`queryWeeklyAggregate` contract: *"weekStart: 'YYYY-MM-DD' of Monday"*) and the scheduler (correctly Monday-anchored via `crossedDay`, `scheduler.ts:113–116`) both disagree with it. The emailed `periodLabel` will also be a non-Monday date, which T6.7-02's format-as-differentiator convention silently miscommunicates. Same family as deferred D-6.8 (monthly anchor divergence) — recommend folding both into one fix: extract `getPrevDay/getPrevMonday/getPrevMonthYear(date)` helpers used by both `routes.ts` and `scheduler.ts` (extend `BL-REPORT-MONTH-01`).

### R2-7 (Moderate) — Scheduler handle is discarded; `stop()` leaks the flush interval and warm-up timer

**File:** `backend/src/server.ts:96`

`createScheduler({ … }).start()` drops the returned handle, so `createVaporServer(...).stop()` closes Socket.IO but leaves the 30-minute `setInterval` and the 60-second warm-up `setTimeout` running. Neither is `unref()`'d (unlike the sweep, `registerSocketHandlers.ts:902`), so any process that calls `stop()` and expects to exit — integration tests, graceful shutdown — hangs for up to 30 minutes per orphaned interval, and repeated server construction in one process stacks duplicate flush writers onto the same CSV. `store.close()` is likewise never called (harmless today, but it is the `AnalyticsStore` contract's reason for existing — a future `SupabaseAnalyticsStore` would leak its connection).

**Fix:** retain the scheduler reference, call `scheduler.stop()` and `store.close()` inside the returned `stop()`, and `unref()` both timers inside `createScheduler`.

### R2-8 (Minor) — In-session 401 silently keeps stale metrics on screen (T6.3-06 cannot pass as implemented)

`LiveMetrics.tsx:58–61` handles a mid-session 401 by calling `onAuthError?.()` and returning — no `fetchError` is set, so the last snapshot stays rendered and polling continues every 30 s with the dead token. On the parent side, `AdminDashboard.tsx:100` maps `onAuthError` to `setAuthError(true)`, but that flag is only rendered inside the credential form (`AdminDashboard.tsx:85`), which is unmounted while `sessionToken` is non-null. Net behavior: token revoked server-side → dashboard keeps displaying stale data indefinitely — precisely what T6.3-06 ("surfaces an error and does not silently display stale data") forbids. The T6.3-06 manual-E2E pass claim should be re-examined. **Fix:** on 401, have the parent clear `sessionToken` (and skip the `VITE_ADMIN_TOKEN` re-read for the session) or set `fetchError` in `LiveMetrics`.

### R2-9 (Minor) — `adminApi.ts` types have drifted from the backend contract, and `LiveMetrics` bypasses the API module

- `adminApi.ts` `MetricsSnapshot` declares `avgRoomLifetimeMs` — the backend field is `avgRoomLifetimeMinutes` (`metrics.ts:23`); it also lacks `rssUsedMb` and `participantsJoinedTotal`.
- `HourlyRow` lacks `rssUsedMb` (the direct cause of R2-3's chart error).
- `LiveMetrics.tsx:9–27` re-declares its own near-duplicate `MetricsSnapshot` (with `rssUsedMb`, still with the wrong `avgRoomLifetimeMs`) and issues a raw `fetch` instead of using `fetchMetrics` — VP-6.3.4's stated purpose for `adminApi.ts`. `fetchMetrics` appears to have **zero callers**.

**Fix:** single source of truth — correct `MetricsSnapshot`/`HourlyRow` in `adminApi.ts` (consider generating them from the backend types in `shared/`), delete the local duplicate, route `LiveMetrics` through `fetchMetrics`.

### R2-10 (Minor) — `minutesToReadable` can render "1h 60m"

**File:** `backend/src/admin/emailDelivery.ts:8–10`

For inputs in `[119.5, 120)`: `h = 1`, `m = Math.round(59.x) = 60` → `"1h 60m"`. Round minutes first, then derive hours (`const total = Math.round(minutes); const h = Math.floor(total / 60); const m = total % 60;`). T6.7-07 should gain a `minutesToReadable(119.7) === "2h"` case.

### R2-11 (Status correction) — D-6.4 appears to be already fixed; phase-6.md still lists it as deferred

`emailDelivery.ts:84` now logs `GMAIL_APP_PASSWORD` (correct name); no `GMAIL_APP_PWD` string remains anywhere in the backend. The phase-6.md defect table ("Deferred — backlog", `BL-EMAIL-ENVVAR-01`) and `docs/Todo.md` should be updated to closed. Residual nit: the message always lists all three env vars rather than naming the one actually missing — acceptable.

---

## R2.3 Minor Notes

1. **Dead shadowed emit helpers** — `registerSocketHandlers.ts:71–85, 91–93`: the module-level `emitRoomNotFound` / `emitInvalidPassword` / `emitRoomFull` / `emitRateLimited` / `emitNotAuthorized` are fully shadowed by the counter-instrumented locals (`:145–164`) and have no callers. Beyond being dead code, they are a trap: a future handler added outside `registerSocketHandlers`'s closure would silently bind the un-instrumented version and skip `incrementErrorCount`. Delete them (`emitSocketError` and `emitInvalidSignalPayload` are the only module-level ones in use).
2. **`destroyRoom` can overcount on a stale policy** — `registerSocketHandlers.ts:207` increments `incrementRoomDestroyed(reason)` before checking whether the room still exists; a sweep/timer double-fire against an already-deleted room would inflate the reason counters (lifetime is correctly guarded at `:209`). Move the increment inside an `if (room)` block.
3. **T6.5-10 tests a copy of the formula, not the code** — `admin.unit.test.ts:801–820` re-implements the January-rollover ternary inline and asserts on the re-implementation. It can never catch a regression in `scheduler.ts:124–125`. Acceptable as executable documentation, but the test plan shouldn't count it as coverage of the scheduler. (Extracting the `getPrevMonthYear` helper per R2-6 would make it genuinely testable.)
4. **Stale comment** — `analytics.ts:139`: `close()` says "synchronous I/O — no handle to release"; `writeSnapshot` is now async `appendFile`. Comment-only.
5. **`node-cron` is an unused dependency** — `backend/package.json` carries `node-cron` + `@types/node-cron`, but the scheduler deliberately uses `setInterval` (VP-6.5.1). Remove both.
6. **Compound-day gap on missed midnights remains** — `checkReports` (`scheduler.ts:95–105`) generates a daily report only for `lastReportDate` when one or more midnights were crossed; intermediate days are skipped silently. This is the already-deferred `BL-SCHEDULER-MIDNIGHT-01` surface — noted here only because the multi-day case (clock suspension, container pause) widens it slightly beyond the restart case the backlog item describes.
7. **Frontend CSV export column order depends on JSON key order** — `ReportControls.tsx:52–53` derives headers from `Object.keys(rows[0])`, i.e., backend serialization order. Works today (matches `CSV_COLUMNS`); would silently reorder if the backend object literal changes. Importing a shared column list would pin it (relates to T6.8-12).

## R2.4 Test Suite Assessment

Coverage is genuinely strong: all planned unit/integration IDs for T6.1, T6.2, T6.4–T6.8 exist with assertions that match their plan rows (spot-checked every ID; the only divergences are noted in R2-2 and Minor Note 3). The socket-level hooks (T6.1-04/05/06/13/14) exercise the real handler paths via `setupSocketHarnessWithMetrics` with a real `createMetrics` instance, which is the right altitude. Env-var save/restore hygiene in `admin.unit.test.ts` and `admin.integration.test.ts` is consistent. Remaining structural gaps:

- **No test constructs the store against a missing file via the production path** — which is exactly the R2-1 crash. A one-line smoke test ("`new CsvAnalyticsStore` in an empty temp dir does not throw") would have caught it. *(Do not add until asked — noted for the test-implementation phase.)*
- Nothing pins the production sweep cadence or peak-sampling frequency (R2-5); T6.1-14 fakes `setInterval` and so never sees the 5-hour constant.
- Tests are excluded from typecheck (R2-4), so type-level drift in stubs (R2-2) is invisible.

## R2.5 Disposition Summary (Round 2)

| # | Severity | Finding | Recommended action |
|---|---|---|---|
| R2-1 | **P0** | `appendFileSync` not imported — backend crash on fresh deploy; T6.4 tests broken | Re-add `appendFileSync` import (or use `writeFileSync` for header) — one line |
| R2-2 | **P0** | Two `PeriodAggregate` test stubs miss `avgRssUsedMb`/`peakRssUsedMb` | Add both fields to stubs at `admin.unit.test.ts:890, 1027` |
| R2-3 | **P0** | Frontend `npm run build` fails: `HourlyRow.rssUsedMb` missing, `SubmitEvent` handler type, unused `useRef` | Fix all three (see R2-9 for the type-drift root cause) |
| R2-4 | **P1** | `ignoreDeprecations: "6.0"` breaks `npm run typecheck`; tests never typechecked | Set `"5.0"`; include `tests/**`; wire into CI |
| R2-5 | **Major** | Peaks sampled once per 5 h — peak metrics effectively always 0 in production | Call `updatePeakMarks` on create/join success paths |
| R2-6 | Moderate | Manual weekly report not Monday-aligned | Extract shared date-anchor helpers; fold into `BL-REPORT-MONTH-01` |
| R2-7 | Moderate | Scheduler never stopped/unref'd; `store.close()` never called | Retain handle; stop in server `stop()`; `unref()` timers |
| R2-8 | Minor | Mid-session 401 leaves stale metrics on screen (contradicts T6.3-06) | Clear session token or set fetch error on 401 |
| R2-9 | Minor | `adminApi.ts` type drift; `fetchMetrics` has no callers | Single source of truth for admin API types |
| R2-10 | Minor | `minutesToReadable(119.7)` → `"1h 60m"` | Round before splitting h/m |
| R2-11 | Status | D-6.4 already fixed in code but listed as deferred | Close D-6.4 in phase-6.md and `docs/Todo.md` |
| Notes 1–7 | Minor | Dead emit helpers, destroy overcount guard, T6.5-10 self-test, stale comment, unused `node-cron`, multi-day report gap, CSV column-order coupling | Batch into next cleanup slice |

---

## R2.6 Round 2 Disposition (applied 2026-06-11)

| # | Decision | Outcome |
|---|---|---|
| R2-1 | Fix | ✅ `appendFileSync` re-added to the `node:fs` import in `analytics.ts`; constructor header write works again. Stale `close()` comment (Note 4) also corrected. |
| R2-2 | Fix | ✅ `avgRssUsedMb`/`peakRssUsedMb` added to both `PeriodAggregate` stubs in `admin.unit.test.ts`; T6.7-08 now also asserts the rendered HTML contains the RSS values and no `undefined`. |
| R2-3 | Fix | ✅ All three Phase 6 frontend errors fixed: `HourlyRow.rssUsedMb` added (via R2-9), `handleTokenSubmit` typed as `React.FormEvent<HTMLFormElement>`, unused `useRef` removed. Pre-existing `features/room/*` errors → backlog `BL-FRONTEND-TYPES-01`. |
| R2-4 | Fix | ✅ Deprecated `baseUrl` (the reason `ignoreDeprecations` existed) removed from backend `tsconfig.json` — `paths` resolves relative to the tsconfig without it; `tests/**/*.ts` added to `include`. CI wiring → backlog `BL-CI-TYPECHECK-01`. |
| R2-5 | Fix | ✅ `metrics.updatePeakMarks?.()` now called after every successful `create_room` and `join_room` — the two points where concurrency can rise — in addition to the sweep. |
| R2-6 | Partial fix + backlog | ✅ Manual weekly trigger in `routes.ts` is now Monday-aligned (previous full Mon–Sun week). Shared `getPrevDay/getPrevMonday/getPrevMonthYear` helper extraction folded into `BL-REPORT-MONTH-01` (scope extension recorded in Todo.md, includes making T6.5-10 genuinely testable per Note 3). |
| R2-7 | Fix | ✅ `server.ts` retains the scheduler handle; `stop()` now calls `scheduler.stop()` and `store.close()`; both scheduler timers are `unref()`'d in `createScheduler`. |
| R2-8 | Fix | ✅ Mid-session 401 now sets `fetchError` in `LiveMetrics` (no stale data) and the parent clears `sessionToken` + purges the dead token from `localStorage`, returning to the credential form with the auth error visible — T6.3-06 behavior restored. |
| R2-9 | Fix | ✅ `adminApi.ts` `MetricsSnapshot`/`HourlyRow` corrected to match backend (`avgRoomLifetimeMinutes`, `rssUsedMb`, `participantsJoinedTotal`); `LiveMetrics` local duplicate type deleted and routed through `fetchMetrics` (now has a caller); `AdminAuthError` exported for 401 discrimination. |
| R2-10 | Fix | ✅ `minutesToReadable` rounds total minutes before the h/m split; T6.7-07 gained the `119.7 → "2h"` case. |
| R2-11 | Docs | ✅ D-6.4 closed in phase-6.md defects table and `BL-EMAIL-ENVVAR-01` marked resolved in Todo.md. |
| Note 1 | Fix | ✅ Dead module-level `emitRoomNotFound`/`emitInvalidPassword`/`emitRoomFull`/`emitRateLimited`/`emitNotAuthorized` deleted; closure comment updated to warn against re-adding un-instrumented twins. |
| Note 2 | Fix | ✅ `destroyRoom` increments `incrementRoomDestroyed` only when the room still exists. |
| Note 3 | Backlog | 📋 Folded into `BL-REPORT-MONTH-01` scope extension (helper extraction makes T6.5-10 test the real code). |
| Note 5 | Fix | ✅ `node-cron` and `@types/node-cron` removed from `backend/package.json`. |
| Note 6 | Backlog | 📋 Multi-day report gap recorded as a scope note on `BL-SCHEDULER-MIDNIGHT-01`. |
| Note 7 | Backlog | 📋 New `BL-CSV-COLUMNS-01` (shared column list pinning frontend CSV export order). |
