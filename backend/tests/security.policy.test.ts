/// <reference types="node" />
import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs, type Dirent } from "node:fs";
import path from "node:path";

const BACKEND_SRC_ROOT = path.resolve(process.cwd(), "src");
const SIGNALING_CONTRACTS_FILE = path.resolve(process.cwd(), "src/signaling/contracts.ts");
const SOCKET_HANDLERS_FILE = path.resolve(process.cwd(), "src/signaling/registerSocketHandlers.ts");
const SHARED_EVENTS_FILE = path.resolve(process.cwd(), "../shared/events.ts");
const SHARED_REASONS_FILE = path.resolve(process.cwd(), "../shared/reasons.ts");

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

test("P1-ZP-012: backend source contains no obvious secret-logging statements", async () => {
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
test("P0-RS-004: backend source avoids persistence APIs/libraries in Phase 0 runtime paths", async () => {
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
test("P1-EV-008 / VP-1.1-AC1: backend signaling event contract names are canonical", async () => {
  const contracts = await fs.readFile(SIGNALING_CONTRACTS_FILE, "utf8");
  const sharedEvents = await fs.readFile(SHARED_EVENTS_FILE, "utf8");

  // contracts.ts must delegate to shared constants (not hardcode wire strings)
  expectContains(contracts, "CLIENT_EVENT_NAMES.CREATE_ROOM", "create_room sourced from shared");
  expectContains(contracts, "CLIENT_EVENT_NAMES.JOIN_ROOM", "join_room sourced from shared");
  expectContains(contracts, "CLIENT_EVENT_NAMES.LEAVE_ROOM", "leave_room sourced from shared");
  expectContains(contracts, "SERVER_EVENT_NAMES.ROOM_CREATED", "room_created sourced from shared");
  expectContains(contracts, "SERVER_EVENT_NAMES.ROOM_JOINED", "room_joined sourced from shared");
  expectContains(contracts, "SERVER_EVENT_NAMES.PEER_JOINED", "peer_joined sourced from shared");
  expectContains(contracts, "SERVER_EVENT_NAMES.PEER_LEFT", "peer_left sourced from shared");
  expectContains(contracts, "SERVER_EVENT_NAMES.ROOM_DESTROYED", "room_destroyed sourced from shared");
  expectContains(contracts, "SERVER_EVENT_NAMES.ERROR", "error sourced from shared");

  // shared/events.ts must contain the authoritative wire-format literals
  expectContains(sharedEvents, 'CREATE_ROOM: "create_room"', "shared create_room literal");
  expectContains(sharedEvents, 'JOIN_ROOM: "join_room"', "shared join_room literal");
  expectContains(sharedEvents, 'LEAVE_ROOM: "leave_room"', "shared leave_room literal");
  expectContains(sharedEvents, 'ROOM_CREATED: "room_created"', "shared room_created literal");
  expectContains(sharedEvents, 'PEER_JOINED: "peer_joined"', "shared peer_joined literal");
  expectContains(sharedEvents, 'PEER_LEFT: "peer_left"', "shared peer_left literal");
  expectContains(sharedEvents, 'ROOM_DESTROYED: "room_destroyed"', "shared room_destroyed literal");
  expectContains(sharedEvents, 'ERROR: "error"', "shared error literal");
});

test("P1-EV-009 / VP-1.1-AC2: backend does not expose legacy destroy reason alias", async () => {
  const sharedReasons = await fs.readFile(SHARED_REASONS_FILE, "utf8");

  expectContains(sharedReasons, '"host_left"', "canonical host_left reason");
  expectContains(sharedReasons, '"host_grace_expired"', "canonical host_grace_expired reason");
  expectContains(sharedReasons, '"room_ttl_expired"', "canonical room_ttl_expired reason");
  expectContains(sharedReasons, '"solo_timeout_expired"', "canonical solo_timeout_expired reason");
  expectNotContains(sharedReasons, '"host_disconnected"', "legacy host_disconnected reason");
});

test("P1-AU-013 / VP-1.4-AC1/AC2/AC3: create/join/update enforce trim + INVALID_PASSWORD semantics", async () => {
  const handlers = await fs.readFile(SOCKET_HANDLERS_FILE, "utf8");

  expectContains(handlers, "ERROR_CODES.invalidPassword", "contract-based invalid password error code usage");
  expectContains(handlers, "emitInvalidPassword(socket)", "deterministic invalid password emission path");
  expectContains(handlers, ".trim()", "trim-based password validation");
  expectContains(handlers, "CLIENT_EVENTS.createRoom", "create_room handler");
  expectContains(handlers, "CLIENT_EVENTS.joinRoom", "join_room handler");
  expectContains(handlers, "CLIENT_EVENTS.roomPasswordUpdate", "room_password_update handler via contract constant");
});

// ---- Lifecycle ----
test("P1-LV-014 / VP-1.6-AC2/AC4 and VP-1.7-AC3: lifecycle uses grace + precedence primitives", async () => {
  const handlers = await fs.readFile(SOCKET_HANDLERS_FILE, "utf8");

  expectContains(handlers, "SERVER_EVENTS.hostReconnectGrace", "host grace notification event via contract constant");
  expectContains(handlers, "HOST_DISCONNECT_GRACE_MS", "host grace timer constant usage");
  expectContains(handlers, "GUEST_DISCONNECT_GRACE_MS", "guest grace timer constant usage");
  expectContains(handlers, "ROOM_MAX_DURATION_MS", "room ttl constant usage");
  expectContains(handlers, "SOLO_HOST_ROOM_TIMEOUT_MS", "solo timeout constant usage");
});

// ---- Rate Limiting ----
test("P2-RL-015 / VP-2.4: contracts define RATE_LIMITED error code and join-attempt policy constants", async () => {
  const contracts = await fs.readFile(SIGNALING_CONTRACTS_FILE, "utf8");

  expectContains(contracts, "RATE_LIMITED", "RATE_LIMITED error code");
  expectContains(contracts, "JOIN_INVALID_ATTEMPT_COOLDOWN_MS", "join-attempt cooldown duration constant");
  expectContains(contracts, "JOIN_INVALID_ATTEMPT_NO_COOLDOWN_MAX", "join-attempt no-cooldown attempt ceiling");
  expectContains(contracts, "JOIN_INVALID_ATTEMPT_COOLDOWN_MAX", "join-attempt cooldown attempt ceiling");
});

test("P2-RL-016 / VP-2.4: handlers include join-attempt tracking structure and RATE_LIMITED enforcement", async () => {
  const handlers = await fs.readFile(SOCKET_HANDLERS_FILE, "utf8");

  expectContains(handlers, "ERROR_CODES.rateLimited", "contract-based RATE_LIMITED error code usage");
  expectContains(handlers, "emitRateLimited(socket)", "RATE_LIMITED enforcement present in join path");
  expectContains(handlers, "joinAttemptByRoomSubject", "per-room/subject attempt tracking key");
  expectContains(handlers, "invalidCount", "invalid-attempt counter field");
  expectContains(handlers, "strictLocked", "strict-lockout flag field");
  expectContains(handlers, "cooldownUntil", "cooldown-deadline field");
});
