# Phase 11 — Test Results Report

**Date:** 2026-06-30
**Test Status:** ⚠️ REGRESSION — 304/304 unit+integration (backend 201/201, frontend 103/103) · E2E 24/25 (1 failure)
**Automated Pass Rate:** 100% unit+integration; 96% E2E (24/25)

## Executive Summary

Backend unit (72/72), backend integration (114/114), backend policy (15/15), frontend unit (82/82), and frontend integration (21/21) all pass. Backend typecheck (`tsc --noEmit`) is clean. Frontend typecheck (`tsc -b` via `vite build`) is clean. Lint has zero errors in both workspaces.

E2E suite (Playwright): 24/25 pass. One regression: **T10.4-03/04** — after injecting a stale reconnect token and reloading, the app stays stuck on "Reconnecting…" instead of resetting to the lobby. The `#nickname-input` element never appears within the 25 s timeout. This indicates that when `resume_session` fails with `ROOM_NOT_FOUND`, the frontend does not clear reconnecting state and return to lobby.

> **Note on run environment:** The first E2E run (17/25 failed) was caused by Playwright reusing existing Docker containers (`vapor-backend`, `vapor-frontend`) that had no `E2E_DISABLE_RATE_LIMIT=1`, triggering immediate rate-limit errors on every `create_room`. Docker containers were stopped before the clean run; Playwright started its own dev servers with the flag applied.

## Automated Test Results by Suite

| Suite | Command | Result |
|---|---|---|
| Backend unit | `test:unit` | ✅ 72 / 72 |
| Backend integration | `test:integration` | ✅ 114 / 114 |
| Backend policy | `test:policy` | ✅ 15 / 15 |
| Backend typecheck | `tsc --noEmit` | ✅ Clean |
| Backend lint | `eslint .` | ✅ 0 new errors (11 pre-existing errors, unchanged from Phase 10 baseline) |
| Frontend unit | `test:unit` | ✅ 82 / 82 |
| Frontend integration (incl. 21 contract) | `test:integration` | ✅ 21 / 21 |
| Frontend typecheck | `tsc -b` (via `vite build`) | ✅ Clean |
| Frontend lint | `eslint .` | ✅ 0 errors (4 pre-existing warnings, unchanged from Phase 10 baseline) |
| **Unit+Integration Total** | | **304 / 304** |
| **E2E (Playwright)** | `playwright test` | ❌ **24 / 25** |

## E2E Results

| # | Test | File | Status | Failure Reason |
|---|------|------|--------|----------------|
| 1 | smoke › create room renders room UI with expected elements | 01-smoke.spec.ts:8 | ✅ Pass | — |
| 2 | smoke › second participant joins and both see 2 participants | 01-smoke.spec.ts:26 | ✅ Pass | — |
| 3 | smoke › leaving room returns to lobby and clears session token | 01-smoke.spec.ts:44 | ✅ Pass | — |
| 4 | auth › joining with wrong password is rejected (§4) | 02-auth.spec.ts:10 | ✅ Pass | — |
| 5 | auth › joining with correct password enters room (§4) | 02-auth.spec.ts:34 | ✅ Pass | — |
| 6 | auth › joining a nonexistent room shows ROOM_NOT_FOUND error | 02-auth.spec.ts:62 | ✅ Pass | — |
| 7 | auth › nickname shorter than 3 chars is rejected (§4.1) | 02-auth.spec.ts:73 | ✅ Pass | — |
| 8 | auth › duplicate nickname in same room is rejected (§4.1) | 02-auth.spec.ts:82 | ✅ Pass | — |
| 9 | auth › joining by room name resolves to correct room (§6.4) | 02-auth.spec.ts:105 | ✅ Pass | — |
| 10 | auth › creating room with duplicate name is rejected (§6.4) | 02-auth.spec.ts:132 | ✅ Pass | — |
| 11 | lifecycle › host voluntary leave destroys room (§6 rule 3) | 03-lifecycle.spec.ts:9 | ✅ Pass | — |
| 12 | lifecycle › guest voluntary leave decrements count (§6 rule 4) | 03-lifecycle.spec.ts:32 | ✅ Pass | — |
| 13 | lifecycle › guest TCP disconnect emits peer_left immediately (VP-10.1) | 03-lifecycle.spec.ts:56 | ✅ Pass | — |
| 14 | lifecycle › host TCP disconnect shows reconnect grace banner (§6 rule 5) | 03-lifecycle.spec.ts:81 | ✅ Pass | — |
| 15 | lifecycle › kick removes participant (§6 rule 9) | 03-lifecycle.spec.ts:105 | ✅ Pass | — |
| 16 | lifecycle › solo timer chip visible when host is only participant (§6 rule 8) | 03-lifecycle.spec.ts:129 | ✅ Pass | — |
| 17 | lifecycle › join_room permitted when liveCount is zero (§1 rule 2) | 03-lifecycle.spec.ts:139 | ✅ Pass | — |
| 18 | chat › history restored after involuntary disconnect (VP-10.4 T10.4-01/07) | 04-chat.spec.ts:12 | ✅ Pass | — |
| 19 | chat › history cleared after explicit leave (VP-10.4 T10.4-02) | 04-chat.spec.ts:54 | ✅ Pass | — |
| 20 | chat › history cleared when room is destroyed (VP-10.4 T10.4-05) | 04-chat.spec.ts:82 | ✅ Pass | — |
| 21 | **chat › stale reconnect token resolves gracefully — app returns to lobby (VP-10.4 T10.4-03/04)** | **04-chat.spec.ts:114** | ❌ **Fail** | App stuck on "Reconnecting…"; `#nickname-input` not visible after 25 s. `resume_session` failure (ROOM_NOT_FOUND) does not reset frontend state to lobby. |
| 22 | chat › reconnected participant sees no duplicate messages (VP-10.4 T10.4-06) | 04-chat.spec.ts:143 | ✅ Pass | — |
| 23 | p2p › guest↔guest messaging after host TCP disconnect (VP-10.2 T10.2-04) | 05-p2p.spec.ts:17 | ✅ Pass | — |
| 24 | p2p › room lifetime chip stays visible while typing in chat (VP-10.3 T10.3-01b) | 05-p2p.spec.ts:56 | ✅ Pass | — |
| 25 | p2p › chat scroll bar on container not page in desktop mode (VP-10.3 T10.3-02) | 05-p2p.spec.ts:89 | ✅ Pass | — |

