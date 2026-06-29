# Vapor System Design Overview

Date: 2026-06-22  
Status: Active

This document is the fast onboarding reference for how Vapor is structured end-to-end. Read this first before diving into any specific file.

> **Audience: humans.** This is a plain-language summary — some overlap with the normative docs is intentional to keep it readable end-to-end. For authority, full detail, and navigation, see [INDEX.md](./INDEX.md); when this summary and a normative doc disagree, the normative doc wins.

---

## 1. What Vapor Is

Vapor is an **ephemeral, zero-persistence P2P chat service**. The server handles only room lifecycle and WebRTC signaling. All chat content flows directly peer-to-peer over WebRTC data channels — the server never sees it. When a room ends, everything is gone.

**Core constraints that shape all architecture decisions:**
- No database, no files, no sessions. All state is RAM-only.
- Host-sovereign room lifetime: if the host leaves or misses reconnect grace, the room dies.
- Server role is signaling only: auth + SDP/ICE relay, nothing else.

---

## 2. Architecture At A Glance

```
Browser A (Host)                    Browser B (Guest)
┌────────────────────┐              ┌────────────────────┐
│  LobbyView /       │              │  LobbyView /       │
│  RoomView /        │              │  RoomView /        │
│  RoomEndedView     │              │  RoomEndedView     │
│       │            │              │       │            │
│  useVaporRoom      │              │  useVaporRoom      │
│  (root hook)       │              │  (root hook)       │
│   ├─ useSocket     │              │   ├─ useSocket     │
│   ├─ useChat       │              │   ├─ useChat       │
│   ├─ useTyping     │              │   ├─ useTyping     │
│   ├─ useRateLimit  │              │   ├─ useRateLimit  │
│   └─ usePersist    │              │   └─ usePersist    │
│       │            │              │       │            │
│  RoomSocketClient  │              │  RoomSocketClient  │
│  (Socket.io wrap)  │              │  (Socket.io wrap)  │
│       │            │              │       │            │
│  VaporWebRtcChat   │◄────────────►│  VaporWebRtcChat   │
│  Mesh (WebRTC)     │  DataChannel │  Mesh (WebRTC)     │
└────────┬───────────┘              └────────┬───────────┘
         │ WSS (signaling events)            │
         └──────────────┬────────────────────┘
                        │
            ┌───────────▼───────────┐
            │  Node.js / Express    │
            │  + Socket.io          │
            │                       │
            │  registerSocket       │
            │  Handlers.ts          │
            │  (orchestrator)       │
            │   ├─ passwordAuth     │
            │   ├─ rateLimiting     │
            │   ├─ reconnection     │
            │   ├─ graceWindow      │
            │   └─ signalRelay      │
            │                       │
            │  RAM-only state       │
            │  rooms / participants │
            │  / socketToParticipant│
            │                       │
            │  GET /health          │
            │  GET /admin/metrics   │
            └───────────────────────┘
```

**Three communication channels:**
1. **Browser ↔ Server (WSS):** Socket.io events for room lifecycle and WebRTC signal relay.
2. **Browser ↔ Browser (WebRTC DataChannel):** P2P chat text and typing control messages.
3. **Browser → Server (HTTP):** `GET /health` only.

---

## 3. Repository Layout

