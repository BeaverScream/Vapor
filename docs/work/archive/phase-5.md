# Phase 5 Work Detail - Vapor Refactoring Plan

**Date:** 2026-06-04

---

## Executive Summary

The overall architecture is sound: RAM-only state, clear signaling contract, separated layers. The problem is concentrated in two files that were grown incrementally through four phases and never trimmed:

| File | Lines | Distinct Concerns | Verdict |
|---|---|---|---|
| `backend/src/signaling/registerSocketHandlers.ts` | 1,582 | 10+ | Refactor — extract subsystems |
| `frontend/src/features/room/useVaporRoom.ts` | 820 | 12+ | Refactor — decompose into hooks |
| All other files | — | 1–2 | Keep as-is |

---

## Part 1 — Backend

### Problem: `registerSocketHandlers.ts` is a God File

The file manages 10+ independent subsystems, defines 11 state Maps inline (should be in `state.ts`), duplicates logic in at least 5 patterns, and has callback handlers nested 5+ levels deep.

**11 inline Maps that belong in `state.ts` or a dedicated module:**
- `roomAuthById`, `roomPolicyById`
- `joinAttemptByRoomSubject`, `createAttemptsBySubject`, `temporaryBlocklistBySubject`
- `reconnectByHash`, `reconnectTokenByParticipant`
- `guestGraceByParticipant`, `disconnectedParticipants`
- `roomLockChains`
- `ipAbuseByIp`

**Duplicated patterns (examples):**
- Blank-password validation: written identically in `createRoom` and `joinRoom`
- IP abuse record initialization: same pattern in `createRoom` and `joinRoom`
- Nickname assignment after create/join: two copies of the same 3-line block
- Room-not-found guard: 5+ locations
- Participant resolution: 3+ locations

---

### Proposed Backend File Structure

```
backend/src/signaling/
├── state.ts                   # EXTEND: add all 11 inline Maps here
├── roomLifecycle.ts           # keep as-is
├── contracts.ts               # keep as-is
├── registerSocketHandlers.ts  # SHRINK: thin orchestrator only
│
└── handlers/                  # NEW directory — extracted subsystems
    ├── rateLimiting.ts        # create/join throttling, IP abuse, blocklist
    ├── passwordAuth.ts        # Argon2id hash/verify, normalizePassword, roomAuthById ops
    ├── reconnectionManager.ts # token upsert, grace period marking, token validation
    ├── graceWindowManager.ts  # host grace timer, guest grace timer, room destruction on expiry
    └── signalRelay.ts         # resolveSignalRoute, offer/answer/ICE relay logic
```

---

### Extraction Details

#### 1. `handlers/rateLimiting.ts`

Move from `registerSocketHandlers.ts`:

- Maps: `createAttemptsBySubject`, `temporaryBlocklistBySubject`, `ipAbuseByIp`, `joinAttemptByRoomSubject`
- Functions: `checkAndRecordCreateAttempt(subject, ip)`, `checkAndRecordJoinAttempt(ip)`, `checkPasswordAttempt(roomId, subject)`, `sweepExpiredRateLimitRecords()`
- Constants: `CREATE_ROOM_BURST_THRESHOLD`, `IP_CREATE_THRESHOLD`, `IP_JOIN_THRESHOLD`, window sizes

Callers in `registerSocketHandlers.ts` replace the inline blocks with a single function call.

**Result:** Implemented with one structural deviation. Instead of moving the Maps as standalone variables, they are grouped into a `RateLimitingContext` object managed by `createRateLimitingContext()`. The orchestrator holds one `rateLimitCtx` reference and passes it into each call. This avoids 4 separate module-level imports per subsystem and makes the ownership boundary explicit. All planned functions were extracted, with refined names: `checkAndRecordJoinAttempt` became `checkAndRecordJoinIp`, and `checkPasswordAttempt` became `getJoinAttemptStatus` + `recordInvalidPasswordAttempt` (split to separate read from write). `sweepExpiredRateLimitRecords` became `sweepRateLimitRecords`. Final size: 220 lines.

#### 2. `handlers/passwordAuth.ts`

Move from `registerSocketHandlers.ts`:

- Map: `roomAuthById`
- Functions: `normalizePassword()`, `buildPepperedPassword()`, `hashPassword()`, `verifyPassword()`, `setRoomPassword(roomId, password)`, `getRoomAuth(roomId)`, `deleteRoomAuth(roomId)`