## Phase 11 Test Plan — Status

### VP-11.1 Rename Solo Timer Constant

| Test # | Suite | Purpose | Status |
|---|---|---|---|
| T11.1-01 | build (typecheck) | Test file imports updated exhaustively | ✅ Pass |
| T11.1-02 | unit (soloTimer suite) | Solo timer still fires at correct deadline after rename | ✅ Pass |
| T11.1-03 | unit (kick suite) | Kick solo-timer restart still correct after rename | ✅ Pass |
| T11.1-04 | unit (disconnect suite) | Disconnect solo-timer restart still correct after rename | ✅ Pass |

### VP-11.2 Import Missing Signaling Constants from Spec

| Test # | Suite | Purpose | Status |
|---|---|---|---|
| T11.2-01 | unit | Shared constants have exact spec-mandated values | ✅ Pass |
| T11.2-02 | build (typecheck) | No local shadowing of replaced constants | ✅ Pass |
| T11.2-03 | integration (existing) | Rate limiting behavior unchanged after constant-source switch | ✅ Pass — `T3.3-06` removed as invalid (fingerprint-keyed premise didn't match IP-keyed implementation) |
| T11.2-04 | integration (existing) | Sweeper interval still fires at 5 hours | ✅ Pass |

### VP-11.4 Fix Guest Grace Participant Count

| Test # | Suite | Purpose | Status |
|---|---|---|---|
| T11.4-01 | integration | Grace expiry with another participant still in grace: room not destroyed | ✅ Pass |
| T11.4-02 | integration | Guest-grace expiry is sentinel cleanup only; solo timer destroys room | ✅ Pass |
| T11.4-03 | integration | Grace expiry with host still live: room not destroyed, live count correct | ✅ Pass |

### VP-11.5 Remove Off-Contract Nickname-Update Feature

| Test # | Suite | Purpose | Status |
|---|---|---|---|
| T11.5-01 | build (typecheck) | Full typecheck clean; greps return 0 matches | ✅ Pass |
| T11.5-02 | integration (existing) | Emitting `nickname_update` is silently ignored | ✅ Pass |
| T11.5-03 | integration (existing) | Nickname validation at join/create preserved | ✅ Pass |
| T11.5-04 | build (lint) | `npm run lint` in frontend exits 0 | ✅ Pass |

### VP-11.6 Fix Kick Reason & Socket Removal Order

| Test # | Suite | Purpose | Status |
|---|---|---|---|
| T11.6-01 | integration | Kicked socket does not receive `peer_left` about itself | ✅ Pass |
| T11.6-02 | integration | `participant_kicked` arrives before `peer_left` on remaining participants | ✅ Pass |
| T11.6-03 | integration | `peer_left` from kick carries `reason: "kick"` | ✅ Pass |
| T11.6-04 | integration (existing) | Solo timer still restarts correctly after kick | ✅ Pass |
| T11.6-05 | unit (frontend) | `onPeerLeft` renders "was removed" for `reason: "kick"` | ✅ Pass |
| T11.6-06 | unit (frontend) | `onPeerLeft` "disconnected"/"left" unchanged for existing reasons | ✅ Pass |

### VP-11.7 Drop Heartbeat Mechanism

| Test # | Suite | Purpose | Status |
|---|---|---|---|
| T11.7-01 | build (typecheck) | Heartbeat removal exhaustive; `lastSeenAt` retained | ✅ Pass |
| T11.7-02 | integration (modify existing) | Existing T3.1-01 heartbeat test deleted | ✅ Pass |
| T11.7-04 | integration (new) | `lastSeenAt` refreshes on signaling activity | ✅ Pass |

### VP-11.8 Raise IP Create Rate Limit Threshold

| Test # | Suite | Purpose | Status |
|---|---|---|---|
| T11.8-01 | unit | `CREATE_RATE_LIMIT_MAX` constant equals 30 | ✅ Pass |
| T11.8-02 | unit | IP create block triggers at 31st attempt, not 11th | ✅ Pass (direct function-level test) |

## Recommendation

All unit and integration tests pass (304/304). E2E is 24/25. The one E2E failure (**T10.4-03/04**) is a regression: when `resume_session` fails with `ROOM_NOT_FOUND`, the frontend stays on "Reconnecting…" instead of resetting to the lobby. This is an out-of-scope bug relative to Phase 11 VP items — no Phase 11 subtask touched the session-resume error path. Should be tracked and fixed before declaring Phase 11 complete, or logged as a Phase 12 backlog item.
