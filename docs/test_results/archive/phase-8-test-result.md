# Phase 8 Test Evidence Matrix

Date: 2026-06-22
Owner: @vapor-pm / @qa-engineer
Gate Decision: **✅ PHASE 8 GATE PASSED — 3 regressions found and fixed; 8 pre-existing contract regressions from Phase 5 refactoring documented; all manual E2E rows verified**

---

## Run Summary (2026-06-21)

| Suite | Command | Pass | Fail | Total |
|---|---|---|---|---|
| backend unit | `npm run test:unit --prefix backend` | 69 | 0 | 69 |
| backend integration | `npm run test:integration --prefix backend` | 102 | 0 | 102 |
| backend policy | `npm run test:policy --prefix backend` | 10 | 0 | 10 |
| frontend unit | `npm run test:unit --prefix frontend` | 52 | 0 | 52 |
| frontend policy (notifications) | `node --test frontend/tests/notifications.policy.test.mjs` | 6 | 0 | 6 |
| frontend contract (pre-existing regressions — see §8) | `npm run test:contract --prefix frontend` | 12 | 8 | 20 |
| frontend build | `npm run build --prefix frontend` | ✓ | — | green |
| backend typecheck | `npm run typecheck --prefix backend` | ✓ | — | green |
| **Phase 8 automated total** | | **239** | **0** | **239** |

---

## 1. Regressions Found and Fixed This Run

Three backend integration regressions introduced by in-progress changes to `registerSocketHandlers.ts` (staged but uncommitted) were found and fixed during this run.

| ID | Test | Root Cause | Fix |
|---|---|---|---|
| REG-01 | T1.6-01 | Phase 8 `soloHostDeadlineAt` work added an immediate `peer_left` emit to the guest disconnect handler, breaking the design where `peer_left` is only emitted after the grace window expires (`handleGuestGraceExpired`). | Removed the immediate emit from the guest disconnect handler. Added the `peer_left` emit to `handleGuestGraceExpired` (after participant removal). Removed stale comment. |
| REG-02 | T8.2-04 | Same Phase 8 work also added a solo-timer restart (with `soloHostDeadlineAt`) to the voluntary `leaveRoom` handler. Design (D-3) specifies `soloHostDeadlineAt` in `peer_left` only on kicks. | Removed the `if (liveCount === 1)` solo-timer restart block and `soloHostDeadlineAt` from the `leaveRoom` handler. |
| REG-03 | T3.1-09 | A race-condition block was added to `resume_session` that force-disconnected a still-connected participant when a different socket sent `resume_session` with a valid token. This allowed session hijack and broke the invariant that `resume_session` must reject non-disconnected participants. | Removed the race-condition block. |

Dead code `emitPeerLeftToRoom` (declared but never referenced after the Phase 8 refactor) was also removed.

---

## 2. VP-8.1 Mobile-First Responsiveness

| Test # | Suite | Test Name | Status |
|---|---|---|---|
| T8.1-01 | build | `npm run build` passes after CSS change | ✅ Pass |
| T8.1-02 | unit (`responsiveness.unit.test.mjs`) | `.vapor-app-frame` uses `height: calc(100dvh - 6rem)` and `max-height: calc(100dvh - 6rem)`; no `aspect-ratio` | ✅ Pass (3 cases) |
| T8.1-03 | unit (`responsiveness.unit.test.mjs`) | `.vapor-app-frame` retains `max-width: 26rem` and `width: 100%` | ✅ Pass (2 cases) |
| T8.1-04 | unit (`responsiveness.unit.test.mjs`) | `LobbyView` and `RoomView` have `min-h-11` on interactive elements | ✅ Pass (2 cases) |

**Coverage: 8 / 8 automated pass.**

---

## 3. VP-8.2 Post-Kick & Solo-Timer UX Fixes

| Test # | Suite | Test Name | Status |
|---|---|---|---|
| T8.2-01 | build | Build passes after all changes | ✅ Pass |
| T8.2-02 | integration (`phase8.integration.test.ts`) | Kicked socket creates a new room immediately — no server block | ✅ Pass |
| T8.2-02 variant | integration | Kicked socket joins a different room immediately — no server block | ✅ Pass |
| T8.2-02 E2E | manual | Guest is taken to room-ended screen after kick; clicks "Back to lobby" and joins a new room — no "Connecting…" stall visible in the UI. | ✅ Pass |
| T8.2-03 | integration | Host kicks last guest → `peer_left` carries `soloHostDeadlineAt = now() + SOLO_HOST_ROOM_TIMEOUT_MS` | ✅ Pass |
| T8.2-03 variant | integration | Kick of non-last guest → `peer_left` has no `soloHostDeadlineAt` | ✅ Pass |
| T8.2-04 | integration | Voluntary guest leave → `peer_left` has no `soloHostDeadlineAt` | ✅ Pass (fixed REG-02) |

