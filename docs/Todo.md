# Vapor Project Roadmap (Current)

Docs index: [docs/README.md](README.md) — compact agent entry point.

Date: 2026-06-29

## Purpose
Tracks active phase work only. Each phase section lists the VP tasks for that phase and their completion state. Resolved items and historical phases are not kept here — they are archived in phase work documents under `docs/work/archive/`.

---

## 🛠️ Execution Rules
- VP IDs must stay stable and traceable across docs, tests, and matrices.
- Every slice must be test-first and map to deterministic evidence before closure.
- No room/session/password/token/chat data may be persisted outside RAM or logged in plaintext.
- Reference current phase work before backlog items when the roadmap is read top to bottom.

---

## Phase 12: Design Decisions & Bug Fixes

**Status:** Planned  
**Trigger:** Four open design decisions gate downstream bug fixes. Resolving them first prevents implementing frontend error handling or capacity logic against wrong assumptions.

**Scope:**

### Design Decisions (resolved)

- [x] **VP-12.1 Resolve Contract/Code Drifts** *(BL-DOC-CONTRACT-DRIFT-01)*
  - Three drifts resolved — all implemented in code (not dropped from spec):
  - **(1) `session_resumed` event** — **Implement with compatibility negotiation.** Resume carries a distinct payload including `hostReconnectGraceDeadlineAt`. New clients advertise `supportsSessionResumed: true` and receive `session_resumed`; clients without the capability receive the equivalent legacy `room_joined` response.
  - **(2) `peers[].isHost` field** — **Implement.** Add `isHost: peer.participantId === room.hostId` to the peers map in `roomLifecycle.ts` `joinRoomRecord` and the resume handler in `registerSocketHandlers.ts`. Update `shared/payloads.ts` peers type to `Array<{ participantId: string; nickname: string | null; isHost: boolean }>`. `signaling-contract.md` §3/§5 already correct — code-only fix.
  - **(3) Granular resume error codes** — **Implement.** Backend `resume_session` emits specific codes per failure path: token hash not found → `RECONNECT_TOKEN_STALE`; participant not disconnected → `RECONNECT_TOKEN_STALE`; grace expired + host → `HOST_RECONNECT_WINDOW_EXPIRED`; grace expired + guest → `RECONNECT_TOKEN_STALE`; room destroyed after valid token → `ROOM_NOT_FOUND`. Also clean up `error-codes.md` line 13 (`ROOM_NOT_FOUND` still references `liveCount === 0` gate removed in Phase 11 OOS-3).

- [x] **VP-12.2 Resolve Capacity Gate Semantics** *(BL-SIG-ROOMFULL-GHOST-01)*
  - **Decision: Gate stays on `participants.size`. Grace slots are reserved capacity — a disconnecting participant holds their nickname AND their capacity slot for the full grace window.**
  - Gate-on-liveCount is broken: if 3 of 5 members enter grace and 3 new joiners fill those "open" live slots, the room reaches `participants.size` = 8. `resume_session` replaces sentinels in-place (no capacity check), so all 8 become live — violating the 5-person cap.
  - **Fix is display-side only:**
    - Add `reconnectingCount` (in-grace `disconnected:` sentinel count) to `room_joined`, `peer_joined`, and `peer_left` payloads.
    - `ROOM_FULL` error copy updated: "Room is at capacity — some slots are held for reconnecting participants."
    - Keep the roster live-only and show reserved capacity separately as `N connected · M reconnecting`.
  - No gate logic changes.

### Implementation

- [ ] **VP-12.3 Resume Session Event & Granular Error Codes** *(BL-DOC-CONTRACT-DRIFT-01, BL-RESUME-DEAD-ROOM-UI-01)*
  - Implements VP-12.1 decisions (1) and (3) in code, and closes the resume UI transition gap.
  - **Backend:** Capability-advertising clients receive `SESSION_RESUMED`; legacy clients receive `roomJoined`. Replace resume failure sites with the specific code per the VP-12.1 mapping.
  - **Shared:** Add `SESSION_RESUMED` to `SERVER_EVENT_NAMES` in `shared/events.ts`. Add `SessionResumedPayload` type to `shared/payloads.ts` (extends join payload with `hostReconnectGraceDeadlineAt?: number`).
  - **Frontend:** Add `onSessionResumed` handler (mirrors `onRoomJoined` but also populates `hostReconnectGraceDeadlineAt` in state). Wire it through `room-socket-client.ts`, `useSocketConnection.ts`, `useVaporRoom.ts`. The existing `onError` branches already call `resetToLobby` for both codes in the `autoResumeRequestedRef` and `screen === 'reconnecting'` paths — verify the edge case where neither branch catches the error (`screen === 'room'`, ref already cleared) and add a `withRoomEnded` guard there.
  - **Docs:** `error-codes.md` line 13 — remove the stale `liveCount === 0` clause from `ROOM_NOT_FOUND`.