Currently the password logic spans ~178 lines (lines 86–264) mixed with map declarations and event handler setup. Extracted, it becomes a clean module with 5 pure functions and one Map.

**Result:** Implemented with the same context-object pattern as rateLimiting — `roomAuthById` lives inside a `PasswordAuthContext` created by `createPasswordAuthContext()`. `setRoomPassword` was split into `initRoomAuth` (create path) and `rotateRoomPassword` (update path) to reflect their different return contracts. `buildPepperedPassword` remains a private helper; `hashPassword` and `verifyPassword` are the public crypto surface. Final size: 116 lines.

#### 3. `handlers/reconnectionManager.ts`

Move from `registerSocketHandlers.ts`:

- Maps: `reconnectByHash`, `reconnectTokenByParticipant`, `disconnectedParticipants`
- Functions: `upsertReconnectToken()`, `markReconnectDisconnected()`, `validateAndConsumeToken()`, `sweepExpiredTokens()`
- The `resumeSession` event handler body (currently ~95 lines, lines 1105–1199) moves here as `handleResumeSession(socket, payload, state)`

**Result:** Maps and core functions were extracted using the same context-object pattern (`ReconnectContext`). `validateAndConsumeToken` was not extracted as a standalone function — token validation logic remains inline inside the `resumeSession` handler in the orchestrator, since it needed cross-context coordination (rateLimitCtx, authCtx) that would have required passing many arguments. `sweepExpiredTokens` became `sweepExpiredReconnectTokens`. The `handleResumeSession` extraction was also skipped; the resume handler body stays in the orchestrator calling the context-level helpers. Final size: 113 lines.

#### 4. `handlers/graceWindowManager.ts`

Move from `registerSocketHandlers.ts`:

- Maps: `guestGraceByParticipant`
- Timer refs: `soloHostTimeoutRef`, `hostGraceTimeoutRef`, `roomTtlTimeoutRef`
- Functions: `startHostGrace(roomId)`, `cancelHostGrace(roomId)`, `startGuestGrace(participantId, roomId)`, `cancelGuestGrace(participantId)`, `clearAllRoomTimers(roomId)`
- The deeply-nested guest grace callback (currently 5+ levels deep, lines 596–642) gets rewritten flat here

**Result:** Implemented with the context-object pattern (`GraceWindowContext`). Timer refs moved into per-record structs (`RoomPolicyRecord`, `GuestGraceRecord`) rather than standalone Maps, which co-locates each timer with its associated state. Function names were refined: `clearAllRoomTimers` became `clearRoomPolicyTimers`, `startHostGrace` became `beginHostGrace`, `startGuestGrace` became `beginGuestGrace`, `cancelGuestGrace` became `clearGuestGrace`. The deeply-nested guest grace callback was flattened into a named `handleGuestGraceExpired(participantId, roomId)` function in the orchestrator, with the module providing `beginGuestGrace` that accepts an `onExpired` callback. Final size: 124 lines.

#### 5. `handlers/signalRelay.ts`

Move from `registerSocketHandlers.ts`:

- Function: `resolveSignalRoute(fromSocketId, targetParticipantId, state)` (currently lines 668–684)
- Handlers: `handleSignalOffer`, `handleSignalAnswer`, `handleSignalIce`
- Payload validation helpers

**Result:** Implemented as planned. Payload normalizers (`normalizeSignalSdp`, `normalizeSignalCandidate`) and `resolveSignalRoute` were extracted as pure functions. The three relay handlers (`handleSignalOffer`, `handleSignalAnswer`, `handleSignalIce`) accept emitter callbacks (`emitNotFound`, `emitInvalidPayload`) rather than importing socket emit helpers, keeping the module free of orchestrator dependencies. Final size: 178 lines.

#### 6. Extend `state.ts`

Add the 11 inline Maps (currently defined in registerSocketHandlers.ts lines 323–333) to the `Phase0SignalingState` type and the `createPhase0State()` factory. The state snapshot function should include them for admin metrics.

**Result:** Not implemented. Instead of extending `state.ts`, all 11 Maps were distributed into the four context objects (`PasswordAuthContext`, `RateLimitingContext`, `ReconnectContext`, `GraceWindowContext`) defined in their respective handler modules. `state.ts` remains unchanged. `roomLockChains` stays as a local `Map` in the orchestrator. This approach was chosen because grouping Maps with their owning logic (in handler modules) is a stronger cohesion boundary than co-locating all Maps in a shared state file that the modules would still need to import back from the orchestrator.

