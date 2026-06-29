import { memo, useEffect, useMemo, useRef, useState, useCallback, type FormEvent, type ChangeEvent } from 'react'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { cn } from '../../lib/utils'
import { getSoloWaitingText, getLifetimeText } from './useVaporRoom'
import type { ChatMessage, Participant } from './types'

interface RoomViewDesktopProps {
  activeRoomId: string
  activeRoomName?: string | null
  participantId: string | null
  hostId: string
  participantCount: number
  participants: Participant[]
  participantNicknames: Record<string, string>
  roomStatus: string
  chatStatusText: string
  soloDeadlineAt: number | null
  expiresAt: number | null
  hasPassword: boolean
  copyFeedback: string | null
  chatMessages: ChatMessage[]
  chatDraft: string
  typingPeerIds: string[]
  onCopyRoomId: () => Promise<void>
  onSendChatMessage: (messageText?: string) => void
  onNotifyTypingStart: () => void
  onLeaveRoom: () => void
  onKickParticipant: (targetParticipantId: string) => void
}

interface ParticipantTone {
  avatar: string
  name: string
}

const PARTICIPANT_TONES: readonly ParticipantTone[] = [
  { avatar: 'bg-cyan-800 text-white', name: 'text-cyan-300 theme-light:text-cyan-800' },
  { avatar: 'bg-emerald-800 text-white', name: 'text-emerald-300 theme-light:text-emerald-800' },
  { avatar: 'bg-amber-700 text-white', name: 'text-amber-300 theme-light:text-amber-800' },
  { avatar: 'bg-indigo-800 text-white', name: 'text-indigo-300 theme-light:text-indigo-800' },
  { avatar: 'bg-rose-800 text-white', name: 'text-rose-300 theme-light:text-rose-800' },
] as const

function hashParticipantId(participantId: string): number {
  let hash = 0
  for (let index = 0; index < participantId.length; index += 1) {
    hash = (hash << 5) - hash + participantId.charCodeAt(index)
    hash |= 0
  }
  return Math.abs(hash)
}

function displayParticipantId(participantId: string): string {
  if (participantId.length <= 14) return participantId
  return `${participantId.slice(0, 6)}...${participantId.slice(-4)}`
}

function getParticipantInitials(participantId: string, participantNicknames: Record<string, string>): string {
  const nickname = participantNicknames[participantId]
  const source = nickname && nickname.trim().length > 0 ? nickname.trim() : participantId
  const words = source.split(/\s+/).filter(Boolean)
  if (words.length >= 2) return `${words[0][0]}${words[1][0]}`.toUpperCase()
  return source.slice(0, 2).toUpperCase()
}

function formatMessageTime(sentAtMs: number): string {
  return new Date(sentAtMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

const CopyIcon = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" width="14" height="14" aria-hidden="true">
    <rect x="6" y="6" width="8.5" height="8.5" rx="2" />
    <path d="M3.5 10H3a1.5 1.5 0 0 1-1.5-1.5v-5A1.5 1.5 0 0 1 3 2h5A1.5 1.5 0 0 1 9.5 3.5V4" />
  </svg>
)

const SendIcon = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="16" height="16" aria-hidden="true">
    <path d="M14.5 1.5 7 9m7.5-7.5-4.8 13-2.7-5.5L1.5 6.3l13-4.8Z" />
  </svg>
)

const CrownIcon = () => (
  <svg viewBox="0 0 16 16" fill="currentColor" width="12" height="12" role="img" aria-label="Host">
    <path d="M2 12.5h12v1.5H2v-1.5zm0-1 2-6.5 4 4 4-4 2 6.5H2z" />
  </svg>
)

const PanelToggleIcon = ({ isOpen }: { isOpen: boolean }) => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="15" height="15" aria-hidden="true">
    <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
    <path d="M10.5 2.5v11" />
    {isOpen
      ? <path d="M11.5 6.5l1.5 1.5-1.5 1.5" />
      : <path d="M13.5 6.5l-1.5 1.5 1.5 1.5" />}
  </svg>
)

