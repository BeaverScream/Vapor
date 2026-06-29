# Code Review — Phase 10

Date: 2026-06-25 (re-review)  
Reviewer: Claude (automated, max-effort)  
Scope: Working-tree diff against last commit (Phase 10 — bug fix & chat persistence: VP-10.1 guest disconnect `peer_left`, VP-10.2 mesh repair on peer-left, VP-10.3 timer/scroll UI, VP-10.4 chat history persistence)

---

## Summary

Most of Phase 10 holds up under deep verification: the `withAppendedChatMessage` messageId-idempotency guard, the `onRoomJoined` restore-merge (no intermediate empty-chat commit), the persistence `useEffect` (`screen === 'room'` guard), `getLiveParticipantCount` excluding the just-disconnected guest on the *disconnect* path, `shouldInitiate` giving a deterministic single re-offer initiator, and the `h-dvh` + inner `overflow-y-auto` scroll chain are all correct.

This re-review found **one new functional bug** introduced by VP-10.1: the guest grace-expiry handler still emits a second `peer_left` for a guest the clients already removed at disconnect, producing a duplicate "disconnected" system message and an inconsistent participant count (CR10-4). The previously-flagged OOS-1 (wrong reconnect-session key on leave) **has been fixed** in this iteration. The remaining items are one cleanup and two low-severity observations.

---

## Findings

### [CR10-4] BUG — Guest grace expiry emits a duplicate `peer_left` for an already-removed guest

**File:** [backend/src/signaling/registerSocketHandlers.ts](../../backend/src/signaling/registerSocketHandlers.ts) line 301 (`handleGuestGraceExpired`), interacting with the new emit at line 1010 (guest disconnect)  
**Severity:** Medium — visible duplicate system message + wrong participant count on remaining clients