```
Vapor/
├── shared/                  # Signaling contract (imported by both sides)
│   ├── events.ts            # CLIENT_EVENT_NAMES, SERVER_EVENT_NAMES constants
│   ├── error-codes.ts       # SIGNALING_ERROR_CODES constants
│   ├── reasons.ts           # RoomDestroyedReason union type
│   ├── policy.ts            # Rate limit thresholds, cooldown constants
│   ├── payloads.ts          # All request/response payload interfaces
│   └── index.ts             # Barrel re-export
│
├── backend/src/
│   ├── index.ts             # Entry point: load .env, start server
│   ├── server.ts            # createVaporServer(): Express + Socket.io setup, CORS
│   │
│   ├── signaling/
│   │   ├── contracts.ts     # Re-exports from shared/; backend-specific helpers
│   │   ├── state.ts         # Singleton signaling state (rooms, participantToRoom, socketToParticipant maps)
│   │   ├── roomLifecycle.ts # createRoomRecord(), joinRoomRecord(), removeParticipantBySocket()
│   │   └── registerSocketHandlers.ts  # Main orchestrator: wires all socket event handlers
│   │
│   └── signaling/handlers/  # Extracted subsystems
│       ├── passwordAuth.ts      # Argon2id hash/verify, normalizePassword()
│       ├── rateLimiting.ts      # Per-IP create/join rate limits, invalid attempt tracking
│       ├── reconnectionManager.ts  # Token generation/validation, disconnected participant tracking
│       ├── graceWindowManager.ts   # Host & guest grace timers, room TTL management, solo timer
│       └── signalRelay.ts          # handleSignalOffer/Answer/Ice() — relay to target socket
│   │
│   └── admin/
│       ├── metricsRegistry.ts   # Prometheus-style RAM metrics (rooms, participants, uptime)
│       └── createAdminRouter.ts # Express router: GET /health, GET /admin/metrics
│
└── frontend/src/
    ├── main.tsx             # Vite entry point: React.createRoot(App)
    ├── App.tsx              # Top-level router: maps screen state to view components
    ├── index.css            # Tailwind + custom styles
    │
    ├── components/ui/       # Unstyled shadcn/ui primitives (button, input, card, etc.)
    │
    ├── lib/utils.ts         # cn() Tailwind class merging helper
    │
    ├── features/info/       # Static pages
    │   ├── MarkdownPage.tsx     # Generic markdown renderer
    │   ├── FAQPage.tsx          # Wraps faq.md
    │   └── PrivacyPolicyPage.tsx
    │
    └── features/room/       # All room logic lives here
        ├── useVaporRoom.ts      # ROOT HOOK: all state + actions + derived values
        ├── types.ts             # RoomSessionState, RoomSessionActions, RoomSocketClient, all types
        ├── state-utils.ts       # 20+ pure immutable state reducers
        ├── constants.ts         # SIGNALING_URL, WEBRTC_ICE_SERVERS, UI_COPY strings
        ├── error-copy.ts        # mapErrorCode() → user-facing message
        ├── participant-utils.ts # hasParticipant(), getRoomStatus(), getConnectionStatusText()
        ├── room-socket-client.ts   # Wraps Socket.io into typed RoomSocketClient interface
        ├── webrtc-chat-mesh.ts     # VaporWebRtcChatMesh class: full WebRTC mesh logic
        │
        ├── hooks/               # Sub-hooks composed by useVaporRoom
        │   ├── useSocketConnection.ts   # Socket.io connect/disconnect lifecycle
        │   ├── useChatMessaging.ts      # Pending queue, flush, send, incoming dispatch
        │   ├── useTypingIndicator.ts    # Debounced typing start/stop; 5s safety auto-clear
        │   ├── useJoinRateLimit.ts      # Rate limit countdown timer
        │   └── useSessionPersistence.ts # sessionStorage read/write for reconnect token
        │
        ├── LobbyView.tsx        # Create/join form, error states, rate-limit messaging
        ├── RoomView.tsx         # Active room: chat, participants, kick, TTL timer
        └── RoomEndedView.tsx    # Terminal state: reason message + back-to-lobby CTA
```

---

## 4. Frontend State Machine

### 4.1 State Shape (`RoomSessionState`)

The entire frontend state lives in one object managed by `useVaporRoom`. Key fields:

