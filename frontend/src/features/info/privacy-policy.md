# Vapor Privacy Policy

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

## Chat and File Transfer

Once WebRTC negotiation completes, all chat messages and file transfers flow **directly between participants** over an encrypted WebRTC data channel. The server is completely bypassed and cannot read your content.

---

## Third Parties

Vapor does not integrate any third-party advertising, analytics, tracking, or data-broker services. No user data is sold or shared.

---

## Data Retention

There is no long-term data retention because there is no long-term data. All state is RAM-only and destroyed on room end or server restart. You cannot request deletion because there is nothing to delete after a room closes.

---

## Operational Metrics

To monitor service health and detect abuse, Vapor writes **aggregate operational metrics** to an external observability store. These metrics are strictly non-identifiable:

| What IS written | What is NEVER written |
|---|---|
| Active room count (aggregate) | Room IDs |
| Active participant count (aggregate) | Participant IDs |
| Error rates (RATE_LIMITED, ROOM_NOT_FOUND, etc.) | Nicknames |
| Heap usage and uptime | Reconnect tokens |
| Room destruction reason breakdown | Passwords or password hashes |
| Peak concurrent rooms / participants | SDP / ICE payloads |
| Blocklist and rate-limit window sizes | IP addresses |
| | Any session-scoped or user-identifiable data |

**The zero-persistence guarantee for user and session data is unchanged.** No message content, file transfers, passwords, reconnect tokens, or user-linked identifiers are ever written to any persistent store. The observability store contains only aggregate operational counters — there is no way to reconstruct room activity, participant identity, or conversation content from these records.

---

## Changes to This Policy

Material changes will be reflected with an updated date above. Because Vapor collects no accounts or contact information, we cannot notify you directly — check this page for updates.
