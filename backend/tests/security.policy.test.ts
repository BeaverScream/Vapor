/// <reference types="node" />
import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs, type Dirent } from "node:fs";
import path from "node:path";

const BACKEND_SRC_ROOT = path.resolve(process.cwd(), "src");
const SIGNALING_CONTRACTS_FILE = path.resolve(process.cwd(), "src/signaling/contracts.ts");
const SOCKET_HANDLERS_FILE = path.resolve(process.cwd(), "src/signaling/registerSocketHandlers.ts");
const SHARED_EVENTS_FILE = path.resolve(process.cwd(), "../shared/events.ts");
const SHARED_PAYLOADS_FILE = path.resolve(process.cwd(), "../shared/payloads.ts");
const SHARED_REASONS_FILE = path.resolve(process.cwd(), "../shared/reasons.ts");
const METRICS_REGISTRY_FILE = path.resolve(process.cwd(), "src/admin/metricsRegistry.ts");
const ADMIN_ROUTER_FILE = path.resolve(process.cwd(), "src/admin/createAdminRouter.ts");

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
  expectContains(handlers, "SOLO_HOST_ROOM_TIMEOUT_MS", "solo timeout constant usage");
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
  const handlers = await fs.readFile(SOCKET_HANDLERS_FILE, "utf8");

  // Blocklist and companion create-attempt tracking are both local Maps — no external store
  expectContains(
    handlers,
    "const temporaryBlocklistBySubject = new Map",
    "blocklist declared as local in-memory Map"
  );
  expectContains(
    handlers,
    "const createAttemptsBySubject = new Map",
    "create-attempt counter declared as local in-memory Map"
  );

  // Block expiry is a numeric TTL computed from CREATE_ROOM_BLOCK_DURATION_MS — time-bounded, not permanent
  expectContains(
    handlers,
    "temporaryBlocklistBySubject.set(subject, createdAt + CREATE_ROOM_BLOCK_DURATION_MS)",
    "block entry stores a computed expiry timestamp, not a permanent flag"
  );

  // Sweeper prunes expired blocklist entries so no durable state accumulates
  expectContains(
    handlers,
    "temporaryBlocklistBySubject.delete(subject)",
    "sweeper prunes expired blocklist entries"
  );

  // Sweeper also prunes expired create-attempt windows
  expectContains(
    handlers,
    "createAttemptsBySubject.delete(subject)",
    "sweeper prunes expired create-attempt windows"
  );

  // Neither state structure is exported — stays function-scoped inside registerSocketHandlers
  expectNotContains(handlers, "export temporaryBlocklistBySubject", "blocklist must not be exported");
  expectNotContains(handlers, "export createAttemptsBySubject", "create-attempt state must not be exported");

  // No persistence APIs in the handler file (belt-and-suspenders check scoped to this file)
  for (const pattern of FORBIDDEN_PERSISTENCE_PATTERNS) {
    assert.equal(
      pattern.test(handlers),
      false,
      `Persistence pattern must not appear in socket handlers: ${pattern}`
    );
  }
});

test("T3.3-05 (P3-AB-005): per-IP abuse counters persist within their RAM window and are not cleared by room destruction", async () => {
  const handlers = await fs.readFile(SOCKET_HANDLERS_FILE, "utf8");

  // ipAbuseByIp must be a local in-memory Map — not exported, not persisted
  expectContains(
    handlers,
    "const ipAbuseByIp = new Map",
    "per-IP abuse counter declared as local in-memory Map"
  );
  expectNotContains(handlers, "export ipAbuseByIp", "per-IP abuse Map must not be exported");

  // Window-expiry pruning must exist in the sweeper — ipAbuseByIp.delete must be keyed on window age
  expectContains(
    handlers,
    "ipAbuseByIp.delete(ip)",
    "sweeper prunes expired per-IP abuse records"
  );
  expectContains(
    handlers,
    "IP_ABUSE_WINDOW_MS",
    "per-IP window constant referenced for expiry check"
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
  expectContains(handlers, "ipAbuseByIp.get(createIp)", "create path reads per-IP record");
  expectContains(handlers, "ipAbuseByIp.get(joinIp)", "join path reads per-IP record");
  expectContains(handlers, "ipAbuseByIp.set(createIp", "create path writes per-IP record");
  expectContains(handlers, "ipAbuseByIp.set(joinIp", "join path writes per-IP record");

  // No persistence APIs in the handler file (belt-and-suspenders check scoped to this file)
  for (const pattern of FORBIDDEN_PERSISTENCE_PATTERNS) {
    assert.equal(
      pattern.test(handlers),
      false,
      `Persistence pattern must not appear in socket handlers: ${pattern}`
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
