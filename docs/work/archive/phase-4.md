# Phase 4 — Detailed Work Matrix

Date: 2026-06-04
Owner: @vapor-pm
Status: Active

## Purpose
Detailed execution plan for Phase 4 focusing on identity display, performance optimization, open-room support, and advanced peer features.

## Table of Contents
- [1. VP-4.1 Identity & UX Refinement](#1-vp-41-identity--ux-refinement)
- [2. VP-4.2 Performance & Observability](#2-vp-42-performance--observability)
- [3. VP-4.3 Open Rooms (Password-less)](#3-vp-43-open-rooms-password-less)
- [4. VP-4.4 Advanced Peer Interaction](#4-vp-44-advanced-peer-interaction)

---

## 1. VP-4.1 Identity & UX Refinement

### 1.1 Implementation Plan

| Subtask | Task | Module / Interface | Detail | Responsibility | Pass Criteria | Evidence Pointer |
|---|---|---|---|---|---|---|
| 4.1.0 | Root Cause Analysis: Nickname Display | backend handlers, frontend/src/features/room/ | **Gap confirmed via code inspection:** `joinRoomRecord` maps peers as `Array<{ participantId }>` (nickname absent); `peer_joined` emits `{ participantId, participantCount }` (nickname absent); `resume_session` also builds peers without nickname. Backend emission gap confirmed. 4.1.1 is required. | @sys-architect, @fe-expert | Gap confirmed: backend emission gap identified. Proceed to 4.1.1–4.1.3. | code inspection complete |
| 4.1.1 | Fix nickname inclusion in peer signaling | backend handlers | Update `joinRoomRecord` to include `nickname` in the returned `peers` array. Update `peer_joined` handler to include `nickname` in its payload. Update `resume_session` peers mapping to include `nickname`. | @sys-architect | Nicknames are present in emitted join payloads. | backend integration tests |
| 4.1.2 | Update UI to display "YOU (nickname)" | frontend/src/features/room/RoomView.tsx | Modify participant roster and chat headers to show "YOU (nickname)" for the local user, consuming the nickname from the payload confirmed by 4.1.0. | @fe-expert | UI clearly identifies the local user with their nickname. | frontend component tests |
| 4.1.3 | Add nickname changed notifications | frontend/src/features/room/RoomView.tsx | Implement a toast or notification in the chat feed when a peer's nickname is updated. | @fe-expert | Users see a notification when peers change names. | frontend UI tests |

### 1.2 Test Plan

| Test # | Suite | Purpose | Verification Focus |
|---|---|---|---|
| T4.1-01 | backend/tests/socket.integration.test.ts | Verify `room_joined` peers list includes `nickname` for every peer, with values matching nicknames submitted at join/create. | Payload completeness and value accuracy. |
| T4.1-02 | backend/tests/socket.integration.test.ts | Verify `peer_joined` includes the joining peer's `nickname` field with the correct value. | Broadcast payload completeness and value accuracy. |
| T4.1-03 | frontend/tests/contract.integration.test.mjs | Verify UI correctly renders local user nickname. | UI identity accuracy. |
| T4.1-04 | backend/tests/socket.integration.test.ts | Verify `room_created` includes `participantNickname` matching the nickname submitted at creation. | `room_created` payload completeness for host identity. |
| T4.1-05 | backend/tests/socket.integration.test.ts | Verify `resume_session` response includes `participantNickname` for the resuming participant and a `peers` list where each entry carries a `nickname`. | Nickname completeness on the resume path. |

---

## 2. VP-4.2 Performance & Observability

### 2.1 Implementation Plan

| Subtask | Task | Module / Interface | Detail | Responsibility | Pass Criteria | Evidence Pointer |
|---|---|---|---|---|---|---|
| 4.2.1 | Engineering Diagnostics Overlay | frontend/src/features/room/RoomView.tsx | Add a toggleable overlay showing Socket latency, WebRTC connection states, and bitrate. | @fe-expert | Real-time diagnostics are visible to developers. | manual verification |
| 4.2.2 | Refactor High-Frequency Timers | frontend/src/features/room/useVaporRoom.ts | Move 1s timers (lifetime/solo) to small, decoupled components to reduce main `RoomView` re-renders. | @fe-expert | Reduced render churn on `RoomView`. | React DevTools Profiler |
| 4.2.3 | Memoize UI Components | frontend/src/features/room/ | Apply `React.memo` and `useMemo` strategically to Lobby and Room sub-components. | @fe-expert | Significant reduction in unnecessary re-renders. | React DevTools Profiler |
| 4.2.4 | Disable Smoke Layer Animation | frontend/src/index.css | Root-cause investigation confirmed the `.vapor-smoke-layer` CSS animation was the source of significant typing lag for all users. The animations used `mix-blend-mode: screen` with `filter: blur()` on animated pseudo-elements, which prevents the browser from isolating the layer to a separate GPU compositor layer. This forces full-page compositing at ~60fps continuously, delaying DOM repaints (including input value updates after keystrokes). Root cause verified by hiding the smoke layer entirely: typing became responsive immediately. Fix: set `.vapor-smoke-layer { display: none }` to eliminate all animation GPU overhead. A lighter, non-blended ambient background can be reintroduced in a future pass if desired. | @fe-expert | Typing in the chat input is responsive with no perceptible delay for all participants. | Manual E2E user verification (2026-06-04) |

### 2.2 Test Plan

| Test # | Suite | Purpose | Verification Focus |
|---|---|---|---|
| T4.2-01 | frontend performance audit | Verify `RoomView` does not re-render every second. | Render count stability. |
| T4.2-02 | frontend integration | Verify diagnostics overlay displays accurate latency/state. | Telemetry accuracy. |
| T4.2-03 | manual E2E | Verify typing in the chat input is responsive with no perceptible delay for all participants (host and guests). **No automated test — verified by user on 2026-06-04.** | Input responsiveness under live WebRTC session. |

---

## 3. VP-4.3 Open Rooms (Password-less)

### 3.1 Implementation Plan

| Subtask | Task | Module / Interface | Detail | Responsibility | Pass Criteria | Evidence Pointer |
|---|---|---|---|---|---|---|
| 4.3.0 | Update System Design §5: add `hasPassword` to payloads | docs/system_design/Vapor_System_Design.md §5 | Add `hasPassword: boolean` field to `room_created` and `room_joined` payload definitions in System Design §5. Must be done before 4.3.1 and 4.3.4. | @sys-architect | `hasPassword` appears in both payload definitions in §5. | doc review |
| 4.3.1 | Support null passwords in backend | backend handlers, signaling logic | Allow rooms to be created and joined with empty/null passwords. Remove the `INVALID_PASSWORD` early-exit guard triggered by null password on `create_room` and `join_room`. | @sys-architect | Open rooms are accessible without credentials. | backend integration tests |
| 4.3.2 | Update Lobby password labeling | frontend/src/features/room/LobbyView.tsx | Change password input label to "Optional" and update placeholder text. | @fe-expert | UI clearly indicates passwords are optional. | frontend UI tests |
| 4.3.3 | Add Room Security Indicator | frontend/src/features/room/RoomView.tsx | Display a lock/unlock icon showing if the current room is protected, consuming the `hasPassword` field from `room_created`/`room_joined`. | @fe-expert | Users can see room protection status. | frontend UI tests |
| 4.3.4 | Emit `hasPassword` in backend payloads | backend handlers | In `create_room` and `join_room` (and `resume_session`) handlers, include `hasPassword: boolean` in the emitted `room_created` and `room_joined` payloads. `true` when `roomAuthById` has a password hash, `false` for open rooms. | @sys-architect | `hasPassword` is present and accurate in all join/create payloads. | backend integration tests |
| 4.3.5 | Backend: Reject `room_password_update` on open rooms | backend handlers | In the `room_password_update` handler, after the host-identity check, verify that `auth.passwordHash` is non-empty (i.e., the room is password-protected). If the room is open, return `NOT_AUTHORIZED`. This aligns the handler with the updated System Design §4 rule. The existing `hasPassword` field already allows the client to gate the UI without any new payload field. | @sys-architect | `room_password_update` on an open room returns `NOT_AUTHORIZED`; updating a password-protected room still succeeds. | backend integration tests |

### 3.2 Test Plan

| Test # | Suite | Purpose | Verification Focus |
|---|---|---|---|
| T4.3-01 | backend/tests/socket.integration.test.ts | Verify room creation without password succeeds. | Auth logic flexibility. |
| T4.3-02 | backend/tests/socket.integration.test.ts | Verify joining open room without password succeeds. | Join logic flexibility. |
| T4.3-03 | backend/tests/socket.integration.test.ts | Verify `room_created` carries `hasPassword: false` for open rooms and `hasPassword: true` for password-protected rooms; same for `room_joined` when a guest joins each type. | `hasPassword` field accuracy in both payload types. |
| T4.3-04 | backend/tests/socket.integration.test.ts | Verify `resume_session` response includes the correct `hasPassword` value reflecting the room's protection state at resume time. | `hasPassword` field presence and accuracy on the resume path. |
| T4.3-05 | backend/tests/socket.integration.test.ts | Verify joining an open room with a non-empty password supplied still succeeds (open rooms ignore the password field entirely). | Permissive join behavior for open rooms. |
| T4.3-06 | backend/tests/socket.integration.test.ts | Verify `room_password_update` on an open room returns `NOT_AUTHORIZED` and no state mutation occurs. | Open-room password-update guard (subtask 4.3.5). |

---

## 4. VP-4.4 Advanced Peer Interaction

### 4.1 Implementation Plan

| Subtask | Task | Module / Interface | Detail | Responsibility | Pass Criteria | Evidence Pointer |
|---|---|---|---|---|---|---|
| 4.4.1 | Update Signaling Contract for Kick | docs/system_design/Vapor_System_Design.md §5 | Add `kick_participant({ roomId, targetParticipantId })` (client→server, host-only) and `participant_kicked({ participantId })` (server→client) to the Socket Event Contract. System Design must be updated before backend implementation begins. | @sys-architect | Both events appear in System Design §5. | doc review |
| 4.4.2 | Register NOT_AUTHORIZED Error Code | docs/system_design/Vapor_System_Design.md §8, CLAUDE.md | Add `NOT_AUTHORIZED` to the deterministic error code list in System Design §8 and in CLAUDE.md. Used when a non-host attempts a host-only action such as kick. | @sys-architect | Code is listed in §8 and CLAUDE.md error list. | doc review |
| 4.4.3 | Host Moderation: Peer Kick | backend handlers, frontend RoomView | Implement host-only ability to evict a participant. Backend: on `kick_participant`, verify caller is host (emit `NOT_AUTHORIZED` otherwise), disconnect the target socket, and broadcast `participant_kicked({ participantId })` to the room. Frontend: host sees a kick button per peer in the roster; kicked participant receives `participant_kicked` and is redirected to the lobby. | @sys-architect, @fe-expert | Host can disconnect specific guests; non-host kick attempt is rejected. | backend/frontend integration |
| 4.4.4 | P2P Typing Indicators | frontend WebRTC mesh | Broadcast typing status over the existing WebRTC data channel. **Protocol:** sender emits `{ type: 'typing_start' }` on first keypress in the message input and resets a 3s debounce timer on each subsequent keypress; when the timer fires or the message is sent, emit `{ type: 'typing_stop' }`. Receiver shows "X is typing…" on `typing_start`, clears immediately on `typing_stop`, and auto-clears after a 5s safety timeout. Clear on peer disconnect. | @fe-expert | Peers see a typing indicator within one keypress; indicator clears within 3s of inactivity. | frontend WebRTC tests |
| 4.4.5 | Extend FakeIo test harness to support socket disconnect tracking | backend/tests/socket.integration.test.ts | Add a `sockets.sockets` property to `FakeIo` backed by `socketsById`, where each entry exposes a `disconnect(close?: boolean)` method that records the call on the corresponding `FakeSocket`. Expose `wasDisconnected(): boolean` on `FakeSocket`. Required so kick success-path tests (T4.4-03, T4.4-04) can assert that the kicked socket was explicitly terminated by the handler, in addition to verifying state-map cleanup via snapshot. | @sys-architect | `FakeSocket.wasDisconnected()` returns `true` after the kick handler calls `io.sockets.sockets.get(targetSocketId).disconnect(true)`. | backend integration tests |

### 4.2 Test Plan

| Test # | Suite | Purpose | Verification Focus |
|---|---|---|---|
| T4.4-01 | backend/tests/socket.integration.test.ts | Verify non-host kick attempt returns `NOT_AUTHORIZED` and no state change occurs (participant count unchanged, no `participant_kicked` emitted). | `NOT_AUTHORIZED` error code; state immutability on unauthorized kick. |
| T4.4-02 | backend/tests/socket.integration.test.ts | Verify successful kick broadcasts `participant_kicked({ participantId })` to all room members: host, remaining guests, and the kicked participant themselves, before the socket is disconnected. | Broadcast completeness; correct `participantId` in payload for every receiver. |
| T4.4-03 | backend/tests/socket.integration.test.ts | Verify state cleanup after a successful kick: participant removed from `room.participants`, `participantToRoom`, and `socketToParticipant`; reconnect token purged; kicked socket marked as disconnected. | State integrity post-kick; snapshot counts; `FakeSocket.wasDisconnected()`. |
| T4.4-04 | backend/tests/socket.integration.test.ts | Verify `resume_session` with the kicked participant's reconnect token returns `ROOM_NOT_FOUND` after kick. | Reconnect token invalidation on kick. |
| T4.4-05 | backend/tests/socket.integration.test.ts | Verify room participant count decreases by one after a successful kick; no `room_destroyed` is emitted to remaining participants. | Count accuracy; room remains active post-kick. |
| T4.4-06 | backend/tests/socket.integration.test.ts | Verify host attempting to kick themselves returns `INVALID_SIGNAL_PAYLOAD` and no state change occurs. | Self-kick guard. |
| T4.4-07 | backend/tests/socket.integration.test.ts | Verify `kick_participant` with missing `roomId` or empty `targetParticipantId` returns `INVALID_SIGNAL_PAYLOAD`. | Payload validation guard. |
| T4.4-08 | backend/tests/socket.integration.test.ts | Verify kicking a `targetParticipantId` that does not exist in the room returns `ROOM_NOT_FOUND`. | Unknown target guard. |
| T4.4-09 | backend/tests/socket.integration.test.ts | Verify `kick_participant` from a socket not associated with any room returns `ROOM_NOT_FOUND`. | Caller identity guard. |
| T4.4-10 | backend/tests/socket.integration.test.ts | Verify a participant in the guest grace window (disconnected state, `socketId` prefixed `disconnected:`) can be kicked: their entry is removed from state and reconnect token purged. | Kick of grace-window participant. |
| T4.4-11 | frontend/tests/webrtc.integration.test | Verify typing status state changes (start/stop) propagate to peers over the data channel. End-to-end perceived smoothness and latency are validated manually per VP-4.2 criteria. | P2P signal accuracy; manual E2E for responsiveness. |
