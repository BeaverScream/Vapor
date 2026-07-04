# Vapor — Completed Phases

Concise summaries of completed work phases. Full implementation matrices are in `docs/work/archive/`.

---

## Phase 11 — Spec-Code Alignment & Bug Fixes

**Completed:** 2026-07-02  
**Work matrix:** `docs/work/archive/phase-11.md`  
**Test results:** `docs/test_results/archive/phase-11-test-result.md`

**Scope:** Seven targeted fixes (VP-11.1–11.2, 11.4–11.8) plus four in-review fixes (CR11-12/13/14/15) addressing spec/code misalignment, protocol correctness, and empty-room lifecycle gaps.

| Item | Summary |
|---|---|
| VP-11.1 | Renamed `SOLO_HOST_ROOM_TIMEOUT_MS` → `IDLE_ROOM_TIMEOUT_MS` (captures both liveCount=1 and liveCount=0 cases) |
| VP-11.2 | Centralized 5 missing rate-limit / sweeper constants into `shared/policy.ts` (eliminated hardcoded local copies) |
| VP-11.4 | Fixed `handleGuestGraceExpired` — now sentinel cleanup only; solo timer owns empty-room destruction |
| VP-11.5 | Removed off-contract nickname-update feature (`nickname_update`/`nickname_updated` events, all wiring) |
| VP-11.6 | Fixed kick: reason `"kick"`, correct socket-removal order, kicked socket receives only `participant_kicked` |
| VP-11.7 | Dropped application-layer heartbeat (dead code); `lastSeenAt` retained and refreshed on signal relay instead |
| VP-11.8 | Raised IP create rate limit from 10 → 30 per window |
| CR11-12 | Fixed `resume_session` solo timer for any lone live participant (not host-only); guest resuming alone now gets `soloDeadlineAt` |
| CR11-13 | Grace-held nicknames now reserved — `join_room` rejects new joiners requesting an in-grace nickname instead of evicting the holder |
| CR11-14 | `leave_room` at liveCount=0 now starts idle timer instead of immediately destroying with wrong reason |
| CR11-15 | Consolidated all 5 idle-timer paths into a single `reconcileIdleTimer` helper; disconnect at liveCount=0 now (re)starts fresh idle timer |
| OOS-3 | Removed `join_room` liveCount=0 rejection gate — new joiners may enter an empty (all-in-grace) room |

**Backlog items resolved by Phase 11:** BL-SIG-SOLO-GUEST-OWNER-01, BL-SIG-NICKNAME-GRACE-RESERVE-01, BL-SIG-LEAVE-EMPTY-REASON-01, BL-SIG-EMPTY-ROOM-TIMER-01, BL-SIG-JOIN-EMPTY-GATE-01, BL-UX-KICK-SOLO-TIMER-01

---

## Phase 10 — Bug Fix & Chat Persistence

**Completed:** 2026-06-29  
**Work matrix:** `docs/work/archive/phase-10.md`

**Scope:** Four E2E bugs found during Phase 9 validation, plus local chat history persistence.

| Item | Summary |
|---|---|
| VP-10.1 | Guest TCP disconnect now emits `peer_left` (was missing — design spec violation) |
| VP-10.2 | Guest-to-guest messaging repaired via mesh revalidation (`syncPeers` / `needsOffer`) on `onPeerLeft` |
| VP-10.3 | Room expiry timer no longer hides on input focus; chat scroll bar scoped to chat container (`h-dvh` fix) |
| VP-10.4 | Chat history persisted per room in `sessionStorage`; restored on reconnect; cleared on terminal events only |

---

## Phases 0–9 (Summary)

| Phase | Summary |
|---|---|
| 0–5 | Core signaling, security, reconnect, identity, open-room, refactoring |
| 6 | Admin metrics API + live dashboard UI |
| 7 | Visual redesign (Stitch reference), light/dark/blue themes, privacy/FAQ restructure |
| 8 | Mobile-first responsiveness, host badge, browser notifications, human-readable room names, desktop layout |
| 9 | Bug fixes, state/type cleanup, contract test recovery, lint compliance — 274/274 tests ✅ |
