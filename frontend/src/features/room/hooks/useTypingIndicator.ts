import { useCallback, useRef } from 'react'
import { withTypingStarted, withTypingStopped } from '../state-utils'
import type { RoomSessionState } from '../types'
import type { VaporWebRtcChatMesh } from '../webrtc-chat-mesh'

export function useTypingIndicator(
  peerMeshRef: React.RefObject<VaporWebRtcChatMesh | null>,
  setState: React.Dispatch<React.SetStateAction<RoomSessionState>>,
) {
  const typingDebounceRef = useRef<ReturnType<typeof window.setTimeout> | null>(null)
  const typingSafetyTimeoutsRef = useRef<Map<string, ReturnType<typeof window.setTimeout>>>(
    new Map(),
  )

  const clearAll = useCallback((): void => {
    if (typingDebounceRef.current !== null) {
      window.clearTimeout(typingDebounceRef.current)
      typingDebounceRef.current = null
    }
    for (const handle of typingSafetyTimeoutsRef.current.values()) {
      window.clearTimeout(handle)
    }
    typingSafetyTimeoutsRef.current.clear()
  }, [])

  const onRemoteTypingStatus = useCallback(
    (fromParticipantId: string, isTyping: boolean): void => {
      const safetyTimeouts = typingSafetyTimeoutsRef.current
      if (isTyping) {
        const existing = safetyTimeouts.get(fromParticipantId)
        if (existing !== undefined) window.clearTimeout(existing)
        const handle = window.setTimeout(() => {
          safetyTimeouts.delete(fromParticipantId)
          setState((prev) => withTypingStopped(prev, fromParticipantId))
        }, 5000)
        safetyTimeouts.set(fromParticipantId, handle)
        setState((prev) => withTypingStarted(prev, fromParticipantId))
      } else {
        const existing = safetyTimeouts.get(fromParticipantId)
        if (existing !== undefined) {
          window.clearTimeout(existing)
          safetyTimeouts.delete(fromParticipantId)
        }
        setState((prev) => withTypingStopped(prev, fromParticipantId))
      }
    },
    [setState],
  )

  const notifyTypingStart = useCallback((): void => {
    const mesh = peerMeshRef.current
    if (!mesh) return
    const isAlreadyTyping = typingDebounceRef.current !== null
    if (typingDebounceRef.current !== null) {
      window.clearTimeout(typingDebounceRef.current)
    }
    if (!isAlreadyTyping) {
      mesh.sendTypingStart()
    }
    typingDebounceRef.current = window.setTimeout(() => {
      typingDebounceRef.current = null
      peerMeshRef.current?.sendTypingStop()
    }, 3000)
  }, [peerMeshRef])

  const notifyTypingStop = useCallback((): void => {
    if (typingDebounceRef.current !== null) {
      window.clearTimeout(typingDebounceRef.current)
      typingDebounceRef.current = null
    }
    peerMeshRef.current?.sendTypingStop()
  }, [peerMeshRef])

  return {
    typingDebounceRef,
    typingSafetyTimeoutsRef,
    onRemoteTypingStatus,
    notifyTypingStart,
    notifyTypingStop,
    clearAll,
  }
}
