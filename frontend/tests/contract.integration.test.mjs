import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const appFile = path.resolve(process.cwd(), 'src/App.tsx')
const indexCssFile = path.resolve(process.cwd(), 'src/index.css')
const roomViewFile = path.resolve(process.cwd(), 'src/features/room/RoomView.tsx')
const typesFile = path.resolve(process.cwd(), 'src/features/room/types.ts')
const constantsFile = path.resolve(process.cwd(), 'src/features/room/constants.ts')
const useRoomFile = path.resolve(process.cwd(), 'src/features/room/useVaporRoom.ts')
const roomSocketClientFile = path.resolve(process.cwd(), 'src/features/room/room-socket-client.ts')
const errorCopyFile = path.resolve(process.cwd(), 'src/features/room/error-copy.ts')
const stateUtilsFile = path.resolve(process.cwd(), 'src/features/room/state-utils.ts')
const lobbyViewFile = path.resolve(process.cwd(), 'src/features/room/LobbyView.tsx')
const sharedEventsFile = path.resolve(process.cwd(), '../shared/events.ts')
const sharedPayloadsFile = path.resolve(process.cwd(), '../shared/payloads.ts')
const sharedReasonsFile = path.resolve(process.cwd(), '../shared/reasons.ts')
const sharedErrorCodesFile = path.resolve(process.cwd(), '../shared/error-codes.ts')
const sharedPolicyFile = path.resolve(process.cwd(), '../shared/policy.ts')

function expectContains(content, snippet, label) {
  assert.equal(content.includes(snippet), true, `Missing ${label}: ${snippet}`)
}

// ---- Contract ----
test('P0-HR-002: MVP client/server event names remain contract-locked', async () => {
  const content = await readFile(typesFile, 'utf8')
  const sharedEvents = await readFile(sharedEventsFile, 'utf8')

  expectContains(content, "from '@shared'", 'shared contract import in room types')
  expectContains(content, 'CREATE_ROOM: CLIENT_EVENT_NAMES.CREATE_ROOM', 'client create_room event source')
  expectContains(content, 'JOIN_ROOM: CLIENT_EVENT_NAMES.JOIN_ROOM', 'client join_room event source')
  expectContains(content, 'LEAVE_ROOM: CLIENT_EVENT_NAMES.LEAVE_ROOM', 'client leave_room event source')

  expectContains(content, 'ROOM_CREATED: SERVER_EVENT_NAMES.ROOM_CREATED', 'server room_created event source')
  expectContains(content, 'ROOM_JOINED: SERVER_EVENT_NAMES.ROOM_JOINED', 'server room_joined event source')
  expectContains(content, 'PEER_JOINED: SERVER_EVENT_NAMES.PEER_JOINED', 'server peer_joined event source')
  expectContains(content, 'PEER_LEFT: SERVER_EVENT_NAMES.PEER_LEFT', 'server peer_left event source')
  expectContains(content, 'ROOM_DESTROYED: SERVER_EVENT_NAMES.ROOM_DESTROYED', 'server room_destroyed event source')
  expectContains(content, 'ERROR: SERVER_EVENT_NAMES.ERROR', 'server error event source')

  expectContains(sharedEvents, 'CREATE_ROOM: "create_room"', 'shared create_room literal')
  expectContains(sharedEvents, 'ROOM_CREATED: "room_created"', 'shared room_created literal')
})

test('P0-HR-002: required payload keys for room transitions remain present in FE contract types', async () => {
  const content = await readFile(typesFile, 'utf8')
  const sharedPayloads = await readFile(sharedPayloadsFile, 'utf8')

  expectContains(content, 'export type RoomCreatedPayload = SharedRoomCreatedPayload', 'RoomCreatedPayload shared alias')
  expectContains(content, 'export type RoomJoinedPayload = SharedRoomJoinedPayload', 'RoomJoinedPayload shared alias')
  expectContains(content, 'export type PeerJoinedPayload = SharedPeerJoinedPayload', 'PeerJoinedPayload shared alias')

  expectContains(sharedPayloads, 'export type RoomCreatedPayload = {', 'shared RoomCreatedPayload type')
  expectContains(sharedPayloads, 'expiresAt: number', 'shared expiresAt number field')
  expectContains(sharedPayloads, 'participantCount: number', 'shared participantCount field')
})

test('VP-0.1-05 / P0-JN-003: FE join emit preserves exact roomId input text', async () => {
  const content = await readFile(useRoomFile, 'utf8')
  expectContains(content, 'socket.emitJoinRoom({ roomId: state.roomIdInput, password: state.passwordInput })', 'exact roomId join emission')
})

// ---- UI Shell ----
test('VP-1.3-AC1/AC2: lobby shell includes Privacy/FAQ links and one approved sr-only h1 in main', async () => {
  const app = await readFile(appFile, 'utf8')

  expectContains(app, '<main', 'main landmark')
  expectContains(app, 'Privacy Policy', 'privacy policy top-nav link label')
  expectContains(app, 'FAQ', 'faq top-nav link label')
  expectContains(app, '<h1 className="sr-only">Vapor: Secure Temporary Rooms for Real-Time Collaboration</h1>', 'approved sr-only h1 copy')

  const h1Count = (app.match(/<h1/g) ?? []).length
  assert.equal(h1Count, 1, `Expected one h1 in App shell, found ${h1Count}`)
})

