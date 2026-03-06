import { LobbyView } from './features/room/LobbyView'
import { RoomEndedView } from './features/room/RoomEndedView'
import { RoomView } from './features/room/RoomView'
import { useVaporRoom } from './features/room/useVaporRoom'

function App() {
  const { state, actions, derived } = useVaporRoom()

  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-6">
      <div className="vapor-smoke-layer" aria-hidden="true" />
      <header className="pointer-events-none fixed inset-x-0 top-0 z-20 flex justify-center px-4 pt-4">
        <div className="rounded-full border border-white/25 bg-background/60 px-4 py-1 text-xs font-medium uppercase tracking-[0.28em] text-muted-foreground backdrop-blur-md">
          Vapor
        </div>
      </header>

      {state.screen === 'lobby' ? (
        <LobbyView
          lobbyMode={derived.lobbyMode}
          roomIdInput={state.roomIdInput}
          passwordInput={state.passwordInput}
          isSubmitting={state.lobbyStatus === 'submitting'}
          errorMessage={state.errorMessage}
          primaryActionLabel={derived.primaryActionLabel}
          onLobbyModeChange={actions.setLobbyMode}
          onRoomIdChange={actions.setRoomIdInput}
          onPasswordChange={actions.setPasswordInput}
          onSubmit={actions.submitLobby}
        />
      ) : null}

      {state.screen === 'room' && state.activeRoomId ? (
        <RoomView
          activeRoomId={state.activeRoomId}
          participantId={state.participantId}
          participantCount={state.participantCount}
          participants={state.participants}
          roomStatus={derived.roomStatus}
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

export default App
