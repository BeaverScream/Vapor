# Phase 2 — Detailed Work Matrix

Date: 2026-05-27
Owner: @vapor-pm

## Table of Contents

- [1. VP-2.1 Error Envelope Standardization](#1-vp-21-error-envelope-standardization)
	- [1.1 Implementation Plan](#11-implementation-plan)
	- [1.2 Test Plan](#12-test-plan)
- [2. VP-2.2 Resume Session and Reconnect Ordering](#2-vp-22-resume-session-and-reconnect-ordering)
	- [2.1 Implementation Plan](#21-implementation-plan)
	- [2.2 Test Plan](#22-test-plan)
- [3. VP-2.3 Participant Cap Enforcement](#3-vp-23-participant-cap-enforcement)
	- [3.1 Implementation Plan](#31-implementation-plan)
	- [3.2 Test Plan](#32-test-plan)
- [4. VP-2.4 Join-Attempt Cooldown and Blocklist](#4-vp-24-join-attempt-cooldown-and-blocklist)
	- [4.1 Implementation Plan](#41-implementation-plan)
	- [4.2 Test Plan](#42-test-plan)
- [5. VP-2.5 Solo-Host Deadline Lifecycle](#5-vp-25-solo-host-deadline-lifecycle)
	- [5.1 Implementation Plan](#51-implementation-plan)
	- [5.2 Test Plan](#52-test-plan)
- [6. VP-2.6 Signaling Relay and Chat Readiness](#6-vp-26-signaling-relay-and-chat-readiness)
	- [6.1 Implementation Plan](#61-implementation-plan)
	- [6.2 Test Plan](#62-test-plan)
- [7. VP-2.7 ICE Policy, TURN Hygiene, and Release Gate](#7-vp-27-ice-policy-turn-hygiene-and-release-gate)
	- [7.1 Implementation Plan](#71-implementation-plan)
	- [7.2 Test Plan](#72-test-plan)
- [8. VP-2.X Ops Hygiene](#8-vp-2x-ops-hygiene)
	- [8.1 Implementation Plan](#81-implementation-plan)
	- [8.2 Test Plan](#82-test-plan)

## 1. VP-2.1 Error Envelope Standardization

### 1.1 Implementation Plan

| Subtask | Task | Module / Interface | Detail | Responsibility | Pass Criteria | Evidence Pointer |
|---|---|---|---|---|---|---|
| 2.1.1 | Define one canonical error envelope | shared error contract and backend error mapper | Standardize the error shape and code mapping so every socket failure follows the same structure. | @sys-architect, @fe-expert, @qa-engineer | FE and BE consume the same envelope shape. | frontend/backend contract tests |
| 2.1.2 | Update frontend parser and copy mapping | frontend error parser and UI copy path | Parse the canonical envelope and map it to user-safe messages without branching on ad hoc shapes. | @fe-expert | The parser accepts only the contract shape and maps it deterministically. | frontend error-parser unit tests |

### 1.2 Test Plan

| Test # | Current Test Code | Suite | Purpose | Verification Focus |
|---|---|---|---|---|
| T2.1-01 | P2-ERR-001 | frontend/tests/contract.integration.test.mjs | Verify one deterministic error envelope exists across FE and BE. | Error parser and shared mapping stay aligned. |

## 2. VP-2.2 Resume Session and Reconnect Ordering

### 2.1 Implementation Plan

| Subtask | Task | Module / Interface | Detail | Responsibility | Pass Criteria | Evidence Pointer |
|---|---|---|---|---|---|---|
| 2.2.1 | Make resume path single-winner | [backend/src/signaling/registerSocketHandlers.ts](backend/src/signaling/registerSocketHandlers.ts), [backend/src/signaling/state.ts](backend/src/signaling/state.ts) | Use one authoritative reconnect flow so stale races cannot rebind the session twice. | @sys-architect | Only one resume path wins per reconnect cycle. | backend integration tests |
| 2.2.2 | Validate reconnect tokens and atomic rebind | backend reconnect handling | Ensure reconnect token validation and room rebinding happen atomically. | @sys-architect, @qa-engineer | Stale tokens fail and valid reconnects restore the session. | backend reconnect scenario tests |
| 2.2.3 | Stress rapid disconnect/reconnect churn | reconnect churn tests | Add churn coverage for repeated disconnect/reconnect loops so timer leakage and ghost state are exposed. | @qa-engineer | No ghost participants or lingering timers after churn. | test_results artifacts |

### 2.2 Test Plan

| Test # | Current Test Code | Suite | Purpose | Verification Focus |
|---|---|---|---|---|
| T2.2-01 | P2-CH-004 | frontend/tests/contract.integration.test.mjs | Verify resume-session races resolve to one winning path. | Single-winner reconnect behavior stays deterministic. |
| T2.2-02 | P2-CH-010 | frontend/tests/contract.integration.test.mjs | Verify rapid disconnect/reconnect churn stays stable. | No ghost participants or stale timers survive churn. |

## 3. VP-2.3 Participant Cap Enforcement

### 3.1 Implementation Plan

| Subtask | Task | Module / Interface | Detail | Responsibility | Pass Criteria | Evidence Pointer |
|---|---|---|---|---|---|---|
| 2.3.1 | Gate join before mutation at five participants | [backend/src/signaling/state.ts](backend/src/signaling/state.ts), join handling in registerSocketHandlers | Check the authoritative room size before mutation and reject the sixth participant with ROOM_FULL. | @sys-architect, @qa-engineer | 6th join is rejected deterministically. | backend socket integration tests |
| 2.3.2 | Map ROOM_FULL to safe FE fallback | frontend join affordance and error copy | Show a safe lobby fallback and stable copy for a full room state. | @fe-expert | UX behavior is deterministic when room is full. | frontend integration tests |

### 3.2 Test Plan

| Test # | Current Test Code | Suite | Purpose | Verification Focus |
|---|---|---|---|---|
| T2.3-01 | P2-CH-005 | backend/tests/socket.integration.test.ts | Verify the sixth join is rejected before mutation. | Authoritative cap enforcement stays intact. |
| T2.3-02 | P2-CH-009 | frontend/tests/contract.integration.test.mjs | Verify ROOM_FULL maps to safe FE fallback behavior. | Full-room UX remains deterministic. |

## 4. VP-2.4 Join-Attempt Cooldown and Blocklist

### 4.1 Implementation Plan

| Subtask | Task | Module / Interface | Detail | Responsibility | Pass Criteria | Evidence Pointer |
|---|---|---|---|---|---|---|
| 2.4.1 | Implement RAM-only cooldown and lockout | backend abuse control path and in-memory TTL map | Apply threshold behavior for repeated invalid join attempts with auto-expiring in-memory blocks. | @sys-architect, @qa-engineer | Threshold rules behave exactly as defined and never hit durable storage. | backend tests |
| 2.4.2 | Expose blocklist behavior for verification | backend metrics and policy checks | Surface the abuse-control behavior through testable metrics or policy checks, not hidden heuristics. | @qa-engineer | Policy simulations prove the thresholds. | policy simulation artifacts |

### 4.2 Test Plan

| Test # | Current Test Code | Suite | Purpose | Verification Focus |
|---|---|---|---|---|
| T2.4-01 | P2-RL-015 | backend/tests/security.policy.test.ts | Verify RATE_LIMITED semantics and threshold constants exist. | Join policy is defined canonically. |
| T2.4-02 | P2-RL-016 | backend/tests/socket.integration.test.ts | Verify join-attempt tracking and strict lockout enforcement. | RAM-only abuse controls behave deterministically. |

## 5. VP-2.5 Solo-Host Deadline Lifecycle

### 5.1 Implementation Plan

| Subtask | Task | Module / Interface | Detail | Responsibility | Pass Criteria | Evidence Pointer |
|---|---|---|---|---|---|---|
| 2.5.1 | Emit soloHostDeadlineAt from create_room | [backend/src/signaling/registerSocketHandlers.ts](backend/src/signaling/registerSocketHandlers.ts), shared room contract | Backend sets the authoritative solo-host deadline in the room_created payload. | @sys-architect | Payload includes the deadline field on create. | contract tests |
| 2.5.2 | Consume authoritative deadline in frontend state | frontend solo timer hook | Read the payload value and store it as the only source of truth. | @fe-expert | FE countdown is driven from the server-authored deadline. | frontend integration tests |
| 2.5.3 | Clear timer on first guest join and room end | frontend lifecycle handling and backend room transitions | Cancel the deadline when the first peer joins or the room ends so no stale timer survives. | @sys-architect, @fe-expert, @qa-engineer | Deadline is cleared permanently after join or destroy. | FE/BE lifecycle tests |

### 5.2 Test Plan

| Test # | Current Test Code | Suite | Purpose | Verification Focus |
|---|---|---|---|---|
| T2.5-01 | P2-ST-001 | frontend/tests/contract.integration.test.mjs | Verify room_created includes soloHostDeadlineAt. | Deadline field exists in the payload. |
| T2.5-02 | P2-ST-002 | backend/tests/socket.integration.test.ts | Verify backend emits authoritative soloHostDeadlineAt. | Server-authored deadline is present. |
| T2.5-03 | P2-ST-003 | frontend/tests/contract.integration.test.mjs | Verify frontend session state stores the solo deadline. | FE state uses the server deadline only. |
| T2.5-04 | P2-ST-004 | frontend/tests/contract.integration.test.mjs | Verify reducer syncs the deadline idempotently. | Deadline updates remain deterministic. |
| T2.5-05 | P2-ST-005 | frontend/tests/contract.integration.test.mjs | Verify deadline clears on first peer_joined and never restarts. | Solo timer cancel behavior stays canonical. |
| T2.5-06 | P2-ST-006 | frontend/tests/contract.integration.test.mjs | Verify deadline clears on resetToLobby and room end. | Terminal transitions clear timer state. |
| T2.5-07 | P2-ST-007 | frontend/tests/contract.integration.test.mjs | Verify the solo waiting formatter is canonical. | Countdown copy remains consistent. |
| T2.5-08 | P2-ST-008 | frontend/tests/contract.integration.test.mjs | Verify warning chip visibility tracks the active timer only. | UI warning chip reflects timer state. |
| T2.5-09 | P2-ST-009 | frontend/tests/contract.integration.test.mjs; backend/tests/socket.integration.test.ts | Verify full solo-deadline lifecycle coverage. | Create, clear, and end paths are all tested. |

## 6. VP-2.6 Signaling Relay and Chat Readiness

### 6.1 Implementation Plan

| Subtask | Task | Module / Interface | Detail | Responsibility | Pass Criteria | Evidence Pointer |
|---|---|---|---|---|---|---|
| 2.6.1 | Relay offer/answer/ice only to the intended peer | [backend/src/signaling/registerSocketHandlers.ts](backend/src/signaling/registerSocketHandlers.ts), shared signal contract | Route signaling messages by participant identity and validate payload size before forwarding. | @sys-architect, @qa-engineer | Messages reach only the target participant; malformed payloads are rejected. | integration tests; security policy tests |
| 2.6.2 | Orchestrate WebRTC handshake and DataChannel startup | frontend WebRTC connection and dataChannel logic | Establish peer connection, open the DataChannel, and expose send/receive hooks to the room UI. | @fe-expert, @sys-architect | DataChannel reaches OPEN and traffic flows both directions. | frontend integration tests |
| 2.6.3 | Keep chat state volatile | frontend chat state module | Store chat only in memory and clear it on refresh or room end. | @fe-expert | No durable storage or replay behavior exists. | frontend code review; QA checks |

### 6.2 Test Plan

| Test # | Current Test Code | Suite | Purpose | Verification Focus |
|---|---|---|---|---|
| T2.6-01 | P2-CH-001 | frontend/tests/contract.integration.test.mjs; backend/tests/security.policy.test.ts | Verify signaling event names and payload keys match the canonical contract. | Offer/answer/ice contracts stay in sync. |
| T2.6-02 | P2-CH-007 | backend/tests/socket.integration.test.ts; backend/tests/security.policy.test.ts | Verify targeted relay reaches only the intended participant and respects payload guards. | Relay stays targeted and safe. |
| T2.6-03 | P2-CH-002 | frontend/tests/contract.integration.test.mjs | Verify DataChannel reaches open state for a peer pair. | Chat transport opens and transmits. |
| T2.6-04 | P2-CH-006 | frontend/tests/contract.integration.test.mjs | Verify chat UI renders send/receive flow with attribution. | UI shows peer messages correctly. |
| T2.6-05 | P2-CH-003 | frontend/tests/contract.integration.test.mjs; backend/tests/security.policy.test.ts | Verify chat history stays volatile and clears on exit or refresh. | No persistence or replay exists. |
| T2.6-06 | P2-CH-008 | frontend/tests/contract.integration.test.mjs; backend/tests/socket.integration.test.ts | Verify relay and channel-connectivity automation covers regressions. | Connectivity regressions are caught. |

## 7. VP-2.7 ICE Policy, TURN Hygiene, and Release Gate

### 7.1 Implementation Plan

| Subtask | Task | Module / Interface | Detail | Responsibility | Pass Criteria | Evidence Pointer |
|---|---|---|---|---|---|---|
| 2.7.1 | Make ICE servers environment-driven | frontend/backend runtime config and ice policy handling | Allow STUN baseline and TURN fallback to be set through environment variables rather than hardcoded paths. | @sys-architect, @fe-expert | ICE policy changes do not require code edits. | runbook and runtime config validation |
| 2.7.2 | Redact TURN credentials everywhere | backend TURN auth path and logs/telemetry filters | Ensure TURN secrets never appear in logs, telemetry, or diagnostics. | @sys-architect, @qa-engineer | No credential leakage appears anywhere in emitted evidence. | security tests; telemetry audits |
| 2.7.3 | Keep observability aggregate-only | backend telemetry pipeline | Collect room/participant counts and latencies only; block SDP, ICE, chat, password, and token fields. | @sys-architect, @qa-engineer | Telemetry remains free of sensitive payloads. | telemetry audit |
| 2.7.4 | Maintain the cross-device runbook | [docs/test_results/connectivity-validation-runbook.md](docs/test_results/connectivity-validation-runbook.md) | Document same-LAN, cross-LAN, restrictive NAT, and optional desktop-mobile verification. | @qa-engineer, @fe-expert | Runbook is executable and produces evidence artifacts. | runbook artifacts in docs/test_results |
| 2.7.5 | Enforce non-localhost release evidence | release checklist and test_results artifact | Require at least one non-localhost device pair to complete create, join, and chat before Phase 2 closes. | @vapor-pm, @qa-engineer | Non-localhost proof is attached to release notes. | release checklist artifact |

### 7.2 Test Plan

| Test # | Current Test Code | Suite | Purpose | Verification Focus |
|---|---|---|---|---|
| T2.7-01 | P2-ICE-006 | docs/test_results/connectivity-validation-runbook.md | Verify the non-localhost STUN path reaches connected and chat-ready state. | STUN baseline is proven. |
| T2.7-02 | P2-ICE-007 | docs/test_results/connectivity-validation-runbook.md; backend/tests/security.policy.test.ts | Verify TURN fallback works under restrictive NAT. | TURN path is validated and secrets stay redacted. |
| T2.7-03 | P2-ICE-008 | backend/tests/security.policy.test.ts; frontend/tests/contract.integration.test.mjs | Verify telemetry contains state metadata only and excludes sensitive payloads. | Telemetry redaction stays safe. |
| T2.7-04 | P2-ICE-009 | docs/test_results/connectivity-validation-runbook.md | Verify the cross-device runbook covers same-LAN, cross-LAN, restrictive NAT, and optional desktop-mobile. | Manual matrix is executable. |
| T2.7-05 | P2-ICE-010 | docs/test_results/release-gate-checklist.md | Verify release gate requires non-localhost proof. | Phase closure cannot bypass manual evidence. |

## 8. VP-2.X Ops Hygiene

### 8.1 Implementation Plan

| Subtask | Task | Module / Interface | Detail | Responsibility | Pass Criteria | Evidence Pointer |
|---|---|---|---|---|---|---|
| 2.X.1 | Track aggregate room metrics | backend telemetry and admin dashboards | Report room count, participant count, and average lifetime only, with no secret capture. | @sys-architect, @qa-engineer | Dashboards remain aggregate-only and privacy-safe. | admin metrics; telemetry audits |

### 8.2 Test Plan

| Test # | Current Test Code | Suite | Purpose | Verification Focus |
|---|---|---|---|---|
| T2.X-01 | P2-ICE-008 | backend/tests/security.policy.test.ts | Reuse telemetry redaction checks for ops hygiene coverage. | Aggregate-only observability stays safe. |
