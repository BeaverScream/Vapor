import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const registerSocketHandlersFile = path.resolve(process.cwd(), '../backend/src/signaling/registerSocketHandlers.ts')
const rateLimitingFile = path.resolve(process.cwd(), '../backend/src/signaling/handlers/rateLimiting.ts')
const backendStateFile = path.resolve(process.cwd(), '../backend/src/signaling/state.ts')
const appFile = path.resolve(process.cwd(), 'src/App.tsx')
const indexCssFile = path.resolve(process.cwd(), 'src/index.css')
const roomViewFile = path.resolve(process.cwd(), 'src/features/room/RoomView.tsx')
const typesFile = path.resolve(process.cwd(), 'src/features/room/types.ts')
const constantsFile = path.resolve(process.cwd(), 'src/features/room/constants.ts')
const useRoomFile = path.resolve(process.cwd(), 'src/features/room/useVaporRoom.ts')
const roomSocketClientFile = path.resolve(process.cwd(), 'src/features/room/room-socket-client.ts')
const webrtcChatMeshFile = path.resolve(process.cwd(), 'src/features/room/webrtc-chat-mesh.ts')
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
test('T0.0-01: MVP client/server event names remain contract-locked', async () => {
  const content = await readFile(typesFile, 'utf8')
  const sharedEvents = await readFile(sharedEventsFile, 'utf8')

  expectContains(content, "from '@shared'", 'shared contract import in room types')
  expectContains(content, 'CREATE_ROOM: CLIENT_EVENT_NAMES.CREATE_ROOM', 'client create_room event source')
  expectContains(content, 'JOIN_ROOM: CLIENT_EVENT_NAMES.JOIN_ROOM', 'client join_room event source')
  expectContains(content, 'LEAVE_ROOM: CLIENT_EVENT_NAMES.LEAVE_ROOM', 'client leave_room event source')
  expectContains(content, 'SIGNAL_OFFER: CLIENT_EVENT_NAMES.SIGNAL_OFFER', 'client signal_offer event source')
  expectContains(content, 'SIGNAL_ANSWER: CLIENT_EVENT_NAMES.SIGNAL_ANSWER', 'client signal_answer event source')
  expectContains(content, 'SIGNAL_ICE: CLIENT_EVENT_NAMES.SIGNAL_ICE', 'client signal_ice event source')
  expectContains(content, 'RESUME_SESSION: CLIENT_EVENT_NAMES.RESUME_SESSION', 'client resume_session event source')

  expectContains(content, 'ROOM_CREATED: SERVER_EVENT_NAMES.ROOM_CREATED', 'server room_created event source')
  expectContains(content, 'ROOM_JOINED: SERVER_EVENT_NAMES.ROOM_JOINED', 'server room_joined event source')
  expectContains(content, 'PEER_JOINED: SERVER_EVENT_NAMES.PEER_JOINED', 'server peer_joined event source')
  expectContains(content, 'PEER_LEFT: SERVER_EVENT_NAMES.PEER_LEFT', 'server peer_left event source')
  expectContains(content, 'SIGNAL_OFFER: SERVER_EVENT_NAMES.SIGNAL_OFFER', 'server signal_offer event source')
  expectContains(content, 'SIGNAL_ANSWER: SERVER_EVENT_NAMES.SIGNAL_ANSWER', 'server signal_answer event source')
  expectContains(content, 'SIGNAL_ICE: SERVER_EVENT_NAMES.SIGNAL_ICE', 'server signal_ice event source')
  expectContains(content, 'ROOM_DESTROYED: SERVER_EVENT_NAMES.ROOM_DESTROYED', 'server room_destroyed event source')
  expectContains(content, 'ERROR: SERVER_EVENT_NAMES.ERROR', 'server error event source')

  expectContains(sharedEvents, 'CREATE_ROOM: "create_room"', 'shared create_room literal')
  expectContains(sharedEvents, 'ROOM_CREATED: "room_created"', 'shared room_created literal')
  expectContains(sharedEvents, 'SIGNAL_OFFER: "signal_offer"', 'shared signal_offer literal')
  expectContains(sharedEvents, 'SIGNAL_ANSWER: "signal_answer"', 'shared signal_answer literal')
  expectContains(sharedEvents, 'SIGNAL_ICE: "signal_ice"', 'shared signal_ice literal')
})

