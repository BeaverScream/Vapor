import { act, cleanup, render, renderHook, screen } from '@testing-library/react'
import { StrictMode, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createInitialRoomSessionState,
  withPeerJoined,
  withPeerLeft,
  withRoomEnded,
  withRoomJoined,
  withSessionResumed,
} from '../src/features/room/state-utils'
import {
  getHostReconnectGraceText,
  getLifetimeText,
  getSoloWaitingText,
  useVaporRoom,
} from '../src/features/room/useVaporRoom'
import { VaporWebRtcChatMesh } from '../src/features/room/webrtc-chat-mesh'
import { RoomView } from '../src/features/room/RoomView'
import { RoomViewDesktop } from '../src/features/room/RoomViewDesktop'
import type { RoomJoinedPayload, RoomSocketClient } from '../src/features/room/types'
import { RECONNECT_SESSION_STORAGE_KEY, UI_COPY } from '../src/features/room/constants'
import { METRICS_ERROR_CODES } from '../src/features/admin/adminApi'

const joined: RoomJoinedPayload = {
  roomId: 'room-12', participantId: 'guest', participantNickname: 'Guest', reconnectToken: 'token',
  hostId: 'host', expiresAt: 100_000, soloDeadlineAt: null, participantCount: 2, reconnectingCount: 0,
  hasPassword: false, peers: [{ participantId: 'host', nickname: 'Host', isHost: true }],
}

function socketHarness() {
  const handlers: Record<string, (payload?: unknown) => void> = {}
  const methods: Record<string, ReturnType<typeof vi.fn>> = {}
  const socket = new Proxy({}, {
    get: (_target, property) => String(property).startsWith('on')
      ? (handler: (payload?: unknown) => void) => { handlers[String(property)] = handler }
      : (methods[String(property)] ??= vi.fn()),
  }) as RoomSocketClient
  return { socket, handlers, methods }
}

