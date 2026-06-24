import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')

const stateUtilsSource = readFileSync(resolve(ROOT, 'src/features/room/state-utils.ts'), 'utf8')
const errorCopySource  = readFileSync(resolve(ROOT, 'src/features/room/error-copy.ts'), 'utf8')
const useVaporRoomSource = readFileSync(resolve(ROOT, 'src/features/room/useVaporRoom.ts'), 'utf8')

// ---- T9.1-04: withKickedFromRoom resets lobby fields ----

test('T9.1-04: withKickedFromRoom sets lobbyMode to "create"', () => {
  assert.ok(
    stateUtilsSource.includes("lobbyMode: 'create'"),
    'withKickedFromRoom must explicitly set lobbyMode to "create"',
  )
})

test('T9.1-04: withKickedFromRoom sets lobbyStatus to "idle"', () => {
  assert.ok(
    stateUtilsSource.includes("lobbyStatus: 'idle'"),
    'withKickedFromRoom must explicitly set lobbyStatus to "idle"',
  )
})

test('T9.1-04: withKickedFromRoom sets errorMessage to null', () => {
  // The function body should have errorMessage: null after the withRoomEnded spread
  const fnMatch = stateUtilsSource.match(/function withKickedFromRoom[\s\S]*?^}/m)
  assert.ok(fnMatch, 'withKickedFromRoom function must exist in state-utils.ts')
  assert.ok(
    fnMatch[0].includes('errorMessage: null'),
    'withKickedFromRoom must explicitly set errorMessage: null',
  )
})

test("T9.1-04: withKickedFromRoom sets roomIdInput to ''", () => {
  const fnMatch = stateUtilsSource.match(/function withKickedFromRoom[\s\S]*?^}/m)
  assert.ok(fnMatch, 'withKickedFromRoom function must exist in state-utils.ts')
  assert.ok(
    fnMatch[0].includes("roomIdInput: ''"),
    "withKickedFromRoom must explicitly set roomIdInput: ''",
  )
})

// ---- T9.3-03: clearSessionFields shared by withRoomEnded and resetToLobby ----

test('T9.3-03: clearSessionFields helper exists and is used by withRoomEnded', () => {
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

test('T9.3-03: clearSessionFields is used by resetToLobby', () => {
  const resetToLobbyMatch = stateUtilsSource.match(/function resetToLobby[\s\S]*?^}/m)
  assert.ok(resetToLobbyMatch, 'resetToLobby must exist')
  assert.ok(
    resetToLobbyMatch[0].includes('clearSessionFields()'),
    'resetToLobby must spread clearSessionFields() to zero all shared session fields',
  )
})

test('T9.3-03: clearSessionFields zeroes participantId', () => {
  const fnMatch = stateUtilsSource.match(/function clearSessionFields[\s\S]*?^}/m)
  assert.ok(fnMatch, 'clearSessionFields must exist')
  assert.ok(fnMatch[0].includes('participantId: null'), 'clearSessionFields must zero participantId')
})

test('T9.3-03: clearSessionFields zeroes soloDeadlineAt', () => {
  const fnMatch = stateUtilsSource.match(/function clearSessionFields[\s\S]*?^}/m)
  assert.ok(fnMatch, 'clearSessionFields must exist')
  assert.ok(
    fnMatch[0].includes('soloDeadlineAt: null'),
    'clearSessionFields must zero soloDeadlineAt so countdown does not bleed into next session',
  )
})

test('T9.3-03: clearSessionFields zeroes participantNicknames', () => {
  const fnMatch = stateUtilsSource.match(/function clearSessionFields[\s\S]*?^}/m)
  assert.ok(fnMatch, 'clearSessionFields must exist')
  assert.ok(
    fnMatch[0].includes('participantNicknames: {}'),
    'clearSessionFields must zero participantNicknames map',
  )
})

test('T9.3-03: clearSessionFields zeroes chatMessages', () => {
  const fnMatch = stateUtilsSource.match(/function clearSessionFields[\s\S]*?^}/m)
  assert.ok(fnMatch, 'clearSessionFields must exist')
  assert.ok(
    fnMatch[0].includes('chatMessages: []'),
    'clearSessionFields must zero chatMessages (RAM-only chat has no persistence)',
  )
})

// ---- T9.3-05: getErrorMessage maps the three new error codes ----

test('T9.3-05: getErrorMessage maps NOT_AUTHORIZED to a non-empty string', () => {
  assert.ok(
    errorCopySource.includes('NOT_AUTHORIZED'),
    'error-copy.ts must reference NOT_AUTHORIZED error code',
  )
  assert.ok(
    errorCopySource.includes('not authorized'),
    'error message for NOT_AUTHORIZED must contain user-facing "not authorized" text',
  )
})

test('T9.3-05: getErrorMessage maps RECONNECT_TOKEN_STALE to a non-empty string', () => {
  assert.ok(
    errorCopySource.includes('RECONNECT_TOKEN_STALE'),
    'error-copy.ts must reference RECONNECT_TOKEN_STALE error code',
  )
  // Verify a non-empty user-facing message exists for this code
  assert.ok(
    errorCopySource.includes('reconnect token') || errorCopySource.includes('rejoin'),
    'error message for RECONNECT_TOKEN_STALE must reference reconnect token or rejoin',
  )
})

test('T9.3-05: getErrorMessage maps HOST_RECONNECT_WINDOW_EXPIRED to a non-empty string', () => {
  assert.ok(
    errorCopySource.includes('HOST_RECONNECT_WINDOW_EXPIRED'),
    'error-copy.ts must reference HOST_RECONNECT_WINDOW_EXPIRED error code',
  )
  assert.ok(
    errorCopySource.includes('reconnect window') || errorCopySource.includes('host reconnect'),
    'error message for HOST_RECONNECT_WINDOW_EXPIRED must reference the reconnect window',
  )
})

test('T9.3-05: all 9 canonical error codes are handled in getErrorMessage', () => {
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

// ---- T9.3-06: falsy-zero guards replaced with explicit null/undefined checks ----

test('T9.3-06: getSoloWaitingText uses explicit null/undefined guard (not falsy !)', () => {
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

test('T9.3-06: getLifetimeText uses explicit null/undefined guard (not falsy !)', () => {
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

test('T9.3-06: getSoloWaitingText is exported from useVaporRoom.ts', () => {
  assert.ok(
    useVaporRoomSource.includes('export function getSoloWaitingText'),
    'getSoloWaitingText must be exported so it can be exercised independently in tests',
  )
})

test('T9.3-06: getLifetimeText is exported from useVaporRoom.ts', () => {
  assert.ok(
    useVaporRoomSource.includes('export function getLifetimeText'),
    'getLifetimeText must be exported so it can be exercised independently in tests',
  )
})
