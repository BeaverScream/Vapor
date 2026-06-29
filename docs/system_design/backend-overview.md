# Vapor Backend Overview

Date: 2026-06-26  
Owner: @be-expert  
Status: Active

## Purpose

Developer orientation for the Vapor backend — code structure, key files, the in-RAM state model, and the lifecycle/handler architecture.

For the wire protocol (event names, payload shapes, error codes), see [signaling-contract.md](./signaling-contract.md).

System behavior authority remains the normative docs — see [INDEX.md](./INDEX.md).

---

## Backend Responsibilities

- Signaling only — relay WebRTC offer/answer/ICE between peers; **never** sees or stores chat content.
- Own room lifecycle: creation, host/guest disconnect grace, solo timeout, room TTL, destruction.
- Hold all room/participant state in RAM (Maps); zero persistence of user data.
- Enforce password auth (Argon2id), rate limiting, payload validation, and host-only actions (kick, password rotation).
- Expose token/basic-auth-gated admin metrics endpoints (operational data only, no user content).

---

## Key Files (where to start reading)

| File | Purpose |
|---|---|
| `backend/src/index.ts` | Process entry; reads env, calls `createVaporServer`, starts listening |
| `backend/src/server.ts` | Wires Express, Socket.io, metrics, admin router, and `registerSocketHandlers`; returns `{ app, io, state, testHooks, start, stop }` |
| `backend/src/signaling/registerSocketHandlers.ts` | The signaling core — all `socket.on(...)` handlers, room destruction, solo/grace orchestration, the periodic sweep |
| `backend/src/signaling/state.ts` | The RAM state shape (`SignalingState`) and its create/reset/snapshot functions |
| `backend/src/signaling/roomLifecycle.ts` | Pure-ish room/participant mutations: `createRoomRecord`, `joinRoomRecord`, `removeParticipantBySocket` |
| `backend/src/signaling/contracts.ts` | Re-exports event names, error codes, and timing constants from `@shared` for backend use |
| `backend/src/signaling/backendUtils.ts` | `generateToken` (room/participant ids) and `validateRoomName` |

### Handler modules (`backend/src/signaling/handlers/`)

Each exports a `create*Context()` factory plus pure functions that operate on that context. Contexts are created once inside `registerSocketHandlers` and closed over — **no module-level mutable state**.

| Module | Responsibility |
|---|---|
| `signalRelay.ts` | Validate + size-cap offer/answer/ICE payloads; resolve the target socket and relay |
| `passwordAuth.ts` | Argon2id hashing, peppered verify, per-room auth record, password rotation (`passwordVersion`) |
| `rateLimiting.ts` | Create-burst, per-IP abuse, and per-room invalid-password cooldown/lockout tracking |
| `reconnectionManager.ts` | Reconnect tokens (SHA-256 hashed + peppered), disconnect marking, token sweep |
| `graceWindowManager.ts` | Per-room policy timers: room TTL, solo timeout, host grace, per-guest grace |

### Admin subsystem (`backend/src/admin/`)

Operational metrics only. Injected via accessor functions so `admin/` never imports from `signaling/`. Disabled unless `ADMIN_API_TOKEN` or `ADMIN_BASIC_USER`/`PASS` is set.

| File | Purpose |
|---|---|
| `metrics.ts` | Counters/gauges + `collectMetricsSnapshot()`; reads live counts through injected accessors |
| `routes.ts` | Auth-gated `/admin/metrics` and `/admin/history` Express router |
| `auth.ts` | `requireAdminAuth` middleware (token / basic auth) |
| `analytics.ts` | `CsvAnalyticsStore` — periodic operational rows to CSV |
| `scheduler.ts` | Periodic flush of metric deltas + scheduled report generation |
| `reports.ts` / `emailDelivery.ts` | Daily/weekly/monthly report rendering and email send |
| `metricsRegistry.ts` | Legacy connection/room counters bridged via the metrics adapter in `server.ts` |

---

## State Model

All state lives in a single `SignalingState` object (`state.ts`) made of Maps — created once per server, never persisted:

| Map | Key → Value |
|---|---|
| `rooms` | `roomId` → `RoomRecord` (participants, `hostId`, `createdAt`, optional `roomName`, `nicknameToParticipant`) |
| `participantToRoom` | `participantId` → `roomId` |
| `socketToParticipant` | `socketId` → `participantId` |
| `roomNameToId` | normalized `roomName` → `roomId` (custom join-by-name) |

Auth records, reconnect tokens, rate-limit counters, and grace/policy timers live in **separate handler contexts** (not in `SignalingState`), each keyed by `roomId` or `participantId`.

A disconnected-but-in-grace participant is kept in `room.participants` with its `socketId` rewritten to the sentinel `disconnected:<participantId>`. Live-occupancy checks use `getLiveParticipantCount`, which skips these sentinels — the roster Map and the live count are two distinct concerns.

---

## Lifecycle & Handler Architecture

- **One connection handler.** `io.on("connection")` registers every `socket.on(...)` listener. Handlers validate payload → check auth/rate limits → mutate state via `roomLifecycle`/handler functions → emit server events.
- **Room destruction is centralized.** `destroyRoom(roomId, reason)` is the single teardown path: clears policy timers, reconnect tokens, auth, rate-limit records, nickname maps, and all index Maps, then emits `room_destroyed`. Every lifecycle trigger routes through it.
- **Timer-driven policies** live in `graceWindowManager`: room TTL (`ROOM_MAX_DURATION_MS`), solo timeout (`SOLO_ROOM_TIMEOUT_MS` — applies to any lone live participant, not host-specific), host grace (`HOST_DISCONNECT_GRACE_MS`), guest grace (`GUEST_DISCONNECT_GRACE_MS`). All timers `unref()` so they never keep the process alive.
- **Solo timeout applies to any lone live participant.** `restartSoloTimerIfSolo` restarts the deadline whenever a room drops to exactly one *live* participant, host or guest. The same 15-min timer continues to govern a fully empty room (`liveCount` 0) and fires `solo_timeout_expired`.
- **Async mutations take a per-room lock.** `withRoomLock(roomId, fn)` serializes `resume_session` and `room_password_update` against one another to avoid interleaved state races.
- **Periodic sweep** (`setInterval`, `sweepIntervalMs`) is a safety net, not the primary path: it destroys TTL-expired rooms, prunes expired reconnect tokens and rate-limit records, and reconciles orphaned index entries.

Timing constants and event/error names are imported from `@shared` via `contracts.ts` — never hard-code them in handlers.
