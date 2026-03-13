import {
  CLIENT_EVENT_NAMES,
  SERVER_EVENT_NAMES,
  SIGNALING_ERROR_CODES,
  type CreateRoomPayload,
  type HostReconnectGracePayload as SharedHostReconnectGracePayload,
  type JoinRoomPayload,
  type PeerJoinedPayload as SharedPeerJoinedPayload,
  type PeerLeftPayload as SharedPeerLeftPayload,
  type RoomCreatedPayload as SharedRoomCreatedPayload,
  type RoomDestroyedPayload as SharedRoomDestroyedPayload,
  type RoomDestroyedReason as SharedRoomDestroyedReason,
  type RoomJoinedPayload as SharedRoomJoinedPayload,
  type SocketErrorPayload as SharedSocketErrorPayload,
} from '@shared'

export const CLIENT_EVENTS = {
  CREATE_ROOM: CLIENT_EVENT_NAMES.CREATE_ROOM,
  JOIN_ROOM: CLIENT_EVENT_NAMES.JOIN_ROOM,
  LEAVE_ROOM: CLIENT_EVENT_NAMES.LEAVE_ROOM,
  ROOM_PASSWORD_UPDATE: CLIENT_EVENT_NAMES.ROOM_PASSWORD_UPDATE,
} as const

export const SERVER_EVENTS = {
  ROOM_CREATED: SERVER_EVENT_NAMES.ROOM_CREATED,
  ROOM_JOINED: SERVER_EVENT_NAMES.ROOM_JOINED,
  PEER_JOINED: SERVER_EVENT_NAMES.PEER_JOINED,
  PEER_LEFT: SERVER_EVENT_NAMES.PEER_LEFT,
  HOST_RECONNECT_GRACE: SERVER_EVENT_NAMES.HOST_RECONNECT_GRACE,
  ROOM_PASSWORD_UPDATED: SERVER_EVENT_NAMES.ROOM_PASSWORD_UPDATED,
  ROOM_DESTROYED: SERVER_EVENT_NAMES.ROOM_DESTROYED,
  ERROR: SERVER_EVENT_NAMES.ERROR,
} as const

export type ErrorCode =
  | typeof SIGNALING_ERROR_CODES.ROOM_NOT_FOUND
  | typeof SIGNALING_ERROR_CODES.ROOM_FULL
  | typeof SIGNALING_ERROR_CODES.ROOM_EXPIRED
  | typeof SIGNALING_ERROR_CODES.INVALID_PASSWORD
  | typeof SIGNALING_ERROR_CODES.RATE_LIMITED
  | 'UNKNOWN'

export type RoomDestroyedReason = SharedRoomDestroyedReason

export type LobbyStatus = 'idle' | 'submitting' | 'error'

export type LobbyMode = 'create' | 'join'

export type Screen = 'lobby' | 'room' | 'room-ended'

export type SocketState = 'connecting' | 'connected' | 'disconnected'

export interface Participant {
  participantId: string
  isHost: boolean
}

export type RoomCreatedPayload = SharedRoomCreatedPayload

export interface CreateRoomRequest extends Required<CreateRoomPayload> {}

export interface JoinRoomRequest extends Required<JoinRoomPayload> {}

export interface LeaveRoomRequest {
  roomId: string
}

export type RoomJoinedPayload = SharedRoomJoinedPayload

export type PeerJoinedPayload = SharedPeerJoinedPayload

export type PeerLeftPayload = SharedPeerLeftPayload

export type HostReconnectGracePayload = SharedHostReconnectGracePayload

export type SocketErrorPayload = SharedSocketErrorPayload

export type RoomDestroyedPayload = SharedRoomDestroyedPayload

export interface RoomSessionState {
  lobbyMode: LobbyMode
  roomIdInput: string
  passwordInput: string
  screen: Screen
  lobbyStatus: LobbyStatus
  errorMessage: string | null
  roomEndedMessage: string
  participantId: string | null
  activeRoomId: string | null
  participants: Participant[]
  participantCount: number
  hostReconnectGraceDeadlineAt: number | null
  socketState: SocketState
  copyFeedback: string | null
  joinRateLimitUntil: number | null
  joinRateLimitRoomId: string | null
}

export interface RoomSessionActions {
  setLobbyMode: (mode: LobbyMode) => void
  setRoomIdInput: (value: string) => void
  setPasswordInput: (value: string) => void
  submitLobby: () => void
  copyRoomId: () => Promise<void>
  leaveRoom: () => void
  backToLobby: () => void
}

export interface RoomSocketClient {
  onConnect: (handler: () => void) => void
  onDisconnect: (handler: () => void) => void
  onRoomCreated: (handler: (payload: RoomCreatedPayload) => void) => void
  onRoomJoined: (handler: (payload: RoomJoinedPayload) => void) => void
  onPeerJoined: (handler: (payload: PeerJoinedPayload) => void) => void
  onPeerLeft: (handler: (payload: PeerLeftPayload) => void) => void
  onHostReconnectGrace: (handler: (payload: HostReconnectGracePayload) => void) => void
  onRoomDestroyed: (handler: (payload: RoomDestroyedPayload) => void) => void
  onError: (handler: (payload: SocketErrorPayload) => void) => void
  offConnect: (handler: () => void) => void
  offDisconnect: (handler: () => void) => void
  offRoomCreated: (handler: (payload: RoomCreatedPayload) => void) => void
  offRoomJoined: (handler: (payload: RoomJoinedPayload) => void) => void
  offPeerJoined: (handler: (payload: PeerJoinedPayload) => void) => void
  offPeerLeft: (handler: (payload: PeerLeftPayload) => void) => void
  offHostReconnectGrace: (handler: (payload: HostReconnectGracePayload) => void) => void
  offRoomDestroyed: (handler: (payload: RoomDestroyedPayload) => void) => void
  offError: (handler: (payload: SocketErrorPayload) => void) => void
  emitCreateRoom: (payload: CreateRoomRequest) => void
  emitJoinRoom: (payload: JoinRoomRequest) => void
  emitLeaveRoom: (payload: LeaveRoomRequest) => void
  disconnect: () => void
}
