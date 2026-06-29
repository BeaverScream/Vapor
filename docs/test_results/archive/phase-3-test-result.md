# Phase 3 Test Evidence Matrix

Date: 2026-06-03
Owner: @vapor-pm / @qa-engineer
Gate Decision: **✅ CLOSED** — All 75 tests pass across all three suites; all regression failures resolved

---

## Run Summary (2026-06-03)

| Suite | Command | Pass | Fail | Total |
|---|---|---|---|---|
| backend/tests/socket.integration.test.ts | `npm run test:socket` | 48 | 0 | 48 |
| backend/tests/security.policy.test.ts | `npm run test:security` | 10 | 0 | 10 |
| frontend/tests/contract.integration.test.mjs | `npm run test:contract` | 17 | 0 | 17 |
| **Total** | | **75** | **0** | **75** |

---

## 1. VP-3.1 Security & Housekeeping

All twelve tests are present and passing.

| Test Code | Suite | Test Name | Line | Status |
|---|---|---|---|---|
| P3-SH-001 | backend/tests/socket.integration.test.ts | T3.1-01: heartbeat refreshes participant lastSeenAt and does not persist state | 1191 | ✅ Pass |
| P3-SH-002 | backend/tests/socket.integration.test.ts | T3.1-02: sweeper prunes expired rooms and stale indexes on trigger | 1226 | ✅ Pass |
| P3-SH-003 | backend/tests/socket.integration.test.ts | T3.1-03: reconnect token is invalidated after password change | 1269 | ✅ Pass |
| P3-SH-004 | backend/tests/socket.integration.test.ts | T3.1-04: room destruction atomically purges timers, indexes, and reconnect records | 1322 | ✅ Pass |
| P3-SH-005 | frontend/tests/contract.integration.test.mjs | T3.1-05: per-room lock serializes password updates and resume-session validation | 334 | ✅ Pass |
| P3-SH-006 | backend/tests/socket.integration.test.ts | T3.1-06: resume_session returns ROOM_NOT_FOUND when grace deadline has elapsed | 1373 | ✅ Pass |
| P3-SH-007 | backend/tests/socket.integration.test.ts | T3.1-07: solo-host timer handle is cleared when first guest joins the room | 1440 | ✅ Pass |
| P3-SH-008 | backend/tests/socket.integration.test.ts | T3.1-08: host grace timer fires and destroys room with host_grace_expired; post-expiry resume returns ROOM_NOT_FOUND | 1541 | ✅ Pass |
| P3-SH-009 | backend/tests/socket.integration.test.ts | T3.1-09: resume_session returns ROOM_NOT_FOUND when participant token is valid but participant has not disconnected | 2088 | ✅ Pass |
| P3-SH-010 | backend/tests/socket.integration.test.ts | T3.1-10: room_password_update by a non-host guest returns ROOM_NOT_FOUND and leaves password unchanged | 2118 | ✅ Pass |
| P3-SH-011 | backend/tests/socket.integration.test.ts | T3.1-11: resume_session with null, undefined, empty, or whitespace-only reconnectToken returns ROOM_NOT_FOUND | 2151 | ✅ Pass |
| P3-SH-012 | backend/tests/socket.integration.test.ts | T3.1-12: sweeper prunes orphaned participantToRoom and socketToParticipant entries with no matching room or participant | 2185 | ✅ Pass |

**Subtask coverage:**

| Subtask | Implementation Module | Evidence |
|---|---|---|
| 3.1.1 Refresh participant liveness on heartbeat | registerSocketHandlers.ts, state.ts | P3-SH-001 ✅ |
| 3.1.2 Periodic sweeper for expired rooms and stale indexes | registerSocketHandlers.ts sweepIntervalMs path | P3-SH-002 ✅, P3-SH-012 ✅ |
| 3.1.3 Harden reconnect token storage and invalidation | registerSocketHandlers.ts reconnect + lock path | P3-SH-003 ✅, P3-SH-005 ✅, P3-SH-009 ✅, P3-SH-010 ✅, P3-SH-011 ✅ |
| 3.1.4 Make room destruction atomic | registerSocketHandlers.ts destroyRoom path | P3-SH-004 ✅, P3-SH-006 ✅, P3-SH-008 ✅ |

