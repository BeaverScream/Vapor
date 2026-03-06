import { useEffect, useMemo, useRef, useState } from 'react'
import { UI_COPY } from './constants'
import { getErrorMessage, mapErrorCode } from './error-copy'
import { getConnectionStatusText, getRoomStatus } from './participant-utils'
import { createRoomSocketClient } from './room-socket-client'
import {
  createInitialRoomSessionState,
  resetToLobby,
  withCopyFeedback,
  withLobbyError,
  withLobbyMode,
  withLobbySubmitting,
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
    roomStatus: string
    connectionText: string
  }
} {
  const {
    createSocketClient = createDefaultSocketClient,
    writeClipboardText = writeDefaultClipboardText,
  } = dependencies

  const [state, setState] = useState<RoomSessionState>(createInitialRoomSessionState)
  const socketRef = useRef<RoomSocketClient | null>(null)

  useEffect(() => {
    const socket = createSocketClient()

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

    const onRoomDestroyed = (_payload: RoomDestroyedPayload): void => {
      setState((previous) => withRoomEnded(previous))
    }

    const onError = (payload: SocketErrorPayload): void => {
      setState((previous) => withLobbyError(previous, getErrorMessage(mapErrorCode(payload.code))))
    }

    socket.onConnect(onConnect)
    socket.onDisconnect(onDisconnect)
    socket.onRoomCreated(onRoomCreated)
    socket.onRoomJoined(onRoomJoined)
    socket.onPeerJoined(onPeerJoined)
    socket.onPeerLeft(onPeerLeft)
    socket.onRoomDestroyed(onRoomDestroyed)
    socket.onError(onError)

    return () => {
      socket.offConnect(onConnect)
      socket.offDisconnect(onDisconnect)
      socket.offRoomCreated(onRoomCreated)
      socket.offRoomJoined(onRoomJoined)
      socket.offPeerJoined(onPeerJoined)
      socket.offPeerLeft(onPeerLeft)
      socket.offRoomDestroyed(onRoomDestroyed)
      socket.offError(onError)
      socket.disconnect()
      socketRef.current = null
    }
  }, [createSocketClient])

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

  const submitLobby = (): void => {
    if (state.socketState !== 'connected') {
      setState((previous) => withLobbyError(previous, UI_COPY.CONNECTING_RETRY))
      return
    }

    const socket = socketRef.current
    if (!socket) {
      setState((previous) => withLobbyError(previous, UI_COPY.GENERIC_ERROR))
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
  const roomStatus = useMemo(() => getRoomStatus(state.participantCount), [state.participantCount])
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
      roomStatus,
      connectionText,
    },
  }
}
