# Phase 3 — Detailed Work Matrix

Date: 2026-06-01

## Table of Contents

- [1. VP-3.1 Security & Housekeeping](#1-vp-31-security--housekeeping)
	- [1.1 Implementation Plan](#11-implementation-plan)
	- [1.2 Test Plan](#12-test-plan)
- [2. VP-3.2 User Identity & UX](#2-vp-32-user-identity--ux)
	- [2.1 Implementation Plan](#21-implementation-plan)
	- [2.2 Test Plan](#22-test-plan)
- [3. VP-3.3 Ops, Abuse Controls & Tests](#3-vp-33-ops-abuse-controls--tests)
	- [3.1 Implementation Plan](#31-implementation-plan)
	- [3.2 Test Plan](#32-test-plan)

## 1. VP-3.1 Security & Housekeeping

### 1.1 Implementation Plan

| Subtask | Task | Module / Interface | Detail | Responsibility | Pass Criteria | Evidence Pointer |
|---|---|---|---|---|---|---|
| 3.1.1 | Refresh participant liveness on heartbeat | [backend/src/signaling/registerSocketHandlers.ts](../../backend/src/signaling/registerSocketHandlers.ts), [backend/src/signaling/state.ts](../../backend/src/signaling/state.ts) | Update `lastSeenAt` on `heartbeat()` and other authenticated room activity so stale-session housekeeping has a reliable in-memory signal. | @sys-architect | Heartbeats refresh activity timestamps without persisting state. | backend unit/integration tests |
| 3.1.2 | Add periodic sweeper for expired rooms and stale indexes | backend signaling lifecycle and timer handling | Prune expired rooms, stale participant records, and dead indexes on a configurable hour-based cadence (default 5h), while keeping all state RAM-only. | @sys-architect, @qa-engineer | Expired rooms and stale indexes are removed deterministically. | backend lifecycle tests |
| 3.1.3 | Harden reconnect token storage and invalidation | [backend/src/signaling/registerSocketHandlers.ts](../../backend/src/signaling/registerSocketHandlers.ts), [backend/src/signaling/state.ts](../../backend/src/signaling/state.ts) | Move to hashed reconnect-token validation with versioned invalidation so replayed or stale tokens cannot resume a session; serialize password updates and resume attempts through a per-room mutex/lock so a password change never races an in-flight resume. | @sys-architect | Reconnect validation rejects stale or mismatched tokens. | backend reconnect tests |
| 3.1.4 | Make room destruction atomic | backend room destruction path | Clear host and guest timers, mark the room destroyed, remove `participantToRoom`, `socketToParticipant`, `nicknameToParticipant`, and `reconnectIndex` entries, purge password fields, remove the room from room maps, and emit one canonical destroy reason in that order. | @sys-architect, @qa-engineer | No room state survives destruction. | backend cleanup tests |

### 1.2 Test Plan

| Test # | Current Test Code | Suite | Purpose | Verification Focus |
|---|---|---|---|---|
| T3.1-01 | P3-SH-001 | backend/tests/socket.integration.test.ts | Verify heartbeat updates participant liveness and does not leak persistence. | Activity timestamps stay RAM-only. |
| T3.1-02 | P3-SH-002 | backend/tests/socket.integration.test.ts | Verify sweeper prunes expired rooms and stale indexes. | Housekeeping is deterministic. |
| T3.1-03 | P3-SH-003 | backend/tests/socket.integration.test.ts | Verify reconnect token invalidation and version checks reject stale resumes. | Reconnect replay is blocked. |
| T3.1-04 | P3-SH-004 | backend/tests/socket.integration.test.ts | Verify room destruction clears timers and indexes atomically. | No ghost room state remains. |
| T3.1-05 | P3-SH-005 | backend/tests/contract.integration.test.mjs | Verify the per-room lock serializes password updates and reconnect validation so overlap remains deterministic. | Mutation ordering stays canonical. |
| T3.1-06 | P3-SH-006 | backend/tests/socket.integration.test.ts | Verify resume_session returns ROOM_NOT_FOUND when the grace deadline has elapsed without the grace timer firing. | Expired reconnect window is rejected deterministically. |
| T3.1-07 | P3-SH-007 | backend/tests/socket.integration.test.ts | Verify the solo-host timer handle is cleared when the first guest joins the room. | Solo-host timer lifecycle is correct. |
| T3.1-08 | P3-SH-008 | backend/tests/socket.integration.test.ts | Verify the host grace timer fires and destroys the room with host_grace_expired when the host does not reconnect. | Host grace expiry path is deterministic. |
| T3.1-09 | P3-SH-009 | backend/tests/socket.integration.test.ts | Verify resume_session returns ROOM_NOT_FOUND when the participant has not disconnected (token is valid but disconnected flag is false). | Token guard blocks live-session hijack. |
| T3.1-10 | P3-SH-010 | backend/tests/socket.integration.test.ts | Verify room_password_update by a non-host guest returns ROOM_NOT_FOUND and leaves the password unchanged. | Host-only authorization guard is enforced. |
| T3.1-11 | P3-SH-011 | backend/tests/socket.integration.test.ts | Verify resume_session with null, undefined, empty, or whitespace-only reconnectToken returns ROOM_NOT_FOUND. | Malformed token injection is rejected at the guard. |
| T3.1-12 | P3-SH-012 | backend/tests/socket.integration.test.ts | Verify the sweeper prunes orphaned participantToRoom and socketToParticipant index entries that have no matching room or participant record. | Orphan index cleanup is exercised as the primary cleanup path. |

## 2. VP-3.2 User Identity & UX

### 2.1 Implementation Plan

| Subtask | Task | Module / Interface | Detail | Responsibility | Pass Criteria | Evidence Pointer |
|---|---|---|---|---|---|---|
| 3.2.1 | Require nickname on create/join | shared signaling payloads and backend join/create handlers | Require a room-scoped nickname for both create and join so identity is explicit from the start. | @sys-architect, @fe-expert | Payload validation rejects missing nickname inputs. | backend contract tests; frontend form tests |
| 3.2.2 | Enforce room-scoped nickname uniqueness and cooldowns | backend room state and nickname indexes | Keep nickname reservations atomic and reject collisions, while enforcing the change cooldown. | @sys-architect, @qa-engineer | Duplicate nicknames and rapid changes are rejected deterministically. | backend integration tests |
| 3.2.3 | Broadcast nickname changes to all participants | backend socket event handling and frontend room state | Emit `nickname_updated` so active peers always show the current participant label. | @sys-architect, @fe-expert | Participants see the latest nickname without refresh. | frontend integration tests |
| 3.2.4 | Preserve nickname reclaim across reconnect | backend resume-session flow and frontend reconnect state | Reclaim the reserved nickname on a successful resume so reconnect behaves like a continuation, not a new identity. | @sys-architect, @fe-expert, @qa-engineer | Successful resume restores the same participant identity. | backend reconnect tests |
| 3.2.5 | Keep UX copy aligned with ephemeral room behavior | [frontend/src/features/info/MarkdownPage.tsx](../../frontend/src/features/info/MarkdownPage.tsx), room entry UX | Ensure the UI stays explicit about ephemeral rooms, recoverability, and deterministic nickname errors. | @fe-expert | Copy stays short, privacy-forward, and state-specific. | frontend contract tests |

### 2.2 Test Plan

| Test # | Current Test Code | Suite | Purpose | Verification Focus |
|---|---|---|---|---|
| T3.2-01 | P3-NK-001 | backend/tests/socket.integration.test.ts | Verify create/join reject missing nicknames. | Nickname is mandatory. |
| T3.2-02 | P3-NK-002 | backend/tests/socket.integration.test.ts | Verify room-scoped nickname collisions are rejected. | Uniqueness stays atomic. |
| T3.2-03 | P3-NK-003 | backend/tests/socket.integration.test.ts | Verify nickname cooldown rejects rapid changes. | Cooldown enforcement is stable. |
| T3.2-04 | P3-NK-004 | backend/tests/socket.integration.test.ts | Verify nickname updates broadcast to all room participants. | Broadcast path stays correct. |
| T3.2-05 | P3-NK-005 | frontend/tests/contract.integration.test.mjs | Verify reconnect restores participant identity and nickname. | Resume flow is identity-safe. |
| T3.2-06 | P3-NK-006 | backend/tests/socket.integration.test.ts | Verify nicknameUpdate rejects missing and blank nickname values with INVALID_SIGNAL_PAYLOAD. | Nickname validation covers the update path. |
| T3.2-07 | P3-NK-007 | backend/tests/socket.integration.test.ts | Verify a guest's nickname is freed from nicknameToParticipant when their grace timer fires, allowing a new participant to join with the same nickname. | Nickname reservation is cleaned up on grace expiry (covers grace-path cleanup bug). |
| T3.2-08 | P3-NK-008 | backend/tests/socket.integration.test.ts | Verify nickname length boundaries: exactly 2 chars rejected, exactly 3 chars accepted, exactly 24 chars accepted, exactly 25 chars rejected. | Min/max length guards are off-by-one–safe. |
| T3.2-09 | P3-NK-009 | backend/tests/socket.integration.test.ts | Verify nicknames containing disallowed characters (@, #, !, control chars, emoji) are rejected with INVALID_SIGNAL_PAYLOAD. | Allowlist regex and control-character guard are exercised. |

## 3. VP-3.3 Ops, Abuse Controls & Tests

### 3.1 Implementation Plan

| Subtask | Task | Module / Interface | Detail | Responsibility | Pass Criteria | Evidence Pointer |
|---|---|---|---|---|---|---|
| 3.3.1 | Add an in-memory temporary blocklist | backend abuse-control path and RAM TTL map | Block bursty create-room subjects/IPs temporarily, with automatic expiry and no durable storage. | @sys-architect, @qa-engineer | Abuse blocks are temporary and RAM-only. | backend policy tests |
| 3.3.2 | Track aggregate operational telemetry only | backend metrics and admin surfaces | Expose room-count, participant-count, lifetime, and RAM aggregates without secret or payload leakage. | @sys-architect, @qa-engineer | Telemetry remains operational-only. | backend security/policy tests |
| 3.3.3 | Add contract coverage for lifecycle edge cases | backend and frontend integration suites | Add coverage for TTL expiry, solo-timeout, and other lifecycle rules that still need explicit release-gate proof. | @qa-engineer | Active contract tests cover the current phase slice. | backend/frontend contract tests |
| 3.3.4 | Keep release evidence mapped to phase work | docs/test_results and phase matrix linkage | Tie every completed slice to deterministic evidence so Phase 3 closure can be reviewed quickly. | @vapor-pm, @qa-engineer | Evidence pointers resolve cleanly. | docs/test_results artifacts |
| 3.3.5 | Add IP-scoped abuse counters | backend abuse-control path and RAM TTL map | Track per-IP room-creation/join abuse counters independently from room destruction so the same request context can be rate-limited across rooms until its window expires or the process restarts. | @sys-architect, @qa-engineer | Per-IP counters exist in RAM only and are not cleared by room teardown. | backend policy tests |

### 3.2 Test Plan

| Test # | Current Test Code | Suite | Purpose | Verification Focus |
|---|---|---|---|---|
| T3.3-01 | P3-AB-001 | backend/tests/security.policy.test.ts | Verify temporary blocklist behavior stays RAM-only. | No durable abuse state exists. |
| T3.3-02 | P3-AB-002 | backend/tests/security.policy.test.ts | Verify aggregate telemetry excludes passwords, tokens, SDP, ICE, and chat payloads. | Observability stays privacy-safe. |
| T3.3-03 | P3-AB-003 | backend/tests/socket.integration.test.ts | Verify create-room burst handling returns deterministic `RATE_LIMITED`. | Abuse rejection is stable. |
| T3.3-04 | P3-AB-004 | frontend/tests/contract.integration.test.mjs | Verify lifecycle edge cases remain covered by the active contract suite. | Phase 3 regression coverage is visible. |
| T3.3-05 | P3-AB-005 | backend/tests/security.policy.test.ts | Verify per-IP counters persist only within the RAM window and are not cleared by room destruction. | Abuse counters remain room-agnostic. |
| T3.3-06 | P3-AB-006 | backend/tests/socket.integration.test.ts | Verify that more than IP_CREATE_THRESHOLD room-creation requests from the same IP within the abuse window are blocked with RATE_LIMITED. | IP-level create abuse counter is enforced behaviorally. |
| T3.3-07 | P3-AB-007 | backend/tests/socket.integration.test.ts | Verify that join-attempt lock state is purged when a room is destroyed so a recycled room ID does not inherit a stale cooldown from the previous room. | purgeJoinAttemptsForRoom clears per-room lock state on destruction. |
| T3.3-08 | P3-AB-008 | backend/tests/socket.integration.test.ts | Verify that a join attempt with the correct password succeeds after the per-room cooldown expires, confirming the cooldown-reset path clears cooldownUntil. | Expired-cooldown reset branch is exercised. |

## Notes

- This matrix is the active planning doc for Phase 3.
- Keep it in sync with [docs/Todo.md](../Todo.md) as Phase 3 slices are closed.
- Server process restart is a full RAM wipe for room state, reconnect state, password state, and temporary abuse-control caches; no room-local recovery is expected after restart.
- Move completed Phase 3 history to `archive/` only after the active slice is finished.