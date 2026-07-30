import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')

const stateUtilsSource = readFileSync(resolve(ROOT, 'src/features/room/state-utils.ts'), 'utf8')
const errorCopySource  = readFileSync(resolve(ROOT, 'src/features/room/error-copy.ts'), 'utf8')
const useVaporRoomSource = readFileSync(resolve(ROOT, 'src/features/room/useVaporRoom.ts'), 'utf8')
  .replace(/\r\n/g, '\n')
const roomViewSource = readFileSync(resolve(ROOT, 'src/features/room/RoomView.tsx'), 'utf8')
const roomViewDesktopSource = readFileSync(resolve(ROOT, 'src/features/room/RoomViewDesktop.tsx'), 'utf8')

function getDerivedStateSource() {
  const derivedStart = useVaporRoomSource.indexOf('    derived: {')
  const derivedEnd = useVaporRoomSource.indexOf('\n    },\n  }', derivedStart)

  assert.ok(derivedStart >= 0, 'useVaporRoom must return a derived state object')
  assert.ok(derivedEnd >= 0, 'derived state object must have a closing boundary')
  return useVaporRoomSource.slice(derivedStart, derivedEnd)
}

const derivedStateSource = getDerivedStateSource()

// ---- VP-12.4 Capacity display and ROOM_FULL copy ----

test('T12.4-07: ROOM_FULL copy explains that reconnecting slots reserve capacity', () => {
  const errorMessageSource = errorCopySource.match(
    /export function getErrorMessage[\s\S]*?^}/m,
  )?.[0] ?? ''
  const roomFullMatch = errorMessageSource.match(
    /case SIGNALING_ERROR_CODES\.ROOM_FULL:[\s\S]*?return '([^']+)'/,
  )
  assert.ok(roomFullMatch, 'ROOM_FULL must have a dedicated error-copy entry')
  assert.equal(roomFullMatch[1], 'Room is at capacity — some slots are held for reconnecting participants.')

  const unchangedMessages = [
    'Room not found.',
    'Room expired.',
    'Password is required or incorrect.',
    'Nickname is taken or invalid in this room.',
    'Too many attempts. Try again later.',
    'You are not authorized to perform this action.',
    'Your reconnect token has expired. Please rejoin the room.',
    'The host reconnect window has closed. The room may have ended.',
  ]
  for (const message of unchangedMessages) {
    assert.ok(errorCopySource.includes(message), `unrelated error copy must remain unchanged: ${message}`)
  }
})

test('S12.4-08: supplemental source contract for reconnectingCount transitions', () => {
  assert.ok(stateUtilsSource.includes('reconnectingCount: 0'), 'initial and cleared session state must reset reconnectingCount')
  for (const transition of ['withRoomJoined', 'withSessionResumed', 'withPeerJoined', 'withPeerLeft']) {
    const match = stateUtilsSource.match(new RegExp(`export function ${transition}[\\s\\S]*?^}`, 'm'))
      ?? (transition === 'withSessionResumed'
        ? stateUtilsSource.match(/export function withSessionResumed[\s\S]*?^}/m)
        : null)
    assert.ok(match, `${transition} must be exported`)
  }
  assert.ok(
    stateUtilsSource.includes('function normalizeReconnectingCount'),
    'reconnecting counts must pass through a shared runtime normalizer',
  )
  const payloadDefaultUses = stateUtilsSource.match(
    /reconnectingCount: normalizeReconnectingCount\(payload\.reconnectingCount\)/g,
  ) ?? []
  assert.equal(payloadDefaultUses.length, 3, 'join, peer_joined, and peer_left transitions normalize absent or malformed counts')
  assert.ok(
    stateUtilsSource.includes('...withRoomJoined(state, payload)'),
    'session resume inherits room_joined reconnectingCount handling',
  )
})

// ---- VP-12.3 resume transition ----

test('T12.3-11: withSessionResumed preserves the room-joined transition and applies its grace deadline last', () => {
  const fnMatch = stateUtilsSource.match(/export function withSessionResumed[\s\S]*?^}/m)
  assert.ok(fnMatch, 'withSessionResumed must be exported')
  assert.ok(fnMatch[0].includes('...withRoomJoined(state, payload)'), 'resume must begin with the complete room-joined transition')
  assert.ok(
    fnMatch[0].includes('hostReconnectGraceDeadlineAt: normalizeDeadline(payload.hostReconnectGraceDeadlineAt)'),
    'resume must preserve a valid host grace deadline and normalize absent or malformed values to null',
  )
})

// ---- VP-12.5 peers[].isHost source-of-truth transition ----

