# 💨 Vapor
**"Communication that evaporates."**

Vapor is a high-performance, zero-persistence communication utility designed for instant, secure interactions. It eliminates the friction of modern messaging by providing a browser-based "bridge" for chat and file sharing that vanishes without a trace once the session is over.

---

### 🌟 Core Philosophy: "Easy Use, Easy Drop"
* **Zero Onboarding:** No accounts, no apps, no phone numbers. Access is via a single, unique URL.
* **Host-Sovereign Volatility:** The room exists only as long as the host is active. When the host leaves, the server's RAM is wiped, and the "Vapor" trail disappears.
* **Password-Protected Entry:** Every room is secured by a host-defined password. Access is validated against the server's volatile memory, ensuring targeted privacy without permanent storage.
* **Aesthetic Privacy:** A minimalist, GPU-accelerated UI featuring a "smoky" glassmorphism design that reflects the ephemeral nature of your data.

---

### 🛠️ Technical Stack (The "Lean" Architecture)
Built to be lightweight, type-safe, and professional:

* **Frontend:** **React + TypeScript** (Vite-powered) for a lightning-fast, crash-resistant user experience.
* **Styling:** **Tailwind CSS** with GPU-accelerated background animations (mist/smoke effect).
* **Backend:** **Node.js + Express** (Stateless/No Database) to ensure zero data retention.
* **Real-time:** **Socket.io** for signaling and instant group coordination.
* **Data Transfer:** **WebRTC Data Channels** (P2P) for high-speed, direct device-to-device file sharing.

---

### 🛡️ Privacy & Encryption
* **End-to-End Encryption (E2EE):** File transfers and P2P data use DTLS/SRTP protocols. Data moves directly between browsers, meaning the server never "sees" your files.
* **Encrypted Signaling:** All room coordination and initial chat messages are wrapped in **TLS/SSL (HTTPS/WSS)**, protecting users on public Wi-Fi.
* **Stateless Auth:** Passwords live only in the server's RAM. There is no database to breach, and no logs are generated.

---

### 📈 Competitive Advantage

| Feature | Traditional Apps (Zoom/Teams) | **Vapor** |
| :--- | :--- | :--- |
| **Setup** | Heavy (Account/App) | **Instant (URL-only)** |
| **Persistence** | Permanent Logs/History | **Volatile (Self-destructs)** |
| **Data Privacy** | Server-side storage | **P2P (Client-to-Client)** |
| **Access** | Email Invites/Links | **Password-Locked Bridge** |

---

### 🚀 Roadmap
- [ ] **Phase 1:** Core Socket.io signaling, Password-entry logic, and "Smoke" UI.
- [ ] **Phase 2:** P2P WebRTC Data Channels for multi-user file dropping.
- [ ] **Phase 3:** Mesh-based video/audio for up to 4 participants.

---

### 📦 Project Structure
- `frontend/` → Vite + React + TypeScript
- `backend/` → Node.js + Express + Socket.io (stateless)

### ▶️ Run Locally (without Docker)
1. Install root utilities:
	```bash
	npm install
	```
2. Install backend dependencies:
	```bash
	cd backend && npm install
	```
3. Start both frontend and backend from the project root:
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