const LockClosedIcon = () => (
  <svg viewBox="0 0 14 14" fill="currentColor" width="11" height="11" aria-hidden="true">
    <path d="M7 1a3 3 0 0 0-3 3v1.5H3a1 1 0 0 0-1 1V12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V6.5a1 1 0 0 0-1-1h-1V4a3 3 0 0 0-3-3zm0 1.5A1.5 1.5 0 0 1 8.5 4v1.5h-3V4A1.5 1.5 0 0 1 7 2.5z" />
  </svg>
)

const LockOpenIcon = () => (
  <svg viewBox="0 0 14 14" fill="currentColor" width="11" height="11" aria-hidden="true">
    <path d="M10.5 1a3 3 0 0 1 3 3v1.5H12V4a1.5 1.5 0 0 0-3 0v1.5H10a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6.5a1 1 0 0 1 1-1h5.5V4a3 3 0 0 1 3-3z" />
  </svg>
)

interface PeerDiagnostics {
  connectionState: string
  channelState: string
  prevBytesReceived: number
  prevBytesSent: number
  prevTimestampMs: number
  bitrateRxKbps: number | null
  bitrateTxKbps: number | null
}

const DiagnosticsOverlay = memo(function DiagnosticsOverlay() {
  const [socketLatencyMs, setSocketLatencyMs] = useState<number | null>(null)
  const [peers, setPeers] = useState<Record<string, PeerDiagnostics>>({})

  useEffect(() => {
    const onLatency = (event: Event): void => {
      const { latencyMs } = (event as CustomEvent<{ latencyMs: number }>).detail
      setSocketLatencyMs(latencyMs)
    }

    const onWebRtcState = (event: Event): void => {
      const detail = (event as CustomEvent<Record<string, unknown>>).detail
      const peerId = typeof detail.peerId === 'string' ? detail.peerId : 'unknown'

      setPeers((prev) => {
        const existing: PeerDiagnostics = prev[peerId] ?? {
          connectionState: '—',
          channelState: '—',
          prevBytesReceived: 0,
          prevBytesSent: 0,
          prevTimestampMs: 0,
          bitrateRxKbps: null,
          bitrateTxKbps: null,
        }

        const stateText = typeof detail.state === 'string' ? detail.state : '—'

        if (detail.kind === 'peer_connection_state') return { ...prev, [peerId]: { ...existing, connectionState: stateText } }
        if (detail.kind === 'data_channel_state') return { ...prev, [peerId]: { ...existing, channelState: stateText } }

        if (detail.kind === 'bitrate_stats') {
          const bytesReceived = Number(detail.bytesReceived ?? 0)
          const bytesSent = Number(detail.bytesSent ?? 0)
          const timestampMs = Number(detail.timestampMs ?? 0)
          const deltaMs = timestampMs - existing.prevTimestampMs

          let bitrateRxKbps = existing.bitrateRxKbps
          let bitrateTxKbps = existing.bitrateTxKbps

          if (deltaMs > 0 && existing.prevTimestampMs > 0) {
            bitrateRxKbps = Math.round(((bytesReceived - existing.prevBytesReceived) * 8) / deltaMs)
            bitrateTxKbps = Math.round(((bytesSent - existing.prevBytesSent) * 8) / deltaMs)
          }

          return {
            ...prev,
            [peerId]: { ...existing, prevBytesReceived: bytesReceived, prevBytesSent: bytesSent, prevTimestampMs: timestampMs, bitrateRxKbps, bitrateTxKbps },
          }
        }

        return prev
      })
    }

    window.addEventListener('vapor:socket-latency', onLatency)
    window.addEventListener('vapor:webrtc-state', onWebRtcState)
    return () => {
      window.removeEventListener('vapor:socket-latency', onLatency)
      window.removeEventListener('vapor:webrtc-state', onWebRtcState)
    }
  }, [])

  const peerEntries = Object.entries(peers)

  return (
    <div className="fixed bottom-4 right-4 z-50 min-w-56 rounded-lg border border-white/20 bg-black/85 p-3 font-mono text-[11px] leading-relaxed text-green-400 backdrop-blur-sm">
      <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-green-300">Diagnostics</p>
      <p><span className="text-white/50">socket: </span>{socketLatencyMs !== null ? `${socketLatencyMs}ms` : '—'}</p>
      {peerEntries.length === 0 ? (
        <p className="mt-1 text-white/40">no peers</p>
      ) : (
        peerEntries.map(([peerId, diag]) => (
          <div key={peerId} className="mt-1.5 border-t border-white/10 pt-1.5">
            <p className="text-green-300">{peerId.slice(0, 8)}…</p>
            <p><span className="text-white/50">conn: </span>{diag.connectionState}</p>
            <p><span className="text-white/50">ch: </span>{diag.channelState}</p>
            {diag.bitrateRxKbps !== null && (
              <p><span className="text-white/50">rate: </span>↓{diag.bitrateRxKbps}kbps ↑{diag.bitrateTxKbps}kbps</p>
            )}
          </div>
        ))
      )}
      <p className="mt-2 text-[9px] text-white/25">Ctrl+Shift+D to close</p>
    </div>
  )
})