test('S12.5-05: supplemental source contract for wire host mapping', () => {
  const fnMatch = stateUtilsSource.match(/export function withRoomJoined[\s\S]*?^}/m)
  assert.ok(fnMatch, 'withRoomJoined must be exported')
  assert.ok(
    fnMatch[0].includes('isHost: participant.isHost'),
    'existing peers must retain the isHost value supplied by room_joined/session_resumed',
  )
  assert.ok(
    fnMatch[0].includes('payload.participantId === payload.hostId'),
    'the self entry remains locally derived because it is intentionally absent from peers',
  )
  assert.ok(
    !fnMatch[0].includes('isHost: participant.participantId === payload.hostId'),
    'existing peers must not re-derive host status from hostId',
  )
})

// ---- withKickedFromRoom resets lobby fields ----

test('withKickedFromRoom sets lobbyMode to "create"', () => {
  assert.ok(
    stateUtilsSource.includes("lobbyMode: 'create'"),
    'withKickedFromRoom must explicitly set lobbyMode to "create"',
  )
})

test('withKickedFromRoom sets lobbyStatus to "idle"', () => {
  assert.ok(
    stateUtilsSource.includes("lobbyStatus: 'idle'"),
    'withKickedFromRoom must explicitly set lobbyStatus to "idle"',
  )
})

test('withKickedFromRoom sets errorMessage to null', () => {
  const fnMatch = stateUtilsSource.match(/function withKickedFromRoom[\s\S]*?^}/m)
  assert.ok(fnMatch, 'withKickedFromRoom function must exist in state-utils.ts')
  assert.ok(
    fnMatch[0].includes('errorMessage: null'),
    'withKickedFromRoom must explicitly set errorMessage: null',
  )
})

test("withKickedFromRoom sets roomIdInput to ''", () => {
  const fnMatch = stateUtilsSource.match(/function withKickedFromRoom[\s\S]*?^}/m)
  assert.ok(fnMatch, 'withKickedFromRoom function must exist in state-utils.ts')
  assert.ok(
    fnMatch[0].includes("roomIdInput: ''"),
    "withKickedFromRoom must explicitly set roomIdInput: ''",
  )
})

// ---- clearSessionFields shared by withRoomEnded and resetToLobby ----

test('clearSessionFields helper exists and is used by withRoomEnded', () => {
  assert.ok(
    stateUtilsSource.includes('function clearSessionFields'),
    'clearSessionFields helper function must be defined in state-utils.ts',
  )
  const roomEndedMatch = stateUtilsSource.match(/function withRoomEnded[\s\S]*?^}/m)
  assert.ok(roomEndedMatch, 'withRoomEnded must exist')
  assert.ok(
    roomEndedMatch[0].includes('clearSessionFields()'),
    'withRoomEnded must spread clearSessionFields() to zero all shared session fields',
  )
})

test('clearSessionFields is used by resetToLobby', () => {
  const resetToLobbyMatch = stateUtilsSource.match(/function resetToLobby[\s\S]*?^}/m)
  assert.ok(resetToLobbyMatch, 'resetToLobby must exist')
  assert.ok(
    resetToLobbyMatch[0].includes('clearSessionFields()'),
    'resetToLobby must spread clearSessionFields() to zero all shared session fields',
  )
})

test('clearSessionFields zeroes participantId', () => {
  const fnMatch = stateUtilsSource.match(/function clearSessionFields[\s\S]*?^}/m)
  assert.ok(fnMatch, 'clearSessionFields must exist')
  assert.ok(fnMatch[0].includes('participantId: null'), 'clearSessionFields must zero participantId')
})

test('clearSessionFields zeroes soloDeadlineAt', () => {
  const fnMatch = stateUtilsSource.match(/function clearSessionFields[\s\S]*?^}/m)
  assert.ok(fnMatch, 'clearSessionFields must exist')
  assert.ok(
    fnMatch[0].includes('soloDeadlineAt: null'),
    'clearSessionFields must zero soloDeadlineAt so countdown does not bleed into next session',
  )
})

test('clearSessionFields zeroes participantNicknames', () => {
  const fnMatch = stateUtilsSource.match(/function clearSessionFields[\s\S]*?^}/m)
  assert.ok(fnMatch, 'clearSessionFields must exist')
  assert.ok(
    fnMatch[0].includes('participantNicknames: {}'),
    'clearSessionFields must zero participantNicknames map',
  )
})

