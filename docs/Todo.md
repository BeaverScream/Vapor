# Vapor Project Roadmap (Current)

Docs index: [docs/README.md](README.md) — compact agent entry point.

Date: 2026-06-18  
Owner: @vapor-pm  
Status: Active

## Purpose
Tracks active phase work only. Each phase section lists the VP tasks for that phase and their completion state. Resolved items and historical phases are not kept here — they are archived in phase work documents under `docs/work/archive/`.

---

## 🛠️ Execution Rules
- VP IDs must stay stable and traceable across docs, tests, and matrices.
- Every slice must be test-first and map to deterministic evidence before closure.
- No room/session/password/token/chat data may be persisted outside RAM or logged in plaintext.
- Reference current phase work before backlog items when the roadmap is read top to bottom.

---

## 📌 Phase Summaries
- Phase 0: Deterministic room lifecycle bootstrap, contract locking, and restart-clears-state behavior.
- Phase 1: Canonical event naming, password/auth semantics, host identity, and lifecycle timers.
- Phase 2: P2P signaling, chat readiness, ICE policy, participant cap, and release gating.
- Phase 3: Security & Housekeeping (sweepers/reconnect), Nickname identity, and IP-scoped abuse controls.
- Phase 4: Identity display, performance optimization, open-room support, and advanced peer interaction.
- Phase 5: Refactoring the code to improve maintainability.
- Phase 6: Authenticated admin metrics API, RAM-only observability, and a live dashboard UI.
- Phase 7: Visual redesign (Stitch reference), client-side theme system (Light/Dark/Blue), and info-page restructure (Privacy/FAQ).
- Phase 8: Mobile-first responsiveness, UX bug fixes (kick stall + solo timer), host badge, browser notifications, human-readable room names, and desktop layout with participant side panel.
- Phase 9: Kick flow correctness, solo timer & lifecycle bugs, state/type cleanup, contract test suite recovery, core hook lint compliance, and metrics wiring fix. ✅ **Complete: 274/274 tests passing.**
- Phase 10: E2E bug fixes from Phase 9 validation testing (guest disconnect notification, guest messaging), UI reliability, and chat history persistence (with reconnect dedup).

---

## Phase 10: Bug Fix & Chat Persistence

**Status:** Planned  
**Estimated Effort:** ~10 hours (2–3 days with testing)  
**Trigger:** E2E validation testing of Phase 9 revealed correctness bugs in disconnect/reconnect flow and UI.

- [ ] **VP-10.1 Guest Disconnect Notification** *(BL-SIG-GUEST-DISCONNECT-01)*
  - **Issue:** Guest TCP disconnects do NOT emit `peer_left` to remaining participants, violating System Design Rule 5. Comment in code says "Guest stays visible until grace expires" but this contradicts the spec.
  - **Why:** Guests should be immediately removed from the active participants list (`liveCount`). The grace window (30 min) is for reconnection eligibility only, not visibility. Other participants see stale state and try to send messages to disconnected guests, causing message delivery to fail.
  - **Expected Outcome:** Backend emits `peer_left` (reason: "disconnect") when a guest TCP disconnects, matching the host disconnect path. Guest grace window runs independently for reconnection tracking. See [code_review_phase_9.md E2E-1](work/archive/code_review_phase_9.md#e2e-1-critical--guest-disconnect-does-not-emit-peer_left-event).

- [ ] **VP-10.2 Guest Messaging After Host Disconnect** *(BL-SIG-GUEST-MESSAGING-01)*
  - **Issue:** When host disconnects, remaining guests cannot exchange messages via WebRTC P2P. Problem persists after host reconnects; resolves on host's second disconnect (suggests state corruption).
  - **Why:** Likely cause: `onPeerLeft` handler does not revalidate the WebRTC peer mesh after the host is removed. Pending messages might be incorrectly cleared or blocked. Root cause requires tracing WebRTC connection state.
  - **Expected Outcome:** Guests can send/receive messages to each other after host disconnects. Host reconnect does not corrupt peer messaging. See [code_review_phase_9.md E2E-2](work/archive/code_review_phase_9.md#e2e-2-guests-cannot-exchange-messages-after-host-disconnect).

- [ ] **VP-10.3 UI Reliability & Styling**
  - **Issue (3a):** Room expiry timer display is unreliable; disappears and reappears with UI interactions.
  - **Issue (3b):** Long chat histories trigger browser scroll bar instead of chat container scroll bar.
  - **Why:** The lifetime chip unmounts whenever an input gains focus (the `isInputFocused` guard). The desktop chat feed escapes its container because a flex ancestor is missing a height constraint (`min-h-0`).
  - **Expected Outcome:** (3a) Timer stays mounted and updates every second while typing. (3b) Chat container shows its own scroll bar for long histories.

- [x] **VP-10.4 Chat History Persistence (Local)** *(BL-UX-CHAT-PERSISTENCE-01)*
  - **Issue:** Chat history is wiped on involuntary TCP drops, losing context for accidental disconnects.
  - **Decision:** Preserve chat in `sessionStorage` per room unless the user has effectively left. Single entry per room (`vapor.chat:<roomId>`), overwritten (not appended) on each message. **Storage model:** not on the server (signaling-only, zero-persistence) and not a replicated/verified ledger — messages are P2P over WebRTC and each client keeps its own per-**tab** copy of what it received; no consensus, copies can legitimately differ.
  - **Why:** Improves UX for accidental refreshes while maintaining ephemeral architecture (no server persistence, tab-scoped only). Disconnect ≠ leave: an involuntary drop+reconnect restores the snapshot; an expired grace window or explicit leave is treated as a leave and clears it.
  - **Reconnect guarantees:** displayed history = the restored snapshot (never empty, never a re-delivered backfill). The outbound pending queue must not re-flush stale messages to peers, and incoming messages dedupe by id so restored entries are never shown twice. (Absorbs the former standalone reconnect-leak item.)
  - **Clear on terminal events only:** explicit leave/back, kick, `room_destroyed` (covers **host grace expiry** — destroys the room and fans out to all clients), and a failed/stale resume `RECONNECT_TOKEN_STALE`/`HOST_RECONNECT_WINDOW_EXPIRED` (covers **guest grace expiry**, detected on the returning guest). Never clear on a recoverable TCP drop.
  - **Expected Outcome:** Chat history survives accidental disconnect and is restored on reconnect, with no duplicates. Leave/kick/room-destroy/expired-grace clears history. See [docs/system_design/Vapor_System_Design.md §1.1](docs/system_design/Vapor_System_Design.md#11-frontend-token-storage-policy) for persistence spec.

---

## 🗂️ Notes
- Completed work and long history are archived separately under `docs/work/archive/`.
