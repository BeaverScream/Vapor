import { useEffect, useMemo, useState } from 'react'
import { withJoinRateLimitCleared } from '../state-utils'
import type { RoomSessionState } from '../types'

export function useJoinRateLimit(
  state: RoomSessionState,
  setState: React.Dispatch<React.SetStateAction<RoomSessionState>>,
) {
  const [tick, setTick] = useState<number>(() => Date.now())

  const joinRateLimitRemainingMs = useMemo(() => {
    if (!state.joinRateLimitUntil) return 0
    return Math.max(state.joinRateLimitUntil - tick, 0)
  }, [state.joinRateLimitUntil, tick])

  const isJoinRateLimited =
    state.lobbyMode === 'join' &&
    state.joinRateLimitRoomId !== null &&
    state.joinRateLimitRoomId === state.roomIdInput &&
    joinRateLimitRemainingMs > 0

  useEffect(() => {
    if (!state.joinRateLimitUntil) return

    const intervalHandle = window.setInterval(() => {
      setTick(Date.now())
    }, 1000)

    return () => {
      window.clearInterval(intervalHandle)
    }
  }, [state.joinRateLimitUntil])

  useEffect(() => {
    if (!state.joinRateLimitUntil || joinRateLimitRemainingMs > 0) return
    setState((previous) => withJoinRateLimitCleared(previous))
  }, [joinRateLimitRemainingMs, state.joinRateLimitUntil, setState])

  return { joinRateLimitRemainingMs, isJoinRateLimited }
}
