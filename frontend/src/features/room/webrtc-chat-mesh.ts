import type {
  SignalAnswerRelayPayload,
  SignalAnswerRequest,
  SignalIceRelayPayload,
  SignalIceRequest,
  SignalOfferRelayPayload,
  SignalOfferRequest,
} from './types'
import { WEBRTC_ICE_SERVERS } from './constants'

const DATA_CHANNEL_LABEL = 'vapor-chat'

type SignalingEmitter = {
  emitSignalOffer: (payload: SignalOfferRequest) => void
  emitSignalAnswer: (payload: SignalAnswerRequest) => void
  emitSignalIce: (payload: SignalIceRequest) => void
}

type VaporWebRtcChatMeshArgs = {
  roomId: string
  participantId: string
  signalingEmitter: SignalingEmitter
  onRemoteMessage: (fromParticipantId: string, text: string) => void
  onConnectedPeerCountChange: (count: number) => void
  onTelemetryEvent?: (event: {
    kind: 'peer_connection_state' | 'data_channel_state'
    state: string
    timestampMs: number
  }) => void
}

export class VaporWebRtcChatMesh {
  private readonly roomId: string
  private readonly participantId: string
  private readonly signalingEmitter: SignalingEmitter
  private readonly onRemoteMessage: (fromParticipantId: string, text: string) => void
  private readonly onConnectedPeerCountChange: (count: number) => void
  private readonly onTelemetryEvent: NonNullable<VaporWebRtcChatMeshArgs['onTelemetryEvent']>
  private readonly peerConnections = new Map<string, RTCPeerConnection>()
  private readonly dataChannels = new Map<string, RTCDataChannel>()
  private disposed = false

  constructor({
    roomId,
    participantId,
    signalingEmitter,
    onRemoteMessage,
    onConnectedPeerCountChange,
    onTelemetryEvent,
  }: VaporWebRtcChatMeshArgs) {
    this.roomId = roomId
    this.participantId = participantId
    this.signalingEmitter = signalingEmitter
    this.onRemoteMessage = onRemoteMessage
    this.onConnectedPeerCountChange = onConnectedPeerCountChange
    this.onTelemetryEvent = onTelemetryEvent ?? (() => undefined)
  }

  syncPeers(peerIds: string[]): void {
    if (this.disposed) {
      return
    }

    const peerSet = new Set(peerIds.filter((peerId) => peerId !== this.participantId))

    for (const peerId of peerSet) {
      this.ensurePeerConnection(peerId)
      if (this.shouldInitiate(peerId)) {
        this.startOffer(peerId)
      }
    }

    for (const peerId of Array.from(this.peerConnections.keys())) {
      if (!peerSet.has(peerId)) {
        this.removePeer(peerId)
      }
    }

    this.emitConnectedPeerCount()
  }

  handlePeerJoined(peerId: string): void {
    if (this.disposed || peerId === this.participantId) {
      return
    }

    this.ensurePeerConnection(peerId)
    if (this.shouldInitiate(peerId)) {
      this.startOffer(peerId)
    }
  }

  handlePeerLeft(peerId: string): void {
    this.removePeer(peerId)
    this.emitConnectedPeerCount()
  }

  async handleSignalOffer(payload: SignalOfferRelayPayload): Promise<void> {
    if (this.disposed || payload.fromParticipantId === this.participantId) {
      return
    }

    const connection = this.ensurePeerConnection(payload.fromParticipantId)

    try {
      if (connection.signalingState !== 'stable') {
        await connection.setLocalDescription({ type: 'rollback' })
      }

      await connection.setRemoteDescription({ type: 'offer', sdp: payload.sdp })
      const answer = await connection.createAnswer()
      await connection.setLocalDescription(answer)

      if (!connection.localDescription?.sdp) {
        return
      }

      this.signalingEmitter.emitSignalAnswer({
        roomId: this.roomId,
        toParticipantId: payload.fromParticipantId,
        sdp: connection.localDescription.sdp,
      })
    } catch {
      this.removePeer(payload.fromParticipantId)
      this.ensurePeerConnection(payload.fromParticipantId)
    }
  }

  async handleSignalAnswer(payload: SignalAnswerRelayPayload): Promise<void> {
    if (this.disposed || payload.fromParticipantId === this.participantId) {
      return
    }

    const connection = this.ensurePeerConnection(payload.fromParticipantId)

    if (connection.signalingState !== 'have-local-offer') {
      return
    }

    try {
      await connection.setRemoteDescription({ type: 'answer', sdp: payload.sdp })
    } catch {
      this.removePeer(payload.fromParticipantId)
      this.ensurePeerConnection(payload.fromParticipantId)
    }
  }