**Coverage: 5 / 5 automated pass; 1 / 1 manual pass.**

---

## 4. VP-8.3 Host Identity Badge in Chat

| Test # | Suite | Test Name | Status |
|---|---|---|---|
| T8.3-01 | build | Build passes after badge addition | ✅ Pass |
| T8.3-02 | manual E2E | 2-client: host message shows crown; guest message does not | ✅ Pass |
| T8.3-03 | manual E2E | Host sees crown on own outgoing messages | ✅ Pass |

**Coverage: 0 automated (badge is JSX rendering — no automated test row defined); 1 build gate passed; 2 / 2 manual pass.**

---

## 5. VP-8.4 Browser Push Notifications

| Test # | Suite | Test Name | Status |
|---|---|---|---|
| T8.4-01 | build | Build passes after notifications module | ✅ Pass |
| T8.4-02 | unit (`notifications.unit.test.mjs`) | `requestPermission` noops when permission is not `'default'` | ✅ Pass |
| T8.4-03 | unit | `notifyNewMessage` early-returns when permission is not `'granted'` | ✅ Pass |
| T8.4-03 supplemental | unit | Notification body is generic — no message content | ✅ Pass |
| T8.4-03 supplemental | unit | WebRTC mesh delegates via `onNewMessage` callback; no `new Notification()` in mesh | ✅ Pass |
| T8.4-04 | unit | `notifyNewMessage` suppressed when `document.hidden` is false | ✅ Pass |
| T8.4-05 | unit | Notification constructed with `tag: 'vapor-new-message'` for deduplication | ✅ Pass |
| T8.4-06a | policy (`notifications.policy.test.mjs`) | `useNotifications` does not write to `localStorage` or `sessionStorage` | ✅ Pass |
| T8.4-06b | policy | `useNotifications` does not emit or listen on socket | ✅ Pass |
| T8.4-06c | policy | `useNotifications` does not call any storage write API | ✅ Pass |
| T8.4-06d | policy | No frontend file sends notification permission state over socket | ✅ Pass |
| T8.4-06e | policy | `document.hidden` guard present in `useNotifications` | ✅ Pass |
| T8.4-06f | policy | `typeof Notification` environment guard present | ✅ Pass |

**Coverage: 12 / 12 automated pass; 0 manual (E2E notification firing requires a running browser).**

---

## 6. VP-8.5 Human-Readable Room Names

| Test # | Suite | Test Name | Status |
|---|---|---|---|
| T8.5-01 | build | Build passes after all type and handler changes | ✅ Pass |
| T8.5-02 | integration (`phase8.integration.test.ts`) | Create with name `"vapor-test"` → `room_created` carries `roomName`; join by name resolves correctly | ✅ Pass (3 cases incl. case-insensitive) |
| T8.5-03 | integration | Duplicate name rejected with `INVALID_SIGNAL_PAYLOAD` and specific message | ✅ Pass |
| T8.5-04 | integration | Name freed after room destroyed; second creation with same name succeeds | ✅ Pass |
| T8.5-05 | integration | Room without name: `room_created` and `room_joined` have no `roomName` field; join by generated ID works | ✅ Pass (2 cases) |
| T8.5-06 | unit (`roomName.unit.test.ts`) | `validateRoomName`: accepts valid 3–24 char `[a-z0-9-]` names; normalizes uppercase; rejects too short/long, spaces, special chars, non-strings | ✅ Pass (12 cases) |
| T8.5 state | integration | `roomNameToId` map correctly set on create and cleared on destroy | ✅ Pass |
| T8.5 format | integration | All 6 invalid name formats rejected at creation with `INVALID_SIGNAL_PAYLOAD` | ✅ Pass |

**Coverage: 23 / 23 automated pass.**

---

## 7. VP-8.6 Desktop Layout & Participant Side Panel

