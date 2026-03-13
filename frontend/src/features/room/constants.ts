import { JOIN_INVALID_ATTEMPT_COOLDOWN_MS } from '@shared'

export const SIGNALING_URL = import.meta.env.VITE_SIGNALING_URL ?? 'http://localhost:3001'
export const JOIN_RATE_LIMIT_COOLDOWN_MS = JOIN_INVALID_ATTEMPT_COOLDOWN_MS

export const UI_COPY = {
  ROOM_ENDED: 'Room ended. Start a new room to continue.',
  ROOM_ENDED_HOST_LEFT: 'Host left the room. Start a new room to continue.',
  ROOM_ENDED_HOST_GRACE_EXPIRED: 'Host did not reconnect in time. Room ended.',
  ROOM_ENDED_TTL_EXPIRED: 'Room reached its maximum duration and ended.',
  ROOM_ENDED_SOLO_TIMEOUT_EXPIRED: 'Room ended because no guest joined in time.',
  CONNECTING_RETRY: 'Connecting… Try again in a moment.',
  GENERIC_ERROR: 'Could not connect. Try again.',
  JOIN_RATE_LIMITED: 'Too many attempts for this room. Try again later.',
} as const
