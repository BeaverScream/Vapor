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
  withLobbyError,
  withLobbyMode,
  withLobbySubmitting,
  withJoinRateLimitCleared,
  withJoinRateLimited,
  withPasswordInput,
  withPeerJoined,
  withPeerLeft,
  withRoomCreated,
  withRoomEnded,
  withRoomIdInput,
  withRoomJoined,
  withSocketState,
} from './state-utils'
import { VaporWebRtcChatMesh } from './webrtc-chat-mesh'
import {
  type ChatConnectionState,
  type ChatMessage,
  type HostReconnectGracePayload,
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

function getSoloWaitingText(soloHostDeadlineAt: number | null, nowMs: number): string | null {
  if (!soloHostDeadlineAt) {
    return null
  }

  const remainingMs = Math.max(soloHostDeadlineAt - nowMs, 0)
  if (remainingMs <= 0) {
    return null
  }

  const totalSeconds = Math.ceil(remainingMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  if (minutes >= 10) {
    return `Solo room expires in ${minutes}m`
  }

  const paddedMinutes = minutes.toString().padStart(2, '0')
  const paddedSeconds = seconds.toString().padStart(2, '0')
  return `Solo room expires in ${paddedMinutes}:${paddedSeconds}`
}

function emitSafeWebRtcTelemetry(event: { kind: string; state: string; timestampMs: number }): void {
  window.dispatchEvent(
    new CustomEvent('vapor:webrtc-state', {
      detail: event,
    }),
  )
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
    soloWaitingText: string | null
    soloWaitingChipText: string | null
    chatStatusText: string
    roomLifetimeText: string | null
  }
} {
  const {
    createSocketClient = createDefaultSocketClient,
    writeClipboardText = writeDefaultClipboardText,
  } = dependencies

  const createSocketClientRef = useRef(createSocketClient)
  createSocketClientRef.current = createSocketClient

  const [state, setState] = useState<RoomSessionState>(createInitialRoomSessionState)
  const [rateLimitTick, setRateLimitTick] = useState<number>(() => Date.now())
  const [lifetimeTick, setLifetimeTick] = useState<number>(() => Date.now())
  const [isInputFocused, setIsInputFocused] = useState(false)
  const socketRef = useRef<RoomSocketClient | null>(null)
  const peerMeshRef = useRef<VaporWebRtcChatMesh | null>(null)
  const resumeInFlightRef = useRef(false)
  const autoResumeRequestedRef = useRef(false)
  const socketStateRef = useRef<RoomSessionState['socketState']>('connecting')
  const pendingMessagesRef = useRef<string[]>([])
  const flushPendingRef = useRef<(() => void) | null>(null)

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

  const joinRateLimitRemainingMs = useMemo(() => {
    if (!state.joinRateLimitUntil) {
      return 0
    }

    return Math.max(state.joinRateLimitUntil - rateLimitTick, 0)
  }, [state.joinRateLimitUntil, rateLimitTick])

  const roomLifetimeRemainingMs = useMemo(() => {
    if (!state.expiresAt) {
      return 0
    }

    return Math.max(state.expiresAt - lifetimeTick, 0)
  }, [state.expiresAt, lifetimeTick])

  const roomLifetimeText = useMemo(() => {
    if (roomLifetimeRemainingMs <= 0) {
      return null
    }

    const totalSeconds = Math.floor(roomLifetimeRemainingMs / 1000)
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60

    if (minutes >= 10) {
      return `Ends in ${minutes}m`
    }

    const paddedMinutes = minutes.toString().padStart(2, '0')
    const paddedSeconds = seconds.toString().padStart(2, '0')
    return `Ends in ${paddedMinutes}:${paddedSeconds}`
  }, [roomLifetimeRemainingMs])

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

  useEffect(() => {
    if (!state.expiresAt || state.screen !== 'room') {
      return
    }

    const intervalHandle = window.setInterval(() => {
      setLifetimeTick(Date.now())
    }, 1000)

    return () => {
      window.clearInterval(intervalHandle)
    }
  }, [state.expiresAt, state.screen])

  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        setIsInputFocused(true)
      }
    }

    const onFocusOut = (event: FocusEvent) => {
      const target = event.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        setIsInputFocused(false)
      }
    }

    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('focusout', onFocusOut)

    return () => {
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('focusout', onFocusOut)
    }
  }, [])

  const submitLobby = (): void => {
    if (isJoinRateLimited) {
      setState((previous) => withLobbyError(previous, getJoinRateLimitedMessage(joinRateLimitRemainingMs)))
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

    if (state.passwordInput.trim().length === 0) {
      setState((previous) => withLobbyError(previous, getErrorMessage(SIGNALING_ERROR_CODES.INVALID_PASSWORD)))
      return
    }

    setState((previous) => withLobbySubmitting(previous))

    if (state.lobbyMode === 'create') {
      socket.emitCreateRoom({ password: state.passwordInput })
      return
    }

    socket.emitJoinRoom({ roomId: state.roomIdInput, password: state.passwordInput })
  }

  const copyRoomId = async (): Promise<void> => {
    if (!state.activeRoomId) {
      return
    }

    try {
      await writeClipboardText(state.activeRoomId)
      setState((previous) => withCopyFeedback(previous, 'Copied'))
    } catch {
      setState((previous) => withCopyFeedback(previous, 'Copy unavailable'))
    }
  }

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

  const leaveRoom = (): void => {
    const socket = socketRef.current
    if (socket && state.activeRoomId) {
      socket.emitLeaveRoom({ roomId: state.activeRoomId })
    }

    disposePeerMesh()
    clearStoredReconnectSession()
    resumeInFlightRef.current = false
    autoResumeRequestedRef.current = false
    pendingMessagesRef.current = []
    if (flushPendingRef.current) {
      flushPendingRef.current = null
    }
    setState((previous) => resetToLobby(previous))
  }

  const backToLobby = (): void => {
    disposePeerMesh()
    clearStoredReconnectSession()
    resumeInFlightRef.current = false
    autoResumeRequestedRef.current = false
    pendingMessagesRef.current = []
    if (flushPendingRef.current) {
      flushPendingRef.current = null
    }
    setState((previous) => resetToLobby(previous))
  }

  const sendChatMessage = (messageText?: string): void => {
    if (!state.participantId) {
      return
    }

    const trimmedMessage = (messageText ?? state.chatDraft).trim()
    if (trimmedMessage.length === 0) {
      return
    }

    const outgoingMessage = createChatMessage(state.participantId, trimmedMessage, 'outgoing')

    setState((previous) => {
      let nextState = withAppendedChatMessage(previous, outgoingMessage)
      nextState = withChatDraft(nextState, '')
      return nextState
    })

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
  const soloWaitingText = useMemo(
    () => getSoloWaitingText(state.soloHostDeadlineAt, lifetimeTick),
    [state.soloHostDeadlineAt, lifetimeTick],
  )
  const soloWaitingChipText = useMemo(
    () => (soloWaitingText ? `${UI_COPY.SOLO_HOST_WARNING} ${soloWaitingText.replace('Solo room expires in ', '')}` : null),
    [soloWaitingText],
  )

  return {
    state,
    actions: {
      setLobbyMode: (mode) => setState((previous) => withLobbyMode(previous, mode)),
      setRoomIdInput: (value: string) => setState((previous) => withRoomIdInput(previous, value)),
      setPasswordInput: (value: string) => setState((previous) => withPasswordInput(previous, value)),
      submitLobby,
      copyRoomId,
      setChatDraft: (value: string) => setState((previous) => withChatDraft(previous, value)),
      sendChatMessage,
      leaveRoom,
      backToLobby,
    },
    derived: {
      lobbyMode: state.lobbyMode,
      primaryActionLabel,
      isPrimaryDisabled,
      joinRateLimitHint,
      roomStatus,
      connectionText,
      soloWaitingText,
      soloWaitingChipText,
      chatStatusText,
      roomLifetimeText: isInputFocused ? null : roomLifetimeText,
    },
  }
}
