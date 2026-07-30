# Code Review — Phase 12

Date: 2026-07-30

**Review result:** Changes requested.

**Scope reviewed:** Phase 12 changes from baseline `faddb72` through the current working tree, including backend signaling and lifecycle code, shared contracts, frontend room state and WebRTC code, normative system-design documents, `docs/Todo.md`, the Phase 12 implementation/test matrix, and the recorded test evidence.

**Test status:** `docs/test_results/phase-12-test-result.md` records a full pass across backend, frontend, build/typecheck, and 25 Chromium end-to-end tests. This review did not rerun tests; test execution is a separate repository activity. The findings below explain cases where passing tests do not execute the behavior claimed by the matrix.

**Remediation update (2026-07-30):** CR12-10 and the runtime portion of CR12-15 are fixed in `useVaporRoom.ts`. Terminal resume failures now capture the stored room ID before cleanup, clear the chat/reconnect records, dispose the room session, and enter Room Ended with mapped error copy. No test code or test-suite rerun was requested; the recorded full run is therefore historical for these changes.

---

## Executive Summary

Phase 12 contains substantial correct work, but it is not ready for full approval. The review found production defects in grace-capacity updates, host-grace propagation, React updater purity, and desktop capacity visibility, plus a rolling-deployment regression. The terminal resume cleanup and inconsistent silent-lobby behavior were remediated after review; contradictory normative wording remains a documentation follow-up.

The largest review risk is evidence quality. Several Phase 12 rows marked `Pass` are backed by source-text assertions, partial runtime scenarios, or tests whose setup never reaches the claimed branch. The complete suite can therefore pass while the concrete defects in this report remain.

### Open finding count

| Severity | Count |
|---|---:|
| High | 1 |
| Medium | 5 |
| Low | 3 |
| **Total** | **9** |

---

## Open Findings

### [CR12-9] Fresh full-suite pass does not execute every Phase 12 claim

- **Severity:** High
- **Classification:** missing behavioral coverage
- **Status:** Open — full suite rerun passed 2026-07-30
- **Primary files:** `frontend/tests/phase12.behavior.test.tsx`, `frontend/tests/*.unit.test.mjs`, `frontend/tests/*.integration.test.mjs`, `backend/tests/socket.integration.test.ts`, `docs/work/phase-12.md`

**Fresh execution evidence:** backend unit/integration/policy/socket/security suites passed 72/72, 133/133, 13/13, 80/80, and 13/13; frontend structural/runtime suites passed 22/22, 21/21, 104/104, and 18/18; both typechecks and the production build passed; Playwright passed 25/25 Chromium flows. The initial sandbox could not start Vite, but the same browser command passed when given local workspace/server access. See `docs/test_results/phase-12-test-result.md`.

The green run validates the assertions that exist. It does not substantiate several matrix claims currently marked `Pass`, because their setup never reaches the behavior described:

- **T12.3-13/14:** `phase12.behavior.test.tsx:124-138` first commits a visible room and drives only two error codes. It does not execute the automatic-resume branch, the initial/ref-cleared reconnecting branch, all five terminal codes, non-terminal preservation, exact room chat-key deletion, or mesh disposal.
- **T12.3-15:** the existing “race” test at `backend/tests/socket.integration.test.ts:1235-1257` awaits the first resume before sending the second. It proves stale-token handling after a completed resume, not overlapping `withRoomLock` serialization or a resume/destroy/kick race.
- **T12.3-18:** executable compatibility coverage proves capability omission and `true`, but not explicit `false` or malformed values such as `"true"`, `1`, or an object. Production correctly uses `supportsSessionResumed === true`; the untested contract boundary could regress unnoticed.
- **T12.6-02:** the StrictMode case at `phase12.behavior.test.tsx:156-169` leaves no remaining peer and expects zero synchronization. The non-empty batching case at `:171-191` is not under StrictMode, so no test proves one non-empty repair under replay.
- **T12.6-03/05:** the hook test mocks `syncPeers` as a no-op. It does not execute pruning, `removePeer`, offer repair, typing cleanup, or all three system-message reasons claimed by the matrix.
- **T12.7-01/02:** the mock stale channels begin with all handlers already `null`, so handler-cleanup assertions are partly vacuous. The scenario does not preserve a seeded healthy `RTCPeerConnection`.
- **T12.7-03/04:** the tests call `syncPeers`; `needsOffer` short-circuits open/connecting channels before `startOffer`, so they do not execute the `startOffer` duplicate guard named by the test plan.
- **T12.7-06:** there is no executable connected-count/politeness matrix covering every channel state and initiator ordering.
- **T12.7-07:** the test at `:305-315` begins with no channel. It does not perform the claimed `onclose` → retained closed map entry → repair → replacement open → delivery sequence.
- **T12.8-02 through T12.8-07:** the test labelled “T12.8-01 through -10” at `:84-94` calls formatter functions only. It does not execute the TTL/solo/grace state combinations listed at `phase-12.md:243-248`.
- **T12.8-08 through T12.8-10:** runtime UI coverage ticks the mobile host-grace banner and only checks desktop presence. It does not exercise absent/invalid/expired deadlines, null→deadline transition, host return, simultaneous timer surfaces, or mount/unmount cadence for the TTL and solo chips.

