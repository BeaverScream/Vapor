/// <reference types="node" />
import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs, type Dirent } from "node:fs";
import path from "node:path";
import {
  SWEEPER_INTERVAL_HOURS,
  JOIN_RATE_LIMIT_WINDOW_MS,
  JOIN_RATE_LIMIT_MAX,
  CREATE_RATE_LIMIT_WINDOW_MS,
} from "../src/signaling/contracts";

const BACKEND_SRC_ROOT = path.resolve(process.cwd(), "src");
const SIGNALING_CONTRACTS_FILE = path.resolve(process.cwd(), "src/signaling/contracts.ts");
const SOCKET_HANDLERS_FILE = path.resolve(process.cwd(), "src/signaling/registerSocketHandlers.ts");
const RATE_LIMITING_FILE = path.resolve(process.cwd(), "src/signaling/handlers/rateLimiting.ts");
const SHARED_EVENTS_FILE = path.resolve(process.cwd(), "../shared/events.ts");
const SHARED_PAYLOADS_FILE = path.resolve(process.cwd(), "../shared/payloads.ts");
const SHARED_REASONS_FILE = path.resolve(process.cwd(), "../shared/reasons.ts");
const METRICS_REGISTRY_FILE = path.resolve(process.cwd(), "src/admin/metricsRegistry.ts");
const ADMIN_ROUTER_FILE = path.resolve(process.cwd(), "src/admin/createAdminRouter.ts");
const STATE_FILE = path.resolve(process.cwd(), "src/signaling/state.ts");
const SHARED_POLICY_FILE = path.resolve(process.cwd(), "../shared/policy.ts");
const FRONTEND_STATE_UTILS_FILE = path.resolve(process.cwd(), "../frontend/src/features/room/state-utils.ts");
const FRONTEND_ROOM_SOCKET_CLIENT_FILE = path.resolve(process.cwd(), "../frontend/src/features/room/room-socket-client.ts");
const FRONTEND_USE_SOCKET_CONNECTION_FILE = path.resolve(process.cwd(), "../frontend/src/features/room/hooks/useSocketConnection.ts");
const FRONTEND_USE_VAPOR_ROOM_FILE = path.resolve(process.cwd(), "../frontend/src/features/room/useVaporRoom.ts");
const FRONTEND_TYPES_FILE = path.resolve(process.cwd(), "../frontend/src/features/room/types.ts");

