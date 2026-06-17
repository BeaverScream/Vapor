import { memo, useEffect, useMemo, useRef, useState, useCallback, type FormEvent, type ChangeEvent } from 'react'
import { Button } from '../../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card'
import { Input } from '../../components/ui/input'
import { cn } from '../../lib/utils'
import { getSoloWaitingText, getLifetimeText } from './useVaporRoom'
import type { ChatMessage, Participant } from './types'

interface RoomViewProps {
  activeRoomId: string
  participantId: string | null
  participantCount: number
  participants: Participant[]
  participantNicknames: Record<string, string>
  roomStatus: string
  chatStatusText: string
  soloHostDeadlineAt: number | null
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
  chip: string
  avatar: string
  name: string
}

// Per-participant identity tones. The avatar chip is a solid fill (white on a
// dark hue) so it reads on any surface. The roster `chip` pill text and the
// message `name` ink, however, sit on the theme surface, so each carries a
// light-on-dark shade by default (dark/blue fields, blue being the default
// theme) and a dark-on-light shade under the `theme-light:` variant — keeping
// nicknames WCAG-AA readable in all three themes (see index.css custom variant).
const PARTICIPANT_TONES: readonly ParticipantTone[] = [
  {
    chip: 'border-cyan-400/30 bg-cyan-400/15 text-cyan-200 theme-light:border-cyan-700/30 theme-light:bg-cyan-700/10 theme-light:text-cyan-800',
    avatar: 'bg-cyan-800 text-white',
    name: 'text-cyan-300 theme-light:text-cyan-800',
  },
  {
    chip: 'border-emerald-400/30 bg-emerald-400/15 text-emerald-200 theme-light:border-emerald-700/30 theme-light:bg-emerald-700/10 theme-light:text-emerald-800',
    avatar: 'bg-emerald-800 text-white',
    name: 'text-emerald-300 theme-light:text-emerald-800',
  },
  {
    chip: 'border-amber-400/30 bg-amber-400/15 text-amber-200 theme-light:border-amber-700/30 theme-light:bg-amber-700/10 theme-light:text-amber-800',
    avatar: 'bg-amber-700 text-white',
    name: 'text-amber-300 theme-light:text-amber-800',
  },
  {
    chip: 'border-indigo-400/30 bg-indigo-400/15 text-indigo-200 theme-light:border-indigo-700/30 theme-light:bg-indigo-700/10 theme-light:text-indigo-800',
    avatar: 'bg-indigo-800 text-white',
    name: 'text-indigo-300 theme-light:text-indigo-800',
  },
  {
    chip: 'border-rose-400/30 bg-rose-400/15 text-rose-200 theme-light:border-rose-700/30 theme-light:bg-rose-700/10 theme-light:text-rose-800',
    avatar: 'bg-rose-800 text-white',
    name: 'text-rose-300 theme-light:text-rose-800',
  },
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
  if (participantId.length <= 14) {
    return participantId
  }

  return `${participantId.slice(0, 6)}...${participantId.slice(-4)}`
}

function getParticipantInitials(participantId: string, participantNicknames: Record<string, string>): string {
  const nickname = participantNicknames[participantId]
  const source = nickname && nickname.trim().length > 0 ? nickname.trim() : participantId
  const words = source.split(/\s+/).filter(Boolean)
  if (words.length >= 2) {
    return `${words[0][0]}${words[1][0]}`.toUpperCase()
  }

  return source.slice(0, 2).toUpperCase()
}

