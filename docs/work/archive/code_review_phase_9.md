# Code Review — Phase 9

Date: 2026-06-23  
Reviewer: Claude (automated, high-effort)  
Scope: Working-tree diff against last commit (phase 9 implementation)

---

## Findings

### [CR9-1] CRITICAL — `derived.soloDeadlineAt` hardcoded to `null` in useVaporRoom

**File:** [frontend/src/features/room/useVaporRoom.ts](../../frontend/src/features/room/useVaporRoom.ts) ~line 623  
**Severity:** Bug — feature completely non-functional in UI

The hook's `derived` return object sets `soloDeadlineAt: null` unconditionally. `state.soloDeadlineAt` is correctly maintained internally, but the value is never forwarded to UI consumers. `getSoloWaitingText` always receives `null` and the countdown never renders for any path.

**Fix:** Change line 623 to `soloDeadlineAt: state.soloDeadlineAt`.

**Resolution (Fixed):** `derived.soloDeadlineAt` now returns `state.soloDeadlineAt`.

---

### [CR9-2] CRITICAL — `withRoomJoined` ignores `soloDeadlineAt` from payload

**File:** [frontend/src/features/room/state-utils.ts](../../frontend/src/features/room/state-utils.ts) ~line 116  
**Severity:** Bug — solo countdown lost on host reconnect

`RoomJoinedPayload` now carries `soloDeadlineAt?: number | null` and the backend sends the active deadline on `resume_session` (`registerSocketHandlers.ts:659`). `withRoomJoined` hardcodes `soloDeadlineAt: null` instead of reading `payload.soloDeadlineAt ?? null`. A reconnecting host that was already in a solo countdown always enters with `null`, losing the countdown.

**Fix:** Change the `soloDeadlineAt` assignment in `withRoomJoined` to `payload.soloDeadlineAt ?? null`.

**Resolution (Fixed):** `withRoomJoined` now reads `payload.soloDeadlineAt ?? null`.

---

### [CR9-3] BUG — Guest hard-disconnect does not emit `soloDeadlineAt` to remaining host

**File:** [backend/src/signaling/registerSocketHandlers.ts](../../backend/src/signaling/registerSocketHandlers.ts) ~line 1004  
**Severity:** Bug — host countdown timer goes stale after guest TCP drop

In the guest disconnect path (~lines 1001–1010), `restartSoloTimer` is called but its return value is discarded. The `peer_left` emission that follows (`emitParticipantExit` with no extras) carries no `soloDeadlineAt`. The kick handler (line 858–871) and voluntary leave handler (line 908–914) both capture the return value and include it in the payload — the disconnect path is the inconsistent outlier.

**Fix:** Capture the return value and pass it as extras to `emitParticipantExit`.

