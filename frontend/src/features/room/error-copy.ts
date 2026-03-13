import type { ErrorCode } from './types'
import { UI_COPY } from './constants'
import { SIGNALING_ERROR_CODES } from '@shared'

function formatMmSs(milliseconds: number): string {
  const totalSeconds = Math.ceil(Math.max(milliseconds, 0) / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export function mapErrorCode(rawCode?: string): ErrorCode {
  switch (rawCode) {
    case SIGNALING_ERROR_CODES.ROOM_NOT_FOUND:
    case SIGNALING_ERROR_CODES.ROOM_FULL:
    case SIGNALING_ERROR_CODES.ROOM_EXPIRED:
    case SIGNALING_ERROR_CODES.INVALID_PASSWORD:
    case SIGNALING_ERROR_CODES.RATE_LIMITED:
      return rawCode
    case SIGNALING_ERROR_CODES.PASSWORD_VERSION_MISMATCH:
      return SIGNALING_ERROR_CODES.INVALID_PASSWORD
    default:
      return 'UNKNOWN'
  }
}

export function getErrorMessage(code: ErrorCode): string {
  switch (code) {
    case SIGNALING_ERROR_CODES.ROOM_NOT_FOUND:
      return 'Room not found.'
    case SIGNALING_ERROR_CODES.ROOM_FULL:
      return 'Room is full (5 max).'
    case SIGNALING_ERROR_CODES.ROOM_EXPIRED:
      return 'Room expired.'
    case SIGNALING_ERROR_CODES.INVALID_PASSWORD:
      return 'Password is required or incorrect.'
    case SIGNALING_ERROR_CODES.RATE_LIMITED:
      return 'Too many attempts. Try again later.'
    default:
      return 'Could not connect. Try again.'
  }
}

export function getJoinRateLimitedMessage(remainingMilliseconds?: number): string {
  if (typeof remainingMilliseconds === 'number' && remainingMilliseconds > 0) {
    return `Too many attempts for this room. Try again in ${formatMmSs(remainingMilliseconds)}.`
  }

  return UI_COPY.JOIN_RATE_LIMITED
}
