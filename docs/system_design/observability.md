# Vapor Observability (Admin Module) (Source of Truth)

Date: 2026-06-29

Part of the Vapor system-design source-of-truth set — navigate via [INDEX.md](./INDEX.md). This file owns the operational observability policy: what aggregate metrics may be collected and the hard boundary against any user/session data. The admin code structure (metrics, routes, auth, analytics, scheduler, reports) is documented in [backend-overview.md](./backend-overview.md) §"Admin subsystem".

## Operational Observability Policy

- Admin observability is required. Aggregate operational metrics (active room count, participant counts, error rates, heap usage, uptime) may be written to a dedicated external observability store. No user-identifiable fields (room IDs, participant IDs, nicknames, reconnect tokens, passwords, SDP/ICE, IP addresses, or any session-scoped data) may be written to this store. The zero-persistence guarantee for user and session data is unchanged.
- **Allowed telemetry:** room count, participant count, average participants per room, average room lifetime, create-room burst counts, temporary block counts, active socket count, uptime, free/used RAM, and coarse service availability.
- **Forbidden in metrics/logs:** plaintext passwords, reconnect tokens, SDP/ICE payloads, chat/file content, raw room transcripts, and any payload-level user data.
- Logs must remain aggregate and operational; do not log secret material or detailed user activity traces.
- Admin surfaces must be explicitly protected (token or basic auth).

## Endpoints

- `GET /health` — always public; returns `{ status: "ok", uptime }`.
- `GET /admin/metrics` — protected by token or basic auth (env-configured); returns RAM-only aggregate metrics. Disabled unless `ADMIN_API_TOKEN` or `ADMIN_BASIC_USER`/`PASS` is set.
