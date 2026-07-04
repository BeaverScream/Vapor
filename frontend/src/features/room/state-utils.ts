import type {
  ChatConnectionState,
  ChatMessage,
  Participant,
  PeerJoinedPayload,
  PeerLeftPayload,
  RoomCreatedPayload,
  RoomDestroyedReason,
  RoomJoinedPayload,
  RoomSessionState,
  SessionResumedPayload,
} from './types'
import { UI_COPY } from './constants'
import { hasParticipant } from './participant-utils'

export function createInitialRoomSessionState(screen: RoomSessionState['screen'] = 'lobby'): RoomSessionState {
  return {
    lobbyMode: 'create',
    roomIdInput: '',
    roomNameInput: '',
    passwordInput: '',
    nicknameInput: '',
    screen,
    lobbyStatus: 'idle',
    errorMessage: null,
    roomEndedMessage: UI_COPY.ROOM_ENDED,
    participantId: null,
    activeRoomId: null,
    activeRoomName: null,
    hostId: null,
    expiresAt: null,
    soloDeadlineAt: null,
    participants: [],
    participantCount: 0,
    chatMessages: [],
    chatDraft: '',
    chatConnectionState: 'idle',
    connectedPeerCount: 0,
    hostReconnectGraceDeadlineAt: null,
    socketState: 'connecting',
    copyFeedback: null,
    joinRateLimitUntil: null,
    joinRateLimitRoomId: null,
    participantNicknames: {},
    hasPassword: false,
    typingPeerIds: [],
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
    ...clearSessionFields(),
    lobbyStatus: 'idle',
    errorMessage: null,
    screen: 'room',
    participantId: payload.participantId,
    activeRoomId: payload.roomId,
    activeRoomName: payload.roomName ?? null,
    hostId: payload.hostId,
    expiresAt: payload.expiresAt,
    soloDeadlineAt: payload.soloDeadlineAt ?? null,
    participants: [{ participantId: payload.participantId, isHost: payload.participantId === payload.hostId }],
    participantCount: payload.participantCount,
    participantNicknames: payload.participantNickname
      ? { [payload.participantId]: payload.participantNickname }
      : {},
    hasPassword: payload.hasPassword ?? false,
  }
}

export function withRoomJoined(state: RoomSessionState, payload: RoomJoinedPayload): RoomSessionState {
  const nextParticipants: Participant[] = payload.peers.map((participant) => ({
    participantId: participant.participantId,
    isHost: participant.participantId === payload.hostId,
  }))

  if (!hasParticipant(nextParticipants, payload.participantId)) {
    nextParticipants.push({ participantId: payload.participantId, isHost: payload.participantId === payload.hostId })
  }

  const participantNicknames: Record<string, string> = payload.participantNickname
    ? { [payload.participantId]: payload.participantNickname }
    : {}
  for (const peer of payload.peers) {
    if (peer.nickname) {
      participantNicknames[peer.participantId] = peer.nickname
    }
  }

  return {
    ...state,
    ...clearSessionFields(),
    lobbyStatus: 'idle',
    errorMessage: null,
    screen: 'room',
    participantId: payload.participantId,
    activeRoomId: payload.roomId,
    activeRoomName: payload.roomName ?? null,
    hostId: payload.hostId,
    expiresAt: payload.expiresAt,
    soloDeadlineAt: payload.soloDeadlineAt ?? null,
    participants: nextParticipants,
    participantCount: payload.participantCount,
    chatConnectionState: nextParticipants.length > 1 ? 'connecting' : 'idle',
    participantNicknames,
    hasPassword: payload.hasPassword ?? false,
  }
}

export function withSessionResumed(state: RoomSessionState, payload: SessionResumedPayload): RoomSessionState {
  // Strict superset of the join transition: the grace deadline is applied after so
  // it overrides the null that clearSessionFields (inside withRoomJoined) writes.
  return {
    ...withRoomJoined(state, payload),
    hostReconnectGraceDeadlineAt: payload.hostReconnectGraceDeadlineAt ?? null,
  }
}

export function withPeerJoined(state: RoomSessionState, payload: PeerJoinedPayload): RoomSessionState {
  const participants = hasParticipant(state.participants, payload.participantId)
    ? state.participants
    : [...state.participants, { participantId: payload.participantId, isHost: payload.participantId === state.hostId }]

  const participantNicknames = payload.nickname
    ? { ...state.participantNicknames, [payload.participantId]: payload.nickname }
    : state.participantNicknames

  return {
    ...state,
    participants,
    participantCount: payload.participantCount,
    soloDeadlineAt: null,
    participantNicknames,
  }
}

