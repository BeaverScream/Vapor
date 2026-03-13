import type {
  Participant,
  PeerJoinedPayload,
  PeerLeftPayload,
  RoomCreatedPayload,
  RoomDestroyedReason,
  RoomJoinedPayload,
  RoomSessionState,
} from './types'
import { UI_COPY } from './constants'
import { hasParticipant } from './participant-utils'

export function createInitialRoomSessionState(): RoomSessionState {
  return {
    lobbyMode: 'create',
    roomIdInput: '',
    passwordInput: '',
    screen: 'lobby',
    lobbyStatus: 'idle',
    errorMessage: null,
    roomEndedMessage: UI_COPY.ROOM_ENDED,
    participantId: null,
    activeRoomId: null,
    participants: [],
    participantCount: 0,
    hostReconnectGraceDeadlineAt: null,
    socketState: 'connecting',
    copyFeedback: null,
    joinRateLimitUntil: null,
    joinRateLimitRoomId: null,
  }
}

function deriveHostParticipantId(state: RoomSessionState, payload: RoomJoinedPayload): string | null {
  const existingHostParticipantId = state.participants.find((participant) => participant.isHost)?.participantId

  if (existingHostParticipantId) {
    return existingHostParticipantId
  }

  if (payload.peers.length === 1) {
    return payload.peers[0]?.participantId ?? null
  }

  if (payload.peers.length > 1) {
    return payload.peers[0]?.participantId ?? null
  }

  return payload.participantId
}

export function withSocketState(state: RoomSessionState, socketState: RoomSessionState['socketState']): RoomSessionState {
  return {
    ...state,
    socketState,
  }
}

export function withRoomCreated(state: RoomSessionState, payload: RoomCreatedPayload): RoomSessionState {
  return {
    ...state,
    lobbyStatus: 'idle',
    errorMessage: null,
    screen: 'room',
    participantId: payload.participantId,
    activeRoomId: payload.roomId,
    participants: [{ participantId: payload.participantId, isHost: true }],
    participantCount: payload.participantCount,
    hostReconnectGraceDeadlineAt: null,
    copyFeedback: null,
    joinRateLimitUntil: null,
    joinRateLimitRoomId: null,
  }
}

export function withRoomJoined(state: RoomSessionState, payload: RoomJoinedPayload): RoomSessionState {
  const hostParticipantId = deriveHostParticipantId(state, payload)

  const nextParticipants: Participant[] = payload.peers.map((participant) => ({
    participantId: participant.participantId,
    isHost: participant.participantId === hostParticipantId,
  }))

  if (!hasParticipant(nextParticipants, payload.participantId)) {
    nextParticipants.push({ participantId: payload.participantId, isHost: payload.participantId === hostParticipantId })
  }

  return {
    ...state,
    lobbyStatus: 'idle',
    errorMessage: null,
    screen: 'room',
    participantId: payload.participantId,
    activeRoomId: payload.roomId,
    participants: nextParticipants,
    participantCount: payload.participantCount,
    hostReconnectGraceDeadlineAt: null,
    copyFeedback: null,
    joinRateLimitUntil: null,
    joinRateLimitRoomId: null,
  }
}

export function withPeerJoined(state: RoomSessionState, payload: PeerJoinedPayload): RoomSessionState {
  const participants = hasParticipant(state.participants, payload.participantId)
    ? state.participants
    : [...state.participants, { participantId: payload.participantId, isHost: false }]

  return {
    ...state,
    participants,
    participantCount: payload.participantCount,
  }
}

export function withPeerLeft(state: RoomSessionState, payload: PeerLeftPayload): RoomSessionState {
  return {
    ...state,
    participants: state.participants.filter((participant) => participant.participantId !== payload.participantId),
    participantCount: payload.participantCount,
  }
}

export function withHostReconnectGrace(state: RoomSessionState, deadlineAt: number): RoomSessionState {
  return {
    ...state,
    hostReconnectGraceDeadlineAt: deadlineAt,
  }
}

