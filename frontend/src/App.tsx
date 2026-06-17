import { useState, useEffect } from 'react'
import vaporMark from './assets/vapor-mark.svg'
import { FAQPage } from './features/info/FAQPage'
import { PrivacyPolicyPage } from './features/info/PrivacyPolicyPage'
import { LobbyView } from './features/room/LobbyView'
import { RoomEndedView } from './features/room/RoomEndedView'
import { RoomView } from './features/room/RoomView'
import { useVaporRoom } from './features/room/useVaporRoom'
import { AdminDashboard } from './features/admin/AdminDashboard'
import { cn } from './lib/utils'
import { useTheme } from './lib/useTheme'
import { THEME_IDS, THEME_META, type ThemeId } from './lib/theme'

type Page = 'app' | 'privacy' | 'faq' | 'admin'

function pathToPage(pathname: string): Page {
  if (pathname === '/privacy-policy') return 'privacy'
  if (pathname === '/faq') return 'faq'
  if (pathname === '/admin') return 'admin'
  return 'app'
}

function App() {
  const { state, actions, derived } = useVaporRoom()
  const { theme, setTheme } = useTheme()
  const [page, setPage] = useState<Page>(() => pathToPage(window.location.pathname))

  useEffect(() => {
    function onPopState() {
      setPage(pathToPage(window.location.pathname))
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  function navigate(path: string, target: Page) {
    window.history.pushState({}, '', path)
    setPage(target)
  }

  if (page === 'admin') {
    return (
      <main className="relative min-h-dvh overflow-hidden px-4">
        <div className="vapor-smoke-layer" aria-hidden="true" />
        <AdminDashboard onBack={() => navigate('/', 'app')} />
      </main>
    )
  }

  if (page === 'privacy') {
    return (
      <main className="relative flex min-h-dvh justify-center overflow-hidden px-4">
        <div className="vapor-smoke-layer" aria-hidden="true" />
        <NavBar onPrivacy={() => navigate('/privacy-policy', 'privacy')} onFaq={() => navigate('/faq', 'faq')} theme={theme} onThemeChange={setTheme} />
        <PrivacyPolicyPage onBack={() => navigate('/', 'app')} />
      </main>
    )
  }

  if (page === 'faq') {
    return (
      <main className="relative flex min-h-dvh justify-center overflow-hidden px-4">
        <div className="vapor-smoke-layer" aria-hidden="true" />
        <NavBar onPrivacy={() => navigate('/privacy-policy', 'privacy')} onFaq={() => navigate('/faq', 'faq')} theme={theme} onThemeChange={setTheme} />
        <FAQPage onBack={() => navigate('/', 'app')} />
      </main>
    )
  }

  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-6">
      <h1 className="sr-only">Vapor: Secure Temporary Rooms for Real-Time Collaboration</h1>
      <p className="sr-only">Connection secure visual atmosphere active.</p>
      <div className="vapor-smoke-layer" aria-hidden="true" />
      <NavBar onPrivacy={() => navigate('/privacy-policy', 'privacy')} onFaq={() => navigate('/faq', 'faq')} theme={theme} onThemeChange={setTheme} />

      {state.screen === 'lobby' && (
        <LobbyView
          lobbyMode={derived.lobbyMode}
          roomIdInput={state.roomIdInput}
          passwordInput={state.passwordInput}
          nicknameInput={state.nicknameInput}
          isSubmitting={state.lobbyStatus === 'submitting'}
          isPrimaryDisabled={derived.isPrimaryDisabled}
          joinRateLimitHint={derived.joinRateLimitHint}
          errorMessage={state.errorMessage}
          primaryActionLabel={derived.primaryActionLabel}
          onLobbyModeChange={actions.setLobbyMode}
          onRoomIdChange={actions.setRoomIdInput}
          onPasswordChange={actions.setPasswordInput}
          onNicknameChange={actions.setNicknameInput}
          onSubmit={actions.submitLobby}
        />
      )}

      {state.screen === 'room' && state.activeRoomId ? (
        <RoomView
          activeRoomId={state.activeRoomId}
          participantId={state.participantId}
          participantCount={state.participantCount}
          participants={state.participants}
          participantNicknames={state.participantNicknames}
          roomStatus={derived.roomStatus}
          chatStatusText={derived.chatStatusText}
          soloHostDeadlineAt={derived.soloHostDeadlineAt}
          expiresAt={derived.expiresAt}
          hasPassword={state.hasPassword}
          copyFeedback={state.copyFeedback}
          chatMessages={state.chatMessages}
          chatDraft={state.chatDraft}
          typingPeerIds={state.typingPeerIds}
          onCopyRoomId={actions.copyRoomId}
          onSendChatMessage={actions.sendChatMessage}
          onNotifyTypingStart={actions.notifyTypingStart}
          onLeaveRoom={actions.leaveRoom}
          onKickParticipant={actions.kickParticipant}
        />
      ) : null}

      {state.screen === 'room-ended' ? (
        <RoomEndedView message={state.roomEndedMessage} onBackToLobby={actions.backToLobby} />
      ) : null}

      {state.screen === 'lobby' ? (
        <p className="pointer-events-none fixed bottom-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-card/85 px-4 py-1.5 text-[10px] font-semibold tracking-[0.14em] uppercase text-muted-foreground backdrop-blur">
          <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current" />
          {derived.connectionText}
        </p>
      ) : null}
    </main>
  )
}

interface NavBarProps {
  onPrivacy: () => void
  onFaq: () => void
  theme: ThemeId
  onThemeChange: (theme: ThemeId) => void
}

function NavBar({ onPrivacy, onFaq, theme, onThemeChange }: NavBarProps) {
  return (
    <header className="fixed inset-x-0 top-0 z-20 border-b border-border bg-card/80 backdrop-blur-md">
      <nav aria-label="Primary" className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-2.5">
        <span className="flex items-center gap-2.5">
          <img src={vaporMark} alt="" aria-hidden="true" className="size-7 rounded-lg" />
          <span className="font-display text-base font-semibold tracking-[0.22em] text-foreground">VAPOR</span>
        </span>
        <span className="flex items-center gap-4 text-xs text-muted-foreground">
          <button
            onClick={onPrivacy}
            className="cursor-pointer hover:text-foreground focus-visible:text-foreground"
          >
            Privacy Policy
          </button>
          <button
            onClick={onFaq}
            className="cursor-pointer hover:text-foreground focus-visible:text-foreground"
          >
            FAQ
          </button>
          <ThemeSwitcher theme={theme} onThemeChange={onThemeChange} />
        </span>
      </nav>
    </header>
  )
}

function ThemeSwitcher({ theme, onThemeChange }: { theme: ThemeId; onThemeChange: (theme: ThemeId) => void }) {
  return (
    <div role="group" aria-label="Theme" className="flex items-center gap-1 rounded-full border border-border bg-secondary/60 p-1">
      {THEME_IDS.map((id) => {
        const meta = THEME_META[id]
        const isActive = theme === id
        return (
          <button
            key={id}
            type="button"
            onClick={() => onThemeChange(id)}
            aria-pressed={isActive}
            aria-label={`${meta.label} theme`}
            title={meta.description}
            className={cn(
              'flex size-6 cursor-pointer items-center justify-center rounded-full transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              isActive && 'ring-2 ring-ring ring-offset-1 ring-offset-card',
            )}
          >
            <span
              aria-hidden="true"
              className="size-3.5 rounded-full border border-foreground/20"
              style={{ background: meta.swatch }}
            />
          </button>
        )
      })}
    </div>
  )
}

export default App
