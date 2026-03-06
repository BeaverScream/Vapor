import { io } from 'socket.io-client'
import { SIGNALING_URL } from './constants'
import {
  CLIENT_EVENTS,
  SERVER_EVENTS,
  type CreateRoomRequest,
  type JoinRoomRequest,
  type LeaveRoomRequest,
  type PeerJoinedPayload,
  type PeerLeftPayload,
  type RoomCreatedPayload,
  type RoomDestroyedPayload,
  type RoomJoinedPayload,
  type RoomSocketClient,
  type SocketErrorPayload,
} from './types'

export function createRoomSocketClient(signalingUrl: string = SIGNALING_URL): RoomSocketClient {
  const socket = io(signalingUrl, {
    transports: ['websocket'],
  })

  return {
    onConnect: (handler) => socket.on('connect', handler),
    onDisconnect: (handler) => socket.on('disconnect', handler),
    onRoomCreated: (handler) => socket.on(SERVER_EVENTS.ROOM_CREATED, handler),
    onRoomJoined: (handler) => socket.on(SERVER_EVENTS.ROOM_JOINED, handler),
    onPeerJoined: (handler) => socket.on(SERVER_EVENTS.PEER_JOINED, handler),
    onPeerLeft: (handler) => socket.on(SERVER_EVENTS.PEER_LEFT, handler),
    onRoomDestroyed: (handler) => socket.on(SERVER_EVENTS.ROOM_DESTROYED, handler),
    onError: (handler) => socket.on(SERVER_EVENTS.ERROR, handler),
    offConnect: (handler) => socket.off('connect', handler),
    offDisconnect: (handler) => socket.off('disconnect', handler),
    offRoomCreated: (handler) => socket.off(SERVER_EVENTS.ROOM_CREATED, handler),
    offRoomJoined: (handler) => socket.off(SERVER_EVENTS.ROOM_JOINED, handler),
    offPeerJoined: (handler) => socket.off(SERVER_EVENTS.PEER_JOINED, handler),
    offPeerLeft: (handler) => socket.off(SERVER_EVENTS.PEER_LEFT, handler),
    offRoomDestroyed: (handler) => socket.off(SERVER_EVENTS.ROOM_DESTROYED, handler),
    offError: (handler) => socket.off(SERVER_EVENTS.ERROR, handler),
    emitCreateRoom: (payload: CreateRoomRequest) => socket.emit(CLIENT_EVENTS.CREATE_ROOM, payload),
    emitJoinRoom: (payload: JoinRoomRequest) => socket.emit(CLIENT_EVENTS.JOIN_ROOM, payload),
    emitLeaveRoom: (payload: LeaveRoomRequest) => socket.emit(CLIENT_EVENTS.LEAVE_ROOM, payload),
    disconnect: () => socket.disconnect(),
  }
}
