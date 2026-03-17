import { Alert, AlertDescription } from '../../components/ui/alert'
import { Button } from '../../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card'   
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { cn } from '../../lib/utils'
import type { LobbyMode } from './types'

interface LobbyViewProps {
  lobbyMode: LobbyMode
  roomIdInput: string
  passwordInput: string
  isSubmitting: boolean
  isPrimaryDisabled: boolean
  joinRateLimitHint: string | null
  errorMessage: string | null
  primaryActionLabel: string
  onLobbyModeChange: (mode: LobbyMode) => void
  onRoomIdChange: (value: string) => void
  onPasswordChange: (value: string) => void
  onSubmit: () => void
}

export function LobbyView({
  lobbyMode,
  roomIdInput,
  passwordInput,
  isSubmitting,
  isPrimaryDisabled,
  joinRateLimitHint,
  errorMessage,
  primaryActionLabel,
  onLobbyModeChange,
  onRoomIdChange,
  onPasswordChange,
  onSubmit,
}: LobbyViewProps) {
  return (
    <Card className="relative z-10 w-full max-w-md border-white/30 bg-card/75 backdrop-blur-md">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl font-bold tracking-tight">Vapor</CardTitle>
        <CardDescription className="text-sm text-muted-foreground">
          Private room. No history.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            onSubmit()
          }}
        >
          <div className="grid gap-2">
            <Label>How do you want to enter?</Label>
            <div className="grid grid-cols-2 rounded-lg border border-white/20 bg-background/40 p-1">
              <button
                type="button"
                onClick={() => onLobbyModeChange('create')}
                className={cn(
                  'rounded-md px-3 py-2 text-sm transition-colors',
                  lobbyMode === 'create'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-background/70 hover:text-foreground',
                )}
                aria-pressed={lobbyMode === 'create'}
              >
                Create room
              </button>
              <button
                type="button"
                onClick={() => onLobbyModeChange('join')}
                className={cn(
                  'rounded-md px-3 py-2 text-sm transition-colors',
                  lobbyMode === 'join'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-background/70 hover:text-foreground',
                )}
                aria-pressed={lobbyMode === 'join'}
              >
                Join room
              </button>
            </div>
          </div>

          {lobbyMode === 'join' ? (
            <div className="grid gap-2">
              <Label htmlFor="room-id-input">Room ID</Label>
              <Input
                id="room-id-input"
                value={roomIdInput}
                onChange={(event) => onRoomIdChange(event.target.value)}
                autoCapitalize="off"
                autoCorrect="off"
                autoComplete="off"
                spellCheck={false}
                placeholder="Paste exact room ID"
              />
            </div>
          ) : null}

          <div className="grid gap-2">
            <Label htmlFor="password-input">Password</Label>
            <Input
              id="password-input"
              type="password"
              value={passwordInput}
              onChange={(event) => onPasswordChange(event.target.value)}
              placeholder="Required"
              autoComplete="off"
            />
          </div>

          <Button type="submit" disabled={isPrimaryDisabled} className="w-full">
            {isSubmitting ? 'Connecting…' : primaryActionLabel}
          </Button>

          {joinRateLimitHint ? (
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {joinRateLimitHint}
            </p>
          ) : null}

          {errorMessage && (
            <Alert className="border-destructive/40 bg-destructive/10 text-destructive-foreground">
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          )}
        </form>
      </CardContent>
    </Card>
  )
}
