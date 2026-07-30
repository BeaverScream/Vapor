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
  withJoinRateLimited,
  withNicknameInput,
  withParticipantKicked,
  withPasswordInput,
  withPeerJoined,
  withPeerLeft,
  withRoomCreated,
  withRoomEnded,
  withRoomIdInput,
  withRoomNameInput,
  withRoomJoined,
  withSessionResumed,
  withSocketState,
} from './state-utils'
import { VaporWebRtcChatMesh, type WebRtcTelemetryEvent } from './webrtc-chat-mesh'
import type {
  ChatConnectionState,
  HostReconnectGracePayload,
  LobbyMode,
  ParticipantKickedPayload,
  PeerJoinedPayload,
  PeerLeftPayload,
  RoomCreatedPayload,
  RoomDestroyedPayload,
  RoomJoinedPayload,
  RoomSocketClient,
  RoomSessionActions,
  RoomSessionState,
  SessionResumedPayload,
  SignalAnswerRelayPayload,
  SignalIceRelayPayload,
  SignalOfferRelayPayload,
  SocketErrorPayload,
} from './types'
import {
  useSessionPersistence,
  readStoredReconnectSession,
} from './hooks/useSessionPersistence'
import { useJoinRateLimit } from './hooks/useJoinRateLimit'
import { useTypingIndicator } from './hooks/useTypingIndicator'
import {
  useChatMessaging,
  createChatMessage,
  saveChatHistory,
  loadChatHistory,
  clearChatHistory,
} from './hooks/useChatMessaging'
import { useSocketConnection } from './hooks/useSocketConnection'
import { useNotifications } from '../../lib/useNotifications'

const COPY_FEEDBACK_MS = 1800

// Diagnostic tracing for WebRTC mesh transitions (VP-10.2). Left in place but
// dormant by default — flip to `true` to re-enable peer-mesh troubleshooting.
const DEBUG_PEER_TRACE = false
function tracePeer(...args: unknown[]): void {
  if (DEBUG_PEER_TRACE) {
    // eslint-disable-next-line no-console
    console.debug('[vapor:peer-trace]', ...args)
  }
}

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

function isTerminalResumeError(errorCode: ReturnType<typeof mapErrorCode>): boolean {
  return (
    errorCode === SIGNALING_ERROR_CODES.ROOM_NOT_FOUND ||
    errorCode === SIGNALING_ERROR_CODES.INVALID_PASSWORD ||
    errorCode === SIGNALING_ERROR_CODES.RATE_LIMITED ||
    errorCode === SIGNALING_ERROR_CODES.RECONNECT_TOKEN_STALE ||
    errorCode === SIGNALING_ERROR_CODES.HOST_RECONNECT_WINDOW_EXPIRED
  )
}

