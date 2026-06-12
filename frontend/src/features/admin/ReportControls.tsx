import { useState } from 'react'
import { triggerReport, fetchHistory, type HistoryRange, type ReportType } from './adminApi'

interface ReportControlsProps {
  token: string
  range: HistoryRange
}

type ActionStatus = 'idle' | 'loading' | 'success' | 'error'

const REPORT_TYPES: ReportType[] = ['daily', 'weekly', 'monthly']

function btnClass(status: ActionStatus) {
  const base =
    'rounded-lg border px-4 py-2 text-xs font-medium capitalize transition-colors disabled:opacity-50'
  if (status === 'success') return `${base} border-green-500/40 text-green-400`
  if (status === 'error') return `${base} border-destructive/40 text-destructive`
  return `${base} border-white/10 text-muted-foreground hover:border-white/20 hover:text-foreground`
}

function ReportControls({ token, range }: ReportControlsProps) {
  const [reportStatus, setReportStatus] = useState<Record<ReportType, ActionStatus>>({
    daily: 'idle',
    weekly: 'idle',
    monthly: 'idle',
  })
  const [csvStatus, setCsvStatus] = useState<ActionStatus>('idle')

  function setReport(type: ReportType, s: ActionStatus) {
    setReportStatus((prev) => ({ ...prev, [type]: s }))
  }

  async function handleTrigger(type: ReportType) {
    setReport(type, 'loading')
    try {
      await triggerReport(token, type)
      setReport(type, 'success')
    } catch {
      setReport(type, 'error')
    }
    setTimeout(() => setReport(type, 'idle'), 3000)
  }

  async function handleCsvExport() {
    setCsvStatus('loading')
    try {
      const rows = await fetchHistory(token, range)
      if (rows.length === 0) {
        setCsvStatus('idle')
        return
      }
      const headers = Object.keys(rows[0]).join(',')
      const lines = rows.map((r) => Object.values(r).join(','))
      const csv = [headers, ...lines].join('\n')
      const blob = new Blob([csv], { type: 'text/csv' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `vapor-history-${range}-${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
      setCsvStatus('success')
    } catch {
      setCsvStatus('error')
    }
    setTimeout(() => setCsvStatus('idle'), 3000)
  }

  function reportLabel(type: ReportType) {
    const s = reportStatus[type]
    if (s === 'loading') return 'Sending…'
    if (s === 'success') return 'Sent!'
    if (s === 'error') return 'Failed'
    return `Send ${type} report`
  }

  function csvLabel() {
    if (csvStatus === 'loading') return 'Preparing…'
    if (csvStatus === 'success') return 'Downloaded!'
    if (csvStatus === 'error') return 'Failed'
    return `Export CSV (${range})`
  }

  return (
    <div className="rounded-xl border border-white/10 bg-card/50 p-6">
      <h2 className="mb-4 text-sm font-semibold">Reports</h2>
      <div className="flex flex-wrap gap-3">
        {REPORT_TYPES.map((type) => (
          <button
            key={type}
            onClick={() => handleTrigger(type)}
            disabled={reportStatus[type] === 'loading'}
            className={btnClass(reportStatus[type])}
          >
            {reportLabel(type)}
          </button>
        ))}
        <button
          onClick={handleCsvExport}
          disabled={csvStatus === 'loading'}
          className={btnClass(csvStatus)}
        >
          {csvLabel()}
        </button>
      </div>
    </div>
  )
}

export { ReportControls }
