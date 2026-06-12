import { useState, useEffect, useCallback } from 'react'
import { MetricCard } from '../../components/tremor'
import { Button } from '../../components/ui/button'
import { fetchMetrics, AdminAuthError, type MetricsSnapshot } from './adminApi'

const POLL_INTERVAL_MS = 30_000

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${h}h ${m}m`
  return `${m}m ${s}s`
}

interface LiveMetricsProps {
  token: string
  onAuthError?: () => void
}

function LiveMetrics({ token, onAuthError }: LiveMetricsProps) {
  const [snapshot, setSnapshot] = useState<MetricsSnapshot | null>(null)
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null)
  const [secondsSince, setSecondsSince] = useState(0)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const fetchSnapshot = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetchMetrics(token)
      setSnapshot(data)
      setLastUpdatedAt(Date.now())
      setSecondsSince(0)
      setFetchError(null)
    } catch (e) {
      // Surface the error even on 401 so stale data is never silently displayed (T6.3-06).
      setFetchError(e instanceof Error ? e.message : 'Failed to fetch metrics')
      if (e instanceof AdminAuthError) onAuthError?.()
    } finally {
      setLoading(false)
    }
  }, [token, onAuthError])

  useEffect(() => {
    fetchSnapshot()
    const id = setInterval(fetchSnapshot, POLL_INTERVAL_MS)
    return () => clearInterval(id)
  }, [fetchSnapshot])

  useEffect(() => {
    if (lastUpdatedAt === null) return
    const id = setInterval(() => {
      setSecondsSince(Math.floor((Date.now() - lastUpdatedAt) / 1000))
    }, 1000)
    return () => clearInterval(id)
  }, [lastUpdatedAt])

  if (fetchError) {
    return (
      <div className="flex items-center gap-4 rounded-xl border border-destructive/30 bg-destructive/5 p-5 text-sm text-destructive">
        <span>Error: {fetchError}</span>
        <button onClick={fetchSnapshot} className="text-xs underline hover:no-underline">
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Live Metrics</h2>
        <div className="flex items-center gap-3">
          {lastUpdatedAt !== null && (
            <span className="text-xs text-muted-foreground">
              Last updated {secondsSince}s ago
            </span>
          )}
          <Button variant="secondary" size="sm" onClick={fetchSnapshot} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>
      </div>

      {!snapshot ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl border border-white/10 bg-card/50" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <MetricCard title="Active Rooms" value={snapshot.activeRooms} />
            <MetricCard title="Active Participants" value={snapshot.activeParticipants} />
            <MetricCard title="Active Sockets" value={snapshot.activeSockets} />
            <MetricCard
              title="RAM Usage"
              value={`${snapshot.rssUsedMb} MB`}
              subtitle={`${snapshot.heapUsedMb} MB heap of ${snapshot.heapTotalMb} MB total`}
            />
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <MetricCard
              title="Rooms Created"
              value={snapshot.roomsCreatedTotal}
              subtitle="since restart"
            />
            <MetricCard title="Peak Concurrent Rooms" value={snapshot.peakConcurrentRooms} />
            <MetricCard
              title="Rate Limited"
              value={snapshot.errorCounts.RATE_LIMITED}
              subtitle="events"
            />
            <MetricCard title="Uptime" value={formatUptime(snapshot.uptimeSeconds)} />
          </div>

          <div className="rounded-xl border border-white/10 bg-card/50 p-5">
            <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Abuse Controls
            </h3>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <MetricCard title="Blocklist Size" value={snapshot.temporaryBlocklistSize} />
              <MetricCard
                title="Active Rate Limit Windows"
                value={snapshot.rateLimitWindowActiveCount}
              />
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export { LiveMetrics }