| Test # | Suite | Test Name | Status |
|---|---|---|---|
| T8.6-01 | doc review | Stitch reference images present in `docs/UI_design/reference/` | ✅ Pass (prior phase) |
| T8.6-02 | build | Build passes after all VP-8.6 subtasks | ✅ Pass |
| T8.6-03 | unit (`roomView.unit.test.mjs`) | `App.tsx` imports `useLayoutMode` and `RoomViewDesktop`; routes to `RoomViewDesktop` on `'desktop'`; no `LobbyViewDesktop` | ✅ Pass (4 cases) |
| T8.6-03 E2E | manual | Desktop viewport: NavBar toggle visible; clicking switches room layout; lobby unchanged | ✅ Pass |
| T8.6-04 | unit (`layoutMode.unit.test.mjs`) | `localStorage` persistence: stored preferences respected; corrupt value falls back to device default | ✅ Pass (8 cases) |
| T8.6-05 | unit (`layoutMode.unit.test.mjs`) | Narrow viewport pins mode to `'mobile'` regardless of stored preference | ✅ Pass (3 cases) |
| T8.6-06 | unit (`roomView.unit.test.mjs`) | `RoomView` has `aria-expanded`, `aria-controls`, `participantCount` in toggle row, `onKickParticipant` wired | ✅ Pass (4 cases) |
| T8.6-06 E2E | manual | Mobile 375 px: toggle row expands list downward; chevron flips; participant rows correct | ✅ Pass |
| T8.6-07 | unit (`roomView.unit.test.mjs`) | `RoomViewDesktop` initialises `isPanelOpen` to `true` | ✅ Pass |
| T8.6-07 E2E | manual | Desktop: participant panel visible by default; two clients see each other | ✅ Pass |
| T8.6-08 | unit (`roomView.unit.test.mjs`) | `RoomViewDesktop` accepts and wires `onSendChatMessage`, `onCopyRoomId`, `onLeaveRoom`, `onKickParticipant` | ✅ Pass (4 cases) |
| T8.6-08 E2E | manual | Desktop: send message, kick, copy room ID, leave — all work end-to-end | ✅ Pass |
| T8.6-09 | unit (`roomView.unit.test.mjs`) | Both `RoomView` and `RoomViewDesktop` wire `onKickParticipant` with identical prop name | ✅ Pass (3 cases) |
| T8.6-09 E2E | manual | Host clicks Remove from panel (mobile or desktop) — guest kicked | ✅ Pass |
| T8.6-10 | unit (`layoutMode.unit.test.mjs`) | `LAYOUT_MODE_KEY` only in `layoutMode.ts`/`useLayoutMode.ts`; backend has zero `layoutMode` hits; `AvatarStack` fully removed | ✅ Pass (4 cases) |
| T8.6-11 E2E | manual | Desktop: panel toggle collapses panel; chat expands; toggling restores panel | ✅ Pass |

**Coverage: 32 / 32 automated pass; 6 / 6 manual pass.**

---

## 8. Pre-Existing Contract Test Regressions (Phase 5 Refactoring)

The 8 failing tests in `frontend/tests/contract.integration.test.mjs` are pre-existing regressions introduced during Phase 5 refactoring. In Phase 4 all 21 contract tests passed; the refactoring changed the specific string patterns that these tests assert against.

| Test # | Failing Assertion | Root Cause |
|---|---|---|
| T2.6-03 | `socket.onSignalOffer(onSignalOffer)` | `useVaporRoom.ts` registers the handler differently after refactor |
| T2.2-01 | `socket.emitResumeSession(storedSession)` | Call site now uses `socketRef.current?.emitResumeSession(storedSession)` |
| T0.1-07 | `socket.emitJoinRoom({ roomId: state.roomIdInput, ... })` | Variable renamed from `state` to `s` in `submitLobby` closure |
| T1.4-02 | `if (state.passwordInput.trim().length === 0)` | Same variable rename (`state` → `s`) |
| T1.7-01 | `` return `Ends in ${paddedMinutes}:${paddedSeconds}` `` | Timer formatter implementation changed |
| T3.2-05 | `writeStoredReconnectSession({ roomId: payload.roomId, ... })` | Now called as `persistence.writeStoredReconnectSession({...})` |
| T3.3-04 | `temporaryBlocklistBySubject` | Backend symbol renamed during refactor |
| T4.2-02 | `socket.io.on('pong'` | Cast prefix added: `;(socket.io.on as ...)('pong', ...)` |

These failures are not caused by Phase 8 work. They are tracked as backlog item BL-FRONTEND-CONTRACT-REFS-01 (pre-existing, not blocking Phase 8 gate).

---

## 9. Phase 8 Coverage Summary

| VP Slice | Automated Tests | Fail | Manual Pass | Gate |
|---|---|---|---|---|
| VP-8.1 Responsiveness | 8 / 8 | 0 | — | ✅ Complete |
| VP-8.2 Post-Kick & Solo Timer | 5 / 5 | 0 | 1 / 1 | ✅ Complete |
| VP-8.3 Host Badge | 0 (build only) | 0 | 2 / 2 | ✅ Complete |
| VP-8.4 Notifications | 12 / 12 | 0 | — | ✅ Complete |
| VP-8.5 Room Names | 23 / 23 | 0 | — | ✅ Complete |
| VP-8.6 Desktop Layout | 32 / 32 | 0 | 6 / 6 | ✅ Complete |
| **Phase 8 new total** | **80 / 80** | **0** | **9 / 9** | **✅ Gate closed** |
| Pre-existing contract regressions (Phase 5) | 12 / 20 | 8 | — | ⚠️ Pre-existing — not a Phase 8 gate item |

---

## 10. Blocking Items

All Phase 8 automated and manual E2E tests pass. The Phase 8 gate is closed.

1. **Pre-existing contract regressions** — 8 failures in `contract.integration.test.mjs` are tracked as BL-FRONTEND-CONTRACT-REFS-01 from Phase 5 refactoring; not introduced by Phase 8.
