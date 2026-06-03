import { memo, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Button } from '../../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card'
import { Input } from '../../components/ui/input'
import { cn } from '../../lib/utils'
import type { ChatMessage, Participant } from './types'

interface RoomViewProps {
  activeRoomId: string
  participantId: string | null
  participantCount: number
  participants: Participant[]
  participantNicknames: Record<string, string>
  roomStatus: string
  chatStatusText: string
  soloWaitingChipText: string | null
  roomLifetimeText: string | null
  copyFeedback: string | null
  chatMessages: ChatMessage[]
  chatDraft: string
  onCopyRoomId: () => Promise<void>
  onSendChatMessage: (messageText?: string) => void
  onLeaveRoom: () => void
}

const PARTICIPANT_TONES = [
  'border-cyan-200/45 bg-cyan-200/10 text-cyan-100',
  'border-emerald-200/45 bg-emerald-200/10 text-emerald-100',
  'border-amber-200/45 bg-amber-200/10 text-amber-100',
  'border-indigo-200/45 bg-indigo-200/10 text-indigo-100',
  'border-rose-200/45 bg-rose-200/10 text-rose-100',
] as const

function hashParticipantId(participantId: string): number {
  let hash = 0
  for (let index = 0; index < participantId.length; index += 1) {
    hash = (hash << 5) - hash + participantId.charCodeAt(index)
    hash |= 0
  }

  return Math.abs(hash)
}

function getParticipantTone(participantId: string): string {
  return PARTICIPANT_TONES[hashParticipantId(participantId) % PARTICIPANT_TONES.length]
}

function displayParticipantId(participantId: string): string {
  if (participantId.length <= 14) {
    return participantId
  }

  return `${participantId.slice(0, 6)}...${participantId.slice(-4)}`
}

interface ParticipantsRosterProps {
  participants: Participant[]
  participantId: string | null
  participantNicknames: Record<string, string>
}