test('T0.0-02: required payload keys for room transitions remain present in FE contract types', async () => {
  const content = await readFile(typesFile, 'utf8')
  const sharedPayloads = await readFile(sharedPayloadsFile, 'utf8')

  expectContains(content, 'export type RoomCreatedPayload = SharedRoomCreatedPayload', 'RoomCreatedPayload shared alias')
  expectContains(content, 'export type RoomJoinedPayload = SharedRoomJoinedPayload', 'RoomJoinedPayload shared alias')
  expectContains(content, 'export type PeerJoinedPayload = SharedPeerJoinedPayload', 'PeerJoinedPayload shared alias')
  expectContains(content, 'export type SignalOfferPayload = SharedSignalOfferPayload', 'SignalOfferPayload shared alias')
  expectContains(content, 'export type SignalAnswerPayload = SharedSignalAnswerPayload', 'SignalAnswerPayload shared alias')
  expectContains(content, 'export type SignalIcePayload = SharedSignalIcePayload', 'SignalIcePayload shared alias')

  expectContains(sharedPayloads, 'export type RoomCreatedPayload = {', 'shared RoomCreatedPayload type')
  expectContains(sharedPayloads, 'hostId: string', 'shared hostId field on room lifecycle payloads')
  expectContains(sharedPayloads, 'expiresAt: number', 'shared expiresAt number field')
  expectContains(sharedPayloads, 'soloDeadlineAt?: number | null;', 'shared optional solo deadline field')
  expectContains(sharedPayloads, 'participantCount: number', 'shared participantCount field')
  expectContains(sharedPayloads, 'export type SignalOfferRelayPayload = {', 'shared SignalOfferRelayPayload type')
  expectContains(sharedPayloads, 'export type SignalAnswerRelayPayload = {', 'shared SignalAnswerRelayPayload type')
  expectContains(sharedPayloads, 'export type SignalIceRelayPayload = {', 'shared SignalIceRelayPayload type')
})

test('T2.6-03: frontend WebRTC signaling and RAM-only chat state wiring remain locked', async () => {
  const types = await readFile(typesFile, 'utf8')
  const socketClient = await readFile(roomSocketClientFile, 'utf8')
  const useRoom = await readFile(useRoomFile, 'utf8')
  const stateUtils = await readFile(stateUtilsFile, 'utf8')
  const roomView = await readFile(roomViewFile, 'utf8')
  const mesh = await readFile(webrtcChatMeshFile, 'utf8')

  expectContains(types, 'onSignalOffer: (handler: (payload: SignalOfferRelayPayload) => void) => void', 'signal_offer socket listener contract')
  expectContains(types, 'emitSignalOffer: (payload: SignalOfferRequest) => void', 'signal_offer client emit contract')
  expectContains(types, 'emitResumeSession: (payload: ResumeSessionRequest) => void', 'resume_session client emit contract')
  expectContains(types, 'chatMessages: ChatMessage[]', 'RAM-only chat message state field')
  expectContains(types, 'chatDraft: string', 'chat draft state field')

  expectContains(socketClient, 'socket.on(SERVER_EVENTS.SIGNAL_OFFER, handler)', 'signal_offer listener wiring')
  expectContains(socketClient, 'socket.emit(CLIENT_EVENTS.SIGNAL_OFFER, payload)', 'signal_offer emit wiring')
  expectContains(socketClient, 'socket.emit(CLIENT_EVENTS.SIGNAL_ANSWER, payload)', 'signal_answer emit wiring')
  expectContains(socketClient, 'socket.emit(CLIENT_EVENTS.SIGNAL_ICE, payload)', 'signal_ice emit wiring')
  expectContains(socketClient, 'socket.emit(CLIENT_EVENTS.RESUME_SESSION, payload)', 'resume_session emit wiring')

  expectContains(useRoom, 'new VaporWebRtcChatMesh', 'WebRTC mesh construction')
  expectContains(useRoom, 'peerMesh.syncPeers(payload.peers.map((peer) => peer.participantId))', 'peer sync on room_joined')
  expectContains(useRoom, 'emitSafeWebRtcTelemetry', 'safe telemetry helper wiring')
  expectContains(useRoom, 'void peerMeshRef.current?.handleSignalOffer(payload)', 'signal_offer hook subscription')
  expectContains(useRoom, 'sendChatMessage', 'chat send action wiring')
  expectContains(useRoom, 'sessionStorage', 'session storage usage for reconnect token policy')

  expectContains(stateUtils, 'chatMessages: []', 'chat state reset to volatile memory')
  expectContains(stateUtils, "chatDraft: ''", 'chat draft reset to volatile memory')

  expectContains(roomView, 'aria-label="Peer chat"', 'chat landmark for accessibility')
  expectContains(roomView, 'onSendChatMessage(trimmedMessage)', 'chat submit trigger')
  expectContains(mesh, 'iceServers: WEBRTC_ICE_SERVERS', 'configurable ICE server policy')
  expectContains(mesh, 'kind: \'peer_connection_state\'', 'safe peer connection state telemetry')
  expectContains(mesh, 'kind: \'data_channel_state\'', 'safe data channel state telemetry')
})