The remaining `.mjs` suites frequently read source files and assert text, imports, ordering, or string literals. Under the repository review rules, those are supplemental structural/contract tests, not behavioral coverage. In particular, `contract.integration.test.mjs` and `webrtc.integration.test.mjs` should not be presented as runtime integration evidence when they only inspect source.

**Smallest missed regressions:** a ref-cleared cold resume keeps chat storage; StrictMode runs a non-empty repair incorrectly; a closed channel is never replaced after its real `onclose`; or all three deadlines alias each other in hook state. The current suite can remain green in each case.

**Required resolution:** retain the fresh command result as `Pass`, but split overly broad matrix rows or add executable cases for the named runtime branches. Relabel source-inspection suites as supplemental and do not treat a passing structural assertion as behavioral coverage until its setup/action/observable assertion actually runs.

---

### [CR12-10] The defensive cold-resume failure branch leaves room chat in session storage

- **Severity:** Medium
- **Classification:** implementation defect
- **Status:** Fixed - runtime test deferred
- **Files:** `frontend/src/features/room/useVaporRoom.ts:176-178,503-545`, `frontend/src/features/room/state-utils.ts:24-54`, `frontend/src/features/room/hooks/useChatMessaging.ts:50-53`, `docs/system_design/core-architecture.md:26`

**Resolution (2026-07-30):** The shared terminal-resume handler now obtains `persistence.readStoredReconnectSession()?.roomId` before removing the record, clears that chat key, disposes the session, and enters `room-ended`. The required cold-start runtime test is deliberately deferred.

Cold startup selects the `reconnecting` screen from stored session data, but the initial state still has `activeRoomId: null`. The normal automatic-resume error branch correctly reads the stored room ID before clearing the reconnect record. The defensive `previous.screen === 'reconnecting'` branch instead calls:

```ts
clearChatHistory(previous.activeRoomId)
```

`clearChatHistory` returns immediately for a falsy room ID. The branch then deletes the reconnect record and resets to lobby, losing the only room ID that could remove `vapor.chat:<roomId>`.

**Runtime scenario:** session storage contains a reconnect record and `vapor.chat:RoomA`; the defensive ref-cleared reconnecting branch receives `RECONNECT_TOKEN_STALE`. The token is removed, but Room A chat survives until tab close and can reappear if that room ID is joined again.

This violates the normative requirement to clear the per-room chat snapshot after failed/stale resume. T12.3-14 does not execute this branch or assert the exact chat key.

**Required resolution:** capture the stored room ID before deleting the reconnect record, clear that exact room chat key, and add a runtime test starting from cold reconnect state with a real `vapor.chat:<roomId>` entry.

---

### [CR12-11] Guest-grace expiry frees capacity without updating connected clients

- **Severity:** Medium
- **Classification:** implementation defect
- **Status:** Open
- **Files:** `backend/src/signaling/registerSocketHandlers.ts:303-330`, `frontend/src/features/room/state-utils.ts:128-178`, `docs/system_design/frontend-ui-spec.md:56-66`

A guest disconnect broadcasts one `peer_left` with `reconnectingCount: 1`. When the guest grace timer later expires, `handleGuestGraceExpired` deletes the sentinel, reconnect record, nickname reservation, and capacity slot, but intentionally emits no event.