---

## 2. VP-3.2 User Identity & UX

All nine tests are present and passing.

| Test Code | Suite | Test Name | Line | Status |
|---|---|---|---|---|
| P3-NK-001 | backend/tests/socket.integration.test.ts | T3.2-01: create_room and join_room reject missing or blank nicknames | 1635 | ✅ Pass |
| P3-NK-002 | backend/tests/socket.integration.test.ts | T3.2-02: room-scoped nickname collisions are rejected atomically | 1698 | ✅ Pass |
| P3-NK-003 | backend/tests/socket.integration.test.ts | T3.2-03: nickname cooldown rejects rapid changes and allows update after cooldown expires | 1761 | ✅ Pass |
| P3-NK-004 | backend/tests/socket.integration.test.ts | T3.2-04: nickname update broadcasts to all room participants including the requester | 2021 | ✅ Pass |
| P3-NK-005 | frontend/tests/contract.integration.test.mjs | T3.2-05: reconnect flow restores participant identity and nickname | 260 | ✅ Pass |
| P3-NK-006 | backend/tests/socket.integration.test.ts | T3.2-06: nicknameUpdate rejects missing and blank nicknames with INVALID_SIGNAL_PAYLOAD | 2220 | ✅ Pass |
| P3-NK-007 | backend/tests/socket.integration.test.ts | T3.2-07: guest nickname is freed from nicknameToParticipant when grace timer fires, allowing a new participant to join with the same nickname | 2262 | ✅ Pass |
| P3-NK-008 | backend/tests/socket.integration.test.ts | T3.2-08: nickname length boundaries — 2-char rejected, 3-char accepted, 24-char accepted, 25-char rejected | 2328 | ✅ Pass |
| P3-NK-009 | backend/tests/socket.integration.test.ts | T3.2-09: nicknames with disallowed characters are rejected with INVALID_SIGNAL_PAYLOAD | 2380 | ✅ Pass |

**Subtask coverage:**

| Subtask | Implementation Module | Evidence |
|---|---|---|
| 3.2.1 Require nickname on create/join | registerSocketHandlers.ts create/join validation | P3-NK-001 ✅ |
| 3.2.2 Enforce room-scoped nickname uniqueness and cooldowns | registerSocketHandlers.ts nicknameToParticipant index, cooldown check | P3-NK-002 ✅, P3-NK-003 ✅ |
| 3.2.3 Broadcast nickname changes to all participants | registerSocketHandlers.ts nicknameUpdate handler | P3-NK-004 ✅ |
| 3.2.4 Preserve nickname reclaim across reconnect | registerSocketHandlers.ts resume_session path, state-utils.ts | P3-NK-005 ✅ |
| 3.2.5 Keep UX copy aligned with ephemeral behavior | frontend/src/features/info/faq.md, LobbyView.tsx | (UX copy — no dedicated contract test) |
| 3.2.6 Validate nickname format and length boundaries | registerSocketHandlers.ts normalizeNickname | P3-NK-007 ✅, P3-NK-008 ✅, P3-NK-009 ✅ |

---

## 3. VP-3.3 Ops, Abuse Controls & Tests

All ten tests are present and passing.