**Resolution (Invalid — Won't Fix):** The prescribed fix is incompatible with an existing hard invariant. Test `T1.6-01` ([socket.integration.test.ts:687](../../backend/tests/socket.integration.test.ts#L687)) asserts that a guest TCP disconnect emits **no** immediate `peer_left` — the guest must remain visible for the full `GUEST_DISCONNECT_GRACE_MS` (30 min) window, and `peer_left` is emitted only when the guest-grace timer fires. The guest-disconnect path is therefore *not* an inconsistent outlier versus kick/leave: kick and leave are immediate removals (the participant is gone, so `peer_left` fires), whereas a TCP disconnect is grace-protected. Emitting `soloDeadlineAt` would require emitting `peer_left`, which the disconnect path deliberately suppresses.

There is also no "stale countdown" symptom: when host + guest are both present the host shows no solo countdown, so a guest drop leaves the host with no countdown (not a stale one). The room is correctly bounded — `SOLO_HOST_ROOM_TIMEOUT_MS` (15 min) < `GUEST_DISCONNECT_GRACE_MS` (30 min), so the solo timer fires first and destroys the room via `room_destroyed`.

What *was* applied: the solo-timer restart in this path now flows through the shared `restartSoloTimerIfSolo` helper (see CR9-7), so the four restart sites stay consistent. No `peer_left` is emitted, preserving T1.6-01.

---

### [CR9-4] BUG — `restartSoloTimer` fires for guest resume, not just host resume

**File:** [backend/src/signaling/registerSocketHandlers.ts](../../backend/src/signaling/registerSocketHandlers.ts) ~line 639  
**Severity:** Bug — incorrect room lifetime extension, wrong deadline sent to guest

When `resumeLiveCount === 1`, the resume_session handler restarts the solo-host timer with no check on whether the resuming participant is actually the host. If a guest resumes as the sole live participant (host is still disconnected), the solo-host deadline is reset and the new value is sent to the guest via `soloDeadlineAt` in the `roomJoined` payload — the guest should not be driving host-only policy.

**Fix:** Guard the `restartSoloTimer` call with `room.hostId === reconnectRecord.participantId`.

**Resolution (Fixed):** Added `const isHostResuming = room.hostId === reconnectRecord.participantId`. The `resumeLiveCount === 1` restart branch now also requires `isHostResuming`, and the `roomJoined` payload sends `soloDeadlineAt` only when `isHostResuming` (else `null`) so a resuming guest is never handed a deadline it doesn't own.

---

### [CR9-5] BUG — `resetToLobby` no longer clears `roomIdInput`

**File:** [frontend/src/features/room/state-utils.ts](../../frontend/src/features/room/state-utils.ts) ~line 306  
**Severity:** Bug — stale room ID persists in join input after lobby reset

The old `resetToLobby` had `roomIdInput: ''` in its explicit field list. The refactor moved those fields into `clearSessionFields()`, but `roomIdInput` was omitted from `clearSessionFields()`. `resetToLobby` now spreads `...state` then `...clearSessionFields()` without setting `roomIdInput`, so the user's previous room ID string survives the reset.

**Fix:** Add `roomIdInput: ''` to `clearSessionFields()`.

**Resolution (Fixed):** `roomIdInput: ''` added to `clearSessionFields()`, so `resetToLobby` now clears the stale room ID.

---

### [CR9-6] MAINTAINABILITY — `clearSessionFields()` not applied in `withRoomCreated` / `withRoomJoined`

**File:** [frontend/src/features/room/state-utils.ts](../../frontend/src/features/room/state-utils.ts) ~line 270  
**Severity:** Maintenance risk — new session fields won't be reset on room entry

`withRoomCreated` and `withRoomJoined` each enumerate their own inline field reset lists independently of the new `clearSessionFields()`. If a new session field is added to `clearSessionFields()`, it will still leak stale values on room entry because neither function calls it. The helper is only wired into `withRoomEnded` and `resetToLobby`.

**Resolution (Fixed):** Both `withRoomCreated` and `withRoomJoined` now spread `...clearSessionFields()` first and override only their payload-derived fields. A new session field added to `clearSessionFields()` is now reset on room entry in both paths.

---

### [CR9-7] MAINTAINABILITY — Solo timer restart block copy-pasted four times

**File:** [backend/src/signaling/registerSocketHandlers.ts](../../backend/src/signaling/registerSocketHandlers.ts) lines ~855, ~908, ~963, ~1001  
**Severity:** Maintenance risk — CR9-3 is a direct consequence of this pattern

The `if (liveCount === 1) { policy = ...; restartSoloTimer(...) }` block appears in four separate handler branches (kick, leave, host-disconnect, guest-disconnect) with no shared helper. The fourth copy-paste site (guest-disconnect) forgot to capture the return value, producing CR9-3. Any future change to the solo-timeout logic must be applied to all four sites consistently.

**Resolution (Fixed):** Extracted a single `restartSoloTimerIfSolo(roomId, liveCount): number | null` closure (defined alongside `destroyRoom`). It returns `null` unless `liveCount === 1` and a policy exists, otherwise restarts the timer and returns the deadline. All four branches (kick, leave, host-disconnect, guest-disconnect) now call it, so `restartSoloTimer` has a single in-handler call path.

---

### [CR9-8] MAINTAINABILITY — `clearRoomArtifacts` roomNameToId cleanup is a silent no-op when room is already deleted

**File:** [backend/src/signaling/registerSocketHandlers.ts](../../backend/src/signaling/registerSocketHandlers.ts) ~line 182  
**Severity:** Fragile — potential roomNameToId leak for future callers

`clearRoomArtifacts` calls `state.rooms.get(roomId)` to retrieve the room name for cleanup. In `handleGuestGraceExpired`, `state.rooms.delete(roomId)` is called *before* `clearRoomArtifacts`, so the lookup returns `undefined` and the `roomNameToId.delete` line is silently skipped. The name happens to be cleaned up by an earlier explicit delete on line 266, so there is no current leak — but the cleanup inside `clearRoomArtifacts` is dead code in that path and will become a real leak if the explicit pre-delete is ever removed.

**Resolution (Fixed):** Reordered `handleGuestGraceExpired` so `clearRoomArtifacts(roomId)` runs *before* `state.rooms.delete(roomId)`, and removed the now-redundant explicit `roomNameToId.delete`. The cleanup inside `clearRoomArtifacts` is now the single live path for `roomNameToId` removal.

---

### [CR9-9] CONVENTIONS — Misleading `// stable ref — intentional omission` comments

**File:** [frontend/src/features/room/useVaporRoom.ts](../../frontend/src/features/room/useVaporRoom.ts) lines ~178, ~216, ~236, ~257, ~275  
**Severity:** Conventions — implies a hidden stale-closure risk that doesn't exist

Five identical comments imply a real (non-ref) dependency was deliberately left out of a `useCallback` dep array. In every case, the only actually-omitted values are React ref objects (`resumeInFlightRef`, `autoResumeRequestedRef`, `socketRef`, `socketStateRef`) that ESLint would not flag in the first place. A future maintainer auditing for stale closures may "fix" the perceived omission by adding a ref object to a dep array, causing an infinite re-render loop in socket event handlers. Per CLAUDE.md: "Don't explain WHAT the code does" — if a comment is needed, it should name the specific ref and explain why it's safe to omit.

**Resolution (Fixed):** Each of the five comments now names the specific refs it covers and states they are stable React refs, not reactive deps (e.g. `// socketRef / socketStateRef / resumeInFlightRef / autoResumeRequestedRef are stable React refs, not reactive deps — do not add them.`). The `eslint-disable-next-line` directives are unchanged; lint remains at 0 errors / 0 warnings.

---

### [CR9-10] CRITICAL — Missing `await` on `withRoomLock` in nicknameUpdate handler

**File:** [backend/src/signaling/registerSocketHandlers.ts](../../backend/src/signaling/registerSocketHandlers.ts) line 775  
**Severity:** Critical bug — race condition in nickname mutation

The `nicknameUpdate` event handler calls `withRoomLock(roomId, () => { ... })` without `await`. Lines 600 (`resume_session` handler) and 724 (`room_password_update` handler) both use `await withRoomLock`, establishing the correct pattern. Without `await`, the handler returns immediately, allowing the callback body (which mutates `room.participants.get(participantId).nickname` and the `nicknameToParticipant` map) to execute asynchronously and without serialization. Multiple simultaneous nickname updates for the same room can now interleave and corrupt shared state.

**Fix:** Change line 775 to `await withRoomLock(roomId, () => {`.

**Resolution (Fixed):** Added `await` to line 775 in the nicknameUpdate handler, matching the pattern in resume_session and room_password_update handlers. The callback now properly serializes nickname mutations through the room lock.

---

## Status

| ID | Severity | Status |
|----|----------|--------|
| CR9-1 | Critical | Fixed |
| CR9-2 | Critical | Fixed |
| CR9-3 | Bug | Invalid — Won't Fix (conflicts with T1.6-01 grace invariant; helper consolidation applied) |
| CR9-4 | Bug | Fixed |
| CR9-5 | Bug | Fixed |
| CR9-6 | Maintainability | Fixed |
| CR9-7 | Maintainability | Fixed |
| CR9-8 | Maintainability | Fixed |
| CR9-9 | Conventions | Fixed |
| CR9-10 | Critical | Fixed |

## Verification

- `backend`: `tsc --noEmit` — clean.
- `frontend`: `tsc --noEmit` — clean; `npm run lint` — 0 errors, 0 warnings.

**Note:** CR9-10 identified during automated high-effort code review. Missing `await` on `withRoomLock` in nicknameUpdate handler (line 775) was a race condition discovered post-commit and immediately fixed.

---

## Out of Scope (Phase 10: E2E Bug Fixes)

The following bugs were discovered during E2E testing. They are **not** Phase 9 regressions but reveal correctness issues in the disconnect/reconnect and messaging flows. These are scheduled for Phase 10 (bug fix phase).

### [E2E-1] CRITICAL — Guest disconnect does not emit `peer_left` event

**Symptom:** Host is notified when disconnecting; guests are not.

**Root Cause:**  
[registerSocketHandlers.ts:983–1001](../../backend/src/signaling/registerSocketHandlers.ts#L983-L1001) — Guest disconnect path explicitly omits `peer_left` broadcast:

```typescript
if (room.hostId !== participantId) {
  // ... grace setup ...
  
  // Guest stays visible until guest-grace expires (see T1.6-01): no peer_left is
  // emitted here.
  const liveCount = getLiveParticipantCount(room);
  restartSoloTimerIfSolo(roomId, liveCount);
}
```

By contrast, host disconnect **does** emit `peer_left`.

**Design Violation:**  
[Vapor_System_Design.md §6 Rule 5](../../docs/system_design/Vapor_System_Design.md#6-lifecycle-rules) states:
> **Guest:** Start GUEST_DISCONNECT_GRACE_MS grace timer. **Broadcast `peer_left` to remaining live participants.**

The grace window allows reconnection without rejoining; it does **not** affect visibility in the `participants` list. The reference to "T1.6-01" reflects a prior design decision that contradicts the current spec. The current spec is authoritative.

**Fix:** Emit `peer_left` event when a guest disconnects, matching the host disconnect path. Guest grace period (30 min reconnection window) is orthogonal to visibility — guests should be immediately removed from the active participants list.

**Scope:** Phase 10 — ~2 hours (copy host disconnect emission pattern to guest path).

---

### [E2E-2] Guests cannot exchange messages after host disconnect

**Symptom:** When the host disconnects, remaining guests cannot send/receive messages to each other. Problem persists even after host reconnects. On host's second disconnect, guests can communicate again.

**Suspected Root Causes:**

1. **Missing `syncPeers` on peer removal:** `onPeerLeft` calls `handlePeerLeft` but does not call `syncPeers` to revalidate the WebRTC mesh for remaining peers.
2. **Pending message buffer issue:** Messages from before the disconnect might be stuck in `pendingMessagesRef` and interfere with new connections.
3. **Chat connection state transition bug:** `chatConnectionState` might be incorrectly set to 'idle' or 'connecting', blocking message delivery.

**Files:**
- [useVaporRoom.ts:306–326](../../frontend/src/features/room/useVaporRoom.ts#L306-L326) — `onPeerLeft` handler
- [useChatMessaging.ts:36–48](../../frontend/src/features/room/hooks/useChatMessaging.ts#L36-L48) — pending message flush
- [webrtc-chat-mesh.ts:73–94](../../frontend/src/features/room/webrtc-chat-mesh.ts#L73-L94) — `syncPeers` peer management

**Scope:** Phase 10 — ~4 hours (requires detailed tracing with WebRTC connection monitoring and pending message logging).

---

### [E2E-3] Host receives pre-disconnect messages on reconnect

**Symptom:** After host disconnects and reconnects, the host can see one or more messages that were sent **while the host was disconnected**. Chat should not be persisted server-side; reconnected clients should see only post-reconnect state.

**Suspected Root Causes:**

1. **Pending messages flushed on reconnect:** When the host reconnects and `peerJoined` is received for the host, guests' WebRTC connections are re-established. If guests have pending messages in `pendingMessagesRef` from before the disconnect, they might be flushed immediately upon connection, reaching the host.
2. **Message delivery race:** Messages might be buffered in data channel send buffers and replayed on reconnect.
3. **Chat clear timing:** `onRoomJoined` calls `clearSessionFields()` to set `chatMessages: []`, but messages might be added to the state after this clear due to a timing race.

**Files:**
- [useVaporRoom.ts:268–288](../../frontend/src/features/room/useVaporRoom.ts#L268-L288) — `onRoomJoined` handler
- [useChatMessaging.ts:60–82](../../frontend/src/features/room/hooks/useChatMessaging.ts#L60-L82) — `sendChatMessage` and pending message logic

**Scope:** Phase 10 — ~3 hours (requires tracing of message lifecycle through pending buffer and data channel delivery).

---

### [E2E-4] Room expiry timer doesn't display reliably (UI)

**Symptom:** Timer appears/disappears inconsistently. Switching UI or performing other actions makes it reappear.

**Suspected Root Cause:**  
Timer rendering might depend on a state update or effect that doesn't re-run reliably when `expiresAt` is set.

**Files:**
- [RoomViewDesktop.tsx](../../frontend/src/features/room/RoomViewDesktop.tsx) / [RoomView.tsx](../../frontend/src/features/room/RoomView.tsx) — Timer rendering
- [useVaporRoom.ts:102–111](../../frontend/src/features/room/useVaporRoom.ts#L102-L111) — `getLifetimeText` function

**Scope:** Phase 10 — ~1 hour (CSS/React rendering audit).

---

### [E2E-5] Chat history completely wiped on involuntary disconnect (Design Decision)

**Symptom:** When a user experiences a TCP drop, all chat history is immediately lost.

**Current Behavior:**  
`clearSessionFields()` is called on `room_ended`, `room_created`, `room_joined`, and `reset_to_lobby`, clearing `chatMessages: []`.

**Decision:** Preserve chat history in `sessionStorage` per room unless user explicitly leaves. Implementation:
- Update: Maintain a single `sessionStorage` entry per room (key: `vapor.chat.<roomId>`) containing a JSON array of chat messages.
- Update: Only clear chat history on explicit `leave_room`, room destruction, or tab close.
- Do not clear on involuntary TCP drops — let reconnect within the grace window restore chat context.
- Overwrite the `sessionStorage` entry (not create new files) on each new message.

**Scope:** Phase 10 — ~1 hour (if approved; part of chat history preservation feature).

---

### [E2E-6] Desktop chat container scroll positioning (UI/UX)

**Symptom:** Long chat histories trigger browser scroll bar instead of chat container scroll bar.

**Suggested Fix:**  
Ensure [RoomViewDesktop.tsx](../../frontend/src/features/room/RoomViewDesktop.tsx) applies `overflow-y: auto` and fixed `max-height` to the chat message container, not the entire page.

**Scope:** Phase 10 — ~30 minutes (CSS layout fix).
