# Vapor Core Architecture (Source of Truth)

Date: 2026-06-29

Part of the Vapor system-design source-of-truth set — navigate via [INDEX.md](./INDEX.md). This file owns the non-negotiable principles, storage boundaries, system constants, RAM-only state model, and password/nickname rules. Behavioral lifecycle, the wire protocol, file transfer, error codes, and observability live in sibling normative docs: [lifecycle.md](./lifecycle.md), [signaling-contract.md](./signaling-contract.md), [file-transfer.md](./file-transfer.md), [error-codes.md](./error-codes.md), [observability.md](./observability.md).

Implementation phasing and slice sequencing are tracked in [Todo.md](../Todo.md). If roadmap phase scope conflicts with architecture/lifecycle/security rules in the normative set, the normative set is authoritative.

## 1) Non-Negotiable Principles

- **Zero server persistence:** No DB/files for rooms, participants, signaling payloads, passwords, or tokens.
- **Host-sovereign room lifetime:** If host leaves voluntarily or misses reconnect grace, room is destroyed.
- **Server role is signaling only:** Server handles auth + SDP/ICE relay; chat/file content is P2P over WebRTC.
- **Production transport security:** HTTPS/WSS required.
- **No secret logging:** Never log raw passwords, reconnect tokens, SDP, ICE, or plaintext user data.

## 1.1) Frontend Token Storage Policy

- **Reconnect Token:** Frontend stores in `sessionStorage` during active room session.
  - Survives tab refresh and unintended disconnects within same tab.
  - Automatically cleared on tab close (browser native behavior).
  - Frontend must clear entry on explicit leave, room destruction, or grace expiry.
- **Password:** Never persisted (memory-only, cleared on exit).
- **SDP/ICE:** Memory-only (never logged or stored).
- **Theme (personal client-side preference):** The Light/Dark/Blue theme is a per-user UI preference, not shared session data. Persisted in `sessionStorage` only (key `vapor.theme`), bound to `data-theme` on `<html>`; resets to the default `blue` on tab close. Zero shared-data persistence — no backend, no socket event, no WebRTC data-channel message, no `localStorage`/cookie. The signaling contract is unchanged.
- **Chat History:** Chat messages are persisted in `sessionStorage` per room during an active session. This is **tab-scoped, session-scoped volatile storage**, not shared or server-persisted — each tab keeps its own copy of what it received over WebRTC; copies can legitimately differ and there is no replay/backfill. Implementation: a single `sessionStorage` entry per room keyed `vapor.chat:<roomId>` holds a JSON array of chat messages, overwritten (not appended) on each new message. On reconnect (`resume_session` → `room_joined`), the displayed history is restored from this local entry — never from the server and never via re-delivery. Reconnect guarantees: the outbound pending queue is dropped so pre-drop messages are not re-flushed to peers, and appends are idempotent by `messageId` so a restored entry is never shown twice. Cleared **only on terminal events** — explicit leave (`leave_room`)/back-to-lobby, kick, room destruction (`room_destroyed`, which covers host grace expiry), and a failed/stale resume (`RECONNECT_TOKEN_STALE` / `HOST_RECONNECT_WINDOW_EXPIRED`, covering guest grace expiry) — plus native clearing on tab close. **Never** cleared on a recoverable TCP drop.

This preserves ephemeral architecture while improving UX for accidental disconnects: tokens and chat are tab-scoped volatile, not server-persisted secrets.

## 1.2) Abuse-Control Storage Boundary

- Backend remains fully RAM-only and stateless across process restarts.
- Vapor does not use client-side anti-abuse friction by default.
- Abuse handling is detect-and-block: monitor anomalous create-room bursts, then apply temporary in-memory blocks per IP when thresholds are exceeded.
- Any future client-side friction must be optional, explicitly justified, and outside the canonical zero-trace baseline.
- Abuse controls must never store chat/file content, plaintext password, reconnect token, SDP/ICE, or PII.

## 2) System Constants

```ts
export const SIGNALING_CONST = {
  MAX_PARTICIPANTS_PER_ROOM: 5,
  IDLE_ROOM_TIMEOUT_MS: 15 * 60 * 1000,
  ROOM_MAX_DURATION_MS: 2 * 60 * 60 * 1000,
  HOST_DISCONNECT_GRACE_MS: 60 * 60 * 1000,
  GUEST_DISCONNECT_GRACE_MS: 30 * 60 * 1000,
  SWEEPER_INTERVAL_HOURS: 5,
  NICKNAME_MIN_LENGTH: 3,
  NICKNAME_MAX_LENGTH: 24,
  JOIN_RATE_LIMIT_WINDOW_MS: 60_000,
  JOIN_RATE_LIMIT_MAX: 30,
  CREATE_RATE_LIMIT_WINDOW_MS: 60_000,
  FILE_TRANSFER_MAX_SIZE_BYTES: 2 * 1024 * 1024 * 1024,  // 2 GB hard limit
  FILE_TRANSFER_CHUNK_SIZE_BYTES: 64 * 1024,              // 64 KB per chunk
  FILE_OFFER_TIMEOUT_MS: 60_000,                          // 60 s offer window
  FILE_TRANSFER_EXPIRY_WARNING_MS: 15 * 60 * 1000,        // warn when < 15 min until room expires
} as const;
```

