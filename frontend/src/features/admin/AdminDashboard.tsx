import { useState, type FormEvent } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { LiveMetrics } from './LiveMetrics'
import { HistoricalCharts } from './HistoricalCharts'
import { ReportControls } from './ReportControls'
import type { HistoryRange } from './adminApi'

const STORAGE_KEY = 'vapor_admin_token'

interface AdminDashboardProps {
  onBack: () => void
}

function AdminDashboard({ onBack }: AdminDashboardProps) {
  const [sessionToken, setSessionToken] = useState<string | null>(() => {
    const buildToken = import.meta.env.VITE_ADMIN_TOKEN
    if (buildToken) return buildToken
    return localStorage.getItem(STORAGE_KEY)
  })
  const [tokenInput, setTokenInput] = useState('')
  const [authError, setAuthError] = useState(false)
  const [historyRange, setHistoryRange] = useState<HistoryRange>('24h')

  function handleTokenSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const t = tokenInput.trim()
    if (!t) return
    localStorage.setItem(STORAGE_KEY, t)
    setSessionToken(t)
    setAuthError(false)
  }

  // Mid-session 401 (token revoked server-side): drop back to the credential form
  // instead of leaving stale metrics on screen (T6.3-06). The dead token is also
  // purged from localStorage so a refresh does not silently re-auth with it.
  function handleAuthError() {
    localStorage.removeItem(STORAGE_KEY)
    setSessionToken(null)
    setAuthError(true)
  }

  function handleSignOut() {
    localStorage.removeItem(STORAGE_KEY)
    setSessionToken(null)
    setTokenInput('')
    setAuthError(false)
  }

  return (
    <div className="min-h-dvh w-full px-4 py-16">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <button
              onClick={onBack}
              className="mb-2 text-xs text-muted-foreground hover:text-foreground"
            >
              ← Back
            </button>
            <h1 className="text-xl font-semibold tracking-tight">Admin Dashboard</h1>
          </div>
          {sessionToken && (
            <button
              onClick={handleSignOut}
              className="text-xs text-muted-foreground hover:text-destructive"
            >
              Sign out
            </button>
          )}
        </div>

        {!sessionToken ? (
          <div className="flex justify-center">
            <Card className="w-full max-w-sm">
              <CardHeader>
                <CardTitle className="text-base">Enter admin token</CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleTokenSubmit} className="flex flex-col gap-4">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="admin-token">Bearer token</Label>
                    <Input
                      id="admin-token"
                      type="password"
                      placeholder="••••••••"
                      value={tokenInput}
                      onChange={(e) => setTokenInput(e.target.value)}
                      autoComplete="off"
                      autoFocus
                    />
                    {authError && (
                      <p className="text-xs text-destructive">
                        Invalid token — check ADMIN_API_TOKEN.
                      </p>
                    )}
                  </div>
                  <Button type="submit" disabled={!tokenInput.trim()}>
                    Authenticate
                  </Button>
                </form>
              </CardContent>
            </Card>
          </div>
        ) : (
          <div className="flex flex-col gap-8">
            <LiveMetrics token={sessionToken} onAuthError={handleAuthError} />
            <HistoricalCharts token={sessionToken} range={historyRange} onRangeChange={setHistoryRange} />
            <ReportControls token={sessionToken} range={historyRange} />
          </div>
        )}
      </div>
    </div>
  )
}

export { AdminDashboard }
