import { useEffect, useRef } from 'react'
import type {
  HostReconnectGracePayload,
  NicknameUpdatedPayload,
  ParticipantKickedPayload,
  PeerJoinedPayload,
  PeerLeftPayload,
  RoomCreatedPayload,
  RoomDestroyedPayload,
  RoomJoinedPayload,
  RoomSocketClient,
  SignalAnswerRelayPayload,
  SignalIceRelayPayload,
  SignalOfferRelayPayload,
  SocketErrorPayload,
} from '../types'

export type SocketEventHandlers = {
  onConnect: () => void
  onDisconnect: () => void
  onRoomCreated: (payload: RoomCreatedPayload) => void
  onRoomJoined: (payload: RoomJoinedPayload) => void
  onPeerJoined: (payload: PeerJoinedPayload) => void
  onPeerLeft: (payload: PeerLeftPayload) => void
  onSignalOffer: (payload: SignalOfferRelayPayload) => void
  onSignalAnswer: (payload: SignalAnswerRelayPayload) => void
  onSignalIce: (payload: SignalIceRelayPayload) => void
  onNicknameUpdated: (payload: NicknameUpdatedPayload) => void
  onParticipantKicked: (payload: ParticipantKickedPayload) => void
  onHostReconnectGrace: (payload: HostReconnectGracePayload) => void
  onRoomDestroyed: (payload: RoomDestroyedPayload) => void
  onError: (payload: SocketErrorPayload) => void
}

export function useSocketConnection(
  socketRef: React.MutableRefObject<RoomSocketClient | null>,
  createSocketClientRef: React.RefObject<() => RoomSocketClient>,
  handlers: SocketEventHandlers,
  onDispose: () => void,
): void {
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  const onDisposeRef = useRef(onDispose)
  onDisposeRef.current = onDispose

  useEffect(() => {
    const socket = createSocketClientRef.current!()
    socketRef.current = socket

    const onConnect = (): void => handlersRef.current.onConnect()
    const onDisconnect = (): void => handlersRef.current.onDisconnect()
    const onRoomCreated = (p: RoomCreatedPayload): void => handlersRef.current.onRoomCreated(p)
    const onRoomJoined = (p: RoomJoinedPayload): void => handlersRef.current.onRoomJoined(p)
    const onPeerJoined = (p: PeerJoinedPayload): void => handlersRef.current.onPeerJoined(p)
    const onPeerLeft = (p: PeerLeftPayload): void => handlersRef.current.onPeerLeft(p)
    const onSignalOffer = (p: SignalOfferRelayPayload): void => handlersRef.current.onSignalOffer(p)
    const onSignalAnswer = (p: SignalAnswerRelayPayload): void => handlersRef.current.onSignalAnswer(p)
    const onSignalIce = (p: SignalIceRelayPayload): void => handlersRef.current.onSignalIce(p)
    const onNicknameUpdated = (p: NicknameUpdatedPayload): void => handlersRef.current.onNicknameUpdated(p)
    const onParticipantKicked = (p: ParticipantKickedPayload): void => handlersRef.current.onParticipantKicked(p)
    const onHostReconnectGrace = (p: HostReconnectGracePayload): void => handlersRef.current.onHostReconnectGrace(p)
    const onRoomDestroyed = (p: RoomDestroyedPayload): void => handlersRef.current.onRoomDestroyed(p)
    const onError = (p: SocketErrorPayload): void => handlersRef.current.onError(p)

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
      onDisposeRef.current()
      socketRef.current = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return socketRef
}