- `JOIN_RATE_LIMIT_*` applies to repeated `join_room` attempts, including wrong-password retries.
- `CREATE_RATE_LIMIT_*` applies to repeated `create_room` attempts.
- `NICKNAME_MIN_LENGTH` and `NICKNAME_MAX_LENGTH` define nickname boundaries.
- `SWEEPER_INTERVAL_HOURS` defines the coarse housekeeping cadence for the periodic sweeper; the runtime should convert it to milliseconds when scheduling timers.

## 3) Backend State Model (RAM only)

```ts
type RoomStatus = 'active' | 'grace' | 'destroyed';

interface ParticipantRecord {
  participantId: string;
  socketId: string;          // "disconnected:<participantId>" when in grace window
  nickname?: string;
  joinedAt: number;
  lastSeenAt: number;        // updated on every successful signal relay (offer/answer/ice)
}

interface RoomRecord {
  roomId: string;
  hostId: string;
  createdAt: number;
  roomName?: string;
  participants: Map<string, ParticipantRecord>;
  nicknameToParticipant: Map<string, string>;
}

interface SignalingState {
  rooms: Map<string, RoomRecord>;
  participantToRoom: Map<string, string>;
  socketToParticipant: Map<string, string>;
  roomNameToId: Map<string, string>;
}
```

**Context modules** own state not stored directly in `RoomRecord`:
- `PasswordAuthContext` — per-room `{ passwordHash, passwordSalt, passwordVersion }`.
- `GraceWindowContext` — per-room TTL timer, host/guest grace timers, `expiresAt`, `soloDeadlineAt`.
- `ReconnectContext` — reconnect token index (`Map<tokenHash, { roomId, participantId, validUntil, passwordVersion }>`), disconnected participant tracking.
- `RateLimitingContext` — per-IP create and join rate limit records.

`RoomStatus` is a logical state: `active` (live participants present), `grace` (all participants disconnected with grace timers running), `destroyed` (removed from RAM). Rooms are removed from RAM immediately on destruction — there is no intermediate expired state.

A participant is in a grace window when their `socketId` starts with `"disconnected:"`. `liveCount` = count of participants whose `socketId` does NOT start with `"disconnected:"`.

`nicknameToParticipant` enforces room-scoped nickname uniqueness in RAM.

**Global room state vs. per-user session.** These are two distinct concepts and must not be conflated:
- **Global room state** is server-side and shared: the `RoomRecord` in `rooms` plus its `RoomStatus`. It is the single source of truth for whether a room exists. It is destroyed only by a lifecycle trigger (`host_left`, `host_grace_expired`, `room_ttl_expired`, `solo_timeout_expired`), which emits `room_destroyed` to all sockets.
- **Per-user session** is client-side: one participant's membership and screen (In-Room, Reconnecting, Room Ended, Lobby). A user's session can end while the global room keeps running for everyone else — e.g. a **kick** severs only the kicked user's session (they receive `participant_kicked` and see "Room Ended"); a kick never destroys the room because the host is always live. Likewise a guest's voluntary leave ends their session but not the room — if they were the last live participant the room enters empty-room behavior (see [lifecycle.md](./lifecycle.md)) rather than being destroyed by the leave itself.

Consequently "Room Ended" is a per-user screen, not a guarantee that the global room was destroyed.

## 4) Password and Auth Rules

- Room passwords are optional: a host may create an open room without a password.
- Store only salted password hash in RAM when a room is password-protected (never plaintext).
- Hash with Argon2id + per-room salt + server pepper when a password is set.
- Use constant-time comparison for verification.
- `create_room({ password?, nickname })` accepts an optional password; omitted or whitespace-only input creates an open room.
- `join_room({ roomId, password?, nickname })` accepts an optional password for open rooms; password is required only when the room is password-protected.
- Empty/missing/whitespace-only password on join is valid for open rooms and invalid only for password-protected rooms.
- Wrong password on join returns deterministic `INVALID_PASSWORD`.
- Password cannot be changed after room creation. To open a protected room, destroy and recreate it without a password.
- Purge password fields immediately during room destruction.
- User-facing auth mismatch outcomes must be normalized to `INVALID_PASSWORD` to reduce information disclosure.

## 4.1) Nickname Rules and Moderation

- `create_room` and `join_room` both require a nickname.
- Nicknames are immutable for the lifetime of a session — there is no nickname-change operation. To use a different nickname, a participant must leave the room and rejoin.
- Nickname uniqueness is scoped per room (case-insensitive). An invalid format, a nickname already taken by an active participant, or a nickname reserved by a disconnected participant still within their grace window returns `INVALID_SIGNAL_PAYLOAD`.
- Nickname is preserved through reconnect grace and reclaimed automatically on successful `resume_session`.
- Nickname reservation is released on voluntary leave, grace-expiry eviction, or room destruction.
- A nickname held by a disconnected participant stays reserved for the full duration of their grace window: a new joiner cannot claim it (the join is rejected with `INVALID_SIGNAL_PAYLOAD`), and the disconnected participant is never evicted by a name collision.
- Validation defaults: trim whitespace, collapse repeated spaces, enforce 3–24 chars, allow letters/digits/underscore/hyphen/dot/single spaces, and reject control or zero-width characters.
- Profanity filtering is in scope for server-visible text fields (including nicknames). P2P chat payload moderation remains client-side because the server does not inspect chat content.
