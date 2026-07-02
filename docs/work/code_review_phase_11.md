# Code Review — Phase 11

Date: 2026-06-30 (re-review)

**Re-review note (2026-06-30):** Each prior finding (CR11-1…CR11-7) was re-verified against the current source — all remain **Fixed/Closed** (see per-item *Re-verified* lines). The second pass surfaced **two new findings**: a High-severity active backend test that Phase 11 broke and that was missed in the first pass (CR11-8), and a Low-severity dead-state / validation-ordering note that corrects an inaccurate claim in the original Summary (CR11-9).

**Test-focused pass (2026-06-30):** A dedicated review of the **test suite only** — verifying that every active test asserts the current spec (system-design source-of-truth set + `shared/*`) — surfaced **two new High-severity findings**, both active tests that will fail when the suite runs. **CR11-10**: `T3.2-09` lost its actual NUL test input when `socket.integration.test.ts` was re-saved for OOS-2, leaving a *valid* nickname asserted to be rejected. **CR11-11**: `T11.4-02` asserts the room is destroyed by the guest-grace timer, but CR11-3 removed that destroy path — per the current spec the 15-min `solo_timeout_expired` timer (not the 30-min guest-grace timer) owns empty-room destruction. Both are **Open**. The OOS-2 resolution is corrected below (the re-save also introduced these two regressions plus a leading UTF-8 BOM).

**Third pass — empty-room-join & resume semantics (2026-06-30):** With all prior findings re-verified as Fixed/Closed and the full test suite reported green (incl. E2E), a deeper trace of the `join_room` / `resume_session` / grace-eviction interaction surfaced **two new spec/code conflicts** that the earlier passes did not reach. Both stem from the OOS-3 change (removal of the `liveCount === 0` join guard) newly exposing code paths that predate — and now contradict — the current lifecycle spec. **CR11-12** (Medium): a guest `resume_session` as the sole live participant does **not** restart the solo/empty-room timer and omits `soloDeadlineAt`, violating lifecycle.md §1 Rule 8 & §3, and disagreeing with the sibling `join_room` path OOS-3 just made spec-compliant. **CR11-13** (Medium, security/lifecycle): the join nickname-collision branch **evicts** a grace-held nickname holder instead of rejecting the joiner (lifecycle.md §1 Rule 6), and OOS-3 makes this reachable against a disconnected **host** sentinel — permanently locking the host out of their own room. **CR11-12 is now Fixed** (code aligned to the existing spec; regression test `T11.1-05` added). **CR11-13 is now Fixed** (2026-07-01, user decision): the collision-eviction branch was removed so `join_room` rejects a grace-held nickname collision per Rule 6 instead of evicting the holder, closing the host-lockout; regression test `T11.4-04` added.

**Fourth pass — 8-angle high-effort re-review (2026-07-01):** A fresh 8-angle finder sweep (line-by-line, removed-behavior, cross-file, reuse/simplify/efficiency, altitude, conventions, test-suite, concurrency/lifecycle) over the current working tree. Cross-file tracing, the CLAUDE.md-conventions angle, and the test-suite angle each came back **clean** — no broken call sites, no convention violations, and no active test that will fail (Finder G independently re-verified the T3.2-09 `\u0000` restore, the guest-grace/empty-room/collision rewrites, and all rename/threshold assertions). Several tempting lifecycle "bugs" were **refuted against lifecycle.md**: a 15-min solo/empty-room timer firing during a host's 60-min grace, and `host_grace_expired` destroying a room that still has a live joiner, are both **spec-mandated** — Rule 5, Rule 10, and §3 state the timers run in parallel and *"the earliest active deadline wins,"* and §4 defines `host_grace_expired` for `liveCount ≥ 1`. The pass surfaced **one genuine spec conflict** (**CR11-14** — the `leave_room` empty-room path, the last untouched sibling of the CR11-3/CR11-12/CR11-13 family, still hard-destroys with the wrong reason instead of entering empty-room behavior) plus five cleanup/altitude/observability items (**CR11-15…CR11-19**). All are **Open**.

---

## Summary

The core implementation is largely sound and several risky areas verify as **correct**:

- **Kick order is right.** `participant_kicked` is emitted while the target is still in the room ([registerSocketHandlers.ts:782](../../backend/src/signaling/registerSocketHandlers.ts#L782)), then state cleanup, then `targetSocket.leave()/disconnect(true)` ([:800–809](../../backend/src/signaling/registerSocketHandlers.ts#L800-L809)), then `peer_left` to the room ([:814–820](../../backend/src/signaling/registerSocketHandlers.ts#L814-L820)). The kicked socket therefore receives only `participant_kicked`, never a `peer_left` about itself — matching lifecycle.md §6 and the pass criteria. State cleanup runs before `disconnect(true)`, so the disconnect handler no-ops (no duplicate `peer_left`).
- **The solo-timer rename, shared-constant switch, and nickname-feature removal are exhaustive in `src/` and the backend test suite.** Backend `security.policy.test.ts` correctly retired the obsolete rate-limit assertions (commented `SPEC-INVALID`) and the new kick / guest-grace integration tests are well constructed.
- **`CREATE_RATE_LIMIT_MAX` unit coverage is correct.** `T11.8-02` ([security.policy.test.ts:478](../../backend/tests/security.policy.test.ts#L478)) pre-seeds `ipAbuseByIp` directly and leaves the burst map empty, so it cleanly isolates the 30-threshold IP layer from the burst layer — both parts pass.

The first pass surfaced one breaking frontend test (CR11-1), three spec/correctness issues (CR11-2…CR11-4), and several lower-severity cleanups; all are resolved. **The second pass adds CR11-8 (High — a stale active backend test, the backend twin of CR11-1) and CR11-9 (Low).** The original Summary claim that `lastSeenAt` "is only stamped after all validation passes" is **inaccurate** and is corrected by CR11-9.

**The third pass adds CR11-12 and CR11-13 — two spec/code conflicts, both consequences of OOS-3, both now Fixed.** OOS-3 removed the `liveCount === 0` join guard and correctly made the `join_room` empty-room path spec-compliant, but two adjacent code paths that predate the change contradicted the current lifecycle spec: `resume_session` restarted the solo timer for the host only (CR11-12 — **fixed**: the resume path is participant-agnostic and mirrors the join path), and the join nickname-collision branch evicted grace-held holders — reachable against a disconnected host (CR11-13 — **fixed**: the eviction branch is removed; the colliding join is rejected per Rule 6 and the holder reclaims on resume). The remaining risky areas re-verify as correct: the kick order/reason, the guest-grace sentinel-only cleanup, the rate-limit subject→IP rekey (behaviour-preserving; the effective create ceiling stays the burst limit of 5/min/IP), and `lastSeenAt` refresh on signal relay all hold up. No new *test* defects were found in this pass; the suite is reported green including E2E.

**The fourth pass (8-angle deep review, 2026-07-01) adds CR11-14 through CR11-19.** Cross-file tracing, CLAUDE.md-conventions, and the test-suite audit all came back clean. Several lifecycle candidates were **refuted against lifecycle.md**: a 15-min solo timer firing during a host's 60-min grace, and `host_grace_expired` destroying a room with a live joiner, are both spec-mandated (Rules 5/10, §3 "earliest active deadline wins"). The surviving new findings:

- **CR11-14 (Medium, Phase 11 scope — Open):** `leave_room` hard-destroys an emptied room with reason `host_grace_expired` instead of entering the 15-min empty-room behavior mandated by lifecycle.md Rule 4 / §3. This is the last untouched sibling of the OOS-3 / CR11-3 / CR11-12 / CR11-13 empty-room family. Pre-existing code, but OOS-3 makes it a live spec conflict: the host's reconnect grace is denied, the empty-room join window never opens, and the destroy reason is wrong (no grace timer fired; correct reason is `solo_timeout_expired` after 15 min). **Requires user decision per System Sync.**
- **CR11-15 (Low-Medium, Out of Scope — Open):** Solo-timer restart/cancel logic is forked across three call sites (`restartSoloTimerIfSolo` for disconnect/kick; inline copies in `join_room` and `resume_session`) with divergent semantics — the helper only restarts, the inline copies also cancel. Safe today only because disconnect/kick can only decrease `liveCount`; the next count-increasing path routed through the helper will silently leave a stale timer armed. Altitude debt.
- **CR11-16 (Low, Phase 11 scope — Open):** The new `onError` defensive block (added this phase) resets to lobby and wipes the reconnect session/chat for *any* error while `screen === 'reconnecting'` when `autoResumeRequestedRef` is false — it cannot distinguish fatal from transient errors and patches a StrictMode ref-timing symptom rather than making resume state authoritative.
- **CR11-17 (Low, Phase 11 scope — Open):** `getRateLimitWindowActiveCount` in `server.ts` was narrowed by VP-11.2 to report only `createAttemptsByIp.size`; join-side rate-limit pressure (now in `ipAbuseByIp`) is no longer reflected in the metric, hiding join-flood activity from the observability surface.
- **CR11-18 (Low, Out of Scope — Open):** Three related rate-limit observations surfaced by VP-11.2/VP-11.8: `CREATE_RATE_LIMIT_MAX` (30) is unreachable because the burst gate (5) always fires first; `CREATE_RATE_LIMIT_WINDOW_MS` and `JOIN_RATE_LIMIT_WINDOW_MS` are identical aliases applied to the same shared map (desync risk if tuned independently); IP-only keying collapses all users behind a NAT into one bucket (intended VP-11.2 direction, but a deployment note for proxy environments).
- **CR11-19 (Low, Out of Scope — Open):** `resolveSignalRoute` does a redundant second `Map.get` + non-null assertion (`!`) to stamp `lastSeenAt`; membership was already proven 11 lines earlier. Hot path (every offer/answer/ICE relay).

---

## Findings

### [CR11-1] BUG (test) — `frontend/tests/contract.integration.test.mjs` was not updated and now has 6 failing assertions

**File:** [frontend/tests/contract.integration.test.mjs](../../frontend/tests/contract.integration.test.mjs) lines 284, 290, 310, 312, 332, 333
**Severity:** High — the `npm run test:contract` suite (`node --test tests/contract.integration.test.mjs`) fails as soon as it runs.

This file is **not** in the Phase 11 modified set, yet it asserts (via `expectContains`) on symbols this phase removed or renamed. Each of these is now a guaranteed assertion failure:

| Line | Assertion target | Phase 11 change | Result |
|---|---|---|---|
| 284 | `socket.onNicknameUpdated(onNicknameUpdated)` in `useVaporRoom.ts` | removed (VP-11.5) | FAIL |
| 290 | `socket.on(SERVER_EVENTS.NICKNAME_UPDATED, handler)` in `room-socket-client.ts` | removed (VP-11.5) | FAIL |
| 310 | `SOLO_HOST_ROOM_TIMEOUT_MS` in handlers | renamed → `SOLO_ROOM_TIMEOUT_MS` (VP-11.1) | FAIL |
| 312 | `SOLO_HOST_ROOM_TIMEOUT_MS` in shared policy | renamed (VP-11.1) | FAIL |
| 332 | `temporaryBlocklistBySubject` in `rateLimiting.ts` | renamed → `temporaryBlocklistByIp` (VP-11.2) | FAIL |
| 333 | `createAttemptsBySubject` in `rateLimiting.ts` | renamed → `createAttemptsByIp` (VP-11.2) | FAIL |

The phase matrix grep evidence ("`SOLO_HOST_ROOM_TIMEOUT_MS` … 0 matches", "nickname symbols … 0 matches" — T11.1-01, T11.5-01) was evidently run against `backend/` and `src/` only; this frontend `.mjs` test was missed.

**Recommendation:** Update the three affected tests:
- **T3.2-05** (lines 284, 290): delete the two nickname-update assertions outright — they assert behavior the spec removed (nicknames are immutable; core-architecture.md §4.1). Keep the surrounding reconnect-identity checks.
- **T3.3-04** (lines 310, 312, 332, 333): rename to `SOLO_ROOM_TIMEOUT_MS`, `temporaryBlocklistByIp`, `createAttemptsByIp`.

**Status:** Fixed. *Re-verified 2026-06-30:* [contract.integration.test.mjs:284](../../frontend/tests/contract.integration.test.mjs#L284) now asserts `participantNicknames: {}` (nickname-update assertions removed); [:304–306](../../frontend/tests/contract.integration.test.mjs#L304-L306) and [:326–327](../../frontend/tests/contract.integration.test.mjs#L326-L327) use `SOLO_ROOM_TIMEOUT_MS` / `temporaryBlocklistByIp` / `createAttemptsByIp`. No stale symbol remains.

---

### [CR11-2] SPEC CONFLICT — `ParticipantRecord.lastSeenAt` was dropped from the spec state model but retained in code

**Files:** [backend/src/signaling/state.ts:5](../../backend/src/signaling/state.ts#L5); spec [core-architecture.md §3](../../docs/system_design/core-architecture.md) (lines 73–79); writers at [roomLifecycle.ts:32](../../backend/src/signaling/roomLifecycle.ts#L32),[:67](../../backend/src/signaling/roomLifecycle.ts#L67) and [signalRelay.ts:96](../../backend/src/signaling/handlers/signalRelay.ts#L96)
**Severity:** Medium — spec/code divergence.

`lastSeenAt` was accidentally omitted from the `core-architecture.md` §3 `ParticipantRecord` definition when the heartbeat mechanism was removed, but it is intentionally retained in code as a useful activity timestamp (updated on every successful signal relay). The omission was a spec editing error, not a code bug.

**Resolution:** Added `lastSeenAt: number` back to `ParticipantRecord` in `core-architecture.md` §3 with a note that it is updated on every successful `signal_offer`/`signal_answer`/`signal_ice` relay. Spec and code now agree.

**Status:** Fixed. *Re-verified 2026-06-30:* [core-architecture.md:78](../../docs/system_design/core-architecture.md#L78) declares `lastSeenAt: number` with the relay-refresh note; [state.ts:5](../../backend/src/signaling/state.ts#L5) retains the field. (But see CR11-9 — the field has no production reader and the relay write precedes payload validation.)

---

### [CR11-3] CORRECTNESS — VP-11.4 changed the empty-room destroy condition in `handleGuestGraceExpired`, not a `peer_left` count; the resulting destroy path is mislabeled and bypasses `destroyRoom`

**File:** [backend/src/signaling/registerSocketHandlers.ts:305–314](../../backend/src/signaling/registerSocketHandlers.ts#L305-L314)
**Severity:** Medium — metric mislabeling + divergence from lifecycle.md §4 atomic-destruction contract; doc/impl mismatch.

VP-11.4 (phase-11.md) is specified as: "`handleGuestGraceExpired` must emit `getLiveParticipantCount(activeRoom)` (not `.size`) in `peer_left`." But this function **emits no `peer_left`** — that emission was removed in Phase 10 (CR10-4); see the explanatory comment at [:316–319](../../backend/src/signaling/registerSocketHandlers.ts#L316-L319). The VP description is based on pre-CR10-4 code.

What the diff actually changed is the **empty-room destroy zero-check**: `participants.size === 0` → `getLiveParticipantCount(activeRoom) === 0`. That is a different condition with two consequences:

- **Behavior shift:** the old check destroyed only when the Map was truly empty; the new check destroys when *no live participants* remain even if grace-held sentinels (e.g. a host still inside their 60-min reconnect window) are still in the Map. T11.4-02 explicitly enshrines this ("guest grace expiry with only host sentinel remaining — room silently destroyed").
- **Wrong reason + non-canonical destroy:** when this branch fires it increments the metric `incrementRoomDestroyed("host_grace_expired")` ([:308](../../backend/src/signaling/registerSocketHandlers.ts#L308)) for a guest-grace / empty-room destruction, and it performs a manual `clearRoomArtifacts` + `state.rooms.delete` **instead of `destroyRoom`**, so it emits no `room_destroyed` and skips the canonical atomic path (lifecycle.md §4 "exactly one reason … emitted").

In normal operation the 15-min empty-room timer fires first (15 min < 30-min guest grace), so `room_destroyed` delivery to clients is unaffected (liveCount is 0 — nobody live is denied the event). The real, reachable defects are the **mislabeled metric** and the **doc/impl mismatch**.

**Resolution:** Removed the `liveCount === 0` destroy branch from `handleGuestGraceExpired` entirely. The solo timer already owns empty-room destruction (it is armed when `liveCount` hits 1 and continues running when it drops to 0). Guest grace expiry is now purely sentinel cleanup; `destroyRoom` is never called from this path.

**Status:** Fixed. *Re-verified 2026-06-30:* [registerSocketHandlers.ts:281–308](../../backend/src/signaling/registerSocketHandlers.ts#L281-L308) — `handleGuestGraceExpired` now only deletes the participant + nickname mapping and clears the reconnect record; no count, no zero-check, no `destroyRoom`/`incrementRoomDestroyed`. The explanatory comment at [:305–307](../../backend/src/signaling/registerSocketHandlers.ts#L305-L307) documents that the solo timer owns empty-room destruction.

---

### [CR11-4] SCOPE / SECURITY — The per-room invalid-password cooldown/lockout system was removed, but no VP item covers it

**File:** [backend/src/signaling/handlers/rateLimiting.ts](../../backend/src/signaling/handlers/rateLimiting.ts) (functions deleted); join handler at [registerSocketHandlers.ts:479–484](../../backend/src/signaling/registerSocketHandlers.ts#L479-L484)
**Severity:** Medium — undocumented behavior/security change.

The diff deletes the entire escalating wrong-password defense: `recordInvalidPasswordAttempt`, `getJoinAttemptStatus`, `clearSuccessfulJoinAttempt`, `purgeJoinAttemptsForRoom`, `makeJoinAttemptKey`, `deriveJoinAttemptSubject`, the `JoinAttemptRecord` type, and the `joinAttemptByRoomSubject` map. The join handler now returns `INVALID_PASSWORD` directly with no escalation; repeated wrong passwords are bounded only by the 30-per-minute IP join window (`checkAndRecordJoinIp`).

This **aligns with** the updated spec (core-architecture.md §2: "`JOIN_RATE_LIMIT_*` applies to repeated `join_room` attempts, including wrong-password retries"), so it is spec-consistent — but **none of VP-11.1…11.8 mentions it**. It is a real behavior change (brute-force resistance goes from "5 attempts → lockout" to "30/min/IP indefinitely") riding in on a phase scoped as "constant import + threshold bump." It needs its own VP entry with invariants, and the security posture change should be explicitly acknowledged.

**Resolution:** Removal is intentional. Password brute-force resistance via per-room lockout adds complexity with negligible value given the 2-hour room lifetime, no financial attack surface, and browser-based client (attacker can trivially rotate browser tabs/sessions to bypass IP-scoped limits anyway). The 30/min IP rate limit from `checkAndRecordJoinIp` is sufficient. No code change required.

**Status:** Closed — intent confirmed, no action needed. *Re-verified 2026-06-30:* [rateLimiting.ts](../../backend/src/signaling/handlers/rateLimiting.ts) exposes only `checkAndRecordCreateAttempt`, `checkAndRecordJoinIp`, `deriveIp`, `sweepRateLimitRecords` — every `JoinAttempt*` / `joinAttemptByRoomSubject` symbol is gone; the join handler enforces only the IP window via `checkAndRecordJoinIp` ([registerSocketHandlers.ts:431](../../backend/src/signaling/registerSocketHandlers.ts#L431)).

---

### [CR11-5] CLEANUP — Orphaned cooldown constants and a now-inaccurate frontend cooldown after CR11-4

**Files:** [shared/policy.ts:9–10](../../shared/policy.ts#L9-L10); [backend/src/signaling/contracts.ts:53–55](../../backend/src/signaling/contracts.ts#L53-L55); [frontend/src/features/room/constants.ts:4](../../frontend/src/features/room/constants.ts#L4); spec [signaling-contract.md §2](../../docs/system_design/signaling-contract.md)
**Severity:** Low-Medium.

With the cooldown system gone (CR11-4):
- `JOIN_INVALID_ATTEMPT_NO_COOLDOWN_MAX` and `JOIN_INVALID_ATTEMPT_COOLDOWN_MAX` are no longer referenced by any logic — only defined in `policy.ts` and re-exported in `contracts.ts`. They are dead. (`JOIN_INVALID_ATTEMPT_COOLDOWN_MS` is still used by the frontend, so keep it.)
- `signaling-contract.md` §2's exports table still lists all three as the `shared/policy.ts` contract — stale once the two above are removed.
- Frontend `JOIN_RATE_LIMIT_COOLDOWN_MS = JOIN_INVALID_ATTEMPT_COOLDOWN_MS` (10 min) and the copy "Too many attempts for this room. Try again later." ([constants.ts:53](../../frontend/src/features/room/constants.ts#L53)) describe the removed per-room 10-min cooldown. The server now only emits `RATE_LIMITED` from a 60-second IP window, so the displayed "try again later" timing no longer matches server behavior.

**Resolution:** Removed all three dead constants (`JOIN_INVALID_ATTEMPT_COOLDOWN_MS`, `JOIN_INVALID_ATTEMPT_NO_COOLDOWN_MAX`, `JOIN_INVALID_ATTEMPT_COOLDOWN_MAX`) from `policy.ts` and `contracts.ts`. Frontend `JOIN_RATE_LIMIT_COOLDOWN_MS` now sources from `JOIN_RATE_LIMIT_WINDOW_MS` (60 s). UI copy updated to "Too many join attempts. Try again in a minute." Spec exports table updated. Stale test assertions updated.

**Status:** Fixed. *Re-verified 2026-06-30:* [policy.ts](../../shared/policy.ts) ends at the 5 spec constants — no `JOIN_INVALID_ATTEMPT_*` remains; [constants.ts:4](../../frontend/src/features/room/constants.ts#L4) sets `JOIN_RATE_LIMIT_COOLDOWN_MS = JOIN_RATE_LIMIT_WINDOW_MS`; [constants.ts:53](../../frontend/src/features/room/constants.ts#L53) reads "Too many join attempts. Try again in a minute."

---

### [CR11-6] DOCS — Planning documents contradict each other and the implementation

**Files:** [docs/Todo.md](../../docs/Todo.md), [docs/work/phase-11.md](../../docs/work/phase-11.md)
**Severity:** Low — traceability/maintainability.

Three internal contradictions:
1. **VP numbering is offset.** Todo.md numbers the phase 11.1–11.7 (no 11.8); phase-11.md numbers it 11.1, 11.2, 11.4–11.8 (no 11.3). Todo VP-11.3/11.4/11.5/11.6/11.7 map to phase VP-11.4/11.5/11.6/11.7/11.8. Cross-references (and the VP IDs the execution rules require to "stay stable and traceable") are broken.
2. **`lastSeenAt`: remove vs retain.** Todo.md VP-11.6 says delete `lastSeenAt` and its inits; phase-11.md VP-11.7 says retain it. The code retains (correct per CR11-2 resolution) — Todo.md should be updated to reflect the retain decision.
3. **Self-contradictory kick order inside phase-11.md.** Constraints-&-Decisions row #9 lists the kick order with `participant_kicked` at step 5 (after disconnect), while subtask 11.6.2 lists it at step 1 (before). The code correctly follows 11.6.2, so there is no code bug — but the C&D table is misleading and should be reconciled.

**Resolution:** Renumbered Todo.md VP items to match phase-11.md (11.3→11.4, 11.4→11.5, 11.5→11.6, 11.6→11.7, 11.7→11.8 — gap preserved, single scheme). Updated Todo.md VP-11.6 kick expected-outcome to match the actual order (emit `participant_kicked` first, then cleanup/disconnect, then `peer_left`). Updated Todo.md VP-11.7 to RETAIN `lastSeenAt` (refreshed via signal relay). Fixed C&D row #9 in phase-11.md to match subtask 11.6.2 (participant_kicked at step 1, not step 5).

**Status:** Fixed. *Re-verified 2026-06-30:* Todo.md VP-11.7 ([docs/Todo.md:59](../../docs/Todo.md#L59)) now states RETAIN `lastSeenAt`; phase-11.md C&D row #9 and subtask 11.6.2 agree on `participant_kicked`-first ordering.

---

### [CR11-7] CLEANUP (test) — Dead imports and a source-grep unit test

**Files:** [backend/tests/socket.integration.test.ts:10](../../backend/tests/socket.integration.test.ts#L10); [frontend/tests/peerLeft.unit.test.mjs](../../frontend/tests/peerLeft.unit.test.mjs)
**Severity:** Low.

- After the old cooldown tests were commented out as `SPEC-INVALID`, the line-10 import still pulls `JOIN_INVALID_ATTEMPT_COOLDOWN_MS` and `JOIN_INVALID_ATTEMPT_NO_COOLDOWN_MAX` (and `GUEST_DISCONNECT_GRACE_MS` appears unused) with no remaining live usage. Not a build break — backend `tsconfig.json` does not set `noUnusedLocals` — but they are dead imports; trim them.
- `peerLeft.unit.test.mjs` (new, T11.6-05/06) asserts on the **source text** of `useVaporRoom.ts` (substring match of the ternary) rather than observable behavior, so it breaks on any behavior-preserving refactor. It matches the existing `contract.integration.test.mjs` convention, so this is a note, not a blocker.

**Resolution:** Commented out T3.3-07 and T3.3-08 as SPEC-INVALID — both tests exercised the removed per-room cooldown escalation (`purgeJoinAttemptsForRoom`, `JOIN_INVALID_ATTEMPT_NO_COOLDOWN_MAX`, `JOIN_INVALID_ATTEMPT_COOLDOWN_MS`) and referenced undefined constants. `peerLeft.unit.test.mjs` source-grep style is noted but not changed.

**Status:** Fixed. *Re-verified 2026-06-30:* T3.3-07/08 ([socket.integration.test.ts:2314](../../backend/tests/socket.integration.test.ts#L2314), [:2734](../../backend/tests/socket.integration.test.ts#L2734)) and the T2.4-* cooldown tests ([:444](../../backend/tests/socket.integration.test.ts#L444), [:480](../../backend/tests/socket.integration.test.ts#L480); [security.policy.test.ts:214](../../backend/tests/security.policy.test.ts#L214), [:227](../../backend/tests/security.policy.test.ts#L227)) are all inside `/* … */` SPEC-INVALID blocks — none execute.

---

### [CR11-8] BUG (test) — `T3.3-06` in `socket.integration.test.ts` is an active test that Phase 11 broke; it still asserts the pre-Phase-11 create-rate-limit behavior

**File:** [backend/tests/socket.integration.test.ts:2274–2310](../../backend/tests/socket.integration.test.ts#L2274-L2310)
**Severity:** High — this test is **not** commented out; `npm run test` will fail when it runs. It is the backend twin of CR11-1 (the frontend miss), and was overlooked in the first pass — the Test Suite Review table marked this file "Updated, OK."

`T3.3-06` hard-codes the old model: a local `const IP_CREATE_THRESHOLD = 10` ([:2277](../../backend/tests/socket.integration.test.ts#L2277)), 10 `create_room` calls from the **same IP** (`192.0.2.1`) with **distinct fingerprints** asserted to all succeed ([:2286–2295](../../backend/tests/socket.integration.test.ts#L2286-L2295)), then the 11th asserted to be `RATE_LIMITED` ([:2297–2306](../../backend/tests/socket.integration.test.ts#L2297-L2306)), then `roomCount === 10` ([:2309](../../backend/tests/socket.integration.test.ts#L2309)). Two independent Phase-11 changes invalidate it:

1. **Burst layer was re-keyed from subject→IP (VP-11.2).** Pre-Phase-11, `checkAndRecordCreateAttempt` took a `subject` (fingerprint-derived) and keyed the burst map (`createAttemptsBySubject`, threshold 5) by it — so the test's distinct fingerprints deliberately dodged the burst limit. The rewritten signature is `checkAndRecordCreateAttempt(ctx, ip, nowTs)` ([rateLimiting.ts:32](../../backend/src/signaling/handlers/rateLimiting.ts#L32)); the burst map (`createAttemptsByIp`) is now keyed by **IP** ([:48–59](../../backend/src/signaling/handlers/rateLimiting.ts#L48-L59)) and the handler passes only `deriveIp(socket)` ([registerSocketHandlers.ts:341,344](../../backend/src/signaling/registerSocketHandlers.ts#L341-L344)) — fingerprints are no longer consulted. So all 10 same-IP creates share one burst counter and the **6th** create trips `CREATE_ROOM_BURST_THRESHOLD = 5`, returning `RATE_LIMITED`. The first loop fails at attempt 6 (asserts success).
2. **IP threshold raised 10→30 (VP-11.8).** Even setting the burst layer aside, the IP-abuse layer now blocks at `CREATE_RATE_LIMIT_MAX = 30`, so the 11th create would no longer be rate-limited — the `assert.ok(blockedError, "11th create … must be blocked")` assertion is wrong under the new threshold.

The companion unit test `T11.8-02` ([security.policy.test.ts:478](../../backend/tests/security.policy.test.ts#L478)) covers the new 30-threshold correctly by pre-seeding `ipAbuseByIp` and leaving the burst map empty, so it does **not** mask this failure — `T3.3-06` is genuinely orphaned.

**Recommendation:** Rework `T3.3-06` to the post-Phase-11 model — either delete it as superseded by `T11.8-02`, or rewrite it to exercise the burst layer (assert the 6th same-IP create within the window is blocked at `CREATE_ROOM_BURST_THRESHOLD`) and drop the obsolete `IP_CREATE_THRESHOLD = 10` / 11th-attempt assertions.

**Resolution:** Removed `T3.3-06`. Once both rate-limit layers key on IP (VP-11.2) and share the 60 s window, the burst threshold (5) is always reached before the IP ceiling (30) for same-IP creates, so there is no integration-reachable "IP create threshold only" scenario left to assert — the test is genuinely superseded, not merely stale. The two surviving paths give full coverage: the burst block end-to-end via `T3.3-03` ([socket.integration.test.ts:1794](../../backend/tests/socket.integration.test.ts#L1794)) and the 30-create IP ceiling at the unit level via `T11.8-02` ([security.policy.test.ts:478](../../backend/tests/security.policy.test.ts#L478)). The active test body was replaced with a `REMOVED — superseded` note documenting the reasoning ([socket.integration.test.ts:2272](../../backend/tests/socket.integration.test.ts#L2272)).

**Status:** Fixed.

---

### [CR11-9] CLEANUP / DOC ACCURACY — `lastSeenAt` is write-only in production and is stamped before payload validation, contradicting the VP-11.7 pass criteria

**Files:** [backend/src/signaling/handlers/signalRelay.ts:96](../../backend/src/signaling/handlers/signalRelay.ts#L96); [state.ts:5](../../backend/src/signaling/state.ts#L5); [roomLifecycle.ts:32,67](../../backend/src/signaling/roomLifecycle.ts#L32)
**Severity:** Low — no functional impact, but a doc/criteria mismatch plus a stale claim in the original review.

Two related observations from the second pass:

1. **The write precedes payload validation.** `resolveSignalRoute` stamps `lastSeenAt = now()` ([:96](../../backend/src/signaling/handlers/signalRelay.ts#L96)) as soon as the **route** resolves — but the SDP/candidate normalization (`normalizeSignalSdp` / `normalizeSignalCandidate`) runs **after** that, in the per-handler bodies ([:116–120](../../backend/src/signaling/handlers/signalRelay.ts#L116-L120), [:170–174](../../backend/src/signaling/handlers/signalRelay.ts#L170-L174)). So a signal with a valid route but an **invalid payload** still bumps `lastSeenAt` before `emitInvalidPayload()` fires. This contradicts phase-11.md VP-11.7 subtask 11.7.2 ("no update on a route that fails validation (… **invalid payload**)") and directly contradicts the original Summary bullet ("`lastSeenAt` is only stamped after all validation passes"). That Summary claim is **inaccurate** and is corrected here.
2. **No production reader.** After the heartbeat / `PARTICIPANT_STALE_MS` removal (VP-11.7), nothing in `src/` ever reads `lastSeenAt` — it is written at create/join and on every relay, and read only by the test `T11.7-04`. The CR11-2 resolution justified retaining it as a "useful activity timestamp," but it is currently dead state with no consumer.

**Recommendation:** Either (a) drop `lastSeenAt` entirely (no reader, no spec consumer), or (b) if it is intentionally kept for future use / observability, move the stamp to **after** payload normalization so it reflects only fully-valid relays per the stated criteria. Either way, correct or remove the inaccurate "after all validation passes" wording. Low priority — no observable runtime effect today.

**Resolution:** `lastSeenAt` is intentionally **kept** (user decision, 2026-06-30) — participant activity / "last seen" is useful information to surface to users, and keeping the write path live now means the data is accurate whenever the consuming feature is built. The feature work (how to surface it, the wire mechanism, and the stamp-before-validation ordering question from observation #1) is captured as backlog item **BL-FEAT-LASTSEEN-01** ([docs/Backlog.md](../../docs/Backlog.md) → Product Features), to be detailed by the user. The inaccurate "stamped after all validation passes" claim in the original Summary is corrected by this finding (the Summary bullet has been removed in the re-review header).

**Status:** Closed — `lastSeenAt` retained by decision; follow-up feature tracked as BL-FEAT-LASTSEEN-01. The validation-ordering nuance is folded into that backlog item.

---

### [CR11-10] BUG (test) — `T3.2-09` lost its NUL test input in the OOS-2 re-save; it now asserts a **valid** nickname is rejected and will fail

**File:** [backend/tests/socket.integration.test.ts:2245](../../backend/tests/socket.integration.test.ts#L2245) (case row), assertion at [:2254–2255](../../backend/tests/socket.integration.test.ts#L2254-L2255)
**Severity:** High — this is an active test; `npm run test` fails when it runs.

`T3.2-09` ("nicknames with disallowed characters are rejected with INVALID_SIGNAL_PAYLOAD") iterates a table of disallowed nicknames and asserts each join is rejected:

```ts
{ nickname: "NameX", label: "null control character (\\u0000)" },
...
const errorPayload = popSocketError(socket);
assert.ok(errorPayload, `Nickname with ${label} must be rejected`);
```

The case is labelled "null control character (\u0000)" and was originally `"Name\u0000X"` — the literal carried an embedded NUL byte (the same byte flagged in OOS-2 at offset 95340). The OOS-2 "re-saved as clean UTF-8, NUL removed" fix **stripped the NUL from the test input itself**, turning it into `"NameX"` — a perfectly valid nickname (letters only, length 5, matches `[\p{L}\p{N} _-]` and `normalizeNickname`'s 3–24 bound). At runtime the join **succeeds**, `popSocketError(socket)` returns `undefined`, and `assert.ok(undefined, "Nickname with null control character (\u0000) must be rejected")` throws → the test fails. Beyond the failure, the case no longer covers control-character rejection at all (silent coverage loss).

**Recommendation:** Restore the NUL as an explicit, save-safe escape that cannot be stripped by a re-save: `{ nickname: "Name\u0000X", label: "null control character (\\u0000)" }`. (Using the `\u0000` escape sequence in source keeps the literal a real NUL at runtime while staying plain-ASCII on disk.) Re-confirm the other five disallowed cases still assert rejection.

**Status:** Fixed. Literal NUL byte in T3.2-09 replaced with the TypeScript `\u0000` escape sequence in source. Source is now plain ASCII; runtime behavior is unchanged. [socket.integration.test.ts:2405]

---

### [CR11-11] BUG (test) — `T11.4-02` asserts the **guest-grace timer** destroys the room, but CR11-3 removed that path; per current spec the 15-min solo/empty-room timer owns destruction

**File:** [backend/tests/disconnect.integration.test.ts:435](../../backend/tests/disconnect.integration.test.ts#L435) ("…room silently destroyed"), assertion at [:466–471](../../backend/tests/disconnect.integration.test.ts#L466-L471)
**Severity:** High — active test; it fires the 30-min `GUEST_DISCONNECT_GRACE_MS` timer and asserts `state.rooms.has(roomId) === false`, which the current code does not do, so `npm run test` fails when it runs.

`T11.4-02` drives Host + G1, disconnects the host (host-grace sentinel), disconnects G1 (guest-grace sentinel, `liveCount === 0`), then fires **only** the guest-grace timer:

```ts
const g1GraceTimer = scheduledTimeouts.find(
  (e) => e.delay === GUEST_DISCONNECT_GRACE_MS && !e.handle.cleared,
);
g1GraceTimer.callback();           // → handleGuestGraceExpired(g1, roomId)
assert.equal(state.rooms.has(roomId), false, "room must be destroyed …");
```

The guest-grace timer's callback is `handleGuestGraceExpired` ([registerSocketHandlers.ts:906–908](../../backend/src/signaling/registerSocketHandlers.ts#L906-L908)). After CR11-3's resolution that function performs **only** sentinel cleanup — delete from `participants`, drop the nickname mapping, clear the reconnect record — and explicitly does **not** call `destroyRoom` ([registerSocketHandlers.ts:281–308](../../backend/src/signaling/registerSocketHandlers.ts#L281-L308), comment: "the solo timer owns empty-room destruction"). So firing it leaves the room alive with the host sentinel still present; the assertion at [:466](../../backend/tests/disconnect.integration.test.ts#L466) fails.

This also contradicts the **current spec**: lifecycle.md §1 Rule 5 ([lifecycle.md:25](../../docs/system_design/lifecycle.md#L25)) and §3 ([lifecycle.md:67–73](../../docs/system_design/lifecycle.md#L67-L73)) state that when `liveCount` drops to 0 the **15-min empty-room timer** destroys the room with reason `solo_timeout_expired`; the 30-min guest-grace timer never destroys (lifecycle.md §1 sequence note "Room survives if other live participants remain", [:218–220](../../docs/system_design/lifecycle.md#L218-L220)). `T11.4-02` encodes the pre-CR11-3 destroy-on-grace-expiry behavior, which is no longer in the spec or the code. (Its siblings `T11.4-01` and `T11.4-03` both keep a live host and correctly assert the room *survives*, so they pass — `T11.4-02` is the only stale one.)

**Recommendation:** Rework `T11.4-02` to the current model — either (a) fire the **solo/empty-room timer** (`e.delay === SOLO_ROOM_TIMEOUT_MS`) and assert destruction with `room_destroyed` reason `solo_timeout_expired`, or (b) assert the room **survives** the guest-grace callback (sentinel cleanup only) and is destroyed only when the 15-min timer subsequently fires. Drop the assertion that the guest-grace callback itself destroys the room.

**Status:** Fixed. T11.4-02 reworked: (1) fires the guest-grace timer and asserts the room **survives** (sentinel cleanup only, per CR11-3), then (2) fires the SOLO_ROOM_TIMEOUT_MS timer (armed when the host disconnected with `liveCount=1`) and asserts room destroyed. Title updated to "…solo timer destroys room". The stale comment claiming "no solo timer" on the G1 disconnect step is corrected. [disconnect.integration.test.ts:435]

---

### [CR11-12] SPEC CONFLICT — a guest resuming as the sole live participant does not restart the solo/empty-room timer and omits `soloDeadlineAt`

**File:** [backend/src/signaling/registerSocketHandlers.ts:645–660](../../backend/src/signaling/registerSocketHandlers.ts#L645-L660) (resume solo-timer gate + contradicting comment), [:673](../../backend/src/signaling/registerSocketHandlers.ts#L673) (`soloDeadlineAt` set to `null` for a non-host resumer); spec [lifecycle.md §1 Rule 8](../../docs/system_design/lifecycle.md) (line 37) and [§3](../../docs/system_design/lifecycle.md) (line 72)
**Severity:** Medium — spec/code divergence + internal inconsistency between `join_room` and `resume_session`; user-visible (missing countdown) and destruction-timing effect.

The `resume_session` handler only (re)starts the solo timer when the resumer is the **host**:

```ts
// "Solo-host policy is host-only. A guest resuming as the sole live participant
//  must not reset the deadline or be handed a soloDeadlineAt it doesn't own."
if (resumeLiveCount >= 2) { /* clear */ }
else if (resumeLiveCount === 1 && isHostResuming) { grace.restartSoloTimer(...) }
// else (resumeLiveCount === 1 && guest): nothing
...
soloDeadlineAt: isHostResuming ? (policy?.soloDeadlineAt ?? null) : null,
```

But the current spec makes the solo/empty-room timer **participant-agnostic**:
- §1 Rule 8 ([:37](../../docs/system_design/lifecycle.md#L37)): "*Start/restart … whenever `liveCount` becomes exactly 1 — including … when `liveCount` rises from 0 to 1 **on reconnect or join***".
- §3 ([:72](../../docs/system_design/lifecycle.md#L72)): "*If any participant returns before the timer fires (`liveCount` rises to ≥ 1 **via `resume_session` or a new `join_room`**), cancel the empty-room timer and restart the solo timer per §1 Rule 8 if `liveCount` = 1.*"

OOS-3 correctly made the **`join_room`** path participant-agnostic — a guest joining an empty room restarts the timer and receives `soloDeadlineAt` ([:496–512](../../backend/src/signaling/registerSocketHandlers.ts#L496-L512), [:530](../../backend/src/signaling/registerSocketHandlers.ts#L530)). The **`resume_session`** path was left with the pre-OOS-3 host-only gate, so the same sole guest is treated differently depending on whether they arrived via join or resume. The inline comment at [:645–646](../../backend/src/signaling/registerSocketHandlers.ts#L645-L646) now directly contradicts the spec.

**Reachable scenario:** host disconnects (sentinel, solo timer restarted → deadline = `hostDisc + 15m`), then the last guest disconnects (`liveCount → 0`, timer left untouched), then that guest `resume_session`s at `hostDisc + 5m`. `resumeLiveCount === 1`, `isHostResuming === false` → the timer is **not** restarted (room still dies at `hostDisc + 15m`, ~10 min later, instead of the fresh 15-min window the spec mandates) and the guest is handed `soloDeadlineAt: null`, so the UI shows **no countdown** before the room is destroyed with `solo_timeout_expired`.

**Recommendation (user decision per System Sync):** make the resume path match the spec and the join path — restart the solo timer whenever `resumeLiveCount === 1` regardless of host/guest, and surface the resulting `soloDeadlineAt` in `room_joined`. Remove/replace the "host-only" comment. (Root gate predates Phase 11 but is a touched region — the `SOLO_ROOM_TIMEOUT_MS` rename lives in this block — and OOS-3 turned it into an internal inconsistency.)

**Resolution:** Fixed (user decision, 2026-06-30 — align code to the existing spec; no design-doc change needed, since lifecycle.md §1 Rule 8 / §3 already mandate a participant-agnostic restart). The `resume_session` solo-timer block now mirrors the spec-compliant `join_room` empty-room path: when `resumeLiveCount === 1` (host **or** guest) it calls `grace.restartSoloTimer` and surfaces the returned deadline via `soloDeadlineAt`, which is now conditionally spread (present only when the timer restarts, omitted at `liveCount ≥ 2`) exactly like the join path ([registerSocketHandlers.ts:643–662](../../backend/src/signaling/registerSocketHandlers.ts#L643-L662), [:674](../../backend/src/signaling/registerSocketHandlers.ts#L674)). The host-only gate, the `isHostResuming` variable, and the contradicting comment are removed. Regression test **`T11.1-05`** added ([soloTimer.integration.test.ts](../../backend/tests/soloTimer.integration.test.ts), VP-11.1 test plan): a guest resuming as the sole live participant receives a numeric `soloDeadlineAt = resumeTime + SOLO_ROOM_TIMEOUT_MS` and the room is destroyed only at that fresh deadline (`solo_timeout_expired`), not the original one. Full `soloTimer.integration.test.ts` suite green (9/9).

**Status:** Fixed.

---

### [CR11-13] SPEC CONFLICT / SECURITY — join nickname-collision evicts a grace-held holder instead of rejecting the joiner; OOS-3 makes this reachable against a disconnected host, locking the host out of their own room

**File:** [backend/src/signaling/registerSocketHandlers.ts:436–453](../../backend/src/signaling/registerSocketHandlers.ts#L436-L453) (collision-eviction branch); enabled by the OOS-3 removal of the `getLiveParticipantCount(room) === 0` join guard; spec [lifecycle.md §1 Rule 6](../../docs/system_design/lifecycle.md) (line 26)
**Severity:** Medium — violates the host-ownership invariant (CLAUDE.md §1: "Host ownership dictates room lifetime") and lifecycle.md §1 Rule 6.

Spec §1 Rule 6 ([:26](../../docs/system_design/lifecycle.md#L26)): "*Nickname reservations remain held during active grace windows: a reserved nickname cannot be claimed by a new joiner (the join is rejected with `INVALID_SIGNAL_PAYLOAD`) and is reclaimed by the original participant on `resume_session`.*"

The join handler does the opposite for a holder in a grace window — it **evicts** the sentinel so the new joiner can take the nickname:

```ts
const isDisconnected = existingParticipant?.socketId.startsWith("disconnected:") ?? false;
if (!isDisconnected) { emitInvalidSignalPayload(socket); return; }   // live holder → reject (matches spec)
// grace-held holder → EVICT and let the joiner claim it (contradicts spec Rule 6):
room.nicknameToParticipant.delete(...); room.participants.delete(existing);
state.participantToRoom.delete(existing); clearReconnectForParticipantFn(existing);
reconnectCtx.disconnectedParticipants.delete(existing);
```

The eviction predates Phase 11, but before OOS-3 the `liveCount === 0` guard rejected any join into an empty room, so a **host** sentinel (host disconnected, room empty) could never be evicted this way. OOS-3 removed that guard. Now:

1. Host creates room as "Alice" and TCP-drops → host sentinel in `participants`, `hostId = H`, "alice" reserved, 60-min host grace + reconnect token still valid.
2. `liveCount === 0`; a guest joins the now-reachable empty room choosing nickname "Alice".
3. The collision branch **deletes the host sentinel** and **clears the host's reconnect token** ([:451](../../backend/src/signaling/registerSocketHandlers.ts#L451)).
4. `room.hostId` still points to `H`, which no longer exists in `participants`. The host's `resume_session` now fails (`reconnectRecord` gone → `RECONNECT_TOKEN_STALE`, or the [:611–615](../../backend/src/signaling/registerSocketHandlers.ts#L611-L615) participant lookup returns `ROOM_NOT_FOUND`). **The host is permanently locked out of their own room**, which continues under a dangling `hostId` until the solo/host-grace timer fires.

Even setting the host case aside, evicting *any* grace-held holder contradicts Rule 6 — a participant who TCP-dropped (token intact, intends to resume) loses their reserved nickname and, via `clearReconnectForParticipantFn`, their ability to reconnect, the moment anyone else types their name. The code comment justifies eviction as "the holder lost their reconnect token on page refresh" — but the token is persisted in `sessionStorage` (survives refresh) and the branch fires unconditionally, not only when the token is actually gone.

**Recommendation (user decision per System Sync):** align with Rule 6 — reject the colliding join with `INVALID_SIGNAL_PAYLOAD` while the holder is in an active grace window (do not evict); let the original reclaim on `resume_session`. If the eviction behavior is intentionally desired for page-refresh recovery, the spec (Rule 6) and the code must be reconciled explicitly, and eviction should at minimum exclude the host and/or be gated on the reconnect token actually being absent.

**Resolution:** Fixed (user decision, 2026-07-01 — align code to the existing spec; no design-doc change, since lifecycle.md §1 Rule 6 already mandates rejection). The collision-eviction branch is removed: `join_room` now rejects any nickname collision with `INVALID_SIGNAL_PAYLOAD` whether the holder is live **or** grace-held — the grace-held holder (guest or host sentinel) is never evicted and reclaims the nickname on `resume_session` ([registerSocketHandlers.ts:436–443](../../backend/src/signaling/registerSocketHandlers.ts#L436-L443)). This closes the host-lockout: a guest can no longer delete the host sentinel / clear the host's reconnect token by claiming the host's nickname in the OOS-3-reachable empty room. Regression test **`T11.4-04`** added ([socket.integration.test.ts](../../backend/tests/socket.integration.test.ts), VP-11.4 test plan): host creates as "Alice", TCP-drops (empty room, sentinel), a guest join with "Alice" is rejected `INVALID_SIGNAL_PAYLOAD` with the sentinel untouched, then the host resumes and reclaims "Alice". Backend typecheck clean.

**Status:** Fixed.

---

### [CR11-14] SPEC CONFLICT / LIFECYCLE (Phase 11 scope) — `leave_room` hard-destroys an emptied room with reason `host_grace_expired` instead of entering empty-room behavior

**File:** [backend/src/signaling/registerSocketHandlers.ts:833–839](../../backend/src/signaling/registerSocketHandlers.ts#L833-L839); spec [lifecycle.md §1 Rule 4](../../docs/system_design/lifecycle.md#L18), [§3 empty-room behavior](../../docs/system_design/lifecycle.md#L67-L77), [§4 reason table](../../docs/system_design/lifecycle.md#L129-L132)
**Severity:** Medium — spec/code divergence + host-grace and empty-room-join guarantees denied + mislabeled destroy reason. Pre-existing/untouched code, but it is the last sibling of the CR11-3 / CR11-12 / CR11-13 empty-room family and directly contradicts CR11-3's own resolution ("the solo timer owns empty-room destruction").

When the last **live** participant leaves via `leave_room` while a disconnected host sentinel remains (`removed.roomStillActive === true`, `getLiveParticipantCount === 0`), the handler destroys the room immediately:

```ts
if (liveCount === 0) {
  socket.leave(removed.roomId);
  destroyRoom(removed.roomId, "host_grace_expired");
  ...
  return;
}
```

This contradicts lifecycle.md **Rule 4**: *"If the guest was the last live participant (`liveCount` drops to 0 because the host was already disconnected/in grace), the room is **not** destroyed by the leave itself — it enters empty-room behavior (§3) and is destroyed with `solo_timeout_expired` only if no one returns before the 15-min timer fires."* §3 explicitly names *"the last live guest explicitly leaves while the host is already disconnected/in grace"* as an empty-room-behavior trigger, not an immediate-destroy trigger. Two concrete consequences:

- **Host loses their room / return window is denied.** Host disconnects (intends to reconnect within the 60-min grace); a sole guest clicks **Leave**; the room is destroyed instantly. The host's `resume_session` now fails `ROOM_NOT_FOUND` even though up to ~59 min of host grace remained. OOS-3 also made empty rooms **joinable** — immediate destroy defeats that too (no one can join or resume the 15-min window this path is supposed to open).
- **Wrong reason.** `host_grace_expired` is defined by §4 for *"host disconnected and did not reconnect before the 60-min host grace timer fired, while live participants remained (`liveCount ≥ 1`)"* — but here `liveCount` is 0 and no grace timer fired. The correct reason is `solo_timeout_expired`, and only after the 15-min empty-room timer elapses. `destroyRoom("host_grace_expired")` mislabels the metric.

The inline comment (*"Last live participant left; destroy the room rather than letting it linger"*) encodes the pre-spec model. CR11-3 already removed the analogous immediate-destroy from `handleGuestGraceExpired`; this leave path was missed.

**Resolution:** Fixed (user decision, 2026-07-01 — align code to the existing spec per lifecycle.md §1 Rule 4 / §3; no design-doc behavioral change, only the constant rename from `SOLO_ROOM_TIMEOUT_MS` → `IDLE_ROOM_TIMEOUT_MS`). The `liveCount === 0` branch in `leave_room` no longer calls `destroyRoom`. Instead it calls `grace.restartSoloTimer(policy, signaling.IDLE_ROOM_TIMEOUT_MS, now, () => destroyRoom(removed.roomId, "solo_timeout_expired"))` to start a fresh 15-min empty-room window. Host grace continues in parallel; the earliest deadline wins (Rule 10). The handler falls through to `emitParticipantExit` (handles `socket.leave` and the zero-recipient `peer_left` broadcast). The hard-destroy path and mislabeled `host_grace_expired` metric are eliminated. Regression tests `T-CR14-01` and `T-CR14-02` added to phase-11.md (Pending — test code implementation not yet requested).

**Status:** Fixed.

---

### [CR11-15] ALTITUDE / CLEANUP (Out of Scope) — solo-timer restart/cancel logic is forked across three call sites with divergent semantics

**Files:** [backend/src/signaling/registerSocketHandlers.ts:250–258](../../backend/src/signaling/registerSocketHandlers.ts#L250-L258) (`restartSoloTimerIfSolo`), [:484–503](../../backend/src/signaling/registerSocketHandlers.ts#L484-L503) (join_room), [:640–670](../../backend/src/signaling/registerSocketHandlers.ts#L640-L670) (resume_session)
**Severity:** Low-Medium — latent bug / drift risk.

The empty-room/solo timer is manipulated in three places with **subtly different** behavior:
- `restartSoloTimerIfSolo(roomId, liveCount)` (used by disconnect and kick) **only restarts** when `liveCount === 1` and returns `null` otherwise — it **never cancels** a running timer.
- The `join_room` and `resume_session` blocks **both restart-if-1 AND cancel-if-≥2** (near-identical 18-line copies that re-fetch `policy`, clear `soloTimeoutRef`/`soloDeadlineAt`, and spread `soloDeadlineAt` into the payload).

The helper is safe *today* only because disconnect/kick can only **decrease** `liveCount` (a stale >1 timer cannot exist). That invariant is implicit and undocumented, and the two inline blocks already prove the mechanism needs the cancel branch. The moment a future count-**increasing** path is routed through `restartSoloTimerIfSolo`, it will silently leave a prior timer armed and destroy a now-multi-party room via `solo_timeout_expired`. CR11-12 was itself caused by exactly one of these copies diverging from the other.

**Resolution:** Fixed (2026-07-01, following CR11-14 which added a 4th inline copy and made consolidation urgent). `restartSoloTimerIfSolo` is replaced by `reconcileIdleTimer(roomId, liveCount)`: `liveCount ≤ 1` → restart the 15-min idle timer fresh and return the deadline; `liveCount ≥ 2` → cancel any running timer and return null. All five paths (join, resume, disconnect, kick, leave) now call `reconcileIdleTimer` — the `join_room` and `resume_session` inline blocks and the CR11-14 leave_room if/else are each collapsed to a single call. Side-effect: the disconnect path at `liveCount === 0` now restarts the timer fresh (new 15-min window) instead of letting the prior timer run out — spec-correct per lifecycle.md Rule 8.

**Status:** Fixed.

---

### [CR11-16] CORRECTNESS (frontend, Phase 11 scope) — the new `onError` "reconnecting" catch-all discards the reconnect session on *any* error, not just fatal ones

**File:** [frontend/src/features/room/useVaporRoom.ts:460–468](../../frontend/src/features/room/useVaporRoom.ts#L460-L468)
**Severity:** Low — new code this phase; narrow reachable window.

The added defensive block returns to lobby for **any** error that arrives while `screen === 'reconnecting'` (when `autoResumeRequestedRef` is already false), clearing chat history and the stored reconnect session:

```ts
if (previous.screen === 'reconnecting') {
  clearChatHistory(previous.activeRoomId)
  persistence.clearStoredReconnectSession()
  return resetToLobby(previous)
}
```

This patches a StrictMode ref-timing symptom rather than the root cause (a ref cleared by the double-mount before the async resume error resolves). In practice the realistic errors during an in-flight resume (`RECONNECT_TOKEN_STALE`, `HOST_RECONNECT_WINDOW_EXPIRED`, `ROOM_NOT_FOUND`, `INVALID_PASSWORD`, `RATE_LIMITED`) are all already handled by the `autoResumeRequestedRef` block above and resolve to lobby anyway, so today the outcome matches spec §5 (FAIL → lobby). The risk is that this catch-all **cannot distinguish** a benign/transient error from a fatal one: any future or out-of-band error code delivered during the reconnecting screen will now unconditionally wipe a still-valid reconnect token and delete chat history with no retry path.

**Resolution:** Gated the destructive teardown (chat clear + session wipe) on the same fatal resume error codes as the `autoResumeRequestedRef` block above (`ROOM_NOT_FOUND`, `INVALID_PASSWORD`, `RATE_LIMITED`, `RECONNECT_TOKEN_STALE`, `HOST_RECONNECT_WINDOW_EXPIRED`). Non-fatal or unknown errors during `screen === 'reconnecting'` still navigate to lobby (avoiding the spinner) but no longer wipe a still-valid reconnect token or chat history. ([useVaporRoom.ts:460–474](../../frontend/src/features/room/useVaporRoom.ts#L460-L474))

**Status:** Fixed.

---

### [CR11-17] OBSERVABILITY (Phase 11 scope) — `getRateLimitWindowActiveCount` no longer reflects join-side rate-limit activity

**File:** [backend/src/server.ts:56](../../backend/src/server.ts#L56)
**Severity:** Low — metrics only.

The metric was `createAttemptsBySubject.size + joinAttemptByRoomSubject.size` and is now `createAttemptsByIp.size` alone. `joinAttemptByRoomSubject` was removed (CR11-4), and join-rate activity now lives in `ipAbuseByIp` (its `joinCount`), which the metric does not consult. During a join-flood the gauge stays low, hiding the pressure from the observability surface that previously summed both maps.

**Resolution:** Added `ipAbuseByIp.size` to the gauge: `createAttemptsByIp.size + ipAbuseByIp.size`. `ipAbuseByIp` tracks both create and join activity per IP in the same 60 s window, so its size reflects join-flood pressure. This mirrors the old two-map sum. ([server.ts:57](../../backend/src/server.ts#L57))

**Status:** Fixed.

---

### [CR11-18] CLEANUP (Out of Scope) — rate-limit module: an unreachable create ceiling, redundant window aliases, and IP-only keying tradeoffs

**File:** [backend/src/signaling/handlers/rateLimiting.ts:154–190](../../backend/src/signaling/handlers/rateLimiting.ts#L154-L190)
**Severity:** Low.

Three observations in the rekeyed limiter (none is a functional break; grouped for one cleanup):
- **`CREATE_RATE_LIMIT_MAX` (30) is unreachable for creates.** Both the burst counter (`createAttemptsByIp`) and `ipRecord.createCount` increment once per same-IP create in the same 60 s window, and the burst gate blocks + short-circuits at `CREATE_ROOM_BURST_THRESHOLD = 5`. So `createCount` can never reach 30; the effective per-IP create ceiling is 5–6. The 30 ceiling has unit coverage (`T11.8-02` seeds `ipAbuseByIp` directly) but no integration-reachable path (already noted in CR11-8's resolution). Consider dropping the create-side `ipRecord.createCount` check or documenting that the real ceiling is the burst limit.
- **Redundant window constants.** `CREATE_RATE_LIMIT_WINDOW_MS` and `JOIN_RATE_LIMIT_WINDOW_MS` are both `60_000` and both applied against the **same** shared `ipAbuseByIp` record (the create path expires that record on `JOIN_RATE_LIMIT_WINDOW_MS`, line 166). Tuning only one would desync the create-burst sweep from the shared IP window. Collapse to one window constant or document the coupling.
- **IP-only keying is coarser than the old subject key.** `deriveIp(socket)` alone now buckets all clients behind one NAT/reverse-proxy IP into a single 30/min window and a single burst blocklist, so one user's traffic can rate-limit or 10-min-block everyone on that IP (the previous `ip|ua|fingerprint` subject key isolated them). This is the intended VP-11.2 direction and consistent with lifecycle.md §7 "prefer aggregate detection," but flag it for deployment awareness (behind a proxy, `handshake.address` may be the upstream IP for everyone).

**Resolution:** Removed `CREATE_RATE_LIMIT_MAX` and `createCount` from `IpAbuseRecord` — the burst gate (`CREATE_ROOM_BURST_THRESHOLD=5`) always fires first, so the IP ceiling was unreachable. `checkAndRecordCreateAttempt` no longer touches `ipAbuseByIp`, cleanly separating the two maps (each with its own window constant). T11.8-01/02 commented SPEC-INVALID. NAT/proxy deployment note added to `deriveIp`. Design docs (`core-architecture.md §2`, `signaling-contract.md §2`) updated to match.

**Status:** Fixed.

---

### [CR11-19] CLEANUP / EFFICIENCY (Out of Scope) — `resolveSignalRoute` does a redundant second `Map.get` and a non-null assertion for the `lastSeenAt` stamp

**File:** [backend/src/signaling/handlers/signalRelay.ts:85–96](../../backend/src/signaling/handlers/signalRelay.ts#L85-L96)
**Severity:** Low — hot path (every offer/answer/ICE relay).

Line 85 already establishes membership via `room.participants.has(fromParticipantId)`; line 96 then re-fetches the same record with a non-null assertion — `room.participants.get(fromParticipantId)!.lastSeenAt = now()` — a second hash lookup on the busiest server path plus a `!` that re-asserts an invariant proven 11 lines earlier. Fetch the record once at line 85 (`const fromParticipant = room.participants.get(fromParticipantId); if (!fromParticipant) { emitNotFound(); return null; }`) and set `fromParticipant.lastSeenAt = now()`, removing both the redundant lookup and the assertion. (Interacts with CR11-9 / BL-FEAT-LASTSEEN-01 — the stamp still precedes payload validation.)

**Status:** Fixed. Replaced `room.participants.has(fromParticipantId)` + `room.participants.get(fromParticipantId)!` pair with a single `room.participants.get(fromParticipantId)` null-check; `fromParticipant.lastSeenAt = now()` uses the already-fetched record.

---

## Test Suite Review (obsolete / needs-update)

| Test file | Status | Notes |
|---|---|---|
| `frontend/tests/contract.integration.test.mjs` | Fixed | 6 stale assertions updated (CR11-1). |
| `backend/tests/socket.integration.test.ts` | Fixed (CR11-10) | Rename applied; old nickname/heartbeat tests deleted; T11.7-03/04, T11.5-02 added; T6.1-06 rewired to burst limit; T3.3-06 removed (CR11-8); T3.3-07/08 + T2.4-* commented SPEC-INVALID (CR11-7). T3.2-09 NUL case restored as `\u0000` escape (CR11-10). |
| `backend/tests/security.policy.test.ts` | Updated, OK | Obsolete rate-limit assertions correctly commented `SPEC-INVALID`; `...ByIp` names adopted; nickname-removal assertions added. |
| `backend/tests/kick.integration.test.ts` | Updated, OK | New tests verify kicked socket gets `participant_kicked` not `peer_left`, ordering, and `reason: "kick"`. `FakeIo.leaveRoom`/`FakeSocket.leave` harness additions are correct. |
| `backend/tests/disconnect.integration.test.ts` | Fixed (CR11-11) | Rename applied; T11.4-01/03 correct (live host → room survives). T11.4-02 reworked: asserts room survives guest-grace callback, then fires the solo timer and asserts destruction with `solo_timeout_expired`. |
| `backend/tests/soloTimer.integration.test.ts` | Updated, OK | Rename applied. |
| `frontend/tests/peerLeft.unit.test.mjs` | New, OK (brittle) | Source-grep style (CR11-7). |
| `e2e/` (all 5 spec files) | **No diff — pre-existing OOS spec conflict** | Phase 11 made no e2e changes. All 5 files pass against Phase 11 code (no Phase 11 change affected e2e-observable behavior). One test (`03-lifecycle.spec.ts:139`) contradicts the current spec — see OOS-3. |

---

## Out of Scope

- **OOS-1 — `PeerLeftPayload.participantCount` is undocumented in the wire contract.** Added `participantCount` to `peer_joined` and `peer_left` in `signaling-contract.md` §3 and §5. **Fixed.**
- **OOS-2 — NUL byte in `backend/tests/socket.integration.test.ts`.** Editor artifact at byte offset 95340 — but it was **inside `T3.2-09`'s intentional NUL test input**, not stray noise. Re-saving "clean UTF-8" stripped the byte from the test data itself (→ valid nickname `"NameX"`, CR11-10) and left a leading UTF-8 BOM on line 1. **Reopened** — the correct fix is a save-safe `\u0000` escape in the literal, not deletion; see CR11-10.

- **OOS-3 — `e2e/03-lifecycle.spec.ts:139` contradicts lifecycle.md §1 Rule 2 / §3 `join_room when liveCount === 0` rule.** Removed the `liveCount === 0` guard from the join handler ([registerSocketHandlers.ts:417–420](../../backend/src/signaling/registerSocketHandlers.ts#L417-L420)) that was returning `ROOM_NOT_FOUND`. Timer logic restructured: joining into an empty room (joinLiveCount === 1) now cancels the empty-room timer and restarts the solo timer, surfacing `soloDeadlineAt` in `room_joined`; second+ participant joining still clears the solo timer. E2e test renamed and updated to assert the joiner successfully enters the room and sees "1 participant". **Fixed.**

- **OOS-4 (CR11-15) — Solo-timer restart/cancel logic forked across call sites. Fixed** (2026-07-01): CR11-14 added a 4th inline copy making consolidation urgent; `restartSoloTimerIfSolo` replaced by `reconcileIdleTimer(roomId, liveCount)` covering all five paths. See CR11-15.

- **OOS-5 (CR11-18) — Rate-limit module: unreachable `CREATE_RATE_LIMIT_MAX` ceiling, redundant window aliases, IP-only NAT trade-off. Fixed.** `CREATE_RATE_LIMIT_MAX` and `createCount` removed; `checkAndRecordCreateAttempt` no longer touches `ipAbuseByIp` (the two maps are now cleanly separate). T11.8-01/02 commented out as SPEC-INVALID. NAT deployment note added to `deriveIp`. See CR11-18.

- **OOS-6 (CR11-19) — `resolveSignalRoute` redundant `Map.get` + `!` on the signal relay hot path. Fixed.** Replaced `.has()` + `.get()!` pair with a single `.get()` null-check; the fetched record is reused directly for `lastSeenAt`. See CR11-19.