#### 7. `registerSocketHandlers.ts` after refactor

Becomes a thin orchestrator (~300 lines) that:
- Imports the 5 subsystem modules
- Registers socket event listeners
- Calls subsystem functions from each handler
- Contains no Map definitions, no password logic, no timer logic

**Result:** Implemented as planned in structure, but the line count target was not met. Final size is 892 lines (vs. the estimated ~300). The gap is because several things were not extracted as the plan assumed: the full `resumeSession` handler body (~90 lines) stayed inline, all per-event handler bodies stayed inline rather than being further delegated, and the four context factory calls + their wiring add lines the estimate didn't account for. The file no longer contains password crypto, timer scheduling logic, or signal route resolution — those concerns are fully delegated — but it still contains all the conditional branching and state coordination for each socket event. It is not a thin 300-line file, but it is meaningfully reduced from 1,582 lines and no longer a god file by concern count.

---

### Estimated Impact

| Metric | Before | Estimated | Actual |
|---|---|---|---|
| `registerSocketHandlers.ts` lines | 1,582 | ~300 | 892 |
| New focused modules | 0 | 5 | 5 |
| Code duplication instances | 5+ | 0 | 0 |
| Max nesting depth | 5 | 2–3 | 2–3 |

---

## Part 2 — Frontend

### Problem: `useVaporRoom.ts` Violates SRP

The hook manages 12+ concerns. The most severe concrete problems:

1. **Cleanup sequence duplicated 4×** (lines 437–448, 461–475, 664–684, 687–703) — ~56 duplicated lines. A new cleanup path added in the future will be missed in 1–3 of the 4 locations.

2. **220-line `useEffect`** (lines 330–549) sets up all socket event listeners in one block. Finding and modifying any single event handler requires scanning 220 lines.

3. **Typing indicator logic scattered across 9 locations** — debounce timer, safety timeouts map, send/receive handlers, and cleanup all written separately in different functions.

4. **Rate limit state in 6 separate locations** — a single logical feature (join rate limiting) has its state, computation, timers, and validation spread across the whole file.

---

### Proposed Frontend File Structure

```
frontend/src/features/room/
├── useVaporRoom.ts            # SHRINK: thin orchestrator, composes hooks
├── webrtc-chat-mesh.ts        # keep as-is (already cohesive)
├── room-socket-client.ts      # keep as-is
├── types.ts                   # keep as-is
├── state-utils.ts             # keep as-is
├── RoomView.tsx               # keep as-is
├── LobbyView.tsx              # keep as-is
├── constants.ts               # keep as-is
├── participant-utils.ts       # keep as-is
├── error-copy.ts              # keep as-is
│
└── hooks/                     # NEW directory — extracted hooks
    ├── useSocketConnection.ts  # socket setup/teardown, event listener registration
    ├── useJoinRateLimit.ts     # rate limit state, countdown, expiration
    ├── useTypingIndicator.ts   # debounce, safety timeouts, send/receive, cleanup
    ├── useChatMessaging.ts     # pending queue, flush, send/receive coordination
    └── useSessionPersistence.ts # session storage read/write/clear
```

---

### Extraction Details

#### 1. `hooks/useSessionPersistence.ts`

Extract from `useVaporRoom.ts` lines 68–114:

```typescript
export function useSessionPersistence() {
  return {
    readStoredReconnectSession,
    writeStoredReconnectSession,
    clearStoredReconnectSession,
  }
}
```

Simplest extraction — three pure functions with no React state. Removes 47 lines from `useVaporRoom.ts`.

**Result:** Implemented as planned. The three functions are module-level (not inside the hook body), so their references are stable without `useCallback`. The hook wrapper just bundles them for consistent import style. Final size: 58 lines.

#### 2. `hooks/useJoinRateLimit.ts`

Extract from `useVaporRoom.ts`:
- Lines 223: `rateLimitTick` state
- Lines 316–322: `joinRateLimitRemainingMs` computation
- Lines 324–328: `isJoinRateLimited` computation
- Lines 551–563: countdown timer `useEffect`
- Lines 565–571: expiration check `useEffect`

```typescript
export function useJoinRateLimit(state: RoomSessionState) {
  const [tick, setTick] = useState(0)
  // ... countdown + expiration effects
  return { joinRateLimitRemainingMs, isJoinRateLimited }
}
```

