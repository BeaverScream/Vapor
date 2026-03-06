import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const typesFile = path.resolve(process.cwd(), 'src/features/room/types.ts')
const useRoomFile = path.resolve(process.cwd(), 'src/features/room/useVaporRoom.ts')

function expectContains(content, snippet, label) {
  assert.equal(content.includes(snippet), true, `Missing ${label}: ${snippet}`)
}

test('P0-HR-002: MVP client/server event names remain contract-locked', async () => {
  const content = await readFile(typesFile, 'utf8')

  expectContains(content, "CREATE_ROOM: 'create_room'", 'client create_room event')
  expectContains(content, "JOIN_ROOM: 'join_room'", 'client join_room event')
  expectContains(content, "LEAVE_ROOM: 'leave_room'", 'client leave_room event')

  expectContains(content, "ROOM_CREATED: 'room_created'", 'server room_created event')
  expectContains(content, "ROOM_JOINED: 'room_joined'", 'server room_joined event')
  expectContains(content, "PEER_JOINED: 'peer_joined'", 'server peer_joined event')
  expectContains(content, "PEER_LEFT: 'peer_left'", 'server peer_left event')
  expectContains(content, "ROOM_DESTROYED: 'room_destroyed'", 'server room_destroyed event')
  expectContains(content, "ERROR: 'error'", 'server error event')
})

test('P0-HR-002: required payload keys for room transitions remain present in FE contract types', async () => {
  const content = await readFile(typesFile, 'utf8')

  expectContains(content, 'export interface RoomCreatedPayload {', 'RoomCreatedPayload interface')
  expectContains(content, 'roomId: string', 'roomId field')
  expectContains(content, 'participantId: string', 'participantId field')
  expectContains(content, 'reconnectToken: null', 'reconnectToken field')
  expectContains(content, 'expiresAt: null', 'expiresAt field')
  expectContains(content, 'participantCount: number', 'participantCount field')

  expectContains(content, 'export interface RoomJoinedPayload {', 'RoomJoinedPayload interface')
  expectContains(content, 'peers: Participant[]', 'peers field')
  expectContains(content, 'export interface PeerJoinedPayload {', 'PeerJoinedPayload interface')
})

test('VP-0.1-05 / P0-JN-003: FE join emit preserves exact roomId input text', async () => {
  const content = await readFile(useRoomFile, 'utf8')
  expectContains(content, 'socket.emitJoinRoom({ roomId: state.roomIdInput, password: state.passwordInput })', 'exact roomId join emission')
})
