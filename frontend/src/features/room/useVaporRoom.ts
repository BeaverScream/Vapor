import { useEffect, useMemo, useRef, useState } from 'react'
import { JOIN_RATE_LIMIT_COOLDOWN_MS, UI_COPY } from './constants'
import { getErrorMessage, getJoinRateLimitedMessage, mapErrorCode } from './error-copy'
import { SIGNALING_ERROR_CODES } from '@shared'
import { getConnectionStatusText, getRoomStatus } from './participant-utils'
import { createRoomSocketClient } from './room-socket-client'
import {
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
import {
  type HostReconnectGracePayload,
  type PeerJoinedPayload,
  type PeerLeftPayload,
  type RoomCreatedPayload,
  type RoomDestroyedPayload,
  type RoomJoinedPayload,
  type RoomSocketClient,
  type RoomSessionActions,
  type RoomSessionState,
  type SocketErrorPayload,
} from './types'

const COPY_FEEDBACK_MS = 1800

const createDefaultSocketClient = (): RoomSocketClient => createRoomSocketClient()
const writeDefaultClipboardText = (value: string): Promise<void> => navigator.clipboard.writeText(value)

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

    const paddedSeconds = seconds.toString().padStart(2, '0')
    return `Ends in ${minutes}:${paddedSeconds}`
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
      setState((previous) => withSocketState(previous, 'connected'))
    }

    const onDisconnect = (): void => {
      setState((previous) => withSocketState(previous, 'disconnected'))
    }

    const onRoomCreated = (payload: RoomCreatedPayload): void => {
      setState((previous) => withRoomCreated(previous, payload))
    }

    const onRoomJoined = (payload: RoomJoinedPayload): void => {
      setState((previous) => withRoomJoined(previous, payload))
    }

    const onPeerJoined = (payload: PeerJoinedPayload): void => {
      setState((previous) => withPeerJoined(previous, payload))
    }

    const onPeerLeft = (payload: PeerLeftPayload): void => {
      setState((previous) => withPeerLeft(previous, payload))
    }

    const onHostReconnectGrace = (payload: HostReconnectGracePayload): void => {
      setState((previous) => withHostReconnectGrace(previous, payload.deadlineAt))
    }

    const onRoomDestroyed = (payload: RoomDestroyedPayload): void => {
      setState((previous) => withRoomEnded(previous, payload.reason))
    }

    const onError = (payload: SocketErrorPayload): void => {
      setState((previous) => {
        const errorCode = mapErrorCode(payload.code)

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
      socket.offHostReconnectGrace(onHostReconnectGrace)
      socket.offRoomDestroyed(onRoomDestroyed)
      socket.offError(onError)
      socket.disconnect()
      socketRef.current = null
    }
  }, [])

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

  const leaveRoom = (): void => {
    const socket = socketRef.current
    if (socket && state.activeRoomId) {
      socket.emitLeaveRoom({ roomId: state.activeRoomId })
    }

    setState((previous) => resetToLobby(previous))
  }

  const backToLobby = (): void => {
    setState((previous) => resetToLobby(previous))
  }

  const primaryActionLabel = state.lobbyMode === 'create' ? 'Create room' : 'Join room'
  const isPrimaryDisabled = state.lobbyStatus === 'submitting' || isJoinRateLimited
  const joinRateLimitHint = isJoinRateLimited ? getJoinRateLimitedMessage(joinRateLimitRemainingMs) : null
  const roomStatus = useMemo(
    () => getRoomStatus(state.participantCount, state.hostReconnectGraceDeadlineAt),
    [state.hostReconnectGraceDeadlineAt, state.participantCount],
  )
  const connectionText = useMemo(() => getConnectionStatusText(state.socketState), [state.socketState])

  return {
    state,
    actions: {
      setLobbyMode: (mode) => setState((previous) => withLobbyMode(previous, mode)),
      setRoomIdInput: (value: string) => setState((previous) => withRoomIdInput(previous, value)),
      setPasswordInput: (value: string) => setState((previous) => withPasswordInput(previous, value)),
      submitLobby,
      copyRoomId,
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
      roomLifetimeText: isInputFocused ? null : roomLifetimeText,
    },
  }
}
