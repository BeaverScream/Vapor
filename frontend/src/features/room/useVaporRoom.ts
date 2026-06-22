import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { JOIN_RATE_LIMIT_COOLDOWN_MS, UI_COPY } from './constants'
import { getErrorMessage, getJoinRateLimitedMessage, mapErrorCode } from './error-copy'
import { SIGNALING_ERROR_CODES } from '@shared'
import { getConnectionStatusText, getRoomStatus } from './participant-utils'
import { createRoomSocketClient } from './room-socket-client'
import {
  withAppendedChatMessage,
  withChatConnectionState,
  withChatDraft,
  withConnectedPeerCount,
  createInitialRoomSessionState,
  resetToLobby,
  withCopyFeedback,
  withHostReconnectGrace,
  withKickedFromRoom,
  withLobbyError,
  withLobbyMode,
  withLobbySubmitting,
  withJoinRateLimited,
  withNicknameInput,
  withNicknameUpdated,
  withParticipantKicked,
  withPasswordInput,
  withPeerJoined,
  withPeerLeft,
  withRoomCreated,
  withRoomEnded,
  withRoomIdInput,
  withRoomNameInput,
  withRoomJoined,
  withSocketState,
} from './state-utils'
import { VaporWebRtcChatMesh, type WebRtcTelemetryEvent } from './webrtc-chat-mesh'
import type {
  ChatConnectionState,
  HostReconnectGracePayload,
  LobbyMode,
  NicknameUpdatedPayload,
  ParticipantKickedPayload,
  PeerJoinedPayload,
  PeerLeftPayload,
  RoomCreatedPayload,
  RoomDestroyedPayload,
  RoomJoinedPayload,
  RoomSocketClient,
  RoomSessionActions,
  RoomSessionState,
  SignalAnswerRelayPayload,
  SignalIceRelayPayload,
  SignalOfferRelayPayload,
  SocketErrorPayload,
} from './types'
import {
  useSessionPersistence,
  readStoredReconnectSession,
  clearStoredReconnectSession,
} from './hooks/useSessionPersistence'
import { useJoinRateLimit } from './hooks/useJoinRateLimit'
import { useTypingIndicator } from './hooks/useTypingIndicator'
import { useChatMessaging, createChatMessage } from './hooks/useChatMessaging'
import { useSocketConnection } from './hooks/useSocketConnection'
import { useNotifications } from '../../lib/useNotifications'

const COPY_FEEDBACK_MS = 1800

const createDefaultSocketClient = (): RoomSocketClient => createRoomSocketClient()
const writeDefaultClipboardText = (value: string): Promise<void> =>
  navigator.clipboard.writeText(value)

function getChatStatusText(
  chatConnectionState: ChatConnectionState,
  connectedPeerCount: number,
  participantCount: number,
): string {
  if (chatConnectionState === 'connected' && connectedPeerCount > 0) {
    return `Private peer chat live with ${connectedPeerCount} connection${connectedPeerCount === 1 ? '' : 's'}.`
  }
  if (participantCount <= 1) {
    return 'Waiting for peers to join before chat starts.'
  }
  return 'Preparing encrypted peer channels for chat…'
}

function emitSafeWebRtcTelemetry(event: WebRtcTelemetryEvent): void {
  window.dispatchEvent(new CustomEvent('vapor:webrtc-state', { detail: event }))
}

