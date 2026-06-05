import { RECONNECT_SESSION_STORAGE_KEY } from '../constants'

export type StoredReconnectSession = {
  roomId: string
  reconnectToken: string
}

export function readStoredReconnectSession(): StoredReconnectSession | null {
  try {
    const rawValue = window.sessionStorage.getItem(RECONNECT_SESSION_STORAGE_KEY)
    if (!rawValue) return null

    const parsed = JSON.parse(rawValue) as Partial<StoredReconnectSession>
    if (typeof parsed.roomId !== 'string' || typeof parsed.reconnectToken !== 'string') return null

    const roomId = parsed.roomId.trim()
    const reconnectToken = parsed.reconnectToken.trim()
    if (!roomId || !reconnectToken) return null

    return { roomId, reconnectToken }
  } catch {
    return null
  }
}

export function writeStoredReconnectSession(payload: {
  roomId: string
  reconnectToken: string | null
}): void {
  try {
    if (!payload.reconnectToken) {
      window.sessionStorage.removeItem(RECONNECT_SESSION_STORAGE_KEY)
      return
    }
    window.sessionStorage.setItem(
      RECONNECT_SESSION_STORAGE_KEY,
      JSON.stringify({ roomId: payload.roomId, reconnectToken: payload.reconnectToken }),
    )
  } catch {
    return
  }
}

export function clearStoredReconnectSession(): void {
  try {
    window.sessionStorage.removeItem(RECONNECT_SESSION_STORAGE_KEY)
  } catch {
    return
  }
}

export function useSessionPersistence() {
  return {
    readStoredReconnectSession,
    writeStoredReconnectSession,
    clearStoredReconnectSession,
  }
}
