import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')

const meshSource = readFileSync(resolve(ROOT, 'src/features/room/webrtc-chat-mesh.ts'), 'utf8')
const vaporRoomSource = readFileSync(resolve(ROOT, 'src/features/room/useVaporRoom.ts'), 'utf8')

// ---- needsOffer decision logic in webrtc-chat-mesh.ts ----

test('needsOffer method is defined on VaporWebRtcChatMesh', () => {
  assert.ok(
    meshSource.includes('private needsOffer('),
    'needsOffer must be a private method on VaporWebRtcChatMesh',
  )
})

test("needsOffer returns false when the data channel readyState is 'open'", () => {
  assert.ok(
    meshSource.includes("channel.readyState === 'open'"),
    "needsOffer must short-circuit false when channel.readyState === 'open' (healthy channel — no re-offer needed)",
  )
})

test("needsOffer returns false when the connection signalingState is not 'stable'", () => {
  assert.ok(
    meshSource.includes("connection.signalingState !== 'stable'"),
    "needsOffer must short-circuit false when connection.signalingState !== 'stable' (mid-negotiation — do not disrupt)",
  )
})

test('syncPeers gates startOffer on shouldInitiate && needsOffer', () => {
  assert.ok(
    meshSource.includes('this.shouldInitiate(peerId) && this.needsOffer(peerId)'),
    'syncPeers must use shouldInitiate(peerId) && needsOffer(peerId) as a compound guard before calling startOffer — '
    + 'this ensures only the lexicographically-lower peer initiates, and only when the channel needs repair',
  )
})

// ---- onPeerLeft handler logic in useVaporRoom.ts ----

test('onPeerLeft reads participants from the state ref to derive remaining peer ids', () => {
  assert.ok(
    vaporRoomSource.includes('previousState.participants'),
    'onPeerLeft must read previousState.participants (stateRef snapshot) to compute the remaining peer list',
  )
})

test('onPeerLeft excludes self from the remaining peer id list', () => {
  assert.ok(
    vaporRoomSource.includes('participantId !== previousState.participantId'),
    'onPeerLeft must filter out the local participantId (self) when computing remainingPeerIds',
  )
})

test('onPeerLeft excludes the leaving peer from the remaining peer id list', () => {
  assert.ok(
    vaporRoomSource.includes('participantId !== payload.participantId'),
    'onPeerLeft must filter out payload.participantId (the leaver) when computing remainingPeerIds',
  )
})

test('onPeerLeft calls syncPeers only when at least one peer remains', () => {
  assert.ok(
    vaporRoomSource.includes('remainingPeerIds.length > 0'),
    'onPeerLeft must guard the syncPeers call with remainingPeerIds.length > 0',
  )
  assert.ok(
    vaporRoomSource.includes('syncPeers(remainingPeerIds)'),
    'onPeerLeft must call peerMeshRef.current?.syncPeers(remainingPeerIds) to repair the mesh after a peer departs',
  )
})

test('outbound pending queue is cleared only in the truly-solo branch (participantCount <= 1)', () => {
  const soloGuard = 'if (nextState.participantCount <= 1) {'
  const pendingClear = 'chat.pendingMessagesRef.current = []'

  const soloIdx = vaporRoomSource.indexOf(soloGuard)
  const clearIdx = vaporRoomSource.indexOf(pendingClear)

  assert.ok(soloIdx >= 0, `onPeerLeft must contain the solo-branch guard: "${soloGuard}"`)
  assert.ok(clearIdx >= 0, `onPeerLeft must clear the pending queue with: "${pendingClear}"`)

  assert.ok(
    soloIdx < clearIdx,
    'chat.pendingMessagesRef.current = [] must appear after the participantCount <= 1 guard — '
    + 'it is inside the solo branch and must not execute while two or more peers remain',
  )

  const between = vaporRoomSource.slice(soloIdx + soloGuard.length, clearIdx)
  const opens = (between.match(/\{/g) ?? []).length
  const closes = (between.match(/\}/g) ?? []).length
  assert.ok(
    opens >= closes,
    `pendingMessagesRef.current = [] must be inside the if-block: `
    + `found ${opens} open-brace(s) vs ${closes} close-brace(s) between the guard and the clear`,
  )
})
