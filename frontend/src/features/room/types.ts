import {
  CLIENT_EVENT_NAMES,
  SERVER_EVENT_NAMES,
  type SIGNALING_ERROR_CODES,
  type CreateRoomPayload,
  type HostReconnectGracePayload as SharedHostReconnectGracePayload,
  type JoinRoomPayload,
  type KickParticipantPayload as SharedKickParticipantPayload,
  type NicknameUpdatedPayload as SharedNicknameUpdatedPayload,
  type ParticipantKickedPayload as SharedParticipantKickedPayload,
  type PeerJoinedPayload as SharedPeerJoinedPayload,
  type PeerLeftPayload as SharedPeerLeftPayload,
  type ResumeSessionPayload as SharedResumeSessionPayload,
  type RoomCreatedPayload as SharedRoomCreatedPayload,
  type RoomDestroyedPayload as SharedRoomDestroyedPayload,
  type RoomDestroyedReason as SharedRoomDestroyedReason,
  type RoomJoinedPayload as SharedRoomJoinedPayload,
  type SocketErrorPayload as SharedSocketErrorPayload,
  type SignalAnswerPayload as SharedSignalAnswerPayload,
  type SignalAnswerRelayPayload as SharedSignalAnswerRelayPayload,
  type SignalIcePayload as SharedSignalIcePayload,
  type SignalIceRelayPayload as SharedSignalIceRelayPayload,
  type SignalOfferPayload as SharedSignalOfferPayload,
  type SignalOfferRelayPayload as SharedSignalOfferRelayPayload,
} from '@shared'

export const CLIENT_EVENTS = {
  CREATE_ROOM: CLIENT_EVENT_NAMES.CREATE_ROOM,
  JOIN_ROOM: CLIENT_EVENT_NAMES.JOIN_ROOM,
  LEAVE_ROOM: CLIENT_EVENT_NAMES.LEAVE_ROOM,
  SIGNAL_OFFER: CLIENT_EVENT_NAMES.SIGNAL_OFFER,
  SIGNAL_ANSWER: CLIENT_EVENT_NAMES.SIGNAL_ANSWER,
  SIGNAL_ICE: CLIENT_EVENT_NAMES.SIGNAL_ICE,
  RESUME_SESSION: CLIENT_EVENT_NAMES.RESUME_SESSION,
  ROOM_PASSWORD_UPDATE: CLIENT_EVENT_NAMES.ROOM_PASSWORD_UPDATE,
  KICK_PARTICIPANT: CLIENT_EVENT_NAMES.KICK_PARTICIPANT,
} as const

export const SERVER_EVENTS = {
  ROOM_CREATED: SERVER_EVENT_NAMES.ROOM_CREATED,
  ROOM_JOINED: SERVER_EVENT_NAMES.ROOM_JOINED,
  PEER_JOINED: SERVER_EVENT_NAMES.PEER_JOINED,
  PEER_LEFT: SERVER_EVENT_NAMES.PEER_LEFT,
  NICKNAME_UPDATED: SERVER_EVENT_NAMES.NICKNAME_UPDATED,
  SIGNAL_OFFER: SERVER_EVENT_NAMES.SIGNAL_OFFER,
  SIGNAL_ANSWER: SERVER_EVENT_NAMES.SIGNAL_ANSWER,
  SIGNAL_ICE: SERVER_EVENT_NAMES.SIGNAL_ICE,
  HOST_RECONNECT_GRACE: SERVER_EVENT_NAMES.HOST_RECONNECT_GRACE,
  ROOM_PASSWORD_UPDATED: SERVER_EVENT_NAMES.ROOM_PASSWORD_UPDATED,
  ROOM_DESTROYED: SERVER_EVENT_NAMES.ROOM_DESTROYED,
  PARTICIPANT_KICKED: SERVER_EVENT_NAMES.PARTICIPANT_KICKED,
  ERROR: SERVER_EVENT_NAMES.ERROR,
} as const

export type ErrorCode =
  | typeof SIGNALING_ERROR_CODES.ROOM_NOT_FOUND
  | typeof SIGNALING_ERROR_CODES.ROOM_FULL
  | typeof SIGNALING_ERROR_CODES.ROOM_EXPIRED
  | typeof SIGNALING_ERROR_CODES.INVALID_PASSWORD
  | typeof SIGNALING_ERROR_CODES.RATE_LIMITED
  | 'UNKNOWN'
  | typeof SIGNALING_ERROR_CODES.INVALID_SIGNAL_PAYLOAD

export type RoomDestroyedReason = SharedRoomDestroyedReason

export type LobbyStatus = 'idle' | 'submitting' | 'error'

export type LobbyMode = 'create' | 'join'

export type Screen = 'lobby' | 'room' | 'room-ended'

export type SocketState = 'connecting' | 'connected' | 'disconnected'

export interface Participant {
  participantId: string
  isHost: boolean
}

export type ChatConnectionState = 'idle' | 'connecting' | 'connected'

export interface ChatMessage {
  messageId: string
  senderParticipantId: string
  text: string
  sentAtMs: number
  direction: 'outgoing' | 'incoming' | 'system'
}

export type KickParticipantPayload = SharedKickParticipantPayload

export type ParticipantKickedPayload = SharedParticipantKickedPayload

export type NicknameUpdatedPayload = SharedNicknameUpdatedPayload