The frontend changes `reconnectingCount` only when it receives `room_joined`, `session_resumed`, `peer_joined`, or `peer_left`. If no later membership event occurs, every live participant continues to see `N connected · 1 reconnecting` after the reconnecting session and its reserved slot no longer exist.

**Runtime scenario:** host and two guests remain live while a third guest disconnects. Thirty minutes later the grace expires. The room can accept a new participant, but existing clients still display one reconnecting slot until some unrelated join/leave/resume event refreshes the count.

T12.4 covers disconnect, explicit leave, kick, resume, and join-boundary counts, but not grace expiry. Re-emitting the original `peer_left` would also duplicate the UI system message, so this needs an explicit signaling/UI design rather than an unreviewed duplicate departure event.

**Required resolution:** define an idempotent capacity-state update for grace expiry, document its backward-compatible payload/event semantics, consume it on the frontend, and test expiry with live participants still present.

---

### [CR12-12] A participant joining while the host is in grace never receives the host deadline

- **Severity:** Medium
- **Classification:** implementation defect
- **Status:** Open
- **Files:** `shared/payloads.ts:85-105`, `backend/src/signaling/registerSocketHandlers.ts:506-530,678-685`, `frontend/src/features/room/state-utils.ts:85-135`, `docs/system_design/frontend-ui-spec.md:97-107,145-150`

Joining during host grace is permitted and is already exercised by backend/browser flows. The join handler has the room policy in scope, but `RoomJoinedPayload` has no `hostReconnectGraceDeadlineAt`, and the payload builder omits it. Only `SessionResumedPayload` can carry the deadline.

`withRoomJoined` clears the prior session fields and leaves `hostReconnectGraceDeadlineAt` as `null`. Consequently, a new joiner can receive a roster/count containing the disconnected host's reserved slot yet see neither the mandatory host-grace banner nor its countdown.

**Runtime scenario:** the host disconnects, all prior guests disconnect or leave, and a new guest joins before room destruction. The new guest sees the room and its reserved-capacity count, but no indication that the absent host controls room lifetime or how much grace remains.

This is the same offline-event problem that motivated adding the field to `session_resumed`, but new joins were omitted. T12.5-02 verifies sentinel filtering only; it does not assert the deadline or render the resulting UI.

**Required resolution:** add an optional host-grace deadline to the normal join payload, populate it when a policy has active host grace, consume it in `withRoomJoined`, update the normative contract, and cover the existing join-during-grace browser flow.

---

### [CR12-13] A Phase 12 frontend loses host badges when paired with a Phase 11 backend

- **Severity:** Medium
- **Classification:** rollout/backward-compatibility risk
- **Status:** Open
- **Files:** `frontend/src/features/room/state-utils.ts:85-98`, `shared/payloads.ts:85-98`, `frontend/tests/phase12.behavior.test.tsx:109-122`, `docs/work/phase-12.md:71`

Phase 11 `room_joined.peers[]` did not include `isHost`. The Phase 12 frontend now copies `participant.isHost` directly into state. Against an older backend response, that value is `undefined`, even though `payload.hostId` still identifies the host. Both roster layouts then omit the host badge.

The Phase 12 matrix explicitly claims that new/new, old/new, and new/old combinations retain resume state. The compatibility tests cover an old client against the new backend and prove that a new client advertises its capability, but no frontend runtime test consumes a Phase-11-shaped payload.

**Runtime scenario:** a new static bundle joins or resumes through an old backend during a rolling deployment. Membership otherwise restores correctly, but the host crown disappears.

**Required resolution:** preserve explicit boolean wire values, but fall back to `peer.participantId === payload.hostId` when `isHost` is absent or non-boolean. Add a new-frontend/old-payload runtime case.

---

### [CR12-14] `onPeerLeft` still performs nondeterministic and ref-mutating work inside a React updater

- **Severity:** Medium
- **Classification:** implementation defect
- **Status:** Open
- **Files:** `frontend/src/features/room/useVaporRoom.ts:382-404`, `frontend/src/features/room/hooks/useChatMessaging.ts:59-77`, `docs/work/phase-12.md:47-48,180`

Phase 12 correctly moved `syncPeers` into a commit-phase effect, but the updater is not pure as claimed:

- `createChatMessage(...)` runs inside the updater and generates a new message ID/timestamp.
- `chat.pendingMessagesRef.current = []` mutates external ref state inside the updater when the room becomes self-only.

