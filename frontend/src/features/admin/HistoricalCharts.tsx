import { useState, useEffect } from 'react'
import { AreaChart, BarChart } from '../../components/tremor'
import { fetchHistory, type HourlyRow, type HistoryRange } from './adminApi'

interface HistoricalChartsProps {
  token: string
  range: HistoryRange
  onRangeChange: (r: HistoryRange) => void
}

const RANGES: HistoryRange[] = ['24h', '7d', '30d']
const RANGE_LABELS: Record<HistoryRange, string> = { '24h': '24h', '7d': '7 days', '30d': '30 days' }

function formatTick(epochMs: number, range: HistoryRange): string {
  const d = new Date(epochMs)
  if (range === '24h') return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return `${d.getMonth() + 1}/${d.getDate()}`
}

function HistoricalCharts({ token, range, onRangeChange }: HistoricalChartsProps) {
  const [rows, setRows] = useState<HourlyRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchHistory(token, range)
      .then((data) => { if (!cancelled) { setRows(data); setLoading(false) } })
      .catch((err: Error) => { if (!cancelled) { setError(err.message); setLoading(false) } })
    return () => { cancelled = true }
  }, [token, range])

  const areaData = rows.map((r) => ({
    time: formatTick(r.recordedAt, range),
    rooms: r.activeRooms,
    participants: r.activeParticipants,
    'rooms created': r.roomsCreatedDelta,
    'ram MB': r.rssUsedMb,
  }))

  const barData = rows.length > 0 ? [
    { reason: 'Host Left', count: rows.reduce((s, r) => s + r.roomsDestroyedHostLeft, 0) },
    { reason: 'Grace Expired', count: rows.reduce((s, r) => s + r.roomsDestroyedGrace, 0) },
    { reason: 'TTL Expired', count: rows.reduce((s, r) => s + r.roomsDestroyedTtl, 0) },
    { reason: 'Solo Timeout', count: rows.reduce((s, r) => s + r.roomsDestroyedSolo, 0) },
  ] : []

  return (
    <div className="rounded-xl border border-white/10 bg-card/50 p-6">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Historical Trends</h2>
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => onRangeChange(r)}
              className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                r === range
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {RANGE_LABELS[r]}
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
      )}
      {!loading && error && (
        <p className="py-8 text-center text-sm text-destructive">{error}</p>
      )}
      {!loading && !error && rows.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No data yet — rows appear after the first metrics flush (~60s after server start).
        </p>
      )}

      {!loading && !error && rows.length > 0 && (
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
          <div>
            <p className="mb-2 text-xs text-muted-foreground">Active Rooms</p>
            <AreaChart data={areaData} index="time" categories={['rooms']} colors={['#6b9fd4']} />
          </div>
          <div>
            <p className="mb-2 text-xs text-muted-foreground">Active Participants</p>
            <AreaChart data={areaData} index="time" categories={['participants']} colors={['#a78bfa']} />
          </div>
          <div>
            <p className="mb-2 text-xs text-muted-foreground">Rooms Created per Period</p>
            <AreaChart data={areaData} index="time" categories={['rooms created']} colors={['#34d399']} />
          </div>
          <div>
            <p className="mb-2 text-xs text-muted-foreground">RAM Usage (MB)</p>
            <AreaChart
              data={areaData}
              index="time"
              categories={['ram MB']}
              colors={['#fb923c']}
              valueFormatter={(v) => `${v.toFixed(1)} MB`}
            />
          </div>
          <div className="lg:col-span-2">
            <p className="mb-2 text-xs text-muted-foreground">Room Destruction Reasons</p>
            <BarChart data={barData} index="reason" categories={['count']} layout="vertical" />
          </div>
        </div>
      )}
    </div>
  )
}

export { HistoricalCharts }