Removes ~40 lines and 2 `useEffect`s from `useVaporRoom.ts`.

**Result:** Implemented with a signature change. The plan showed `useJoinRateLimit(state)`, but the actual signature is `useJoinRateLimit(state, setState)` — `setState` is needed because the expiration `useEffect` calls `setState(withJoinRateLimitCleared(...))` to clear stale rate limit state. The plan's signature omitted this dependency. Final size: 40 lines.

#### 3. `hooks/useTypingIndicator.ts`

Extract from `useVaporRoom.ts` (9 scattered locations):
- `typingDebounceRef`, `typingSafetyTimeoutsRef`
- `onRemoteTypingStatus` handler (lines 266–284)
- `notifyTypingStart` callback (lines 712–726)
- `notifyTypingStop` callback (lines 728–734)
- `clearAllTypingTimeouts` utility used in all 4 cleanup locations
- Auto-stop typing on `sendChatMessage` (lines 743–747)

```typescript
export function useTypingIndicator(socket: RoomSocketClient | null) {
  // consolidated debounce + safety timeouts
  return {
    notifyTypingStart,
    notifyTypingStop,
    onRemoteTypingStatus,
    clearAll,   // called during room cleanup
  }
}
```

Removes ~80 lines from `useVaporRoom.ts`. Eliminates the 9-location scatter.

**Result:** Implemented with a signature change. The plan showed `useTypingIndicator(socket)`, but the actual signature is `useTypingIndicator(peerMeshRef, setState)`. Typing notifications are sent via the WebRTC peer mesh (`peerMeshRef.current.sendTypingStart/Stop()`), not the signaling socket, so `socket` was the wrong dependency. `setState` is needed for `onRemoteTypingStatus` to update the typing indicator set. The `typingDebounceRef` and `typingSafetyTimeoutsRef` are returned alongside the callbacks so `useChatMessaging` can access the debounce ref directly. Final size: 82 lines.

#### 4. `hooks/useChatMessaging.ts`

Extract from `useVaporRoom.ts`:
- `pendingMessagesRef`, `flushPendingRef`
- `flushPendingMessages` callback (lines 647–662)
- `sendChatMessage` callback (lines 736–769)
- `onRemoteMessage` handler in `createPeerMesh` (lines 249–265)

```typescript
export function useChatMessaging(peerMeshRef, socketRef, setState) {
  return {
    sendChatMessage,
    flushPendingMessages,
    onRemoteMessage,
    clearPending,  // for cleanup
  }
}
```

Removes ~70 lines from `useVaporRoom.ts`. Keeps pending-queue logic in one place.

**Result:** Implemented with a signature change. The plan showed `useChatMessaging(peerMeshRef, socketRef, setState)`, but the actual signature is `useChatMessaging(peerMeshRef, stateRef, setState, stopTyping)`. `socketRef` was replaced by `stateRef` — the hook needs `stateRef.current.participantId` and `stateRef.current.chatDraft` to compose messages, but doesn't interact with the socket directly. `stopTyping` (i.e., `typing.notifyTypingStop`) was added as an explicit parameter so `sendChatMessage` can stop the typing indicator without creating a circular dependency between the two hooks. `createChatMessage` is also exported as a named helper (used by the peer mesh receive path in `useVaporRoom`). Final size: 106 lines.

#### 5. `hooks/useSocketConnection.ts`

Extract the 220-line `useEffect` (lines 330–549):
- Socket creation and teardown
- All `socket.on(...)` registrations
- All `socket.off(...)` in cleanup
- Auto-resume logic on connect

This is the largest extraction. The hook takes event handler callbacks as arguments (produced by the other hooks) and wires them to the socket.

```typescript
export function useSocketConnection(handlers: SocketEventHandlers) {
  const socketRef = useRef<RoomSocketClient | null>(null)
  // single useEffect: setup + cleanup
  return { socketRef, socketState }
}
```

**Result:** Implemented with two signature changes. First, `socketRef` is accepted as a parameter rather than created and returned by the hook. This was required to avoid a Temporal Dead Zone issue: `createPeerMesh` (defined before `useSocketConnection` is called) closes over `socketRef.current` in its callback, so `socketRef` must be declared before `createPeerMesh`. Returning it from the hook would place the declaration after the usage. Second, `createSocketClientRef` and `onDispose` were added as parameters. `createSocketClientRef` lets the orchestrator own the socket factory (which depends on room state); `onDispose` is called in cleanup to run `clearRoomSession`. The auto-resume logic on connect stayed in the `onConnect` handler in the orchestrator rather than moving into this hook. The hook uses a `handlersRef` pattern internally so event registrations are stable despite the single-run `useEffect`. Returns `void` (no return value). Final size: 103 lines.

