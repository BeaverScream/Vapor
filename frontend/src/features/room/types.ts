export const CLIENT_EVENTS = {
  CREATE_ROOM: 'create_room',
  JOIN_ROOM: 'join_room',
  LEAVE_ROOM: 'leave_room',
} as const

export const SERVER_EVENTS = {
  ROOM_CREATED: 'room_created',
  ROOM_JOINED: 'room_joined',
  PEER_JOINED: 'peer_joined',
  PEER_LEFT: 'peer_left',
  ROOM_DESTROYED: 'room_destroyed',
  ERROR: 'error',
} as const

export type ErrorCode =
  | 'ROOM_NOT_FOUND'
  | 'ROOM_FULL'
  | 'ROOM_EXPIRED'
  | 'INVALID_PASSWORD'
  | 'RATE_LIMITED'
  | 'UNKNOWN'

export type LobbyStatus = 'idle' | 'submitting' | 'error'

export type LobbyMode = 'create' | 'join'

export type Screen = 'lobby' | 'room' | 'room-ended'

export type SocketState = 'connecting' | 'connected' | 'disconnected'

export interface Participant {
  participantId: string
}

export interface RoomCreatedPayload {
  roomId: string
  participantId: string
  reconnectToken: null
  expiresAt: null
  participantCount: number
}

export interface CreateRoomRequest {
  password: string
}

export interface JoinRoomRequest {
  roomId: string
  password: string
}

export interface LeaveRoomRequest {
  roomId: string
}

export interface RoomJoinedPayload {
  roomId: string
  participantId: string
  peers: Participant[]
  reconnectToken: null
  expiresAt: null
  participantCount: number
}

export interface PeerJoinedPayload {
  participantId: string
  participantCount: number
}

export interface PeerLeftPayload {
  participantId: string
  reason: 'disconnect'
  participantCount: number
}

export interface SocketErrorPayload {
  code?: string
}

export interface RoomDestroyedPayload {
  reason?: string
}

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
  socketState: SocketState
  copyFeedback: string | null
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
  onRoomDestroyed: (handler: (payload: RoomDestroyedPayload) => void) => void
  onError: (handler: (payload: SocketErrorPayload) => void) => void
  offConnect: (handler: () => void) => void
  offDisconnect: (handler: () => void) => void
  offRoomCreated: (handler: (payload: RoomCreatedPayload) => void) => void
  offRoomJoined: (handler: (payload: RoomJoinedPayload) => void) => void
  offPeerJoined: (handler: (payload: PeerJoinedPayload) => void) => void
  offPeerLeft: (handler: (payload: PeerLeftPayload) => void) => void
  offRoomDestroyed: (handler: (payload: RoomDestroyedPayload) => void) => void
  offError: (handler: (payload: SocketErrorPayload) => void) => void
  emitCreateRoom: (payload: CreateRoomRequest) => void
  emitJoinRoom: (payload: JoinRoomRequest) => void
  emitLeaveRoom: (payload: LeaveRoomRequest) => void
  disconnect: () => void
}
