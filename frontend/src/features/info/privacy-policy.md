# Vapor Privacy Policy

**Effective as of launch · Last updated March 2026**

---

## The Core Principle

Vapor is designed to be **zero-persistence**. No messages, files, passwords, or session data are ever written to disk, a database, or any persistent store. Everything lives only in server RAM and is destroyed when the room ends or the server restarts.

---

## What Vapor Does Not Collect

- No user accounts, usernames, or email addresses.
- No chat messages or file content — these travel peer-to-peer and never touch the server.
- No cookies for tracking or advertising.
- No third-party analytics scripts.
- No device identifiers stored beyond the current browser session.

---

## What Is Temporarily Held in Server RAM

For the lifetime of an active room, the following data is held in memory only:

| Data | Purpose | Retention |
|---|---|---|
| **Room ID** | Randomly generated identifier for routing | Purged on room destruction |
| **Password hash** | Argon2id + per-room salt + server pepper (plaintext never stored) | Purged on room destruction |
| **Participant IDs** | Random ephemeral identifiers, not linked to real identity | Purged on room destruction |
| **Reconnect tokens** | Short-lived cryptographic tokens stored in browser session storage | Expire within grace window (1 hr host / 30 min guest); rejected if stale |
| **WebRTC signaling metadata** | SDP offer/answer + ICE candidates relayed to establish P2P; server does not read or store content | Relayed and discarded |
| **Temporary abuse counters** | RAM-only room-creation/join throttling and anomaly detection keyed by IP/request window, not by room | Purged when the relevant rate-limit window ends or the process restarts |

**All room-scoped state is wiped immediately when the room is destroyed** (host leaves, 2-hour TTL expires, or server restarts). Room-agnostic abuse counters expire on their own window or process restart.

---

## Password Handling

Room passwords are hashed on the server using **Argon2id + per-room salt + server pepper** immediately on receipt. The plaintext password is never logged or retained anywhere. If the server restarts, the hash is gone — a new room and password are required.

---

## Abuse Prevention

To protect rooms from brute-force and burst abuse without storing long-term identity data, Vapor uses RAM-only rate limits and temporary blocks.

- No persistent identity tracking.
- No strict room-specific join lockout policy in the canonical design.
- Rate-limit counters and temporary block records are RAM-only, keyed by request context such as IP/window, and expire on their own cadence or process restart.

---

## Chat and File Transfer

Once WebRTC negotiation completes, all chat messages and file transfers flow **directly between participants** over an encrypted WebRTC data channel (DTLS/SRTP). The server is completely bypassed and cannot read your content.

---

## Transport Encryption

- **Client ↔ Signaling server:** Encrypted via HTTPS / WSS (TLS).
- **Peer ↔ Peer (content):** Encrypted via WebRTC DTLS/SRTP.

---

## Rate Limiting and Abuse Prevention

To prevent abuse, Vapor tracks room creation and join-attempt rates against best-effort keys (such as IP address and request window). These counters are:
- RAM-only.
- Not tied to any persistent identity.
- Not shared with third parties.
- Purged when the room they belong to is destroyed.

---

## Server Logs

Operational logs may capture connection events (socket IDs, room lifecycle events) for debugging. Logs must **never** contain:
- Passwords or password hashes.
- Reconnect tokens.
- SDP / ICE payloads.
- Any user-generated message or file content.

This is enforced by server policy.

---

## Third Parties

Vapor does not integrate any third-party advertising, analytics, tracking, or data-broker services. No user data is sold or shared.

---

## Data Retention

There is no long-term data retention because there is no long-term data. All state is RAM-only and destroyed on room end or server restart. You cannot request deletion because there is nothing to delete after a room closes.

---

## Changes to This Policy

Material changes will be reflected with an updated date above. Because Vapor collects no accounts or contact information, we cannot notify you directly — check this page for updates.

---

**See also:** [Vapor FAQ.md](./faq.md) · [Vapor System Design.md](../../docs/system_design/Vapor%20System%20Design.md)
