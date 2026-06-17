# Vapor Quick Reference: FAQ & Glossary

---

### Q: Why doesn't Vapor store chat history on the server?

**A:** "Zero-trace" is the core value proposition. Vapor is intentionally ephemeral: room/session state lives only in server RAM and is purged when rooms are destroyed or the process restarts. This aligns with "Communication that evaporates."

**Practical implication:** If a participant rejoins the same room later, they won't see old messages. This is intentional.

---

### Q: How is password handled securely?

**A:**  
1. Frontend sends plaintext password (over HTTPS/WSS, so encrypted in transit).
2. Backend hashes password with Argon2id + per-room salt + server pepper (env var).
3. Backend stores hash in RAM, purges on room destruction.
4. Backend **never** logs or stores plaintext password.

**Why not plaintext in RAM?**  
- If server memory is dumped/leaked, attacker sees password hashes (harder to crack) not plaintext (key to all rooms).

---

### Q: What happens if I close my browser and come back in 15 minutes?

**A:**  
Closing the browser is treated as an unexpected disconnect (not an explicit leave).
- **Host:** Room enters host reconnect grace (up to 1 hour). If host resumes in time, room continues; if not, room is destroyed.
- **Guest:** Guest gets up to 30 minutes to resume before being removed. Room stays active if host is still valid.
- Content/history still remains ephemeral and is not persisted server-side.

---

### Q: Can I see who else is in the room?

**A:**  
Yes. When you join, you see all current participants by their room nickname. When others join or leave, you're notified in real-time.

**Privacy note:** Nicknames are room-scoped and ephemeral — they exist only for the lifetime of a single session in a single room and are never linked to accounts or persistent identity.

---

### Q: Are nicknames permanent or linked to my identity?

**A:**  
No. Nicknames are ephemeral and room-scoped only.

- They exist in server RAM for the duration of the room and are purged when the room is destroyed or the server restarts.
- Each room maintains its own nickname namespace — the same nickname can exist in different rooms at the same time.
- On reconnect within the grace window, your nickname is automatically reclaimed so the session continues with the same identity.
- Nickname conflicts within a room are rejected deterministically with a clear error — trying again with a different name resolves it immediately.

---

### Q: What if the server crashes while I'm chatting?

**A:**  
- All rooms destroyed (by design).
- Active sockets drop immediately; clients should treat it as disconnected service and return to entry/reconnect handling.
- You must create a new room or rejoin a new room with a fresh password.

**Why this is a feature:** Ensures zero recovery of old conversations even if server restarts.

---

### Q: What stays on the server after a restart?

**A:** Nothing room-specific. Vapor keeps room/session state only in RAM, so a server restart clears:
- rooms
- participants
- reconnect tokens
- room passwords
- nickname reservations
- temporary rate-limit or abuse-control caches

The service comes back empty and new rooms must be created from scratch.

---

### Q: Can I send files through Vapor?

**A:**  
Yes, files transfer P2P directly; server never sees or stores them. This ensures complete privacy.

---

### Q: Is Vapor encrypted end-to-end?

**A:**  
Vapor uses:
1. **HTTPS/WSS (TLS):** Encrypts client ↔ signaling-server traffic.
2. **WebRTC secure transport (DTLS/SRTP):** Encrypts peer-to-peer data channel traffic.

Server responsibility is signaling only (auth + SDP/ICE relay). Chat/files are intended to flow directly P2P over WebRTC data channels.

---

### Q: How many people can be in a room?

**A:** Maximum 5 participants per room. This is optimized for WebRTC mesh topology (small groups, high reliability) while maintaining the core feature of the server not touching users' message and/or files.

---

### Q: If I'm the room creator (host), do I have special powers?

**A:**  
Yes, two critical powers:
1. **You can update the room password** (guests cannot).
2. **You control when the room dies.** If you leave (intentionally or after network failure), the room is destroyed, and all guests are evicted.

**Why?** "Communication that evaporates" — you control when conversation ends. Guests cannot keep the room alive if you're gone.

**Details:**
- If you click "Leave": Room destroyed instantly.
- If you lose connection unexpectedly (tab close/network drop): host reconnect grace starts (1 hour). Guests receive `host_reconnect_grace(deadlineAt)`. If host resumes in time, room persists; otherwise it is destroyed at deadline.
- If a guest leaves: They're removed, but room continues as long as you're connected.

---

### Q: What is a "reconnect token"?

**A:**  
A cryptographic token issued when you join and stored on your device (for example, session storage). If you disconnect unexpectedly, you can use it with `resume_session` to recover within grace windows (host: 1 hour, guest: 30 minutes), as long as token validity checks pass.

Reconnect validation also enforces password version matching; stale tokens are rejected. Frontend UX normalizes password/auth mismatch outcomes to `INVALID_PASSWORD` for reduced information disclosure.

**Why?** Provides seamless UX for network blips (WiFi → 4G handoff, browser crash, tab refresh).

---

### Q: What happens if I enter the wrong password too many times?

**A:**  
Vapor now relies on backend rate limiting and anomaly detection instead of a strict join-attempt lockout. Wrong passwords are still rejected deterministically, but the UI should only surface generic auth or rate-limit feedback.

**Why this changed:** We want to avoid punishing shared networks or creating a room-specific lockout that blocks legitimate recovery attempts. Any temporary blocking lives in RAM only and is handled by backend abuse controls.

---

### Q: Is Vapor mobile-friendly?

**A:**  
Yes, the UX is optimized for mobile. Backend supports high-latency networks + IP address changes (mobile roaming). Frontend scales to small screens.

---

### Q: How does Vapor limit room creation abuse while preserving anonymity?

**A:**  
Vapor uses detect-and-block controls instead of default client-side friction:
1. Server-side RAM rate limits (IP and request-window based).
2. Temporary in-memory blocklists for anomalous bursts.
3. Aggregate operational metrics written to an external observability store (see "Does Vapor collect any analytics?" below).

This reduces spam without introducing persistent identity tracking or mandatory puzzles.

---

### Q: Does Vapor collect any analytics?

**A:**  
Only aggregate operational metrics — no user-identifiable data of any kind.

Vapor writes the following to an external observability store for service health monitoring and abuse detection:

- Active room count, active participant count, active socket count
- Error rates (RATE_LIMITED, ROOM_NOT_FOUND, ROOM_FULL, etc.)
- Room destruction reason breakdown
- Peak concurrent rooms and participants
- Heap usage and process uptime

**What is never written:**
- Room IDs, participant IDs, nicknames
- Reconnect tokens, passwords, or password hashes
- SDP / ICE payloads
- IP addresses or any session-scoped data

**The zero-persistence guarantee for user and session data is unchanged.** The observability store contains only aggregate counters. There is no way to reconstruct room activity, participant identity, or conversation content from these records.

Because Vapor is open source, you can verify this directly — the metrics collection and flush logic are visible in the codebase.

---

### Q: Can Vapor detect incognito/private browsing reliably?

**A:**  
No. Browsers do not provide a reliable, standard incognito flag to websites.

**What Vapor does instead:**
- Treat missing/rotated client fingerprint as normal.
- Use server-side rate limits and temporary blocks when room-creation behavior appears abusive.

---

### Q: Can Vapor differentiate mobile devices and computers for abuse control?

**A:**  
Partially. Vapor can use best-effort device classification (user-agent/client hints) to tune thresholds, but this is not a strong security signal and can be spoofed.

**Practical policy:**
- Keep the same core room-creation limits for all devices.
- Prefer threshold tuning over user-facing friction.

---
