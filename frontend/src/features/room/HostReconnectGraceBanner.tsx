import { memo, useEffect, useState } from 'react'
import { getHostReconnectGraceText } from './useVaporRoom'

interface HostReconnectGraceBannerProps {
  deadlineAt: number | null
}

export const HostReconnectGraceBanner = memo(function HostReconnectGraceBanner({
  deadlineAt,
}: HostReconnectGraceBannerProps) {
  const [nowMs, setNowMs] = useState(() => Date.now())

  useEffect(() => {
    if (deadlineAt === null || !Number.isFinite(deadlineAt) || deadlineAt <= 0) return
    const intervalHandle = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(intervalHandle)
  }, [deadlineAt])

  const text = getHostReconnectGraceText(deadlineAt, nowMs)
  if (!text) return null

  return (
    <div
      role="status"
      aria-label="Host reconnect grace remaining"
      className="rounded-xl border border-warning-line bg-warning px-3 py-2 text-center text-xs font-medium text-warning-foreground"
    >
      {text}
    </div>
  )
})
