# Vapor

**Ephemeral P2P chat. Zero server-side content.**

Vapor is a browser-based chat utility built around one non-negotiable guarantee: when a room ends, nothing remains. No database, no message logs, no file storage. Content travels peer-to-peer over WebRTC — the server is limited to signaling only and never touches your messages or files.

**Note that file transfer function is still in process.**

---

## Core Design

### True Zero-Persistence

Most "ephemeral" services relay content through a server and hold it in RAM or on disk during the session. Vapor doesn't.

| Layer | Vapor |
|---|---|
| Messages | Peer-to-peer via WebRTC Data Channel — server never sees content |
| Files | Peer-to-peer via WebRTC Data Channel — no server storage |
| Room state | Server RAM only, destroyed immediately when the room ends |
| Encryption | DTLS (WebRTC built-in) — mandatory, no plaintext path exists |

The signaling server coordinates WebRTC handshakes (SDP/ICE exchange) and nothing more. Once the handshake completes, it exits the data path entirely.

### Real Access Control

Rooms are password-protected with **Argon2id** — a per-room salt, a server-side pepper, and constant-time comparison. No plaintext is ever stored; auth records live only in server RAM and vanish with the room.

Participant identities are **server-assigned** — clients cannot spoof each other. Nicknames are enforced unique per room and held in reserve during disconnect grace windows so no one can steal your seat while you're reconnecting.

### Host-Sovereign Lifecycle

The host controls the room. Every room has well-defined termination rules:

| Trigger | Outcome |
|---|---|
| Host clicks Leave | Room destroys immediately |
| Host disconnects, grace expires (60 min) | Room destroys |
| Room reaches max lifetime (2 hours) | Room destroys |
| Room sits empty or solo for 15 minutes | Room destroys |

Guests have a **30-minute grace window** for unexpected disconnects — reconnecting within the window fully restores your session and nickname reservation.

### Hardened Signaling

- Per-event socket rate limiting — not just HTTP routes
- Type-checked, size-capped signal payloads with explicit error codes
- Structured server logs that exclude all content, passwords, and tokens
- Server-assigned participant IDs with hashed+peppered reconnect tokens

### Operational Data

Vapor collects **no user content or personal data**. The server does maintain an in-memory admin dashboard tracking aggregated operational metrics: rooms created and destroyed (with reason breakdown), participant counts, peak load, error rates, memory usage, and uptime. This data lives in server RAM and is gone when the server restarts.

---

## User Guide

### The Lobby

![Vapor Lobby](docs/UI_design/current/LobbyView_phase7_blue.jpg)

The lobby is the single entry point. Switch between **Create** and **Join** tabs depending on your role.

---

### Creating a Room

1. Select the **Create** tab.
2. Enter an optional **Room Key** (password). Leave blank for an open room.
3. Enter a **Nickname** (3–24 characters).
4. Click **+ Create room**.

You enter the room as the **host** and receive a Room ID. Share it — and the password if you set one — with the people you want to invite.

> **Optional room name:** You can set a custom room name (3–24 characters, letters/digits/hyphens/underscores) instead of using the auto-generated Room ID. Custom names must be unique across active rooms. Guests can join using the room name or the raw Room ID — both work.

**Host rules:**
- Maximum 5 participants per room (host included).
- Leaving immediately destroys the room for everyone.
- Room name and password cannot be changed after creation.

---

### Joining a Room

1. Select the **Join** tab.
2. Enter the **Room ID** (or custom room name) shared by the host. Room IDs are case-sensitive.
3. Enter the **Room Key** if the room is password-protected.
4. Enter your **Nickname** (3–24 characters, must be unique within the room).
5. Click **Join room**.

On success you enter as a **guest** and the P2P mesh establishes automatically.

**Common join errors:**

| Error | Meaning |
|---|---|
| Room not found | The Room ID doesn't exist or the room has already ended. |
| Incorrect password | Wrong or missing password for a protected room. |
| Room is full | The room already has 5 participants. |
| Nickname taken | Your preferred nickname is reserved by another participant. |
| Too many attempts | Temporary rate limit — wait before retrying. |

---

### In the Room

Once connected, all messages and file transfers flow directly peer-to-peer. The server is no longer in the data path.

**Room header** shows the Room ID with a copy button and a live countdown to room expiry. The timer hides while you're typing and reappears when you stop.

**Participant list** shows all connected participants with color-coded nicknames. Collapsed by default on mobile, open by default on desktop.

**Leaving:** Click Leave. As a guest, you return to the lobby and the room continues for others. As the host, leaving immediately destroys the room for everyone.

---

### Disconnects and Reconnection

Vapor distinguishes between a **voluntary leave** (you clicked Leave) and an **unexpected disconnect** (network drop, browser crash, tab refresh).

#### If you disconnect unexpectedly

Your session is held open with a grace window so you can reconnect without losing your nickname or place in the room. Vapor automatically attempts to resume your session on reconnect.

| Role | Grace window |
|---|---|
| Host | 60 minutes |
| Guest | 30 minutes |

During your grace window, other participants see you as offline but the room stays alive and your nickname is reserved. Reconnecting within the window fully restores your session. If the window expires, your session is permanently evicted and you must rejoin as a new participant.

#### If the host disconnects

Guests see a **host grace banner** with a countdown. The room stays active during this time. If the host returns within 60 minutes, the banner clears and the room resumes normally. If the host does not return, the room is destroyed when the grace timer expires.

---

## Stack

| Layer | Tech |
|---|---|
| Frontend | React + TypeScript (Vite) + Tailwind CSS |
| Backend | Node.js + Express + TypeScript |
| Real-time | Socket.IO (signaling only) |
| P2P | WebRTC Data Channels |

---

## Run Locally

```bash
# Install dependencies
npm install
cd backend && npm install && cd ..

# Start frontend + backend (from project root)
npm run dev
```

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:3001`

## Run with Docker

```bash
npm run docker:up   # start
npm run docker:down # stop
```
