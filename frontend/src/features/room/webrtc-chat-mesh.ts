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

// Only JSON frames whose `type` is in this set are surfaced as chat.
// Non-JSON plaintext is always treated as chat. All other JSON frames are dropped.
const CHAT_MESSAGE_TYPES = new Set<string>(['text'])

type SignalingEmitter = {
  emitSignalOffer: (payload: SignalOfferRequest) => void
  emitSignalAnswer: (payload: SignalAnswerRequest) => void
  emitSignalIce: (payload: SignalIceRequest) => void
}

export type WebRtcTelemetryEvent =
  | { kind: 'peer_connection_state'; peerId: string; state: string; timestampMs: number }
  | { kind: 'data_channel_state'; peerId: string; state: string; timestampMs: number }
  | { kind: 'bitrate_stats'; peerId: string; bytesReceived: number; bytesSent: number; timestampMs: number }

type VaporWebRtcChatMeshArgs = {
  roomId: string
  participantId: string
  signalingEmitter: SignalingEmitter
  onRemoteMessage: (fromParticipantId: string, text: string) => void
  onRemoteTypingStatus: (fromParticipantId: string, isTyping: boolean) => void
  onConnectedPeerCountChange: (count: number) => void
  onTelemetryEvent?: (event: WebRtcTelemetryEvent) => void
  onNewMessage?: () => void
}

export class VaporWebRtcChatMesh {
  private readonly roomId: string
  private readonly participantId: string
  private readonly signalingEmitter: SignalingEmitter
  private readonly onRemoteMessage: (fromParticipantId: string, text: string) => void
  private readonly onRemoteTypingStatus: (fromParticipantId: string, isTyping: boolean) => void
  private readonly onConnectedPeerCountChange: (count: number) => void
  private readonly onTelemetryEvent: NonNullable<VaporWebRtcChatMeshArgs['onTelemetryEvent']>
  private readonly onNewMessage: (() => void) | undefined
  private readonly peerConnections = new Map<string, RTCPeerConnection>()
  private readonly dataChannels = new Map<string, RTCDataChannel>()
  private disposed = false
  private statsIntervalHandle: ReturnType<typeof window.setInterval> | null = null

  constructor({
    roomId,
    participantId,
    signalingEmitter,
    onRemoteMessage,
    onRemoteTypingStatus,
    onConnectedPeerCountChange,
    onTelemetryEvent,
    onNewMessage,
  }: VaporWebRtcChatMeshArgs) {
    this.roomId = roomId
    this.participantId = participantId
    this.signalingEmitter = signalingEmitter
    this.onRemoteMessage = onRemoteMessage
    this.onRemoteTypingStatus = onRemoteTypingStatus
    this.onConnectedPeerCountChange = onConnectedPeerCountChange
    this.onTelemetryEvent = onTelemetryEvent ?? (() => undefined)
    this.onNewMessage = onNewMessage
  }

  syncPeers(peerIds: string[]): void {
    if (this.disposed) {
      return
    }

    const peerSet = new Set(peerIds.filter((peerId) => peerId !== this.participantId))

    for (const peerId of peerSet) {
      this.ensurePeerConnection(peerId)
      if (this.shouldInitiate(peerId) && this.needsOffer(peerId)) {
        void this.startOffer(peerId)
      }
    }

    for (const peerId of Array.from(this.peerConnections.keys())) {
      if (!peerSet.has(peerId)) {
        this.removePeer(peerId)
      }
    }

    this.emitConnectedPeerCount()
  }

  // True when this peer has no usable channel and is safe to (re)offer to. Lets
  // syncPeers double as a mesh-repair pass on topology changes (e.g. host departure)
  // without disrupting a healthy or mid-negotiation connection.
  private needsOffer(peerId: string): boolean {
    const channel = this.dataChannels.get(peerId)
    // An open channel is healthy and a still-connecting one is mid-establishment —
    // either way a fresh offer would be unnecessary churn, so skip it (CR10-3).
    if (channel && (channel.readyState === 'open' || channel.readyState === 'connecting')) {
      return false
    }
    const connection = this.peerConnections.get(peerId)
    if (connection && connection.signalingState !== 'stable') {
      return false
    }
    return true
  }

