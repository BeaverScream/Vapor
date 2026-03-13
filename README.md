# 💨 Vapor
**"Communication that evaporates."**

Vapor is a high-performance, zero-persistence communication utility designed for instant, secure interactions. It eliminates the friction of modern messaging by providing a browser-based "bridge" for chat and file sharing that vanishes without a trace once the session is over.

---

### 🌟 Core Philosophy: "Easy Use, Easy Drop"
* **Zero Onboarding:** No accounts, no apps, no phone numbers. Access is instant with a room link and password.
* **Easy Use:** Create a room with a password, share the returned room ID, then join with the exact same room ID (case-sensitive) and matching password.
* **Zero Persistence:** Room/session state lives only in server RAM and is removed when the room ends. Each room is limited to a maximum 2-hour lifetime.
* **Host-Sovereign Volatility:** The host controls room lifetime. If the host leaves (or misses reconnect grace), the room is destroyed.
* **Password-Protected Entry:** Guests join with room ID + host-defined password.
* **Privacy Protected:** The server is only used to connect participants. Messages and file transfers are shared directly between users.

### ❓ FAQ

**Why did my room end even before 2 hours?**  
Vapor enforces a maximum 2-hour TTL, but rooms can end earlier by lifecycle policy:
- host leaves (`host_left`),
- host reconnect grace expires (`host_grace_expired`),
- host-only room times out before any guest joins (`solo_timeout_expired`),
- or full TTL is reached (`room_ttl_expired`).

**What happens after repeated wrong password attempts?**  
Join-attempt policy is enforced per room + subject key:
- attempts 1-3: rejected as `INVALID_PASSWORD` with no cooldown,
- attempts 4-5: 10-minute cooldown (attempts during cooldown return `RATE_LIMITED`),
- attempts greater than 5: strict lockout until room destruction (`RATE_LIMITED`).

---

### 🛠️ Technical Stack (The "Lean" Architecture)
Built to be lightweight, type-safe, and professional:

* **Frontend:** **React + TypeScript** (Vite-powered) for a lightning-fast, crash-resistant user experience.
* **Styling:** **Tailwind CSS** with GPU-accelerated background animations (mist/smoke effect).
* **Backend:** **Node.js + Express + TypeScript** (Stateless/No Database) to ensure zero data retention.
* **Real-time:** **Socket.io** for signaling and instant group coordination.
* **Data Transfer:** **WebRTC Data Channels** (P2P) for high-speed, direct device-to-device file sharing.
* **Admin Observability:** Optional **Socket.IO Admin UI** + RAM-only metrics endpoint for operational visibility.

---

### 🛡️ Privacy & Encryption
* **Peer Encryption:** WebRTC data channels use DTLS/SRTP. Data moves directly between browsers, so the server does not relay your files.
* **Encrypted Signaling:** All room coordination and initial chat messages are wrapped in **TLS/SSL (HTTPS/WSS)**, protecting users on public Wi-Fi.
* **Stateless Auth:** Password verification data lives only in server RAM. There is no database history to breach.

---

### 📈 Competitive Advantage

| Feature | Traditional Apps (Zoom/Teams) | **Vapor** |
| :--- | :--- | :--- |
| **Setup** | Heavy (Account/App) | **Instant (Room + Password)** |
| **Persistence** | Permanent Logs/History | **Volatile (Self-destructs)** |
| **Data Privacy** | Server-side storage | **P2P (Client-to-Client)** |
| **Access** | Email Invites/Links | **Password-Locked Bridge** |

---

### ▶️ Run Locally (without Docker)
1. Install root utilities:
	```bash
	npm install
	```
2. Install backend dependencies:
	```bash
	cd backend && npm install
	```
3. (Optional) Type-check backend:
	```bash
	cd backend && npm run typecheck
	```
4. Start both frontend and backend from the project root:
	```bash
	npm run dev
	```

### 🐳 Run with Docker
From the project root:

```bash
npm run docker:up
```

- Frontend: `http://localhost:5173`
- Backend health: `http://localhost:3001/health`
Stop containers:

```bash
npm run docker:down
```

<!-- ### 🔎 Admin Dashboard (Optional)

Vapor includes a separate backend admin module for live operational metrics while preserving zero-persistence behavior.

- JSON metrics endpoint: `GET /admin/metrics`
- Socket-level dashboard: Socket.IO Admin UI

Required backend environment variables:

- `ADMIN_METRICS_TOKEN` for `/admin/metrics` (send as `x-admin-token` header)
- `ADMIN_UI_USERNAME` and `ADMIN_UI_PASSWORD` to enable Socket.IO Admin UI basic auth
- `ADMIN_UI_ORIGIN` (optional, default: `https://admin.socket.io`)

Example:

```bash
ADMIN_METRICS_TOKEN=replace-me
ADMIN_UI_USERNAME=admin
ADMIN_UI_PASSWORD=strong-secret
ADMIN_UI_ORIGIN=https://admin.socket.io
```

The admin module exposes RAM usage, active users, active rooms, cumulative joins, uptime, and aggregate connection-hours. No room credentials, signaling payloads, or message/file content are persisted. -->