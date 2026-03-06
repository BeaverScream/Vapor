import type {
  Participant,
  PeerJoinedPayload,
  PeerLeftPayload,
  RoomCreatedPayload,
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
    socketState: 'connecting',
    copyFeedback: null,
  }
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
    participants: [{ participantId: payload.participantId }],
    participantCount: payload.participantCount,
    copyFeedback: null,
  }
}

export function withRoomJoined(state: RoomSessionState, payload: RoomJoinedPayload): RoomSessionState {
  const nextParticipants: Participant[] = [...payload.peers, { participantId: payload.participantId }]

  return {
    ...state,
    lobbyStatus: 'idle',
    errorMessage: null,
    screen: 'room',
    participantId: payload.participantId,
    activeRoomId: payload.roomId,
    participants: nextParticipants,
    participantCount: payload.participantCount,
    copyFeedback: null,
  }
}

export function withPeerJoined(state: RoomSessionState, payload: PeerJoinedPayload): RoomSessionState {
  const participants = hasParticipant(state.participants, payload.participantId)
    ? state.participants
    : [...state.participants, { participantId: payload.participantId }]

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

export function withLobbyError(state: RoomSessionState, message: string): RoomSessionState {
  return {
    ...state,
    lobbyStatus: 'error',
    errorMessage: message,
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

export function withRoomEnded(state: RoomSessionState): RoomSessionState {
  return {
    ...state,
    screen: 'room-ended',
    roomEndedMessage: UI_COPY.ROOM_ENDED,
    participantId: null,
    activeRoomId: null,
    participants: [],
    participantCount: 0,
    passwordInput: '',
    copyFeedback: null,
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
    passwordInput: '',
    copyFeedback: null,
  }
}

export function withRoomIdInput(state: RoomSessionState, roomIdInput: string): RoomSessionState {
  return {
    ...state,
    roomIdInput,
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