afterEach(() => {
  cleanup()
  sessionStorage.clear()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('Phase 12 state behavior', () => {
  it('keeps nickname guidance aligned with the accepted dot and single-space syntax', () => {
    expect(UI_COPY.INVALID_NICKNAME).toBe(
      'Nickname must be 3–24 characters (letters, numbers, single spaces, ., - or _).',
    )
  })

  it('T12.4-08 normalizes absent/zero counts and applies later membership payloads', () => {
    const initial = createInitialRoomSessionState()
    expect(initial.reconnectingCount).toBe(0)
    const noCount = withRoomJoined(initial, { ...joined, reconnectingCount: undefined })
    expect(noCount.reconnectingCount).toBe(0)
    const resumed = withSessionResumed(noCount, { ...joined, reconnectingCount: 2, hostReconnectGraceDeadlineAt: 9000 })
    expect(resumed.reconnectingCount).toBe(2)
    const peerJoined = withPeerJoined(resumed, { participantId: 'new-peer', participantCount: 3, reconnectingCount: 0, nickname: 'New' })
    expect(withPeerLeft(peerJoined, { participantId: 'new-peer', participantCount: 2, reconnectingCount: 1, reason: 'disconnect' }).reconnectingCount).toBe(1)
    for (const malformed of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const malformedState = withPeerJoined(resumed, {
        participantId: 'malformed',
        participantCount: 3,
        reconnectingCount: malformed,
      })
      expect(malformedState.reconnectingCount).toBe(0)
    }
    expect(withRoomEnded(resumed).reconnectingCount).toBe(0)
  })

  it('T12.5-05 uses peer isHost from the payload and derives only the self entry', () => {
    expect(withRoomJoined(createInitialRoomSessionState(), joined).participants).toEqual([
      { participantId: 'host', isHost: true }, { participantId: 'guest', isHost: false },
    ])
    const wireValue = withRoomJoined(createInitialRoomSessionState(), { ...joined, peers: [{ participantId: 'host', nickname: 'Host', isHost: false }] })
    expect(wireValue.participants[0]).toEqual({ participantId: 'host', isHost: false })
  })

  it('T12.8-01 through -10 execute the timer formatter boundary behavior', () => {
    expect(getLifetimeText(660_000, 0)).toBe('Ends in 11m')
    expect(getLifetimeText(600_000, 0)).toBe('Ends in 10:00')
    expect(getLifetimeText(599_000, 0)).toBe('Ends in 09:59')
    expect(getLifetimeText(0, 0)).toBeNull()
    expect(getSoloWaitingText(600_000, 0)).toBe('Solo room expires if no guest joins in 10m')
    expect(getSoloWaitingText(0, 0)).toBeNull()
    expect(getHostReconnectGraceText(600_000, 0)).toBe('Host disconnected · reconnect window 10:00')
    expect(getHostReconnectGraceText(0, 0)).toBeNull()
    expect(getHostReconnectGraceText(Number.NaN, 0)).toBeNull()
  })
})

it('T12.8-admin keeps the frontend metrics error-key contract complete', () => {
  expect(METRICS_ERROR_CODES).toEqual([
    'RATE_LIMITED',
    'INVALID_PASSWORD',
    'ROOM_NOT_FOUND',
    'ROOM_FULL',
    'NOT_AUTHORIZED',
    'RECONNECT_TOKEN_STALE',
    'HOST_RECONNECT_WINDOW_EXPIRED',
  ])
})

it('T12.3-BC advertises session_resumed support on automatic resume', () => {
  sessionStorage.setItem(
    RECONNECT_SESSION_STORAGE_KEY,
    JSON.stringify({ roomId: 'room-12', reconnectToken: 'stored-token' }),
  )
  const { socket, handlers, methods } = socketHarness()
  renderHook(() => useVaporRoom({ createSocketClient: () => socket }))
  act(() => handlers.onConnect())
  expect(methods.emitResumeSession).toHaveBeenCalledWith({
    roomId: 'room-12',
    reconnectToken: 'stored-token',
    supportsSessionResumed: true,
  })
})

describe('Phase 12 resume errors', () => {
  it.each(['RECONNECT_TOKEN_STALE', 'HOST_RECONNECT_WINDOW_EXPIRED'] as const)(
    'T12.3-12/13/14 clears session state when %s arrives in a visible room', (code) => {
      const { socket, handlers } = socketHarness()
      const { result } = renderHook(() => useVaporRoom({ createSocketClient: () => socket }))
      act(() => handlers.onRoomJoined(joined))
      const removeItem = vi.spyOn(Storage.prototype, 'removeItem')
      act(() => handlers.onError({ code }))
      expect(result.current.state.screen).toBe('room-ended')
      expect(result.current.state.participantId).toBeNull()
      expect(result.current.state.chatMessages).toEqual([])
      expect(removeItem).toHaveBeenCalled()
      removeItem.mockRestore()
    },
  )
})

describe('Phase 12 peer-left repair', () => {
  it('T12.6-01/03 derives repair peers from the committed membership transition', () => {
    const { socket, handlers } = socketHarness()
    const syncPeers = vi.spyOn(VaporWebRtcChatMesh.prototype, 'syncPeers').mockImplementation(() => undefined)
    const { result } = renderHook(() => useVaporRoom({ createSocketClient: () => socket }))
    act(() => handlers.onRoomJoined(joined))
    syncPeers.mockClear()
    act(() => {
      handlers.onPeerJoined({ participantId: 'new-peer', participantCount: 3, reconnectingCount: 0, nickname: 'New' })
      handlers.onPeerLeft({ participantId: 'host', participantCount: 2, reconnectingCount: 0, reason: 'disconnect' })
    })
    expect(result.current.state.participants.map((participant) => participant.participantId)).toEqual(['guest', 'new-peer'])
    expect(syncPeers).toHaveBeenCalledWith(['new-peer'])
  })

  it('T12.6-02/04/05 runs once under StrictMode and retains last-peer teardown behavior', () => {
    const { socket, handlers } = socketHarness()
    const syncPeers = vi.spyOn(VaporWebRtcChatMesh.prototype, 'syncPeers').mockImplementation(() => undefined)
    const wrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>
    const { result } = renderHook(() => useVaporRoom({ createSocketClient: () => socket }), { wrapper })
    act(() => handlers.onRoomJoined(joined))
    syncPeers.mockClear()
    act(() => handlers.onPeerLeft({ participantId: 'host', participantCount: 1, reconnectingCount: 0, reason: 'kick', soloDeadlineAt: 1234 }))
    expect(syncPeers).not.toHaveBeenCalled()
    expect(result.current.state.connectedPeerCount).toBe(0)
    expect(result.current.state.chatConnectionState).toBe('idle')
    expect(result.current.state.soloDeadlineAt).toBe(1234)
    expect(result.current.state.chatMessages.at(-1)?.text).toContain('was removed')
  })

  it('T12.6-02 batches multiple leaves into one commit-phase repair of the final peer set', () => {
    const { socket, handlers } = socketHarness()
    const syncPeers = vi.spyOn(VaporWebRtcChatMesh.prototype, 'syncPeers').mockImplementation(() => undefined)
    renderHook(() => useVaporRoom({ createSocketClient: () => socket }))
    act(() => handlers.onRoomJoined({
      ...joined,
      participantCount: 4,
      peers: [
        { participantId: 'host', nickname: 'Host', isHost: true },
        { participantId: 'peer-a', nickname: 'A', isHost: false },
        { participantId: 'peer-b', nickname: 'B', isHost: false },
      ],
    }))
    syncPeers.mockClear()
    act(() => {
      handlers.onPeerLeft({ participantId: 'peer-a', participantCount: 3, reconnectingCount: 1, reason: 'disconnect' })
      handlers.onPeerLeft({ participantId: 'host', participantCount: 2, reconnectingCount: 2, reason: 'disconnect' })
    })
    expect(syncPeers).toHaveBeenCalledOnce()
    expect(syncPeers).toHaveBeenCalledWith(['peer-b'])
  })
})

const roomViewProps = {
  activeRoomId: 'room', activeRoomName: null, participantId: 'host', hostId: 'host', participantCount: 2,
  reconnectingCount: 0,
  participants: [{ participantId: 'host', isHost: true }, { participantId: 'guest', isHost: false }],
  participantNicknames: { host: 'Host', guest: 'Guest' }, roomStatus: 'Connected', chatStatusText: 'Connected',
  soloDeadlineAt: null, expiresAt: null, hostReconnectGraceDeadlineAt: null,
  hasPassword: false, copyFeedback: null, chatMessages: [], chatDraft: '', typingPeerIds: [],
  onCopyRoomId: () => Promise.resolve(), onSendChatMessage: () => undefined, onNotifyTypingStart: () => undefined,
  onLeaveRoom: () => undefined, onKickParticipant: () => undefined,
}

it('T12.5-06 renders exactly one host badge in both roster views', () => {
  const mobile = render(<RoomView {...roomViewProps} />)
  expect(screen.getAllByLabelText('Host')).toHaveLength(1)
  mobile.unmount()
  render(<RoomViewDesktop {...roomViewProps} />)
  expect(screen.getAllByLabelText('Host')).toHaveLength(1)
})

it('T12.4-UI and T12.8-08 render reserved capacity and a distinct ticking host-grace banner', () => {
  vi.useFakeTimers()
  vi.setSystemTime(0)
  const mobile = render(
    <RoomView
      {...roomViewProps}
      reconnectingCount={1}
      hostReconnectGraceDeadlineAt={600_000}
    />,
  )
  expect(screen.getByText('2 connected · 1 reconnecting')).toBeTruthy()
  expect(screen.getByLabelText('Host reconnect grace remaining').textContent).toContain('10:00')
  void act(() => vi.advanceTimersByTime(1000))
  expect(screen.getByLabelText('Host reconnect grace remaining').textContent).toContain('09:59')
  mobile.unmount()

  render(
    <RoomViewDesktop
      {...roomViewProps}
      reconnectingCount={1}
      hostReconnectGraceDeadlineAt={600_000}
    />,
  )
  expect(screen.getByText('2 connected · 1 reconnecting')).toBeTruthy()
  expect(screen.getByLabelText('Host reconnect grace remaining')).toBeTruthy()
})

class MockChannel {
  readyState: RTCDataChannelState
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  close = vi.fn(() => { this.readyState = 'closed' })
  send = vi.fn()
  constructor(readyState: RTCDataChannelState) {
    this.readyState = readyState
  }
}

class MockPeerConnection {
  signalingState: RTCSignalingState = 'stable'
  connectionState: RTCPeerConnectionState = 'connected'
  localDescription: RTCSessionDescription | null = null
  onicecandidate: ((event: RTCPeerConnectionIceEvent) => void) | null = null
  ondatachannel: ((event: RTCDataChannelEvent) => void) | null = null
  onconnectionstatechange: (() => void) | null = null
  createDataChannel = vi.fn(() => new MockChannel('connecting'))
  createOffer = vi.fn(() => Promise.resolve({ type: 'offer' as RTCSdpType, sdp: 'offer-sdp' }))
  setLocalDescription = vi.fn((description: RTCSessionDescriptionInit) => {
    this.localDescription = description as RTCSessionDescription
    return Promise.resolve()
  })
  close = vi.fn()
}

vi.stubGlobal('RTCPeerConnection', MockPeerConnection)

const meshChannels = (mesh: VaporWebRtcChatMesh) => (mesh as unknown as { dataChannels: Map<string, MockChannel> }).dataChannels
const settle = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }
const createMesh = (emitSignalOffer = vi.fn()) => new VaporWebRtcChatMesh({
  roomId: 'room', participantId: 'a',
  signalingEmitter: { emitSignalOffer, emitSignalAnswer: vi.fn(), emitSignalIce: vi.fn() },
  onRemoteMessage: vi.fn(), onRemoteTypingStatus: vi.fn(), onConnectedPeerCountChange: vi.fn(),
})

describe('Phase 12 closed-channel repair', () => {
  it.each(['closed', 'closing'] as const)('T12.7-01/02 replaces a %s channel and sends an offer', async (state) => {
    vi.stubGlobal('RTCPeerConnection', MockPeerConnection)
    const emitSignalOffer = vi.fn()
    const mesh = createMesh(emitSignalOffer)
    const stale = new MockChannel(state)
    meshChannels(mesh).set('b', stale)
    mesh.syncPeers(['b'])
    await settle()
    expect(stale.close).toHaveBeenCalledOnce()
    expect(stale.onmessage).toBeNull()
    expect(meshChannels(mesh).get('b')).not.toBe(stale)
    expect(emitSignalOffer).toHaveBeenCalledWith(expect.objectContaining({ toParticipantId: 'b', sdp: 'offer-sdp' }))
  })

  it.each(['open', 'connecting'] as const)('T12.7-03/04 retains a %s channel', async (state) => {
    vi.stubGlobal('RTCPeerConnection', MockPeerConnection)
    const mesh = createMesh()
    const channel = new MockChannel(state)
    meshChannels(mesh).set('b', channel)
    mesh.syncPeers(['b'])
    await settle()
    expect(channel.close).not.toHaveBeenCalled()
    expect(meshChannels(mesh).get('b')).toBe(channel)
  })

  it('T12.7-05/07 creates a channel and sends after the replacement opens', async () => {
    vi.stubGlobal('RTCPeerConnection', MockPeerConnection)
    const mesh = createMesh()
    mesh.syncPeers(['b'])
    await settle()
    const channel = meshChannels(mesh).get('b')!
    channel.readyState = 'open'
    channel.onopen?.()
    expect(mesh.sendMessage('repaired')).toBe(1)
    expect(channel.send).toHaveBeenCalledWith('repaired')
  })
})
