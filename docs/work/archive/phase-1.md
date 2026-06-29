# Phase 1 — Detailed Work Matrix

Date: 2026-05-27
Owner: @vapor-pm

## Table of Contents

- [1. VP-1.1 Canonical Socket Event Naming](#1-vp-11-canonical-socket-event-naming)
	- [1.1 Implementation Plan](#11-implementation-plan)
	- [1.2 Test Plan](#12-test-plan)
- [2. VP-1.2 Deterministic Room Cleanup](#2-vp-12-deterministic-room-cleanup)
	- [2.1 Implementation Plan](#21-implementation-plan)
	- [2.2 Test Plan](#22-test-plan)
- [3. VP-1.3 Discoverability and Accessibility Shell](#3-vp-13-discoverability-and-accessibility-shell)
	- [3.1 Implementation Plan](#31-implementation-plan)
	- [3.2 Test Plan](#32-test-plan)
- [4. VP-1.4 Password Hashing and Auth Envelope](#4-vp-14-password-hashing-and-auth-envelope)
	- [4.1 Implementation Plan](#41-implementation-plan)
	- [4.2 Test Plan](#42-test-plan)
- [5. VP-1.5 Host Identity and UI](#5-vp-15-host-identity-and-ui)
	- [5.1 Implementation Plan](#51-implementation-plan)
	- [5.2 Test Plan](#52-test-plan)
- [6. VP-1.6 Grace Window Timers and Invariants](#6-vp-16-grace-window-timers-and-invariants)
	- [6.1 Implementation Plan](#61-implementation-plan)
	- [6.2 Test Plan](#62-test-plan)
- [7. VP-1.7 Solo-Host Timeout Policy](#7-vp-17-solo-host-timeout-policy)
	- [7.1 Implementation Plan](#71-implementation-plan)
	- [7.2 Test Plan](#72-test-plan)

## 1. VP-1.1 Canonical Socket Event Naming

### 1.1 Implementation Plan

| Subtask | Task | Module / Interface | Detail | Responsibility | Pass Criteria | Evidence Pointer |
|---|---|---|---|---|---|---|
| 1.1.1 | Define canonical event names and payloads | shared contract file for events | Keep one authoritative event source so FE and BE emit and consume the same socket vocabulary. | @sys-architect | Contract tests fail on drift immediately. | frontend/tests/contract.integration.test.mjs; backend contract tests |
| 1.1.2 | Lock FE and BE event handling to the contract | frontend/backend event handlers | Update handler paths to consume the canonical event names only. | @sys-architect, @fe-expert | No legacy event name remains in active paths. | frontend tests; backend tests |

### 1.2 Test Plan

| Test # | Current Test Code | Suite | Purpose | Verification Focus |
|---|---|---|---|---|
| T1.1-01 | P1-EV-008 | backend/tests/security.policy.test.ts | Prove backend event names are sourced from the shared contract. | Event naming drift is blocked. |
| T1.1-02 | P1-EV-009 | backend/tests/security.policy.test.ts | Prove legacy destroy-reason alias is not exposed. | Canonical destroy reasons only. |
| T1.1-03 | P0-HR-002 | frontend/tests/contract.integration.test.mjs | Prove FE contract names stay aligned with shared events. | FE and BE event vocabularies stay synced. |

## 2. VP-1.2 Deterministic Room Cleanup

### 2.1 Implementation Plan

| Subtask | Task | Module / Interface | Detail | Responsibility | Pass Criteria | Evidence Pointer |
|---|---|---|---|---|---|---|
| 1.2.1 | Prune room data atomically | [backend/src/signaling/state.ts](backend/src/signaling/state.ts), cleanup logic in registerSocketHandlers | Remove room, participant, and timer references together when terminal cleanup happens. | @sys-architect, @qa-engineer | No orphaned timers or stale Map entries remain. | backend integration tests |
| 1.2.2 | Prove no-growth behavior | backend cleanup tests | Add regression checks that empty-room cleanup does not leak room count or indexes over repeated cycles. | @qa-engineer | Repeated cleanup cycles stay flat and deterministic. | test_results |

### 2.2 Test Plan

| Test # | Current Test Code | Suite | Purpose | Verification Focus |
|---|---|---|---|---|
| T1.2-01 | P1-LV-014 | backend/tests/socket.integration.test.ts | Verify lifecycle cleanup uses grace and precedence primitives. | Cleanup is tied to authoritative timers and reasons. |
| T1.2-02 | P1-LV-015 | backend/tests/security.policy.test.ts | Verify solo-timeout and destroy-reason precedence remain locked. | Room cleanup obeys canonical destroy order. |
| T1.2-03 | P0-LV-008 | backend/tests/roomLifecycle.unit.test.ts | Verify room pruning remains atomic and leak-free. | No residual state survives cleanup. |

## 3. VP-1.3 Discoverability and Accessibility Shell

### 3.1 Implementation Plan

| Subtask | Task | Module / Interface | Detail | Responsibility | Pass Criteria | Evidence Pointer |
|---|---|---|---|---|---|---|
| 1.3.1 | Keep FAQ and Privacy in frontend source | [frontend/src/features/info/MarkdownPage.tsx](frontend/src/features/info/MarkdownPage.tsx), [frontend/src/features/info/faq.md](frontend/src/features/info/faq.md), [frontend/src/features/info/privacy-policy.md](frontend/src/features/info/privacy-policy.md) | Render policy copy from frontend markdown assets instead of system docs. | @fe-expert | UI pages load from local markdown assets. | frontend UI smoke tests |
| 1.3.2 | Preserve accessible shell structure | frontend app shell and nav | Ensure a semantic top-level heading and accessible nav affordances are present. | @fe-expert | Accessibility checks pass and shell structure stays stable. | frontend contract tests |

### 3.2 Test Plan

| Test # | Current Test Code | Suite | Purpose | Verification Focus |
|---|---|---|---|---|
| T1.3-01 | P1-UI-013 | frontend/tests/contract.integration.test.mjs | Verify privacy and FAQ links plus semantic shell behavior. | Discoverability copy and shell structure remain present. |
| T1.3-02 | VP-1.3-AC3 | frontend/tests/contract.integration.test.mjs | Verify the global sr-only utility class exists. | Accessibility utility class stays available. |

## 4. VP-1.4 Password Hashing and Auth Envelope

### 4.1 Implementation Plan

| Subtask | Task | Module / Interface | Detail | Responsibility | Pass Criteria | Evidence Pointer |
|---|---|---|---|---|---|---|
| 1.4.1 | Hash passwords with Argon2id | backend auth path in registerSocketHandlers | Use Argon2id with per-room salt plus server pepper for room password handling. | @sys-architect | Password verification succeeds and plaintext is never logged. | backend security tests |
| 1.4.2 | Normalize auth failures | shared auth contract and error mapping | Return deterministic INVALID_PASSWORD semantics for wrong password paths. | @sys-architect, @qa-engineer | Wrong password path is deterministic and tested. | backend security tests; frontend contract tests |

### 4.2 Test Plan

| Test # | Current Test Code | Suite | Purpose | Verification Focus |
|---|---|---|---|---|
| T1.4-01 | VP-1.4-AC1/AC2/AC3 | backend/tests/socket.integration.test.ts | Verify create/join/update enforce trimmed password semantics. | Invalid passwords normalize deterministically. |
| T1.4-02 | P1-AU-013 | frontend/tests/contract.integration.test.mjs | Verify FE copy and required-password submit hook remain locked. | FE auth UI stays aligned with policy. |

## 5. VP-1.5 Host Identity and UI

### 5.1 Implementation Plan

| Subtask | Task | Module / Interface | Detail | Responsibility | Pass Criteria | Evidence Pointer |
|---|---|---|---|---|---|---|
| 1.5.1 | Add hostId to the session contract | shared session types | Ensure the room payload carries authoritative host identity for downstream consumers. | @sys-architect | hostId is always present when expected. | backend contract tests |
| 1.5.2 | Render host badge deterministically | frontend host badge component | Show host identity clearly without guessing from client-local state. | @fe-expert | Badge matches the server-owned host identity. | frontend integration tests |

### 5.2 Test Plan

| Test # | Current Test Code | Suite | Purpose | Verification Focus |
|---|---|---|---|---|
| T1.5-01 | VP-1.5-AC1/AC2 | frontend/tests/contract.integration.test.mjs | Verify explicit host labeling appears in the room model and UI. | Host identity stays explicit and visible. |
| T1.5-02 | P1-UI-014 | frontend/tests/contract.integration.test.mjs | Verify explicit host identity rendering remains stable. | FE renders host/self-host states deterministically. |

## 6. VP-1.6 Grace Window Timers and Invariants

### 6.1 Implementation Plan

| Subtask | Task | Module / Interface | Detail | Responsibility | Pass Criteria | Evidence Pointer |
|---|---|---|---|---|---|---|
| 1.6.1 | Centralize grace timing | backend lifecycle logic | Make grace-window timing authoritative and deterministic in the signaling layer. | @sys-architect | Grace logic no longer depends on scattered ad hoc timers. | backend integration tests |
| 1.6.2 | Verify race behavior under churn | backend and frontend lifecycle tests | Add coverage for reconnects, leave/rejoin, and host transitions so race outcomes stay stable. | @sys-architect, @qa-engineer, @fe-expert | Lifecycle invariants hold under reconnect churn. | backend and frontend integration tests |

### 6.2 Test Plan

| Test # | Current Test Code | Suite | Purpose | Verification Focus |
|---|---|---|---|---|
| T1.6-01 | P1-LV-014 | backend/tests/socket.integration.test.ts | Verify lifecycle uses grace and precedence primitives. | Grace timers and reason precedence remain canonical. |
| T1.6-02 | P1-LV-015 | backend/tests/security.policy.test.ts | Verify solo-room timeout and destroy precedence stay locked. | Terminal lifecycle stays deterministic. |

## 7. VP-1.7 Solo-Host Timeout Policy

### 7.1 Implementation Plan

| Subtask | Task | Module / Interface | Detail | Responsibility | Pass Criteria | Evidence Pointer |
|---|---|---|---|---|---|---|
| 1.7.1 | Emit soloHostDeadlineAt on create | [backend/src/signaling/registerSocketHandlers.ts](backend/src/signaling/registerSocketHandlers.ts), shared room contract | Return the authoritative solo-host deadline in the room_created payload. | @sys-architect | Room creation payload includes the deadline field. | backend tests; contract tests |
| 1.7.2 | Enforce canonical destroy reasons | backend room destruction path | Ensure destroy reason precedence stays limited to the agreed canonical set. | @sys-architect, @qa-engineer | Destroy reasons stay deterministic and covered. | backend tests |

### 7.2 Test Plan

| Test # | Current Test Code | Suite | Purpose | Verification Focus |
|---|---|---|---|---|
| T1.7-01 | P1-LV-015 | backend/tests/security.policy.test.ts | Verify solo-timeout and destroy-reason precedence remain locked. | Solo timeout and destroy reason semantics stay canonical. |
| T1.7-02 | P1-UI-014 | frontend/tests/contract.integration.test.mjs | Verify room lifetime text and solo-room UI remain correct. | Countdown and UI copy remain consistent. |