export type RoomCreatedPayload = SharedRoomCreatedPayload

export type SignalOfferPayload = SharedSignalOfferPayload

export type SignalAnswerPayload = SharedSignalAnswerPayload

export type SignalIcePayload = SharedSignalIcePayload

export type SignalOfferRelayPayload = SharedSignalOfferRelayPayload

export type SignalAnswerRelayPayload = SharedSignalAnswerRelayPayload

export type SignalIceRelayPayload = SharedSignalIceRelayPayload

export type SignalOfferRequest = Required<SignalOfferPayload>

export type SignalAnswerRequest = Required<SignalAnswerPayload>

export type SignalIceRequest = Required<SignalIcePayload>

export type ResumeSessionPayload = SharedResumeSessionPayload

export type ResumeSessionRequest = Required<ResumeSessionPayload>

export type CreateRoomRequest = Required<CreateRoomPayload>

export type JoinRoomRequest = Required<JoinRoomPayload>

export interface LeaveRoomRequest {
  roomId: string
}

export type KickParticipantRequest = Required<KickParticipantPayload>

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
  nicknameInput: string
  screen: Screen
  lobbyStatus: LobbyStatus
  errorMessage: string | null
  roomEndedMessage: string
  participantId: string | null
  activeRoomId: string | null
  expiresAt: number | null
  soloHostDeadlineAt: number | null
  participants: Participant[]
  participantCount: number
  chatMessages: ChatMessage[]
  chatDraft: string
  chatConnectionState: ChatConnectionState
  connectedPeerCount: number
  hostReconnectGraceDeadlineAt: number | null
  socketState: SocketState
  copyFeedback: string | null
  joinRateLimitUntil: number | null
  joinRateLimitRoomId: string | null
  participantNicknames: Record<string, string>
  hasPassword: boolean
  typingPeerIds: string[]
}

export interface RoomSessionActions {
  setLobbyMode: (mode: LobbyMode) => void
  setRoomIdInput: (value: string) => void
  setPasswordInput: (value: string) => void
  setNicknameInput: (value: string) => void
  submitLobby: () => void
  copyRoomId: () => Promise<void>
  leaveRoom: () => void
  backToLobby: () => void
  setChatDraft: (value: string) => void
  sendChatMessage: (messageText?: string) => void
  kickParticipant: (targetParticipantId: string) => void
  notifyTypingStart: () => void
  notifyTypingStop: () => void
}

export interface RoomSocketClient {
  onConnect: (handler: () => void) => void
  onDisconnect: (handler: () => void) => void
  onRoomCreated: (handler: (payload: RoomCreatedPayload) => void) => void
  onRoomJoined: (handler: (payload: RoomJoinedPayload) => void) => void
  onPeerJoined: (handler: (payload: PeerJoinedPayload) => void) => void
  onPeerLeft: (handler: (payload: PeerLeftPayload) => void) => void
  onHostReconnectGrace: (handler: (payload: HostReconnectGracePayload) => void) => void
  onNicknameUpdated: (handler: (payload: NicknameUpdatedPayload) => void) => void
  onParticipantKicked: (handler: (payload: ParticipantKickedPayload) => void) => void
  onRoomDestroyed: (handler: (payload: RoomDestroyedPayload) => void) => void
  onError: (handler: (payload: SocketErrorPayload) => void) => void
  onSignalOffer: (handler: (payload: SignalOfferRelayPayload) => void) => void
  onSignalAnswer: (handler: (payload: SignalAnswerRelayPayload) => void) => void
  onSignalIce: (handler: (payload: SignalIceRelayPayload) => void) => void
  offConnect: (handler: () => void) => void
  offDisconnect: (handler: () => void) => void
  offRoomCreated: (handler: (payload: RoomCreatedPayload) => void) => void
  offRoomJoined: (handler: (payload: RoomJoinedPayload) => void) => void
  offPeerJoined: (handler: (payload: PeerJoinedPayload) => void) => void
  offPeerLeft: (handler: (payload: PeerLeftPayload) => void) => void
  offHostReconnectGrace: (handler: (payload: HostReconnectGracePayload) => void) => void
  offNicknameUpdated: (handler: (payload: NicknameUpdatedPayload) => void) => void
  offParticipantKicked: (handler: (payload: ParticipantKickedPayload) => void) => void
  offRoomDestroyed: (handler: (payload: RoomDestroyedPayload) => void) => void
  offError: (handler: (payload: SocketErrorPayload) => void) => void
  offSignalOffer: (handler: (payload: SignalOfferRelayPayload) => void) => void
  offSignalAnswer: (handler: (payload: SignalAnswerRelayPayload) => void) => void
  offSignalIce: (handler: (payload: SignalIceRelayPayload) => void) => void
  emitCreateRoom: (payload: CreateRoomRequest) => void
  emitJoinRoom: (payload: JoinRoomRequest) => void
  emitLeaveRoom: (payload: LeaveRoomRequest) => void
  emitResumeSession: (payload: ResumeSessionRequest) => void
  emitKickParticipant: (payload: KickParticipantRequest) => void
  emitSignalOffer: (payload: SignalOfferRequest) => void
  emitSignalAnswer: (payload: SignalAnswerRequest) => void
  emitSignalIce: (payload: SignalIceRequest) => void
  disconnect: () => void
}