test('T2.5-01: frontend solo-host timer state and countdown UX are contract-locked', async () => {
  const constants = await readFile(constantsFile, 'utf8')
  const types = await readFile(typesFile, 'utf8')
  const stateUtils = await readFile(stateUtilsFile, 'utf8')
  const useRoom = await readFile(useRoomFile, 'utf8')
  const roomView = await readFile(roomViewFile, 'utf8')

  expectContains(types, 'soloDeadlineAt: number | null', 'room session solo deadline state field')
  expectContains(stateUtils, 'soloDeadlineAt: payload.soloDeadlineAt ?? null', 'room-created reducer solo deadline sync')
  expectContains(stateUtils, 'soloDeadlineAt: null', 'solo deadline cleared on lifecycle transitions')
  expectContains(useRoom, 'function getSoloWaitingText', 'solo waiting formatter helper')
  expectContains(useRoom, 'SOLO_HOST_WARNING', 'solo warning copy usage')
  expectContains(roomView, 'soloWaitingChipText', 'solo warning chip prop wiring')
  expectContains(constants, 'SOLO_HOST_WARNING', 'solo warning copy constant')
})

test('T2.2-01: frontend resume-session flow includes race guard and deterministic token cleanup', async () => {
  const types = await readFile(typesFile, 'utf8')
  const useRoom = await readFile(useRoomFile, 'utf8')
  const constants = await readFile(constantsFile, 'utf8')

  expectContains(types, 'ResumeSessionRequest', 'resume request contract type')
  expectContains(useRoom, 'resumeInFlightRef', 'resume race guard ref')
  expectContains(useRoom, 'autoResumeRequestedRef', 'auto resume state guard ref')
  expectContains(useRoom, 'socketRef.current?.emitResumeSession(storedSession)', 'resume_session emit path')
  expectContains(useRoom, 'clearStoredReconnectSession()', 'token cleanup path')
  expectContains(constants, 'RECONNECT_SESSION_STORAGE_KEY', 'sessionStorage key constant')
})

test('T2.7-01: frontend ICE config and telemetry safety wiring remain locked', async () => {
  const constants = await readFile(constantsFile, 'utf8')
  const useRoom = await readFile(useRoomFile, 'utf8')
  const mesh = await readFile(webrtcChatMeshFile, 'utf8')

  expectContains(constants, 'VITE_STUN_URLS', 'stun env config input')
  expectContains(constants, 'VITE_TURN_URLS', 'turn urls env config input')
  expectContains(constants, 'VITE_TURN_USERNAME', 'turn username env config input')
  expectContains(constants, 'VITE_TURN_CREDENTIAL', 'turn credential env config input')
  expectContains(constants, 'WEBRTC_ICE_SERVERS = buildIceServers()', 'runtime ICE server policy export')
  expectContains(useRoom, "new CustomEvent('vapor:webrtc-state'", 'safe telemetry event emission')
  expectContains(mesh, 'onTelemetryEvent', 'mesh telemetry callback contract')
})

test('T0.1-07: FE join emit preserves exact roomId input text', async () => {
  const content = await readFile(useRoomFile, 'utf8')
  expectContains(content, 'socket.emitJoinRoom({ roomId: s.roomIdInput, password: s.passwordInput, nickname: trimmedNickname })', 'exact roomId join emission')
})