export function withPeerLeft(state: RoomSessionState, payload: PeerLeftPayload): RoomSessionState {
  return {
    ...state,
    participants: state.participants.filter((participant) => participant.participantId !== payload.participantId),
    participantCount: payload.participantCount,
  }
}

export function withChatDraft(state: RoomSessionState, chatDraft: string): RoomSessionState {
  return {
    ...state,
    chatDraft,
  }
}

export function withAppendedChatMessage(state: RoomSessionState, message: ChatMessage): RoomSessionState {
  // Idempotent by messageId: a message already present (e.g. a restored snapshot
  // entry, or a StrictMode double-invoke) is never appended twice (VP-10.4).
  if (state.chatMessages.some((existing) => existing.messageId === message.messageId)) {
    return state
  }
  return {
    ...state,
    chatMessages: [...state.chatMessages, message],
  }
}

export function withConnectedPeerCount(state: RoomSessionState, connectedPeerCount: number): RoomSessionState {
  return {
    ...state,
    connectedPeerCount,
  }
}

export function withChatConnectionState(
  state: RoomSessionState,
  chatConnectionState: ChatConnectionState,
): RoomSessionState {
  return {
    ...state,
    chatConnectionState,
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

function clearSessionFields(): Partial<RoomSessionState> {
  return {
    participantId: null,
    activeRoomId: null,
    activeRoomName: null,
    hostId: null,
    expiresAt: null,
    soloDeadlineAt: null,
    participants: [],
    participantCount: 0,
    chatMessages: [],
    chatDraft: '',
    chatConnectionState: 'idle',
    connectedPeerCount: 0,
    hostReconnectGraceDeadlineAt: null,
    roomIdInput: '',
    roomNameInput: '',
    passwordInput: '',
    nicknameInput: '',
    copyFeedback: null,
    joinRateLimitUntil: null,
    joinRateLimitRoomId: null,
    participantNicknames: {},
    hasPassword: false,
    typingPeerIds: [],
  }
}

export function withRoomEnded(state: RoomSessionState, reason?: string): RoomSessionState {
  return {
    ...state,
    ...clearSessionFields(),
    screen: 'room-ended',
    roomEndedMessage: roomEndedMessageFromReason(reason),
  }
}

export function resetToLobby(state: RoomSessionState): RoomSessionState {
  return {
    ...state,
    ...clearSessionFields(),
    lobbyMode: 'create',
    screen: 'lobby',
    lobbyStatus: 'idle',
    errorMessage: null,
    roomEndedMessage: UI_COPY.ROOM_ENDED,
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

export function withNicknameInput(state: RoomSessionState, nicknameInput: string): RoomSessionState {
  return {
    ...state,
    nicknameInput,
  }
}

export function withParticipantKicked(state: RoomSessionState, participantId: string): RoomSessionState {
  const participants = state.participants.filter((p) => p.participantId !== participantId)
  return {
    ...state,
    participants,
    participantCount: participants.length,
  }
}

export function withKickedFromRoom(state: RoomSessionState): RoomSessionState {
  return {
    ...withRoomEnded(state),
    roomEndedMessage: UI_COPY.KICKED_FROM_ROOM,
    lobbyMode: 'create',
    lobbyStatus: 'idle',
    errorMessage: null,
    roomIdInput: '',
  }
}

export function withRoomNameInput(state: RoomSessionState, roomNameInput: string): RoomSessionState {
  return {
    ...state,
    roomNameInput,
    lobbyStatus: state.lobbyStatus === 'error' ? 'idle' : state.lobbyStatus,
    errorMessage: state.lobbyStatus === 'error' ? null : state.errorMessage,
  }
}

export function withTypingStarted(state: RoomSessionState, participantId: string): RoomSessionState {
  if (state.typingPeerIds.includes(participantId)) return state
  return { ...state, typingPeerIds: [...state.typingPeerIds, participantId] }
}

export function withTypingStopped(state: RoomSessionState, participantId: string): RoomSessionState {
  if (!state.typingPeerIds.includes(participantId)) return state
  return { ...state, typingPeerIds: state.typingPeerIds.filter((id) => id !== participantId) }
}