function formatMessageTime(sentAtMs: number): string {
  return new Date(sentAtMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

const ChevronIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="14" height="14" className={className} aria-hidden="true">
    <path d="m4 6 4 4 4-4" />
  </svg>
)

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

interface AvatarStackProps {
  participants: Participant[]
  participantNicknames: Record<string, string>
  participantCount: number
  isOpen: boolean
  onToggle: () => void
  getTone: (participantId: string) => ParticipantTone
}

const MAX_VISIBLE_AVATARS = 4

const AvatarStack = memo(function AvatarStack({ participants, participantNicknames, participantCount, isOpen, onToggle, getTone }: AvatarStackProps) {
  const visibleParticipants = participants.slice(0, MAX_VISIBLE_AVATARS)
  const overflowCount = participants.length - visibleParticipants.length

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={isOpen}
      aria-controls="participants-roster"
      aria-label={isOpen ? 'Hide participants' : 'Show participants'}
      className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-full p-1 transition-colors hover:bg-accent/60 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <span className="flex items-center">
        {visibleParticipants.map((participant, index) => (
          <span
            key={participant.participantId}
            title={participantNicknames[participant.participantId] ?? displayParticipantId(participant.participantId)}
            className={cn(
              'flex size-9 items-center justify-center rounded-full border-2 border-card text-[11px] font-bold',
              index > 0 && '-ml-2.5',
              getTone(participant.participantId).avatar,
            )}
          >
            {getParticipantInitials(participant.participantId, participantNicknames)}
          </span>
        ))}
        {overflowCount > 0 ? (
          <span className="-ml-2.5 flex size-9 items-center justify-center rounded-full border-2 border-card bg-secondary text-[11px] font-semibold text-muted-foreground">
            +{overflowCount}
          </span>
        ) : null}
      </span>

      <span className="flex items-center gap-1.5 pr-2 text-xs font-medium text-muted-foreground">
        {participantCount} online
        <ChevronIcon className={cn('transition-transform duration-200', isOpen && 'rotate-180')} />
      </span>
    </button>
  )
})

interface ParticipantsRosterProps {
  participants: Participant[]
  participantId: string | null
  participantNicknames: Record<string, string>
  isLocalUserHost: boolean
  onKickParticipant: (targetParticipantId: string) => void
  getTone: (participantId: string) => ParticipantTone
}

