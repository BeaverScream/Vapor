export const SIGNALING_URL = import.meta.env.VITE_SIGNALING_URL ?? 'http://localhost:3001'

export const UI_COPY = {
  ROOM_ENDED: 'Room ended. Start a new room to continue.',
  CONNECTING_RETRY: 'Connecting… Try again in a moment.',
  GENERIC_ERROR: 'Could not connect. Try again.',
} as const
