import { useCallback, useRef } from 'react'
import { withAppendedChatMessage, withChatDraft } from '../state-utils'
import type { ChatMessage, RoomSessionState } from '../types'
import type { VaporWebRtcChatMesh } from '../webrtc-chat-mesh'

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