#### 6. Resolve Cleanup Duplication in `useVaporRoom.ts`

After extracting the above hooks, create one `clearRoomSession()` utility function called by all four exit paths (kicked, room destroyed, leave, back-to-lobby):

```typescript
function clearRoomSession() {
  disposePeerMesh()
  chatMessaging.clearPending()
  typingIndicator.clearAll()
  sessionPersistence.clearStoredReconnectSession()
  resumeInFlightRef.current = false
  autoResumeRequestedRef.current = false
}
```

Eliminates the 4× duplication entirely.

**Result:** Implemented as planned. `clearRoomSession` is a `useCallback` in `useVaporRoom.ts` with stable deps (all sub-hook cleanup functions are stable refs or module-level). It is called by `onParticipantKicked`, `onRoomDestroyed`, and passed as `onDispose` to `useSocketConnection` (which calls it in the effect cleanup). The "leave" and "back-to-lobby" paths also call it. The 4× duplication is fully eliminated.

#### 7. `useVaporRoom.ts` after refactor

Becomes a thin orchestrator (~250 lines) that:
- Instantiates the 5 extracted hooks
- Wires their outputs together (e.g., passes `typingIndicator.onRemoteTypingStatus` into `useSocketConnection`)
- Exposes the final `{ state, actions }` object
- Contains no inline timer logic, no rate limit state, no session storage ops

**Result:** Implemented as planned in structure, but the line count target was not met. Final size is 569 lines (vs. the estimated ~250). The gap is because the orchestrator still contains all the `useCallback` event handlers for the 14 socket events — these are wired into `useSocketConnection` as the `handlers` object but are defined inline in the orchestrator with their full logic (peer mesh coordination, state transitions, etc.). The plan assumed those would become 1-liners delegating to sub-hooks, but in practice they contain conditional logic that belongs in the orchestrator layer. The file no longer has timer logic, session storage ops, rate limit state, or scattered cleanup — those concerns are fully delegated.

---

### Estimated Impact

| Metric | Before | Estimated | Actual |
|---|---|---|---|
| `useVaporRoom.ts` lines | 820 | ~250 | 569 |
| New focused hooks | 0 | 5 | 5 |
| Cleanup duplication | 4× | 1× | 1× |
| Typing logic locations | 9 | 1 hook | 1 hook |
| Rate limit locations | 6 | 1 hook | 1 hook |
| `useEffect` count in root hook | 4 | 1 | 1 |

---

---

## Part 3 — Naming Cleanup

### Problem: Phase-specific prefixes pollute the permanent type model

`state.ts` exports `Phase0RoomRecord`, `Phase0SignalingState`, `createPhase0State`, `resetPhase0State`, and `getPhase0StateSnapshot`. The `Phase0` prefix was meaningful during scaffolding but is now misleading — these are the application's permanent, stable data structures, not phase-0-specific constructs. Any reader encountering `Phase0SignalingState` in a function signature reasonably wonders what `Phase1SignalingState` looks like and whether they need to find it.

**Affected names and their replacements:**

| Old name | New name |
|---|---|
| `Phase0RoomRecord` | `RoomRecord` |
| `Phase0SignalingState` | `SignalingState` |
| `createPhase0State` | `createSignalingState` |
| `resetPhase0State` | `resetSignalingState` |
| `getPhase0StateSnapshot` | `getSignalingStateSnapshot` |

**Affected files:**
- `backend/src/signaling/state.ts` — definitions
- `backend/src/server.ts` — import and usage
- `backend/src/signaling/registerSocketHandlers.ts` — import and type annotation
- `backend/src/signaling/roomLifecycle.ts` — import and all type annotations
- `backend/src/signaling/handlers/signalRelay.ts` — import and all parameter types
- `backend/tests/roomLifecycle.unit.test.ts` — import
- `backend/tests/socket.integration.test.ts` — import

**Result:** Implemented as planned. All five names were renamed using a global replace across all seven affected files. No behavioral changes — pure symbol renames with no logic impact. The state model is now expressed with neutral, stable names.

---

## Part 4 — Import Readability

