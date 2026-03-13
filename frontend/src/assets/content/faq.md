# Frequently Asked Questions

## Why doesn't Vapor store chat history on the server?

"Zero-trace" is the core value proposition. Vapor is intentionally ephemeral: room and session state lives only in server RAM and is purged when rooms are destroyed or the process restarts. This aligns with *"Communication that evaporates."*

If a participant rejoins the same room later, they won't see old messages. This is intentional.

## How is the room password handled securely?

1. Frontend sends the plaintext password over HTTPS/WSS (encrypted in transit).
2. Backend hashes it immediately with Argon2id + per-room salt + server pepper.
3. Backend stores only the hash in RAM; purged on room destruction.
4. Backend **never** logs or stores the plaintext password.

## What happens if I close my browser and come back?

Closing the browser is treated as an unexpected disconnect (not an explicit leave).

- **Host:** Room enters host reconnect grace (up to 1 hour). If the host resumes in time, room continues; otherwise it is destroyed.
- **Guest:** Guest has up to 30 minutes to resume before being removed. Room stays active as long as the host is still valid.

Content is never persisted — nothing is recoverable after a room is destroyed.

## What is a reconnect token?

A cryptographic token issued when you join, stored only in your browser's session storage. If you disconnect unexpectedly, you can use it to resume your session within the grace window (host: 1 hour, guest: 30 minutes). Tokens are validated for freshness and password-version match. Stale or mismatched tokens are rejected.

## Can I see who else is in the room?

Yes. When you join, the server sends you a list of current participants by ID only — not real names or email addresses. When others join or leave, you're notified in real time.

## What if the server crashes while I'm in a room?

All rooms are destroyed (by design). Active sockets drop immediately; clients return to the entry screen. You must create a new room with a fresh password.

*Why this is a feature:* ensures zero recovery of old conversations even on server restart.

## Can I send files through Vapor?

Yes. File transfers happen peer-to-peer directly via WebRTC data channels — the server never sees or stores them.

## Is Vapor encrypted end-to-end?

- **HTTPS / WSS (TLS):** encrypts client ↔ signaling server traffic.
- **WebRTC DTLS/SRTP:** encrypts all peer-to-peer data channel traffic.

The server handles signaling only (auth + SDP/ICE relay). Chat and files flow directly P2P.

## How many people can be in a room?

Maximum **5 participants** per room. Optimised for WebRTC mesh topology — small groups, high reliability — while keeping the server blind to your content.

## Does the host have special powers?

Yes, two critical ones:

1. You can update the room password (guests cannot).
2. You control when the room ends. If you leave, the room is destroyed and all guests are evicted.

- **Explicit leave:** room destroyed instantly.
- **Unexpected disconnect:** a 1-hour reconnect grace starts for you. Guests receive a grace deadline notification.
- **Guest leaves:** guest is removed; room continues.

## What happens if I enter the wrong password too many times?

Vapor applies a progressive lockout policy per room to prevent brute-force:

| Attempt range | Outcome |
|---|---|
| 1–3 | Rejected with `INVALID_PASSWORD`. No cooldown. |
| 4–5 | 10-minute cooldown enforced. Returns `RATE_LIMITED`. |
| 6+ | Strict lockout until the room is destroyed. Returns `RATE_LIMITED`. |

All attempt counters are RAM-only and purged atomically when the room is destroyed. No record persists.

## Is Vapor mobile-friendly?

Yes. The UI scales to small screens. The backend supports high-latency networks and IP address changes (mobile roaming).

## How does Vapor limit room-creation abuse while preserving anonymity?

Vapor uses layered, best-effort friction rather than hard identity:

- Server-side RAM rate limits (IP + request-window based).
- Max active rooms per best-effort anti-abuse key (IP + user-agent + optional client fingerprint).
- Optional lightweight anti-spam challenge proofs (Hashcash-style) when risk is elevated.

This reduces spam without claiming perfect prevention. No persistent identity is required or stored.