| Test Code | Suite | Test Name | Line | Status |
|---|---|---|---|---|
| P3-AB-001 | backend/tests/security.policy.test.ts | T3.3-01: temporary blocklist behavior stays RAM-only | — | ✅ Pass |
| P3-AB-002 | backend/tests/security.policy.test.ts | T3.3-02: aggregate telemetry excludes passwords, tokens, SDP, ICE, and chat payloads | — | ✅ Pass |
| P3-AB-003 | backend/tests/socket.integration.test.ts | T3.3-03: create-room burst handling returns deterministic RATE_LIMITED on threshold breach | 1832 | ✅ Pass |
| P3-AB-004 | frontend/tests/contract.integration.test.mjs | T3.3-04: lifecycle edge case contract coverage — TTL expiry, solo-timeout, and quota removal are verifiable | 294 | ✅ Pass |
| P3-AB-005 | backend/tests/security.policy.test.ts | T3.3-05: per-IP counters persist only within the RAM window and are not cleared by room destruction | — | ✅ Pass |
| P3-AB-006 | backend/tests/socket.integration.test.ts | T3.3-06: IP-level create rate limit blocks requests after IP_CREATE_THRESHOLD within the abuse window | 2421 | ✅ Pass |
| P3-AB-007 | backend/tests/socket.integration.test.ts | T3.3-07: join-attempt cooldown state is purged when a room is destroyed so a recycled room ID does not inherit a stale cooldown | 2459 | ✅ Pass |
| P3-AB-008 | backend/tests/socket.integration.test.ts | T3.3-08: join-attempt cooldown resets after expiry and the next correct-password attempt succeeds | 2509 | ✅ Pass |

**Additional lifecycle coverage (BL-SESSION-04):**

| Test Code | Suite | Test Name | Line | Status |
|---|---|---|---|---|
| P3-LC-001 | backend/tests/socket.integration.test.ts | P3-LC-001: solo-host room is destroyed with solo_timeout_expired when host remains alone past deadline | 1885 | ✅ Pass |
| P3-LC-002 | backend/tests/socket.integration.test.ts | P3-LC-002: solo-host timer handle is cleared when first guest joins the room | 1954 | ✅ Pass |

**Subtask coverage:**

| Subtask | Implementation Module | Evidence |
|---|---|---|
| 3.3.1 In-memory temporary blocklist | registerSocketHandlers.ts temporaryBlocklistBySubject | P3-AB-003 ✅, P3-AB-001 ✅ |
| 3.3.2 Aggregate operational telemetry only | admin/metricsRegistry.ts | P3-AB-002 ✅ |
| 3.3.3 Contract coverage for lifecycle edge cases | registerSocketHandlers.ts TTL/solo timers, state.ts | P3-AB-004 ✅, P3-LC-001 ✅ |
| 3.3.4 Release evidence mapped to phase work | docs/test_results/phase-3-test-result.md | This document |
| 3.3.5 IP-scoped abuse counters | registerSocketHandlers.ts createAttemptsBySubject | P3-AB-005 ✅, P3-AB-006 ✅ |
| 3.3.6 Join-attempt cooldown lifecycle | registerSocketHandlers.ts joinAttemptByRoomSubject | P3-AB-007 ✅, P3-AB-008 ✅ |

---

## 4. Coverage Summary

| VP Slice | Tests Present | Tests Failing | Coverage Gate |
|---|---|---|---|
| VP-3.1 Security & Housekeeping | 12 / 12 (P3-SH-001 – P3-SH-012) | 0 | ✅ Complete |
| VP-3.2 User Identity & UX | 9 / 9 (P3-NK-001 – P3-NK-009) | 0 | ✅ Complete |
| VP-3.3 Ops, Abuse Controls | 10 / 10 (P3-AB-001 – P3-AB-008, P3-LC-001, P3-LC-002) | 0 | ✅ Complete |
| **Phase 3 slice** | **31 / 31** | **0** | **✅ Complete** |

---

## 5. Regression Failures (Phase 3 Breaks Pre-existing Tests)

All three previously failing regression tests are now resolved (run 2026-06-03). No failing tests remain.

| ID | Suite | Test | Resolution |
|---|---|---|---|
| FAIL-01 | backend/tests/socket.integration.test.ts | VP-1.2-AC2 | Fixed — each fake socket now gets a unique rate-limit subject so the 20-room loop is not blocked by the burst threshold |
| FAIL-02 | frontend/tests/contract.integration.test.mjs | T2.6-03 | Fixed — contract assertion updated to match `onSendChatMessage(trimmedMessage)` |
| FAIL-03 | frontend/tests/contract.integration.test.mjs | T0.1-07 | Fixed — contract assertion updated to include `nickname: trimmedNickname` in the `emitJoinRoom` call |

---

## 6. Blocking Items

No blocking items remain. Phase 3 is closed.