// ---- UI Shell ----
test('T1.3-01: lobby shell includes Privacy/FAQ links and one approved sr-only h1 in main', async () => {
  const app = await readFile(appFile, 'utf8')

  expectContains(app, '<main', 'main landmark')
  expectContains(app, 'Privacy Policy', 'privacy policy top-nav link label')
  expectContains(app, 'FAQ', 'faq top-nav link label')
  expectContains(app, '<h1 className="sr-only">Vapor: Secure Temporary Rooms for Real-Time Collaboration</h1>', 'approved sr-only h1 copy')

  const h1Count = (app.match(/<h1/g) ?? []).length
  assert.equal(h1Count, 1, `Expected one h1 in App shell, found ${h1Count}`)
})

test('T1.3-02: global sr-only utility class is present', async () => {
  const css = await readFile(indexCssFile, 'utf8')

  expectContains(css, '.sr-only', 'sr-only utility selector')
  expectContains(css, 'position: absolute', 'sr-only absolute positioning rule')
})

// ---- Auth ----
test('T1.4-02: auth mismatch normalization and required-password submit hook remain locked', async () => {
  const errorCopy = await readFile(errorCopyFile, 'utf8')
  const useRoom = await readFile(useRoomFile, 'utf8')
  const lobbyView = await readFile(lobbyViewFile, 'utf8')
  const sharedErrors = await readFile(sharedErrorCodesFile, 'utf8')

  expectContains(errorCopy, 'case SIGNALING_ERROR_CODES.PASSWORD_VERSION_MISMATCH:', 'PASSWORD_VERSION_MISMATCH mapping case')
  expectContains(errorCopy, 'return SIGNALING_ERROR_CODES.INVALID_PASSWORD', 'PASSWORD_VERSION_MISMATCH normalization target')
  expectContains(useRoom, 'if (s.passwordInput.trim().length === 0)', 'required-password submit guard')
  expectContains(useRoom, 'getErrorMessage(SIGNALING_ERROR_CODES.INVALID_PASSWORD)', 'required-password deterministic error mapping')
  expectContains(lobbyView, 'placeholder="Required"', 'required-password lobby affordance')
  expectContains(sharedErrors, 'PASSWORD_VERSION_MISMATCH: "PASSWORD_VERSION_MISMATCH"', 'shared PASSWORD_VERSION_MISMATCH constant')
})

test('T2.4-03: frontend error layer handles RATE_LIMITED code and surfaces join-attempt policy language', async () => {
  const errorCopy = await readFile(errorCopyFile, 'utf8')
  const useRoom = await readFile(useRoomFile, 'utf8')
  const constants = await readFile(constantsFile, 'utf8')
  const sharedPolicy = await readFile(sharedPolicyFile, 'utf8')

  expectContains(errorCopy, 'case SIGNALING_ERROR_CODES.RATE_LIMITED:', 'RATE_LIMITED error code mapping in error-copy')
  expectContains(errorCopy, 'case SIGNALING_ERROR_CODES.ROOM_FULL:', 'ROOM_FULL error code mapping in error-copy')
  expectContains(useRoom, 'SIGNALING_ERROR_CODES.RATE_LIMITED', 'RATE_LIMITED reference in useRoom join path')
  expectContains(constants, 'JOIN_RATE_LIMIT_COOLDOWN_MS = JOIN_RATE_LIMIT_WINDOW_MS', 'frontend cooldown sourced from IP rate-limit window')
  expectContains(sharedPolicy, 'JOIN_RATE_LIMIT_WINDOW_MS = 60_000', 'shared IP rate-limit window constant')
})

// ---- Host Identity ----
test('T1.5-01: room participant model and UI expose explicit host labeling', async () => {
  const types = await readFile(typesFile, 'utf8')
  const roomView = await readFile(roomViewFile, 'utf8')
  const stateUtils = await readFile(stateUtilsFile, 'utf8')

  expectContains(types, 'isHost: boolean', 'participant host identity field')
  expectContains(roomView, 'Host', 'host badge text')
  expectContains(roomView, 'You (Host)', 'self-host explicit badge text')
  expectContains(stateUtils, 'participant.participantId === payload.hostId', 'host role mapped from explicit hostId payload')
})