test('clearSessionFields zeroes chatMessages', () => {
  const fnMatch = stateUtilsSource.match(/function clearSessionFields[\s\S]*?^}/m)
  assert.ok(fnMatch, 'clearSessionFields must exist')
  assert.ok(
    fnMatch[0].includes('chatMessages: []'),
    'clearSessionFields must zero chatMessages (RAM-only chat has no persistence)',
  )
})

// ---- getErrorMessage maps canonical error codes ----

test('getErrorMessage maps NOT_AUTHORIZED to a non-empty string', () => {
  assert.ok(
    errorCopySource.includes('NOT_AUTHORIZED'),
    'error-copy.ts must reference NOT_AUTHORIZED error code',
  )
  assert.ok(
    errorCopySource.includes('not authorized'),
    'error message for NOT_AUTHORIZED must contain user-facing "not authorized" text',
  )
})

test('getErrorMessage maps RECONNECT_TOKEN_STALE to a non-empty string', () => {
  assert.ok(
    errorCopySource.includes('RECONNECT_TOKEN_STALE'),
    'error-copy.ts must reference RECONNECT_TOKEN_STALE error code',
  )
  assert.ok(
    errorCopySource.includes('reconnect token') || errorCopySource.includes('rejoin'),
    'error message for RECONNECT_TOKEN_STALE must reference reconnect token or rejoin',
  )
})

test('getErrorMessage maps HOST_RECONNECT_WINDOW_EXPIRED to a non-empty string', () => {
  assert.ok(
    errorCopySource.includes('HOST_RECONNECT_WINDOW_EXPIRED'),
    'error-copy.ts must reference HOST_RECONNECT_WINDOW_EXPIRED error code',
  )
  assert.ok(
    errorCopySource.includes('reconnect window') || errorCopySource.includes('host reconnect'),
    'error message for HOST_RECONNECT_WINDOW_EXPIRED must reference the reconnect window',
  )
})

test('all 9 canonical error codes are handled in getErrorMessage', () => {
  const canonicalCodes = [
    'ROOM_NOT_FOUND',
    'ROOM_FULL',
    'ROOM_EXPIRED',
    'INVALID_PASSWORD',
    'HOST_RECONNECT_WINDOW_EXPIRED',
    'RECONNECT_TOKEN_STALE',
    'NOT_AUTHORIZED',
    'RATE_LIMITED',
    'INVALID_SIGNAL_PAYLOAD',
  ]
  for (const code of canonicalCodes) {
    assert.ok(
      errorCopySource.includes(code),
      `error-copy.ts must reference canonical error code: ${code}`,
    )
  }
})

// ---- Explicit null/undefined guards (not falsy) ----

test('getSoloWaitingText uses explicit null/undefined guard (not falsy !)', () => {
  const fnMatch = useVaporRoomSource.match(/function getSoloWaitingText[\s\S]*?^}/m)
  assert.ok(fnMatch, 'getSoloWaitingText must be defined in useVaporRoom.ts')
  assert.ok(
    fnMatch[0].includes('=== null') || fnMatch[0].includes('=== undefined'),
    'getSoloWaitingText must use explicit null/undefined guard so value 0 is not treated as absent',
  )
  assert.ok(
    !fnMatch[0].match(/if\s*\(\s*!\s*soloDeadlineAt\s*\)/),
    'getSoloWaitingText must NOT use falsy guard (! soloDeadlineAt) — 0 is a valid deadline in tests',
  )
})

test('getLifetimeText uses explicit null/undefined guard (not falsy !)', () => {
  const fnMatch = useVaporRoomSource.match(/function getLifetimeText[\s\S]*?^}/m)
  assert.ok(fnMatch, 'getLifetimeText must be defined in useVaporRoom.ts')
  assert.ok(
    fnMatch[0].includes('=== null') || fnMatch[0].includes('=== undefined'),
    'getLifetimeText must use explicit null/undefined guard so value 0 is not treated as absent',
  )
  assert.ok(
    !fnMatch[0].match(/if\s*\(\s*!\s*expiresAt\s*\)/),
    'getLifetimeText must NOT use falsy guard (! expiresAt) — 0 is a valid value in tests',
  )
})

test('getSoloWaitingText is exported from useVaporRoom.ts', () => {
  assert.ok(
    useVaporRoomSource.includes('export function getSoloWaitingText'),
    'getSoloWaitingText must be exported so it can be exercised independently in tests',
  )
})

test('getLifetimeText is exported from useVaporRoom.ts', () => {
  assert.ok(
    useVaporRoomSource.includes('export function getLifetimeText'),
    'getLifetimeText must be exported so it can be exercised independently in tests',
  )
})

// ---- VP-12.8 timer ownership: one deadline per UI surface ----