  handlePeerJoined(peerId: string): void {
    if (this.disposed || peerId === this.participantId) {
      return
    }

    this.ensurePeerConnection(peerId)
    if (this.shouldInitiate(peerId)) {
      void this.startOffer(peerId)
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

  sendTypingStart(): void {
    if (this.disposed) return
    this.broadcastControl('{"type":"typing_start"}')
  }

  sendTypingStop(): void {
    if (this.disposed) return
    this.broadcastControl('{"type":"typing_stop"}')
  }

  dispose(): void {
    if (this.disposed) {
      return
    }

    this.disposed = true
    this.stopStatsPolling()

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
        peerId,
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
      const raw = this.asTextMessage(event.data)
      let isChat = true
      try {
        const parsed = JSON.parse(raw) as unknown
        isChat = false
        if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const { type } = parsed as Record<string, unknown>
          if (type === 'typing_start') {
            this.onRemoteTypingStatus(peerId, true)
            return
          }
          if (type === 'typing_stop') {
            this.onRemoteTypingStatus(peerId, false)
            return
          }
          if (typeof type === 'string' && CHAT_MESSAGE_TYPES.has(type)) {
            isChat = true
          }
        }
      } catch {
        // not JSON — always chat
      }
      if (isChat) {
        this.onRemoteMessage(peerId, raw)
        this.onNewMessage?.()
      }
    }

    channel.onopen = () => {
      this.onTelemetryEvent({
        kind: 'data_channel_state',
        peerId,
        state: channel.readyState,
        timestampMs: Date.now(),
      })
      this.emitConnectedPeerCount()
    }

    channel.onclose = () => {
      this.onTelemetryEvent({
        kind: 'data_channel_state',
        peerId,
        state: channel.readyState,
        timestampMs: Date.now(),
      })
      this.emitConnectedPeerCount()
    }

    channel.onerror = () => {
      this.onTelemetryEvent({
        kind: 'data_channel_state',
        peerId,
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

  private broadcastControl(json: string): void {
    for (const channel of this.dataChannels.values()) {
      if (channel.readyState === 'open') {
        channel.send(json)
      }
    }
  }

  private removePeer(peerId: string): void {
    this.onRemoteTypingStatus(peerId, false)
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

    if (connectedCount > 0) {
      this.startStatsPolling()
    } else {
      this.stopStatsPolling()
    }
  }

  private startStatsPolling(): void {
    if (this.statsIntervalHandle !== null || this.disposed) {
      return
    }
    this.statsIntervalHandle = window.setInterval(() => {
      void this.pollStats()
    }, 2000)
  }

  private stopStatsPolling(): void {
    if (this.statsIntervalHandle !== null) {
      window.clearInterval(this.statsIntervalHandle)
      this.statsIntervalHandle = null
    }
  }

  private async pollStats(): Promise<void> {
    if (this.disposed) {
      return
    }

    for (const [peerId, connection] of this.peerConnections) {
      try {
        const stats = await connection.getStats()
        let bytesReceived = 0
        let bytesSent = 0
        stats.forEach((report: RTCStats) => {
          if (report.type === 'transport') {
            const s = report as unknown as { bytesReceived?: number; bytesSent?: number }
            bytesReceived += s.bytesReceived ?? 0
            bytesSent += s.bytesSent ?? 0
          }
        })
        this.onTelemetryEvent({
          kind: 'bitrate_stats',
          peerId,
          bytesReceived,
          bytesSent,
          timestampMs: Date.now(),
        })
      } catch {
        // stats unavailable for this peer — skip
      }
    }
  }
}