| Field | Type | Purpose |
|---|---|---|
| `screen` | `'lobby' \| 'room' \| 'room-ended'` | Which view is rendered |
| `lobbyMode` | `'create' \| 'join'` | Which form the lobby shows |
| `lobbyStatus` | `'idle' \| 'submitting' \| 'error'` | Lobby form state |
| `errorMessage` | `string \| null` | Inline error copy |
| `roomEndedMessage` | `string` | Copy shown on room-ended screen |
| `activeRoomId` | `string \| null` | Current room ID |
| `participantId` | `string \| null` | Local participant identity |
| `participants` | `Participant[]` | All participants with role flags |
| `participantNicknames` | `Record<string, string>` | participantId → display name |
| `expiresAt` | `number \| null` | Room TTL deadline (Unix ms) |
| `soloDeadlineAt` | `number \| null` | Solo timeout deadline; null when ≥2 participants |
| `hostReconnectGraceDeadlineAt` | `number \| null` | Host grace deadline (shown to guests) |
| `chatMessages` | `ChatMessage[]` | In-memory chat history |
| `chatDraft` | `string` | Current message input value |
| `chatConnectionState` | `'idle' \| 'connecting' \| 'connected'` | WebRTC channel status |
| `connectedPeerCount` | `number` | How many peers have open data channels |
| `socketState` | `'connecting' \| 'connected' \| 'disconnected'` | Socket.io connection status |
| `typingPeerIds` | `string[]` | Peers currently showing typing indicator |
| `hasPassword` | `boolean` | Whether the room is password-protected |
| `joinRateLimitUntil` | `number \| null` | Rate limit window expiry (Unix ms) |
| `copyFeedback` | `string \| null` | Transient "Copied!" feedback |

### 4.2 State Transitions (Screen Flow)

```
lobby (idle)
  → submitLobby()         → lobby (submitting)
  → room_created/joined   → room
  → error event           → lobby (error)

room
  → leaveRoom()           → lobby (idle)   [guest]
  → leaveRoom()           → room-ended     [host: room_destroyed]
  → room_destroyed event  → room-ended
  → participant_kicked    → room-ended     [if local participant was kicked]
  → socket disconnect     → reconnect flow → room (restored via session_resumed) or room-ended

room-ended
  → backToLobby()         → lobby (idle)
```

### 4.3 Reducer Pattern

All state mutations go through named functions in `state-utils.ts`:

```ts
setState(prev => withPeerJoined(prev, payload))
setState(prev => withRoomEnded(prev, 'host_left'))
setState(prev => resetToLobby(prev))
```

Functions never mutate — they return a new state object.

### 4.4 Actions (`RoomSessionActions`)

| Action | What it does |
|---|---|
| `setLobbyMode(mode)` | Toggle create/join form |
| `setRoomIdInput(value)` | Update room ID field |
| `setPasswordInput(value)` | Update password field |
| `setNicknameInput(value)` | Update nickname field |
| `submitLobby()` | Emit `create_room` or `join_room` based on mode |
| `leaveRoom()` | Emit `leave_room`, clear token, reset state |
| `sendChatMessage(text?)` | Send via WebRTC data channel to all peers |
| `kickParticipant(targetId)` | Emit `kick_participant` (host only) |
| `notifyTypingStart()` | Send typing control message to peers |
| `notifyTypingStop()` | Send typing stop control message |
| `copyRoomId()` | Copy room ID to clipboard with transient feedback |
| `backToLobby()` | Reset state to lobby from room-ended screen |

---

## 5. Backend State Model

All state is RAM-only. Core maps on `SignalingState`:

```
rooms: Map<roomId, RoomRecord>
  └─ participants: Map<participantId, ParticipantRecord>
  └─ nicknameToParticipant: Map<nickname_lower, participantId>

socketToParticipant: Map<socketId, participantId>   ← fast socket lookup
participantToRoom: Map<participantId, roomId>        ← reverse lookup
roomNameToId: Map<roomName_lower, roomId>            ← room name lookup
```

Context modules handle the rest: `PasswordAuthContext`, `GraceWindowContext`, `ReconnectContext`, `RateLimitingContext`.

---

## 6. WebRTC Mesh (`VaporWebRtcChatMesh`)

### Topology
Full mesh: every peer has a direct RTCPeerConnection + RTCDataChannel to every other peer. With 5 participants max, this means up to 10 connections total.