test('S12.8-01: supplemental source contract for TTL derivation', () => {
  assert.ok(derivedStateSource.includes('expiresAt: state.expiresAt'), 'derived lifetime expiry must be the room TTL supplied by state')
})

test('S12.8-02: supplemental source contract for solo deadline separation', () => {
  assert.ok(derivedStateSource.includes('soloDeadlineAt: state.soloDeadlineAt'), 'derived solo deadline must remain available to SoloWaitingChip')
  assert.ok(!derivedStateSource.includes('expiresAt: state.soloDeadlineAt'), 'a solo deadline must never become the RoomLifetimeChip expiry')
})

test('S12.8-03: supplemental source contract for host-grace separation', () => {
  assert.ok(!derivedStateSource.includes('expiresAt: state.hostReconnectGraceDeadlineAt'), 'a host grace deadline must never become the RoomLifetimeChip expiry')
})

test('S12.8-04: supplemental source contract for deadline selection', () => {
  assert.ok(!derivedStateSource.includes('Math.min') && !derivedStateSource.includes('effectiveExpiresAt'), 'derived expiry must not select the shortest active deadline')
  assert.equal((derivedStateSource.match(/expiresAt:/g) ?? []).length, 1, 'derived state must expose exactly one lifetime expiry source')
})

test('S12.8-05: supplemental source contract for null TTL / solo', () => {
  assert.ok(derivedStateSource.includes('expiresAt: state.expiresAt'), 'a null state.expiresAt must pass through as null')
  assert.ok(!derivedStateSource.includes('?? state.soloDeadlineAt'), 'the solo deadline must not be a null fallback for the lifetime chip')
})

test('S12.8-06: supplemental source contract for null TTL / grace', () => {
  assert.ok(!derivedStateSource.includes('?? state.hostReconnectGraceDeadlineAt'), 'host grace must not be a null fallback for the lifetime chip')
})

test('S12.8-07: supplemental source contract for removed expiry memo', () => {
  assert.ok(!useVaporRoomSource.includes('const effectiveExpiresAt'), 'no effectiveExpiresAt memo may fabricate a countdown when every deadline is null')
  assert.ok(!useVaporRoomSource.includes('Math.min(...deadlines)'), 'the removed deadline aggregation must not be reintroduced')
})

test('S12.8-09: supplemental source contract for solo formatter', () => {
  const fnMatch = useVaporRoomSource.match(/export function getSoloWaitingText[\s\S]*?^}/m)
  assert.ok(fnMatch, 'getSoloWaitingText must remain defined')
  assert.ok(fnMatch[0].includes('minutes >= 10'), 'solo formatter must retain the compact >=10-minute format')
  assert.ok(fnMatch[0].includes("padStart(2, '0')"), 'solo formatter must retain mm:ss formatting below 10 minutes')
  assert.ok(fnMatch[0].includes('if (remainingMs <= 0) return null'), 'expired solo timers must remain hidden')
  for (const [name, source] of [['RoomView', roomViewSource], ['RoomViewDesktop', roomViewDesktopSource]]) {
    assert.ok(source.includes('if (!soloDeadlineAt) return'), `${name} must keep the solo chip unmounted without a deadline`)
    assert.ok(source.includes('getSoloWaitingText(soloDeadlineAt, nowMs)'), `${name} must continue to source solo-chip text only from the solo deadline`)
  }
})

test('S12.8-10: supplemental source contract for lifetime formatter and tick', () => {
  const fnMatch = useVaporRoomSource.match(/export function getLifetimeText[\s\S]*?^}/m)
  assert.ok(fnMatch, 'getLifetimeText must remain defined')
  assert.ok(
    fnMatch[0].includes('if (remainingMs > 10 * 60 * 1000) return `Ends in ${minutes}m`'),
    'lifetime formatter must use compact minutes only above the normative 10-minute boundary',
  )
  assert.ok(fnMatch[0].includes("padStart(2, '0')"), 'lifetime formatter must retain mm:ss formatting below 10 minutes')
  assert.ok(fnMatch[0].includes('if (remainingMs <= 0) return null'), 'expired lifetime timers must remain hidden')
  for (const [name, source] of [['RoomView', roomViewSource], ['RoomViewDesktop', roomViewDesktopSource]]) {
    assert.ok(source.includes('window.setInterval(() => setNowMs(Date.now()), 1000)'), `${name} must retain the 1-second lifetime chip tick`)
    assert.ok(source.includes('}, [expiresAt])'), `${name} must scope the lifetime timer effect to expiresAt`)
  }
})