const ParticipantsRoster = memo(function ParticipantsRoster({ participants, participantId, participantNicknames, isLocalUserHost, onKickParticipant, getTone }: ParticipantsRosterProps) {
  return (
    <ul className="vapor-scroll flex max-h-40 flex-wrap gap-2 overflow-y-auto rounded-2xl border border-border bg-background/45 p-3">
      {participants.map((participant) => {
        const isLocalUser = participant.participantId === participantId
        const roleText = participant.isHost ? 'Host' : null
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
            className="inline-flex max-w-full items-center gap-2 rounded-full border border-border bg-card px-2.5 py-1.5"
          >
            <span className={cn('rounded-full border px-2 py-0.5 text-[11px] font-medium tracking-wide', tone.chip)} title={participant.participantId}>
              {displayName}
            </span>

            {roleText ? (
              <span className="rounded-full bg-foreground/90 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em] text-background">
                {roleText}
              </span>
            ) : null}

            {isLocalUserHost && !isLocalUser ? (
              <button
                type="button"
                onClick={() => onKickParticipant(participant.participantId)}
                className="rounded-full border border-destructive/30 bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive hover:bg-destructive/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-destructive"
                aria-label={`Remove ${rawName} from room`}
              >
                Remove
              </button>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
})

interface MessageFeedProps {
  chatMessages: ChatMessage[]
  participantNicknames: Record<string, string>
  participantId: string | null
  getTone: (participantId: string) => ParticipantTone
}

const MessageFeed = memo(function MessageFeed({ chatMessages, participantNicknames, participantId, getTone }: MessageFeedProps) {
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
              <p className="px-1 text-[11px] text-muted-foreground">
                {isOutgoing ? (
                  <span className="font-semibold">{outgoingLabel}</span>
                ) : (
                  <span className={cn('font-semibold', getTone(message.senderParticipantId).name)} title={message.senderParticipantId}>
                    {senderName}
                  </span>
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

        if (detail.kind === 'peer_connection_state') {
          return { ...prev, [peerId]: { ...existing, connectionState: stateText } }
        }

        if (detail.kind === 'data_channel_state') {
          return { ...prev, [peerId]: { ...existing, channelState: stateText } }
        }

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
            [peerId]: {
              ...existing,
              prevBytesReceived: bytesReceived,
              prevBytesSent: bytesSent,
              prevTimestampMs: timestampMs,
              bitrateRxKbps,
              bitrateTxKbps,
            },
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
      <p>
        <span className="text-white/50">socket: </span>
        {socketLatencyMs !== null ? `${socketLatencyMs}ms` : '—'}
      </p>
      {peerEntries.length === 0 ? (
        <p className="mt-1 text-white/40">no peers</p>
      ) : (
        peerEntries.map(([peerId, diag]) => (
          <div key={peerId} className="mt-1.5 border-t border-white/10 pt-1.5">
            <p className="text-green-300">{peerId.slice(0, 8)}…</p>
            <p>
              <span className="text-white/50">conn: </span>
              {diag.connectionState}
            </p>
            <p>
              <span className="text-white/50">ch: </span>
              {diag.channelState}
            </p>
            {diag.bitrateRxKbps !== null && (
              <p>
                <span className="text-white/50">rate: </span>
                ↓{diag.bitrateRxKbps}kbps ↑{diag.bitrateTxKbps}kbps
              </p>
            )}
          </div>
        ))
      )}
      <p className="mt-2 text-[9px] text-white/25">Ctrl+Shift+D to close</p>
    </div>
  )
})

const SoloWaitingChip = memo(function SoloWaitingChip({ soloHostDeadlineAt }: { soloHostDeadlineAt: number | null }) {
  const [nowMs, setNowMs] = useState(() => Date.now())

  useEffect(() => {
    if (!soloHostDeadlineAt) return
    const id = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [soloHostDeadlineAt])

  const soloWaitingChipText = getSoloWaitingText(soloHostDeadlineAt, nowMs)
  if (!soloWaitingChipText) return null

  return (
    <span className="rounded-full border border-warning-line bg-warning px-2.5 py-1 text-[11px] font-medium text-warning-foreground">
      {soloWaitingChipText}
    </span>
  )
})

const RoomLifetimeChip = memo(function RoomLifetimeChip({ expiresAt }: { expiresAt: number | null }) {
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [isInputFocused, setIsInputFocused] = useState(false)

  useEffect(() => {
    if (!expiresAt) return
    const id = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [expiresAt])

  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') setIsInputFocused(true)
    }
    const onFocusOut = (event: FocusEvent) => {
      const target = event.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') setIsInputFocused(false)
    }
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('focusout', onFocusOut)
    return () => {
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('focusout', onFocusOut)
    }
  }, [])

  if (!expiresAt || isInputFocused) return null

  const text = getLifetimeText(expiresAt, nowMs)
  if (!text) return null

  return (
    <span className="rounded-full border border-border bg-secondary/60 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
      {text}
    </span>
  )
})

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

const RoomSecurityIndicator = memo(function RoomSecurityIndicator({ hasPassword }: { hasPassword: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/60 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
      {hasPassword ? <LockClosedIcon /> : <LockOpenIcon />}
      {hasPassword ? 'Protected' : 'Open'}
    </span>
  )
})

export const RoomView = memo(function RoomView({
  activeRoomId,
  participantId,
  participantCount,
  participants,
  participantNicknames,
  roomStatus,
  chatStatusText,
  soloHostDeadlineAt,
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
}: RoomViewProps) {
  const [isParticipantListOpen, setIsParticipantListOpen] = useState(false)
  const isLocalUserHost = useMemo(
    () => participants.some((p) => p.participantId === participantId && p.isHost),
    [participants, participantId],
  )

  // Collision-aware tone assignment: each active participant gets a unique tone.
  // The hash selects a preferred tone; linear probing resolves conflicts so no
  // two participants share a color regardless of room size or hash collisions.
  const participantToneMap = useMemo((): Map<string, ParticipantTone> => {
    const map = new Map<string, ParticipantTone>()
    const used = new Set<number>()
    for (const p of participants) {
      let idx = hashParticipantId(p.participantId) % PARTICIPANT_TONES.length
      while (used.has(idx)) {
        idx = (idx + 1) % PARTICIPANT_TONES.length
      }
      used.add(idx)
      map.set(p.participantId, PARTICIPANT_TONES[idx])
    }
    return map
  }, [participants])

  // For message history: departed senders aren't in participantToneMap, so fall
  // back to the pure hash (they no longer conflict with active participants).
  const getTone = useCallback(
    (pid: string): ParticipantTone =>
      participantToneMap.get(pid) ?? PARTICIPANT_TONES[hashParticipantId(pid) % PARTICIPANT_TONES.length],
    [participantToneMap],
  )
  const [localChatDraft, setLocalChatDraft] = useState(chatDraft)
  const [isDiagnosticsVisible, setIsDiagnosticsVisible] = useState(false)

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
    if (event.target.value.length > 0) {
      onNotifyTypingStart()
    }
  }, [onNotifyTypingStart])

  const handleChatSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()

    const trimmedMessage = localChatDraft.trim()
    if (!trimmedMessage) {
      return
    }

    onSendChatMessage(trimmedMessage)
    setLocalChatDraft('')
  }

  return (
    <>
    <Card className="vapor-app-frame relative z-10 flex flex-col">
      <CardHeader className="gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Session ID</p>
            <CardTitle className="font-display mt-1.5 text-xl font-semibold break-all sm:text-2xl">#{activeRoomId}</CardTitle>
          </div>

          <span className="inline-flex items-center gap-1.5 rounded-full bg-status px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-status-foreground">
            <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-status-foreground" />
            {roomStatus}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <RoomSecurityIndicator hasPassword={hasPassword} />
          <SoloWaitingChip soloHostDeadlineAt={soloHostDeadlineAt} />
          <RoomLifetimeChip expiresAt={expiresAt} />
          <Button type="button" variant="ghost" size="sm" onClick={() => { void onCopyRoomId() }} aria-label="Copy room ID" className="ml-auto">
            <CopyIcon />
            Copy ID
          </Button>
        </div>
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col gap-4">
        <p className="min-h-4 text-xs text-muted-foreground" aria-live="polite">
          {copyFeedback ?? ' '}
        </p>

        <section className="grid gap-3" aria-label="Room participants">
          <h2 className="sr-only">Participants</h2>

          <AvatarStack
            participants={participants}
            participantNicknames={participantNicknames}
            participantCount={participantCount}
            isOpen={isParticipantListOpen}
            onToggle={() => setIsParticipantListOpen((previous) => !previous)}
            getTone={getTone}
          />

          <div
            className={cn(
              'grid transition-[grid-template-rows,opacity] duration-200 ease-out',
              isParticipantListOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
            )}
          >
            <div className="overflow-hidden">
              <div id="participants-roster" className={cn(!isParticipantListOpen && 'pointer-events-none')}>
                <ParticipantsRoster participants={participants} participantId={participantId} participantNicknames={participantNicknames} isLocalUserHost={isLocalUserHost} onKickParticipant={onKickParticipant} getTone={getTone} />
              </div>
            </div>
          </div>
        </section>

        <section className="flex min-h-0 flex-1 flex-col gap-3" aria-label="Peer chat">
          <h2 className="sr-only">Private peer chat</h2>
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {chatStatusText}
          </p>

          <MessageFeed chatMessages={chatMessages} participantNicknames={participantNicknames} participantId={participantId} getTone={getTone} />

          {typingText && (
            <p className="min-h-4 text-xs text-muted-foreground italic" aria-live="polite">
              {typingText}
            </p>
          )}

          <form className="flex items-center gap-2" onSubmit={handleChatSubmit}>
            <label htmlFor="chat-input" className="sr-only">
              Send a private chat message
            </label>
            <Input
              id="chat-input"
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
        </section>

        <Button type="button" variant="destructive" className="w-full font-semibold" onClick={onLeaveRoom}>
          Leave room
        </Button>
      </CardContent>
    </Card>

    {isDiagnosticsVisible && <DiagnosticsOverlay />}
    </>
  )
})
