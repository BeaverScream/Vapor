# Phase 9 — Detailed Work Matrix

Date: 2026-06-23  
Owner: @vapor-pm  
Status: Complete ✅

**Final Result:** 274/274 tests passing (100% pass rate)
- Backend: 72 unit + 112 integration tests ✅
- Frontend: 70 unit + 20 contract tests ✅
- All 3 contract test gates resolved (T2.2-01, T3.2-05, T3.1-05) ✅

## Purpose

Phase 9 is a targeted bug-fix and quality-baseline phase. Items are sequenced with extraction tasks first (VP-9.2 helper, VP-9.3 state utility), then the bug fixes that consume them, then isolated frontend-only tasks. No new user-facing features are introduced.

### Design Direction Decisions

| # | Decision | Rationale |
|---|---|---|
| D-1 | `restartSoloTimer` is extracted into `graceWindowManager.ts` before any call sites are updated. VP-9.1 (leaveRoom) and VP-9.2 (disconnect paths) both consume the helper — not the inlined kick-handler pattern. Per CR9-7 the four in-handler call sites (kick, leave, host-disconnect, guest-disconnect) additionally route through a `restartSoloTimerIfSolo(roomId, liveCount)` closure in `registerSocketHandlers.ts` that encapsulates the `liveCount === 1` + policy-lookup guard. | Ensures all restart sites share one implementation and one guard. Extraction precedes usage. |
| D-2 | When `liveCount === 0` via TCP drop, `restartSoloTimer` starts the 15-min timer. On reconnect: if `liveCount` rises to 1, restart the timer (solo mode); if `liveCount` rises to ≥ 2, cancel it entirely. | Spec §6 Rule 5 and Rule 8: fully empty rooms are bounded by 15 min; solo mode restarts the timer each time the count changes. |
| D-3 | `clearRoomArtifacts` adds `roomNameToId.delete` internally (guarded by a name-exists check) rather than renaming the function. | All existing callers already reach `clearRoomArtifacts` — adding the delete there removes the leak without changing any call site. |
| D-4 | The 6 `exhaustive-deps` warnings in `useVaporRoom.ts` are resolved with `// eslint-disable-next-line react-hooks/exhaustive-deps` and a one-line justification that **names the specific stable refs** it covers, rather than restructuring the stable collaborator refs. | Refs (`chat`, `persistence`, `typing`, plus `socketRef` / `socketStateRef` / `resumeInFlightRef` / `autoResumeRequestedRef`) are stable by construction; adding them to dep arrays changes nothing but adds noise. Naming the refs (per CR9-9) prevents a maintainer from "fixing" the omission by adding a ref and triggering a re-render loop. |

## Table of Contents

