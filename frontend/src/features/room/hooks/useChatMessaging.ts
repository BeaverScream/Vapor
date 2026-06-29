import { useCallback, useRef } from 'react'
import { CHAT_HISTORY_STORAGE_KEY_PREFIX } from '../constants'
import { withAppendedChatMessage, withChatDraft } from '../state-utils'
import type { ChatMessage, RoomSessionState } from '../types'
import type { VaporWebRtcChatMesh } from '../webrtc-chat-mesh'

function chatHistoryKey(roomId: string): string {
  return `${CHAT_HISTORY_STORAGE_KEY_PREFIX}${roomId}`
}

function isChatMessage(value: unknown): value is ChatMessage {
  if (value === null || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.messageId === 'string' &&
    typeof candidate.senderParticipantId === 'string' &&
    typeof candidate.text === 'string' &&
    typeof candidate.sentAtMs === 'number' &&
    (candidate.direction === 'outgoing' ||
      candidate.direction === 'incoming' ||
      candidate.direction === 'system')
  )
}

// Persist the room's chat snapshot to sessionStorage (tab-local, session-scoped).
// Single entry per room — overwritten, not appended — so reconnect restores the
// latest state (VP-10.4). Storage failures (quota / unavailable) are non-fatal.
export function saveChatHistory(roomId: string | null | undefined, messages: ChatMessage[]): void {
  if (!roomId) return
  try {
    window.sessionStorage.setItem(chatHistoryKey(roomId), JSON.stringify(messages))
  } catch {
    // Ignore sessionStorage write errors (quota / private mode / unavailable).
  }
}

export function loadChatHistory(roomId: string | null | undefined): ChatMessage[] {
  if (!roomId) return []
  try {
    const rawValue = window.sessionStorage.getItem(chatHistoryKey(roomId))
    if (!rawValue) return []
    const parsed = JSON.parse(rawValue) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isChatMessage)
  } catch {
    return []
  }
}

export function clearChatHistory(roomId: string | null | undefined): void {
  if (!roomId) return
  try {
    window.sessionStorage.removeItem(chatHistoryKey(roomId))
  } catch {
    // Ignore sessionStorage removal errors.
  }
}

function createMessageId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function createChatMessage(
  senderParticipantId: string,
  text: string,
  direction: ChatMessage['direction'],
): ChatMessage {
  return {
    messageId: createMessageId(),
    senderParticipantId,
    text,
    sentAtMs: Date.now(),
    direction,
  }
}

export function useChatMessaging(
  peerMeshRef: React.RefObject<VaporWebRtcChatMesh | null>,
  stateRef: React.RefObject<RoomSessionState>,
  setState: React.Dispatch<React.SetStateAction<RoomSessionState>>,
  stopTyping: () => void,
) {
  const pendingMessagesRef = useRef<string[]>([])
  const flushPendingRef = useRef<(() => void) | null>(null)

  const flushPendingMessages = useCallback((): void => {
    if (pendingMessagesRef.current.length === 0) return

    const messagesToSend = pendingMessagesRef.current.slice()
    pendingMessagesRef.current = []

    for (const message of messagesToSend) {
      const deliveredCount = peerMeshRef.current?.sendMessage(message) ?? 0
      if (deliveredCount === 0) {
        pendingMessagesRef.current.push(message)
      }
    }
  }, [peerMeshRef])

  const sendChatMessage = useCallback(
    (messageText?: string): void => {
      const s = stateRef.current
      if (!s.participantId) return

      const trimmedMessage = (messageText ?? s.chatDraft).trim()
      if (trimmedMessage.length === 0) return

      stopTyping()

      const outgoingMessage = createChatMessage(s.participantId, trimmedMessage, 'outgoing')

      setState((previous) => {
        let nextState = withAppendedChatMessage(previous, outgoingMessage)
        nextState = withChatDraft(nextState, '')
        return nextState
      })

      if (s.participantCount > 1) {
        pendingMessagesRef.current.push(trimmedMessage)

        if (flushPendingRef.current) {
          flushPendingRef.current()
        } else {
          flushPendingRef.current = () => {
            flushPendingMessages()
          }
          queueMicrotask(flushPendingRef.current)
        }
      }
    },
    [stateRef, setState, stopTyping, flushPendingMessages],
  )

  const onRemoteMessage = useCallback(
    (fromParticipantId: string, text: string): void => {
      setState((previous) =>
        withAppendedChatMessage(previous, createChatMessage(fromParticipantId, text, 'incoming')),
      )
    },
    [setState],
  )

  const clearPending = useCallback((): void => {
    pendingMessagesRef.current = []
    flushPendingRef.current = null
  }, [])

  return {
    pendingMessagesRef,
    flushPendingRef,
    flushPendingMessages,
    sendChatMessage,
    onRemoteMessage,
    clearPending,
  }
}