React may replay an updater, rebase it, or abandon its render. A replay can generate different system-message identity/timing; an abandoned update can clear the pending queue even though its state result never commits.

This directly contradicts Phase 12 constraint #22 and subtask 12.6.1, whose pass criterion says no ref side effects occur inside the updater. Existing tests do not invoke/replay the updater in a way that observes pending-queue mutation or stable system-message identity.

**Required resolution:** compute the system message outside the updater or use a deterministic event-derived value, and move pending-queue clearing to a commit-aware effect/action. Add replay/StrictMode coverage that observes both state and the queue.

---

### [CR12-15] Normative documents conflict on the resume-failure destination, while runtime shows a silent lobby

- **Severity:** Medium
- **Classification:** specification/design conflict
- **Status:** Code fixed - normative wording and runtime test alignment deferred
- **Files:** `docs/system_design/frontend-ui-spec.md:83-95,238-250,375-378,411-421`, `docs/system_design/lifecycle.md:232-241`, `frontend/src/features/room/useVaporRoom.ts:497-545`, `frontend/src/features/room/state-utils.ts:310-320`

**Resolution (2026-07-30):** Runtime now consistently selects the existing `room-ended` state with mapped error copy for terminal automatic, reconnecting, and visible-room resume failures. The contradictory normative destination wording remains a documentation-alignment follow-up; it was not silently changed in this code fix. Targeted runtime coverage is deferred.

**Historical finding (pre-remediation):** the normative documents do not define one consistent terminal outcome:

- The reconnect-state requirements say expiration returns to entry with a clear recoverability message.
- The UI state map and main journey route resume failure to `ROOM_ENDED`.
- The resume workflow says to clear the token and return to lobby with a deterministic error.
- The lifecycle diagram labels a failure node “Room Ended — session unrecoverable” and then routes it to lobby.

Before remediation, the two common runtime resume-failure branches returned `resetToLobby(previous)`. `resetToLobby` clears `errorMessage`, room input, and join mode, so the user received neither a Room Ended explanation nor a deterministic lobby error. The visible-room edge already used Room Ended copy, producing different outcomes for the same fatal error depending on React/ref timing.

**Historical runtime scenario:** reload with an expired guest token. The reconnect spinner disappeared into an empty create-room form with no explanation or rejoin context.

Because this is a conflict among normative sources, the review must not choose or silently edit the design.

**Required decision:** select one canonical destination and retained context for terminal resume failure—Room Ended, or lobby/join mode with deterministic error—then align lifecycle, UI spec, implementation, and executable tests.

---

### [CR12-16] Collapsing the desktop participant panel also removes the capacity status

- **Severity:** Medium
- **Classification:** implementation defect
- **Status:** Open
- **Files:** `frontend/src/features/room/RoomViewDesktop.tsx:445-453,524-583`, `docs/system_design/frontend-ui-spec.md:54-66,221`

The desktop “Hide participant panel” action conditionally removes the entire aside. The capacity-aware count is inside that aside, so collapsing the live roster also removes `N connected · M reconnecting`.

The normative layout requires the capacity-aware count in the persistent top row and describes the live participant list as expandable. Hiding list details should not hide the only indication that reconnecting sessions reserve capacity. Mobile already keeps its count visible in the toggle.

The runtime view test renders only the default-open desktop state.

**Required resolution:** keep the capacity count in a persistent header/toggle surface and collapse only roster details. Add a desktop interaction test with a nonzero reconnecting count.

---

### [CR12-17] The host-grace banner can display an inflated countdown for its first frame

- **Severity:** Low
- **Classification:** implementation defect
- **Status:** Open
- **Files:** `frontend/src/features/room/HostReconnectGraceBanner.tsx:10-18`, `frontend/tests/phase12.behavior.test.tsx:213-238`

`nowMs` is initialized when the always-mounted banner component first mounts, often while `deadlineAt` is `null`. A later null→deadline transition starts an interval but does not immediately refresh `nowMs`.

**Runtime scenario:** a guest has been in the room for 20 minutes when the host disconnects with a 60-minute window. The first render can show approximately `80:00`; it corrects on the first one-second interval tick.

The current test mounts with a non-null deadline at time zero, so it cannot see the transition bug. An expired but still non-null deadline also leaves an unnecessary interval running until the prop changes or the component unmounts.

