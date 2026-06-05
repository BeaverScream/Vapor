import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const webrtcChatMeshFile = path.resolve(process.cwd(), 'src/features/room/webrtc-chat-mesh.ts')

function expectContains(content, snippet, label) {
  assert.equal(content.includes(snippet), true, `Missing ${label}: ${snippet}`)
}

// T4.4-11: Verify typing status state changes (start/stop) propagate to peers over the data channel.
// P2P signal accuracy is verified structurally below; end-to-end latency and smoothness are
// validated manually per VP-4.2 criteria.
test('T4.4-11: typing status start/stop signals propagate to peers over the WebRTC data channel', async () => {
  const content = await readFile(webrtcChatMeshFile, 'utf8')

  // Sender side: sendTypingStart must broadcast {"type":"typing_start"} to all open channels
  expectContains(content, 'sendTypingStart()', 'sendTypingStart method definition')
  expectContains(content, '\'{"type":"typing_start"}\'', 'typing_start broadcast payload')

  // Sender side: sendTypingStop must broadcast {"type":"typing_stop"} to all open channels
  expectContains(content, 'sendTypingStop()', 'sendTypingStop method definition')
  expectContains(content, '\'{"type":"typing_stop"}\'', 'typing_stop broadcast payload')

  // Receiver side: incoming typing_start must invoke onRemoteTypingStatus(peerId, true)
  expectContains(content, "type === 'typing_start'", 'typing_start inbound message guard')
  expectContains(content, 'this.onRemoteTypingStatus(peerId, true)', 'typing_start triggers onRemoteTypingStatus(true)')

  // Receiver side: incoming typing_stop must invoke onRemoteTypingStatus(peerId, false)
  expectContains(content, "type === 'typing_stop'", 'typing_stop inbound message guard')
  expectContains(content, 'this.onRemoteTypingStatus(peerId, false)', 'typing_stop triggers onRemoteTypingStatus(false)')

  // Safety invariant: peer disconnect must clear the typing indicator via onRemoteTypingStatus(peerId, false)
  // to prevent ghost "X is typing..." indicators after a peer leaves
  const typingFalseOccurrences = (content.match(/this\.onRemoteTypingStatus\(peerId, false\)/g) ?? []).length
  assert.ok(
    typingFalseOccurrences >= 2,
    `onRemoteTypingStatus(peerId, false) must appear at least twice: once for typing_stop handler and once in removePeer (found ${typingFalseOccurrences})`
  )
})
