import { memo } from 'react'
import { Alert, AlertDescription } from '../../components/ui/alert'
import { Button } from '../../components/ui/button'
import { Card, CardContent } from '../../components/ui/card'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { cn } from '../../lib/utils'
import type { LobbyMode } from './types'

interface LobbyViewProps {
  lobbyMode: LobbyMode
  roomIdInput: string
  passwordInput: string
  nicknameInput: string
  isSubmitting: boolean
  isPrimaryDisabled: boolean
  joinRateLimitHint: string | null
  errorMessage: string | null
  primaryActionLabel: string
  onLobbyModeChange: (mode: LobbyMode) => void
  onRoomIdChange: (value: string) => void
  onPasswordChange: (value: string) => void
  onNicknameChange: (value: string) => void
  onSubmit: () => void
}

const HashIcon = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" width="16" height="16" aria-hidden="true">
    <path d="M6.5 2.5 5 13.5M11 2.5 9.5 13.5M3 6h10.5M2.5 10H13" />
  </svg>
)

const KeyIcon = () => (
  <svg viewBox="0 0 16 16" fill="currentColor" width="16" height="16" aria-hidden="true">
    <path d="M10.5 1.5a4 4 0 0 0-3.875 5l-4.98 4.98a.5.5 0 0 0-.145.353V14a.5.5 0 0 0 .5.5h2.167a.5.5 0 0 0 .5-.5v-1.167H5.83a.5.5 0 0 0 .5-.5V11.17h1.163a.5.5 0 0 0 .354-.146l1.628-1.63A4 4 0 1 0 10.5 1.5Zm1.25 3.917a1.167 1.167 0 1 1 0-2.334 1.167 1.167 0 0 1 0 2.334Z" />
  </svg>
)

const PersonIcon = () => (
  <svg viewBox="0 0 16 16" fill="currentColor" width="16" height="16" aria-hidden="true">
    <path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm0 1.5c-2.67 0-5.5 1.34-5.5 3.25V14h11v-1.25C13.5 10.84 10.67 9.5 8 9.5Z" />
  </svg>
)

const PlusIcon = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width="16" height="16" aria-hidden="true">
    <path d="M8 3v10M3 8h10" />
  </svg>
)

const EnterIcon = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="16" height="16" aria-hidden="true">
    <path d="M2 8h8M7 4.5 10.5 8 7 11.5M13.5 3v10" />
  </svg>
)

export const LobbyView = memo(function LobbyView({
  lobbyMode,
  roomIdInput,
  passwordInput,
  nicknameInput,
  isSubmitting,
  isPrimaryDisabled,
  joinRateLimitHint,
  errorMessage,
  primaryActionLabel,
  onLobbyModeChange,
  onRoomIdChange,
  onPasswordChange,
  onNicknameChange,
  onSubmit,
}: LobbyViewProps) {
  return (
    <div className="vapor-app-frame vapor-scroll relative z-10 flex flex-col overflow-y-auto">
      <div className="m-auto w-full py-4">
      <div className="mb-8 text-center">
        <h2 className="font-display text-4xl font-bold tracking-[0.14em] text-foreground">VAPOR</h2>
        <p className="mt-3 text-sm text-muted-foreground">Privacy first. Ephemeral by design.</p>
      </div>

      <Card>
        <CardContent>
          <form
            className="grid gap-5"
            onSubmit={(event) => {
              event.preventDefault()
              onSubmit()
            }}
          >
            <div className="grid gap-2">
              <Label className="sr-only">How do you want to enter?</Label>
              <div className="grid grid-cols-2 rounded-full bg-secondary p-1">
                <button
                  type="button"
                  onClick={() => onLobbyModeChange('create')}
                  className={cn(
                    'rounded-full px-3 py-2.5 text-sm font-medium transition-colors',
                    lobbyMode === 'create'
                      ? 'bg-foreground text-background shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                  aria-pressed={lobbyMode === 'create'}
                >
                  Create
                </button>
                <button
                  type="button"
                  onClick={() => onLobbyModeChange('join')}
                  className={cn(
                    'rounded-full px-3 py-2.5 text-sm font-medium transition-colors',
                    lobbyMode === 'join'
                      ? 'bg-foreground text-background shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                  aria-pressed={lobbyMode === 'join'}
                >
                  Join
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
                  adornment={<HashIcon />}
                />
              </div>
            ) : null}

            <div className="grid gap-2">
              <Label htmlFor="password-input">
                {lobbyMode === 'join' ? 'Room key' : 'Room key (optional)'}
              </Label>
              {lobbyMode === 'join' ? (
                <Input
                  id="password-input"
                  type="password"
                  value={passwordInput}
                  onChange={(event) => onPasswordChange(event.target.value)}
                  placeholder="Required"
                  autoComplete="off"
                  adornment={<KeyIcon />}
                />
              ) : (
                <Input
                  id="password-input"
                  type="password"
                  value={passwordInput}
                  onChange={(event) => onPasswordChange(event.target.value)}
                  placeholder="Leave blank for open room"
                  autoComplete="off"
                  adornment={<KeyIcon />}
                />
              )}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="nickname-input">Nickname</Label>
              <Input
                id="nickname-input"
                value={nicknameInput}
                onChange={(event) => onNicknameChange(event.target.value)}
                autoCapitalize="off"
                autoCorrect="off"
                autoComplete="off"
                spellCheck={false}
                placeholder="3–24 characters"
                maxLength={24}
                adornment={<PersonIcon />}
              />
            </div>

            <Button type="submit" disabled={isPrimaryDisabled} className="mt-1 h-13 w-full text-base">
              {isSubmitting ? (
                'Connecting…'
              ) : (
                <>
                  {lobbyMode === 'create' ? <PlusIcon /> : <EnterIcon />}
                  {primaryActionLabel}
                </>
              )}
            </Button>

            <p className="text-center text-xs text-muted-foreground">
              Rooms are ephemeral. No history is stored. Everything vanishes when the last person leaves.
            </p>

            {joinRateLimitHint ? (
              <p className="text-xs text-muted-foreground" aria-live="polite">
                {joinRateLimitHint}
              </p>
            ) : null}

            {errorMessage && (
              <Alert className="rounded-2xl border-destructive/25 bg-destructive/10 text-destructive">
                <AlertDescription className="text-destructive">{errorMessage}</AlertDescription>
              </Alert>
            )}
          </form>
        </CardContent>
      </Card>
      </div>
    </div>
  )
})
