# Phase 8 Code Review

Date: 2026-06-19

Verification:
- `npm run build` (frontend) — **green** (confirmed via phase-8 matrix 8.1.3/8.2.6/8.3.3/8.4.4/8.5.9/8.6.8).
- `npm run lint` — **pre-existing errors in `useVaporRoom.ts`** (inherited from BL-FRONTEND-LINT-REFS-01, out of phase-8 scope; no new errors on phase-8-touched files per matrix).
- Grep `backend/` for `layoutMode` — **0 hits** ✅ (D-8 isolation confirmed).
- Grep `LAYOUT_MODE_KEY` — appears only in `layoutMode.ts` and `useLayoutMode.ts` ✅.
- `AvatarStack` — no remaining references in `RoomView.tsx` ✅.
- Grep `frontend/src` for `localStorage` writes outside `useLayoutMode.ts` — **0 hits for layout preference** ✅ (D-8 compliant).
- Notification persistence check (D-5): no writes to `localStorage`/`sessionStorage` in `useNotifications.ts`; no socket payload referencing notification state ✅.

---

## 1. Findings — Bugs / Correctness

### 1.1 [Medium] `notifyNewMessage` fires for any non-typing JSON frame, not only chat messages — **Resolved**

**File:** `frontend/src/features/room/webrtc-chat-mesh.ts`, line ~291 (data-channel message handler)

The data-channel handler returns early for `typing_start`/`typing_stop` frames but otherwise falls through to both `onRemoteMessage` and `onNewMessage`:

```ts
try {
  const msg = JSON.parse(raw)
  if (msg.type === 'typing_start' || msg.type === 'typing_stop') {
    onRemoteTypingStatus(...)
    return  // ← early exit, no notification
  }
  // any other JSON type falls through ↓
} catch { /* not JSON */ }
this.onRemoteMessage(peerId, raw)
this.onNewMessage?.()   // ← fires for unrecognized JSON types too
```

**Failure scenario:** Any structured protocol message that is not `typing_start`/`typing_stop` silently triggers a desktop notification and appears in the chat feed as raw JSON. This must be addressed with a full set of known message types in mind — not just today's types, but the expected future protocol surface:

- **Text message** (`type: 'text'` or unstructured plaintext) — should trigger `onNewMessage`
- **File transfer** (not implemented yet; e.g. `type: 'file_offer'`, `type: 'file_chunk'`, `type: 'file_ack'`) — must not trigger a chat notification
- **Participant joined / left** (if ever routed over the data channel rather than the signaling socket) — must not trigger a chat notification
- Any future control or renegotiation frame — must not trigger a chat notification

A raw WebRTC injection by a peer with custom tooling can also exploit the current fall-through today.

**Fix:** Introduce an explicit allowlist of message types that constitute user-visible chat content. Gate `onNewMessage?.()` and `onRemoteMessage` on membership in that list. Non-JSON plaintext (the `catch` block) is always treated as chat. Any JSON frame whose `type` is not in the allowlist is silently dropped rather than surfaced in the feed or triggering a notification. The allowlist should be defined as a typed constant so future protocol additions force a deliberate opt-in decision.

**Resolved:** A module-level `CHAT_MESSAGE_TYPES = new Set<string>(['text'])` constant was added (line 15). The handler now uses an `isChat` flag: starts `true` for non-JSON plaintext, set to `false` on any successful JSON parse, flipped back to `true` only if the frame's `type` is in `CHAT_MESSAGE_TYPES`. `onRemoteMessage` and `onNewMessage?.()` are gated entirely on `isChat`. Any JSON frame not in the allowlist is silently dropped; future protocol additions require a deliberate opt-in.

---

## 2. Out of Scope — Tracked in Backlog

The following findings are valid but fall outside Phase 8's scope. Each has been added to `Backlog.md` for Phase 9 triage.

### 2.1 [High] `peer_left` emitted to the kicked socket before disconnect (was §1.1) → BL-KICK-PEER-LEFT-01

**File:** `backend/src/signaling/registerSocketHandlers.ts` (kick handler)

