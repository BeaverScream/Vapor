import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')
const meshSource = readFileSync(resolve(ROOT, 'src/features/room/webrtc-chat-mesh.ts'), 'utf8')

// ---- needsOffer decision logic in webrtc-chat-mesh.ts ----

test('needsOffer method is defined on VaporWebRtcChatMesh', () => {
  assert.ok(meshSource.includes('private needsOffer('), 'needsOffer must be a private method on VaporWebRtcChatMesh')
})

test("needsOffer returns false when the data channel readyState is 'open'", () => {
  assert.ok(
    meshSource.includes("channel.readyState === 'open'"),
    "needsOffer must short-circuit false when channel.readyState === 'open'",
  )
})

test("needsOffer returns false when the connection signalingState is not 'stable'", () => {
  assert.ok(
    meshSource.includes("connection.signalingState !== 'stable'"),
    "needsOffer must short-circuit false when connection.signalingState !== 'stable'",
  )
})

test('syncPeers gates startOffer on shouldInitiate && needsOffer', () => {
  assert.ok(
    meshSource.includes('this.shouldInitiate(peerId) && this.needsOffer(peerId)'),
    'syncPeers must use shouldInitiate && needsOffer before calling startOffer',
  )
})

// ---- VP-12.7: closed data channels must be replaced during mesh repair ----

const startOfferSource = meshSource.slice(
  meshSource.indexOf('  private async startOffer(peerId: string): Promise<void> {'),
  meshSource.indexOf('  private broadcastControl(json: string): void {'),
)

test("S12.7-01: supplemental source contract for closed-channel replacement", () => {
  const closedCheck = "staleChannel.readyState === 'closed'"
  const handlerDetach = 'staleChannel.onmessage = null'
  const close = 'staleChannel.close()'
  const eviction = 'this.dataChannels.delete(peerId)'
  const channelCreation = 'connection.createDataChannel(DATA_CHANNEL_LABEL'

  assert.ok(startOfferSource.includes(closedCheck), 'startOffer must recognize closed channels as stale')
  assert.ok(startOfferSource.includes(handlerDetach), 'stale channel handlers must be detached')
  assert.ok(startOfferSource.includes(close), 'a stale channel must be closed before replacement')
  assert.ok(startOfferSource.includes(eviction), 'a stale channel must be removed from dataChannels')
  assert.ok(startOfferSource.indexOf(eviction) < startOfferSource.indexOf(channelCreation), 'eviction must precede fresh channel creation')
})

test("S12.7-02: supplemental source contract for closing-channel replacement", () => {
  assert.ok(
    startOfferSource.includes("staleChannel.readyState === 'closing'"),
    'startOffer must evict a closing channel so it cannot block replacement',
  )
  assert.ok(startOfferSource.includes('staleChannel.close()'), 'closing-channel cleanup must tolerate close()')
  assert.ok(startOfferSource.includes('this.dataChannels.delete(peerId)'), 'closing channel must be removed from the map')
})

test("S12.7-03: supplemental source contract for open-channel guard", () => {
  const duplicateGuard = 'if (!this.dataChannels.has(peerId)) {'

  assert.ok(meshSource.includes("channel.readyState === 'open'"), 'needsOffer must keep an open channel healthy')
  assert.ok(startOfferSource.includes(duplicateGuard), 'startOffer must retain its duplicate-channel guard')
  assert.ok(
    startOfferSource.indexOf(duplicateGuard) > startOfferSource.indexOf('this.dataChannels.delete(peerId)'),
    'only stale channels may be evicted before the duplicate-channel guard',
  )
})

test("S12.7-04: supplemental source contract for connecting-channel guard", () => {
  assert.ok(
    meshSource.includes("channel.readyState === 'connecting'"),
    'needsOffer must treat a connecting channel as mid-negotiation and avoid a duplicate offer',
  )
  assert.ok(startOfferSource.includes('if (!this.dataChannels.has(peerId)) {'), 'channel creation must remain map-guarded')
})

test('S12.7-05: supplemental source contract for baseline channel creation', () => {
  assert.ok(startOfferSource.includes('if (!this.dataChannels.has(peerId)) {'), 'missing channels must enter the creation branch')
  assert.ok(startOfferSource.includes('connection.createDataChannel(DATA_CHANNEL_LABEL'), 'the creation branch must create the Vapor data channel')
  assert.ok(startOfferSource.includes('this.attachDataChannel(peerId, channel)'), 'the new channel must be attached to the peer')
})

test('S12.7-06: supplemental source contract for peer-count/negotiation policy', () => {
  assert.match(
    meshSource,
    /\.filter\(\s*\(channel\)\s*=>\s*channel\.readyState === 'open',?\s*\)/,
    'connectedPeerCount must continue to count only open channels',
  )
  assert.ok(
    meshSource.includes('return this.participantId.localeCompare(peerId) < 0'),
    'perfect-negotiation initiation must retain its lexicographic rule',
  )
  assert.ok(
    meshSource.includes("channel.readyState === 'open' || channel.readyState === 'connecting'"),
    'needsOffer must preserve its healthy and in-progress channel short-circuit',
  )
})

test('S12.7-07: supplemental source contract for closed-channel repair path', () => {
  assert.ok(
    meshSource.includes('this.shouldInitiate(peerId) && this.needsOffer(peerId)'),
    'syncPeers must start a repair offer when the mesh needs one',
  )
  assert.ok(startOfferSource.includes("staleChannel.readyState === 'closed'"), 'the repair offer must evict the closed channel')
  assert.ok(startOfferSource.includes('connection.createDataChannel(DATA_CHANNEL_LABEL'), 'the repair offer must create a replacement channel')
  assert.ok(
    meshSource.includes("if (channel.readyState !== 'open') {") && meshSource.includes('channel.send(text)'),
    'sendMessage must deliver through the replacement after it opens',
  )
})