const FORBIDDEN_SECRET_PATTERNS: RegExp[] = [
  /console\.(log|info|debug|warn|error)\([^\n]*password/i,
  /console\.(log|info|debug|warn|error)\([^\n]*reconnecttoken/i,
  /console\.(log|info|debug|warn|error)\([^\n]*\bsdp\b/i,
  /console\.(log|info|debug|warn|error)\([^\n]*\bice\b/i,
  /console\.(log|info|debug|warn|error)\([^\n]*candidate/i
];

const FORBIDDEN_PERSISTENCE_PATTERNS: RegExp[] = [
  /from\s+"node:fs"/,
  /from\s+"fs"/,
  /writeFile\(/,
  /appendFile\(/,
  /createWriteStream\(/,
  /better-sqlite3/,
  /mongoose/,
  /typeorm/,
  /prisma/
];

function expectContains(content: string, snippet: string, label: string): void {
  assert.equal(content.includes(snippet), true, `Missing ${label}: ${snippet}`);
}

function expectNotContains(content: string, snippet: string, label: string): void {
  assert.equal(content.includes(snippet), false, `Unexpected ${label}: ${snippet}`);
}

async function collectTypeScriptFiles(dirPath: string): Promise<string[]> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry: Dirent) => {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        return collectTypeScriptFiles(fullPath);
      }

      if (entry.isFile() && fullPath.endsWith(".ts")) {
        return [fullPath];
      }

      return [];
    })
  );

  return files.flat();
}

test("T1.ZP-01: backend source contains no obvious secret-logging statements", async () => {
  const files = await collectTypeScriptFiles(BACKEND_SRC_ROOT);
  assert.ok(files.length > 0, "Expected backend TypeScript source files");

  for (const filePath of files) {
    const content = await fs.readFile(filePath, "utf8");

    for (const pattern of FORBIDDEN_SECRET_PATTERNS) {
      assert.equal(
        pattern.test(content),
        false,
        `Forbidden secret logging pattern matched in ${filePath}: ${pattern}`
      );
    }
  }
});

// ---- Zero-Persistence ----
test("T0.ZP-01: backend source avoids persistence APIs/libraries in Phase 0 runtime paths", async () => {
  const files = await collectTypeScriptFiles(BACKEND_SRC_ROOT);

  for (const filePath of files) {
    if (!filePath.includes(`${path.sep}signaling${path.sep}`) && !filePath.endsWith(`${path.sep}server.ts`)) {
      continue;
    }

    const content = await fs.readFile(filePath, "utf8");

    for (const pattern of FORBIDDEN_PERSISTENCE_PATTERNS) {
      assert.equal(
        pattern.test(content),
        false,
        `Forbidden persistence pattern matched in ${filePath}: ${pattern}`
      );
    }
  }
});

// ---- Contract + Auth ----
test("T1.1-01: backend signaling event contract names are canonical", async () => {
  const contracts = await fs.readFile(SIGNALING_CONTRACTS_FILE, "utf8");
  const sharedEvents = await fs.readFile(SHARED_EVENTS_FILE, "utf8");
  const sharedPayloads = await fs.readFile(SHARED_PAYLOADS_FILE, "utf8");

  // contracts.ts must delegate to shared constants (not hardcode wire strings)
  expectContains(contracts, "CLIENT_EVENT_NAMES.CREATE_ROOM", "create_room sourced from shared");
  expectContains(contracts, "CLIENT_EVENT_NAMES.JOIN_ROOM", "join_room sourced from shared");
  expectContains(contracts, "CLIENT_EVENT_NAMES.LEAVE_ROOM", "leave_room sourced from shared");
  expectContains(contracts, "CLIENT_EVENT_NAMES.SIGNAL_OFFER", "signal_offer sourced from shared");
  expectContains(contracts, "CLIENT_EVENT_NAMES.SIGNAL_ANSWER", "signal_answer sourced from shared");
  expectContains(contracts, "CLIENT_EVENT_NAMES.SIGNAL_ICE", "signal_ice sourced from shared");
  expectContains(contracts, "SERVER_EVENT_NAMES.ROOM_CREATED", "room_created sourced from shared");
  expectContains(contracts, "SERVER_EVENT_NAMES.ROOM_JOINED", "room_joined sourced from shared");
  expectContains(contracts, "SERVER_EVENT_NAMES.PEER_JOINED", "peer_joined sourced from shared");
  expectContains(contracts, "SERVER_EVENT_NAMES.PEER_LEFT", "peer_left sourced from shared");
  expectContains(contracts, "SERVER_EVENT_NAMES.SIGNAL_OFFER", "signal_offer relay sourced from shared");
  expectContains(contracts, "SERVER_EVENT_NAMES.SIGNAL_ANSWER", "signal_answer relay sourced from shared");
  expectContains(contracts, "SERVER_EVENT_NAMES.SIGNAL_ICE", "signal_ice relay sourced from shared");
  expectContains(contracts, "SERVER_EVENT_NAMES.ROOM_DESTROYED", "room_destroyed sourced from shared");
  expectContains(contracts, "SERVER_EVENT_NAMES.ERROR", "error sourced from shared");

  // shared/events.ts must contain the authoritative wire-format literals
  expectContains(sharedEvents, 'CREATE_ROOM: "create_room"', "shared create_room literal");
  expectContains(sharedEvents, 'JOIN_ROOM: "join_room"', "shared join_room literal");
  expectContains(sharedEvents, 'LEAVE_ROOM: "leave_room"', "shared leave_room literal");
  expectContains(sharedEvents, 'SIGNAL_OFFER: "signal_offer"', "shared signal_offer literal");
  expectContains(sharedEvents, 'SIGNAL_ANSWER: "signal_answer"', "shared signal_answer literal");
  expectContains(sharedEvents, 'SIGNAL_ICE: "signal_ice"', "shared signal_ice literal");
  expectContains(sharedEvents, 'ROOM_CREATED: "room_created"', "shared room_created literal");
  expectContains(sharedEvents, 'PEER_JOINED: "peer_joined"', "shared peer_joined literal");
  expectContains(sharedEvents, 'PEER_LEFT: "peer_left"', "shared peer_left literal");
  expectContains(sharedEvents, 'ROOM_DESTROYED: "room_destroyed"', "shared room_destroyed literal");
  expectContains(sharedEvents, 'ERROR: "error"', "shared error literal");
  expectContains(sharedPayloads, "export type RoomCreatedPayload = {", "shared room_created payload contract");
  expectContains(sharedPayloads, "export type RoomJoinedPayload = {", "shared room_joined payload contract");
  expectContains(sharedPayloads, "export type SignalOfferPayload = {", "shared signal_offer payload contract");
  expectContains(sharedPayloads, "export type SignalAnswerPayload = {", "shared signal_answer payload contract");
  expectContains(sharedPayloads, "export type SignalIcePayload = {", "shared signal_ice payload contract");
  expectContains(sharedPayloads, "hostId: string", "shared explicit hostId contract field");
});

test("T2.1-01: socket errors are emitted through the shared deterministic envelope helper", async () => {
  const contracts = await fs.readFile(SIGNALING_CONTRACTS_FILE, "utf8");
  const handlers = await fs.readFile(SOCKET_HANDLERS_FILE, "utf8");
  const sharedPayloads = await fs.readFile(SHARED_PAYLOADS_FILE, "utf8");

  expectContains(sharedPayloads, "export const SIGNALING_ERROR_MESSAGES", "shared deterministic error message map");
  expectContains(sharedPayloads, "export function createSocketErrorPayload", "shared socket error payload helper");
  expectContains(contracts, "makeSocketErrorPayload", "backend contract helper for shared error envelope");
  expectContains(handlers, "emitSocketError(socket, signaling.ERROR_CODES", "handler-level deterministic envelope usage");
  expectContains(handlers, "emitInvalidSignalPayload(socket)", "signal payload validation failure envelope usage");
});

test("T1.1-02: backend does not expose legacy destroy reason alias", async () => {
  const sharedReasons = await fs.readFile(SHARED_REASONS_FILE, "utf8");

  expectContains(sharedReasons, '"host_left"', "canonical host_left reason");
  expectContains(sharedReasons, '"host_grace_expired"', "canonical host_grace_expired reason");
  expectContains(sharedReasons, '"room_ttl_expired"', "canonical room_ttl_expired reason");
  expectContains(sharedReasons, '"solo_timeout_expired"', "canonical solo_timeout_expired reason");
  expectNotContains(sharedReasons, '"host_disconnected"', "legacy host_disconnected reason");
});

test("T1.4-01: create/join/update enforce trim + INVALID_PASSWORD semantics", async () => {
  const handlers = await fs.readFile(SOCKET_HANDLERS_FILE, "utf8");

  expectContains(handlers, "ERROR_CODES.invalidPassword", "contract-based invalid password error code usage");
  expectContains(handlers, "emitInvalidPassword(socket)", "deterministic invalid password emission path");
  expectContains(handlers, ".trim()", "trim-based password validation");
  expectContains(handlers, "CLIENT_EVENTS.createRoom", "create_room handler");
  expectContains(handlers, "CLIENT_EVENTS.joinRoom", "join_room handler");
  expectContains(handlers, "CLIENT_EVENTS.roomPasswordUpdate", "room_password_update handler via contract constant");
});

// ---- Lifecycle ----
test("T1.6-01: lifecycle uses grace + precedence primitives", async () => {
  const handlers = await fs.readFile(SOCKET_HANDLERS_FILE, "utf8");

  expectContains(handlers, "SERVER_EVENTS.hostReconnectGrace", "host grace notification event via contract constant");
  expectContains(handlers, "HOST_DISCONNECT_GRACE_MS", "host grace timer constant usage");
  expectContains(handlers, "GUEST_DISCONNECT_GRACE_MS", "guest grace timer constant usage");
  expectContains(handlers, "ROOM_MAX_DURATION_MS", "room ttl constant usage");
  expectContains(handlers, "IDLE_ROOM_TIMEOUT_MS", "solo timeout constant usage");
});

// ---- Rate Limiting ----
// SPEC-INVALID: Spec section 2 replaced the per-room cooldown constants
// (JOIN_INVALID_ATTEMPT_COOLDOWN_MS, JOIN_INVALID_ATTEMPT_NO_COOLDOWN_MAX,
// JOIN_INVALID_ATTEMPT_COOLDOWN_MAX) with a simple window-based approach
// (JOIN_RATE_LIMIT_WINDOW_MS / JOIN_RATE_LIMIT_MAX). The constant names this test
// checks are no longer part of the spec contract.
/* test("T2.4-01: contracts define RATE_LIMITED error code and join-attempt policy constants", async () => {
  const contracts = await fs.readFile(SIGNALING_CONTRACTS_FILE, "utf8");

  expectContains(contracts, "RATE_LIMITED", "RATE_LIMITED error code");
  expectContains(contracts, "JOIN_INVALID_ATTEMPT_COOLDOWN_MS", "join-attempt cooldown duration constant");
  expectContains(contracts, "JOIN_INVALID_ATTEMPT_NO_COOLDOWN_MAX", "join-attempt no-cooldown attempt ceiling");
  expectContains(contracts, "JOIN_INVALID_ATTEMPT_COOLDOWN_MAX", "join-attempt cooldown attempt ceiling");
}); */

// SPEC-INVALID: The fields this test checks (joinAttemptByRoomSubject, invalidCount,
// strictLocked, cooldownUntil) are implementation details of the old per-room wrong-password
// cooldown scheme. The updated spec (section 2) defines a window-based rate limit and does not
// specify these internal tracking structures.
/* test("T2.4-02: handlers include join-attempt tracking structure and RATE_LIMITED enforcement", async () => {
  const handlers = await fs.readFile(SOCKET_HANDLERS_FILE, "utf8");

  expectContains(handlers, "ERROR_CODES.rateLimited", "contract-based RATE_LIMITED error code usage");
  expectContains(handlers, "emitRateLimited(socket)", "RATE_LIMITED enforcement present in join path");
  expectContains(handlers, "joinAttemptByRoomSubject", "per-room/subject attempt tracking key");
  expectContains(handlers, "invalidCount", "invalid-attempt counter field");
  expectContains(handlers, "strictLocked", "strict-lockout flag field");
  expectContains(handlers, "cooldownUntil", "cooldown-deadline field");
}); */

// ---- T3.3 Ops, Abuse Controls ----
test("T3.3-01 (P3-AB-001): temporary blocklist behavior stays RAM-only", async () => {
  const rateLimiting = await fs.readFile(RATE_LIMITING_FILE, "utf8");

  // Blocklist and companion create-attempt tracking are both local Maps — no external store
  expectContains(
    rateLimiting,
    "temporaryBlocklistByIp: new Map()",
    "blocklist declared as in-memory Map inside context factory"
  );
  expectContains(
    rateLimiting,
    "createAttemptsByIp: new Map()",
    "create-attempt counter declared as in-memory Map inside context factory"
  );

  // Block expiry is a numeric TTL computed from CREATE_ROOM_BLOCK_DURATION_MS — time-bounded, not permanent
  expectContains(
    rateLimiting,
    "ctx.temporaryBlocklistByIp.set(ip, nowTs + CREATE_ROOM_BLOCK_DURATION_MS)",
    "block entry stores a computed expiry timestamp, not a permanent flag"
  );

  // Sweeper prunes expired blocklist entries so no durable state accumulates
  expectContains(
    rateLimiting,
    "ctx.temporaryBlocklistByIp.delete(ip)",
    "sweeper prunes expired blocklist entries"
  );

  // Sweeper also prunes expired create-attempt windows
  expectContains(
    rateLimiting,
    "ctx.createAttemptsByIp.delete(ip)",
    "sweeper prunes expired create-attempt windows"
  );

  // Neither state structure is exported directly — accessed only via context object
  expectNotContains(rateLimiting, "export temporaryBlocklistByIp", "blocklist must not be exported");
  expectNotContains(rateLimiting, "export createAttemptsByIp", "create-attempt state must not be exported");

  // No persistence APIs in the rate limiting module
  for (const pattern of FORBIDDEN_PERSISTENCE_PATTERNS) {
    assert.equal(
      pattern.test(rateLimiting),
      false,
      `Persistence pattern must not appear in rate limiting module: ${pattern}`
    );
  }
});

test("T3.3-05 (P3-AB-005): per-IP abuse counters persist within their RAM window and are not cleared by room destruction", async () => {
  const handlers = await fs.readFile(SOCKET_HANDLERS_FILE, "utf8");
  const rateLimiting = await fs.readFile(RATE_LIMITING_FILE, "utf8");

  // ipAbuseByIp must be a local in-memory Map — not exported, not persisted
  expectContains(
    rateLimiting,
    "ipAbuseByIp: new Map()",
    "per-IP abuse counter declared as in-memory Map inside context factory"
  );
  expectNotContains(rateLimiting, "export ipAbuseByIp", "per-IP abuse Map must not be exported");

  // Window-expiry pruning must exist in the sweeper — ipAbuseByIp.delete must be keyed on window age
  expectContains(
    rateLimiting,
    "ctx.ipAbuseByIp.delete(ip)",
    "sweeper prunes expired per-IP abuse records"
  );
  expectContains(
    rateLimiting,
    "signaling.JOIN_RATE_LIMIT_WINDOW_MS",
    "per-IP window constant sourced from shared spec constant"
  );

  // destroyRoom must NOT touch ipAbuseByIp — counters must survive room teardown
  const destroyRoomMatch = handlers.match(/const destroyRoom\s*=[\s\S]*?^  \};/m);
  assert.ok(destroyRoomMatch, "destroyRoom function must be present in handlers");
  const destroyRoomBody = destroyRoomMatch[0];
  assert.equal(
    destroyRoomBody.includes("ipAbuseByIp"),
    false,
    "destroyRoom must not reference ipAbuseByIp — per-IP counters must be room-agnostic"
  );

  // Both create and join paths contribute to the same per-IP record, not per-room
  // checkAndRecordCreateAttempt and checkAndRecordJoinIp both access ctx.ipAbuseByIp via ip parameter
  expectContains(rateLimiting, "export function checkAndRecordCreateAttempt", "create path function exported from rate limiting module");
  expectContains(rateLimiting, "export function checkAndRecordJoinIp", "join path function exported from rate limiting module");
  expectContains(rateLimiting, "ctx.ipAbuseByIp.get(ip)", "per-IP lookup keyed by ip, not roomId");
  expectContains(rateLimiting, "ctx.ipAbuseByIp.set(ip,", "per-IP write keyed by ip, not roomId");

  // No persistence APIs in the rate limiting module
  for (const pattern of FORBIDDEN_PERSISTENCE_PATTERNS) {
    assert.equal(
      pattern.test(rateLimiting),
      false,
      `Persistence pattern must not appear in rate limiting module: ${pattern}`
    );
  }
});

test("T3.3-02 (P3-AB-002): aggregate telemetry snapshot excludes passwords, tokens, SDP, ICE, and chat payloads", async () => {
  const metricsContent = await fs.readFile(METRICS_REGISTRY_FILE, "utf8");
  const adminRouterContent = await fs.readFile(ADMIN_ROUTER_FILE, "utf8");

  // Snapshot fields must never carry sensitive payload data
  const SENSITIVE_PATTERNS: Array<[RegExp, string]> = [
    [/\bpassword\b/i,     "password field"],
    [/reconnectToken/i,   "reconnectToken field"],
    [/\bsdp\b/i,          "SDP payload field"],
    [/\biceCandidate\b/i, "ICE candidate field"],
    [/\bchat\b/i,         "chat payload field"],
    [/\bmessage\b/i,      "message content field"],
  ];

  for (const [pattern, label] of SENSITIVE_PATTERNS) {
    assert.equal(
      pattern.test(metricsContent),
      false,
      `metricsRegistry.ts must not reference ${label}: ${pattern}`
    );
    assert.equal(
      pattern.test(adminRouterContent),
      false,
      `createAdminRouter.ts must not reference ${label}: ${pattern}`
    );
  }

  // Snapshot exposes only operational aggregate counts, durations, and RAM metrics
  expectContains(metricsContent, "totalConnections:", "snapshot exposes total connection count aggregate");
  expectContains(metricsContent, "totalJoins:", "snapshot exposes total room join count aggregate");
  expectContains(metricsContent, "totalDestroyed:", "snapshot exposes rooms destroyed aggregate");
  expectContains(metricsContent, "rssBytes:", "snapshot exposes RAM rss bytes metric");
  expectContains(metricsContent, "heapUsedBytes:", "snapshot exposes heap used bytes metric");
  expectContains(metricsContent, "averageParticipantsPerRoom", "snapshot exposes average participants per room aggregate");
  expectContains(metricsContent, "averageLifetimeMs", "snapshot exposes average room lifetime aggregate");

  // Internal tracking structures use plain identifiers and numeric counts — not payload objects
  expectContains(metricsContent, "new Map<string, number>", "room tracking stores numeric participant counts, not payload objects");
  expectContains(metricsContent, "new Set<string>", "socket tracking stores plain string identifiers, not payload objects");

  // Admin metrics endpoint delegates entirely to the snapshot — no extra fields injected
  expectContains(adminRouterContent, "getSnapshot()", "admin /metrics endpoint serves the registry snapshot output only");
});

// ---- VP-11.2 Spec Constant Alignment ----

test("T11.2-01: shared constants have exactly the spec-mandated values", () => {
  assert.equal(SWEEPER_INTERVAL_HOURS, 5, "SWEEPER_INTERVAL_HOURS must equal 5 per core-architecture.md §2");
  assert.equal(JOIN_RATE_LIMIT_WINDOW_MS, 60_000, "JOIN_RATE_LIMIT_WINDOW_MS must equal 60000 ms per spec §2");
  assert.equal(JOIN_RATE_LIMIT_MAX, 30, "JOIN_RATE_LIMIT_MAX must equal 30 per spec §2");
  assert.equal(CREATE_RATE_LIMIT_WINDOW_MS, 60_000, "CREATE_RATE_LIMIT_WINDOW_MS must equal 60000 ms per spec §2");
  // T11.2-04: derived sweep interval must equal 18000000 ms (5 hours)
  assert.equal(SWEEPER_INTERVAL_HOURS * 60 * 60 * 1000, 18_000_000, "Derived sweep interval must equal 18000000 ms");
});

test("T11.2-02: replaced local constants fully removed from rateLimiting.ts", async () => {
  const rateLimiting = await fs.readFile(RATE_LIMITING_FILE, "utf8");

  expectNotContains(rateLimiting, "IP_ABUSE_WINDOW_MS", "old IP_ABUSE_WINDOW_MS constant must not remain");
  expectNotContains(rateLimiting, "IP_JOIN_THRESHOLD", "old IP_JOIN_THRESHOLD constant must not remain");
  expectNotContains(rateLimiting, "IP_CREATE_THRESHOLD", "old IP_CREATE_THRESHOLD constant must not remain");
  expectNotContains(rateLimiting, "CREATE_ATTEMPT_WINDOW_MS", "old CREATE_ATTEMPT_WINDOW_MS constant must not remain");

  // Replacement constants sourced from shared via contracts
  expectContains(rateLimiting, "signaling.JOIN_RATE_LIMIT_WINDOW_MS", "join window sources from shared constant");
  expectContains(rateLimiting, "signaling.CREATE_RATE_LIMIT_WINDOW_MS", "create window sources from shared constant");
  expectContains(rateLimiting, "signaling.JOIN_RATE_LIMIT_MAX", "join threshold sources from shared constant");
});

// ---- VP-11.5 Nickname-Update Feature Removal ----

test("T11.5-01: all nickname-update symbols exhaustively removed from backend, shared, and frontend source", async () => {
  const sharedEvents = await fs.readFile(SHARED_EVENTS_FILE, "utf8");
  const sharedPayloads = await fs.readFile(SHARED_PAYLOADS_FILE, "utf8");
  const sharedPolicy = await fs.readFile(SHARED_POLICY_FILE, "utf8");
  const contracts = await fs.readFile(SIGNALING_CONTRACTS_FILE, "utf8");
  const handlers = await fs.readFile(SOCKET_HANDLERS_FILE, "utf8");
  const stateFile = await fs.readFile(STATE_FILE, "utf8");
  const frontendStateUtils = await fs.readFile(FRONTEND_STATE_UTILS_FILE, "utf8");
  const frontendSocketClient = await fs.readFile(FRONTEND_ROOM_SOCKET_CLIENT_FILE, "utf8");
  const frontendUseSocketConnection = await fs.readFile(FRONTEND_USE_SOCKET_CONNECTION_FILE, "utf8");
  const frontendUseVaporRoom = await fs.readFile(FRONTEND_USE_VAPOR_ROOM_FILE, "utf8");
  const frontendTypes = await fs.readFile(FRONTEND_TYPES_FILE, "utf8");

  // Wire-format event strings removed from shared/events.ts
  expectNotContains(sharedEvents, '"nickname_update"', "nickname_update wire event must be removed from shared/events.ts");
  expectNotContains(sharedEvents, '"nickname_updated"', "nickname_updated wire event must be removed from shared/events.ts");
  expectNotContains(sharedEvents, "NICKNAME_UPDATE", "NICKNAME_UPDATE symbol must not remain in shared/events.ts");
  expectNotContains(sharedEvents, "NICKNAME_UPDATED", "NICKNAME_UPDATED symbol must not remain in shared/events.ts");

  // Payload types removed from shared/payloads.ts
  expectNotContains(sharedPayloads, "NicknameUpdatePayload", "NicknameUpdatePayload must be removed from shared/payloads.ts");
  expectNotContains(sharedPayloads, "NicknameUpdatedPayload", "NicknameUpdatedPayload must be removed from shared/payloads.ts");

  // Policy constant removed from shared/policy.ts
  expectNotContains(sharedPolicy, "NICKNAME_CHANGE_COOLDOWN_MS", "NICKNAME_CHANGE_COOLDOWN_MS must be removed from shared/policy.ts");

  // All nickname-update references removed from contracts.ts
  expectNotContains(contracts, "nicknameUpdate", "nicknameUpdate must not remain in contracts.ts");
  expectNotContains(contracts, "nicknameUpdated", "nicknameUpdated must not remain in contracts.ts");
  expectNotContains(contracts, "NICKNAME_CHANGE_COOLDOWN_MS", "NICKNAME_CHANGE_COOLDOWN_MS must not remain in contracts.ts");

  // Handler and state field removed from registerSocketHandlers.ts
  expectNotContains(handlers, "nickname_update", "nickname_update handler must be removed from registerSocketHandlers.ts");
  expectNotContains(handlers, "nicknameUpdatedAt", "nicknameUpdatedAt assignment must be removed from registerSocketHandlers.ts");

  // State field removed from state.ts
  expectNotContains(stateFile, "nicknameUpdatedAt", "nicknameUpdatedAt field must be removed from state.ts");

  // Frontend: withNicknameUpdated removed from state-utils.ts
  expectNotContains(frontendStateUtils, "withNicknameUpdated", "withNicknameUpdated must be removed from state-utils.ts");
  expectNotContains(frontendStateUtils, "nicknameUpdatedAt", "nicknameUpdatedAt must not appear in state-utils.ts");

  // Frontend: onNicknameUpdated / offNicknameUpdated removed from room-socket-client.ts
  expectNotContains(frontendSocketClient, "onNicknameUpdated", "onNicknameUpdated must be removed from room-socket-client.ts");
  expectNotContains(frontendSocketClient, "offNicknameUpdated", "offNicknameUpdated must be removed from room-socket-client.ts");

  // Frontend: onNicknameUpdated removed from useSocketConnection.ts
  expectNotContains(frontendUseSocketConnection, "onNicknameUpdated", "onNicknameUpdated must be removed from useSocketConnection.ts");

  // Frontend: onNicknameUpdated removed from useVaporRoom.ts
  expectNotContains(frontendUseVaporRoom, "onNicknameUpdated", "onNicknameUpdated must be removed from useVaporRoom.ts");
  expectNotContains(frontendUseVaporRoom, "withNicknameUpdated", "withNicknameUpdated must be removed from useVaporRoom.ts");

  // Frontend: nickname-update symbols removed from types.ts
  expectNotContains(frontendTypes, "onNicknameUpdated", "onNicknameUpdated must be removed from types.ts");
  expectNotContains(frontendTypes, "offNicknameUpdated", "offNicknameUpdated must be removed from types.ts");
  expectNotContains(frontendTypes, "NicknameUpdatedPayload", "NicknameUpdatedPayload must be removed from types.ts");
});

// ---- VP-11.8 Raise IP Create Rate Limit Threshold ----

/* SPEC-INVALID (CR11-18): CREATE_RATE_LIMIT_MAX removed — the IP ceiling (30) was unreachable
   because the burst gate (CREATE_ROOM_BURST_THRESHOLD=5) always fires first. The effective
   per-IP create ceiling is the burst limit; T3.3-03 covers the burst block end-to-end.
test("T11.8-01: CREATE_RATE_LIMIT_MAX constant equals 30", () => { ... });
test("T11.8-02: IP create block triggers at 31st attempt, not 11th", () => { ... });
*/
