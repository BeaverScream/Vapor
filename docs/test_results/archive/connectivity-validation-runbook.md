# Connectivity Validation Runbook

Date: 2026-03-19

## Purpose

This runbook defines the repeatable manual validation matrix for non-localhost connectivity scenarios.

## Preconditions

- Backend signaling service is running and reachable over LAN/WAN.
- Frontend app is reachable from each test device.
- Environment variables for ICE policy are set as needed.
- No SDP/ICE/chat payload logging is enabled.

## Runtime Configuration Snapshot

Record values used in this run:

- VITE_SIGNALING_URL:
- VITE_STUN_URLS:
- VITE_TURN_URLS:
- VITE_TURN_USERNAME: set or unset
- VITE_TURN_CREDENTIAL: set or unset

## Validation Matrix

| Scenario | Network Profile | ICE Expectation | Devices | Result | Notes |
|---|---|---|---|---|---|
| Same-LAN desktop pair | Two clients on same LAN | STUN direct preferred | Desktop A + Desktop B | Pending | |
| Cross-LAN desktop pair | Different public networks | STUN or TURN fallback | Desktop A + Desktop B | Pending | |
| Restrictive NAT path | Symmetric/restricted NAT path | TURN fallback required | Desktop A + Desktop B | Pending | |
| Desktop-mobile pair (if available) | Cross-device and optional cross-network | STUN or TURN fallback | Desktop + Mobile | Pending | Optional when device is available |

## Procedure

1. Start backend and frontend with the configuration snapshot above.
2. On device A, create a room with a password.
3. On device B, join room with exact room ID and password.
4. Confirm room status transitions to connected on both devices.
5. Confirm chat send/receive is bidirectional over DataChannel.
6. Force brief network interruption on one side and verify reconnect behavior.
7. Verify no secret payload values appear in console output.

## Evidence to Attach

- Timestamped screenshots for create, join, connected state, and bidirectional chat.
- Notes on which scenario passed/failed and why.
- Any failures with deterministic reproduction steps.

## Completion Criteria

- At least one non-localhost scenario must pass create, join, and bidirectional chat.
- Restrictive NAT scenario must pass with TURN when configured.
- No sensitive payload leakage observed in logs or telemetry.