test('T1.7-01: room lifetime text keeps >=10m compact and <10m strict zero-padded mm:ss', async () => {
  const useRoom = await readFile(useRoomFile, 'utf8')

  expectContains(useRoom, 'if (minutes >= 10)', '>=10 minutes compact branch')
  expectContains(useRoom, "return `Ends in ${minutes}m`", '>=10 minutes text format')
  expectContains(useRoom, "minutes.toString().padStart(2, '0')", 'zero-padded minute formatting')
  expectContains(useRoom, "seconds.toString().padStart(2, '0')", 'zero-padded second formatting')
  expectContains(useRoom, "return `Ends in ${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`", 'strict mm:ss display under 10 minutes')
})

// ---- Lifecycle ----
test('T1.6-02: canonical room_destroyed reasons and solo-timeout messaging hooks remain locked', async () => {
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

// ---- VP-3.2 User Identity & UX ----
test('T3.2-05 (P3-NK-005): reconnect flow restores participant identity and nickname', async () => {
  const types = await readFile(typesFile, 'utf8')
  const stateUtils = await readFile(stateUtilsFile, 'utf8')
  const useRoom = await readFile(useRoomFile, 'utf8')
  const socketClient = await readFile(roomSocketClientFile, 'utf8')

  // Nickname map is part of the persistent room session identity
  expectContains(types, 'participantNicknames: Record<string, string>', 'participantNicknames identity map on RoomSessionState')

  // resume_session responds with room_joined which carries the reclaimed nickname;
  // withRoomJoined must seed participantNicknames from payload.participantNickname
  expectContains(stateUtils, 'payload.participantNickname', 'nickname restored from room_joined payload on resume')

  // room_joined is the single handler for both initial join and resume;
  // it always refreshes the reconnect token so the identity chain stays valid
  expectContains(useRoom, 'persistence.writeStoredReconnectSession({', 'reconnect token refreshed on every room_joined including resume')

  // Both resume guards must be cleared on a successful room_joined so a subsequent
  // disconnect can trigger a clean new reconnect cycle
  expectContains(useRoom, 'resumeInFlightRef.current = false', 'resumeInFlightRef cleared on successful room_joined')
  expectContains(useRoom, 'autoResumeRequestedRef.current = false', 'autoResumeRequestedRef cleared on successful room_joined')

  // Nickname state must be scrubbed on room destruction so stale identity cannot bleed into new sessions
  expectContains(stateUtils, 'participantNicknames: {}', 'nickname map cleared on room end and lobby reset')
})

// ---- T3.3 Ops, Abuse Controls & Tests ----

test('T3.3-04 (P3-AB-004): lifecycle edge case contract coverage — TTL expiry, solo-timeout, and quota removal are verifiable', async () => {
  const handlers = await readFile(registerSocketHandlersFile, 'utf8')
  const stateSource = await readFile(backendStateFile, 'utf8')
  const rateLimiting = await readFile(rateLimitingFile, 'utf8')
  const sharedReasons = await readFile(sharedReasonsFile, 'utf8')
  const sharedPolicy = await readFile(sharedPolicyFile, 'utf8')

  // TTL expiry: backend wires the room TTL timer to destroy with room_ttl_expired
  expectContains(handlers, '"room_ttl_expired"', 'room_ttl_expired reason used in TTL timer callback')
  expectContains(handlers, 'ROOM_MAX_DURATION_MS', 'ROOM_MAX_DURATION_MS used as TTL timeout duration in handler')
  expectContains(sharedReasons, 'ROOM_TTL_EXPIRED: "room_ttl_expired"', 'room_ttl_expired reason declared in shared reasons')
  expectContains(sharedPolicy, 'ROOM_MAX_DURATION_MS', 'TTL duration constant present in shared policy')

  // Solo-timeout: backend wires the solo host timer to destroy with solo_timeout_expired
  expectContains(handlers, '"solo_timeout_expired"', 'solo_timeout_expired reason used in solo-host timer callback')
  expectContains(handlers, 'IDLE_ROOM_TIMEOUT_MS', 'IDLE_ROOM_TIMEOUT_MS used as solo timer duration in handler')
  expectContains(sharedReasons, 'SOLO_TIMEOUT_EXPIRED: "solo_timeout_expired"', 'solo_timeout_expired reason declared in shared reasons')
  expectContains(sharedPolicy, 'IDLE_ROOM_TIMEOUT_MS', 'Solo-host timeout constant present in shared policy')

  // Solo-timeout state: soloDeadlineAt is included in room_created payload so clients can show countdown
  expectContains(handlers, 'soloDeadlineAt: policy.soloDeadlineAt', 'soloDeadlineAt included in room_created payload')

  // Quota removal: no per-subject active-room quota mechanism exists in state or handler (BL-QUOTA-01/02/03)
  assert.equal(
    stateSource.includes('createQuotaBySubject'),
    false,
    'State must not contain createQuotaBySubject — per-subject room quota system has been removed'
  )
  assert.equal(
    handlers.includes('createQuotaBySubject'),
    false,
    'Handler must not reference createQuotaBySubject — quota system removed in favor of burst rate limiting'
  )

  // Burst rate limiting: abuse control uses a temporary in-memory blocklist, not per-room quotas (BL-QUOTA-03)
  // The implementation lives in rateLimiting.ts; handler delegates via rateLimiting.checkAndRecordCreateAttempt
  expectContains(handlers, 'rateLimiting.checkAndRecordCreateAttempt', 'Abuse control wired through rateLimiting module in handler')
  expectContains(rateLimiting, 'temporaryBlocklistByIp', 'Abuse control uses temporary in-memory blocklist, not quotas')
  expectContains(rateLimiting, 'createAttemptsByIp', 'Create-room burst window is tracked per-subject in RAM only')
  expectContains(rateLimiting, 'CREATE_ROOM_BURST_THRESHOLD', 'Burst threshold constant gates the blocklist trigger')
})

// ---- VP-4.1 Identity & UX Refinement ----

test('T4.1-03: UI correctly renders local user nickname from participantNickname payload', async () => {
  const stateUtils = await readFile(stateUtilsFile, 'utf8')
  const roomView = await readFile(roomViewFile, 'utf8')
  const sharedPayloads = await readFile(sharedPayloadsFile, 'utf8')

  // participantNickname must be declared in RoomCreatedPayload and RoomJoinedPayload
  expectContains(sharedPayloads, 'participantNickname?: string | null', 'participantNickname field declared in shared payload types')

  // withRoomCreated and withRoomJoined must seed the local user's own nickname from participantNickname
  expectContains(stateUtils, '{ [payload.participantId]: payload.participantNickname }', 'local user nickname keyed by participantId in participantNicknames map')

  // withRoomJoined must also seed peer nicknames from the peers array so the roster shows names immediately on join
  expectContains(stateUtils, 'peer.nickname', 'peer nicknames from payload.peers seeded into participantNicknames in withRoomJoined')

  // withPeerJoined must seed the joining peer's nickname from the peer_joined payload
  expectContains(stateUtils, 'payload.nickname', 'incoming peer nickname seeded into participantNicknames in withPeerJoined')

  // RoomView must render the local user with their nickname using the participantNicknames map
  expectContains(roomView, "You (", 'You (nickname) display pattern present in RoomView for local user identity')
  expectContains(roomView, 'participantNicknames[participantId]', 'participantNicknames map used to look up local user nickname in RoomView')
})

// ---- VP-4.2 Performance & Observability ----

test('T4.2-01: 1s countdown timers are isolated to memoized child components so RoomView does not re-render every second', async () => {
  const roomView = await readFile(roomViewFile, 'utf8')

  // Both countdown timer components must be defined as standalone memo-wrapped functions,
  // not inline within RoomView. The interval lives inside the child, not the parent.
  expectContains(roomView, 'const SoloWaitingChip = memo(function SoloWaitingChip', 'SoloWaitingChip is a standalone memo-wrapped component')
  expectContains(roomView, 'const RoomLifetimeChip = memo(function RoomLifetimeChip', 'RoomLifetimeChip is a standalone memo-wrapped component')

  // Each timer component owns its own nowMs state — the interval update only re-renders the chip, not RoomView
  expectContains(roomView, 'const [nowMs, setNowMs] = useState(() => Date.now())', 'timer child components own their own nowMs state')

  // The setInterval calls must live inside these child components, not at the RoomView level
  expectContains(roomView, 'const id = window.setInterval(() => setNowMs(Date.now()), 1000)', '1s interval drives only the chip component state')

  // RoomView itself is memoized so parent state changes do not force unnecessary re-renders
  expectContains(roomView, 'export const RoomView = memo(function RoomView', 'RoomView is wrapped with React.memo')
})

test('T4.2-02: DiagnosticsOverlay is wired to vapor:socket-latency and vapor:webrtc-state custom events for accurate telemetry', async () => {
  const roomView = await readFile(roomViewFile, 'utf8')
  const socketClient = await readFile(roomSocketClientFile, 'utf8')
  const useRoom = await readFile(useRoomFile, 'utf8')

  // DiagnosticsOverlay must exist as an isolated memo component
  expectContains(roomView, 'const DiagnosticsOverlay = memo(function DiagnosticsOverlay', 'DiagnosticsOverlay is a standalone memo-wrapped component')

  // Overlay subscribes to the socket latency custom event to display round-trip time
  expectContains(roomView, "window.addEventListener('vapor:socket-latency', onLatency)", 'DiagnosticsOverlay subscribes to vapor:socket-latency for socket RTT')
  expectContains(roomView, "window.removeEventListener('vapor:socket-latency', onLatency)", 'DiagnosticsOverlay unsubscribes from vapor:socket-latency on unmount')

  // Overlay subscribes to the WebRTC state custom event for per-peer diagnostics
  expectContains(roomView, "window.addEventListener('vapor:webrtc-state', onWebRtcState)", 'DiagnosticsOverlay subscribes to vapor:webrtc-state for peer diagnostics')
  expectContains(roomView, "window.removeEventListener('vapor:webrtc-state', onWebRtcState)", 'DiagnosticsOverlay unsubscribes from vapor:webrtc-state on unmount')

  // Overlay handles all three telemetry event kinds emitted by the WebRTC mesh
  expectContains(roomView, "detail.kind === 'peer_connection_state'", 'DiagnosticsOverlay handles peer_connection_state telemetry kind')
  expectContains(roomView, "detail.kind === 'data_channel_state'", 'DiagnosticsOverlay handles data_channel_state telemetry kind')
  expectContains(roomView, "detail.kind === 'bitrate_stats'", 'DiagnosticsOverlay handles bitrate_stats telemetry kind')

  // Socket client dispatches the latency event on the socket.io pong measurement
  expectContains(socketClient, "(socket.io.on as (event: string, listener: (latencyMs: number) => void) => void)('pong'", 'socket client measures latency via socket.io pong callback')
  expectContains(socketClient, "window.dispatchEvent(new CustomEvent('vapor:socket-latency', { detail: { latencyMs } }))", 'socket client dispatches vapor:socket-latency on pong with latencyMs payload')

  // useVaporRoom routes WebRTC telemetry through the safe window event dispatcher
  expectContains(useRoom, "new CustomEvent('vapor:webrtc-state'", 'useVaporRoom dispatches vapor:webrtc-state custom events for telemetry')
  expectContains(useRoom, 'emitSafeWebRtcTelemetry', 'emitSafeWebRtcTelemetry helper wires WebRTC mesh telemetry to the window event bus')
})

// ---- VP-3.1 Security & Housekeeping ----
test('T3.1-05 (P3-SH-005): per-room lock serializes password updates and resume-session validation', async () => {
  const handlers = await readFile(registerSocketHandlersFile, 'utf8')

  // The per-room lock helper must be defined and used in the signaling module
  expectContains(handlers, 'function withRoomLock(', 'withRoomLock helper definition')

  // Both mutating operations — password update and session resume — must route through the lock
  // to prevent overlapping mutations from producing inconsistent reconnect state.
  expectContains(handlers, "await withRoomLock(roomId", 'at least one withRoomLock usage (room_password_update or resume_session)')

  const lockUsages = (handlers.match(/await withRoomLock\(roomId/g) ?? []).length
  assert.ok(
    lockUsages >= 2,
    `Both room_password_update and resume_session must use withRoomLock — found ${lockUsages} usage(s)`
  )

  // resume_session handler must be declared async so the lock await is valid
  expectContains(handlers, 'async (payload: ResumeSessionPayload', 'resume_session handler declared async')

  // room_password_update handler must be declared async so the lock await is valid
  expectContains(handlers, 'async (payload: RoomPasswordUpdatePayload', 'room_password_update handler declared async')
})
