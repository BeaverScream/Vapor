import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { JOIN_RATE_LIMIT_COOLDOWN_MS, RECONNECT_SESSION_STORAGE_KEY, UI_COPY } from './constants'
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
  withJoinRateLimitCleared,
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
  withRoomJoined,
  withSocketState,
  withTypingStarted,
  withTypingStopped,
} from './state-utils'
import { VaporWebRtcChatMesh, type WebRtcTelemetryEvent } from './webrtc-chat-mesh'
import {
  type ChatConnectionState,
  type ChatMessage,
  type HostReconnectGracePayload,
  type LobbyMode,
  type NicknameUpdatedPayload,
  type ParticipantKickedPayload,
  type PeerJoinedPayload,
  type PeerLeftPayload,
  type RoomCreatedPayload,
  type RoomDestroyedPayload,
  type RoomJoinedPayload,
  type RoomSocketClient,
  type RoomSessionActions,
  type RoomSessionState,
  type SignalAnswerRelayPayload,
  type SignalIceRelayPayload,
  type SignalOfferRelayPayload,
  type SocketErrorPayload,
} from './types'

const COPY_FEEDBACK_MS = 1800

const createDefaultSocketClient = (): RoomSocketClient => createRoomSocketClient()
const writeDefaultClipboardText = (value: string): Promise<void> => navigator.clipboard.writeText(value)

type StoredReconnectSession = {
  roomId: string
  reconnectToken: string
}

function readStoredReconnectSession(): StoredReconnectSession | null {
  try {
    const rawValue = window.sessionStorage.getItem(RECONNECT_SESSION_STORAGE_KEY)
    if (!rawValue) {
      return null
    }

    const parsed = JSON.parse(rawValue) as Partial<StoredReconnectSession>
    if (typeof parsed.roomId !== 'string' || typeof parsed.reconnectToken !== 'string') {
      return null
    }

    const roomId = parsed.roomId.trim()
    const reconnectToken = parsed.reconnectToken.trim()
    if (!roomId || !reconnectToken) {
      return null
    }

    return { roomId, reconnectToken }
  } catch {
    return null
  }
}

function writeStoredReconnectSession(payload: { roomId: string; reconnectToken: string | null }): void {
  try {
    if (!payload.reconnectToken) {
      window.sessionStorage.removeItem(RECONNECT_SESSION_STORAGE_KEY)
      return
    }

    window.sessionStorage.setItem(
      RECONNECT_SESSION_STORAGE_KEY,
      JSON.stringify({ roomId: payload.roomId, reconnectToken: payload.reconnectToken }),
    )
  } catch {
    return
  }
}

function clearStoredReconnectSession(): void {
  try {
    window.sessionStorage.removeItem(RECONNECT_SESSION_STORAGE_KEY)
  } catch {
    return
  }
}