const SoloWaitingChip = memo(function SoloWaitingChip({ soloDeadlineAt }: { soloDeadlineAt: number | null }) {
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    if (!soloDeadlineAt) return
    const id = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [soloDeadlineAt])

  const text = getSoloWaitingText(soloDeadlineAt, nowMs)
  if (!text) return null
  return (
    <span className="rounded-full border border-warning-line bg-warning px-2.5 py-1 text-[11px] font-medium text-warning-foreground">
      {text}
    </span>
  )
})

const RoomLifetimeChip = memo(function RoomLifetimeChip({ expiresAt }: { expiresAt: number | null }) {
  const [nowMs, setNowMs] = useState(() => Date.now())

  useEffect(() => {
    if (!expiresAt) return
    const id = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [expiresAt])

  if (!expiresAt) return null
  const text = getLifetimeText(expiresAt, nowMs)
  if (!text) return null
  return (
    <span className="rounded-full border border-border bg-secondary/60 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
      {text}
    </span>
  )
})

interface MessageFeedProps {
  chatMessages: ChatMessage[]
  participantNicknames: Record<string, string>
  participantId: string | null
  hostId: string
  getTone: (participantId: string) => ParticipantTone
}

const MessageFeed = memo(function MessageFeed({ chatMessages, participantNicknames, participantId, hostId, getTone }: MessageFeedProps) {
  const feedEndRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ block: 'end' })
  }, [chatMessages.length])

  if (chatMessages.length === 0) {
    return (
      <div className="flex min-h-32 flex-1 items-center justify-center rounded-2xl border border-border bg-background/45 p-3">
        <p className="text-center text-xs text-muted-foreground">No messages yet. Say hi when peer channels connect.</p>
      </div>
    )
  }

  return (
    <div className="vapor-scroll min-h-32 flex-1 overflow-y-auto rounded-2xl border border-border bg-background/45 p-3">
      <ul className="grid gap-3">
        {chatMessages.map((message) => {
          if (message.direction === 'system') {
            return (
              <li key={message.messageId} className="flex items-center gap-2 py-0.5">
                <div className="h-px flex-1 bg-border" />
                <span className="text-[11px] text-muted-foreground">{message.text}</span>
                <div className="h-px flex-1 bg-border" />
              </li>
            )
          }

          const isOutgoing = message.direction === 'outgoing'
          const senderName = participantNicknames[message.senderParticipantId] ?? displayParticipantId(message.senderParticipantId)
          const outgoingLabel = participantId && participantNicknames[participantId]
            ? `You (${participantNicknames[participantId]})`
            : 'You'

          return (
            <li
              key={message.messageId}
              className={cn('flex min-w-0 max-w-[85%] flex-col gap-1', isOutgoing ? 'ml-auto items-end' : 'mr-auto items-start')}
            >
              <p className="flex items-center gap-1 px-1 text-[11px] text-muted-foreground">
                {isOutgoing ? (
                  <span className="font-semibold">{outgoingLabel}</span>
                ) : (
                  <span className={cn('font-semibold', getTone(message.senderParticipantId).name)} title={message.senderParticipantId}>
                    {senderName}
                  </span>
                )}
                {message.senderParticipantId === hostId && (
                  <span className="text-warning-foreground"><CrownIcon /></span>
                )}
                <span aria-hidden="true"> · </span>
                {formatMessageTime(message.sentAtMs)}
              </p>
              <p
                className={cn(
                  'max-w-full whitespace-pre-wrap [overflow-wrap:anywhere] rounded-2xl px-4 py-2.5 text-sm',
                  isOutgoing
                    ? 'rounded-tr-md bg-bubble-out text-bubble-out-foreground'
                    : 'rounded-tl-md border border-border bg-card shadow-xs',
                )}
              >
                {message.text}
              </p>
            </li>
          )
        })}
      </ul>
      <div ref={feedEndRef} />
    </div>
  )
})

