import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')
const useVaporRoomSource = readFileSync(resolve(ROOT, 'src/features/room/useVaporRoom.ts'), 'utf8')

function getOnPeerLeftSource() {
  const handlerStart = useVaporRoomSource.indexOf('const onPeerLeft = useCallback')
  const handlerEnd = useVaporRoomSource.indexOf('\n  const onSignalOffer', handlerStart)

  assert.ok(handlerStart >= 0, 'useVaporRoom.ts must define onPeerLeft')
  assert.ok(handlerEnd >= 0, 'onPeerLeft must end before onSignalOffer')
  return useVaporRoomSource.slice(handlerStart, handlerEnd)
}

const onPeerLeftSource = getOnPeerLeftSource()

// ---- T11.6-05: onPeerLeft renders "was removed" for reason 'kick' ----

test('onPeerLeft maps reason "kick" to "was removed" system message action', () => {
  assert.ok(
    useVaporRoomSource.includes("payload.reason === 'kick' ? 'was removed'") ||
      useVaporRoomSource.includes('payload.reason === "kick" ? "was removed"'),
    'onPeerLeft in useVaporRoom.ts must map reason "kick" to action text "was removed"',
  )
})

// ---- T11.6-06: onPeerLeft "disconnected" / "left" unchanged for existing reasons ----

test('onPeerLeft maps reason "disconnect" to "disconnected"', () => {
  assert.ok(
    useVaporRoomSource.includes("payload.reason === 'disconnect' ? 'disconnected'") ||
      useVaporRoomSource.includes('payload.reason === "disconnect" ? "disconnected"'),
    'onPeerLeft in useVaporRoom.ts must map reason "disconnect" to action text "disconnected" (no regression)',
  )
})

test('onPeerLeft maps reason "leave" to "left" (default branch)', () => {
  assert.ok(
    useVaporRoomSource.includes(": 'left'") || useVaporRoomSource.includes(': "left"'),
    'onPeerLeft in useVaporRoom.ts must produce "left" for reason "leave" (default ternary branch)',
  )
})

// ---- VP-12.6: syncPeers must use committed post-withPeerLeft state ----

test('S12.6-01: supplemental source contract for post-peer-left derivation', () => {
  const stateTransition = 'withAppendedChatMessage(withPeerLeft(previous, payload)'

  assert.ok(onPeerLeftSource.includes(stateTransition), 'onPeerLeft must apply withPeerLeft before deriving peers')
  assert.ok(
    onPeerLeftSource.includes('const remainingPeerIds = state.participants'),
    'remaining peers must be derived from committed state.participants',
  )
  assert.ok(
    !onPeerLeftSource.includes('stateRef.current.participants'),
    'onPeerLeft must not derive remaining peers from the stale stateRef snapshot',
  )
  assert.ok(
    onPeerLeftSource.indexOf(stateTransition) < onPeerLeftSource.indexOf('const remainingPeerIds = state.participants'),
    'remaining peers must be read only after the reducer transition has committed',
  )
})

test('S12.6-02: supplemental source contract for peer-left sync guard', () => {
  assert.ok(
    useVaporRoomSource.includes('const peerRepairPendingRef = useRef(false)'),
    'a ref must retain pending repair work across the state commit',
  )
  assert.ok(
    onPeerLeftSource.includes('peerRepairPendingRef.current = true'),
    'peer_left must mark repair pending before enqueueing the state transition',
  )
  assert.ok(
    onPeerLeftSource.includes('if (!peerRepairPendingRef.current) return') &&
      onPeerLeftSource.includes('peerRepairPendingRef.current = false'),
    'the commit effect must guard and clear pending repair before synchronization',
  )
  const updaterStart = onPeerLeftSource.indexOf('setState((previous) => {')
  const updaterEnd = onPeerLeftSource.indexOf('\n    })', updaterStart)
  const syncIndex = onPeerLeftSource.indexOf('syncPeers(remainingPeerIds)')
  assert.ok(syncIndex > updaterEnd, 'syncPeers must execute after, not inside, the setState updater')
})

test('S12.6-03: supplemental source contract for surviving peer repair', () => {
  const handlePeerLeftIndex = onPeerLeftSource.indexOf('peerMeshRef.current?.handlePeerLeft(payload.participantId)')
  const syncIndex = onPeerLeftSource.indexOf('syncPeers(remainingPeerIds)')

  assert.ok(handlePeerLeftIndex >= 0, 'onPeerLeft must remove the departed peer from the mesh')
  assert.ok(syncIndex > handlePeerLeftIndex, 'mesh removal must happen before repairing surviving peers')
  assert.ok(
    onPeerLeftSource.includes('.filter((participantId) => participantId !== state.participantId)'),
    'withPeerLeft removes the leaver, so committed-state repair excludes only the local participant',
  )
})

test('S12.6-04: supplemental source contract for last-peer teardown', () => {
  assert.ok(
    onPeerLeftSource.includes('remainingPeerIds.length > 0'),
    'syncPeers must be skipped when peer_left leaves no remote participants',
  )
  assert.ok(
    onPeerLeftSource.includes('if (nextState.participantCount <= 1) {'),
    'onPeerLeft must retain the solo-room branch',
  )
  assert.ok(
    onPeerLeftSource.includes('chat.pendingMessagesRef.current = []'),
    'the solo-room branch must still clear queued outbound messages',
  )
  assert.ok(onPeerLeftSource.includes("withChatConnectionState(nextState, 'idle')"), 'the solo-room branch must return to idle chat state')
})

test('S12.6-05: supplemental source contract for peer-left transitions', () => {
  assert.ok(onPeerLeftSource.includes('createChatMessage(payload.participantId, `${name} ${action}`, \'system\')'), 'onPeerLeft must retain its system chat message')
  assert.ok(
    onPeerLeftSource.includes('nextState = { ...nextState, soloDeadlineAt: payload.soloDeadlineAt }'),
    'onPeerLeft must retain solo deadline adoption from the payload',
  )
  assert.ok(
    onPeerLeftSource.includes("withChatConnectionState(nextState, 'connecting')"),
    'onPeerLeft must retain connecting state when remote participants remain but no channel is open',
  )
})