### Offer/Answer Initiation Rule
Only the peer with the **lexicographically smaller `participantId`** initiates the offer. The other peer waits for the offer and answers.

### Data Channel Message Format
Two message types share the same channel:
- **Chat message:** plain text string.
- **Control message:** JSON `{ type: "typing_start" | "typing_stop" }`.

### Peer Sync
When `useVaporRoom` receives `peer_joined`, `peer_left`, or `session_resumed`, it calls `mesh.syncPeers(currentParticipantIds)`. The mesh creates connections for new peers and tears down connections for departed ones.

---

## 7. Signaling Flow Walkthrough

### 7.1 Room Create

```
LobbyView.submit()
  → useVaporRoom.submitLobby()
  → socket.emitCreateRoom({ password, nickname })
  → [server] rate limit + blocklist check
  → [server] validate nickname format
  → [server] create RoomRecord in RAM
  → [server] hash password (Argon2id) if provided
  → [server] generate reconnect token
  → [server] start solo timer + room TTL timer
  → [server] emit room_created { roomId, participantId, hostId, participantNickname, reconnectToken, expiresAt, soloDeadlineAt, hasPassword }
  → useVaporRoom.onRoomCreated()
  → setState(withRoomCreated(...))
  → sessionStorage.setItem(reconnectToken, roomId)
  → new VaporWebRtcChatMesh(localParticipantId, socketClient, ICE config)
  → screen transitions to 'room'
```

### 7.2 Peer Joins and WebRTC Handshake

```
[other browser] → socket.emitJoinRoom()
  → [server] validate liveCount > 0, room/password/capacity/nickname
  → [server] emit room_joined to joining peer
  → [server] emit peer_joined to all existing participants

useVaporRoom.onPeerJoined({ participantId: "B", nickname: "Bob" })
  → setState(withPeerJoined(...))
  → mesh.syncPeers(["A", "B"])

VaporWebRtcChatMesh.syncPeers()
  → if localId ("A") < "B": A initiates offer
  → createPeerConnection("B") → createDataChannel → createOffer → setLocalDescription
  → socket.emitSignalOffer({ toParticipantId: "B", sdp })

[server] relays signal_offer to B's socket
B's mesh receives signal_offer
  → setRemoteDescription(offer) → createAnswer → setLocalDescription
  → socket.emitSignalAnswer({ toParticipantId: "A", sdp })

ICE candidates exchanged in parallel via signal_ice relay
Data channel opens → chatConnectionState → 'connected'
```

### 7.3 Host Grace (Host Disconnect)

```
Host socket disconnects unexpectedly
  → [server] start HOST_DISCONNECT_GRACE_MS timer
  → [server] emit peer_left (reason: "disconnect") + host_reconnect_grace { deadlineAt } to remaining guests

Guests receive host_reconnect_grace
  → setState(withHostReconnectGrace(deadlineAt))
  → RoomView shows host grace banner with countdown

Host reconnects within grace window
  → socket.emitResumeSession({ roomId, reconnectToken })
  → [server] validate token + grace
  → [server] cancel grace timer, restore participant identity
  → [server] emit session_resumed to host socket
  → [server] emit peer_joined to remaining guests
  → host UI restores room state; guests see host rejoin

Grace window expires
  → [server] emits room_destroyed { reason: 'host_grace_expired' }
  → all clients → screen = 'room-ended'
```

---

## 8. Session Persistence and Reconnect

When a participant creates or joins, the backend issues a `reconnectToken`. Frontend stores it in `sessionStorage`:

```
sessionStorage key: "vapor_reconnect_token_{roomId}"
value: { reconnectToken, roomId }
```

On page reload or socket reconnect:
1. `useSessionPersistence` reads the token from sessionStorage.
2. `useVaporRoom` emits `resume_session({ roomId, reconnectToken })`.
3. Backend validates token freshness and grace window.
4. On success: `session_resumed` is sent to the reconnecting socket (includes current room state); `peer_joined` is broadcast to others.
5. On failure: token is cleared; user is presented with the lobby.