Before VP-10.1 the guest disconnect path emitted **no** `peer_left`; the only emission was at grace expiry ([line 301](../../backend/src/signaling/registerSocketHandlers.ts#L301)). VP-10.1 added an emission on the disconnect itself ([line 1010](../../backend/src/signaling/registerSocketHandlers.ts#L1010)) but **left the grace-expiry emission in place**, so a guest who never reconnects now triggers `peer_left` **twice**:

1. At TCP drop — `peer_left { participantId, reason: "disconnect", participantCount: getLiveParticipantCount(room) }`. Remaining clients remove the guest and append a `"<name> disconnected"` system message.
2. ~`GUEST_DISCONNECT_GRACE_MS` later, at grace expiry — a **second** `peer_left { participantId, reason: "disconnect", participantCount: activeRoom.participants.size }` for the **same** guest.

On the client, `onPeerLeft` ([useVaporRoom.ts:354](../../frontend/src/features/room/useVaporRoom.ts#L354)) unconditionally appends a freshly-id'd system message via `createChatMessage(...)`; the `withAppendedChatMessage` idempotency guard only dedupes by `messageId`, so it does **not** suppress this. `withPeerLeft` then overwrites `participantCount` with the second payload's value.

**Two distinct defects in the second emission:**
- **Duplicate system message:** every remaining participant renders `"<name> disconnected"` a second time, minutes after the guest already vanished from the roster.
- **Wrong count basis:** line 301 uses `activeRoom.participants.size`, which counts *other* guests currently in their own grace window (socketId `disconnected:…` but still in the Map), whereas every other emit path uses `getLiveParticipantCount`. With two guests dropped and in grace, the surviving count is inflated.

**Failure scenario:** Host + Guest1 + Guest2. Guest1's TCP drops → Host/Guest2 see "Guest1 disconnected", roster = 2. Guest1 never returns; ~30 min later the grace timer fires → Host/Guest2 see "Guest1 disconnected" **again** and `participantCount` is recomputed from `participants.size`.

**Recommended fix:** remove the `io.to(roomId).emit(... peerLeft ...)` block from `handleGuestGraceExpired` ([lines 301–305](../../backend/src/signaling/registerSocketHandlers.ts#L301)) — the departure is already announced at disconnect, and grace expiry is now purely server-side Map/nickname cleanup. (If a count correction is ever needed there, it must use `getLiveParticipantCount`, not `participants.size`.)

**Status:** Resolved — the duplicate `io.to(roomId).emit(peerLeft, …)` block was removed from `handleGuestGraceExpired`; grace expiry now performs Map/nickname cleanup only, with a comment documenting why no emit happens there. Backend type-check passes.

---

### [CR10-1] CLEANUP — Host- and guest-disconnect `peer_left` emission is duplicated

**File:** [backend/src/signaling/registerSocketHandlers.ts](../../backend/src/signaling/registerSocketHandlers.ts) lines ~971–976 (host) and ~1002–1007 (guest)  
**Severity:** Reuse / maintainability

VP-10.1 made the guest disconnect path emit `peer_left` mirroring the host path. The two blocks are now near-identical: compute `liveCount` via `getLiveParticipantCount(room)`, `restartSoloTimerIfSolo(roomId, liveCount)`, then emit `peer_left` with `reason: "disconnect"`, `participantCount: liveCount`, and a conditional `soloDeadlineAt` spread. This is the same copy-paste pattern that produced CR9-3/CR9-7; the solo-timer restart was already consolidated into `restartSoloTimerIfSolo`, but the surrounding emit is not.

**Recommendation:** Extract `emitPeerLeftOnDisconnect(socket, roomId, participantId)` (compute live count, restart solo timer, emit) and call it from both the host and guest disconnect branches so the two paths cannot drift.

**Status:** Resolved — extracted `emitPeerLeftOnDisconnect(socket, roomId, room, participantId)` (computes `getLiveParticipantCount`, calls `restartSoloTimerIfSolo`, emits `peer_left` with the conditional `soloDeadlineAt` spread). Both the host- and guest-disconnect branches now call it, so the emission logic exists in one place. The host branch still emits `host_reconnect_grace` separately afterward. Backend type-check passes.

---

### [CR10-2] OBSERVATION — `onError` clears chat for stale/expired resume codes but does not clear the stored reconnect session for those codes

**File:** [frontend/src/features/room/useVaporRoom.ts](../../frontend/src/features/room/useVaporRoom.ts) lines ~458–475  
**Severity:** Low — minor inconsistency, no data loss in the common case

VP-10.4.5 added a chat-clear block covering five codes (`ROOM_NOT_FOUND`, `INVALID_PASSWORD`, `RATE_LIMITED`, `RECONNECT_TOKEN_STALE`, `HOST_RECONNECT_WINDOW_EXPIRED`). The existing teardown block immediately below only calls `persistence.clearStoredReconnectSession()` + `resetToLobby` for three of them (`ROOM_NOT_FOUND`, `INVALID_PASSWORD`, `RATE_LIMITED`). So for `RECONNECT_TOKEN_STALE` / `HOST_RECONNECT_WINDOW_EXPIRED` the chat snapshot is deleted but the stale reconnect token is left in `sessionStorage` and the user falls through to `withLobbyError`.

In practice these two codes mean the room/grace is genuinely gone, so a subsequent auto-resume just fails again — not a correctness bug, but the chat-clear set and the session-clear set should be reconciled. Either treat the two grace-expiry codes as a full leave (also clear the session) or leave a short comment noting the deliberate divergence.

**Status:** Resolved — `persistence.clearStoredReconnectSession()` was moved into the chat-clear block so the chat-clear and session-clear sets now match (all five codes clear both the chat snapshot and the stale reconnect token). The redundant `clearStoredReconnectSession()` call in the `resetToLobby` branch was removed. Frontend type-check passes.

---

### [CR10-3] OBSERVATION — `needsOffer` returns `true` for a channel still in `connecting`

**File:** [frontend/src/features/room/webrtc-chat-mesh.ts](../../frontend/src/features/room/webrtc-chat-mesh.ts) lines 99–108  
**Severity:** Low confidence — likely benign

`needsOffer` returns `false` only when the data channel `readyState === 'open'` or the connection signaling state is non-`stable`. A connection that has completed signaling (`stable`) but whose data channel is still `'connecting'` (DTLS/ICE completing) returns `true`, so a host-departure repair pass can fire a fresh offer mid-establishment. WebRTC renegotiation generally preserves an opening channel, so this is most likely harmless, but if a guest↔guest channel happens to be opening exactly when the shared peer leaves, the re-offer is unnecessary churn.

**Recommendation (optional):** also treat a non-`open`-but-`connecting` data channel as "in progress" and skip the re-offer.

**Status:** Resolved — `needsOffer` now returns `false` for a data channel whose `readyState` is `'open'` **or** `'connecting'`, so a mid-establishment channel is no longer re-offered during a mesh-repair pass. Frontend type-check passes.

---

## Status

| ID | Severity | Status |
|----|----------|--------|
| CR10-4 | **Medium (bug)** | **Resolved this iteration** |
| CR10-1 | Cleanup (reuse) | **Resolved this iteration** |
| CR10-2 | Low (consistency) | **Resolved this iteration** |
| CR10-3 | Low (uncertain) | **Resolved this iteration** |
| OOS-1 | Bug (pre-existing) | **Resolved this iteration** |

## Verification performed

- Traced the reconnect path: `resume_session` resolves to `room_joined`, so `onRoomJoined`'s restore + `clearPending` + idempotent append logic covers the involuntary-drop case. ✓
- Confirmed `clearSessionFields()` resets `chatMessages` to `[]`, and the restore merge in `onRoomJoined` overrides it only when `restoredChat.length > 0`. ✓
- Confirmed save (`state.activeRoomId`) and load (`payload.roomId`) use the same room id, so the persistence key is consistent. ✓
- Confirmed the desktop room layout has inner `flex-1 min-h-0 overflow-y-auto` containers, so the `min-h-dvh` → `h-dvh` change bounds the flex chain without clipping (VP-10.3.3). ✓
- Traced the **guest grace-expiry** path (`handleGuestGraceExpired`) against the new disconnect-time emission → found the duplicate `peer_left` (CR10-4); `getLiveParticipantCount` is **not** used there. ✗ (bug)
- Confirmed terminal handlers (`onRoomDestroyed`, `onParticipantKicked`, `leaveRoom`, `backToLobby`) clear chat *before* the screen leaves `'room'`, so the persistence effect cannot re-save a cleared snapshot. ✓

> Note: the VP-10.4 sessionStorage chat persistence does write user-generated message text to `sessionStorage`. This is user-device storage (not server-side), is cleared on all terminal room events, and is scoped to the tab's session lifetime — consistent with the zero-persistence contract which applies to server storage. **Resolved at the design level** in VP-10.4.6 (System Design §1.1 "Frontend Token Storage Policy" updated). No action needed — recorded here for traceability.

---

## Resolved

---

## Out of Scope

Bugs and issues identified during the Phase 10 review that are outside the current phase scope. All are tracked in the backlog.

### [OOS-P10-1] BUG — `onPeerLeft` mesh-repair reads stale React state, potentially pruning a newly-joined peer's connection
**Tracked:** BL-WEBRTC-SYNCPEERS-RACE-01  
`onPeerLeft` derives `remainingPeerIds` from `stateRef.current.participants` before the `setState` from any concurrent `peer_joined` commits, then calls `syncPeers`, which prunes connections not in the set. A peer who joins immediately before another departs risks having their active connection torn down. The fix requires either reading remaining peers from inside the `setState` callback or limiting repair-pass `syncPeers` to additive-only operations. A broader design note: multi-party topology changes (simultaneous join+leave, host departure) are underspecified in the system design and should be documented with explicit sequencing rules.

### [OOS-P10-2] BUG — `RECONNECT_TOKEN_STALE` / `HOST_RECONNECT_WINDOW_EXPIRED` resume failures leave client stuck on room screen
**Tracked:** BL-RESUME-DEAD-ROOM-UI-01  
These two codes clear the chat snapshot and reconnect token in `onError` but do not transition the UI. The client stays on `screen === 'room'` with no path back to the lobby. A flowchart mapping all resume-failure codes to their correct UI transitions is needed before implementing the fix; the resolution will likely mirror the `ROOM_NOT_FOUND` path.

### [OOS-P10-3] OBSERVATION — Comment in guest disconnect path conflates UI participant list with backend Map — **FIXED**
The comment at [registerSocketHandlers.ts:1016](../../backend/src/signaling/registerSocketHandlers.ts#L1016) was updated to explicitly name the distinction: `peer_left` broadcasts so connected clients remove the guest from their UI roster; the backend `room.participants` Map retains the `disconnected:` sentinel for the grace window (reconnection eligibility + nickname hold). These are two distinct structures serving two distinct purposes.

### [OOS-P10-4] LOW — `E2E_DISABLE_RATE_LIMIT` has no production environment guard
**Tracked:** BL-RATE-LIMIT-E2E-BYPASS-01

### [OOS-P10-5] LOW — Mesh repair silently skips data channel creation when a closed channel still occupies `dataChannels`
**Tracked:** BL-WEBRTC-CLOSED-CHANNEL-REUSE-01

### [OOS-P10-6] LOW — `loadChatHistory` does not mirror content-level validation of the live receive path
**Tracked:** BL-CHAT-RESTORE-VALIDATION-01

### Refactoring (all tracked in backlog)
- `DEBUG_PEER_TRACE`/`tracePeer` dead-code guard compiled into production bundle → BL-REFACTOR-PEER-TRACE-01
- Chat persistence effect runs full `JSON.stringify` on every message append → BL-REFACTOR-CHAT-PERSIST-PERF-01
- Terminal session teardown triple (`clearChatHistory` + `clearStoredReconnectSession` + `clearRoomSession`) at five call sites → BL-REFACTOR-SESSION-TEARDOWN-01
- `App.tsx` `min-h-dvh` → `h-dvh` and removal of the `RoomLifetimeChip` input-focus guard: the focus guard originally prevented the chip from overlapping the mobile keyboard. Removal is an intentional design simplification; verify the chip does not overlap the chat input on small viewports before shipping to mobile.

---

## Resolved

### [OOS-1] BUG (pre-existing) — `leaveRoom` / `backToLobby` cleared the wrong `sessionStorage` key — **FIXED**

The prior review flagged that both leave handlers called `sessionStorage.removeItem('vapor-reconnect-session')` (hyphen-delimited) while the token is written under `RECONNECT_SESSION_STORAGE_KEY = 'vapor.reconnect.session'` (dot-delimited), so a voluntary leave left the reconnect session behind and the tab could auto-resume back into the room the user left.

**Resolved in this iteration:** [`leaveRoom`](../../frontend/src/features/room/useVaporRoom.ts) and `backToLobby` now call `persistence.clearStoredReconnectSession()` (alongside `clearChatHistory(...)`), removing the correct key. The stale hyphen-key `removeItem`/try-catch blocks were deleted. Verified against the current working tree.