function createMessageId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function createChatMessage(
  senderParticipantId: string,
  text: string,
  direction: ChatMessage['direction'],
): ChatMessage {
  return {
    messageId: createMessageId(),
    senderParticipantId,
    text,
    sentAtMs: Date.now(),
    direction,
  }
}

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
  window.dispatchEvent(
    new CustomEvent('vapor:webrtc-state', {
      detail: event,
    }),
  )
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
  if (minutes >= 10) {
    return `Ends in ${minutes}m`
  }
  const paddedMinutes = minutes.toString().padStart(2, '0')
  const paddedSeconds = seconds.toString().padStart(2, '0')
  return `Ends in ${paddedMinutes}:${paddedSeconds}`
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

  const [state, setState] = useState<RoomSessionState>(createInitialRoomSessionState)
  const [rateLimitTick, setRateLimitTick] = useState<number>(() => Date.now())
  const socketRef = useRef<RoomSocketClient | null>(null)
  const peerMeshRef = useRef<VaporWebRtcChatMesh | null>(null)
  const resumeInFlightRef = useRef(false)
  const autoResumeRequestedRef = useRef(false)
  const socketStateRef = useRef<RoomSessionState['socketState']>('connecting')
  const pendingMessagesRef = useRef<string[]>([])
  const flushPendingRef = useRef<(() => void) | null>(null)
  const typingDebounceRef = useRef<ReturnType<typeof window.setTimeout> | null>(null)
  const typingSafetyTimeoutsRef = useRef<Map<string, ReturnType<typeof window.setTimeout>>>(new Map())

  // Always-current snapshot used by stable callbacks to avoid stale closures.
  const stateRef = useRef(state)
  stateRef.current = state

  socketStateRef.current = state.socketState

  const disposePeerMesh = useCallback((): void => {
    peerMeshRef.current?.dispose()
    peerMeshRef.current = null
  }, [])

  const createPeerMesh = useCallback(
    (roomId: string, participantId: string): VaporWebRtcChatMesh => {
      disposePeerMesh()

      const peerMesh = new VaporWebRtcChatMesh({
        roomId,
        participantId,
        signalingEmitter: {
          emitSignalOffer: (payload) => {
            socketRef.current?.emitSignalOffer(payload)
          },
          emitSignalAnswer: (payload) => {
            socketRef.current?.emitSignalAnswer(payload)
          },
          emitSignalIce: (payload) => {
            socketRef.current?.emitSignalIce(payload)
          },
        },
        onRemoteMessage: (fromParticipantId, text) => {
          setState((previous) => withAppendedChatMessage(previous, createChatMessage(fromParticipantId, text, 'incoming')))
        },
        onRemoteTypingStatus: (fromParticipantId, isTyping) => {
          const safetyTimeouts = typingSafetyTimeoutsRef.current
          if (isTyping) {
            const existing = safetyTimeouts.get(fromParticipantId)
            if (existing !== undefined) window.clearTimeout(existing)
            const handle = window.setTimeout(() => {
              safetyTimeouts.delete(fromParticipantId)
              setState((prev) => withTypingStopped(prev, fromParticipantId))
            }, 5000)
            safetyTimeouts.set(fromParticipantId, handle)
            setState((prev) => withTypingStarted(prev, fromParticipantId))
          } else {
            const existing = safetyTimeouts.get(fromParticipantId)
            if (existing !== undefined) {
              window.clearTimeout(existing)
              safetyTimeouts.delete(fromParticipantId)
            }
            setState((prev) => withTypingStopped(prev, fromParticipantId))
          }
        },
        onConnectedPeerCountChange: (connectedPeerCount) => {
          setState((previous) => {
            let nextState = withConnectedPeerCount(previous, connectedPeerCount)

            if (connectedPeerCount > 0) {
              nextState = withChatConnectionState(nextState, 'connected')
              flushPendingMessages()
              return nextState
            }

            nextState = withChatConnectionState(nextState, nextState.participantCount > 1 ? 'connecting' : 'idle')
            return nextState
          })
        },
        onTelemetryEvent: emitSafeWebRtcTelemetry,
      })

      peerMeshRef.current = peerMesh
      return peerMesh
    },
    [disposePeerMesh],
  )

  // Stable setter callbacks — use functional state updaters so deps are empty.
  const setLobbyMode = useCallback((mode: LobbyMode) => setState((prev) => withLobbyMode(prev, mode)), [])
  const setRoomIdInput = useCallback((value: string) => setState((prev) => withRoomIdInput(prev, value)), [])
  const setPasswordInput = useCallback((value: string) => setState((prev) => withPasswordInput(prev, value)), [])
  const setNicknameInput = useCallback((value: string) => setState((prev) => withNicknameInput(prev, value)), [])
  const setChatDraft = useCallback((value: string) => setState((prev) => withChatDraft(prev, value)), [])

  const joinRateLimitRemainingMs = useMemo(() => {
    if (!state.joinRateLimitUntil) {
      return 0
    }

    return Math.max(state.joinRateLimitUntil - rateLimitTick, 0)
  }, [state.joinRateLimitUntil, rateLimitTick])

  const isJoinRateLimited =
    state.lobbyMode === 'join' &&
    state.joinRateLimitRoomId !== null &&
    state.joinRateLimitRoomId === state.roomIdInput &&
    joinRateLimitRemainingMs > 0

  useEffect(() => {
    const socket = createSocketClientRef.current()

    socketRef.current = socket

    const onConnect = (): void => {
      const storedSession = readStoredReconnectSession()
      const shouldAttemptResume =
        Boolean(storedSession) &&
        !resumeInFlightRef.current &&
        socketStateRef.current !== 'connected'

      setState((previous) => withSocketState(previous, 'connected'))

      if (!shouldAttemptResume || !storedSession) {
        return
      }

      resumeInFlightRef.current = true
      autoResumeRequestedRef.current = true
      socket.emitResumeSession(storedSession)
    }

    const onDisconnect = (): void => {
      resumeInFlightRef.current = false
      setState((previous) => withSocketState(previous, 'disconnected'))
    }

    const onRoomCreated = (payload: RoomCreatedPayload): void => {
      writeStoredReconnectSession({ roomId: payload.roomId, reconnectToken: payload.reconnectToken })
      resumeInFlightRef.current = false
      autoResumeRequestedRef.current = false
      setState((previous) => withRoomCreated(previous, payload))
      createPeerMesh(payload.roomId, payload.participantId)
    }

    const onRoomJoined = (payload: RoomJoinedPayload): void => {
      writeStoredReconnectSession({ roomId: payload.roomId, reconnectToken: payload.reconnectToken })
      resumeInFlightRef.current = false
      autoResumeRequestedRef.current = false
      setState((previous) => withRoomJoined(previous, payload))
      const peerMesh = createPeerMesh(payload.roomId, payload.participantId)
      peerMesh.syncPeers(payload.peers.map((peer) => peer.participantId))
    }

    const onPeerJoined = (payload: PeerJoinedPayload): void => {
      setState((previous) => {
        const nextState = withPeerJoined(previous, payload)
        if (nextState.connectedPeerCount === 0 && nextState.participantCount > 1) {
          return withChatConnectionState(nextState, 'connecting')
        }

        return nextState
      })
      peerMeshRef.current?.handlePeerJoined(payload.participantId)
    }

    const onPeerLeft = (payload: PeerLeftPayload): void => {
      peerMeshRef.current?.handlePeerLeft(payload.participantId)

      setState((previous) => {
        let nextState = withPeerLeft(previous, payload)

        if (nextState.participantCount <= 1) {
          pendingMessagesRef.current = []
          nextState = withConnectedPeerCount(nextState, 0)
          nextState = withChatConnectionState(nextState, 'idle')
          return nextState
        }

        if (nextState.connectedPeerCount === 0) {
          nextState = withChatConnectionState(nextState, 'connecting')
        }

        return nextState
      })
    }

    const onSignalOffer = (payload: SignalOfferRelayPayload): void => {
      void peerMeshRef.current?.handleSignalOffer(payload)
    }

    const onSignalAnswer = (payload: SignalAnswerRelayPayload): void => {
      void peerMeshRef.current?.handleSignalAnswer(payload)
    }

    const onSignalIce = (payload: SignalIceRelayPayload): void => {
      void peerMeshRef.current?.handleSignalIce(payload)
    }

    const onNicknameUpdated = (payload: NicknameUpdatedPayload): void => {
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
    }

    const onParticipantKicked = (payload: ParticipantKickedPayload): void => {
      if (payload.participantId === stateRef.current.participantId) {
        disposePeerMesh()
        clearStoredReconnectSession()
        resumeInFlightRef.current = false
        autoResumeRequestedRef.current = false
        pendingMessagesRef.current = []
        flushPendingRef.current = null
        if (typingDebounceRef.current !== null) {
          window.clearTimeout(typingDebounceRef.current)
          typingDebounceRef.current = null
        }
        for (const handle of typingSafetyTimeoutsRef.current.values()) window.clearTimeout(handle)
        typingSafetyTimeoutsRef.current.clear()
        setState((previous) => withKickedFromRoom(previous))
      } else {
        peerMeshRef.current?.handlePeerLeft(payload.participantId)
        setState((previous) => withParticipantKicked(previous, payload.participantId))
      }
    }

    const onHostReconnectGrace = (payload: HostReconnectGracePayload): void => {
      setState((previous) => withHostReconnectGrace(previous, payload.deadlineAt))
    }

    const onRoomDestroyed = (payload: RoomDestroyedPayload): void => {
      disposePeerMesh()
      clearStoredReconnectSession()
      resumeInFlightRef.current = false
      autoResumeRequestedRef.current = false
      pendingMessagesRef.current = []
      if (flushPendingRef.current) {
        flushPendingRef.current = null
      }
      if (typingDebounceRef.current !== null) {
        window.clearTimeout(typingDebounceRef.current)
        typingDebounceRef.current = null
      }
      for (const handle of typingSafetyTimeoutsRef.current.values()) window.clearTimeout(handle)
      typingSafetyTimeoutsRef.current.clear()
      setState((previous) => withRoomEnded(previous, payload.reason))
    }

    const onError = (payload: SocketErrorPayload): void => {
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
            return previous
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

        return withLobbyError(previous, getErrorMessage(errorCode))
      })
    }

    socket.onConnect(onConnect)
    socket.onDisconnect(onDisconnect)
    socket.onRoomCreated(onRoomCreated)
    socket.onRoomJoined(onRoomJoined)
    socket.onPeerJoined(onPeerJoined)
    socket.onPeerLeft(onPeerLeft)
    socket.onSignalOffer(onSignalOffer)
    socket.onSignalAnswer(onSignalAnswer)
    socket.onSignalIce(onSignalIce)
    socket.onNicknameUpdated(onNicknameUpdated)
    socket.onParticipantKicked(onParticipantKicked)
    socket.onHostReconnectGrace(onHostReconnectGrace)
    socket.onRoomDestroyed(onRoomDestroyed)
    socket.onError(onError)

    return () => {
      socket.offConnect(onConnect)
      socket.offDisconnect(onDisconnect)
      socket.offRoomCreated(onRoomCreated)
      socket.offRoomJoined(onRoomJoined)
      socket.offPeerJoined(onPeerJoined)
      socket.offPeerLeft(onPeerLeft)
      socket.offSignalOffer(onSignalOffer)
      socket.offSignalAnswer(onSignalAnswer)
      socket.offSignalIce(onSignalIce)
      socket.offNicknameUpdated(onNicknameUpdated)
      socket.offParticipantKicked(onParticipantKicked)
      socket.offHostReconnectGrace(onHostReconnectGrace)
      socket.offRoomDestroyed(onRoomDestroyed)
      socket.offError(onError)
      socket.disconnect()
      disposePeerMesh()
      resumeInFlightRef.current = false
      autoResumeRequestedRef.current = false
      socketRef.current = null
    }
  }, [createPeerMesh, disposePeerMesh])

  useEffect(() => {
    if (!state.joinRateLimitUntil) {
      return
    }

    const intervalHandle = window.setInterval(() => {
      setRateLimitTick(Date.now())
    }, 1000)

    return () => {
      window.clearInterval(intervalHandle)
    }
  }, [state.joinRateLimitUntil])

  useEffect(() => {
    if (!state.joinRateLimitUntil || joinRateLimitRemainingMs > 0) {
      return
    }

    setState((previous) => withJoinRateLimitCleared(previous))
  }, [joinRateLimitRemainingMs, state.joinRateLimitUntil])

  useEffect(() => {
    if (!state.copyFeedback) {
      return
    }

    const timeoutHandle = window.setTimeout(() => {
      setState((previous) => withCopyFeedback(previous, null))
    }, COPY_FEEDBACK_MS)

    return () => {
      window.clearTimeout(timeoutHandle)
    }
  }, [state.copyFeedback])

  const submitLobby = useCallback((): void => {
    const state = stateRef.current
    const now = Date.now()
    const rateLimitRemainingMs = state.joinRateLimitUntil ? Math.max(state.joinRateLimitUntil - now, 0) : 0
    const rateLimited =
      state.lobbyMode === 'join' &&
      state.joinRateLimitRoomId !== null &&
      state.joinRateLimitRoomId === state.roomIdInput &&
      rateLimitRemainingMs > 0

    if (rateLimited) {
      setState((previous) => withLobbyError(previous, getJoinRateLimitedMessage(rateLimitRemainingMs)))
      return
    }

    if (state.socketState !== 'connected') {
      setState((previous) => withLobbyError(previous, UI_COPY.CONNECTING_RETRY))
      return
    }

    const socket = socketRef.current
    if (!socket) {
      setState((previous) => withLobbyError(previous, UI_COPY.GENERIC_ERROR))
      return
    }

    const trimmedNickname = state.nicknameInput.trim()
    if (trimmedNickname.length < 3) {
      setState((previous) => withLobbyError(previous, UI_COPY.INVALID_NICKNAME))
      return
    }

    if (state.lobbyMode === 'join' && state.hasPassword) {
      if (state.passwordInput.trim().length === 0) {
        setState((previous) => withLobbyError(previous, getErrorMessage(SIGNALING_ERROR_CODES.INVALID_PASSWORD)))
        return
      }
    }

    setState((previous) => withLobbySubmitting(previous))

    if (state.lobbyMode === 'create') {
      socket.emitCreateRoom({ password: state.passwordInput, nickname: trimmedNickname })
      return
    }

    socket.emitJoinRoom({ roomId: state.roomIdInput, password: state.passwordInput, nickname: trimmedNickname })
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

  const flushPendingMessages = useCallback((): void => {
    if (pendingMessagesRef.current.length === 0) {
      return
    }

    const messagesToSend = pendingMessagesRef.current.slice()
    pendingMessagesRef.current = []

    for (const message of messagesToSend) {
      const deliveredCount = peerMeshRef.current?.sendMessage(message) ?? 0

      if (deliveredCount === 0) {
        pendingMessagesRef.current.push(message)
      }
    }
  }, [])

  const leaveRoom = useCallback((): void => {
    const socket = socketRef.current
    const roomId = stateRef.current.activeRoomId
    if (socket && roomId) {
      socket.emitLeaveRoom({ roomId })
    }
    disposePeerMesh()
    clearStoredReconnectSession()
    resumeInFlightRef.current = false
    autoResumeRequestedRef.current = false
    pendingMessagesRef.current = []
    if (flushPendingRef.current) {
      flushPendingRef.current = null
    }
    if (typingDebounceRef.current !== null) {
      window.clearTimeout(typingDebounceRef.current)
      typingDebounceRef.current = null
    }
    for (const handle of typingSafetyTimeoutsRef.current.values()) window.clearTimeout(handle)
    typingSafetyTimeoutsRef.current.clear()
    setState((previous) => resetToLobby(previous))
  }, [disposePeerMesh])

  const backToLobby = useCallback((): void => {
    disposePeerMesh()
    clearStoredReconnectSession()
    resumeInFlightRef.current = false
    autoResumeRequestedRef.current = false
    pendingMessagesRef.current = []
    if (flushPendingRef.current) {
      flushPendingRef.current = null
    }
    if (typingDebounceRef.current !== null) {
      window.clearTimeout(typingDebounceRef.current)
      typingDebounceRef.current = null
    }
    for (const handle of typingSafetyTimeoutsRef.current.values()) window.clearTimeout(handle)
    typingSafetyTimeoutsRef.current.clear()
    setState((previous) => resetToLobby(previous))
  }, [disposePeerMesh])

  const kickParticipant = useCallback((targetParticipantId: string): void => {
    const socket = socketRef.current
    const roomId = stateRef.current.activeRoomId
    if (!socket || !roomId) return
    socket.emitKickParticipant({ roomId, targetParticipantId })
  }, [])

  const notifyTypingStart = useCallback((): void => {
    const mesh = peerMeshRef.current
    if (!mesh) return
    const isAlreadyTyping = typingDebounceRef.current !== null
    if (typingDebounceRef.current !== null) {
      window.clearTimeout(typingDebounceRef.current)
    }
    if (!isAlreadyTyping) {
      mesh.sendTypingStart()
    }
    typingDebounceRef.current = window.setTimeout(() => {
      typingDebounceRef.current = null
      peerMeshRef.current?.sendTypingStop()
    }, 3000)
  }, [])

  const notifyTypingStop = useCallback((): void => {
    if (typingDebounceRef.current !== null) {
      window.clearTimeout(typingDebounceRef.current)
      typingDebounceRef.current = null
    }
    peerMeshRef.current?.sendTypingStop()
  }, [])

  const sendChatMessage = useCallback((messageText?: string): void => {
    const s = stateRef.current
    if (!s.participantId) return

    const trimmedMessage = (messageText ?? s.chatDraft).trim()
    if (trimmedMessage.length === 0) return

    if (typingDebounceRef.current !== null) {
      window.clearTimeout(typingDebounceRef.current)
      typingDebounceRef.current = null
    }
    peerMeshRef.current?.sendTypingStop()

    const outgoingMessage = createChatMessage(s.participantId, trimmedMessage, 'outgoing')

    setState((previous) => {
      let nextState = withAppendedChatMessage(previous, outgoingMessage)
      nextState = withChatDraft(nextState, '')
      return nextState
    })

    if (s.participantCount > 1) {
      pendingMessagesRef.current.push(trimmedMessage)

      if (flushPendingRef.current) {
        flushPendingRef.current()
      } else {
        flushPendingRef.current = () => {
          flushPendingMessages()
        }
        queueMicrotask(flushPendingRef.current)
      }
    }
  }, [flushPendingMessages])

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

  const actions = useMemo<RoomSessionActions>(
    () => ({
      setLobbyMode,
      setRoomIdInput,
      setPasswordInput,
      setNicknameInput,
      submitLobby,
      copyRoomId,
      setChatDraft,
      sendChatMessage,
      leaveRoom,
      backToLobby,
      kickParticipant,
      notifyTypingStart,
      notifyTypingStop,
    }),
    [setLobbyMode, setRoomIdInput, setPasswordInput, setNicknameInput, submitLobby, copyRoomId, setChatDraft, sendChatMessage, leaveRoom, backToLobby, kickParticipant, notifyTypingStart, notifyTypingStop],
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
      expiresAt: state.expiresAt,
      soloHostDeadlineAt: state.soloHostDeadlineAt,
      chatStatusText,
    },
  }
}