**Token invalidation triggers:**
- Explicit leave, room destruction, or participant kick.
- Grace window expiry.

---

## 9. Lifecycle Timers (Backend)

| Timer | Duration | Trigger | Result |
|---|---|---|---|
| Room TTL | 2 hours | Room creation | `room_ttl_expired` destroy |
| Solo timeout | 15 min | liveCount becomes 1 (any path, including 0→1); always restarts fresh | `solo_timeout_expired` destroy |
| Empty-room timeout | 15 min | liveCount drops to 0 via unexpected disconnect | `solo_timeout_expired` destroy |
| Host grace | 60 min | Host unexpected disconnect | `host_grace_expired` destroy on timeout |
| Guest grace | 30 min | Guest unexpected disconnect | Guest eviction (room survives) |
| Periodic sweeper | Every 5 hours | Server startup | Prune expired rooms + stale reconnect index entries |

**Timer rule:** Always cancel the existing timer before starting a new one — never allow multiple timers for the same purpose to stack.

**Destruction precedence:** Whichever deadline arrives first wins. Voluntary host leave is immediate and not timer-mediated.

---

## 10. Shared Module Contract (`shared/`)

Both frontend and backend import from `shared/` to avoid drift.

```ts
// Wrong:
socket.emit("create_room", payload)
if (error.code === "ROOM_NOT_FOUND") { ... }

// Right:
socket.emit(CLIENT_EVENT_NAMES.CREATE_ROOM, payload)
if (error.code === SIGNALING_ERROR_CODES.ROOM_NOT_FOUND) { ... }
```

Frontend imports via `@shared` alias. Backend imports via `backend/src/signaling/contracts.ts`.

See [signaling-contract.md](./signaling-contract.md) for full event name and payload reference.

---

## 11. Admin and Observability

`GET /health` — always public, returns `{ status: "ok", uptime }`.

`GET /admin/metrics` — protected by basic auth or token (env-configured). Returns RAM-only aggregate metrics:
- Active room count, participant count, average participants per room.
- Peak connection count, create-room burst rate.
- Free/used RAM, uptime.

**Forbidden from metrics:** passwords, tokens, SDP/ICE, chat content, any per-user data.

---

## 12. Error Codes Reference

| Code | When emitted |
|---|---|
| `ROOM_NOT_FOUND` | Room ID doesn't exist or was destroyed |
| `ROOM_FULL` | Room already has 5 participants |
| `ROOM_EXPIRED` | Room TTL has passed |
| `INVALID_PASSWORD` | Wrong password, or empty password for protected room |
| `HOST_RECONNECT_WINDOW_EXPIRED` | Resume attempted after grace window closed |
| `RECONNECT_TOKEN_STALE` | Token hash doesn't match stored record |
| `RATE_LIMITED` | Create/join rate limit exceeded |
| `INVALID_SIGNAL_PAYLOAD` | Malformed SDP/ICE payload, invalid nickname format, or nickname already taken |
| `NOT_AUTHORIZED` | Non-host tried a host-only action (e.g. kick) |

---

## 13. Key Invariants (Don't Break These)

1. **No persistence.** Nothing about rooms, participants, tokens, or chat may touch disk or a DB.
2. **Server never sees chat.** Chat flows over WebRTC data channels only.
3. **One host per room.** Changing host identity is not supported.
4. **Password cannot be changed.** To open a protected room, destroy and recreate it.
5. **Reconnect token is tab-scoped.** It lives in `sessionStorage`, not `localStorage`.
6. **Room destruction is atomic.** All indexes, timers, and socket memberships must be cleared in one step.
7. **Error codes are an explicit closed set.** Do not add new codes without updating `shared/error-codes.ts`, the backend, and `error-copy.ts`.
8. **Timers never stack.** Always cancel the existing timer before starting a new one for the same purpose.