export function getSoloWaitingText(soloDeadlineAt: number | null, nowMs: number): string | null {
  if (soloDeadlineAt === null || soloDeadlineAt === undefined) return null
  const remainingMs = Math.max(soloDeadlineAt - nowMs, 0)
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
  if (expiresAt === null || expiresAt === undefined) return null
  const remainingMs = Math.max(expiresAt - nowMs, 0)
  if (remainingMs <= 0) return null
  const totalSeconds = Math.floor(remainingMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (remainingMs > 10 * 60 * 1000) return `Ends in ${minutes}m`
  return `Ends in ${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
}

export function getHostReconnectGraceText(deadlineAt: number | null, nowMs: number): string | null {
  if (
    deadlineAt === null ||
    !Number.isFinite(deadlineAt) ||
    deadlineAt <= 0 ||
    !Number.isFinite(nowMs)
  ) {
    return null
  }
  const remainingMs = deadlineAt - nowMs
  if (remainingMs <= 0) return null
  const totalSeconds = Math.floor(remainingMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `Host disconnected · reconnect window ${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
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
    soloDeadlineAt: number | null
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
  const peerRepairPendingRef = useRef(false)

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
    peerRepairPendingRef.current = false
    disposePeerMesh()
    chat.clearPending()
    typing.clearAll()
    resumeInFlightRef.current = false
    autoResumeRequestedRef.current = false
    // resumeInFlightRef / autoResumeRequestedRef are stable React refs, not reactive deps — do not add them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // socketRef / peerMeshRef are stable React refs, not reactive deps — do not add them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    socketRef.current?.emitResumeSession({
      ...storedSession,
      supportsSessionResumed: true,
    })
    // socketRef / socketStateRef / resumeInFlightRef / autoResumeRequestedRef are stable React refs, not reactive deps — do not add them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persistence.readStoredReconnectSession])

  const onDisconnect = useCallback((): void => {
    resumeInFlightRef.current = false
    setState((previous) => withSocketState(previous, 'disconnected'))
  }, [])

  const onRoomCreated = useCallback(
    (payload: RoomCreatedPayload): void => {
      try {
        sessionStorage.setItem(
          RECONNECT_SESSION_STORAGE_KEY,
          JSON.stringify({
            roomId: payload.roomId,
            reconnectToken: payload.reconnectToken,
          }),
        )
      } catch {
        // Ignore sessionStorage errors
      }
      resumeInFlightRef.current = false
      autoResumeRequestedRef.current = false
      setState((previous) => withRoomCreated(previous, payload))
      createPeerMesh(payload.roomId, payload.participantId)
      requestPermission()
    },
    // resumeInFlightRef / autoResumeRequestedRef are stable React refs, not reactive deps — do not add them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [createPeerMesh, requestPermission],
  )

  const onRoomJoined = useCallback(
    (payload: RoomJoinedPayload): void => {
      persistence.writeStoredReconnectSession({
        roomId: payload.roomId,
        reconnectToken: payload.reconnectToken,
      })
      resumeInFlightRef.current = false
      autoResumeRequestedRef.current = false
      // Drop any outbound messages queued before an involuntary drop so a reconnect
      // does not re-flush stale messages to peers (which would duplicate them on the
      // receiving side). Read happens once, outside the pure reducer (VP-10.4.4).
      chat.clearPending()
      const restoredChat = loadChatHistory(payload.roomId)
      setState((previous) => {
        const joined = withRoomJoined(previous, payload)
        // Restore the local snapshot (involuntary drop ≠ leave). Merge directly into
        // the join transition so no intermediate empty-chat commit can trigger the
        // persistence effect and overwrite stored history (VP-10.4.3).
        return restoredChat.length > 0 ? { ...joined, chatMessages: restoredChat } : joined
      })
      const peerMesh = createPeerMesh(payload.roomId, payload.participantId)
      peerMesh.syncPeers(payload.peers.map((peer) => peer.participantId))
      requestPermission()
    },
    // resumeInFlightRef / autoResumeRequestedRef are stable React refs, not reactive deps — do not add them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [createPeerMesh, requestPermission],
  )

  const onSessionResumed = useCallback(
    (payload: SessionResumedPayload): void => {
      persistence.writeStoredReconnectSession({
        roomId: payload.roomId,
        reconnectToken: payload.reconnectToken,
      })
      resumeInFlightRef.current = false
      autoResumeRequestedRef.current = false
      // Same pending-drop rationale as onRoomJoined: never re-flush messages queued
      // before the involuntary drop (VP-10.4.4).
      chat.clearPending()
      const restoredChat = loadChatHistory(payload.roomId)
      setState((previous) => {
        const resumed = withSessionResumed(previous, payload)
        // Restore the local snapshot in the same transition so no intermediate
        // empty-chat commit can overwrite stored history (VP-10.4.3).
        return restoredChat.length > 0 ? { ...resumed, chatMessages: restoredChat } : resumed
      })
      const peerMesh = createPeerMesh(payload.roomId, payload.participantId)
      peerMesh.syncPeers(payload.peers.map((peer) => peer.participantId))
      requestPermission()
    },
    // resumeInFlightRef / autoResumeRequestedRef are stable React refs, not reactive deps — do not add them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [createPeerMesh, requestPermission],
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
    // Revalidate the mesh against the remaining participants so guest-to-guest
    // data channels survive a peer (e.g. host) departure. Without this, a missing
    // or stuck guest↔guest connection is never repaired and those guests can no
    // longer exchange messages once the shared peer leaves (VP-10.2).
    peerRepairPendingRef.current = true
    setState((previous) => {
      const name = previous.participantNicknames[payload.participantId] ?? payload.participantId.slice(0, 8)
      const action = payload.reason === 'disconnect' ? 'disconnected' : payload.reason === 'kick' ? 'was removed' : 'left'
      let nextState = withAppendedChatMessage(withPeerLeft(previous, payload), createChatMessage(payload.participantId, `${name} ${action}`, 'system'))
      if (payload.soloDeadlineAt !== undefined && payload.soloDeadlineAt !== null) {
        nextState = { ...nextState, soloDeadlineAt: payload.soloDeadlineAt }
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

  useEffect(() => {
    if (!peerRepairPendingRef.current) return
    peerRepairPendingRef.current = false
    const remainingPeerIds = state.participants
      .map((participant) => participant.participantId)
      .filter((participantId) => participantId !== state.participantId)
    tracePeer('peer_left_commit_repair', { remainingPeerIds })
    if (remainingPeerIds.length > 0) {
      peerMeshRef.current?.syncPeers(remainingPeerIds)
    }
  }, [state.participantId, state.participants])

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

  const onParticipantKicked = useCallback(
    (payload: ParticipantKickedPayload): void => {
      if (payload.participantId === stateRef.current.participantId) {
        clearChatHistory(stateRef.current.activeRoomId)
        persistence.clearStoredReconnectSession()
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
      // Covers host grace expiry / TTL / solo timeout — the room is gone, so every
      // client clears its own snapshot (VP-10.4.5).
      clearChatHistory(stateRef.current.activeRoomId)
      persistence.clearStoredReconnectSession()
      clearRoomSession()
      setState((previous) => withRoomEnded(previous, payload.reason))
    },
    [clearRoomSession],
  )

  const onError = useCallback((payload: SocketErrorPayload): void => {
    const errorCode = mapErrorCode(payload.code)
    const isDefensiveVisibleResumeFailure =
      (errorCode === SIGNALING_ERROR_CODES.RECONNECT_TOKEN_STALE ||
        errorCode === SIGNALING_ERROR_CODES.HOST_RECONNECT_WINDOW_EXPIRED) &&
      stateRef.current.screen === 'room'

    // A terminal resume failure makes the saved session unusable. Capture its room
    // ID before clearing storage because cold reconnecting has not populated
    // activeRoomId (CR12-10). Teardown runs outside the updater so a live mesh is
    // disposed without relying on updater execution (CR12-15).
    if (
      isTerminalResumeError(errorCode) &&
      (autoResumeRequestedRef.current ||
        stateRef.current.screen === 'reconnecting' ||
        stateRef.current.screen === 'room-ended' ||
        isDefensiveVisibleResumeFailure)
    ) {
      const storedRoomId = persistence.readStoredReconnectSession()?.roomId ?? stateRef.current.activeRoomId
      clearChatHistory(storedRoomId)
      persistence.clearStoredReconnectSession()
      clearRoomSession()
      setState((previous) => ({
        ...withRoomEnded(previous),
        roomEndedMessage: getErrorMessage(errorCode),
      }))
      return
    }

    if (autoResumeRequestedRef.current) {
      autoResumeRequestedRef.current = false
      resumeInFlightRef.current = false
    }

    setState((previous) => {
      // Unknown/non-terminal reconnect errors retain the saved reconnect record
      // and preserve the pre-existing deterministic lobby fallback.
      if (previous.screen === 'reconnecting') {
        return resetToLobby(previous)
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
    // autoResumeRequestedRef / stateRef are stable React refs, not reactive deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearRoomSession])

  useSocketConnection(
    socketRef,
    createSocketClientRef,
    {
      onConnect,
      onDisconnect,
      onRoomCreated,
      onRoomJoined,
      onSessionResumed,
      onPeerJoined,
      onPeerLeft,
      onSignalOffer,
      onSignalAnswer,
      onSignalIce,
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

  // Persist chat history while inside a room (VP-10.4.2). Runs after each commit
  // where the message list changed — React batches multiple appends in one tick
  // into a single save. Guarded on `screen === 'room'` so terminal transitions
  // (which clear `chatMessages` and the storage entry) never re-save an empty array.
  useEffect(() => {
    if (state.screen !== 'room' || !state.activeRoomId) return
    saveChatHistory(state.activeRoomId, state.chatMessages)
  }, [state.chatMessages, state.activeRoomId, state.screen])

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
    clearChatHistory(roomId)
    persistence.clearStoredReconnectSession()
    clearRoomSession()
    setState((previous) => resetToLobby(previous))
  }, [clearRoomSession, persistence])

  const backToLobby = useCallback((): void => {
    clearChatHistory(stateRef.current.activeRoomId)
    persistence.clearStoredReconnectSession()
    clearRoomSession()
    setState((previous) => resetToLobby(previous))
  }, [clearRoomSession, persistence])

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
      expiresAt: state.expiresAt,
      soloDeadlineAt: state.soloDeadlineAt,
      chatStatusText,
    },
  }
}
