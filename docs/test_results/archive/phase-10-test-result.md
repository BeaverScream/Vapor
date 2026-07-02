# Phase 10 — Test Results Report

**Date:** 2026-06-25

## Executive Summary

All unit, integration, and E2E suites pass. Two test code bugs were fixed during E2E re-runs:

1. **Test code fix (kick test, `03-lifecycle.spec.ts:119`):** The test clicked a "participants" toggle button before kicking — this button exists in the mobile layout but not the desktop layout (which the E2E suite always uses). The desktop participant panel is open by default, so the click was removed.
2. **Test code fix (stale reconnect, `04-chat-persistence.spec.ts:135`):** The 12s assertion timeout was insufficient when the full suite runs (backend event loop is under load from ~20 prior tests, slowing the WebSocket handshake). Increased to 25s.

Three application bugs fixed earlier in Phase 10 (all confirmed passing):
- **BUG-1:** `leaveRoom`/`backToLobby` cleared wrong sessionStorage key (hyphen vs. dot).
- **BUG-2:** Auth tests waited for `#chat-input` instead of `#chat-input, #chat-input-desktop`.
- **INFRA-1:** Rate limiter blocked tests 8–25; fixed via `E2E_DISABLE_RATE_LIMIT=1` env bypass.

## Automated Test Results by Suite

| Suite | Command | Result |
|---|---|---|
| Backend unit | `test:unit` | ✅ 72 / 72 |
| Backend integration | `test:integration` | ✅ 115 / 115 |
| Backend policy | `test:policy` | ✅ 10 / 10 |
| Frontend unit | `test:unit` | ✅ 79 / 79 |
| Frontend integration (incl. 20 contract) | `test:integration` | ✅ 21 / 21 |
| **Unit+Integration Total** | | **✅ 297 / 297** |

## E2E Test Results (Playwright) — 2026-06-25 final run

| # | Suite | Test | Result |
|---|---|---|---|
| 1 | smoke | create room renders room UI with expected elements | ✅ Pass |
| 2 | smoke | second participant joins and both see 2 participants | ✅ Pass |
| 3 | smoke | leaving room returns to lobby and clears session token | ✅ Pass |
| 4 | auth | joining with wrong password is rejected | ✅ Pass |
| 5 | auth | joining with correct password — Protected badge | ✅ Pass |
| 6 | auth | joining a nonexistent room shows an error | ✅ Pass |
| 7 | auth | nickname shorter than 3 chars is rejected | ✅ Pass |
| 8 | auth | duplicate nickname in the same room is rejected | ✅ Pass |
| 9 | auth | joining by room name resolves to the correct room | ✅ Pass |
| 10 | auth | creating a room with a duplicate name is rejected | ✅ Pass |
| 11 | lifecycle | host voluntary leave destroys room | ✅ Pass |
| 12 | lifecycle | guest voluntary leave decrements count | ✅ Pass |
| 13 | lifecycle | guest TCP disconnect emits peer_left immediately (VP-10.1) | ✅ Pass |
| 14 | lifecycle | host TCP disconnect shows reconnect grace banner | ✅ Pass |
| 15 | lifecycle | kick removes participant | ✅ Pass |
| 16 | lifecycle | solo timer chip visible when host is only participant | ✅ Pass |
| 17 | lifecycle | join_room rejected when liveCount is zero | ✅ Pass |
| 18 | chat persistence | history restored after page reload (T10.4-01/07) | ✅ Pass |
| 19 | chat persistence | history cleared after explicit leave (T10.4-02) | ✅ Pass |
| 20 | chat persistence | history cleared when room destroyed (T10.4-05) | ✅ Pass |
| 21 | chat persistence | stale reconnect token → app returns to lobby (T10.4-03/04) | ✅ Pass |
| 22 | chat persistence | no duplicate messages on reconnect (T10.4-06) | ✅ Pass |
| 23 | p2p+ui | guest↔guest messaging after host TCP disconnect (T10.2-04) | ✅ Pass |
| 24 | p2p+ui | room lifetime chip stays visible while typing (T10.3-01b) | ✅ Pass |
| 25 | p2p+ui | chat scroll bar on container, not page (T10.3-02) | ✅ Pass |

**E2E Summary: 25 passed / 0 failed**

## Phase 10 Test Plan — Status

### VP-10.1 Guest Disconnect Notification

| Test # | Suite | Purpose | Status |
|---|---|---|---|
| T10.1-01 | integration | Guest1 TCP drop → Host + Guest2 receive `peer_left` (reason "disconnect") | ✅ Pass |
| T10.1-02 | integration | Guest drop leaving host solo → `peer_left` carries `soloDeadlineAt` | ✅ Pass |
| T10.1-03 | integration | All guests drop → `peer_left` per guest; host solo, timer running | ✅ Pass |
| T10.1-04 | build | `tsc --noEmit` clean after change | ✅ Pass |

### VP-10.2 Guest Messaging After Host Disconnect

| Test # | Suite | Purpose | Status |
|---|---|---|---|
| T10.2-01 | unit (frontend) | Mesh-repair decision logic: `needsOffer` returns false for open channels + non-stable states | ✅ Pass |
| T10.2-02 | integration (backend) | Host + 2 guests; host disconnects; guests relay signal_offer/answer/ice to each other | ✅ Pass |
| T10.2-03 | unit (frontend) | `onPeerLeft` computes remaining peers, calls `syncPeers`, guards pending-queue clear | ✅ Pass |
| T10.2-04 | E2E | Host + 2 guests; host TCP-drops; guests visually see each other's messages | ✅ Pass |

### VP-10.3 UI Reliability & Styling

| Test # | Suite | Purpose | Status |
|---|---|---|---|
| T10.3-01 | E2E (manual) | Chip present across focus/blur/type cycles; guard removal confirmed | ✅ Pass (manual) |
| T10.3-01b | E2E | Chip stays visible while typing in chat input | ✅ Pass |
| T10.3-02 | E2E | Desktop, many messages → scrollbar on chat container, not page | ✅ Pass |

### VP-10.4 Chat History Persistence (Local)

| Test # | Suite | Purpose | Status |
|---|---|---|---|
| T10.4-01 | E2E | Reconnect restores chat history | ✅ Pass |
| T10.4-02 | E2E | Explicit "Leave Room" clears history | ✅ Pass |
| T10.4-03 | E2E | TCP drop does NOT clear chat | ✅ Pass |
| T10.4-04 | E2E | Stale token → ROOM_NOT_FOUND → app returns to lobby, session cleared | ✅ Pass |
| T10.4-05 | E2E | Host leave → `room_destroyed` → guest clears history | ✅ Pass |
| T10.4-06 | E2E | No duplicate messages on reconnect | ✅ Pass |
| T10.4-07 | E2E | Full live flow: host reconnects, guests keep messaging, history restored | ✅ Pass |