**Required resolution:** refresh the clock immediately when the deadline changes and stop scheduling once it is expired. Test null→future and future→expired transitions.

---

### [CR12-18] Reconnecting-count normalization accepts impossible room occupancy

- **Severity:** Low
- **Classification:** implementation defect
- **Status:** Open
- **Files:** `frontend/src/features/room/state-utils.ts:14-20`, `frontend/src/features/room/participant-utils.ts:15-19`, `docs/system_design/frontend-ui-spec.md:65-66`

`normalizeReconnectingCount` rejects negative, fractional, NaN, and infinite values, but accepts any nonnegative integer. It does not enforce the five-person maximum or validate the count against `participantCount`.

A malformed or mixed-version event can therefore render states such as `4 connected · 5 reconnecting`, contradicting the normative `N + M ≤ 5` invariant. Current production backend emissions are bounded; this is a contract-boundary robustness defect rather than a demonstrated normal-path failure.

**Required resolution:** normalize participant and reconnecting counts together against the room limit, or reject the event state. Add oversized and cross-field-invalid cases.

---

### [CR12-19] Phase and test documents still contain stale or contradictory completion claims

- **Severity:** Low
- **Classification:** stale/incorrect test expectation
- **Status:** Partially corrected - CR12-10/15 remediation documentation is current; remaining records await phase close
- **Files:** `docs/Todo.md:22,46-73`, `docs/work/phase-12.md:47-48,85-251`, `docs/test_results/phase-12-test-result.md`

The documentation does not consistently represent the state the user reported:

- `Todo.md` still says `Status: Planned`, and VP-12.3 through VP-12.8 remain unchecked.
- Phase 12 constraint #21 says remaining peers move to derivation “inside the updater,” while #22 and the implementation use a commit-phase effect.
- Subtask 12.6.1 claims no ref side effects occur inside the updater, contradicted by CR12-14.
- `signaling-contract.md:65` presents `hostReconnectGraceDeadlineAt` as required in `session_resumed`, while the shared type and runtime intentionally make it optional and present only during active host grace.
- T12.8-06 says host grace is surfaced “only by the status line,” contradicting Phase 12 constraint #28 and the dedicated countdown banner implemented by subtask 12.8.2.
- Multiple test-plan rows are marked `Pass` despite the unexecuted branches in CR12-9.
- The test report groups source-inspection suites under integration/unit pass totals without consistently distinguishing supplemental structural checks from runtime evidence.

The review document is the only artifact updated in this pass, per the request. These status/mapping corrections remain follow-up work.

**Required resolution:** after findings are addressed, update `Todo.md`, correct contradictory Phase 12 constraints, and map each `Pass` row only to executable evidence that performs its setup/action/observable assertion.

---

## Pass-Criteria Audit

| VP item | Review status | Corroborated behavior | Remaining blockers |
|---|---|---|---|
| VP-12.3 | Partial | Granular backend error precedence, rotated resume token, `session_resumed` wiring, exact-true capability selection, and the centralized terminal resume teardown are coherent. | CR12-9, CR12-13, deferred CR12-10/15 runtime coverage, normative wording alignment |
| VP-12.4 | Partial | Capacity remains gated on `participants.size`; named join/leave/kick/resume payloads report live and reconnecting counts separately. | CR12-11, CR12-16, CR12-18 |
| VP-12.5 | Partial | Current backend join/resume peers have live-only filtering and correct `isHost` flags. | CR12-12, CR12-13 |
| VP-12.6 | Partial | Mesh repair is deferred to committed participant state and the marker is cleared before synchronization. | CR12-9, CR12-14 |
| VP-12.7 | Implementation plausible; evidence incomplete | Closed/closing eviction detaches four handlers, removes only the stale data channel, preserves the peer connection, and leaves healthy-channel/politeness code unchanged. | CR12-9 |
| VP-12.8 | Partial | TTL derives only from `state.expiresAt`; solo and host grace have distinct components in both layouts. | CR12-9, CR12-12, CR12-17 |

---

## Prior Review Findings

The earlier CR12 findings remain useful history. Their original corrections are present, but some broad evidence claims are superseded by this fresh review.

