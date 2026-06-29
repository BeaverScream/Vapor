# Phase 6 — Detailed Work Matrix

Date: 2026-06-05
Owner: @vapor-pm
Status: Implemented — Defect patches applied 2026-06-11; Round 2 review fixes (R2-1…R2-11) applied 2026-06-11

## Purpose
Phase 6 adds admin observability to Vapor: a live operational metrics endpoint, an analytics persistence layer for historical trend data, and a reporting engine that delivers scheduled summaries by email. All three are served by a credential-gated admin dashboard on the existing React frontend. Implementation requires a targeted System Design §8.1 amendment (VP-6.0) before code work begins — aggregate metrics (no room IDs, participant IDs, nicknames, or session data) do not conflict with the zero-persistence guarantee for user data.

> **Setup reference:** See [ADMIN_SETUP.md](/ADMIN_SETUP.md) at the project root for environment variable configuration, auth method selection, Gmail App Password setup, Docker memory limits, and the CSV analytics store verification guide.

## Table of Contents

- [VP-6.0 System Design Amendment](#vp-60-system-design-amendment)
- [VP-6.1 RAM Metrics Snapshot](#vp-61-ram-metrics-snapshot)
- [VP-6.2 Admin Auth Middleware](#vp-62-admin-auth-middleware)
- [VP-6.3 Live Admin Dashboard](#vp-63-live-admin-dashboard)
- [VP-6.4 Analytics Store](#vp-64-analytics-store)
- [VP-6.5 Periodic Metrics Flush](#vp-65-periodic-metrics-flush)
- [VP-6.6 Report Generation Engine](#vp-66-report-generation-engine)
- [VP-6.7 Email Delivery](#vp-67-email-delivery)
- [VP-6.8 Historical Trend Charts](#vp-68-historical-trend-charts)
- [VP-6.9 Dead Variable Cleanup](#vp-69-dead-variable-cleanup)
- [VP-6.10 Admin Dashboard Auto-Authentication](#vp-610-admin-dashboard-auto-authentication)

---

## VP-6.0 System Design Amendment

### Implementation Plan

| Subtask | Task | Module / Interface | Detail | Status | Pass Criteria | Evidence Pointer |
|---|---|---|---|---|---|---|
| 6.0.1 | Amend System Design §8.1 | docs/system_design/Vapor_System_Design.md §8.1 | §8.1 currently states "Admin observability is required and must remain server-side RAM-only." This conflicts with Phase 6's Supabase persistence for aggregate metrics. Amendment text: "Aggregate operational metrics (active room count, participant counts, error rates, heap usage, uptime) may be written to a dedicated external observability store. No user-identifiable fields (room IDs, participant IDs, nicknames, reconnect tokens, passwords, SDP/ICE, IP addresses, or any session-scoped data) may be written to this store. The zero-persistence guarantee for user and session data is unchanged." | Completed | §8.1 contains the amendment text. No code change. | doc review |
| 6.0.2 | Update privacy-policy.md and faq.md | frontend/src/features/info/privacy-policy.md, frontend/src/features/info/faq.md | In `privacy-policy.md`: add a new "Operational Metrics" section clarifying that aggregate service metrics (room counts, error rates, heap usage, uptime) are written to an external observability store, and explicitly listing what is never written (room IDs, participant IDs, nicknames, reconnect tokens, passwords, SDP/ICE, IP addresses). Emphasize the zero-persistence guarantee for user and session data is unchanged. In `faq.md`: expand the stub in "How does Vapor limit room creation abuse" (`Aggregate-only telemetry for operational visibility`) into a dedicated FAQ entry answering "Does Vapor collect any analytics?" — explain that only aggregate operational metrics with no user-identifiable fields are retained, Vapor is open source so users can verify, and the zero-persistence claim for user data remains in full effect. | Completed | Both files updated. Privacy policy section and FAQ entry accurately describe what is and is not persisted. | doc review |

### Test Plan

| Test # | Suite | Purpose | Verification Focus |
|---|---|---|---|
| T6.0-01 | doc review | Verify §8.1 amendment is present and accurately scopes what may and may not be persisted. | Amendment completeness; no user-identifiable field permitted. |
| T6.0-02 | doc review | Verify `privacy-policy.md` contains the "Operational Metrics" section listing what is persisted (room counts, error rates, heap usage, uptime) and explicitly listing what is never written (room IDs, participant IDs, nicknames, reconnect tokens, passwords, SDP/ICE, IP addresses). | Privacy policy completeness. |
| T6.0-03 | doc review | Verify `faq.md` contains a dedicated "Does Vapor collect any analytics?" entry explaining aggregate-only metrics, open-source verifiability, and that the zero-persistence claim for user data is unchanged. | FAQ accuracy and completeness. |

---

## VP-6.1 RAM Metrics Snapshot

### Implementation Plan

| Subtask | Task | Module / Interface | Detail | Status | Pass Criteria | Evidence Pointer |
|---|---|---|---|---|---|---|
| 6.1.1 | Create metrics.ts: snapshot function and interface | backend/src/admin/metrics.ts | Implement `collectMetricsSnapshot(): MetricsSnapshot`. Reads live RAM maps (rooms, participants, sockets) for moment-in-time counts and rolling in-memory counters for totals since last process start. Fields: `activeRooms`, `activeParticipants`, `activeSockets`, `avgParticipantsPerRoom`, `participantsJoinedTotal`, `roomsCreatedTotal`, `roomsDestroyedByReason` (host_left / host_grace_expired / room_ttl_expired / solo_timeout_expired), `errorCounts` (RATE_LIMITED / INVALID_PASSWORD / ROOM_NOT_FOUND / ROOM_FULL / NOT_AUTHORIZED), `avgRoomLifetimeMinutes` (one decimal place), `peakConcurrentRooms`, `peakConcurrentParticipants`, `temporaryBlocklistSize`, `rateLimitWindowActiveCount`, `uptimeSeconds`, `rssUsedMb`, `heapUsedMb`, `heapTotalMb`, `processStartedAt`. `rssUsedMb` is `process.memoryUsage().rss` — the total OS-resident RAM consumed by the process (heap + stack + native bindings + shared libs). This is the metric that counts against a fixed-RAM host's limit and is the correct basis for capacity planning. `heapUsedMb`/`heapTotalMb` are V8-internal figures (a subset of RSS) retained for GC diagnostics only. | Completed | `collectMetricsSnapshot()` returns a correctly structured object with all fields populated. | backend integration tests |
| 6.1.2 | Implement rolling counter exports | backend/src/admin/metrics.ts | Export increment functions: `incrementParticipantsJoined()`, `incrementRoomsCreated()`, `incrementRoomDestroyed(reason)`, `incrementErrorCount(code)`, `updateRoomLifetimeRolling(lifetimeMs)`, `updatePeakMarks()`. All synchronous, zero-overhead, operating on plain in-memory counters. Counters reset on process restart by design; the DB flush preserves history across restarts. | Completed | Each function updates only its target counter with no async and no throws. | backend integration tests |
| 6.1.3 | Wire counter increments into signaling handlers | backend/src/signaling/ | In `create_room` handler: call `incrementRoomsCreated()`. On successful `join_room`: call `incrementParticipantsJoined()`. On room destruction: call `incrementRoomDestroyed(reason)` and `updateRoomLifetimeRolling(lifetimeMs)`. On error emission for RATE_LIMITED, INVALID_PASSWORD, ROOM_NOT_FOUND, ROOM_FULL, NOT_AUTHORIZED: call `incrementErrorCount(code)`. Call `updatePeakMarks()` in each periodic sweep **and** after every successful `create_room` / `join_room` (the two points where concurrency can rise) — sweep-only sampling at the 5-hour default cadence would leave period peaks at 0 in most flush rows (R2-5, fixed 2026-06-11). All calls must be one-liners with no blocking or throws. The signaling layer imports only counter functions from admin/; admin/ must never import from signaling/ except via a state snapshot accessor. | Completed | Counters accurately reflect signaling activity. Import direction is one-way. | backend integration tests |
| 6.1.4 | Register /admin/metrics GET route | backend/src/admin/routes.ts, backend/src/server.ts | Add `GET /admin/metrics` guarded by `requireAdminAuth`. Returns `collectMetricsSnapshot()` as JSON. Wire `adminRouter` into `server.ts`. | Completed | Authenticated request to `/admin/metrics` returns a valid JSON snapshot. Unauthenticated request returns 401. | backend integration tests |

### Test Plan

| Test # | Suite | Purpose | Verification Focus |
|---|---|---|---|
| T6.1-01 | backend/tests/admin.unit.test.ts | Verify `collectMetricsSnapshot()` returns all required fields with correct types, including `rssUsedMb` (a positive number ≥ `heapUsedMb`) and `heapTotalMb` (≥ `heapUsedMb`). | Snapshot interface completeness; RSS ≥ heap invariant. |
| T6.1-02 | backend/tests/admin.unit.test.ts | Verify each rolling counter increment function increments only its target counter. | Counter isolation; no cross-increment. |
| T6.1-03 | backend/tests/admin.unit.test.ts | Verify `updatePeakMarks()` only increases peak values, never decreases them. | High-water mark invariant. |
| T6.1-04 | backend/tests/socket.integration.test.ts | Verify `roomsCreatedTotal` increases by 1 after a successful `create_room` event. | Signaling hook accuracy (create path). |
| T6.1-05 | backend/tests/socket.integration.test.ts | Verify `roomsDestroyedByReason.host_left` increases by 1 after host calls `leave_room`. | Signaling hook accuracy (destroy path). |
| T6.1-06 | backend/tests/socket.integration.test.ts | Verify `errorCounts.RATE_LIMITED` increases by 1 when a rate-limited error is emitted. | Signaling hook accuracy (error path). |
| T6.1-07 | backend/tests/admin.integration.test.ts | Verify `GET /admin/metrics` with a valid Bearer token returns 200 and a valid snapshot. | Route auth and response shape. |
| T6.1-08 | backend/tests/admin.integration.test.ts | Verify `GET /admin/metrics` with no auth header returns 401. | Unauthenticated guard. |
| T6.1-09 | backend/tests/admin.unit.test.ts | Verify `avgParticipantsPerRoom` is `0` (not NaN or Infinity) when `activeRooms = 0`. | Zero-division guard in snapshot. |
| T6.1-10 | backend/tests/admin.unit.test.ts | Verify `avgRoomLifetimeMinutes` is `0` when no rooms have been destroyed yet (zero denominator guard). | Zero-division guard in rolling average. |
| T6.1-11 | backend/tests/admin.unit.test.ts | Verify `collectMetricsSnapshot()` returns a deep copy of `roomsDestroyedByReason` and `errorCounts` — mutating the returned snapshot object does not alter internal counters. | Snapshot immutability (spread copy). |
| T6.1-12 | backend/tests/admin.unit.test.ts | Verify `getRawCounters()` returns a deep copy so that mutating it does not alter internal state. | Counter snapshot isolation for delta computation. |
| T6.1-13 | backend/tests/socket.integration.test.ts | Verify `participantsJoinedTotal` does NOT increment when a host creates a room (`create_room`) — only increments on `join_room` by a guest. | Host-vs-guest counter semantics. |
| T6.1-14 | backend/tests/socket.integration.test.ts | Verify `updatePeakMarks()` is called during each sweep and correctly reflects the highest concurrent room/participant count seen since process start. | Peak mark sweep wiring. |
| T6.1-15 | backend/tests/admin.unit.test.ts | Verify `updatePeakMarks()` updates `periodPeakRooms`/`periodPeakParticipants` when active counts exceed the current period peak, and does not decrease them when active counts drop. | Period peak high-water mark invariant. |
| T6.1-16 | backend/tests/admin.unit.test.ts | Verify `resetPeriodPeaks()` zeroes `periodPeakRooms` and `periodPeakParticipants` without affecting the all-time `peakConcurrentRooms`/`peakConcurrentParticipants` in `getRawCounters()`. | Period reset isolation from all-time peaks. |
| T6.1-17 | backend/tests/admin.unit.test.ts | Verify `getPeriodPeaks()` returns `{0, 0}` on a fresh instance, the correct values after `updatePeakMarks()`, and `{0, 0}` again after `resetPeriodPeaks()`. | `getPeriodPeaks` round-trip correctness. |

---

## VP-6.2 Admin Auth Middleware

### Implementation Plan

| Subtask | Task | Module / Interface | Detail | Status | Pass Criteria | Evidence Pointer |
|---|---|---|---|---|---|---|
| 6.2.1 | Create auth.ts: requireAdminAuth middleware | backend/src/admin/auth.ts | Implement `requireAdminAuth` Express middleware. Auth precedence: (1) `Authorization: Bearer <token>` header — compare against `ADMIN_API_TOKEN` env var; (2) HTTP Basic Auth — compare username/password against `ADMIN_BASIC_USER` / `ADMIN_BASIC_PASS` env vars. Unauthenticated requests receive 401 with no payload. Admin auth is entirely separate from the signaling socket layer and must not share session state with room participants. | Completed | Bearer and Basic auth both grant access. 401 on missing or incorrect credentials. | backend integration tests |
| 6.2.2 | Fail-secure startup guard | backend/src/server.ts | On startup, if neither `ADMIN_API_TOKEN` nor `ADMIN_BASIC_USER`/`ADMIN_BASIC_PASS` env vars are set, log a warning and skip admin route registration entirely. No unguarded admin endpoint may exist. | Completed | Server logs warning and omits admin routes when no auth env vars are configured. No admin endpoint is reachable. | backend integration tests |

### Test Plan

| Test # | Suite | Purpose | Verification Focus |
|---|---|---|---|
| T6.2-01 | backend/tests/admin.integration.test.ts | Verify Bearer token auth succeeds with correct `ADMIN_API_TOKEN` and returns 401 with an incorrect token. | Bearer auth accuracy. |
| T6.2-02 | backend/tests/admin.integration.test.ts | Verify HTTP Basic auth succeeds with correct credentials and returns 401 with incorrect credentials. | Basic auth accuracy. |
| T6.2-03 | backend/tests/admin.integration.test.ts | Verify a request with no auth header returns 401 with no payload. | Unauthenticated guard. |
| T6.2-04 | backend/tests/admin.integration.test.ts | Verify admin routes are absent (404) when no auth env vars are configured at startup. | Fail-secure guard. |
| T6.2-05 | backend/tests/admin.unit.test.ts | Verify Bearer token comparison is length-sensitive: a token that is a prefix of the correct token is rejected. | Timing-safe comparison correctness. |
| T6.2-06 | backend/tests/admin.unit.test.ts | Verify Basic auth correctly handles a password that contains a colon character (e.g., `user:pass:word`) — only the first colon is used as the separator. | Basic auth colon-in-password edge case. |
| T6.2-07 | backend/tests/admin.unit.test.ts | Verify that a lowercase `bearer ` prefix (case mismatch) is rejected with 401 — auth prefix matching is case-sensitive. | Case-sensitive prefix rejection. |
| T6.2-08 | backend/tests/admin.integration.test.ts | Verify that when both Bearer and Basic env vars are configured and a request presents a wrong Bearer token (but valid Basic credentials), the request is still rejected — Bearer failure does not fall through to Basic. | Auth method independence; no cross-fallthrough on wrong token. |
| T6.2-09 | backend/tests/admin.integration.test.ts | Verify that when `ADMIN_API_TOKEN` is set to an empty string, admin routes are not reachable (empty string is treated as "not set"). | Empty-string env var treated as unconfigured. |

---

## VP-6.3 Live Admin Dashboard

### Implementation Plan

| Subtask | Task | Module / Interface | Detail | Status | Pass Criteria | Evidence Pointer |
|---|---|---|---|---|---|---|
| 6.3.1 | Install Tremor UI components | frontend/ | Run `npx tremor@latest add card metric-card area-chart bar-chart badge`. Tremor v3 is built on shadcn/ui and Tailwind CSS, both already present — no additional setup required. | Completed | Tremor components are importable. No build errors introduced. | build verification |
| 6.3.2 | Create AdminDashboard.tsx and /admin route | frontend/src/features/admin/AdminDashboard.tsx | Main page for the `/admin` route. Renders a Bearer token input form on first load. Token precedence follows VP-6.10.4: build-time `VITE_ADMIN_TOKEN` (auto-auth) → `localStorage` (persisted manual entry) → manual form. Route must not appear in any participant-visible navigation. | Completed | `/admin` route renders. Auth gate blocks metrics display until a token is available. | manual verification |
| 6.3.3 | Create LiveMetrics.tsx | frontend/src/features/admin/LiveMetrics.tsx | Polls `GET /admin/metrics` every 30 seconds. Renders Tremor metric cards — row 1: Active Rooms, Active Participants, Active Sockets, RSS Used MB; row 2: Rooms Created (since restart), Peak Concurrent Rooms, Rate Limited Events, Uptime. "RSS Used MB" displays `rssUsedMb` with `heapUsedMb / heapTotalMb` shown as a subtitle line (e.g. "12.33 MB heap of 13.86 MB total") — RSS is the primary figure because it is what counts against a fixed-RAM host's memory limit; heap figures are secondary diagnostic context. Abuse control panel: blocklist size and active rate limit windows. Shows "Last updated N seconds ago" staleness indicator and a manual Refresh button. | Completed | Metric cards populate with live values. RSS card shows `rssUsedMb` as the primary value with heap figures in the subtitle. Staleness indicator updates between polls. Refresh triggers an immediate re-fetch. | manual verification |
| 6.3.4 | Create adminApi.ts | frontend/src/features/admin/adminApi.ts | Typed fetch wrappers: `fetchMetrics(token): Promise<MetricsSnapshot>`, `fetchHistory(token, range): Promise<HourlyRow[]>`, `triggerReport(token, type): Promise<void>`. All include `Authorization: Bearer` header from the session token. 401 responses surface as thrown errors. | Completed | Each function returns a correctly typed response. 401 throws rather than returning silently. | manual verification |
| 6.3.5 | Configure Docker memory limit for the backend service | docker-compose.yml | Add `mem_limit: 256m` and `memswap_limit: 256m` to the `backend` service in `docker-compose.yml`. `mem_limit: 256m` caps the container's total RAM to 256 MB, matching a realistic entry-tier hosting environment (e.g. Railway Starter, Fly.io Shared-CPU-1x). `memswap_limit` must equal `mem_limit` (not `0`) to disable swap — leaving it unset allows Docker to allocate up to 2× the memory limit as swap, masking real-world OOM conditions. Also add `env_file: - ./backend/.env` to the backend service so admin credentials defined in `backend/.env` are available to the container at runtime without duplicating them in `environment:`. Baseline RSS at 0 rooms / 0 participants is ~40–60 MB, leaving ~200 MB of headroom before OOM-kill. The `rssUsedMb` metric collected in VP-6.1 and surfaced as the primary memory card in `LiveMetrics.tsx` allows the operator to correlate live usage against this cap. Bump to 512 MB only if the container starts being OOM-killed under real load. | Completed | `docker compose up` starts the backend container with a 256 MB RAM cap. `docker inspect vapor-backend --format '{{ "{{" }}.HostConfig.Memory{{ "}}" }}'` returns `268435456` (256 × 1024²). Dashboard RSS card reflects live memory usage within the cap. | infrastructure verification |

### Test Plan

| Test # | Suite | Purpose | Verification Focus |
|---|---|---|---|
| T6.3-01 | manual E2E | Verify `/admin` route renders the credential prompt before any metrics. Entering a valid token shows the dashboard; entering an invalid token shows an error. | Auth gate UX. |
| T6.3-02 | backend/tests/admin.unit.test.ts | Verify Tremor metric cards display values matching the `GET /admin/metrics` response. The RSS card's primary value matches `rssUsedMb`; the subtitle shows `heapUsedMb` / `heapTotalMb`. No card displays a raw heap value as a top-level primary figure. Verified by source inspection of `LiveMetrics.tsx`. | `rssUsedMb` appears on a `value=` prop line; `heapUsedMb`/`heapTotalMb` appear on a `subtitle=` prop line; `rssUsedMb` absent from any `subtitle=` line. |
| T6.3-03 | backend/tests/admin.unit.test.ts | Verify the staleness indicator resets to 0 on a successful fetch and increments based on `Date.now() - lastUpdatedAt`. Verified by source inspection of `LiveMetrics.tsx`. | `setSecondsSince(0)` on success path; increment computed from `lastUpdatedAt`; catch block does not reset the counter (staleness stays accurate on failure). |
| T6.3-04 | manual E2E | Verify that submitting a whitespace-only token is blocked by the disabled Authenticate button (the form never fires). | Empty token client-side guard. |
| T6.3-05 | manual E2E | Verify that "Sign out" clears the session token and returns to the credential prompt, and that no metrics are visible or cached after sign-out. | Session token teardown. |
| T6.3-06 | backend/tests/admin.unit.test.ts | Verify that when `fetchMetrics` throws an `AdminAuthError` (401 mid-session), the catch block calls `setFetchError` but NOT `setSnapshot`, and the component early-returns the error UI before rendering metrics. Verified by source inspection of `LiveMetrics.tsx`. | `setFetchError` called in catch; `setSnapshot` absent from catch body; `if (fetchError)` early-return gates all metrics display. |
| T6.3-07 | code review | Verify the `/admin` route is not linked or reachable from any participant-facing navigation (room page, lobby, info pages). | Route isolation from user-facing UI. |
| T6.3-08 | infrastructure verification | Verify `docker-compose.yml` contains `mem_limit: 256m` and `memswap_limit: 256m` on the backend service, and that the two values are equal (swap disabled). Confirm `memswap_limit` is not `0` (which would allow up to 2× the limit as swap). | Memory cap presence and swap-disable correctness. |

---

## VP-6.4 Analytics Store

### Implementation Plan

| Subtask | Task | Module / Interface | Detail | Status | Pass Criteria | Evidence Pointer |
|---|---|---|---|---|---|---|
| 6.4.1 | Define `AnalyticsStore` interface and `CsvAnalyticsStore` | backend/src/admin/analytics.ts | The `AnalyticsStore` interface has three methods: `writeSnapshot(row: PeriodicRow): Promise<void>`, `queryRows(fromEpoch, toEpoch): Promise<PeriodicRow[]>`, `close(): Promise<void>`. `CsvAnalyticsStore` implements this interface: constructor takes a file path, creates parent dirs, writes a header row on first create, then appends one numeric CSV line per flush. `queryRows` reads and parses the file, filtering by epoch range. All column values are numbers so no CSV escaping is needed. Callers construct a `CsvAnalyticsStore` and pass it into the scheduler and report generators — the store type is never hard-coded in those modules. When Supabase is ready, implement `SupabaseAnalyticsStore` satisfying the same interface and swap at the construction site only. `PeriodicRow` fields: `recordedAt` (epoch ms), `activeRooms`, `activeParticipants`, `activeSockets`, `avgParticipantsPerRoom`, `participantsJoinedDelta`, `roomsCreatedDelta`, `roomsDestroyedHostLeft`, `roomsDestroyedGrace`, `roomsDestroyedTtl`, `roomsDestroyedSolo`, `avgRoomLifetimeMinutes`, `errRateLimited`, `errInvalidPassword`, `errRoomNotFound`, `errRoomFull`, `peakRooms`, `peakParticipants`, `blocklistSize`, `rssUsedMb`, `heapUsedMb`, `heapTotalMb`, `uptimeSeconds`, `processStartedAt`. `peakRooms` and `peakParticipants` are the highest concurrent counts observed **within that 30-minute flush interval only** — they reset to 0 after each flush. All-time watermarks are kept separately in the live metrics snapshot for the dashboard only and are never written to CSV rows. `rssUsedMb` is the OS-resident RAM footprint and the primary capacity-planning signal; `heapUsedMb`/`heapTotalMb` are retained as secondary GC-diagnostic columns. What is never written: room IDs, participant IDs, nicknames, reconnect tokens, passwords, SDP/ICE payloads, IP addresses, or socket IDs. | Completed | `CsvAnalyticsStore.writeSnapshot` appends a correctly structured row. `queryRows` returns only rows in the requested epoch range. File is created with header on first write. | backend unit tests |
| 6.4.2 | Implement aggregate helpers and row builder | backend/src/admin/analytics.ts | `buildPeriodicRow(snapshot, deltas, now)` — maps `MetricsSnapshot` + `MetricsDeltas` into a `PeriodicRow`. `queryDailyAggregate(store, dateLabel)`, `queryWeeklyAggregate(store, weekStart)`, `queryMonthlyAggregate(store, year, month)` — all query the store for the relevant epoch range and call `computeAggregate(label, rows)`. `computeAggregate` produces a `PeriodAggregate`: `periodLabel`, `totalParticipantsJoined`, `totalRoomsCreated`, `destroyReasonBreakdown` (host_left / grace_expired / ttl_expired / solo_timeout — total destroyed is implicit as the sum of reasons), `peakConcurrentRooms` (`max(peakRooms)` across all rows in the period), `peakConcurrentParticipants` (`max(peakParticipants)` across all rows in the period), `avgRoomLifetimeMinutes` (weighted), `topErrors`, `restartCount` (distinct `processStartedAt` values), `rows`. `totalRoomsDestroyed` is intentionally absent — callers who need the total can sum `destroyReasonBreakdown`. Weekly peaks are derived as `max` of the constituent daily rows' `peakRooms`/`peakParticipants`; monthly peaks are derived the same way across the monthly row set — no separate daily-peak aggregation step is required because `max` is associative. | Completed | Aggregate functions return correct totals, peaks, and restart count for a known set of inserted rows. | backend unit tests |

### Test Plan

| Test # | Suite | Purpose | Verification Focus |
|---|---|---|---|
| T6.4-01 | backend/tests/admin.unit.test.ts | Verify `CsvAnalyticsStore.writeSnapshot` appends a valid CSV row and the file is created with the correct header. | CSV write path. |
| T6.4-02 | backend/tests/admin.unit.test.ts | Verify `queryRows` returns only rows within the requested epoch range and excludes rows outside it. | Range filter correctness. |
| T6.4-03 | backend/tests/admin.unit.test.ts | Verify `computeAggregate` returns correct totals, peaks, weighted average lifetime, and restart count for a known row set. Verify `avgRssUsedMb` equals the mean of `rssUsedMb` across rows and `peakRssUsedMb` equals the max. | Aggregation accuracy; RSS aggregate fields. |
| T6.4-04 | backend/tests/admin.unit.test.ts | Verify `queryRows` returns `[]` when the file contains only the header line (no data rows). | Header-only file edge case. |
| T6.4-05 | backend/tests/admin.unit.test.ts | Verify `queryRows` silently skips a CSV line that has the wrong number of columns (corrupt line), returning only valid rows. | Corrupt line resilience. |
| T6.4-06 | backend/tests/admin.unit.test.ts | Verify that `CsvAnalyticsStore` does not overwrite an existing file's header on a second instantiation (idempotent constructor). | Header written only on first create. |
| T6.4-07 | backend/tests/admin.unit.test.ts | Verify `computeAggregate` returns `avgRoomLifetimeMinutes: 0` when all rows have `avgRoomLifetimeMinutes = 0` and zero rooms destroyed (no division by zero). | Weighted-average zero-denominator guard. |
| T6.4-08 | backend/tests/admin.unit.test.ts | Verify `computeAggregate` counts `restartCount` as the number of distinct `processStartedAt` values across the row set (not the number of rows). | Restart count deduplication. |
| T6.4-09 | backend/tests/admin.unit.test.ts | Verify `queryDailyAggregate` uses UTC midnight boundaries — a row exactly at epoch `Date.UTC(y,m-1,d)` is included and a row at `Date.UTC(y,m-1,d) - 1` is excluded. | UTC boundary correctness. |
| T6.4-10 | backend/tests/admin.unit.test.ts | Verify `NOT_AUTHORIZED` errors are tracked in `MetricsSnapshot.errorCounts` but are intentionally absent from `PeriodicRow` — confirm this is by design (admin-layer-only errors not analytically relevant) and document the omission. | Deliberate `NOT_AUTHORIZED` omission from flush path. |
| T6.4-11 | backend/tests/admin.unit.test.ts | Verify `buildPeriodicRow` acts as an explicit field allowlist: when a `MetricsSnapshot` is polluted with forbidden user-identifiable fields (e.g. `roomId: "secret-room-123"`, `participantNickname: "Alice"`), those fields must not appear in the returned `PeriodicRow`. Ensures the analytics layer is secure by default — accidental additions to the source snapshot are stripped before any write path. | Data omission / deny-list guardrail. |
| T6.4-12 | backend/tests/admin.unit.test.ts | Verify `buildPeriodicRow` maps `rssUsedMb` from the snapshot into the row, and that the resulting row has `rssUsedMb ≥ heapUsedMb` for any realistic input. | RSS field pass-through and magnitude invariant. |

---

## VP-6.5 Periodic Metrics Flush

### Implementation Plan

| Subtask | Task | Module / Interface | Detail | Status | Pass Criteria | Evidence Pointer |
|---|---|---|---|---|---|---|
| 6.5.1 | Create scheduler.ts: periodic flush with injectable interval | backend/src/admin/scheduler.ts | Export `METRICS_FLUSH_INTERVAL_MS = 30 * 60 * 1000` (30 minutes) as a named constant — change this one constant to adjust the collection period globally. `createScheduler({ metrics, store, flushIntervalMs? })` accepts an optional `flushIntervalMs` (default `METRICS_FLUSH_INTERVAL_MS`). Internally uses `setInterval` (not cron) so test suites can pass a short interval (e.g. 500 ms) without waiting 30 minutes. Each tick: (1) call `metrics.collectMetricsSnapshot()` for live values; (2) compute `MetricsDeltas` by diffing current `getRawCounters()` against last-flushed counters; (3) call `store.writeSnapshot(buildPeriodicRow(...))` fire-and-forget; (4) save current counters as the new last-flushed baseline. 30-minute rows are the atomic unit for all reports: daily reports aggregate 48 rows/day, weekly 7 × 48, monthly ~30 × 48. Returns `{ start(), stop(), flush() }` — `flush()` runs one tick immediately (useful for tests and manual triggers). `start()` must guard against being called twice: if `intervalId` is already set, return immediately without creating a second interval (`if (intervalId) return`). | Completed | Scheduler fires at the configured interval. Two consecutive rows show per-period delta values. `flush()` produces a row immediately when called directly. Calling `start()` twice does not create duplicate intervals. | backend unit tests |
| 6.5.2 | Startup flush with warm-up delay | backend/src/admin/scheduler.ts | On `start()`, after a 60-second warm-up delay, call `flush()` once. Provides a baseline record per process start. The `processStartedAt` field lets report queries identify restart events between consecutive rows. Warm-up delay is skipped when `flushIntervalMs < 60_000` (test mode). | Completed | One row is written approximately 60 seconds after `start()` in production mode. Warm-up is skipped in test mode. | backend unit tests |
| 6.5.3 | Delta counter tracking and per-interval peak reset | backend/src/admin/metrics.ts, backend/src/admin/scheduler.ts | Maintain a last-flushed counter snapshot in memory (initialised to zeros). On each flush compute per-field deltas: `delta = currentTotal - lastFlushedTotal`. For `avgRoomLifetimeMinutes` use the raw `roomLifetimeTotalMs` and `roomLifetimeCount` deltas to compute a per-period weighted average. Update the last-flushed snapshot after each flush. Deltas represent per-period activity, not cumulative totals. Additionally, track `periodPeakRooms` and `periodPeakParticipants` counters that are updated by `updatePeakMarks()` during the interval and reset to 0 immediately after each flush write. These per-interval peaks are written to `peakRooms`/`peakParticipants` in the `PeriodicRow`. All-time watermarks (`peakConcurrentRooms`, `peakConcurrentParticipants`) continue to be tracked in `newMetrics` for the live dashboard snapshot only and are never written to CSV rows. | Completed | Two consecutive rows show delta values reflecting only the activity in that interval. `peakRooms`/`peakParticipants` in each row reflect the interval's peak, not an all-time watermark. Period-peak counters are 0 at the start of each new interval. | backend unit tests |

### Test Plan

| Test # | Suite | Purpose | Verification Focus |
|---|---|---|---|
| T6.5-01 | backend/tests/admin.unit.test.ts | Verify `createScheduler` with a short `flushIntervalMs` writes rows at the expected cadence. | Injectable interval correctness. |
| T6.5-02 | backend/tests/admin.unit.test.ts | Verify two consecutive `flush()` calls produce rows with per-period delta values, not cumulative totals. | Delta counter accuracy. |
| T6.5-03 | backend/tests/admin.unit.test.ts | Verify `flush()` called directly writes one row immediately without waiting for the interval. | Manual flush correctness. |
| T6.5-04 | backend/tests/admin.unit.test.ts | Verify `processStartedAt` in each row matches the actual process start epoch and differs across restart events. | Restart annotation correctness. |
| T6.5-05 | backend/tests/admin.unit.test.ts | Verify `flush()` before any counter increments produces a row where all delta fields are 0 (zero-activity baseline). | First-flush zero-delta correctness. |
| T6.5-06 | backend/tests/admin.unit.test.ts | Verify `stop()` called before `start()` is a no-op and does not throw. | Safe stop on unstarted scheduler. |
| T6.5-07 | backend/tests/admin.unit.test.ts | Verify `peakRooms` and `peakParticipants` in a flushed row reflect the highest concurrent count observed **within that flush interval only** — not an all-time watermark. After the flush, period-peak counters reset to 0; the next flush interval starts fresh. | Per-interval peak semantics and reset behaviour. |
| T6.5-08 | backend/tests/admin.unit.test.ts | Verify that when `store.writeSnapshot()` rejects, the scheduler logs the error, does not crash, and the baseline counter is still advanced (the failed period's counts are not double-counted in the next flush). | Write-failure baseline integrity. |
| T6.5-09 | backend/tests/admin.unit.test.ts | Verify that `checkReports` is skipped in test mode (`flushIntervalMs < 60_000`) and does not fire report generators. | Test-mode report suppression. |
| T6.5-10 | backend/tests/admin.unit.test.ts | Verify that the monthly report midnight check correctly handles the January 1st rollover: `prevMonth = 12`, `prevYear = currentYear - 1`. | Year-boundary month rollover. |
| T6.5-11 | backend/tests/admin.unit.test.ts | Verify that calling `start()` a second time without an intervening `stop()` is a no-op — only one interval fires, producing exactly one row per interval tick, not two. | Double-start guard (no duplicate interval). |
| T6.5-12 | backend/tests/admin.unit.test.ts | Verify that `stop()` after `start()` cancels the interval — no additional rows are written after `stop()` is called, even after multiple interval durations have elapsed. | Interval cancellation on stop. |

---

## VP-6.6 Report Generation Engine

### Implementation Plan

| Subtask | Task | Module / Interface | Detail | Status | Pass Criteria | Evidence Pointer |
|---|---|---|---|---|---|---|
| 6.6.1 | Create reports.ts: daily/weekly/monthly generators | backend/src/admin/reports.ts | Implement `generateDailyReport(store, date)`, `generateWeeklyReport(store, weekStart)`, `generateMonthlyReport(store, year, month)`. Each calls the corresponding `queryDailyAggregate` / `queryWeeklyAggregate` / `queryMonthlyAggregate` from `analytics.ts`, passing the injected `AnalyticsStore`. Returns a `PeriodAggregate` (already contains `rows` for the CSV attachment). `store` is injected so the generator works with any `AnalyticsStore` implementation. On store query failure: log error and return `null`; caller skips the email send without crashing. **Report content scope:** Reports contain only historical accumulated data — event-count deltas (rooms created, participants joined, errors), destruction reason breakdown, per-period peak concurrent counts, average room lifetime, and restart count. Instantaneous/active-state fields (`activeRooms`, `activeSockets`, `activeParticipants`, current heap/RAM readings) must not appear in the email report body; they are point-in-time observations, not summaries of what happened during the period. The raw `PeriodicRow[]` in `report.rows` (used for the CSV attachment) retains all columns including active-state fields for completeness. | Completed | Each generator returns a fully populated `PeriodAggregate` for a known set of rows with correct aggregates. Returns `null` on store error without throwing. Report body contains only accumulated/historical fields. | backend unit tests |
| 6.6.2 | Wire report schedule into scheduler.ts | backend/src/admin/scheduler.ts | Add three daily-aligned `setInterval`-style checks inside `createScheduler`: daily report fires when the UTC date changes (midnight crossing detected between ticks), weekly fires on Monday midnight, monthly fires on the 1st of the month. Each fires the corresponding generator then `sendReportEmail()`. On error: log and skip without crashing. Failed reports are not retried. | Completed | Manual trigger of each report generator produces a report email with CSV attachment. Error produces a log entry and no crash. | manual E2E |

### Test Plan

| Test # | Suite | Purpose | Verification Focus |
|---|---|---|---|
| T6.6-01 | backend/tests/admin.unit.test.ts | Verify `generateDailyReport` correctly aggregates totals, peaks, and restart count for a fixed set of mock rows. | Aggregation logic accuracy. |
| T6.6-02 | backend/tests/admin.unit.test.ts | Verify `restartCount` equals the number of distinct `process_started_at` values in the period. | Restart detection accuracy. |
| T6.6-03 | manual E2E | Manually trigger the daily report and verify an email is received at the configured recipient address with the correct period label. Verify the HTML body contains only historical accumulated fields (rooms created delta, destruction reason counts, peak concurrent, avg lifetime, error counts, restart count) and no active-state fields (active rooms, active sockets, current memory). | End-to-end report delivery and content scope. |
| T6.6-04 | backend/tests/admin.unit.test.ts | Verify that when the store's `queryRows` rejects, `generateDailyReport` returns `null`, the rejection is logged as an error, and the process does not crash. (T6.6-05 was merged into this test — null-return and error-log assertions are combined.) | Store-failure: null return + logging + process safety. |
| T6.6-06 | backend/tests/admin.unit.test.ts | Verify `generateDailyReport` returns a valid `PeriodAggregate` with all-zero counts when the store returns no rows for the date (period with no activity). | Empty-period aggregate shape. |
| T6.6-07 | backend/tests/admin.unit.test.ts | Verify the `periodLabel` in the returned `PeriodAggregate` matches the input date: daily → `"YYYY-MM-DD"`, weekly → `"YYYY-MM-DD"` of Monday, monthly → `"YYYY-MM"`. | Period label format per report type. |

---

## VP-6.7 Email Delivery

### Implementation Plan

| Subtask | Task | Module / Interface | Detail | Status | Pass Criteria | Evidence Pointer |
|---|---|---|---|---|---|---|
| 6.7.1 | Create emailDelivery.ts: Nodemailer + Gmail SMTP | backend/src/admin/emailDelivery.ts | Implement `sendReportEmail(report: PeriodAggregate): Promise<void>` using Nodemailer with Gmail SMTP. Gmail requires an app password (2FA must be enabled; app password is generated in Google Account settings, not the account password). Required env vars: `REPORT_EMAIL_FROM` (Gmail sender address), `REPORT_EMAIL_TO` (admin email address), `GMAIL_APP_PASSWORD`. Email format: Subject `[Vapor] Report — <periodLabel>`; HTML body with a metrics table showing **historical accumulated data only**: participants joined (delta), rooms created (delta), destruction reason breakdown (host_left / grace_expired / ttl_expired / solo_timeout counts), peak concurrent rooms, peak concurrent participants, avg room lifetime, error counts by type, restart count. Active/instantaneous fields (`activeRooms`, `activeSockets`, current heap/RAM readings) are excluded from the email body — they are not period summaries. CSV attachment generated from `report.rows` (raw `PeriodicRow[]`, which includes all columns for completeness). | Completed | Test email delivers to the configured recipient address with the correct subject, HTML body (historical data only, no active-state fields), and CSV attachment. | manual E2E |

### Test Plan

| Test # | Suite | Purpose | Verification Focus |
|---|---|---|---|
| T6.7-01 | manual E2E | Send a test email manually using `sendReportEmail` with a stub `PeriodAggregate`. Verify delivery to the configured recipient address. | SMTP auth and delivery. |
| T6.7-02 | manual E2E | Verify email subject is `[Vapor] Report — <periodLabel>` where `periodLabel` encodes the report type by format: `YYYY-MM-DD` (daily/weekly) or `YYYY-MM` (monthly). Note: the subject does not include an explicit "Daily"/"Weekly"/"Monthly" label — the period format serves as the differentiator. | Subject line format accuracy. |
| T6.7-03 | manual E2E | Verify the CSV attachment is a valid CSV with one row per periodic record and correct column headers matching `PeriodicRow` field order. | CSV attachment correctness. |
| T6.7-04 | backend/tests/admin.unit.test.ts | Verify `sendReportEmail` returns early without throwing when `report` is `null`. | Null report guard. |
| T6.7-05 | backend/tests/admin.unit.test.ts | Verify `sendReportEmail` logs an error and returns early when any of `REPORT_EMAIL_FROM`, `REPORT_EMAIL_TO`, or `GMAIL_APP_PASSWORD` env vars are missing. | Missing env var guard. |
| T6.7-06 | backend/tests/admin.unit.test.ts | Verify `buildCsv` with an empty `rows` array produces only the header line (no data lines, no trailing newline issues). | Empty rows CSV output. |
| T6.7-07 | backend/tests/admin.unit.test.ts | Verify `minutesToReadable` edge cases: 0 minutes → `"0s"`, 0.5 minutes → `"30s"`, exactly 1 minute → `"1m"`, exactly 60 minutes → `"1h"`, 90 minutes → `"1h 30m"`, 119.7 minutes → `"2h"` (rounding must never produce `"1h 60m"`). | Time formatting correctness incl. hour-rollover rounding. |
| T6.7-08 | backend/tests/admin.unit.test.ts | Verify the `buildEmailHtml` (or equivalent HTML builder) function renders a "No errors recorded in this period." message when all error counts in the `PeriodAggregate` are zero. Also verify the rendered HTML contains the `avgRssUsedMb`/`peakRssUsedMb` values and contains no `undefined` (guards against missing-field renders like "undefined MB"). This is a pure function test — no SMTP call required. | Error-free period HTML rendering; RSS field rendering. |

---

## VP-6.8 Historical Trend Charts

### Implementation Plan

| Subtask | Task | Module / Interface | Detail | Status | Pass Criteria | Evidence Pointer |
|---|---|---|---|---|---|---|
| 6.8.1 | Add /admin/history endpoint | backend/src/admin/routes.ts | Add `GET /admin/history?range=24h\|7d\|30d` guarded by `requireAdminAuth`. Calls `store.queryRows(from, to)` on the injected `AnalyticsStore`. Returns a JSON array of `PeriodicRow` ordered by `recordedAt` ascending. | Completed | Authenticated request returns ordered rows for the specified range. Unauthenticated request returns 401. | backend integration tests |
| 6.8.2 | Create HistoricalCharts.tsx | frontend/src/features/admin/HistoricalCharts.tsx | Fetches from `GET /admin/history` on range change (24h / 7d / 30d toggle). Renders Tremor AreaCharts: active rooms over time, active participants over time, rooms created per period, RAM usage (`rssUsedMb`) over time. Renders a Tremor BarChart for room destruction reason breakdown. All charts share one range selector. Handles "no data yet" empty state gracefully. | Completed | Charts render with data for each range. RAM usage chart uses `rssUsedMb` (not `heapUsedMb`). Empty state is shown gracefully when no rows exist. | manual verification |
| 6.8.3 | Create ReportControls.tsx | frontend/src/features/admin/ReportControls.tsx | Manual report trigger buttons (Daily / Weekly / Monthly) that POST to `POST /admin/report/:type`. CSV export button that downloads the current `/admin/history` response as a CSV file client-side. Displays success/error feedback per action. | Completed | Manual trigger sends request to backend and shows success/error message. CSV download produces a valid file in the browser. | manual verification |

### Test Plan

| Test # | Suite | Purpose | Verification Focus |
|---|---|---|---|
| T6.8-01 | backend/tests/admin.integration.test.ts | Verify `GET /admin/history?range=24h` returns only rows within the past 24 hours, ordered by `recorded_at` ascending. | Range filter and sort order. |
| T6.8-02 | backend/tests/admin.integration.test.ts | Verify `GET /admin/history` with no auth header returns 401. | Unauthenticated guard. |
| T6.8-03 | manual E2E | Verify all historical charts render with real data after at least a few periodic rows exist in the store. | Chart data population. |
| T6.8-04 | backend/tests/admin.unit.test.ts | Verify `HistoricalCharts` renders a descriptive empty state message when `rows.length === 0` and that charts only render when `rows.length > 0`. Verified by source inspection of `HistoricalCharts.tsx`. | `rows.length === 0` guard present; descriptive message text present; charts gated on `rows.length > 0`. |
| T6.8-05 | manual E2E | Verify the CSV export downloads a valid file reflecting the currently selected range's history data. | CSV export correctness. |
| T6.8-06 | backend/tests/admin.integration.test.ts | Verify `GET /admin/history` with no `range` query parameter returns 400 with an error body. | Missing range parameter guard. |
| T6.8-07 | backend/tests/admin.integration.test.ts | Verify `GET /admin/history?range=1h` (unsupported range value) returns 400 with an error body. | Invalid range value rejection. |
| T6.8-08 | backend/tests/admin.integration.test.ts | Verify `POST /admin/report/:type` with an unknown type (e.g., `quarterly`) returns 400 with an error body. | Invalid report type rejection. |
| T6.8-09 | backend/tests/admin.integration.test.ts | Verify `POST /admin/report/daily` returns 204 even when the report generator returns `null` (e.g., no data for yesterday) — email send is skipped silently. | Null report 204 path. |
| T6.8-10 | backend/tests/admin.integration.test.ts | Verify `GET /admin/history?range=7d` sorts rows ascending by `recordedAt` even when the store returns them in arbitrary order. | Sort correctness on unordered store output. |
| T6.8-11 | manual E2E | Verify switching the range selector (24h → 7d → 30d) triggers a new fetch and updates all charts simultaneously without stale data from the previous range. | Range toggle fetch behavior. |
| T6.8-12 | manual E2E | Verify the CSV export filename reflects the currently selected range (e.g., `vapor-history-24h.csv`) and all columns match the `PeriodicRow` field order. | CSV export filename and column order. |

---

## VP-6.9 Dead Variable Cleanup

### Context

`backend/src/index.ts` reads `process.env.ADMIN_METRICS_TOKEN` (a stale variable name from an earlier design) and passes it as `adminMetricsToken` into `createVaporServer`. Inside `server.ts`, that argument is unused (prefixed `_adminMetricsToken`); the auth middleware reads `process.env.ADMIN_API_TOKEN` directly from the environment instead. This means `ADMIN_METRICS_TOKEN` has no effect and the arg plumbing is dead code.

### Implementation Plan

| Subtask | Task | Module | Detail | Status | Pass Criteria | Evidence Pointer |
|---|---|---|---|---|---|---|
| 6.9.1 | Remove dead `adminMetricsToken` param and `ADMIN_METRICS_TOKEN` read | backend/src/index.ts, backend/src/server.ts | Delete `const adminMetricsToken = process.env.ADMIN_METRICS_TOKEN` from `index.ts`. Remove `adminMetricsToken` from the `createVaporServer` call and from the `CreateVaporServerArgs` type. Remove the `adminMetricsToken: _adminMetricsToken` destructure entry in `server.ts`. The `requireAdminAuth` middleware already reads `process.env.ADMIN_API_TOKEN` directly and is unaffected. | Completed | No TypeScript errors. Admin auth behavior unchanged. No reference to `ADMIN_METRICS_TOKEN` or `adminMetricsToken` remains in the codebase. | backend integration tests |

---

## VP-6.10 Admin Dashboard Auto-Authentication

### Context

The admin dashboard previously required manual token entry on every fresh page load and after every Docker rebuild. `backend/.env` is the operator's single source of truth for credentials, but the React frontend cannot read server-side env files directly. This section wires `ADMIN_API_TOKEN` from `backend/.env` into the Vite build/dev process so the dashboard auto-authenticates without any user interaction.

### Implementation Plan

| Subtask | Task | Module / Interface | Detail | Status | Pass Criteria |
|---|---|---|---|---|---|
| 6.10.1 | Forward `backend/.env` into the frontend container | docker-compose.yml | Add `env_file: - ./backend/.env` to the `frontend` service. Docker Compose injects all variables from that file into the container process environment before Vite starts, making `ADMIN_API_TOKEN` available as `process.env.ADMIN_API_TOKEN` inside the Vite dev server process. | Completed | After compose up, `ADMIN_API_TOKEN` is set in the frontend container env (verify with `docker exec vapor-frontend printenv ADMIN_API_TOKEN`). |
| 6.10.2 | Expose token to client code via Vite `define` | frontend/vite.config.ts | Add `define: { 'import.meta.env.VITE_ADMIN_TOKEN': JSON.stringify(process.env.ADMIN_API_TOKEN ?? '') }`. Vite's `define` performs a compile-time string replacement, injecting the token value read from the container env into the client bundle. Empty string when the env var is absent (admin auto-auth disabled). | Completed | `import.meta.env.VITE_ADMIN_TOKEN` resolves to the correct token value at runtime. |
| 6.10.3 | Declare the env var type | frontend/src/vite-env.d.ts | Create the file with `/// <reference types="vite/client" />` and an `ImportMetaEnv` extension declaring `readonly VITE_ADMIN_TOKEN?: string`. Prevents TypeScript errors when accessing `import.meta.env.VITE_ADMIN_TOKEN`. | Completed | No TypeScript errors on `import.meta.env.VITE_ADMIN_TOKEN` access. |
| 6.10.4 | Auto-authenticate in `AdminDashboard.tsx` | frontend/src/features/admin/AdminDashboard.tsx | Change `useState` initializer to: check `import.meta.env.VITE_ADMIN_TOKEN` first; if truthy, return it as the initial session token (dashboard loads directly, form is never shown); otherwise fall back to `localStorage.getItem(STORAGE_KEY)` for persisted manual entries. Sign-out clears localStorage and sets token to `null` for the current session; page refresh re-authenticates via the build-time token. | Completed | Navigating to `/admin` loads the dashboard directly when `ADMIN_API_TOKEN` is set; the credential form is never shown. |

### Auth Priority Order (Runtime)

1. `import.meta.env.VITE_ADMIN_TOKEN` — injected at Vite startup from `ADMIN_API_TOKEN`; zero user interaction; works after every Docker rebuild
2. `localStorage` — persists a manually-entered token across page reloads; used when running outside Docker without the env var set
3. Manual form — fallback when neither source provides a token

### Security Trade-off (Known Limitation)

VP-6.3.2 originally stored the token only in React component state as a security measure. VP-6.10 supersedes that by injecting the token into the client bundle via Vite's `define`, which means the token is visible in any built JS file shipped to the browser.

**This trade-off is acceptable only for localhost / Docker deployments where the container is not publicly accessible.** For a public deployment (Railway, Fly.io, Vercel, any internet-facing host), the `VITE_ADMIN_TOKEN` approach must not be used — the build-time injection exposes the admin credential to anyone who can fetch the JS bundle. In that scenario, remove `VITE_ADMIN_TOKEN` from the Vite config and rely on the manual form only.

### Test Plan

| Test # | Suite | Purpose | Verification Focus |
|---|---|---|---|
| T6.10-01 | manual E2E | With `ADMIN_API_TOKEN` set in `backend/.env` and containers running (`docker compose up`), navigate to `/admin`. Verify the dashboard loads directly with no credential form visible. | Build-time token auto-authentication. |
| T6.10-02 | manual E2E | Stop and restart containers (`docker compose down && docker compose up`). Navigate to `/admin`. Verify the dashboard still loads directly without any token entry, confirming the rebuild does not break auto-auth. | Auto-auth survives Docker rebuild. |
| T6.10-03 | manual E2E | Click "Sign out". Verify the credential form appears for the current session. Refresh the page and verify the dashboard auto-authenticates again (build-time token takes priority over the cleared session state). | Sign-out / refresh cycle with build-time token. |
| T6.10-04 | manual E2E | Remove `ADMIN_API_TOKEN` from `backend/.env`, restart containers, and navigate to `/admin`. Verify the credential form is shown (auto-auth disabled when env var is absent). Re-add the token, restart containers, and verify auto-auth resumes. | Token presence/absence toggle. |

---

## ⚠️ Known Defects (found during Phase 6 code review, 2026-06-10)

Defects patched on 2026-06-11 are marked ✅. Remaining items are tracked in [docs/Todo.md](/docs/Todo.md).

| Defect ID | Affected File | Description | Status | Backlog Ref |
|---|---|---|---|---|
| D-6.1 | `backend/src/server.ts` | `metricsAdapter` omits `incrementParticipantsJoined` — `participantsJoinedTotal` is always 0 in production despite being wired in the test harness. | ✅ Fixed 2026-06-11 | BL-METRICS-WIRE-01 |
| ~~D-6.2~~ | `backend/src/admin/scheduler.ts` | Claimed per-interval peaks were broken — code review confirmed the implementation in `scheduler.ts` and `metrics.ts` is already correct. No fix required. | ✅ Closed — not a defect | BL-METRICS-PEAK-01 |
| D-6.3 | `backend/src/signaling/registerSocketHandlers.ts` | `handleGuestGraceExpired` can destroy a room (when the last participant's grace window expires) without recording any metrics — no `incrementRoomDestroyed` or `updateRoomLifetimeRolling` call. | ✅ Fixed 2026-06-11 | BL-METRICS-GRACE-01 |
| D-6.4 | `backend/src/admin/emailDelivery.ts` | Error log on line 85 names the missing env var as `GMAIL_APP_PWD`; the actual env var the code reads (line 82) is `GMAIL_APP_PASSWORD`. Operator who follows the error message sets the wrong variable; email delivery never recovers. | ✅ Closed 2026-06-11 — already fixed in code (verified in R2-11; no `GMAIL_APP_PWD` string remains) | BL-EMAIL-ENVVAR-01 |
| D-6.5 | `backend/src/admin/analytics.ts` | `appendFileSync` inside `writeSnapshot` blocks the Node.js event loop on every 30-minute flush, queuing WebSocket messages during disk I/O. | ✅ Fixed 2026-06-11 | BL-ANALYTICS-SYNC-01 |
| D-6.6 | `backend/src/server.ts` | `legacyMetrics` (`createMetricsRegistry`) accumulates Maps on every socket lifecycle event; its `snapshot()` method is never called anywhere. Purely dead write-only RAM. | Deferred — backlog | BL-LEGACY-METRICS-01 |
| D-6.7 | `backend/src/admin/analytics.ts` | `queryRows` reads and parses the full CSV file on every call regardless of the requested time range. Degrades proportionally with file age. | Deferred — backlog | BL-ANALYTICS-QUERY-01 |
| D-6.8 | `backend/src/admin/routes.ts` | The manual `POST /report/monthly` trigger anchors its month calculation to the current wall-clock time; the scheduler anchors to the crossed-midnight date. Structural divergence — identical arithmetic, different reference dates. | Deferred — backlog | BL-REPORT-MONTH-01 |
