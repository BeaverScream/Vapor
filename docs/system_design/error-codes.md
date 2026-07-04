# Vapor Error Codes (Source of Truth)

Date: 2026-06-29

Part of the Vapor system-design source-of-truth set — navigate via [INDEX.md](./INDEX.md). This file owns the deterministic, closed set of signaling error codes. Codes are defined in `shared/error-codes.ts` and imported by both sides (see [signaling-contract.md](./signaling-contract.md)). User-facing copy mapping lives in `frontend/src/features/room/error-copy.ts` and [frontend-ui-spec.md](./frontend-ui-spec.md) §9.4 — never duplicate copy strings here.

## Deterministic Error Codes

This is a closed set. Do not add a new code without updating `shared/error-codes.ts`, the backend, and `error-copy.ts` together.

| Code | When emitted |
|---|---|
| `ROOM_NOT_FOUND` | Room ID/name doesn't exist or was destroyed; on `resume_session`: malformed payload (missing roomId/token) or valid token whose room has been destroyed |
| `ROOM_FULL` | Room already has the max 5 participants |
| `ROOM_EXPIRED` | Room TTL has passed |
| `INVALID_PASSWORD` | Wrong password, or empty/missing password for a protected room |
| `HOST_RECONNECT_WINDOW_EXPIRED` | Host `resume_session` after the host grace window (`validUntil`) closed while the room still exists |
| `RECONNECT_TOKEN_STALE` | `resume_session` with a token whose hash has no record (or a record for a different room), whose participant is still connected, whose guest grace window expired, or whose participant is no longer in the roster (e.g. kicked during grace) |
| `RATE_LIMITED` | Create/join rate limit, create-burst, or memory-pressure rejection |
| `INVALID_SIGNAL_PAYLOAD` | Malformed SDP/ICE payload, invalid nickname format, nickname already taken by an active participant, or invalid/duplicate room name |
| `NOT_AUTHORIZED` | Non-host attempted a host-only action (e.g. kick) |

## Notes

- Invalid nickname format or nickname already taken by an active participant → `INVALID_SIGNAL_PAYLOAD`.
- Password/auth mismatch UX must present `INVALID_PASSWORD` semantics to the user, normalizing distinct auth-failure causes to reduce information disclosure.

QA acceptance criteria and evidence for lifecycle and signaling behavior live under [docs/test_results/](../test_results/).