- [ ] **VP-12.4 Capacity Display & ROOM_FULL Copy** *(BL-SIG-ROOMFULL-GHOST-01)*
  - Implements VP-12.2 display fix.
  - **Backend:** Derive `reconnectingCount = participants.size - getLiveParticipantCount(room)` and include it in `room_joined`, `peer_joined`, and `peer_left` payloads (optional field, 0 when no grace-held participants).
  - **Shared:** Add `reconnectingCount?: number` to `RoomJoinedPayload`, `PeerJoinedPayload`, `PeerLeftPayload`.
  - **Frontend:** Normalize and consume `reconnectingCount`, display it separately from the live roster, and update `ROOM_FULL` copy to explain reserved reconnect slots.

- [ ] **VP-12.5 Fix `peers[].isHost` in Join/Resume Payloads** *(BL-DOC-CONTRACT-DRIFT-01)*
  - Implements VP-12.1 decision (2).
  - **Backend:** In `roomLifecycle.ts` `joinRoomRecord`, add `isHost: peer.participantId === room.hostId` to the peers `.map()`. In `registerSocketHandlers.ts` resume handler (line ~622–624), add the same field to the inline peers map. Note: `room.hostId` is available at both sites.
  - **Shared:** Update `shared/payloads.ts` peers type from `Array<{ participantId: string; nickname?: string | null }>` to `Array<{ participantId: string; nickname: string | null; isHost: boolean }>` in `RoomJoinedPayload` (and the new `SessionResumedPayload`).
  - **Frontend:** Update any peer-list render site that currently derives host status from `peer.participantId === state.hostId` to use `peer.isHost` directly.

- [ ] **VP-12.6 Fix WebRTC Sync-Peers Race** *(BL-WEBRTC-SYNCPEERS-RACE-01)*
  - `onPeerLeft` derives `remainingPeerIds` from `stateRef.current.participants` then calls `syncPeers`. `peer_joined` updates `participants` via async `setState`, so if `peer_left` fires before the `peer_joined` commit, `syncPeers` prunes the new peer's active connection.
  - **Fix:** Keep the state updater pure. Mark repair pending before the update, then synchronize once from committed participant state in an idempotent commit-phase effect.

- [ ] **VP-12.7 Fix Closed Data Channel Reuse** *(BL-WEBRTC-CLOSED-CHANNEL-REUSE-01)*
  - `syncPeers` detects a peer needs a new offer (`needsOffer` returns `true`) but `startOffer`'s guard `if (!this.dataChannels.has(peerId))` blocks channel creation when a `'closed'` channel still occupies `dataChannels`. The renegotiated offer carries no usable data channel.
  - **Fix:** In `startOffer`, before the `has(peerId)` guard, delete any `'closed'` or `'closing'` channel for that peer from `dataChannels` so the guard passes and a fresh channel is created.

- [ ] **VP-12.8 Fix Timer Double-Countdown** *(BL-UX-TIMER-DOUBLE-COUNTDOWN-01)*
  - `derived.expiresAt = Math.min(expiresAt, hostReconnectGraceDeadlineAt, soloDeadlineAt)` means when a solo deadline is active, both `SoloWaitingChip` and `RoomLifetimeChip` display the same countdown simultaneously.
  - **Fix:** Remove `soloDeadlineAt` from the `Math.min` — `SoloWaitingChip` already surfaces it exclusively. Also exclude `hostReconnectGraceDeadlineAt` from the lifetime number — the host grace deadline belongs in a separate indicator, not in "room ends in", which should reflect only the room TTL.

---

## 🗂️ Notes
- Completed work and long history are archived separately under `docs/work/archive/`.
- Completed phase summaries: See `docs/Completed.md`.
