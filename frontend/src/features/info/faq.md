# Vapor Quick Reference: FAQ & Glossary

## FAQ

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
Yes. When you join, server sends you a list of current participants (by ID only, not real names). When others join/leave, you're notified in real-time.

**Privacy note:** You see anonymized participant IDs, not email addresses or identifiable info.

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
3. Aggregate-only telemetry for operational visibility.

This reduces spam without introducing persistent identity tracking or mandatory puzzles.

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

### Q: Why not use Bitcoin/mining-style puzzles for room creation?

**A:**  
Mining-style puzzles are intentionally not used.

**Key risks:**
1. **Security and abuse optics:** resembles cryptojacking behavior.
2. **UX/battery impact:** severe CPU and battery drain (especially mobile).
3. **Fairness issues:** users with low-end devices are penalized most.
4. **Operational unpredictability:** challenge duration varies widely by hardware.
5. **Compliance/legal risk:** may trigger policy, store-distribution, or jurisdiction concerns.

If challenge friction is ever enabled, keep it lightweight and optional, not mining-style.

---

### Q: Can puzzle solving produce useful output instead of just anti-spam proof?

**A:**  
Not in Phase 1. Vapor puzzle guard is intentionally lightweight and verification-first. Useful-computation puzzles introduce complex fairness, validation, and abuse trade-offs.

For now, treat puzzle solving as abuse friction only.