export const RoomViewDesktop = memo(function RoomViewDesktop({
  activeRoomId,
  activeRoomName,
  participantId,
  hostId,
  participantCount,
  participants,
  participantNicknames,
  roomStatus,
  chatStatusText,
  soloDeadlineAt,
  expiresAt,
  hasPassword,
  copyFeedback,
  chatMessages,
  chatDraft,
  typingPeerIds,
  onCopyRoomId,
  onSendChatMessage,
  onNotifyTypingStart,
  onLeaveRoom,
  onKickParticipant,
}: RoomViewDesktopProps) {
  const [isPanelOpen, setIsPanelOpen] = useState(true)
  const [localChatDraft, setLocalChatDraft] = useState(chatDraft)
  const [isDiagnosticsVisible, setIsDiagnosticsVisible] = useState(false)

  const isLocalUserHost = useMemo(
    () => participants.some((p) => p.participantId === participantId && p.isHost),
    [participants, participantId],
  )

  const participantToneMap = useMemo((): Map<string, ParticipantTone> => {
    const map = new Map<string, ParticipantTone>()
    const used = new Set<number>()
    for (const p of participants) {
      let idx = hashParticipantId(p.participantId) % PARTICIPANT_TONES.length
      while (used.has(idx)) idx = (idx + 1) % PARTICIPANT_TONES.length
      used.add(idx)
      map.set(p.participantId, PARTICIPANT_TONES[idx])
    }
    return map
  }, [participants])

  const getTone = useCallback(
    (pid: string): ParticipantTone =>
      participantToneMap.get(pid) ?? PARTICIPANT_TONES[hashParticipantId(pid) % PARTICIPANT_TONES.length],
    [participantToneMap],
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.ctrlKey && event.shiftKey && event.key === 'D') {
        event.preventDefault()
        setIsDiagnosticsVisible((prev) => !prev)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    setLocalChatDraft(chatDraft)
  }, [chatDraft])

  const sendDisabled = useMemo(
    () => localChatDraft.trim().length === 0 || participantId === null,
    [localChatDraft, participantId],
  )

  const typingText = useMemo(() => {
    if (typingPeerIds.length === 0) return null
    const names = typingPeerIds.map((id) => participantNicknames[id] ?? displayParticipantId(id))
    if (names.length === 1) return `${names[0]} is typing…`
    if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`
    return `${names[0]} and ${names.length - 1} others are typing…`
  }, [typingPeerIds, participantNicknames])

  const handleInputChange = useCallback((event: ChangeEvent<HTMLInputElement>): void => {
    setLocalChatDraft(event.target.value)
    if (event.target.value.length > 0) onNotifyTypingStart()
  }, [onNotifyTypingStart])

  const handleChatSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const trimmedMessage = localChatDraft.trim()
    if (!trimmedMessage) return
    onSendChatMessage(trimmedMessage)
    setLocalChatDraft('')
  }

  return (
    <>
      <div className="relative z-10 mx-auto mt-16 flex w-full min-w-[48rem] max-w-4xl flex-1 min-h-0 flex-col gap-0 rounded-2xl border border-border bg-card/80 shadow-lg backdrop-blur-md">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-4">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Session ID</p>
            {activeRoomName ? (
              <h2 className="font-display mt-1 text-xl font-semibold break-all">
                {activeRoomName} <span className="text-muted-foreground">· #{activeRoomId}</span>
              </h2>
            ) : (
              <h2 className="font-display mt-1 text-xl font-semibold break-all">#{activeRoomId}</h2>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-status px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-status-foreground">
              <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-status-foreground" />
              {roomStatus}
            </span>

            <button
              type="button"
              onClick={() => setIsPanelOpen((p) => !p)}
              aria-pressed={isPanelOpen}
              aria-label={isPanelOpen ? 'Hide participant panel' : 'Show participant panel'}
              className="flex items-center justify-center rounded-lg border border-border bg-secondary/60 p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <PanelToggleIcon isOpen={isPanelOpen} />
            </button>
          </div>
        </div>

        {/* Status chips row */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-6 py-2.5">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/60 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
            {hasPassword ? <LockClosedIcon /> : <LockOpenIcon />}
            {hasPassword ? 'Protected' : 'Open'}
          </span>
          <SoloWaitingChip soloDeadlineAt={soloDeadlineAt} />
          <RoomLifetimeChip expiresAt={expiresAt} />
          <Button type="button" variant="ghost" size="sm" onClick={() => { void onCopyRoomId() }} aria-label="Copy room ID" className="ml-auto min-h-9">
            <CopyIcon />
            Copy ID
          </Button>
          {copyFeedback && (
            <span className="text-xs text-muted-foreground" aria-live="polite">{copyFeedback}</span>
          )}
        </div>

        {/* Body: chat + optional participant panel */}
        <div className="flex min-h-0 flex-1">
          {/* Chat column */}
          <div className="flex min-h-0 flex-1 flex-col gap-3 p-6">
            <p className="text-xs text-muted-foreground" aria-live="polite" aria-label="Chat status">
              {chatStatusText}
            </p>

            <MessageFeed
              chatMessages={chatMessages}
              participantNicknames={participantNicknames}
              participantId={participantId}
              hostId={hostId}
              getTone={getTone}
            />

            {typingText && (
              <p className="min-h-4 text-xs italic text-muted-foreground" aria-live="polite">
                {typingText}
              </p>
            )}

            <form className="flex items-center gap-2" onSubmit={handleChatSubmit}>
              <label htmlFor="chat-input-desktop" className="sr-only">Send a private chat message</label>
              <Input
                id="chat-input-desktop"
                value={localChatDraft}
                maxLength={500}
                onChange={handleInputChange}
                placeholder="Type a secure message…"
                autoComplete="off"
              />
              <Button
                type="submit"
                size="icon"
                aria-label="Send message"
                disabled={sendDisabled}
                className="shrink-0 bg-foreground text-background hover:bg-foreground/90"
              >
                <SendIcon />
              </Button>
            </form>

            <Button type="button" variant="destructive" className="w-full font-semibold" onClick={onLeaveRoom}>
              Leave room
            </Button>
          </div>

          {/* Participant panel */}
          {isPanelOpen && (
            <aside
              aria-label="Room participants"
              className="flex w-72 shrink-0 flex-col gap-0 border-l border-border"
            >
              <div className="border-b border-border px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  {participantCount} {participantCount === 1 ? 'Participant' : 'Participants'}
                </p>
              </div>
              <ul className="vapor-scroll flex-1 overflow-y-auto">
                {participants.map((participant, index) => {
                  const isLocalUser = participant.participantId === participantId
                  const tone = getTone(participant.participantId)
                  const rawName = participantNicknames[participant.participantId] ?? displayParticipantId(participant.participantId)
                  const displayName = isLocalUser && participant.isHost
                    ? 'You (Host)'
                    : isLocalUser
                    ? `You (${rawName})`
                    : rawName

                  return (
                    <li
                      key={participant.participantId}
                      className={cn(
                        'flex items-center gap-2.5 px-4 py-3',
                        index > 0 && 'border-t border-border',
                      )}
                    >
                      <span
                        className={cn('flex size-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold', tone.avatar)}
                        title={participant.participantId}
                      >
                        {getParticipantInitials(participant.participantId, participantNicknames)}
                      </span>

                      <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
                        {displayName}
                      </span>

                      {participant.isHost && (
                        <span className="text-warning-foreground shrink-0"><CrownIcon /></span>
                      )}

                      {isLocalUserHost && !isLocalUser && (
                        <button
                          type="button"
                          onClick={() => onKickParticipant(participant.participantId)}
                          className="min-h-8 min-w-[3.25rem] shrink-0 rounded-full border border-destructive/30 bg-destructive/10 px-2 py-0.5 text-[10px] font-medium text-destructive hover:bg-destructive/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-destructive"
                          aria-label={`Remove ${rawName} from room`}
                        >
                          Remove
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
            </aside>
          )}
        </div>
      </div>

      {isDiagnosticsVisible && <DiagnosticsOverlay />}
    </>
  )
})
