# Phase 0 — Detailed Work Matrix

Date: 2026-05-27

## Table of Contents

- [1. VP-0.0 Test Harness and CI Gates](#1-vp-00-test-harness-and-ci-gates)
	- [1.1 Implementation Plan](#11-implementation-plan)
	- [1.2 Test Plan](#12-test-plan)
- [2. VP-0.1 Create and Join Happy Path](#2-vp-01-create-and-join-happy-path)
	- [2.1 Implementation Plan](#21-implementation-plan)
	- [2.2 Test Plan](#22-test-plan)
- [3. VP-0.2 Leave Semantics and Cleanup](#3-vp-02-leave-semantics-and-cleanup)
	- [3.1 Implementation Plan](#31-implementation-plan)
	- [3.2 Test Plan](#32-test-plan)
- [4. VP-0.3 Disconnect and Stale-Session Eviction](#4-vp-03-disconnect-and-stale-session-eviction)
	- [4.1 Implementation Plan](#41-implementation-plan)
	- [4.2 Test Plan](#42-test-plan)
- [5. VP-0.ZP Zero-Persistence Contract](#5-vp-zp-zero-persistence-contract)
	- [5.1 Implementation Plan](#51-implementation-plan)
	- [5.2 Test Plan](#52-test-plan)

## 1. VP-0.0 Test Harness and CI Gates

### 1.1 Implementation Plan

| Subtask | Task | Module / Interface | Detail | Responsibility | Pass Criteria | Evidence Pointer |
|---|---|---|---|---|---|---|
| 0.0.1 | Establish contract and integration lanes | [frontend/tests](frontend/tests), [backend/tests](backend/tests) | Add baseline FE and BE contract coverage for socket lifecycle flows so regressions fail locally before merge. | @qa-engineer, @sys-architect | CI and local test runs exercise the expected socket contract suite. | frontend/tests, backend/tests |
| 0.0.2 | Wire PR gate for phase baseline | [.github/workflows/ci.yml](.github/workflows/ci.yml) | Ensure PR validation runs the contract and integration suites and blocks merges on failures. | @qa-engineer | PR gate fails on contract drift or socket integration breakage. | CI pipeline runs |
| 0.0.3 | Protect smoke evidence path | docs/test_results | Keep smoke evidence pointer conventions stable so later phase checks can reuse the same artifact trail. | @vapor-pm, @qa-engineer | Evidence pointers remain stable and are easy to cross-check. | docs/test_results |

### 1.2 Test Plan

| Test # | Current Test Code | Suite | Purpose | Verification Focus |
|---|---|---|---|---|
| T0.0-01 | P0-HR-002 | frontend/tests/contract.integration.test.mjs | Lock the MVP event-contract baseline between client and server types. | Shared event constants and payload aliases stay canonical. |
| T0.0-02 | T0.ZP-01 | backend/tests/security.policy.test.ts | Prove runtime paths avoid persistence APIs and libraries. | Zero-persistence policy remains intact in signaling/runtime code. |

## 2. VP-0.1 Create and Join Happy Path

### 2.1 Implementation Plan

| Subtask | Task | Module / Interface | Detail | Responsibility | Pass Criteria | Evidence Pointer |
|---|---|---|---|---|---|---|
| 0.1.1 | Implement create_room envelope and room Map insertion | [backend/src/signaling/registerSocketHandlers.ts](backend/src/signaling/registerSocketHandlers.ts), [backend/src/signaling/state.ts](backend/src/signaling/state.ts) | Create rooms in RAM only, assign host identity, and store the authoritative room record in the in-memory Map. | @sys-architect | Room creation succeeds with deterministic server-side state. | backend/tests/socket.integration.test.ts |
| 0.1.2 | Implement join_room happy path | [backend/src/signaling/registerSocketHandlers.ts](backend/src/signaling/registerSocketHandlers.ts), [backend/src/signaling/state.ts](backend/src/signaling/state.ts) | Join requests resolve against the room Map using case-sensitive room IDs and emit the expected peer join updates. | @sys-architect, @fe-expert | Guest join updates room state and peer notifications are emitted. | backend/tests/socket.integration.test.ts; frontend contract tests |
| 0.1.3 | Keep the lobby UI aligned with backend truth | frontend lobby flow | Ensure the create/join UI reflects the exact backend outcome instead of guessing room state locally. | @fe-expert | Lobby actions map cleanly to server success and failure states. | frontend contract tests |

### 2.2 Test Plan

| Test # | Current Test Code | Suite | Purpose | Verification Focus |
|---|---|---|---|---|
| T0.1-01 | T0.1-01 | backend/tests/roomLifecycle.unit.test.ts | Verify createRoomRecord rejects room-id collisions by generating a unique room. | Unique room creation remains deterministic. |
| T0.1-02 | T0.1-02 | backend/tests/roomLifecycle.unit.test.ts | Verify joinRoomRecord returns null when room does not exist. | Missing-room joins fail cleanly. |
| T0.1-03 | P0-CR-001 | backend/tests/socket.integration.test.ts | Verify create-room succeeds and emits deterministic payloads. | Room creation inserts host and room state correctly. |
| T0.1-04 | P0-JN-002 | backend/tests/socket.integration.test.ts | Verify join-room succeeds with matching room ID and password. | Join flow emits room_joined and peer_joined. |
| T0.1-05 | P0-JN-003 | backend/tests/socket.integration.test.ts | Verify altered-case room IDs fail exact-match lookup. | Room IDs remain case-sensitive and server-authoritative. |
| T0.1-06 | P0-HR-002 | frontend/tests/contract.integration.test.mjs | Confirm FE contract types preserve the shared create/join payload shape. | FE does not drift from the shared event contract. |
| T0.1-07 | T0.1-07 | backend/tests/socket.integration.test.ts | Verify missing roomId payload returns deterministic ROOM_NOT_FOUND. | Missing room IDs fail with a stable envelope. |
| T0.1-08 | T0.1-08 | frontend/tests/contract.integration.test.mjs | Verify FE join emit preserves exact roomId input text. | FE passes the input room ID without mutation. |

## 3. VP-0.2 Leave Semantics and Cleanup

### 3.1 Implementation Plan

| Subtask | Task | Module / Interface | Detail | Responsibility | Pass Criteria | Evidence Pointer |
|---|---|---|---|---|---|---|
| 0.2.1 | Preserve guest leave behavior | [backend/src/signaling/registerSocketHandlers.ts](backend/src/signaling/registerSocketHandlers.ts), [backend/src/signaling/state.ts](backend/src/signaling/state.ts) | Remove the leaving guest without destroying the room or affecting surviving participants. | @sys-architect | Guest leave keeps the room alive and updates participant state correctly. | backend tests |
| 0.2.2 | Destroy room on host leave | [backend/src/signaling/registerSocketHandlers.ts](backend/src/signaling/registerSocketHandlers.ts) | Emit the canonical room destruction path when the host leaves voluntarily. | @sys-architect, @qa-engineer | Host leave emits room_destroyed with the host_left reason. | backend tests |
| 0.2.3 | Clear UI state on terminal leave flows | frontend room reducer and lifecycle handling | Ensure the UI resets volatile room state after terminal leave or room-destroy events. | @fe-expert | Room UI returns to lobby without stale session state. | frontend lifecycle tests |

### 3.2 Test Plan

| Test # | Current Test Code | Suite | Purpose | Verification Focus |
|---|---|---|---|---|
| T0.2-01 | T0.2-01 | backend/tests/roomLifecycle.unit.test.ts | Verify removing an unknown socket returns null. | Unknown-socket cleanup is a no-op. |
| T0.2-02 | T0.2-02 | backend/tests/roomLifecycle.unit.test.ts | Verify host removal purges participant and socket indexes atomically. | Host leave clears all authoritative indexes. |
| T0.2-03 | T0.2-03 | backend/tests/roomLifecycle.unit.test.ts | Verify removing the last guest destroys the room correctly. | Empty-room cleanup is atomic and deterministic. |
| T0.2-04 | T0.2-04 | backend/tests/socket.integration.test.ts | Verify guest leave_room removes participant and emits peer_left. | Guest removal does not destroy room state. |
| T0.2-05 | T0.2-05 | backend/tests/socket.integration.test.ts | Verify host leave_room destroys room immediately with host_left reason. | Host leave destroys the room with the canonical reason. |

## 4. VP-0.3 Disconnect and Stale-Session Eviction

### 4.1 Implementation Plan

| Subtask | Task | Module / Interface | Detail | Responsibility | Pass Criteria | Evidence Pointer |
|---|---|---|---|---|---|---|
| 0.3.1 | Track last seen timestamps | [backend/src/signaling/state.ts](backend/src/signaling/state.ts) | Maintain lastSeenAt or equivalent timestamp tracking for socket and participant liveness. | @sys-architect | State supports stale-session age checks. | backend integration tests |
| 0.3.2 | Evict stale participants after timeout | backend disconnect and timer handling | Remove stale sockets after the grace or TTL window without ejecting active participants early. | @sys-architect, @qa-engineer | Stale participants are pruned deterministically. | backend tests; smoke tests |
| 0.3.3 | Keep reconnect within grace deterministic | backend reconnect handling | Allow a reconnecting participant to resume if still inside the allowed grace window. | @sys-architect, @qa-engineer | Reconnect within grace restores the session and does not duplicate state. | backend integration tests |

### 4.2 Test Plan

| Test # | Current Test Code | Suite | Purpose | Verification Focus |
|---|---|---|---|---|
| T0.3-01 | T1.6-01 | backend/tests/socket.integration.test.ts | Confirm guest disconnect starts grace and removes guest only after guest-grace timeout. | Disconnect cleanup does not leak participants or timers. |
| T0.3-02 | T1.6-02 | backend/tests/socket.integration.test.ts | Confirm host disconnect enters grace flow and does not destroy room immediately. | Host disconnect does not immediately destroy the room. |
| T0.3-03 | T1.6-03 | backend/tests/socket.integration.test.ts | Confirm resume_session before grace deadline restores the host without room destruction. | Reconnect within grace restores the session deterministically. |

## 5. VP-0.ZP Zero-Persistence Contract

### 5.1 Implementation Plan

| Subtask | Task | Module / Interface | Detail | Responsibility | Pass Criteria | Evidence Pointer |
|---|---|---|---|---|---|---|
| ZP.1 | Keep room/session state RAM-only | repo policy, runtime room Map | Do not persist rooms, participants, passwords, or reconnect data to durable storage. | @sys-architect, @qa-engineer | Restart clears all runtime state. | test_results; restart smoke tests |
| ZP.2 | Clear all indexes on restart | backend runtime reset path | Ensure room, participant, and socket indexes are wiped together when the process resets. | @sys-architect | No stale indexes survive process restart. | backend restart smoke tests |

### 5.2 Test Plan

| Test # | Current Test Code | Suite | Purpose | Verification Focus |
|---|---|---|---|---|
| T0.ZP-01 | T0.ZP-01 | backend/tests/security.policy.test.ts | Confirm runtime paths avoid persistence APIs and libraries. | No filesystem or database persistence in signaling paths. |
| T0.ZP-02 | T1.ZP-01 | backend/tests/security.policy.test.ts | Confirm no obvious secret-logging statements exist in backend source. | Secrets remain absent from logs and telemetry. |
