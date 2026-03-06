import type { ErrorCode } from './types'

export function mapErrorCode(rawCode?: string): ErrorCode {
  switch (rawCode) {
    case 'ROOM_NOT_FOUND':
    case 'ROOM_FULL':
    case 'ROOM_EXPIRED':
    case 'INVALID_PASSWORD':
    case 'RATE_LIMITED':
      return rawCode
    default:
      return 'UNKNOWN'
  }
}

export function getErrorMessage(code: ErrorCode): string {
  switch (code) {
    case 'ROOM_NOT_FOUND':
      return 'Room not found.'
    case 'ROOM_FULL':
      return 'Room is full (5 max).'
    case 'ROOM_EXPIRED':
      return 'Room expired.'
    case 'INVALID_PASSWORD':
      return 'Incorrect password.'
    case 'RATE_LIMITED':
      return 'Too many attempts. Try again later.'
    default:
      return 'Could not connect. Try again.'
  }
}