test('VP-1.3-AC3: global sr-only utility class is present', async () => {
  const css = await readFile(indexCssFile, 'utf8')

  expectContains(css, '.sr-only', 'sr-only utility selector')
  expectContains(css, 'position: absolute', 'sr-only absolute positioning rule')
})

// ---- Auth ----
test('VP-1.4: auth mismatch normalization and required-password submit hook remain locked', async () => {
  const errorCopy = await readFile(errorCopyFile, 'utf8')
  const useRoom = await readFile(useRoomFile, 'utf8')
  const lobbyView = await readFile(lobbyViewFile, 'utf8')
  const sharedErrors = await readFile(sharedErrorCodesFile, 'utf8')

  expectContains(errorCopy, 'case SIGNALING_ERROR_CODES.PASSWORD_VERSION_MISMATCH:', 'PASSWORD_VERSION_MISMATCH mapping case')
  expectContains(errorCopy, 'return SIGNALING_ERROR_CODES.INVALID_PASSWORD', 'PASSWORD_VERSION_MISMATCH normalization target')
  expectContains(useRoom, 'if (state.passwordInput.trim().length === 0)', 'required-password submit guard')
  expectContains(useRoom, 'getErrorMessage(SIGNALING_ERROR_CODES.INVALID_PASSWORD)', 'required-password deterministic error mapping')
  expectContains(lobbyView, 'placeholder="Required"', 'required-password lobby affordance')
  expectContains(sharedErrors, 'PASSWORD_VERSION_MISMATCH: "PASSWORD_VERSION_MISMATCH"', 'shared PASSWORD_VERSION_MISMATCH constant')
})

test('VP-2.4: frontend error layer handles RATE_LIMITED code and surfaces join-attempt policy language', async () => {
  const errorCopy = await readFile(errorCopyFile, 'utf8')
  const useRoom = await readFile(useRoomFile, 'utf8')
  const constants = await readFile(constantsFile, 'utf8')
  const sharedPolicy = await readFile(sharedPolicyFile, 'utf8')

  expectContains(errorCopy, 'case SIGNALING_ERROR_CODES.RATE_LIMITED:', 'RATE_LIMITED error code mapping in error-copy')
  expectContains(useRoom, 'SIGNALING_ERROR_CODES.RATE_LIMITED', 'RATE_LIMITED reference in useRoom join path')
  expectContains(constants, 'JOIN_RATE_LIMIT_COOLDOWN_MS = JOIN_INVALID_ATTEMPT_COOLDOWN_MS', 'frontend cooldown sourced from shared policy')
  expectContains(sharedPolicy, 'JOIN_INVALID_ATTEMPT_COOLDOWN_MS = 10 * 60 * 1000', 'shared cooldown policy constant')
})

// ---- Host Identity ----
test('VP-1.5-AC1/AC2: room participant model and UI expose explicit host labeling', async () => {
  const types = await readFile(typesFile, 'utf8')
  const roomView = await readFile(roomViewFile, 'utf8')

  expectContains(types, 'isHost: boolean', 'participant host identity field')
  expectContains(roomView, 'Host', 'host badge text')
  expectContains(roomView, 'You (Host)', 'self-host explicit badge text')
})

// ---- Lifecycle ----
test('VP-1.6 / VP-1.7: canonical room_destroyed reasons and solo-timeout messaging hooks remain locked', async () => {
  const types = await readFile(typesFile, 'utf8')
  const stateUtils = await readFile(stateUtilsFile, 'utf8')
  const useRoom = await readFile(useRoomFile, 'utf8')
  const roomSocketClient = await readFile(roomSocketClientFile, 'utf8')
  const sharedReasons = await readFile(sharedReasonsFile, 'utf8')

  expectContains(types, 'export type RoomDestroyedReason = SharedRoomDestroyedReason', 'room destroyed reason sourced from shared')
  expectContains(sharedReasons, 'HOST_LEFT: "host_left"', 'host_left destroy reason')
  expectContains(sharedReasons, 'HOST_GRACE_EXPIRED: "host_grace_expired"', 'host_grace_expired destroy reason')
  expectContains(sharedReasons, 'ROOM_TTL_EXPIRED: "room_ttl_expired"', 'room_ttl_expired destroy reason')
  expectContains(sharedReasons, 'SOLO_TIMEOUT_EXPIRED: "solo_timeout_expired"', 'solo_timeout_expired destroy reason')

  expectContains(stateUtils, "case 'host_left':", 'host_left destroy reason mapping')
  expectContains(stateUtils, "case 'host_grace_expired':", 'host_grace_expired destroy reason mapping')
  expectContains(stateUtils, "case 'room_ttl_expired':", 'room_ttl_expired destroy reason mapping')
  expectContains(stateUtils, "case 'solo_timeout_expired':", 'solo_timeout_expired destroy reason mapping')
  expectContains(useRoom, 'withRoomEnded(previous, payload.reason)', 'payload-driven room destroy handling')
  expectContains(roomSocketClient, 'SERVER_EVENTS.HOST_RECONNECT_GRACE', 'host reconnect grace socket contract wiring')
  expectContains(useRoom, 'withHostReconnectGrace(previous, payload.deadlineAt)', 'host reconnect grace state handling')
})