const ParticipantsRoster = memo(function ParticipantsRoster({ participants, participantId, participantNicknames }: ParticipantsRosterProps) {
  return (
    <ul className="vapor-scroll flex max-h-40 flex-wrap gap-2 overflow-y-auto rounded-md border border-white/15 bg-background/35 p-3">
      {participants.map((participant) => {
        const roleText =
          participant.participantId === participantId
            ? participant.isHost
              ? 'You (Host)'
              : 'You'
            : participant.isHost
              ? 'Host'
              : null

        const toneClassName = getParticipantTone(participant.participantId)
        const displayName = participantNicknames[participant.participantId] ?? displayParticipantId(participant.participantId)

        return (
          <li
            key={participant.participantId}
            className="inline-flex max-w-full items-center gap-2 rounded-full border border-white/20 bg-background/55 px-2.5 py-1.5"
          >
            <span className={cn('rounded-full border px-2 py-0.5 text-[11px] tracking-wide', toneClassName)} title={participant.participantId}>
              {displayName}
            </span>

            {roleText ? (
              <span className="rounded-full border border-white/25 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                {roleText}
              </span>
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
}

const MessageFeed = memo(function MessageFeed({ chatMessages, participantNicknames }: MessageFeedProps) {
  const feedEndRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ block: 'end' })
  }, [chatMessages.length])

  if (chatMessages.length === 0) {
    return (
      <div className="flex h-[min(58vh,32rem)] min-h-72 items-center justify-center rounded-md border border-white/20 bg-background/35 p-3">
        <p className="text-center text-xs text-muted-foreground">No messages yet. Say hi when peer channels connect.</p>
      </div>
    )
  }

  return (
    <div className="vapor-scroll h-[min(58vh,32rem)] min-h-72 overflow-y-auto rounded-md border border-white/20 bg-background/35 p-3">
      <ul className="grid gap-2">
        {chatMessages.map((message) => {
          const isOutgoing = message.direction === 'outgoing'
          const senderName = participantNicknames[message.senderParticipantId] ?? displayParticipantId(message.senderParticipantId)

          return (
            <li
              key={message.messageId}
              className={
                isOutgoing
                  ? 'ml-auto max-w-[85%] rounded-xl border border-primary/50 bg-primary/20 px-3 py-2 text-sm'
                  : 'mr-auto max-w-[85%] rounded-xl border border-white/20 bg-background/70 px-3 py-2 text-sm'
              }
            >
              <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                {isOutgoing ? (
                  'You'
                ) : (
                  <span
                    className={cn(
                      'inline-flex rounded-full border px-2 py-0.5 text-[10px] normal-case tracking-normal',
                      getParticipantTone(message.senderParticipantId),
                    )}
                    title={message.senderParticipantId}
                  >
                    {senderName}
                  </span>
                )}
              </p>
              <p className="whitespace-pre-wrap break-words">{message.text}</p>
            </li>
          )
        })}
      </ul>
      <div ref={feedEndRef} />
    </div>
  )
})

export function RoomView({
  activeRoomId,
  participantId,
  participantCount,
  participants,
  participantNicknames,
  roomStatus,
  chatStatusText,
  soloWaitingChipText,
  roomLifetimeText,
  copyFeedback,
  chatMessages,
  chatDraft,
  onCopyRoomId,
  onSendChatMessage,
  onLeaveRoom,
}: RoomViewProps) {
  const [isParticipantListOpen, setIsParticipantListOpen] = useState(false)
  const [localChatDraft, setLocalChatDraft] = useState(chatDraft)

  useEffect(() => {
    setLocalChatDraft(chatDraft)
  }, [chatDraft])

  const sendDisabled = useMemo(
    () => localChatDraft.trim().length === 0 || participantId === null,
    [localChatDraft, participantId],
  )

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
    <Card className="relative z-10 w-full max-w-4xl border-white/30 bg-card/75 backdrop-blur-md">
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-lg sm:text-xl">Room {activeRoomId}</CardTitle>
            <CardDescription>{roomStatus}</CardDescription>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            {soloWaitingChipText && (
              <span className="rounded-full border border-amber-300/60 bg-amber-200/15 px-2 py-1 text-[10px] font-medium text-amber-100">
                {soloWaitingChipText}
              </span>
            )}
            {roomLifetimeText && (
              <span className="rounded-full border border-white/20 bg-white/5 px-2 py-1 text-[10px] font-medium text-muted-foreground">
                {roomLifetimeText}
              </span>
            )}
            <Button type="button" variant="ghost" size="sm" onClick={onCopyRoomId}>
              Copy room ID
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="grid gap-4">
        <p className="min-h-4 text-xs text-muted-foreground" aria-live="polite">
          {copyFeedback ?? ' '}
        </p>

        <section className="grid gap-3 rounded-md border border-white/20 bg-background/25 p-3" aria-label="Room participants">
          <h2 className="sr-only">Participants</h2>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">{participantCount}/5 participants</p>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-expanded={isParticipantListOpen}
              aria-controls="participants-roster"
              onClick={() => setIsParticipantListOpen((previous) => !previous)}
            >
              {isParticipantListOpen ? 'Hide participants' : 'Show participants'}
            </Button>
          </div>

          <div
            className={cn(
              'grid transition-[grid-template-rows,opacity] duration-200 ease-out',
              isParticipantListOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
            )}
          >
            <div className="overflow-hidden">
              <div id="participants-roster" className={cn(!isParticipantListOpen && 'pointer-events-none')}>
                <ParticipantsRoster participants={participants} participantId={participantId} participantNicknames={participantNicknames} />
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-3" aria-label="Peer chat">
          <h2 className="sr-only">Private peer chat</h2>
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {chatStatusText}
          </p>

          <MessageFeed chatMessages={chatMessages} participantNicknames={participantNicknames} />

          <form className="flex gap-2" onSubmit={handleChatSubmit}>
            <label htmlFor="chat-input" className="sr-only">
              Send a private chat message
            </label>
            <Input
              id="chat-input"
              value={localChatDraft}
              maxLength={500}
              onChange={(event) => setLocalChatDraft(event.target.value)}
              placeholder="Type a private message"
              autoComplete="off"
              className="h-11"
            />
            <Button type="submit" variant="secondary" className="h-11 min-w-20" disabled={sendDisabled}>
              Send
            </Button>
          </form>
        </section>

        <Button type="button" onClick={onLeaveRoom}>
          Leave room
        </Button>
      </CardContent>
    </Card>
  )
}