The kick handler emits `peer_left` to the entire Socket.IO room before disconnecting the kicked socket. Because the kicked socket has not left the room at that point, it receives both `participant_kicked` and a spurious `peer_left` about itself. This corrupts the kicked client's participant list before `withKickedFromRoom` fires. The solo-host deadline in the `peer_left` payload also reaches the kicked client, triggering a meaningless countdown.

**Preferred fix:** Emit `peer_left` only to remaining room members (i.e., broadcast to the room after removing the kicked socket, not before).

---

### 2.2 [Medium] `withKickedFromRoom` leaves stale lobby state in session (was §1.3) → BL-KICK-STATE-CLEANUP-01

**File:** `frontend/src/features/room/state-utils.ts`, lines 375–380

`withKickedFromRoom` delegates to `withRoomEnded`, which does not reset `lobbyMode`, `lobbyStatus`, `errorMessage`, or `roomIdInput`. These fields carry values from when the kick arrived and remain in memory on the `room-ended` screen. No stale state is currently user-visible (screens are exclusive and `backToLobby` calls `resetToLobby`), but the inconsistency is a maintenance trap — `withRoomEnded` is designed for voluntary exits, not lobby-cleanup transitions.

---

### 2.3 [Low] `clearRoomArtifacts` does not clean `roomNameToId` (was §1.4) → BL-ROOM-NAME-ARTIFACTS-01

**File:** `backend/src/signaling/registerSocketHandlers.ts`, lines 176–184

`clearRoomArtifacts` handles auth, grace timers, rate-limit records, reconnect tokens, and the lock chain — but not `state.roomNameToId`. All current destroy paths clean the name correctly via `removeParticipantBySocket` or explicit `delete` calls in `destroyRoom` and `handleGuestGraceExpired`. The latent risk is a future destroy path that calls `clearRoomArtifacts` directly and leaks the room name until server restart. The function name reads as "clean up all room artifacts."

---

### 2.4 [Low] Solo-host timer restart is hand-rolled in the kick handler (was §2.1) → BL-REFACTOR-SOLO-TIMER-01

**File:** `backend/src/signaling/registerSocketHandlers.ts`, lines 799–813

The kick handler open-codes the entire solo-host timer lifecycle: `clearTimeout`, compute deadline, `setTimeout`, `.unref?.()`, write `soloHostDeadlineAt`. This is the pattern `graceWindowManager.ts` was built to encapsulate. A future change to the timeout value or `unref` behavior must be applied in two places.

**Suggested fix:** Extract `restartSoloHostTimer(roomId, policy, nowFn)` in `graceWindowManager.ts` and call it from both paths.

---

### 2.5 [Nit] `withRoomEnded` / `resetToLobby` duplicate 18-line state-clearing block (was §2.2) → BL-REFACTOR-STATE-CLEAR-01

**File:** `frontend/src/features/room/state-utils.ts`, lines 270–331

Both functions zero out the same ~18 session fields. Only `screen`, `roomEndedMessage`, `lobbyMode`, `lobbyStatus`, and `errorMessage` differ. Every new session field requires parallel edits in both functions; `typingPeerIds` and `hostId` already required this. A shared `clearSessionFields(state)` helper would make additions O(1).

---

### 2.6 [Low] Falsy-zero guard on `getSoloWaitingText` / `getLifetimeText` (was §4.1) → BL-TIMER-FALSY-ZERO-01

**File:** `frontend/src/features/room/useVaporRoom.ts` (pre-existing)

```ts
if (!soloHostDeadlineAt) return null   // ← treats 0 as missing
if (!expiresAt) return null             // ← same in getLifetimeText
```

Unix timestamp `0` is falsy. In production this is unreachable (wall-clock values are in the billions), but in test environments where `now()` is mocked to `0` both countdown UIs return `null` silently, making timer tests vacuously pass. Correct guard: `if (soloHostDeadlineAt === null || soloHostDeadlineAt === undefined)`.

---

## 3. Spec-Fidelity Checks That Passed

