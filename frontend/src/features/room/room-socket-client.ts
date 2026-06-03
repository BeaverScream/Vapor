import { io } from 'socket.io-client'
import { SIGNALING_URL } from './constants'
import {
  CLIENT_EVENTS,
  SERVER_EVENTS,
  type CreateRoomRequest,
  type HostReconnectGracePayload,
  type JoinRoomRequest,
  type LeaveRoomRequest,
  type NicknameUpdatedPayload,
  type PeerJoinedPayload,
  type PeerLeftPayload,
  type RoomCreatedPayload,
  type RoomDestroyedPayload,
  type RoomJoinedPayload,
  type RoomSocketClient,
  type ResumeSessionRequest,
  type SignalAnswerRelayPayload,
  type SignalAnswerRequest,
  type SignalIceRelayPayload,
  type SignalIceRequest,
  type SignalOfferRelayPayload,
  type SignalOfferRequest,
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
    onSignalOffer: (handler: (payload: SignalOfferRelayPayload) => void) => socket.on(SERVER_EVENTS.SIGNAL_OFFER, handler),
    onSignalAnswer: (handler: (payload: SignalAnswerRelayPayload) => void) => socket.on(SERVER_EVENTS.SIGNAL_ANSWER, handler),
    onSignalIce: (handler: (payload: SignalIceRelayPayload) => void) => socket.on(SERVER_EVENTS.SIGNAL_ICE, handler),
    onHostReconnectGrace: (handler: (payload: HostReconnectGracePayload) => void) =>
      socket.on(SERVER_EVENTS.HOST_RECONNECT_GRACE, handler),
    onNicknameUpdated: (handler: (payload: NicknameUpdatedPayload) => void) =>
      socket.on(SERVER_EVENTS.NICKNAME_UPDATED, handler),
    onRoomDestroyed: (handler) => socket.on(SERVER_EVENTS.ROOM_DESTROYED, handler),
    onError: (handler) => socket.on(SERVER_EVENTS.ERROR, handler),
    offConnect: (handler) => socket.off('connect', handler),
    offDisconnect: (handler) => socket.off('disconnect', handler),
    offRoomCreated: (handler) => socket.off(SERVER_EVENTS.ROOM_CREATED, handler),
    offRoomJoined: (handler) => socket.off(SERVER_EVENTS.ROOM_JOINED, handler),
    offPeerJoined: (handler) => socket.off(SERVER_EVENTS.PEER_JOINED, handler),
    offPeerLeft: (handler) => socket.off(SERVER_EVENTS.PEER_LEFT, handler),
    offSignalOffer: (handler: (payload: SignalOfferRelayPayload) => void) => socket.off(SERVER_EVENTS.SIGNAL_OFFER, handler),
    offSignalAnswer: (handler: (payload: SignalAnswerRelayPayload) => void) => socket.off(SERVER_EVENTS.SIGNAL_ANSWER, handler),
    offSignalIce: (handler: (payload: SignalIceRelayPayload) => void) => socket.off(SERVER_EVENTS.SIGNAL_ICE, handler),
    offHostReconnectGrace: (handler: (payload: HostReconnectGracePayload) => void) =>
      socket.off(SERVER_EVENTS.HOST_RECONNECT_GRACE, handler),
    offNicknameUpdated: (handler: (payload: NicknameUpdatedPayload) => void) =>
      socket.off(SERVER_EVENTS.NICKNAME_UPDATED, handler),
    offRoomDestroyed: (handler) => socket.off(SERVER_EVENTS.ROOM_DESTROYED, handler),
    offError: (handler) => socket.off(SERVER_EVENTS.ERROR, handler),
    emitCreateRoom: (payload: CreateRoomRequest) => socket.emit(CLIENT_EVENTS.CREATE_ROOM, payload),
    emitJoinRoom: (payload: JoinRoomRequest) => socket.emit(CLIENT_EVENTS.JOIN_ROOM, payload),
    emitLeaveRoom: (payload: LeaveRoomRequest) => socket.emit(CLIENT_EVENTS.LEAVE_ROOM, payload),
    emitResumeSession: (payload: ResumeSessionRequest) => socket.emit(CLIENT_EVENTS.RESUME_SESSION, payload),
    emitSignalOffer: (payload: SignalOfferRequest) => socket.emit(CLIENT_EVENTS.SIGNAL_OFFER, payload),
    emitSignalAnswer: (payload: SignalAnswerRequest) => socket.emit(CLIENT_EVENTS.SIGNAL_ANSWER, payload),
    emitSignalIce: (payload: SignalIceRequest) => socket.emit(CLIENT_EVENTS.SIGNAL_ICE, payload),
    disconnect: () => socket.disconnect(),
  }
}