  async handleSignalIce(payload: SignalIceRelayPayload): Promise<void> {
    if (this.disposed || payload.fromParticipantId === this.participantId) {
      return
    }

    const connection = this.ensurePeerConnection(payload.fromParticipantId)

    const candidateInit: RTCIceCandidateInit =
      typeof payload.candidate === 'string'
        ? { candidate: payload.candidate }
        : (payload.candidate as RTCIceCandidateInit)

    try {
      await connection.addIceCandidate(new RTCIceCandidate(candidateInit))
    } catch {
      return
    }
  }

  sendMessage(text: string): number {
    if (this.disposed) {
      return 0
    }

    let deliveredCount = 0
    for (const channel of this.dataChannels.values()) {
      if (channel.readyState !== 'open') {
        continue
      }

      channel.send(text)
      deliveredCount += 1
    }

    return deliveredCount
  }

  dispose(): void {
    if (this.disposed) {
      return
    }

    this.disposed = true

    for (const peerId of Array.from(this.peerConnections.keys())) {
      this.removePeer(peerId)
    }

    this.emitConnectedPeerCount()
  }

  private shouldInitiate(peerId: string): boolean {
    return this.participantId.localeCompare(peerId) < 0
  }

  private ensurePeerConnection(peerId: string): RTCPeerConnection {
    const existing = this.peerConnections.get(peerId)
    if (existing) {
      return existing
    }

    const connection = new RTCPeerConnection({
      iceServers: WEBRTC_ICE_SERVERS,
    })

    connection.onicecandidate = (event) => {
      if (!event.candidate) {
        return
      }

      this.signalingEmitter.emitSignalIce({
        roomId: this.roomId,
        toParticipantId: peerId,
        candidate: event.candidate.toJSON() as unknown as Record<string, unknown>,
      })
    }

    connection.ondatachannel = (event) => {
      this.attachDataChannel(peerId, event.channel)
    }

    connection.onconnectionstatechange = () => {
      this.onTelemetryEvent({
        kind: 'peer_connection_state',
        state: connection.connectionState,
        timestampMs: Date.now(),
      })

      if (connection.connectionState === 'failed' || connection.connectionState === 'closed') {
        this.removePeer(peerId)
      }

      this.emitConnectedPeerCount()
    }

    this.peerConnections.set(peerId, connection)
    return connection
  }

  private attachDataChannel(peerId: string, channel: RTCDataChannel): void {
    this.dataChannels.set(peerId, channel)

    channel.onmessage = (event) => {
      this.onRemoteMessage(peerId, this.asTextMessage(event.data))
    }

    channel.onopen = () => {
      this.onTelemetryEvent({
        kind: 'data_channel_state',
        state: channel.readyState,
        timestampMs: Date.now(),
      })
      this.emitConnectedPeerCount()
    }

    channel.onclose = () => {
      this.onTelemetryEvent({
        kind: 'data_channel_state',
        state: channel.readyState,
        timestampMs: Date.now(),
      })
      this.emitConnectedPeerCount()
    }

    channel.onerror = () => {
      this.onTelemetryEvent({
        kind: 'data_channel_state',
        state: 'error',
        timestampMs: Date.now(),
      })
      this.emitConnectedPeerCount()
    }

    this.emitConnectedPeerCount()
  }

  private asTextMessage(rawData: unknown): string {
    if (typeof rawData === 'string') {
      return rawData
    }

    if (rawData instanceof ArrayBuffer) {
      return new TextDecoder().decode(rawData)
    }

    return String(rawData)
  }

  private async startOffer(peerId: string): Promise<void> {
    const connection = this.ensurePeerConnection(peerId)

    if (!this.dataChannels.has(peerId)) {
      const channel = connection.createDataChannel(DATA_CHANNEL_LABEL, {
        ordered: true,
      })
      this.attachDataChannel(peerId, channel)
    }

    try {
      const offer = await connection.createOffer()
      await connection.setLocalDescription(offer)

      if (!connection.localDescription?.sdp) {
        return
      }

      this.signalingEmitter.emitSignalOffer({
        roomId: this.roomId,
        toParticipantId: peerId,
        sdp: connection.localDescription.sdp,
      })
    } catch {
      this.removePeer(peerId)
      this.ensurePeerConnection(peerId)
    }
  }

  private removePeer(peerId: string): void {
    const channel = this.dataChannels.get(peerId)
    if (channel) {
      channel.onopen = null
      channel.onclose = null
      channel.onerror = null
      channel.onmessage = null
      channel.close()
      this.dataChannels.delete(peerId)
    }

    const connection = this.peerConnections.get(peerId)
    if (connection) {
      connection.onicecandidate = null
      connection.ondatachannel = null
      connection.onconnectionstatechange = null
      connection.close()
      this.peerConnections.delete(peerId)
    }
  }

  private emitConnectedPeerCount(): void {
    const connectedCount = Array.from(this.dataChannels.values()).filter(
      (channel) => channel.readyState === 'open',
    ).length
    this.onConnectedPeerCountChange(connectedCount)
  }
}