| ID | Prior subject | Current disposition |
|---|---|---|
| CR12-1 | Backend tests expected pre-Phase-12 resume behavior | Corrected; recorded backend suites pass. |
| CR12-2 | Missing normative host-grace countdown | Dedicated banner added; null→deadline bug remains as CR12-17. |
| CR12-3 | `syncPeers` side effect inside updater | Synchronization moved to commit phase; other updater side effects remain as CR12-14. |
| CR12-4 | Reconnecting count stored but not displayed | Added in both layouts; expiry and desktop-collapse gaps remain as CR12-11/16. |
| CR12-5 | Frontend Phase 12 tests were source-only | Runtime harness added; residual and overstated mappings are consolidated in CR12-9. |
| CR12-6 | Backend resume assertions incomplete | Payload/error cases expanded and recorded passing. Lock/race evidence remains incomplete under CR12-9. |
| CR12-7 | Old clients could not consume renamed resume response | Exact-true capability negotiation added. New-frontend/old-backend host mapping remains CR12-13. |
| CR12-8 | Frontend admin metrics omitted new keys | Corrected and covered by the recorded passing suite. |

---

## Validation Results

### Recorded test execution

The existing Phase 12 result report records:

- Backend: 72 unit, 133 integration, 13 policy, 80 socket subset, and 13 security subset tests passed.
- Frontend: 22 integration, 21 contract, 104 structural unit checks, and 18 runtime unit tests passed.
- Backend/frontend typechecks and production build passed.
- Playwright: 25/25 Chromium tests passed.

This review accepts those execution results as reported; it does not treat a green command as proof of behavior that the test never reaches.

### Read-only quality checks performed during this review

| Check | Result | Notes |
|---|---|---|
| Frontend lint | Pass with warnings | 0 errors, 3 warnings in `useVaporRoom.ts` (one unused disable and two missing `persistence` dependency warnings). |
| Backend lint | Fail | 10 errors, 1 warning. These are listed under Out of Scope because they are not introduced by the Phase 12 feature slice. |
| `git diff --check faddb72` | Fail | Three Markdown hard-break trailing-space reports in `docs/Completed.md`; no Phase 12 application-source whitespace error was identified. |

No feature or test code was changed during review.

---

## Corroborated Areas

- The backend resume handler applies the intended granular error precedence and uses the exact check `supportsSessionResumed === true`, so omitted/false/malformed capabilities currently fall back to the legacy success event.
- A successful Phase 12 resume rotates the token, restores identity and payload state, filters disconnected sentinels from peers, announces one `peer_joined` to others, and includes active host grace for an offline guest resumer.
- Current backend payload construction computes `peers[].isHost` from `room.hostId` at both join and resume sites.
- The capacity gate remains on total participant-map occupancy, preserving reconnect reservations and the five-slot limit.
- The WebRTC closed/closing-channel production change removes the stale channel without destroying the healthy peer connection; open/connecting entries and perfect-negotiation ordering are unchanged.
- Room TTL, solo timeout, and host grace now use separate state fields and UI components; the TTL no longer aliases the earlier deadline.
- The shared event listener registration/removal for `session_resumed` is symmetric through the socket client, connection hook, and room hook.

---

## Out of Scope

The following issues were found while tracing Phase 12 behavior but predate or materially exceed this phase. They are documented here only and must remain outside Phase 12 fixes unless the user expands scope.

### [OOS12-1] Shared error codes exceed the normative closed set

- **Severity:** Medium
- **Classification:** specification/design conflict

`shared/error-codes.ts:8` still includes `PASSWORD_VERSION_MISMATCH`, while the repository product constraint and `docs/system_design/error-codes.md` define the allowed closed set without it. The backend does not currently emit this extra code.

### [OOS12-2] Canonical `INVALID_PASSWORD` copy already drifts

- **Severity:** Low
- **Classification:** specification/design conflict

`frontend/src/features/room/error-copy.ts:40` says `Password is required or incorrect.`, while `frontend-ui-spec.md` owns `Incorrect password.`. Existing tests freeze the implementation string instead of resolving the source-of-truth mismatch.

### [OOS12-3] Voluntary leave does not remove the socket from its Socket.IO room

- **Severity:** High
- **Classification:** implementation defect

