# Vapor Error Codes (Source of Truth)

Date: 2026-06-29  
Owner: @sys-architect  
Status: Active

Part of the Vapor system-design source-of-truth set — navigate via [INDEX.md](./INDEX.md). This file owns the deterministic, closed set of signaling error codes. Codes are defined in `shared/error-codes.ts` and imported by both sides (see [signaling-contract.md](./signaling-contract.md)). User-facing copy mapping lives in `frontend/src/features/room/error-copy.ts` and [frontend-ui-spec.md](./frontend-ui-spec.md) §9.4 — never duplicate copy strings here.

## Deterministic Error Codes

This is a closed set. Do not add a new code without updating `shared/error-codes.ts`, the backend, and `error-copy.ts` together.

| Code | When emitted |
|---|---|
| `ROOM_NOT_FOUND` | Room ID/name doesn't exist, was destroyed, or has `liveCount === 0` |
| `ROOM_FULL` | Room already has the max 5 participants |
| `ROOM_EXPIRED` | Room TTL has passed |
| `INVALID_PASSWORD` | Wrong password, or empty/missing password for a protected room |
| `HOST_RECONNECT_WINDOW_EXPIRED` | Resume attempted after the host grace window closed |
| `RECONNECT_TOKEN_STALE` | Token hash doesn't match the stored record (e.g. guest grace expired) |
| `RATE_LIMITED` | Create/join rate limit, create-burst, or memory-pressure rejection |
| `INVALID_SIGNAL_PAYLOAD` | Malformed SDP/ICE payload, invalid nickname format, nickname already taken by an active participant, or invalid/duplicate room name |
| `NOT_AUTHORIZED` | Non-host attempted a host-only action (e.g. kick) |

## Notes

- Invalid nickname format or nickname already taken by an active participant → `INVALID_SIGNAL_PAYLOAD`.
- Password/auth mismatch UX must present `INVALID_PASSWORD` semantics to the user, normalizing distinct auth-failure causes to reduce information disclosure.

QA acceptance criteria and evidence for lifecycle and signaling behavior live under [docs/test_results/](../test_results/).