- [VP-9.1 Kick Flow Correctness](#vp-91-kick-flow-correctness)
- [VP-9.2 Solo Timer & Empty-Room Lifecycle](#vp-92-solo-timer--empty-room-lifecycle)
- [VP-9.3 State & Type Cleanup](#vp-93-state--type-cleanup)
- [VP-9.4 Contract Test Suite Recovery](#vp-94-contract-test-suite-recovery)
- [VP-9.5 Core Hook Lint Compliance](#vp-95-core-hook-lint-compliance)

---

## VP-9.1 Kick Flow Correctness

### Implementation Plan

| Subtask | Task | Module / Interface | Detail | Status | Pass Criteria | Evidence Pointer |
|---|---|---|---|---|---|---|
| 9.1.1 | leaveRoom: restart solo timer when liveCount === 1 | `backend/src/signaling/registerSocketHandlers.ts` (leaveRoom handler) | After removing the departing guest, compute remaining `liveCount`. If `liveCount === 1`, call `restartSoloTimer` (extracted in 9.2.1) and include the resulting `soloDeadlineAt` timestamp in the `peer_left` broadcast payload. Mirrors the kick handler's existing behavior exactly. **Requires 9.2.1 complete first.** | Done | When a guest voluntarily leaves and only the host remains, `peer_left` carries a valid `soloDeadlineAt`. `SoloWaitingChip` counts down for the host. | integration test; manual E2E |
| 9.1.2 | withKickedFromRoom: reset lobby fields | `frontend/src/features/room/state-utils.ts` | In `withKickedFromRoom`, after delegating to `withRoomEnded`, explicitly set `lobbyMode: 'create'`, `lobbyStatus: 'idle'`, `errorMessage: null`, `roomIdInput: ''`. These four fields are not reset by `withRoomEnded`. | Done | `withKickedFromRoom(state)` returns an object nd/src/features/room/state-utils.ts	In withKickedFromRoom, after delegating to withRoomEnded, explicitly set lobbyMode: 'create', lobbyStatus: 'idle', with all four fields at their clean defaults. | unit test |
| 9.1.3 | Build and lint check | `frontend/`, `backend/` | `npm run build` (root) and `npm run lint` (frontend) — no new errors. | Done | Build clean; 0 new lint errors. | build green |

### Test Plan

| Test # | Suite | Purpose | Verification Focus | Status |
|---|---|---|---|---|
| T9.1-01 | build | Build passes after all VP-9.1 changes. | Regression gate. | Pass |
| T9.1-02 | integration test | Guest leaves explicitly; host remains alone. `peer_left` payload contains `soloDeadlineAt` ≈ `now + SOLO_HOST_ROOM_TIMEOUT_MS`. | Solo timer restart in leaveRoom path. | Pass |
| T9.1-03 | integration test | Host's `SoloWaitingChip` appears and counts down after guest voluntarily leaves (no kick). | End-to-end countdown wiring from leaveRoom path. | Pass |
| T9.1-04 | unit test | `withKickedFromRoom(state)` returns `{ lobbyMode: 'create', lobbyStatus: 'idle', errorMessage: null, roomIdInput: '' }`. | State machine boundary — lobby fields clean after kick. | Pass |
| T9.1-05 | integration test | Kick handler still emits `soloDeadlineAt` in `peer_left` when host kicks the last guest (Phase 8 behavior preserved after kick handler is refactored to use helper). | Regression guard on kick path. | Pass |

---

## VP-9.2 Solo Timer & Empty-Room Lifecycle

### Implementation Plan

| Subtask | Task | Module / Interface | Detail | Status | Pass Criteria | Evidence Pointer |
|---|---|---|---|---|---|---|
| 9.2.1 | Extract restartSoloTimer helper | `backend/src/signaling/graceWindowManager.ts` | Add and export `restartSoloTimer(roomId: string, policy: RoomPolicy, nowFn: () => number): void`. Body: `clearTimeout(policy.soloTimer)`, compute `deadline = nowFn() + SOLO_HOST_ROOM_TIMEOUT_MS`, assign `policy.soloTimer = setTimeout(() => destroyRoom(roomId, 'solo_timeout_expired'), SOLO_HOST_ROOM_TIMEOUT_MS)`, call `.unref?.()`, set `policy.soloDeadlineAt = deadline`. This is the prerequisite for 9.1.1, 9.2.2, 9.2.3, and 9.2.5. | Done | Function exported; TypeScript build passes; calling it deterministically updates `policy.soloDeadlineAt` and clears the previous timer. | build green; unit test |
| 9.2.2 | Host-disconnect path: start solo timer when liveCount === 0 | `backend/src/signaling/registerSocketHandlers.ts` (host disconnect handler) | After processing a host TCP disconnect, compute `liveCount`. If `liveCount === 0`, call `restartSoloTimer`. Individual host grace window continues running in parallel (D-2). | Done | When only the host is present and disconnects via TCP, a 15-min solo timer starts. Room is not held open for the full 60-min host grace. | integration test |
| 9.2.3 | Guest-disconnect path: start solo timer when liveCount === 0 | `backend/src/signaling/registerSocketHandlers.ts` (guest disconnect / `handleGuestGraceExpired` path) | After processing a guest TCP disconnect, compute `liveCount`. If `liveCount === 0`, call `restartSoloTimer`. (The existing liveCount === 1 branch already starts the timer for the host-solo case; this adds only the fully-empty case.) | Done | When host + all guests drop via TCP, resulting in liveCount === 0, a 15-min timer starts. Room is destroyed after `SOLO_HOST_ROOM_TIMEOUT_MS`, not after the longer grace windows. | integration test |
| 9.2.4 | Cancel or restart solo timer on reconnect | `backend/src/signaling/registerSocketHandlers.ts` (resume_session handler) | When a participant successfully reconnects: if new `liveCount === 1` **and the resuming participant is the host** (`room.hostId === reconnectRecord.participantId`, CR9-4), call `restartSoloTimer`; if `liveCount >= 2`, cancel any running solo timer. The `roomJoined` payload only forwards `soloDeadlineAt` when the resumer is the host (else `null`) so a resuming guest never drives host-only policy. (D-2) | Done | Participant reconnects before 15-min timer fires: room survives. Host-solo resume → timer restarted + deadline sent; guest-solo resume → timer untouched + `null` deadline; multi-participant count → timer cancelled. | integration test |
| 9.2.5 | Update kick handler to use restartSoloTimer | `backend/src/signaling/registerSocketHandlers.ts` (kick handler) | Replace the inline solo-timer restart block (clearTimeout + compute deadline + setTimeout + unref + write `policy.soloDeadlineAt`) with a call to `restartSoloTimer`. No behavior change. | Done | Kick handler behavior identical to Phase 8 after refactor. `peer_left` still carries `soloDeadlineAt`. Covered by T9.1-05. | build green |
| 9.2.6 | Build and lint check | `backend/` | `npm run build` (root) — no new errors. | Done | Build clean across shared and backend. | build green |

### Test Plan

| Test # | Suite | Purpose | Verification Focus | Status |
|---|---|---|---|---|
| T9.2-01 | build | Build passes after all VP-9.2 changes. | Regression gate. | Pass |
| T9.2-02 | unit test | `restartSoloTimer(roomId, policy, nowFn)` sets `policy.soloDeadlineAt ≈ nowFn() + SOLO_HOST_ROOM_TIMEOUT_MS` and clears any previous timer handle. | Helper correctness. | Pass |
| T9.2-03 | integration test | All participants (host + all guests) drop via TCP; resulting liveCount === 0. Room is destroyed after `SOLO_HOST_ROOM_TIMEOUT_MS`, not after the longer host or guest grace windows. | liveCount === 0 starts 15-min timer. | Pass |
| T9.2-04 | integration test | All participants drop via TCP (liveCount === 0); one participant reconnects within 15 min. Solo timer is cancelled (or restarted per D-2). Room survives. | Reconnect before timer fires. | Pass |
| T9.2-05 | code review | Grep `registerSocketHandlers.ts`: the kick, leave, host-disconnect, and guest-disconnect branches all restart the solo timer via the `restartSoloTimerIfSolo` wrapper; `grace.restartSoloTimer` is called directly only inside that wrapper and in the resume_session handler. No inline solo-timer block (clearTimeout + deadline + setTimeout + unref) remains outside `graceWindowManager.ts`. (CR9-7) | Extraction completeness. | Pass |
| T9.2-06 | integration test | Host drops via TCP with no guests (liveCount was already 1 before drop, goes to 0). Solo timer starts; room destroyed after 15 min (not 60-min host grace). | Fully empty room via host TCP drop — timer fires. | Pass |

---

## VP-9.3 State & Type Cleanup

### Implementation Plan

| Subtask | Task | Module / Interface | Detail | Status | Pass Criteria | Evidence Pointer |
|---|---|---|---|---|---|---|
| 9.3.1 | clearRoomArtifacts: clean roomNameToId | `backend/src/signaling/registerSocketHandlers.ts` (`clearRoomArtifacts`) | `clearRoomArtifacts` deletes `roomNameToId` via a `state.rooms.get(roomId)` name lookup, so it must run **before** `state.rooms.delete(roomId)`. Per CR9-8, `handleGuestGraceExpired` now calls `clearRoomArtifacts(roomId)` before deleting the room and drops its redundant explicit `roomNameToId.delete`, making the helper the single live cleanup path. (D-3) | Done | After `clearRoomArtifacts` runs for a named room, `state.roomNameToId.get(room.roomName)` returns `undefined`; the `handleGuestGraceExpired` path no longer leaves dead cleanup code. | unit test |
| 9.3.2 | Extract clearSessionFields helper | `frontend/src/features/room/state-utils.ts` | Add `clearSessionFields(): Partial<RoomSessionState>` returning all shared session fields zeroed (`participantId`, `activeRoomId`, `activeRoomName`, `hostId`, `expiresAt`, `soloDeadlineAt`, `participants`, `participantCount`, `chatMessages`, `chatDraft`, `chatConnectionState`, `connectedPeerCount`, `hostReconnectGraceDeadlineAt`, `roomIdInput`, `roomNameInput`, `passwordInput`, `nicknameInput`, `copyFeedback`, `joinRateLimitUntil`, `joinRateLimitRoomId`, `participantNicknames`, `hasPassword`, `typingPeerIds`). `roomIdInput: ''` is included (CR9-5). `withRoomEnded`, `resetToLobby`, **and** `withRoomCreated` / `withRoomJoined` (CR9-6) all spread `clearSessionFields()` and override only their differing/payload fields. | Done | `withRoomEnded` and `resetToLobby` produce identical values for all shared session fields, and `resetToLobby` clears `roomIdInput`. A new session field added to `clearSessionFields` is zeroed across all four entry/exit transitions without further edits. | unit test |
| 9.3.3 | Add missing ErrorCode types and handlers | `frontend/src/features/room/types.ts`, `frontend/src/features/room/error-copy.ts` | Add `'HOST_RECONNECT_WINDOW_EXPIRED'`, `'RECONNECT_TOKEN_STALE'`, `'NOT_AUTHORIZED'` to the `ErrorCode` union. In `error-copy.ts`, add a branch for each with an appropriate user-facing message (e.g., `NOT_AUTHORIZED`: "You are not authorized to perform this action."; `RECONNECT_TOKEN_STALE`: "Your reconnect token has expired. Please rejoin the room."; `HOST_RECONNECT_WINDOW_EXPIRED`: "The host reconnect window has closed. The room may have ended."). Verify all 9 canonical codes from design §8 are present and handled. | Done | TypeScript build passes. `getErrorCopy` (or equivalent) returns a non-null, non-empty string for every canonical error code including the three new ones. | build green; unit test |
| 9.3.4 | Fix falsy-zero guards in countdown helpers | `frontend/src/features/room/` (`getSoloWaitingText`, `getLifetimeText` — locate by grep) | Replace `if (!soloDeadlineAt)` with `if (soloDeadlineAt === null \|\| soloDeadlineAt === undefined)`. Same replacement for `if (!expiresAt)`. No behavior change in production (wall-clock values are in the billions); test environments using `now() = 0` now exercise countdown rendering instead of silently returning `null`. | Done | `getSoloWaitingText(0, () => 0)` returns a truthy countdown string, not `null`. `getLifetimeText(0, () => 0)` similarly. | unit test |
| 9.3.5 | Build and lint check | `frontend/`, `backend/` | `npm run build` (root) and `npm run lint` (frontend) — no new errors. | Done | Build clean; 0 new lint errors (pre-existing VP-9.5 errors unchanged). | build green |

### Test Plan

| Test # | Suite | Purpose | Verification Focus | Status |
|---|---|---|---|---|
| T9.3-01 | build | Build passes after all VP-9.3 changes. | Regression gate. | Pass |
| T9.3-02 | unit test | `clearRoomArtifacts` called on a named room: `state.roomNameToId.get(room.roomName)` returns `undefined` afterward. | roomNameToId cleanup. | Pass |
| T9.3-03 | unit test | `withRoomEnded(state)` and `resetToLobby(state)` produce identical values for all shared session fields (participantId, activeRoomId, participants, chatMessages, soloDeadlineAt, etc.). | clearSessionFields shared zeroing. | Pass |
| T9.3-04 | type check | `tsc` (frontend) passes with `ErrorCode` union containing all 9 canonical codes from design §8. | Compile-time error coverage. | Pass |
| T9.3-05 | unit test | `getErrorCopy('NOT_AUTHORIZED')`, `getErrorCopy('RECONNECT_TOKEN_STALE')`, `getErrorCopy('HOST_RECONNECT_WINDOW_EXPIRED')` each return a non-null, non-empty string. | Live production error code NOT_AUTHORIZED is now mapped. | Pass |
| T9.3-06 | unit test | `getSoloWaitingText(0, () => 0)` and `getLifetimeText(0, () => 0)` each return a truthy string (not `null`). | Falsy-zero guard fixed; countdown path exercisable in test. | Pass |

---

## VP-9.4 Contract Test Suite Recovery

### Implementation Plan

| Subtask | Task | Module / Interface | Detail | Status | Pass Criteria | Evidence Pointer |
|---|---|---|---|---|---|---|
| 9.4.1 | Fix frontend handler and call-site pattern assertions | `frontend/tests/contract.integration.test.mjs` | Update 6 frontend-side failing assertions to match current implementation patterns: **T2.6-03** — update `socket.onSignalOffer(onSignalOffer)` to the current handler registration shape in `useVaporRoom.ts`. **T2.2-01** — update to `socketRef.current?.emitResumeSession(storedSession)` (optional-chain at call site). **T0.1-07 and T1.4-02** — update to variable name `s` (renamed from `state` in the `submitLobby` closure during Phase 5). **T3.2-05** — update to `persistence.writeStoredReconnectSession({...})` (qualified call site). **T4.2-02** — add cast prefix `(socket.io.on as ...)('pong', ...)`. Assert observable behavior where the test was encoding variable-name internals. | Done | All 6 frontend-side previously-failing tests pass individually. | test run output |
| 9.4.2 | Fix timer formatter assertion | `frontend/tests/contract.integration.test.mjs` | **T1.7-01** — updated the assertion from the old `` return `Ends in ${paddedMinutes}:${paddedSeconds}` `` template to the current inline format `` return `Ends in ${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}` ``. | Done | T1.7-01 passes. | test run output |
| 9.4.3 | Fix backend symbol assertion | `frontend/tests/contract.integration.test.mjs` | **T3.3-04** — `temporaryBlocklistBySubject`, `createAttemptsBySubject`, and `CREATE_ROOM_BURST_THRESHOLD` moved to `rateLimiting.ts` (not renamed). Added `rateLimitingFile` path constant and read in T3.3-04; updated assertions to check `rateLimiting` source instead of `handlers`. Added a handler-level check for `rateLimiting.checkAndRecordCreateAttempt` to retain wiring coverage. | Done | T3.3-04 passes. | test run output |
| 9.4.4 | Implement missing persistence and lock wiring | `frontend/src/features/room/useVaporRoom.ts`, `backend/src/signaling/registerSocketHandlers.ts` | **T2.2-01**: Add `persistence.clearStoredReconnectSession()` calls in cleanup paths (onParticipantKicked, onRoomDestroyed, onError). **T3.2-05**: Add `persistence.writeStoredReconnectSession({roomId, reconnectToken})` in onRoomJoined. **T3.1-05**: Make `withRoomLock` async and use `await withRoomLock(roomId, ...)` in resume_session and room_password_update handlers. | Done | All 20 contract tests pass; 0 failures. | 274/274 tests passing |

### Test Plan

| Test # | Suite | Purpose | Verification Focus | Status |
|---|---|---|---|---|
| T9.4-01 | contract suite | All 20 contract integration tests pass — 0 failures. | Full suite green. | **Pass** (20/20 pass ✅) |
| T9.4-02 | contract suite | T2.2-01, T3.2-05, T3.1-05 implementation complete and verified. | All previously-failing tests now passing. | **Pass** (3/3 fixed ✅) |

---

## VP-9.5 Core Hook Lint Compliance

### Implementation Plan

| Subtask | Task | Module / Interface | Detail | Status | Pass Criteria | Evidence Pointer |
|---|---|---|---|---|---|---|
| 9.5.1 | Move ref writes from render body to useEffect | `frontend/src/features/room/useVaporRoom.ts` | Wrap the four render-body ref assignments (`createSocketClientRef.current = ...`, `writeClipboardTextRef.current = ...`, `stateRef.current = ...`, `socketStateRef.current = ...`) in a `useEffect` with the corresponding values as deps (e.g., `[createSocketClient, writeClipboardText, state, socketState]`). Shifts write from render time to commit time; validate that reconnect and signaling flows are unaffected by the one-commit-cycle timing shift. | Done | 0 `react-hooks/refs` lint errors. Room join, message send, and disconnect behave identically before and after. | lint; integration test |
| 9.5.2 | Resolve exhaustive-deps warnings | `frontend/src/features/room/useVaporRoom.ts` | For each of the 5 `useCallback`s that intentionally omit stable refs, added `// eslint-disable-next-line react-hooks/exhaustive-deps` on the preceding line with a justification comment that **names the specific refs** it covers (e.g. `// socketRef / socketStateRef / resumeInFlightRef / autoResumeRequestedRef are stable React refs, not reactive deps — do not add them.`). Affected callbacks: `clearRoomSession`, `createPeerMesh`, `onConnect`, `onRoomCreated`, `onRoomJoined`. (D-4, CR9-9) | Done | 0 `react-hooks/exhaustive-deps` warnings in `useVaporRoom.ts`. | lint |
| 9.5.3 | Lint verification | `frontend/` | Run `npm run lint` in `frontend/`. Must reach 0 errors, 0 warnings. | Done | Lint exits with 0 errors, 0 warnings. | lint output |

### Test Plan

| Test # | Suite | Purpose | Verification Focus | Status |
|---|---|---|---|---|
| T9.5-01 | lint | `npm run lint` (frontend) exits 0 with no errors or warnings. | Clean lint baseline. | Pass |
| T9.5-02 | build | `npm run build` (frontend) passes after ref timing change. | No compile regression from useEffect wrapping. | Pass |
| T9.5-03 | integration test | Room join, send message, leave room — all function correctly after ref writes move to useEffect. | Ref timing shift doesn't break core room behaviors. | Pass |
| T9.5-04 | integration test | Reconnect flow: host disconnects and reconnects within grace window — no signaling-order regression or clipboard-copy failure. | Timing-sensitive path unaffected by commit-cycle shift. | Pass |

---

## Out of Scope

- Heartbeat implementation (BL-SIG-HEARTBEAT-01) — deferred to a future phase.
- Shared constants centralization (BL-SHARED-CONSTANTS-01) — larger refactor; separate phase.
- Admin reporting, email, and analytics bugs — separate backlog section.
- File sharing, RAM-only chat history — future product features.
- Any new user-facing UI additions.

## Dependency Order

**Prerequisite (must complete first):**
1. `9.2.1` — `restartSoloTimer` extraction into `graceWindowManager.ts`. Required by `9.1.1`, `9.2.2`, `9.2.3`, and `9.2.5`.

**Gated sequence after 9.2.1:**
2. `[9.1.1, 9.2.2, 9.2.3, 9.2.4, 9.2.5]` — All solo-timer restart call sites. Can proceed in parallel once the helper exists.
3. `[9.1.2, 9.1.3, 9.2.6]` — Cleanup and lint checks; run after their respective implementation subtasks are done.

**Independent — can begin in any order (no dependency on the above):**
- VP-9.3 (clearRoomArtifacts is backend-only; clearSessionFields, ErrorCode additions, and timer guards are frontend-only and self-contained)
- VP-9.4 (test file changes only; no production code changes)
- VP-9.5 (`useVaporRoom.ts` lint fixes only; no signaling or state-machine changes)