export function getSoloWaitingText(soloHostDeadlineAt: number | null, nowMs: number): string | null {
  if (!soloHostDeadlineAt) return null
  const remainingMs = Math.max(soloHostDeadlineAt - nowMs, 0)
  if (remainingMs <= 0) return null
  const totalSeconds = Math.ceil(remainingMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  const countdown =
    minutes >= 10
      ? `${minutes}m`
      : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  return `${UI_COPY.SOLO_HOST_WARNING} ${countdown}`
}

export function getLifetimeText(expiresAt: number | null, nowMs: number): string | null {
  if (!expiresAt) return null
  const remainingMs = Math.max(expiresAt - nowMs, 0)
  if (remainingMs <= 0) return null
  const totalSeconds = Math.floor(remainingMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes >= 10) return `Ends in ${minutes}m`
  return `Ends in ${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
}

interface UseVaporRoomDependencies {
  createSocketClient?: () => RoomSocketClient
  writeClipboardText?: (value: string) => Promise<void>
}

export function useVaporRoom(dependencies: UseVaporRoomDependencies = {}): {
  state: RoomSessionState
  actions: RoomSessionActions
  derived: {
    lobbyMode: RoomSessionState['lobbyMode']
    primaryActionLabel: string
    isPrimaryDisabled: boolean
    joinRateLimitHint: string | null
    roomStatus: string
    connectionText: string
    expiresAt: number | null
    soloHostDeadlineAt: number | null
    chatStatusText: string
  }
} {
  const {
    createSocketClient = createDefaultSocketClient,
    writeClipboardText = writeDefaultClipboardText,
  } = dependencies

  const createSocketClientRef = useRef(createSocketClient)
  createSocketClientRef.current = createSocketClient

  const writeClipboardTextRef = useRef(writeClipboardText)
  writeClipboardTextRef.current = writeClipboardText

  const [state, setState] = useState<RoomSessionState>(() =>
    createInitialRoomSessionState(readStoredReconnectSession() !== null ? 'reconnecting' : 'lobby'),
  )
  const stateRef = useRef(state)
  stateRef.current = state
  const socketStateRef = useRef<RoomSessionState['socketState']>('connecting')
  socketStateRef.current = state.socketState

  // Declared early so createPeerMesh and event handlers can close over it safely
  const socketRef = useRef<RoomSocketClient | null>(null)
  const resumeInFlightRef = useRef(false)
  const autoResumeRequestedRef = useRef(false)

  const peerMeshRef = useRef<VaporWebRtcChatMesh | null>(null)

  // Sub-hooks
  const persistence = useSessionPersistence()
  const { joinRateLimitRemainingMs, isJoinRateLimited } = useJoinRateLimit(state, setState)
  const { requestPermission, notifyNewMessage } = useNotifications()

  const disposePeerMesh = useCallback((): void => {
    peerMeshRef.current?.dispose()
    peerMeshRef.current = null
  }, [])

  const typing = useTypingIndicator(peerMeshRef, setState)
  const chat = useChatMessaging(peerMeshRef, stateRef, setState, typing.notifyTypingStop)

  const clearRoomSession = useCallback((): void => {
    disposePeerMesh()
    chat.clearPending()
    typing.clearAll()
    resumeInFlightRef.current = false
    autoResumeRequestedRef.current = false
  }, [disposePeerMesh, chat.clearPending, typing.clearAll])

  const createPeerMesh = useCallback(
    (roomId: string, participantId: string): VaporWebRtcChatMesh => {
      disposePeerMesh()
      const peerMesh = new VaporWebRtcChatMesh({
        roomId,
        participantId,
        signalingEmitter: {
          emitSignalOffer: (payload) => socketRef.current?.emitSignalOffer(payload),
          emitSignalAnswer: (payload) => socketRef.current?.emitSignalAnswer(payload),
          emitSignalIce: (payload) => socketRef.current?.emitSignalIce(payload),
        },
        onRemoteMessage: chat.onRemoteMessage,
        onRemoteTypingStatus: typing.onRemoteTypingStatus,
        onNewMessage: notifyNewMessage,
        onConnectedPeerCountChange: (connectedPeerCount) => {
          setState((previous) => {
            let nextState = withConnectedPeerCount(previous, connectedPeerCount)
            if (connectedPeerCount > 0) {
              nextState = withChatConnectionState(nextState, 'connected')
              chat.flushPendingMessages()
              return nextState
            }
            nextState = withChatConnectionState(
              nextState,
              nextState.participantCount > 1 ? 'connecting' : 'idle',
            )
            return nextState
          })
        },
        onTelemetryEvent: emitSafeWebRtcTelemetry,
      })
      peerMeshRef.current = peerMesh
      return peerMesh
    },
    [disposePeerMesh, chat.onRemoteMessage, typing.onRemoteTypingStatus, chat.flushPendingMessages, notifyNewMessage],
  )

  // Socket event handlers — all close over stable refs only
  const onConnect = useCallback((): void => {
    const storedSession = persistence.readStoredReconnectSession()
    const shouldAttemptResume =
      Boolean(storedSession) &&
      !resumeInFlightRef.current &&
      socketStateRef.current !== 'connected'

    setState((previous) => withSocketState(previous, 'connected'))

    if (!shouldAttemptResume || !storedSession) return

    resumeInFlightRef.current = true
    autoResumeRequestedRef.current = true
    socketRef.current?.emitResumeSession(storedSession)
  }, [persistence.readStoredReconnectSession])

  const onDisconnect = useCallback((): void => {
    resumeInFlightRef.current = false
    setState((previous) => withSocketState(previous, 'disconnected'))
  }, [])

  const onRoomCreated = useCallback(
    (payload: RoomCreatedPayload): void => {
      persistence.writeStoredReconnectSession({
        roomId: payload.roomId,
        reconnectToken: payload.reconnectToken,
      })
      resumeInFlightRef.current = false
      autoResumeRequestedRef.current = false
      setState((previous) => withRoomCreated(previous, payload))
      createPeerMesh(payload.roomId, payload.participantId)
      requestPermission()
    },
    [persistence.writeStoredReconnectSession, createPeerMesh, requestPermission],
  )

  const onRoomJoined = useCallback(
    (payload: RoomJoinedPayload): void => {
      persistence.writeStoredReconnectSession({
        roomId: payload.roomId,
        reconnectToken: payload.reconnectToken,
      })
      resumeInFlightRef.current = false
      autoResumeRequestedRef.current = false
      setState((previous) => withRoomJoined(previous, payload))
      const peerMesh = createPeerMesh(payload.roomId, payload.participantId)
      peerMesh.syncPeers(payload.peers.map((peer) => peer.participantId))
      requestPermission()
    },
    [persistence.writeStoredReconnectSession, createPeerMesh, requestPermission],
  )

  const onPeerJoined = useCallback((payload: PeerJoinedPayload): void => {
    setState((previous) => {
      let nextState = withPeerJoined(previous, payload)
      if (payload.participantId === previous.hostId && previous.hostReconnectGraceDeadlineAt !== null) {
        nextState = { ...nextState, hostReconnectGraceDeadlineAt: null }
      }
      const name = payload.nickname ?? previous.participantNicknames[payload.participantId] ?? payload.participantId.slice(0, 8)
      nextState = withAppendedChatMessage(nextState, createChatMessage(payload.participantId, `${name} joined`, 'system'))
      if (nextState.connectedPeerCount === 0 && nextState.participantCount > 1) {
        return withChatConnectionState(nextState, 'connecting')
      }
      return nextState
    })
    peerMeshRef.current?.handlePeerJoined(payload.participantId)
  }, [])

  const onPeerLeft = useCallback((payload: PeerLeftPayload): void => {
    peerMeshRef.current?.handlePeerLeft(payload.participantId)
    setState((previous) => {
      const name = previous.participantNicknames[payload.participantId] ?? payload.participantId.slice(0, 8)
      const action = payload.reason === 'disconnect' ? 'disconnected' : 'left'
      let nextState = withAppendedChatMessage(withPeerLeft(previous, payload), createChatMessage(payload.participantId, `${name} ${action}`, 'system'))
      if (payload.soloHostDeadlineAt !== undefined && payload.soloHostDeadlineAt !== null) {
        nextState = { ...nextState, soloHostDeadlineAt: payload.soloHostDeadlineAt }
      }
      if (nextState.participantCount <= 1) {
        chat.pendingMessagesRef.current = []
        nextState = withConnectedPeerCount(nextState, 0)
        nextState = withChatConnectionState(nextState, 'idle')
        return nextState
      }
      if (nextState.connectedPeerCount === 0) {
        nextState = withChatConnectionState(nextState, 'connecting')
      }
      return nextState
    })
  }, [chat.pendingMessagesRef])

  const onSignalOffer = useCallback(
    (payload: SignalOfferRelayPayload): void => {
      void peerMeshRef.current?.handleSignalOffer(payload)
    },
    [],
  )

  const onSignalAnswer = useCallback(
    (payload: SignalAnswerRelayPayload): void => {
      void peerMeshRef.current?.handleSignalAnswer(payload)
    },
    [],
  )

  const onSignalIce = useCallback(
    (payload: SignalIceRelayPayload): void => {
      void peerMeshRef.current?.handleSignalIce(payload)
    },
    [],
  )

  const onNicknameUpdated = useCallback((payload: NicknameUpdatedPayload): void => {
    setState((previous) => {
      const isLocalUser = previous.participantId === payload.participantId
      const oldName = previous.participantNicknames[payload.participantId] ?? payload.participantId
      const actor = isLocalUser ? 'You' : oldName
      const verb = isLocalUser ? 'your' : 'their'
      const systemMessage = createChatMessage(
        payload.participantId,
        `${actor} changed ${verb} name to "${payload.nickname}"`,
        'system',
      )
      return withAppendedChatMessage(withNicknameUpdated(previous, payload), systemMessage)
    })
  }, [])

  const onParticipantKicked = useCallback(
    (payload: ParticipantKickedPayload): void => {
      if (payload.participantId === stateRef.current.participantId) {
        clearStoredReconnectSession()
        clearRoomSession()
        socketRef.current?.disconnect()
        setTimeout(() => socketRef.current?.connect(), 0)
        setState((previous) => withKickedFromRoom(previous))
      } else {
        peerMeshRef.current?.handlePeerLeft(payload.participantId)
        setState((previous) => withParticipantKicked(previous, payload.participantId))
      }
    },
    [clearRoomSession],
  )

  const onHostReconnectGrace = useCallback((payload: HostReconnectGracePayload): void => {
    setState((previous) => withHostReconnectGrace(previous, payload.deadlineAt))
  }, [])

  const onRoomDestroyed = useCallback(
    (payload: RoomDestroyedPayload): void => {
      clearStoredReconnectSession()
      clearRoomSession()
      setState((previous) => withRoomEnded(previous, payload.reason))
    },
    [clearRoomSession],
  )

  const onError = useCallback((payload: SocketErrorPayload): void => {
    setState((previous) => {
      const errorCode = mapErrorCode(payload.code)

      if (autoResumeRequestedRef.current) {
        autoResumeRequestedRef.current = false
        resumeInFlightRef.current = false

        if (
          errorCode === SIGNALING_ERROR_CODES.ROOM_NOT_FOUND ||
          errorCode === SIGNALING_ERROR_CODES.INVALID_PASSWORD ||
          errorCode === SIGNALING_ERROR_CODES.RATE_LIMITED
        ) {
          clearStoredReconnectSession()
          return resetToLobby(previous)
        }
      }

      if (errorCode === SIGNALING_ERROR_CODES.RATE_LIMITED && previous.lobbyMode === 'join') {
        return withJoinRateLimited(
          previous,
          Date.now() + JOIN_RATE_LIMIT_COOLDOWN_MS,
          previous.roomIdInput,
          getJoinRateLimitedMessage(JOIN_RATE_LIMIT_COOLDOWN_MS),
        )
      }

      if (errorCode === SIGNALING_ERROR_CODES.INVALID_PASSWORD && previous.lobbyMode === 'join') {
        return { ...withLobbyError(previous, getErrorMessage(errorCode)), hasPassword: true }
      }

      if (
        errorCode === SIGNALING_ERROR_CODES.INVALID_SIGNAL_PAYLOAD &&
        previous.lobbyMode === 'create' &&
        previous.roomNameInput.trim().length > 0
      ) {
        return withLobbyError(previous, 'Room name already taken or invalid.')
      }

      return withLobbyError(previous, getErrorMessage(errorCode))
    })
  }, [])

  useSocketConnection(
    socketRef,
    createSocketClientRef,
    {
      onConnect,
      onDisconnect,
      onRoomCreated,
      onRoomJoined,
      onPeerJoined,
      onPeerLeft,
      onSignalOffer,
      onSignalAnswer,
      onSignalIce,
      onNicknameUpdated,
      onParticipantKicked,
      onHostReconnectGrace,
      onRoomDestroyed,
      onError,
    },
    clearRoomSession,
  )

  useEffect(() => {
    if (!state.copyFeedback) return
    const timeoutHandle = window.setTimeout(() => {
      setState((previous) => withCopyFeedback(previous, null))
    }, COPY_FEEDBACK_MS)
    return () => {
      window.clearTimeout(timeoutHandle)
    }
  }, [state.copyFeedback])

  // Stable setter callbacks
  const setLobbyMode = useCallback((mode: LobbyMode) => setState((prev) => withLobbyMode(prev, mode)), [])
  const setRoomIdInput = useCallback((value: string) => setState((prev) => withRoomIdInput(prev, value)), [])
  const setRoomNameInput = useCallback((value: string) => setState((prev) => withRoomNameInput(prev, value)), [])
  const setPasswordInput = useCallback((value: string) => setState((prev) => withPasswordInput(prev, value)), [])
  const setNicknameInput = useCallback((value: string) => setState((prev) => withNicknameInput(prev, value)), [])
  const setChatDraft = useCallback((value: string) => setState((prev) => withChatDraft(prev, value)), [])

  const submitLobby = useCallback((): void => {
    const s = stateRef.current
    const now = Date.now()
    const rateLimitRemainingMs = s.joinRateLimitUntil ? Math.max(s.joinRateLimitUntil - now, 0) : 0
    const rateLimited =
      s.lobbyMode === 'join' &&
      s.joinRateLimitRoomId !== null &&
      s.joinRateLimitRoomId === s.roomIdInput &&
      rateLimitRemainingMs > 0

    if (rateLimited) {
      setState((previous) => withLobbyError(previous, getJoinRateLimitedMessage(rateLimitRemainingMs)))
      return
    }

    if (s.socketState !== 'connected') {
      setState((previous) => withLobbyError(previous, UI_COPY.CONNECTING_RETRY))
      return
    }

    const socket = socketRef.current
    if (!socket) {
      setState((previous) => withLobbyError(previous, UI_COPY.GENERIC_ERROR))
      return
    }

    const trimmedNickname = s.nicknameInput.trim()
    if (trimmedNickname.length < 3) {
      setState((previous) => withLobbyError(previous, UI_COPY.INVALID_NICKNAME))
      return
    }

    if (s.lobbyMode === 'join' && s.hasPassword) {
      if (s.passwordInput.trim().length === 0) {
        setState((previous) =>
          withLobbyError(previous, getErrorMessage(SIGNALING_ERROR_CODES.INVALID_PASSWORD)),
        )
        return
      }
    }

    setState((previous) => withLobbySubmitting(previous))

    if (s.lobbyMode === 'create') {
      const trimmedRoomName = s.roomNameInput.trim()
      socket.emitCreateRoom({
        password: s.passwordInput,
        nickname: trimmedNickname,
        ...(trimmedRoomName.length > 0 ? { roomName: trimmedRoomName } : {}),
      })
      return
    }

    socket.emitJoinRoom({ roomId: s.roomIdInput, password: s.passwordInput, nickname: trimmedNickname })
  }, [])

  const copyRoomId = useCallback(async (): Promise<void> => {
    const roomId = stateRef.current.activeRoomId
    if (!roomId) return
    try {
      await writeClipboardTextRef.current(roomId)
      setState((previous) => withCopyFeedback(previous, 'Copied'))
    } catch {
      setState((previous) => withCopyFeedback(previous, 'Copy unavailable'))
    }
  }, [])

  const leaveRoom = useCallback((): void => {
    const socket = socketRef.current
    const roomId = stateRef.current.activeRoomId
    if (socket && roomId) {
      socket.emitLeaveRoom({ roomId })
    }
    clearStoredReconnectSession()
    clearRoomSession()
    setState((previous) => resetToLobby(previous))
  }, [clearRoomSession])

  const backToLobby = useCallback((): void => {
    clearStoredReconnectSession()
    clearRoomSession()
    setState((previous) => resetToLobby(previous))
  }, [clearRoomSession])

  const kickParticipant = useCallback((targetParticipantId: string): void => {
    const socket = socketRef.current
    const roomId = stateRef.current.activeRoomId
    if (!socket || !roomId) return
    socket.emitKickParticipant({ roomId, targetParticipantId })
  }, [])

  const primaryActionLabel = state.lobbyMode === 'create' ? 'Create room' : 'Join room'
  const isPrimaryDisabled = state.lobbyStatus === 'submitting' || isJoinRateLimited
  const joinRateLimitHint = isJoinRateLimited ? getJoinRateLimitedMessage(joinRateLimitRemainingMs) : null

  const roomStatus = useMemo(
    () => getRoomStatus(state.participantCount, state.hostReconnectGraceDeadlineAt),
    [state.hostReconnectGraceDeadlineAt, state.participantCount],
  )
  const connectionText = useMemo(() => getConnectionStatusText(state.socketState), [state.socketState])
  const chatStatusText = useMemo(
    () => getChatStatusText(state.chatConnectionState, state.connectedPeerCount, state.participantCount),
    [state.chatConnectionState, state.connectedPeerCount, state.participantCount],
  )
  const effectiveExpiresAt = useMemo(() => {
    const deadlines = [state.expiresAt, state.hostReconnectGraceDeadlineAt, state.soloHostDeadlineAt].filter(
      (d): d is number => d !== null,
    )
    return deadlines.length === 0 ? null : Math.min(...deadlines)
  }, [state.expiresAt, state.hostReconnectGraceDeadlineAt, state.soloHostDeadlineAt])

  const actions = useMemo<RoomSessionActions>(
    () => ({
      setLobbyMode,
      setRoomIdInput,
      setRoomNameInput,
      setPasswordInput,
      setNicknameInput,
      submitLobby,
      copyRoomId,
      setChatDraft,
      sendChatMessage: chat.sendChatMessage,
      leaveRoom,
      backToLobby,
      kickParticipant,
      notifyTypingStart: typing.notifyTypingStart,
      notifyTypingStop: typing.notifyTypingStop,
    }),
    [
      setLobbyMode,
      setRoomIdInput,
      setRoomNameInput,
      setPasswordInput,
      setNicknameInput,
      submitLobby,
      copyRoomId,
      setChatDraft,
      chat.sendChatMessage,
      leaveRoom,
      backToLobby,
      kickParticipant,
      typing.notifyTypingStart,
      typing.notifyTypingStop,
    ],
  )

  return {
    state,
    actions,
    derived: {
      lobbyMode: state.lobbyMode,
      primaryActionLabel,
      isPrimaryDisabled,
      joinRateLimitHint,
      roomStatus,
      connectionText,
      expiresAt: effectiveExpiresAt,
      soloHostDeadlineAt: null,
      chatStatusText,
    },
  }
}