`registerSocketHandlers.ts:850-880` removes application membership but never calls `socket.leave(removed.roomId)`. A guest can leave Room A, join Room B on the same socket, and remain subscribed to Room A broadcasts. Frontend membership/terminal handlers are not gated by room/session ID, and the affected payloads do not carry one, so a delayed Room A event can mutate or terminate the Room B UI. Room destruction likewise clears application maps without removing connected sockets from the adapter room.

### [OOS12-4] Invalid resume room IDs can grow `roomLockChains` without bound

- **Severity:** High
- **Classification:** implementation defect

`roomLockChains` is populated by `withRoomLock` at `registerSocketHandlers.ts:138,183-204` and is deleted only by room cleanup/destruction. A resume request with a syntactically truthy, nonexistent room ID creates a resolved map entry that is never removed. Unique attacker-controlled IDs—and runtime non-string objects, which pass the current truthiness pre-check—can cause unbounded server RAM growth without a resume-specific rate limit.

### [OOS12-5] The reconnect-token sweep can suppress guest-grace roster cleanup

- **Severity:** High
- **Classification:** implementation defect

`reconnectionManager.ts:102-111` removes an expired participant from `disconnectedParticipants`. The guest-grace timer in `graceWindowManager.ts:120-126` checks that set and returns without invoking `handleGuestGraceExpired` when the entry is absent. If the periodic sweep runs at/after the same deadline before the timer callback, the room sentinel, nickname reservation, and capacity slot can survive indefinitely.

### [OOS12-6] An asynchronous offer can recreate WebRTC state after disposal

- **Severity:** High
- **Classification:** implementation defect

`webrtc-chat-mesh.ts:367-406` has no generation/in-flight guard around `createOffer` and `setLocalDescription`. If `dispose()` runs while an offer is pending, a later rejection enters the catch path, calls `removePeer`, and then `ensurePeerConnection`, recreating a connection on a disposed mesh. A late failure from an older offer can also tear down a newer connection for the same peer.

### [OOS12-7] A live TCP drop does not enter the normative reconnecting UI

- **Severity:** Medium
- **Classification:** implementation defect

`useVaporRoom.ts:277-280` changes only socket state on disconnect; the active room screen remains visible. The UI spec requires a reconnecting state with self grace countdown and retry status. This is pre-existing reconnect-orchestrator debt, not introduced by Phase 12.

### [OOS12-8] TTL focus behavior conflicts with the normative UI spec

- **Severity:** Medium
- **Classification:** specification/design conflict

The UI spec requires hiding the room TTL while chat input is focused. Both room views render it unconditionally, and `e2e/05-p2p-and-ui.spec.ts` explicitly expects it to remain visible while typing.

### [OOS12-9] Repository lint/diff gates are not clean

- **Severity:** Low
- **Classification:** implementation defect

Backend lint reports 10 errors and 1 warning, including floating promises, unsafe `any`, `no-console`, `eqeqeq`, and `require-await`. Frontend lint has three warnings. `git diff --check faddb72` reports three Markdown hard-break spaces in `docs/Completed.md`. These were already recorded outside the functional test result and are not attributed to the Phase 12 feature changes.

### [OOS12-10] Unrelated ignore-policy changes are mixed into the working tree

- **Severity:** Low
- **Classification:** rollout/backward-compatibility risk

`.gitignore` adds `AGENTS.md` and `.codex/`, unrelated to VP-12.3 through VP-12.8. Keep those changes outside a Phase 12 commit unless the repository-policy change is intentional and separately reviewed.

### [OOS12-11] Closed-channel repair is ineffective for one mixed-frontend ordering

- **Severity:** Low
- **Classification:** rollout/backward-compatibility risk

Only the lexicographically lower participant initiates repair. During a frontend rollout, if that lower-ID participant still runs Phase 11, its old `startOffer` retains the closed-channel map entry and creates no replacement; the updated higher-ID participant correctly remains polite and never initiates. The room can therefore retain the original messaging failure until an updated initiator joins or the ephemeral room ends. This is bounded by room lifetime but is not covered by the Phase 12 rollout tests.

---

## Review Decision

**Changes requested for a fully approved Phase 12.** CR12-10 and the runtime portion of CR12-15 are resolved in code. The recorded full test pass remains valid historical command evidence, but it does not validate the new remediation or close CR12-9, the remaining medium findings, or the low-risk documentation/robustness items. The current code change has only frontend lint/build validation because runtime-test work and a rerun were deferred by request.
