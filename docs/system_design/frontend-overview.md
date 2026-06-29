# Vapor Frontend Overview

Date: 2026-06-22  
Owner: @fe-expert  
Status: Active

## Purpose

Developer orientation for the Vapor frontend — code structure, key files, and hook/state architecture.

For UI/UX behavior, screens, copy, timers, lifecycle sequences, and event mapping, see [frontend-ui-spec.md](./frontend-ui-spec.md).

System behavior authority remains the normative docs — see [INDEX.md](./INDEX.md).

---

## Frontend Responsibilities

- Provide mobile-first create/join/reconnect/in-room UX.
- Use Socket.IO for signaling and lifecycle coordination.
- Use WebRTC DataChannels for P2P chat (server never sees chat content).
- Keep sensitive data ephemeral and memory-first.
- Manage participant kick (host only) and typing indicators.

---

## Key Files (where to start reading)

| File | Purpose |
|---|---|
| `frontend/src/App.tsx` | Top-level router; maps `screen` state to `LobbyView`, `RoomView`, `RoomEndedView` |
| `frontend/src/features/room/useVaporRoom.ts` | Root state machine hook; the single source of all room state and actions |
| `frontend/src/features/room/types.ts` | All shared types, state shape (`RoomSessionState`), actions (`RoomSessionActions`), `RoomSocketClient` interface |
| `frontend/src/features/room/state-utils.ts` | Pure immutable state reducers (20+ named functions); never mutates state directly |
| `frontend/src/features/room/webrtc-chat-mesh.ts` | `VaporWebRtcChatMesh` class — WebRTC full mesh, offer/answer/ICE, data channel dispatch |
| `frontend/src/features/room/room-socket-client.ts` | Wraps the raw Socket.io client into a typed `RoomSocketClient` interface |
| `frontend/src/features/room/constants.ts` | `SIGNALING_URL`, `WEBRTC_ICE_SERVERS`, `UI_COPY` (all user-facing strings) |
| `frontend/src/features/room/error-copy.ts` | Maps error codes to UI copy; normalizes auth failures to `INVALID_PASSWORD` semantics |

---

## Hook Architecture

`useVaporRoom` is the root hook. It composes these sub-hooks:

| Hook | Responsibility |
|---|---|
| `useSocketConnection` | Socket.io connect/disconnect lifecycle; registers/unregisters all server event listeners |
| `useChatMessaging` | Pending message queue, flush on channel open, send, incoming message handler |
| `useTypingIndicator` | Debounced typing start/stop; 5s safety auto-clear per peer |
| `useJoinRateLimit` | Rate limit countdown timer; clears when window expires |
| `useSessionPersistence` | Read/write reconnect token and roomId from `sessionStorage` |

All sub-hooks are in `frontend/src/features/room/hooks/`.

---

## State Management Pattern

- **Single root state object** (`RoomSessionState`) lives in `useVaporRoom` via `useState`.
- **All mutations go through reducers** defined in `state-utils.ts` — functions like `withPeerJoined`, `withRoomEnded`, `resetToLobby`. No direct state mutation.
- **Socket and peerMesh stored in refs** to avoid re-registering listeners on every render.
- **Derived state** (connection text, room status, chat status) is computed inside `useVaporRoom` before returning.

Lifecycle sequences, error copy, zero-trace data handling, and the frontend-backend event map are in [frontend-ui-spec.md §9–10](./frontend-ui-spec.md).
