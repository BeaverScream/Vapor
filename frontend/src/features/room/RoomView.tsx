import { Button } from '../../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card'
import type { Participant } from './types'

interface RoomViewProps {
  activeRoomId: string
  participantId: string | null
  participantCount: number
  participants: Participant[]
  roomStatus: string
  roomLifetimeText: string | null
  copyFeedback: string | null
  onCopyRoomId: () => Promise<void>
  onLeaveRoom: () => void
}

export function RoomView({
  activeRoomId,
  participantId,
  participantCount,
  participants,
  roomStatus,
  roomLifetimeText,
  copyFeedback,
  onCopyRoomId,
  onLeaveRoom,
}: RoomViewProps) {
  return (
    <Card className="relative z-10 w-full max-w-md border-white/30 bg-card/75 backdrop-blur-md">
      <CardHeader className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-lg">Room {activeRoomId}</CardTitle>
          <div className="flex items-center gap-2">
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
        <CardDescription>{roomStatus}</CardDescription>
      </CardHeader>

      <CardContent className="grid gap-3">
        <p className="min-h-4 text-xs text-muted-foreground" aria-live="polite">
          {copyFeedback ?? ' '}
        </p>

        <p className="text-sm text-muted-foreground">{participantCount}/5 participants</p>

        <ul className="grid gap-2">
          {participants.map((participant) => (
            <li
              key={participant.participantId}
              className="flex items-center gap-2 rounded-md border border-white/25 bg-background/30 px-3 py-2 text-sm"
            >
              <span className="size-2 rounded-full bg-emerald-300" aria-hidden="true" />
              <span>{participant.participantId}</span>
              {participant.participantId === participantId ? (
                <span className="ml-auto rounded-full border border-white/30 px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                  {participant.isHost ? 'You (Host)' : 'You'}
                </span>
              ) : participant.isHost ? (
                <span className="ml-auto rounded-full border border-white/30 px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                  Host
                </span>
              ) : null}
            </li>
          ))}
        </ul>

        <Button type="button" onClick={onLeaveRoom}>
          Leave room
        </Button>
      </CardContent>
    </Card>
  )
}
