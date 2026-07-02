# Phase 11 — Spec-Code Alignment & Bug Fixes

Date: 2026-06-29
Owner: @vapor-pm
Status: Planned

**Scope:** Seven targeted fixes addressing spec/code misalignment and correctness issues discovered in the Phase 10 code review, plus two additions (VP-11.7, VP-11.8) decided during Phase 11 planning. Items are independent and can be implemented in any order.

**Estimated Effort:** ~7–9 hours (1–2 days with testing).

---

## Table of Contents

- [Constraints & Decisions](#constraints--decisions)
- [VP-11.1 Rename Solo Timer Constant](#vp-111-rename-solo-timer-constant)
- [VP-11.2 Import Missing Signaling Constants from Spec](#vp-112-import-missing-signaling-constants-from-spec)
- [VP-11.4 Fix Guest Grace Participant Count](#vp-114-fix-guest-grace-participant-count)
- [VP-11.5 Remove Off-Contract Nickname-Update Feature](#vp-115-remove-off-contract-nickname-update-feature)
- [VP-11.6 Fix Kick Reason & Socket Removal Order](#vp-116-fix-kick-reason--socket-removal-order)
- [VP-11.7 Drop Heartbeat Mechanism](#vp-117-drop-heartbeat-mechanism)
- [VP-11.8 Raise IP Create Rate Limit Threshold](#vp-118-raise-ip-create-rate-limit-threshold)

---

## Constraints & Decisions

| # | VP Item | Type | Detail | Rationale |
|---|---------|------|--------|-----------|
| 1 | VP-11.1 | Constraint | Timer behavior unchanged: same numeric value (15 × 60 × 1000 ms), same trigger paths, same semantics. Rename must be exhaustive across `shared/policy.ts`, `contracts.ts`, `registerSocketHandlers.ts`, and every test file — any missed site causes a TypeScript compile error. No logic changes permitted. | Pure symbol rename; any partial rename breaks the build. |
| 2 | VP-11.2 | Constraint | The 5 new constants must match `core-architecture.md` §2 exactly: `SWEEPER_INTERVAL_HOURS=5`, `JOIN_RATE_LIMIT_WINDOW_MS=60000`, `JOIN_RATE_LIMIT_MAX=30`, `CREATE_RATE_LIMIT_WINDOW_MS=60000`, `CREATE_RATE_LIMIT_MAX=30`. `HEARTBEAT_INTERVAL_MS` and `PARTICIPANT_STALE_MS` are NOT added (removed by VP-11.6). Existing rate-limiting and sweeper behavior must remain identical after the constant-source switch. | Spec alignment; only `CREATE_RATE_LIMIT_MAX` is intentionally changed (10 → 30 per VP-11.7). |
| 3 | VP-11.2 | Decision | Constant mapping: `CREATE_ATTEMPT_WINDOW_MS` → `CREATE_RATE_LIMIT_WINDOW_MS`; `IP_CREATE_THRESHOLD` → `CREATE_RATE_LIMIT_MAX`; `IP_JOIN_THRESHOLD` → `JOIN_RATE_LIMIT_MAX`; `IP_ABUSE_WINDOW_MS` → `JOIN_RATE_LIMIT_WINDOW_MS`. `DEFAULT_SWEEP_INTERVAL_MS` derived as `SWEEPER_INTERVAL_HOURS * 60 * 60 * 1000`. `CREATE_ROOM_BURST_THRESHOLD` and `CREATE_ROOM_BLOCK_DURATION_MS` remain local — distinct burst-detection layer. | Local names that diverge from spec names are replaced at call sites; burst constants have no spec equivalent. |
| 4 | VP-11.4 | Constraint | `handleGuestGraceExpired` is sentinel cleanup only — delete participant entry, drop nickname mapping, clear reconnect record. No `peer_left` emitted; no destroy logic in this path. The 15-min solo/empty-room timer owns empty-room destruction exclusively. | The solo timer fires before the 30-min guest-grace timer in the empty-room case (15 min < 30 min), so the old destroy branch in `handleGuestGraceExpired` was unreachable in production; removing it eliminates a mislabeled metric and a non-canonical destroy path that skipped `destroyRoom` and emitted no `room_destroyed`. |
| 5 | VP-11.4 | Decision | Remove the `liveCount === 0` destroy branch from `handleGuestGraceExpired` entirely. The solo timer (already armed when `liveCount` hits 1) continues running when `liveCount` drops to 0 and owns empty-room destruction via `solo_timeout_expired`. | Avoids `incrementRoomDestroyed("host_grace_expired")` for a guest/empty-room destruction, and eliminates the manual `clearRoomArtifacts` + `state.rooms.delete` path that bypassed `destroyRoom` and violated lifecycle.md §4's atomic-destruction contract. |
| 6 | VP-11.5 | Constraint | All room create/join/signaling flows must remain unaffected. `normalizeNickname` validation at join/create paths must be preserved. After removal: no `nickname_update` handler, no `nickname_updated` listener, no `nicknameUpdatedAt` field in participant state. Build must be typecheck-clean. | Off-contract feature; removing it must not disturb any in-contract path. |
| 7 | VP-11.5 | Decision | Remove `nicknameUpdatedAt` from `ParticipantRecord` in `state.ts` and its two assignment sites in `registerSocketHandlers.ts`. Delete `NicknameUpdatePayload` and `NicknameUpdatedPayload` from `shared/payloads.ts`; update all three referencing files together. | Orphaned fields and types cause dangling references and fail typecheck. |
| 8 | VP-11.6 | Constraint | Kicked socket must NOT receive `peer_left` about itself — only `participant_kicked`. `peer_left` broadcast to remaining participants must carry `reason: "kick"`. Socket removal and disconnect happen BEFORE any broadcast. Solo timer logic after kick is unaffected. Frontend `onPeerLeft` must render a "was removed" system message when `reason === "kick"`. | `lifecycle.md` §3 requires socket removal first; broadcasting after removal naturally excludes the target. |
| 9 | VP-11.6 | Decision | New kick order: (1) emit `participant_kicked` to room (target still present so it receives its own notification), (2) state cleanup (participant map removals), (3) `targetSocket.leave(roomId)`, (4) `targetSocket.disconnect(true)`, (5) compute `remainingCount`/`soloDeadlineAt`, (6) emit `peer_left` to room. Extend `PeerLeftPayload.reason` union to add `"kick"`. | Kicked socket must receive `participant_kicked` — emitting it before leave/disconnect ensures delivery. `peer_left` is then emitted via `io.to(roomId)` after the target has left, so it is naturally excluded. |
| 10 | VP-11.7 | Constraint | After removal: no `socket.on("heartbeat", ...)` registered; no `"heartbeat"` string in `CLIENT_EVENT_NAMES`. `ParticipantRecord.lastSeenAt` is RETAINED, not deleted — it continues to be set at create/join (`roomLifecycle.ts`, unchanged) and is now also refreshed on every `signal_offer`/`signal_answer`/`signal_ice` relay (`signalRelay.ts`) instead of via a dedicated ping. Socket.IO transport-level ping/pong is not touched. Disconnect grace and reconnect flows remain unaffected. Build must be typecheck-clean. | User decision: a dedicated application-layer heartbeat is redundant, but `lastSeenAt` itself stays useful as an activity timestamp — it should track real signaling traffic rather than going stale once the synthetic ping is removed. |
| 11 | VP-11.8 | Constraint | Only `CREATE_RATE_LIMIT_MAX` changes (10 → 30). All other rate-limit logic (`CREATE_ROOM_BURST_THRESHOLD`, `CREATE_ROOM_BLOCK_DURATION_MS`, IP join threshold) is unchanged. VP-11.2 and VP-11.8 interact at subtask 11.2.1: the final exported value must be 30. | Targeted threshold increase; no other rate-limit behavior should shift. |
| 12 | VP-11.2 | Decision | `T3.3-06` (the legacy IP-create-threshold integration test, asserted via a per-socket `fingerprint` connect option) is removed rather than reworked. `CREATE_ROOM_BURST_THRESHOLD` stays IP-keyed only — no `(ip, fingerprint)` keying is added. | Per-socket fingerprinting adds negligible security value for a browser-based, ephemeral service and was never consumed by production code (test-harness-only). The test's premise — that distinct fingerprints bypass the IP-keyed burst layer — was false, making the test invalid rather than merely stale. |

---

## VP-11.1 Rename Solo Timer Constant

### Implementation Matrix

| Subtask | Task | Module / Interface | Detail | Status | Pass Criteria | Evidence Pointer |
|---------|------|--------------------|--------|--------|---------------|-----------------|
| 11.1.1 | Rename constant definition | `shared/policy.ts:6` | Change `export const SOLO_HOST_ROOM_TIMEOUT_MS` to `export const SOLO_ROOM_TIMEOUT_MS`. Value `15 * 60 * 1000` unchanged. | Implemented | `shared/policy.ts` exports `SOLO_ROOM_TIMEOUT_MS`; old name no longer exists. | `shared/policy.ts:6` |
| 11.1.2 | Update contracts.ts re-export | `backend/src/signaling/contracts.ts:60` | Change `SOLO_HOST_ROOM_TIMEOUT_MS` to `SOLO_ROOM_TIMEOUT_MS` in named re-export block. | Implemented | `contracts.ts` re-exports `SOLO_ROOM_TIMEOUT_MS`; no reference to old name remains. | `contracts.ts:60` |
| 11.1.3 | Update all usage sites in registerSocketHandlers.ts | `backend/src/signaling/registerSocketHandlers.ts` lines ~260, 399, 696 | Three call sites reference `signaling.SOLO_HOST_ROOM_TIMEOUT_MS` in `restartSoloTimerIfSolo`, `createRoom` grace policy, and `resume_session` solo timer restart. Change each to `signaling.SOLO_ROOM_TIMEOUT_MS`. | Implemented | All three sites use the new name; application code compiles cleanly. | `registerSocketHandlers.ts:260,399,696` |

### Test Plan

| Test # | Suite | Purpose | Verification Focus | Status |
|--------|-------|---------|-------------------|--------|
| T11.1-01 | build (typecheck) | Test file imports updated exhaustively — no compile error on old symbol | Update test file imports and usages in `soloTimer.integration.test.ts`, `kick.integration.test.ts`, `disconnect.integration.test.ts`, `socket.integration.test.ts`. `tsc -b` in backend exits 0; grep for `SOLO_HOST_ROOM_TIMEOUT_MS` across `**/*.ts` returns 0 matches | Pass |
| T11.1-02 | unit (existing soloTimer suite) | Solo timer still fires at correct deadline after rename | All existing `soloTimer.integration.test.ts` tests pass without modification beyond symbol rename | Pass |
| T11.1-03 | unit (existing kick suite) | Kick solo-timer restart still correct after rename | All existing `kick.integration.test.ts` tests pass | Pass |
| T11.1-04 | unit (existing disconnect suite) | Disconnect solo-timer restart still correct after rename | All existing `disconnect.integration.test.ts` tests pass | Pass |
| T11.1-05 | integration (new — backend soloTimer) | CR11-12 regression: a guest resuming as the sole live participant restarts the solo timer and receives `soloDeadlineAt` (participant-agnostic, per lifecycle.md §1 Rule 8 / §3 — mirrors the `join_room` empty-room path) | Host drops (solo timer armed) → last guest drops (`liveCount` → 0) → guest resumes 5 min later: `room_joined.soloDeadlineAt` = resumeTime + `SOLO_ROOM_TIMEOUT_MS` (numeric, not `null`); room survives past the original deadline and is destroyed only at the fresh deadline with `solo_timeout_expired` | Pass |

---

## VP-11.2 Import Missing Signaling Constants from Spec

### Implementation Matrix

| Subtask | Task | Module / Interface | Detail | Status | Pass Criteria | Evidence Pointer |
|---------|------|--------------------|--------|--------|---------------|-----------------|
| 11.2.1 | Add 5 missing constants to shared/policy.ts | `shared/policy.ts` | Add exports: `SWEEPER_INTERVAL_HOURS = 5`, `JOIN_RATE_LIMIT_WINDOW_MS = 60_000`, `JOIN_RATE_LIMIT_MAX = 30`, `CREATE_RATE_LIMIT_WINDOW_MS = 60_000`, `CREATE_RATE_LIMIT_MAX = 30`. Do NOT add `PARTICIPANT_STALE_MS` or `HEARTBEAT_INTERVAL_MS` (removed by VP-11.7). Place below the existing constants block. | Implemented | All 5 constants exported with their specified values; `tsc -b` passes. | `shared/policy.ts` (after line 11) |
| 11.2.2 | Replace local `CREATE_ATTEMPT_WINDOW_MS` in rateLimiting.ts | `backend/src/signaling/handlers/rateLimiting.ts` | Remove local `const CREATE_ATTEMPT_WINDOW_MS = 60 * 1000`. Import `CREATE_RATE_LIMIT_WINDOW_MS` via `contracts` re-export. Replace all occurrences. Local `CREATE_ROOM_BURST_THRESHOLD` and `CREATE_ROOM_BLOCK_DURATION_MS` remain unchanged. | Implemented | No local `CREATE_ATTEMPT_WINDOW_MS`; call sites use `signaling.CREATE_RATE_LIMIT_WINDOW_MS`; numeric behavior unchanged (60000). | `rateLimiting.ts` |
| 11.2.3 | Replace local `IP_ABUSE_WINDOW_MS` in rateLimiting.ts | `backend/src/signaling/handlers/rateLimiting.ts` | Remove `const IP_ABUSE_WINDOW_MS = 60 * 1000`. Replace all usages with `signaling.JOIN_RATE_LIMIT_WINDOW_MS`. | Implemented | No local `IP_ABUSE_WINDOW_MS`; numeric value unchanged (60000). | `rateLimiting.ts` |
| 11.2.4 | Replace local `IP_JOIN_THRESHOLD` in rateLimiting.ts | `backend/src/signaling/handlers/rateLimiting.ts` | Remove `const IP_JOIN_THRESHOLD = 30`. Replace with `signaling.JOIN_RATE_LIMIT_MAX`. | Implemented | No local `IP_JOIN_THRESHOLD`; numeric value unchanged (30). | `rateLimiting.ts` |
| 11.2.5 | Replace local `IP_CREATE_THRESHOLD` in rateLimiting.ts | `backend/src/signaling/handlers/rateLimiting.ts` | Remove `const IP_CREATE_THRESHOLD = 10`. Replace with `signaling.CREATE_RATE_LIMIT_MAX`. | Implemented | No local `IP_CREATE_THRESHOLD`; effective value is 30 (per VP-11.8). | `rateLimiting.ts` |
| 11.2.6 | Replace `DEFAULT_SWEEP_INTERVAL_MS` in registerSocketHandlers.ts | `backend/src/signaling/registerSocketHandlers.ts:54` | Replace `const DEFAULT_SWEEP_INTERVAL_MS = 5 * 60 * 60 * 1000` with a derivation from `signaling.SWEEPER_INTERVAL_HOURS * 60 * 60 * 1000`. | Implemented | No hardcoded `5 * 60 * 60 * 1000` for sweep; value sources from shared constant; sweep interval unchanged (18000000 ms). | `registerSocketHandlers.ts:54` |
| 11.2.7 | Re-export new constants via contracts.ts | `backend/src/signaling/contracts.ts` | Add all 5 constants to the named re-export block so backend handlers can import via `signaling.*`. | Implemented | All 5 constants accessible via `signaling.*`; typecheck passes. | `contracts.ts` re-export block |

### Test Plan

| Test # | Suite | Purpose | Verification Focus | Status |
|--------|-------|---------|-------------------|--------|
| T11.2-01 | unit (new) | Shared constants have exactly the spec-mandated values | Import each of the 5 constants from `@shared`; assert exact equality against spec values (`SWEEPER_INTERVAL_HOURS=5`, `JOIN_RATE_LIMIT_WINDOW_MS=60000`, `JOIN_RATE_LIMIT_MAX=30`, `CREATE_RATE_LIMIT_WINDOW_MS=60000`, `CREATE_RATE_LIMIT_MAX=30`) | Pass |
| T11.2-02 | build (typecheck) | No local shadowing of replaced constants remains | `tsc -b` backend exits 0; grep for `IP_ABUSE_WINDOW_MS`, `IP_JOIN_THRESHOLD`, `IP_CREATE_THRESHOLD`, `CREATE_ATTEMPT_WINDOW_MS` in `rateLimiting.ts` returns 0 matches | Pass |
| T11.2-03 | integration (existing) | Rate limiting behavior unchanged after constant-source switch | All existing rate-limit tests covering `RATE_LIMITED` responses still pass | Pass — `T3.3-06` removed as invalid (see Constraints & Decisions #12); remaining rate-limit tests pass |
| T11.2-04 | integration (existing) | Sweeper interval still fires at 5 hours | Existing sweeper tests pass; `DEFAULT_SWEEP_INTERVAL_MS` derived from `SWEEPER_INTERVAL_HOURS` equals 18000000 ms | Pass |

---

## VP-11.4 Fix Guest Grace Participant Count

### Implementation Matrix

| Subtask | Task | Module / Interface | Detail | Status | Pass Criteria | Evidence Pointer |
|---------|------|--------------------|--------|--------|---------------|-----------------|
| 11.4.1 | Remove destroy branch from `handleGuestGraceExpired`; reduce to sentinel cleanup only | `backend/src/signaling/registerSocketHandlers.ts:281–308` | After `activeRoom.participants.delete(participantId)`, drop nickname mapping, and clear reconnect record. Remove the `liveCount === 0` destroy branch (the `clearRoomArtifacts` + `state.rooms.delete` block and the `incrementRoomDestroyed("host_grace_expired")` call). Add explanatory comment that the solo timer owns empty-room destruction. No `peer_left` is emitted from this path. | Implemented | `handleGuestGraceExpired` performs only participant/nickname/reconnect cleanup. No `destroyRoom` or metric increment on guest-grace expiry. Solo timer remains the sole empty-room destroy path (`solo_timeout_expired`). | `registerSocketHandlers.ts:281–308` |

### Test Plan

| Test # | Suite | Purpose | Verification Focus | Status |
|--------|-------|---------|-------------------|--------|
| T11.4-01 | integration (new — backend) | Grace expiry with another participant still in grace: room not destroyed | Host + G1 + G2 room. G1 disconnects (grace). G2 disconnects (grace). G1 grace expires. Assert: room still exists; `getLiveParticipantCount` returns 1 (host live); `participants.size` = 2 (host + G2 sentinel); no `room_destroyed` emitted. | Pass |
| T11.4-02 | integration (new — backend) | Guest-grace expiry is sentinel cleanup only; solo timer subsequently destroys the room | Host + G1. Host disconnects (host-grace sentinel). G1 disconnects (guest-grace sentinel, `liveCount === 0`). Fire guest-grace timer → assert room **survives** (sentinel cleanup only, no `destroyRoom`). Fire `SOLO_ROOM_TIMEOUT_MS` timer (armed when host disconnected) → assert room destroyed with reason `solo_timeout_expired`. | Pass |
| T11.4-03 | integration (new — backend) | Grace expiry with host still live: room not destroyed, live count correct | Host + G1. G1 disconnects (grace). G1 grace expires. Assert: room still exists; `getLiveParticipantCount` returns 1 (host only). | Pass |
| T11.4-04 | integration (new — backend) | CR11-13: a grace-held reserved nickname cannot be claimed by a new joiner (lifecycle.md §1 Rule 6); the holder reclaims it on resume | Host creates room as "Alice" (keeps reconnect token). Host TCP-drops → host sentinel, empty room (liveCount 0), "alice" reserved. A guest joins the empty room choosing "Alice". Assert: join rejected with `INVALID_SIGNAL_PAYLOAD`; no `room_joined`; host sentinel + participantCount (1) untouched. Host `resume_session` with original token → succeeds, `participantNickname === "Alice"`. Guards against the host-lockout eviction bug. | Implemented |

---

## VP-11.5 Remove Off-Contract Nickname-Update Feature

### Implementation Matrix

| Subtask | Task | Module / Interface | Detail | Status | Pass Criteria | Evidence Pointer |
|---------|------|--------------------|--------|--------|---------------|-----------------|
| 11.5.1 | Remove `NICKNAME_CHANGE_COOLDOWN_MS` from shared/policy.ts | `shared/policy.ts:11` | Delete the export. | Implemented | `shared/policy.ts` no longer exports `NICKNAME_CHANGE_COOLDOWN_MS`. | `shared/policy.ts:11` |
| 11.5.2 | Remove `NICKNAME_UPDATE` from CLIENT_EVENT_NAMES | `shared/events.ts` | Delete `NICKNAME_UPDATE: "nickname_update"` entry. | Implemented | `CLIENT_EVENT_NAMES.NICKNAME_UPDATE` does not exist; no `"nickname_update"` string in events.ts. | `shared/events.ts` |
| 11.5.3 | Remove `NICKNAME_UPDATED` from SERVER_EVENT_NAMES | `shared/events.ts` | Delete `NICKNAME_UPDATED: "nickname_updated"` entry. | Implemented | `SERVER_EVENT_NAMES.NICKNAME_UPDATED` does not exist. | `shared/events.ts` |
| 11.5.4 | Remove payload types from shared/payloads.ts | `shared/payloads.ts` | Delete `NicknameUpdatePayload` and `NicknameUpdatedPayload` type declarations. | Implemented | Neither type exists in `shared/payloads.ts`. | `shared/payloads.ts` |
| 11.5.5 | Remove nickname-update entries from contracts.ts | `backend/src/signaling/contracts.ts` | Remove `nicknameUpdate` from `CLIENT_EVENTS`. Remove `nicknameUpdated` from `SERVER_EVENTS`. Remove `NICKNAME_CHANGE_COOLDOWN_MS` from re-exports. Remove `NicknameUpdatePayload` and `NicknameUpdatedPayload` from type re-exports. | Implemented | `contracts.ts` has no reference to any nickname-update symbol. | `contracts.ts` |
| 11.5.6 | Remove handler and `nicknameUpdatedAt` writes from registerSocketHandlers.ts | `backend/src/signaling/registerSocketHandlers.ts` | Delete entire `socket.on(signaling.CLIENT_EVENTS.nicknameUpdate, ...)` handler block (~lines 780–839). Remove `participant.nicknameUpdatedAt = ...` assignment lines in createRoom and joinRoom paths. Remove `NicknameUpdatePayload` and `NicknameUpdatedPayload` from imports. | Implemented | No `socket.on` for `nickname_update`; no `nicknameUpdatedAt` assignments; typecheck clean. | `registerSocketHandlers.ts:780-839` |
| 11.5.7 | Remove `nicknameUpdatedAt` from ParticipantRecord | `backend/src/signaling/state.ts` | Delete `nicknameUpdatedAt?: number` field. | Implemented | `ParticipantRecord` has no `nicknameUpdatedAt` field; backend typecheck passes. | `state.ts` |
| 11.5.8 | Remove nickname-update wiring from frontend types.ts | `frontend/src/features/room/types.ts` | Remove `NicknameUpdatedPayload` import. Remove `NicknameUpdatedPayload` type alias. Remove `NICKNAME_UPDATED` from `SERVER_EVENTS`. Remove `onNicknameUpdated`/`offNicknameUpdated` from `RoomSocketClient` interface. | Implemented | No nickname-update symbols remain in `types.ts`. | `types.ts` |
| 11.5.9 | Remove nickname-update wiring from room-socket-client.ts | `frontend/src/features/room/room-socket-client.ts` | Remove `NicknameUpdatedPayload` import. Remove `onNicknameUpdated` handler registration. Remove `offNicknameUpdated` deregistration. | Implemented | `room-socket-client.ts` has no nickname-update references; typecheck clean. | `room-socket-client.ts` |
| 11.5.10 | Remove nickname-update wiring from useSocketConnection.ts | `frontend/src/features/room/hooks/useSocketConnection.ts` | Remove `NicknameUpdatedPayload` import. Remove `onNicknameUpdated` from `SocketEventHandlers` type. Remove local wrapper and registration/deregistration calls. | Implemented | `useSocketConnection.ts` has no nickname-update references; `SocketEventHandlers` type has no `onNicknameUpdated`. | `useSocketConnection.ts` |
| 11.5.11 | Remove nickname-update handler from useVaporRoom.ts | `frontend/src/features/room/useVaporRoom.ts` | Remove `withNicknameUpdated` import. Remove `NicknameUpdatedPayload` import. Remove `onNicknameUpdated` useCallback definition. Remove `socket.onNicknameUpdated(onNicknameUpdated)` call inside `onRoomJoined`. Remove `onNicknameUpdated` from handlers object passed to `useSocketConnection`. | Implemented | `useVaporRoom.ts` has no `onNicknameUpdated` callback or related imports; typecheck passes. | `useVaporRoom.ts` |
| 11.5.12 | Remove `withNicknameUpdated` from state-utils.ts | `frontend/src/features/room/state-utils.ts` | Delete `withNicknameUpdated` function and its `NicknameUpdatedPayload` import. | Implemented | `state-utils.ts` exports no `withNicknameUpdated`; typecheck passes. | `state-utils.ts` |
| 11.5.13 | Build typecheck verification | Root | Run `npm run typecheck` in both `backend/` and `frontend/`. | Implemented | Frontend: clean. Backend: 4 pre-existing VP-11.1 errors (`SOLO_HOST_ROOM_TIMEOUT_MS` in test files); all VP-11.5 symbols removed. | Typecheck output |

### Test Plan

| Test # | Suite | Purpose | Verification Focus | Status |
|--------|-------|---------|-------------------|--------|
| T11.5-01 | build (typecheck) | Full typecheck clean after all removals | `npm run typecheck` in both workspaces exits 0; grep for `nickname_update`, `nickname_updated`, `nicknameUpdated`, `NICKNAME_CHANGE_COOLDOWN_MS`, `withNicknameUpdated`, `onNicknameUpdated`, `offNicknameUpdated`, `nicknameUpdatedAt` returns 0 matches | Pass |
| T11.5-02 | integration (existing backend) | Emitting `nickname_update` is silently ignored — no handler registered | Sending `nickname_update` event produces no server response; existing test suite passes | Pass |
| T11.5-03 | integration (existing backend) | Nickname validation at join/create preserved | Existing `createRoom`/`joinRoom` tests with valid and invalid nicknames still pass unchanged | Pass |
| T11.5-04 | build (lint) | `npm run lint` in frontend exits 0 | No unused-import warnings or exhaustive-deps warnings for removed symbols | Pass |

---

## VP-11.6 Fix Kick Reason & Socket Removal Order

### Implementation Matrix

| Subtask | Task | Module / Interface | Detail | Status | Pass Criteria | Evidence Pointer |
|---------|------|--------------------|--------|--------|---------------|-----------------|
| 11.6.1 | Extend `PeerLeftPayload.reason` union | `shared/payloads.ts` | Change `reason: "disconnect" \| "leave"` to `reason: "disconnect" \| "leave" \| "kick"`. | Implemented | `PeerLeftPayload.reason` accepts `"kick"` without type error. | `shared/payloads.ts:104` |
| 11.6.2 | Reorder kick handler: remove socket from room before broadcasts | `backend/src/signaling/registerSocketHandlers.ts` kick handler | New order: (1) emit `participant_kicked` to room (target still present, so it learns of its own kick), (2) state cleanup (existing participant map removals — unchanged), (3) `targetSocket.leave(roomId)`, (4) `targetSocket.disconnect(true)`, (5) compute `remainingCount` and `soloDeadlineAt`, (6) `io.to(roomId).emit(peer_left)`. Deviates from the originally planned step order (which placed `participant_kicked` after leave/disconnect) because that ordering would also exclude the target from `participant_kicked`, contradicting the pass criteria below. | Implemented | Kicked socket does not receive `peer_left` about itself, but does receive `participant_kicked`. Solo timer fires correctly (unchanged). | `registerSocketHandlers.ts:756-832` |
| 11.6.3 | Change `peer_left` reason to `"kick"` in kick handler | `backend/src/signaling/registerSocketHandlers.ts` | Change `reason: "leave"` to `reason: "kick"` in `peerLeftPayload` construction. | Implemented | `peer_left` emitted from kick path carries `reason: "kick"`. | `registerSocketHandlers.ts:826` |
| 11.6.4 | Update frontend `onPeerLeft` for `reason === 'kick'` | `frontend/src/features/room/useVaporRoom.ts` | Change `payload.reason === 'disconnect' ? 'disconnected' : 'left'` to a three-way expression: `payload.reason === 'disconnect' ? 'disconnected' : payload.reason === 'kick' ? 'was removed' : 'left'`. | Implemented | `peer_left` with `reason: "kick"` renders `"[name] was removed"` system message. Existing "disconnected" and "left" messages unchanged. | `useVaporRoom.ts:350` |

### Test Plan

| Test # | Suite | Purpose | Verification Focus | Status |
|--------|-------|---------|-------------------|--------|
| T11.6-01 | integration (new — backend) | Kicked socket does not receive `peer_left` about itself | Host + Guest. Host kicks Guest. Assert: Guest receives `participant_kicked` with its own id; Guest does NOT receive any `peer_left`; Host receives `peer_left` with `reason: "kick"`. | Pass |
| T11.6-02 | integration (new — backend) | `participant_kicked` arrives before `peer_left` on remaining participants | Host + Guest1 + Guest2. Host kicks Guest1. Assert: Guest2 receives `participant_kicked` before `peer_left` in event queue. | Pass |
| T11.6-03 | integration (new — backend) | `peer_left` from kick carries `reason: "kick"` | Host + Guest1 + Guest2. Host kicks Guest1. Assert: Guest2 receives `peer_left` with `reason: "kick"` and Guest1's `participantId`. | Pass |
| T11.6-04 | integration (existing) | Solo timer still restarts correctly after kick | Existing `kick.integration.test.ts` solo timer tests pass; update any `reason` field assertions if needed | Pass |
| T11.6-05 | unit (frontend) | `onPeerLeft` renders "was removed" for `reason: "kick"` | Provide `PeerLeftPayload` with `reason: "kick"` to handler; assert system message contains "was removed" | Pass |
| T11.6-06 | unit (frontend) | `onPeerLeft` "disconnected" / "left" unchanged for existing reasons | `reason: "disconnect"` → "disconnected"; `reason: "leave"` → "left"; no regression | Pass |

---

## VP-11.7 Drop Heartbeat Mechanism

### Implementation Matrix

| Subtask | Task | Module / Interface | Detail | Status | Pass Criteria | Evidence Pointer |
|---------|------|--------------------|--------|--------|---------------|-----------------|
| 11.7.1 | Remove heartbeat server handler | `backend/src/signaling/registerSocketHandlers.ts:325-335` | Delete the `socket.on("heartbeat", ...)` handler block. | Implemented | No heartbeat socket handler registered in server; typecheck passes. | `registerSocketHandlers.ts:325-335` |
| 11.7.2 | Move `lastSeenAt` refresh into signal relay | `backend/src/signaling/handlers/signalRelay.ts` | `ParticipantRecord.lastSeenAt` is RETAINED (not deleted). Add a `now: () => number` parameter to `resolveSignalRoute` (and thread it through `handleSignalOffer`, `handleSignalAnswer`, `handleSignalIce`). After a route resolves successfully, set `room.participants.get(route.fromParticipantId)!.lastSeenAt = now()`. Update the three call sites in `registerSocketHandlers.ts` (~lines 565–589) to pass the existing injected `now`. | Implemented | `lastSeenAt` updates on every successful offer/answer/ice relay from that participant; no update on a route that fails validation (room/participant not found). Note: the stamp occurs at route-resolution time, before per-handler SDP/candidate payload normalization — a valid-route/invalid-payload signal will still advance `lastSeenAt`. Typecheck passes. | `signalRelay.ts:96`, `registerSocketHandlers.ts:553-577` |
| 11.7.3 | No change to `roomLifecycle.ts` | `backend/src/signaling/roomLifecycle.ts:32,67` | `lastSeenAt: now` initializations in `hostRecord`/`participantRecord` stay as-is — confirm they are NOT removed. | Implemented | `roomLifecycle.ts` still sets `lastSeenAt` at create/join; no diff in this file for VP-11.7. | `roomLifecycle.ts:32,67` |
| 11.7.4 | Remove `HEARTBEAT` from `CLIENT_EVENT_NAMES` | `shared/events.ts` | Delete the `HEARTBEAT: "heartbeat"` entry from `CLIENT_EVENT_NAMES` (if present). | Implemented | `CLIENT_EVENT_NAMES` had no `HEARTBEAT` key — no-op confirmed. | `shared/events.ts` |
| 11.7.5 | Remove heartbeat re-export from `contracts.ts` | `backend/src/signaling/contracts.ts` | Remove any re-export of `heartbeat` or `HEARTBEAT` from `CLIENT_EVENTS` (if present). | Implemented | `contracts.ts` had no heartbeat-related reference — no-op confirmed. | `contracts.ts` |
| 11.7.6 | Build typecheck verification | Root | Run `npm run typecheck` in both `backend/` and `frontend/`. Grep for `heartbeat`, `HEARTBEAT_INTERVAL_MS`, `PARTICIPANT_STALE_MS` across `**/*.ts` (0 matches expected). Grep for `lastSeenAt` and confirm it still exists in `state.ts`, `roomLifecycle.ts`, and `signalRelay.ts` only. | Implemented | `tsc -b` exits clean (only 4 pre-existing VP-11.1 test errors); heartbeat greps return 0 matches; `lastSeenAt` present only in `state.ts`, `roomLifecycle.ts:32,67`, `signalRelay.ts:96`. | Typecheck output |

### Test Plan

| Test # | Suite | Purpose | Verification Focus | Status |
|--------|-------|---------|-------------------|--------|
| T11.7-01 | build (typecheck) | Heartbeat removal is exhaustive; `lastSeenAt` retained | `tsc -b` exits 0 in both workspaces; grep for `heartbeat`, `HEARTBEAT_INTERVAL_MS`, `PARTICIPANT_STALE_MS` across `**/*.ts` returns 0 matches; `lastSeenAt` still present in `state.ts`/`roomLifecycle.ts`/`signalRelay.ts` | Pass |
| T11.7-02 | integration (modify existing) | Existing T3.1-01 heartbeat test deleted from suite | Delete `T3.1-01` from `socket.integration.test.ts` — it tests behavior that no longer exists; confirm no test references the removed heartbeat handler | Pass |
| T11.7-04 | integration (new) | `lastSeenAt` refreshes on signaling activity | Join a room, capture initial `lastSeenAt`, advance the injected clock, send `signal_offer` (or answer/ice); assert the participant's `lastSeenAt` advances to the new clock value | Pass |

---

## VP-11.8 Raise IP Create Rate Limit Threshold

### Implementation Matrix

| Subtask | Task | Module / Interface | Detail | Status | Pass Criteria | Evidence Pointer |
|---------|------|--------------------|--------|--------|---------------|-----------------|
| 11.8.1 | Set `CREATE_RATE_LIMIT_MAX = 30` in `shared/policy.ts` | `shared/policy.ts` | VP-11.2 subtask 11.2.1 exports `CREATE_RATE_LIMIT_MAX`. The value must be `30`. If VP-11.2 runs first, set to `30` directly; executed together, combine into one step. | Implemented | `CREATE_RATE_LIMIT_MAX` is exported as `30` from `shared/policy.ts`. | `shared/policy.ts:15` |
| 11.8.2 | Confirm pass-through in `rateLimiting.ts` | `backend/src/signaling/handlers/rateLimiting.ts:46` | After VP-11.2 replaces local `IP_CREATE_THRESHOLD` with `signaling.CREATE_RATE_LIMIT_MAX`, verify the IP create check at line ~96 enforces 30. No local `IP_CREATE_THRESHOLD` constant should remain. | Implemented | `checkAndRecordCreateAttempt` enforces 30-create-per-minute IP ceiling via `signaling.CREATE_RATE_LIMIT_MAX`. | `rateLimiting.ts:46` |

### Test Plan

| Test # | Suite | Purpose | Verification Focus | Status |
|--------|-------|---------|-------------------|--------|
| T11.8-01 | unit (new) | `CREATE_RATE_LIMIT_MAX` constant equals 30 | Import `CREATE_RATE_LIMIT_MAX` from `@shared`; assert value equals 30 | Pass |
| T11.8-02 | unit (new) | IP create block triggers at 31st attempt, not 11th | Call `checkAndRecordCreateAttempt` directly with pre-populated context (createCount=10); assert 11th attempt is not blocked; reset with createCount=30; assert 31st is rate-limited | Pass |