- **D-1 (dvh height):** `.vapor-app-frame` removes `aspect-ratio: 9/19.5` and adds `height: calc(100dvh - 6rem)` with `max-height` preserved ✅.
- **D-2 (kick socket reset):** `disconnect()` + `setTimeout(connect, 0)` sequence with `clearRoomSession()` called first (preventing auto-resume on reconnect) ✅.
- **D-3 (solo timer on kick):** Backend computes `deadline` and includes `soloHostDeadlineAt` in `peer_left` payload when `remainingCount === 1`; frontend `onPeerLeft` reads it and updates state ✅.
- **D-4 (room name resolution):** `state.rooms.has(inputRoomId)` checked first (ID wins), then `roomNameToId.get(inputRoomId.toLowerCase())` — ID lookup takes priority, preventing name-collision hijack ✅.
- **D-5 (notification privacy):** `notifyNewMessage` body is generic; no message content; no server interaction; `typeof Notification === 'undefined'` guard present; no `localStorage`/`sessionStorage` write ✅.
- **D-6 (component separation):** `RoomView.tsx` and `RoomViewDesktop.tsx` share identical props interface; business logic stays exclusively in `App.tsx`/`useVaporRoom.ts`; `LobbyView` unchanged for all viewports ✅.
- **D-7 (participant panel layout):** Mobile uses top-dropdown accordion in `RoomView`; desktop uses collapsible right column in `RoomViewDesktop`; `AvatarStack` removed with no stale references ✅.
- **D-8 (layout mode isolation):** `LAYOUT_MODE_KEY` appears only in `layoutMode.ts`/`useLayoutMode.ts`; backend has zero hits; no socket/WebRTC payload carries layout preference; `setMode` is try/catch-guarded ✅.
- **D-9 (desktop container):** `RoomViewDesktop` uses centered fixed min/max-width container; no `vapor-app-frame` ✅.
- **VP-8.5 name validation:** `validateRoomName` correctly accepts `[a-z0-9-]`, 3–24 chars after lowercasing; rejects spaces, short strings, long strings ✅.
- **Room name cleanup:** Three explicit deletion points (`removeParticipantBySocket`, `destroyRoom`, `handleGuestGraceExpired`) cover all current destroy paths; `resetSignalingState` clears the map ✅ (latent gap in `clearRoomArtifacts` tracked as BL-ROOM-NAME-ARTIFACTS-01).
- **`useLayoutMode` listener:** Single `MediaQueryList` created in `useEffect` with a `[]` dep array; `removeEventListener` called with the same handler reference in the cleanup; no stale closure risk ✅.
- **Host badge threading:** `hostId` correctly passed from `App.tsx` → `RoomView` → `MessageFeed`; `RoomViewDesktop` also passes `hostId` to its `MessageFeed` ✅.

---

## 4. Disposition Summary

| # | Severity | Finding | Action |
|---|---|---|---|
| 1.1 | **Medium** | `notifyNewMessage` fires for any non-typing JSON frame — must gate on explicit chat-message types (text, not file/join/leave/protocol frames) | **Resolved** |
| 2.1 | High | `peer_left` emitted to kicked socket before disconnect | Tracked → BL-KICK-PEER-LEFT-01 |
| 2.2 | Medium | `withKickedFromRoom` leaves stale lobby state | Tracked → BL-KICK-STATE-CLEANUP-01 |
| 2.3 | Low | `clearRoomArtifacts` missing `roomNameToId` cleanup | Tracked → BL-ROOM-NAME-ARTIFACTS-01 |
| 2.4 | Low | Solo-host timer hand-rolled in kick handler | Tracked → BL-REFACTOR-SOLO-TIMER-01 |
| 2.5 | Nit | `withRoomEnded`/`resetToLobby` duplicate state-clearing block | Tracked → BL-REFACTOR-STATE-CLEAR-01 |
| 2.6 | Low | Falsy-zero guard on timer countdown functions | Tracked → BL-TIMER-FALSY-ZERO-01 |

**Blocker for sign-off:** Finding 1.1 is the only in-scope correctness fix before E2E sign-off. All other findings are tracked in Backlog.md for Phase 9.
