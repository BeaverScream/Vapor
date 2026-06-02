import { JOIN_INVALID_ATTEMPT_COOLDOWN_MS } from '@shared'

export const SIGNALING_URL = import.meta.env.VITE_SIGNALING_URL ?? 'http://localhost:3001'
export const JOIN_RATE_LIMIT_COOLDOWN_MS = JOIN_INVALID_ATTEMPT_COOLDOWN_MS
export const RECONNECT_SESSION_STORAGE_KEY = 'vapor.reconnect.session'

function parseIceUrlList(rawValue: string | undefined, fallback: string[]): string[] {
  if (!rawValue) {
    return fallback
  }

  const parsed = rawValue
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0)

  return parsed.length > 0 ? parsed : fallback
}

function buildIceServers(): RTCIceServer[] {
  const stunUrls = parseIceUrlList(import.meta.env.VITE_STUN_URLS, ['stun:stun.l.google.com:19302'])
  const iceServers: RTCIceServer[] = [{ urls: stunUrls }]

  const turnUrls = parseIceUrlList(import.meta.env.VITE_TURN_URLS, [])
  const turnUsername = import.meta.env.VITE_TURN_USERNAME
  const turnCredential = import.meta.env.VITE_TURN_CREDENTIAL

  if (turnUrls.length > 0 && turnUsername && turnCredential) {
    iceServers.push({
      urls: turnUrls,
      username: turnUsername,
      credential: turnCredential,
    })
  }

  return iceServers
}

export const WEBRTC_ICE_SERVERS = buildIceServers()

export const UI_COPY = {
  ROOM_ENDED: 'Room ended. Start a new room to continue.',
  ROOM_ENDED_HOST_LEFT: 'Host left the room. Start a new room to continue.',
  ROOM_ENDED_HOST_GRACE_EXPIRED: 'Host did not reconnect in time. Room ended.',
  ROOM_ENDED_TTL_EXPIRED: 'Room reached its maximum duration and ended.',
  ROOM_ENDED_SOLO_TIMEOUT_EXPIRED: 'Room ended because no guest joined in time.',
  CONNECTING_RETRY: 'Connecting… Try again in a moment.',
  GENERIC_ERROR: 'Could not connect. Try again.',
  JOIN_RATE_LIMITED: 'Too many attempts for this room. Try again later.',
  SOLO_HOST_WARNING: 'Solo room expires if no guest joins in',
} as const
