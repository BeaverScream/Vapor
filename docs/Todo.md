# Vapor Project Roadmap (Current)

Docs index: [docs/README.md](README.md) — compact agent entry point.

Date: 2026-06-29

## Purpose
Tracks active phase work only. Each phase section lists the VP tasks for that phase and their completion state. Resolved items and historical phases are not kept here — they are archived in phase work documents under `docs/work/archive/`.

---

## 🛠️ Execution Rules
- VP IDs must stay stable and traceable across docs, tests, and matrices.
- Every slice must be test-first and map to deterministic evidence before closure.
- No room/session/password/token/chat data may be persisted outside RAM or logged in plaintext.
- Reference current phase work before backlog items when the roadmap is read top to bottom.

---


## Phase 11: Spec-Code Alignment & Bug Fixes

**Status:** Planned  
**Estimated Effort:** ~7–9 hours (1–2 days with testing)  
**Trigger:** System design spec recently reviewed and updated (2026-06-29). Code alignment gaps and protocol contract mismatches identified in Phase 10 review. Two additional items (VP-11.7, VP-11.8) added during Phase 11 planning based on architecture review.

**Scope:** Seven targeted fixes addressing spec/code misalignment and correctness issues:

- [ ] **VP-11.1 Rename Solo Timer Constant** *(BL-SIG-SOLO-RENAME-01)*
  - **Issue:** The 15-min empty-room timer constant was named `SOLO_HOST_ROOM_TIMEOUT_MS` (implies host-only), but the timer applies to any lone live participant (host or guest) and also to fully empty rooms (`liveCount` 0). During Phase 11 review the name was further refined from `SOLO_ROOM_TIMEOUT_MS` to `IDLE_ROOM_TIMEOUT_MS` to reflect both the liveCount === 1 (solo) and liveCount === 0 (empty) cases.
  - **Why:** The timer fires whenever `liveCount` ≤ 1 — covering both a lone participant and a fully empty room. "Idle" captures both states without implying a specific count.
  - **Expected Outcome:** Rename `SOLO_HOST_ROOM_TIMEOUT_MS` → `IDLE_ROOM_TIMEOUT_MS` across `shared/policy.ts`, `backend/src/signaling/contracts.ts`, `registerSocketHandlers.ts`, all test files, and all system design docs. Update conceptual references from "solo timer" to "idle timer" in documentation. No behavior change.

- [ ] **VP-11.2 Import Missing Signaling Constants from Spec** *(BL-SHARED-CONSTANTS-01)*
  - **Issue:** System constants defined in `core-architecture.md` §2 are absent from `shared/policy.ts` and hardcoded locally in backend handlers: `SWEEPER_INTERVAL_HOURS`, `JOIN_RATE_LIMIT_WINDOW_MS`, `JOIN_RATE_LIMIT_MAX`, `CREATE_RATE_LIMIT_WINDOW_MS`, `CREATE_RATE_LIMIT_MAX`. Code diverges silently from spec. (`HEARTBEAT_INTERVAL_MS` and `PARTICIPANT_STALE_MS` are excluded — these are removed by VP-11.7.)
  - **Why:** Centralizing them in `shared/policy.ts` makes the design spec and running code a single source of truth and prevents silent drift.
  - **Expected Outcome:** Five missing constants exported from `shared/policy.ts` with values from `core-architecture.md` §2 (`CREATE_RATE_LIMIT_MAX = 30` per VP-11.8). Backend handlers import from shared instead of hardcoding. `core-architecture.md` §2 and `shared/policy.ts` match exactly.

- [ ] **VP-11.4 Fix Guest Grace Participant Count** *(BL-SIG-GRACE-COUNT-01)*
  - **Issue:** `handleGuestGraceExpired` emits `peer_left` with `participantCount = activeRoom.participants.size`, which counts `disconnected:` sentinels (guests/hosts in their own grace window). Every other emit path uses `getLiveParticipantCount`. Client displays a phantom participant; count disagrees with live-count values elsewhere.
  - **Why:** Consistency error: the broadcast count overstates live participants and makes the displayed count unreliable.
  - **Expected Outcome:** `handleGuestGraceExpired` computes and emits `getLiveParticipantCount(activeRoom)`. Integration tests verify correct count is broadcast.

