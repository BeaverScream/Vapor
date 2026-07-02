import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')
const useVaporRoomSource = readFileSync(resolve(ROOT, 'src/features/room/useVaporRoom.ts'), 'utf8')

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