### Problem: Long named-import blocks in `registerSocketHandlers.ts`

After the Part 1 refactor, `registerSocketHandlers.ts` gained five separate import blocks for the new handler modules — 9 names from `rateLimiting`, 8 from `reconnectionManager`, 8 from `graceWindowManager`, 7 from `passwordAuth`, and 3 from `signalRelay`. At 35+ lines of imports, the top of the file is dominated by a flat list of function names with no namespace context.

TypeScript's `import * as X` (namespace import) collapses each block to one line and adds a namespace qualifier at call sites, which actually improves readability: `rateLimiting.checkAndRecordCreateAttempt(...)` is more self-documenting than a bare `checkAndRecordCreateAttempt(...)` call without import context.

**Namespace aliases chosen:**

| Module | Alias |
|---|---|
| `./handlers/passwordAuth` | `passwordAuth` |
| `./handlers/rateLimiting` | `rateLimiting` |
| `./handlers/reconnectionManager` | `reconnect` |
| `./handlers/graceWindowManager` | `grace` |
| `./handlers/signalRelay` | `relay` |

**Impact assessment:** All five modules export only functions and types used within `registerSocketHandlers.ts`. No other files import from these modules via the orchestrator. The switch to namespace imports requires updating all call sites in `registerSocketHandlers.ts` (approximately 45 call sites) but is a pure mechanical change with no behavioral impact. Context type annotations (`PasswordAuthContext`, etc.) are inferred from the factory return types and require no explicit import.

**Result:** Implemented as planned. The five 7–9 line named import blocks were replaced with five single-line namespace imports. All ~45 call sites were updated with the namespace qualifier. Import section reduced from 44 lines to 9 lines. No behavioral changes.

---

## What NOT to Refactor

These files are already well-structured — do not touch them:

- `backend/src/signaling/state.ts` — except to add the 11 Maps (described above)
- `backend/src/signaling/roomLifecycle.ts` — already cohesive; minor nesting can be ignored
- `backend/src/signaling/contracts.ts` — perfect, pure mapping layer
- `backend/src/server.ts` — clean composition root
- `frontend/src/features/room/webrtc-chat-mesh.ts` — clean class, no issues
- `frontend/src/features/room/room-socket-client.ts` — minimal adapter, correct
- `frontend/src/features/room/types.ts` — pure types
- `frontend/src/features/room/state-utils.ts` — clean reducers
- `frontend/src/features/room/RoomView.tsx` — good sub-component decomposition
- `frontend/src/features/room/LobbyView.tsx` — clean presentational component
- `frontend/src/App.tsx` — clean routing layer
- `frontend/shared/` — shared contract layer, stable

---

## Suggested Execution Order

The extractions are independent within each part, but start with the simplest to build confidence:

**Backend (lowest to highest risk):**
1. `signalRelay.ts` — pure relay logic, no state
2. `rateLimiting.ts` — self-contained Maps + functions
3. `passwordAuth.ts` — pure crypto functions
4. `reconnectionManager.ts` — session token logic
5. `graceWindowManager.ts` — timer coordination (most coupled, do last)
6. Extend `state.ts`

**Frontend (lowest to highest risk):**
1. `useSessionPersistence.ts` — pure utility functions, no React state
2. `useJoinRateLimit.ts` — 2 effects, simple state
3. `useTypingIndicator.ts` — consolidation of scattered refs
4. `useChatMessaging.ts` — messaging flow
5. `useSocketConnection.ts` — largest, do last

Each extraction should be followed by a manual smoke test (create room, join, send messages, disconnect/reconnect) before proceeding to the next.

---

## Risk Assessment

**Low risk:** `signalRelay.ts`, `passwordAuth.ts`, `useSessionPersistence.ts`, `useJoinRateLimit.ts`  
These are pure function extractions or simple state moves. No behavior change.

**Medium risk:** `rateLimiting.ts`, `reconnectionManager.ts`, `useTypingIndicator.ts`, `useChatMessaging.ts`  
Move Map ownership across modules. Requires verifying that cleanup (sweeper loop, leave/kick paths) still reaches all Maps.

**High risk:** `graceWindowManager.ts`, `useSocketConnection.ts`  
Timer coordination and socket lifecycle are the most coupled areas. Test grace window expiration and reconnect flows explicitly after these.

**Mitigation:** Extract one module at a time. Run the smoke test suite after each. Commit separately so any regression is bisectable.
