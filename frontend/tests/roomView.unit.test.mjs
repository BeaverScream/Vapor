import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')

const appTsx             = readFileSync(resolve(ROOT, 'src/App.tsx'), 'utf8')
const roomView           = readFileSync(resolve(ROOT, 'src/features/room/RoomView.tsx'), 'utf8')
const roomViewDesktop    = readFileSync(resolve(ROOT, 'src/features/room/RoomViewDesktop.tsx'), 'utf8')
const participantUtils   = readFileSync(resolve(ROOT, 'src/features/room/participant-utils.ts'), 'utf8')

// ---- T8.6-03: App.tsx routes by layout mode ----

test('T8.6-03a: App.tsx imports useLayoutMode', () => {
  assert.ok(
    appTsx.includes('useLayoutMode'),
    'App.tsx must import useLayoutMode to drive the layout routing',
  )
})

test('T8.6-03b: App.tsx imports RoomViewDesktop', () => {
  assert.ok(
    appTsx.includes('RoomViewDesktop'),
    'App.tsx must import RoomViewDesktop for desktop mode routing',
  )
})

test('T8.6-03c: App.tsx routes to RoomViewDesktop when mode is desktop', () => {
  assert.ok(
    appTsx.includes("'desktop'") || appTsx.includes('"desktop"'),
    "App.tsx must have a 'desktop' mode branch to render RoomViewDesktop",
  )
  assert.ok(
    appTsx.includes('RoomViewDesktop') && appTsx.includes('RoomView'),
    'App.tsx must conditionally render both RoomViewDesktop and RoomView',
  )
})

test('T8.6-03d: LobbyView is not wrapped in any desktop variant', () => {
  assert.ok(
    !appTsx.includes('LobbyViewDesktop'),
    'No LobbyViewDesktop must exist — lobby is identical across all viewports (8.6.4)',
  )
})

// ---- T8.6-06: Mobile RoomView has accessible participant dropdown ----

test('T8.6-06a: RoomView toggle row has aria-expanded attribute', () => {
  assert.ok(
    roomView.includes('aria-expanded'),
    'RoomView participant toggle row must use aria-expanded for accordion state',
  )
})

test('T8.6-06b: RoomView toggle row has aria-controls attribute', () => {
  assert.ok(
    roomView.includes('aria-controls'),
    'RoomView participant toggle row must use aria-controls to associate it with the roster',
  )
})

test('T8.6-06c: RoomView shows participant count in the toggle row', () => {
  assert.ok(
    roomView.includes('participant') && roomView.includes('participantCount'),
    'RoomView toggle row must display participant count ("N participants")',
  )
})

test('T8.6-06d: RoomView has kick/Remove capability in participant rows', () => {
  assert.ok(
    roomView.includes('onKickParticipant') || roomView.includes('kickParticipant'),
    'RoomView participant rows must wire up onKickParticipant for host Remove action',
  )
})

// ---- T8.6-07: RoomViewDesktop panel is visible by default ----

test('T8.6-07a: RoomViewDesktop initialises the panel as open (true)', () => {
  assert.ok(
    roomViewDesktop.includes('useState(true)'),
    'RoomViewDesktop must initialise isPanelOpen to true so the panel is visible by default',
  )
})

// ---- T8.6-08: RoomViewDesktop exposes all core room actions ----

test('T8.6-08a: RoomViewDesktop accepts and wires onSendChatMessage', () => {
  assert.ok(
    roomViewDesktop.includes('onSendChatMessage'),
    'RoomViewDesktop must accept and wire onSendChatMessage for message sending',
  )
})

test('T8.6-08b: RoomViewDesktop accepts and wires onCopyRoomId', () => {
  assert.ok(
    roomViewDesktop.includes('onCopyRoomId'),
    'RoomViewDesktop must accept and wire onCopyRoomId for copying the room link',
  )
})

test('T8.6-08c: RoomViewDesktop accepts and wires onLeaveRoom', () => {
  assert.ok(
    roomViewDesktop.includes('onLeaveRoom'),
    'RoomViewDesktop must accept and wire onLeaveRoom',
  )
})

test('T8.6-08d: RoomViewDesktop accepts and wires onKickParticipant', () => {
  assert.ok(
    roomViewDesktop.includes('onKickParticipant'),
    'RoomViewDesktop must accept and wire onKickParticipant for host kick action',
  )
})

// ---- T8.6-09: kick (Remove) is wired in both room views ----

test('T8.6-09a: RoomView wires onKickParticipant in participant rows', () => {
  assert.ok(
    roomView.includes('onKickParticipant'),
    'RoomView must wire onKickParticipant to a Remove button in the participant list',
  )
})

test('T8.6-09b: RoomViewDesktop wires onKickParticipant in participant rows', () => {
  assert.ok(
    roomViewDesktop.includes('onKickParticipant'),
    'RoomViewDesktop must wire onKickParticipant to a Remove button in the participant panel',
  )
})

test('T8.6-09c: both views share the same prop name for the kick handler (no fork)', () => {
  const mobileHasIt  = roomView.includes('onKickParticipant')
  const desktopHasIt = roomViewDesktop.includes('onKickParticipant')
  assert.ok(mobileHasIt && desktopHasIt, 'both RoomView and RoomViewDesktop must use onKickParticipant (identical props interface)')
})

// ---- VP-12.5 peers[].isHost roster rendering ----

test('S12.5-06: supplemental source contract for roster host affordances', () => {
  for (const [name, source] of [['RoomView', roomView], ['RoomViewDesktop', roomViewDesktop]]) {
    assert.ok(
      source.includes('participant.isHost'),
      `${name} must render its host indicator from the Participant.isHost state field`,
    )
    assert.ok(
      source.includes('<CrownIcon />'),
      `${name} must retain the host crown indicator`,
    )
  }
})

// ---- VP-12.8 host-grace visibility ----

test('S12.8-08: supplemental source contract for host-grace room status', () => {
  assert.ok(participantUtils.includes("return 'Host disconnected. Waiting for host to reconnect…'"), 'getRoomStatus must retain the host reconnect grace message')
  assert.ok(participantUtils.includes('if (hostReconnectGraceDeadlineAt !== null)'), 'host grace status must be driven directly by its deadline')
  for (const [name, source] of [['RoomView', roomView], ['RoomViewDesktop', roomViewDesktop]]) {
    assert.ok(source.includes('roomStatus'), `${name} must render the shared host-grace room status`)
  }
})