export function withLobbyError(state: RoomSessionState, message: string): RoomSessionState {
  return {
    ...state,
    lobbyStatus: 'error',
    errorMessage: message,
  }
}

export function withJoinRateLimited(
  state: RoomSessionState,
  joinRateLimitUntil: number,
  joinRateLimitRoomId: string,
  message: string,
): RoomSessionState {
  return {
    ...state,
    lobbyStatus: 'error',
    errorMessage: message,
    joinRateLimitUntil,
    joinRateLimitRoomId,
  }
}

export function withJoinRateLimitCleared(state: RoomSessionState): RoomSessionState {
  return {
    ...state,
    lobbyStatus: state.lobbyStatus === 'error' ? 'idle' : state.lobbyStatus,
    errorMessage: state.lobbyStatus === 'error' ? null : state.errorMessage,
    joinRateLimitUntil: null,
    joinRateLimitRoomId: null,
  }
}

export function withLobbySubmitting(state: RoomSessionState): RoomSessionState {
  return {
    ...state,
    lobbyStatus: 'submitting',
    errorMessage: null,
  }
}

export function withCopyFeedback(state: RoomSessionState, feedback: string | null): RoomSessionState {
  return {
    ...state,
    copyFeedback: feedback,
  }
}

export function roomEndedMessageFromReason(reason?: string): string {
  switch (reason as RoomDestroyedReason | undefined) {
    case 'host_left':
      return UI_COPY.ROOM_ENDED_HOST_LEFT
    case 'host_grace_expired':
      return UI_COPY.ROOM_ENDED_HOST_GRACE_EXPIRED
    case 'room_ttl_expired':
      return UI_COPY.ROOM_ENDED_TTL_EXPIRED
    case 'solo_timeout_expired':
      return UI_COPY.ROOM_ENDED_SOLO_TIMEOUT_EXPIRED
    default:
      return UI_COPY.ROOM_ENDED
  }
}

export function withRoomEnded(state: RoomSessionState, reason?: string): RoomSessionState {
  return {
    ...state,
    screen: 'room-ended',
    roomEndedMessage: roomEndedMessageFromReason(reason),
    participantId: null,
    activeRoomId: null,
    participants: [],
    participantCount: 0,
    hostReconnectGraceDeadlineAt: null,
    passwordInput: '',
    copyFeedback: null,
    joinRateLimitUntil: null,
    joinRateLimitRoomId: null,
  }
}

export function resetToLobby(state: RoomSessionState): RoomSessionState {
  return {
    ...state,
    lobbyMode: 'create',
    screen: 'lobby',
    lobbyStatus: 'idle',
    errorMessage: null,
    roomEndedMessage: UI_COPY.ROOM_ENDED,
    participantId: null,
    activeRoomId: null,
    participants: [],
    participantCount: 0,
    hostReconnectGraceDeadlineAt: null,
    passwordInput: '',
    copyFeedback: null,
    joinRateLimitUntil: null,
    joinRateLimitRoomId: null,
  }
}

export function withRoomIdInput(state: RoomSessionState, roomIdInput: string): RoomSessionState {
  return {
    ...state,
    roomIdInput,
    lobbyStatus: state.lobbyStatus === 'error' ? 'idle' : state.lobbyStatus,
    errorMessage: state.lobbyStatus === 'error' ? null : state.errorMessage,
  }
}

export function withLobbyMode(state: RoomSessionState, lobbyMode: RoomSessionState['lobbyMode']): RoomSessionState {
  return {
    ...state,
    lobbyMode,
    roomIdInput: lobbyMode === 'create' ? '' : state.roomIdInput,
    lobbyStatus: 'idle',
    errorMessage: null,
  }
}

export function withPasswordInput(state: RoomSessionState, passwordInput: string): RoomSessionState {
  return {
    ...state,
    passwordInput,
  }
}