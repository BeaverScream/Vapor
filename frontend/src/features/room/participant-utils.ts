import type { Participant } from './types'

export function hasParticipant(participants: Participant[], participantId: string): boolean {
  return participants.some((participant) => participant.participantId === participantId)
}

export function getRoomStatus(participantCount: number, hostReconnectGraceDeadlineAt: number | null): string {
  if (hostReconnectGraceDeadlineAt !== null) {
    return 'Host disconnected. Waiting for host to reconnect…'
  }

  return participantCount >= 2 ? 'Connected' : 'Waiting for peers…'
}

export function getConnectionStatusText(socketState: 'connecting' | 'connected' | 'disconnected'): string {
  if (socketState === 'connected') {
    return 'Connected to signaling.'
  }

  if (socketState === 'disconnected') {
    return 'Connection lost. Reconnecting…'
  }

  return 'Connecting…'
}