- [ ] **VP-11.5 Remove Off-Contract Nickname-Update Feature** *(BL-NICKNAME-UPDATE-OBSOLETE-01)*
  - **Issue:** The system design no longer provides a nickname-change capability — nicknames are immutable. The signaling contract lists neither `nickname_update` nor `nickname_updated` events. Yet the codebase still implements a full nickname-update path: backend handler, frontend wiring, shared payloads/events, cooldown constant. Dead, off-contract surface increases maintenance cost and is the root cause of BL-NICKNAME-LISTENER-DUP-01.
  - **Why:** Off-contract code drifts from the source-of-truth signaling contract and creates maintenance traps.
  - **Expected Outcome:** Remove `nickname_update`/`nickname_updated` event, handler, payloads, cooldown constant, `nicknameUpdatedAt` field, and all frontend wiring from socket client, room hook, and state reducers. Keep only initial nickname assignment and validation. Build/lint/typecheck clean.

- [ ] **VP-11.6 Fix Kick Reason & Socket Removal Order** *(BL-SIG-KICK-REASON-ORDER-01)*
  - **Issue:** Kick handler emits `peer_left` with `reason: "leave"` instead of `"kick"` (frontend maps any non-"disconnect" reason to "left", so kick is indistinguishable). Also broadcasts `peer_left` while the kicked socket is still in the Socket.IO room; kicked socket receives a `peer_left` about itself that it should not.
  - **Why:** Contract violation: frontend cannot differentiate a removal, and the kicked socket receives broadcasts it should not (violates contract and can drive incorrect self-state).
  - **Expected Outcome:** Emit `reason: "kick"`. Emit `participant_kicked` to the room first (while the target socket is still present, so it receives its own kick notification), then remove the kicked socket from state and disconnect, then broadcast `peer_left` to remaining participants only. Kicked socket receives only `participant_kicked` about itself. Frontend maps `reason: "kick"` to "was removed" system message. Integration tests verify event order and reason.

- [ ] **VP-11.7 Drop Heartbeat Mechanism** *(Planning decision 2026-06-29)*
  - **Issue:** The application-layer heartbeat is dead code on both ends: the frontend never emits `heartbeat` (no `emitHeartbeat` in `room-socket-client.ts`). Socket.IO's own transport-level ping/pong handles silent disconnect detection; `on("disconnect")` fires on all drop scenarios and already performs the necessary cleanup via grace window timers.
  - **Why:** The heartbeat handler adds a server handler and event constant that collectively do nothing. Removing them reduces surface area with zero behavioral loss.
  - **Expected Outcome:** Remove `socket.on("heartbeat", ...)` server handler and `HEARTBEAT` from `CLIENT_EVENT_NAMES` (if present). RETAIN `lastSeenAt` in `ParticipantRecord` — it is refreshed on every `signal_offer`/`signal_answer`/`signal_ice` relay in place of the removed heartbeat ping. Do NOT add `HEARTBEAT_INTERVAL_MS` or `PARTICIPANT_STALE_MS` to `shared/policy.ts`. Build/typecheck clean.

- [ ] **VP-11.8 Raise IP Create Rate Limit Threshold** *(Planning decision 2026-06-29)*
  - **Issue:** `IP_CREATE_THRESHOLD = 10` (the per-IP `create_room` ceiling per 60-second window) is too low for shared networks (home routers, public wifi). Ten users on the same NAT simultaneously creating rooms would collectively exhaust the limit and block everyone else on that IP. The current value was set conservatively without considering the early-stage user base and shared-IP scenarios.
  - **Why:** Overly aggressive IP-level throttling hurts legitimate users on shared networks (e.g. home routers, public wifi with many users behind the same NAT) without meaningfully improving abuse resistance.
  - **Expected Outcome:** `CREATE_RATE_LIMIT_MAX` raised from 10 to 30 in `shared/policy.ts` (added by VP-11.2) and reflected in `core-architecture.md` §2. All other rate-limit parameters unchanged. Integration test verifies IP block triggers at 31st attempt, not 11th.

---

## 🗂️ Notes
- Completed work and long history are archived separately under `docs/work/archive/`.
- Phase 10 completion summary: See `docs/Completed.md` for final status.
