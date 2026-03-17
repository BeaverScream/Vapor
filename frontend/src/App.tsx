import { useState, useEffect } from 'react'
import { FAQPage } from './features/info/FAQPage'
import { PrivacyPolicyPage } from './features/info/PrivacyPolicyPage'
import { LobbyView } from './features/room/LobbyView'
import { RoomEndedView } from './features/room/RoomEndedView'
import { RoomView } from './features/room/RoomView'
import { useVaporRoom } from './features/room/useVaporRoom'

type Page = 'app' | 'privacy' | 'faq'

function pathToPage(pathname: string): Page {
  if (pathname === '/privacy-policy') return 'privacy'
  if (pathname === '/faq') return 'faq'
  return 'app'
}

function App() {
  const { state, actions, derived } = useVaporRoom()
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

  if (page === 'privacy') {
    return (
      <main className="relative flex min-h-dvh justify-center overflow-hidden px-4">
        <div className="vapor-smoke-layer" aria-hidden="true" />
        <NavBar onPrivacy={() => navigate('/privacy-policy', 'privacy')} onFaq={() => navigate('/faq', 'faq')} />
        <PrivacyPolicyPage onBack={() => navigate('/', 'app')} />
      </main>
    )
  }

  if (page === 'faq') {
    return (
      <main className="relative flex min-h-dvh justify-center overflow-hidden px-4">
        <div className="vapor-smoke-layer" aria-hidden="true" />
        <NavBar onPrivacy={() => navigate('/privacy-policy', 'privacy')} onFaq={() => navigate('/faq', 'faq')} />
        <FAQPage onBack={() => navigate('/', 'app')} />
      </main>
    )
  }

  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-6">
      <h1 className="sr-only">Vapor: Secure Temporary Rooms for Real-Time Collaboration</h1>
      <div className="vapor-smoke-layer" aria-hidden="true" />
      <NavBar onPrivacy={() => navigate('/privacy-policy', 'privacy')} onFaq={() => navigate('/faq', 'faq')} />

      {state.screen === 'lobby' && (
        <LobbyView
          lobbyMode={derived.lobbyMode}
          roomIdInput={state.roomIdInput}
          passwordInput={state.passwordInput}
          isSubmitting={state.lobbyStatus === 'submitting'}
          isPrimaryDisabled={derived.isPrimaryDisabled}
          joinRateLimitHint={derived.joinRateLimitHint}
          errorMessage={state.errorMessage}
          primaryActionLabel={derived.primaryActionLabel}
          onLobbyModeChange={actions.setLobbyMode}
          onRoomIdChange={actions.setRoomIdInput}
          onPasswordChange={actions.setPasswordInput}
          onSubmit={actions.submitLobby}
        />
      )}

      {state.screen === 'room' && state.activeRoomId ? (
        <RoomView
          activeRoomId={state.activeRoomId}
          participantId={state.participantId}
          participantCount={state.participantCount}
          participants={state.participants}
          roomStatus={derived.roomStatus}
          roomLifetimeText={derived.roomLifetimeText}
          copyFeedback={state.copyFeedback}
          onCopyRoomId={actions.copyRoomId}
          onLeaveRoom={actions.leaveRoom}
        />
      ) : null}

      {state.screen === 'room-ended' ? (
        <RoomEndedView message={state.roomEndedMessage} onBackToLobby={actions.backToLobby} />
      ) : null}

      <p className="pointer-events-none fixed bottom-3 left-1/2 z-20 -translate-x-1/2 rounded-full border border-white/20 bg-background/70 px-3 py-1 text-xs text-muted-foreground backdrop-blur">
        {derived.connectionText}
      </p>
    </main>
  )
}

function NavBar({ onPrivacy, onFaq }: { onPrivacy: () => void; onFaq: () => void }) {
  return (
    <header className="fixed inset-x-0 top-0 z-20 flex justify-center px-4 pt-4">
      <nav
        aria-label="Primary"
        className="flex items-center gap-3 rounded-full border border-white/25 bg-background/60 px-4 py-1 text-xs text-muted-foreground backdrop-blur-md"
      >
        <span className="font-medium uppercase tracking-[0.28em]">Vapor</span>
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
      </nav>
    </header>
  )
}

export default App
