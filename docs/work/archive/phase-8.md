# Phase 8 — Detailed Work Matrix

Date: 2026-06-18  
Owner: @vapor-pm  
Status: In Progress

**2026-06-21 — Full test run completed. 3 regressions found and fixed in `registerSocketHandlers.ts` (in-progress staged changes): REG-01 (T1.6-01 — `peer_left` for guest disconnect now emitted from `handleGuestGraceExpired` as designed, not immediately on disconnect), REG-02 (T8.2-04 — solo-timer restart removed from voluntary `leaveRoom` handler), REG-03 (T3.1-09 — race-condition block in `resume_session` removed). Dead code `emitPeerLeftToRoom` also removed. All 239 Phase 8 automated tests pass. See `docs/test_results/phase-8-test-result.md`.**

## Purpose

Phase 8 delivers the final layer of polish for launch. Items are sequenced by execution order: bug fixes first, then isolated frontend additions, then the backend feature, then the architectural layout work. VP-8.6 combines the participant side panel and the desktop layout into one VP because the desktop side panel is structurally part of `RoomViewDesktop` — separating them would produce a broken intermediate state.

### Design Direction Decisions

| # | Decision | Rationale |
|---|---|---|
| D-1 | `.vapor-app-frame` replaces `aspect-ratio: 9/19.5` with `height: calc(100dvh - 6rem)`. `max-width: 26rem` and `max-height: calc(100dvh - 6rem)` are retained. The panel fills available viewport height first; width follows naturally. | Fixed aspect ratio clips interactive elements on devices narrower or wider than 9:19.5. `dvh` accommodates every Android/iOS proportion. |
| D-2 | Kicked-participant socket stall fix: on `participant_kicked` (own ID), call `socket.disconnect()` then `socket.connect()` (with a `setTimeout(0)` tick between to flush pending microtasks) before transitioning to the room-ended screen. No page reload. | Resets transport state while keeping the React app alive, allowing immediate rejoin without a full refresh. |
| D-3 | `soloHostDeadlineAt?: number \| null` is added as an additive optional field to `PeerLeftPayload`. The backend sets it whenever a kick reduces participant count to host-only. The frontend reads it and updates `soloHostDeadlineAt` state. No new socket event. | Additive-only; backward-compatible with the existing signaling contract. |
| D-4 | Room names are optional, 3–24 chars, `[a-z0-9-]` after normalization to lowercase. The `join_room` `roomId` field accepts either the auto-generated ID or the room name; the backend resolves both (no separate payload field). Name conflicts during creation are rejected with `INVALID_SIGNAL_PAYLOAD` — the locked error-code set has no `ROOM_NAME_TAKEN`; the `message` field distinguishes the cause. | Keeps the error-code contract frozen while still communicating the specific failure. |
| D-5 | Browser notifications fire only when `document.hidden === true`. Notification body is always generic (no message content). Permission state is browser-managed; Vapor never reads or stores it server-side. | Privacy-forward: no content leaks through the notification layer; zero server persistence. |
| D-6 | Desktop and mobile room views are separated into distinct component files. `LobbyView.tsx` serves **all viewports** — no desktop lobby variant; the centered card shape is unchanged. `RoomView.tsx` is the mobile room layout (unchanged); `RoomViewDesktop.tsx` is the desktop room layout (new). Both room components accept the same props interface — no fork. Business logic stays exclusively in `App.tsx`/`useVaporRoom.ts`. `App.tsx` routes to the correct room component based on `useLayoutMode()`. | Lobby needs no desktop rework. Strict room layout/logic separation: each room layout evolves without touching the other, and swapping is a single conditional in `App.tsx`. |
| D-7 | The participant panel is built within the separated architecture: on mobile, `AvatarStack` in `RoomView.tsx` is replaced with a full-width toggle row ("N participants ▾") that expands the participant list **downward within the card** (accordion/dropdown — not a side drawer). On desktop, the participant panel is a **collapsible** right column in `RoomViewDesktop.tsx` — visible by default, fully hidden when collapsed, toggled by a button in the room header. Mobile panel code (8.6.5) is written before `RoomViewDesktop` (8.6.6) to establish the participant row pattern first. Desktop layout has **no left navigation sidebar** — only NavBar + a centered min/max-width content area with an optional collapsible right panel. | Stitch review confirmed: mobile dropdown-from-top is preferred over a side panel. Collapsible panel on desktop matches mobile parity and avoids permanently stealing horizontal space. |
| D-8 | `useLayoutMode()` returns `{ mode, setMode, isDesktopCapable }`. `isDesktopCapable` tracks `window.matchMedia('(min-width: 768px)')`. When false, `mode` is pinned to `'mobile'` regardless of stored preference. Default mode (no stored preference) is derived from device capability: desktop-capable → `'desktop'`; mobile → `'mobile'`. Returning users see their stored preference if `isDesktopCapable`; first-time visitors get the device-appropriate default. The NavBar layout toggle is rendered in the NavBar right area on desktop viewports only (`isDesktopCapable`); on mobile the NavBar right-side slot is replaced by a dropdown menu — the layout toggle does not appear there. Preference is stored in `localStorage`. | Users on a computer should see the richer desktop UI by default without manual switching; mobile users are pinned to mobile regardless. `localStorage` persists explicit overrides across tab closes. |
| D-9 | `RoomViewDesktop` uses a centered container with fixed `min-width` and `max-width` — not full-width. The container provides a constrained reading width on large displays while still expanding on mid-size desktops. Exact values from Stitch references. No `vapor-app-frame`. | Full-width on large monitors produces unreadable line lengths; a constrained max-width keeps the chat comfortable without wasting space. |

## Table of Contents

- [VP-8.1 Mobile-First Responsiveness](#vp-81-mobile-first-responsiveness)
- [VP-8.2 Post-Kick & Solo-Timer UX Fixes](#vp-82-post-kick--solo-timer-ux-fixes)
- [VP-8.3 Host Identity Badge in Chat](#vp-83-host-identity-badge-in-chat)
- [VP-8.4 Browser Push Notifications](#vp-84-browser-push-notifications)
- [VP-8.5 Human-Readable Room Names](#vp-85-human-readable-room-names)
- [VP-8.6 Desktop Layout & Participant Side Panel](#vp-86-desktop-layout--participant-side-panel)

---

## VP-8.1 Mobile-First Responsiveness

### Implementation Plan

| Subtask | Task | Module / Interface | Detail | Status | Pass Criteria | Evidence Pointer |
|---|---|---|---|---|---|---|
| 8.1.1 | Replace aspect-ratio with dvh-based height | `frontend/src/index.css` | In `.vapor-app-frame`: remove `aspect-ratio: 9 / 19.5`; add `height: calc(100dvh - 6rem)`. Retain `width: 100%`, `max-width: 26rem`, and `max-height: calc(100dvh - 6rem)`. The panel fills viewport height first; width stays pinned to `min(100%, 26rem)`. Update the comment block above the rule. | Done | At 375×667 (iPhone SE), 390×844 (iPhone 14), 393×852 (iPhone 15), and 412×915 (Pixel 8) the lobby and room panels fill available vertical height with no clipping and no unused whitespace bands. | build green; manual responsive sweep |
| 8.1.2 | Touch-target audit | `frontend/src/features/room/RoomView.tsx`, `frontend/src/features/room/LobbyView.tsx`, `frontend/src/components/ui/` | Audit all interactive elements (buttons, inputs, toggles) across `LobbyView` and `RoomView` for a minimum 44×44 px tap target. Apply `min-h-11 min-w-11` where targets fall short. Add padding rather than shrinking surrounding content; no layout-breaking changes. | Done | All buttons and inputs meet 44×44 px in the mobile frame at 375 px viewport width. | manual visual sweep |
| 8.1.3 | Build and lint check | `frontend/` | `npm run build` and `npm run lint` — no new errors on phase-8-touched files. | Done | Build clean; no new lint errors. | build green |

### Test Plan

| Test # | Suite | Purpose | Verification Focus | Status |
|---|---|---|---|---|
| T8.1-01 | build | `npm run build` passes after the CSS change. | Regression gate. | Pass |
| T8.1-02 | unit test | `.vapor-app-frame` uses `height: calc(100dvh - 6rem)` and `max-height: calc(100dvh - 6rem)`; no `aspect-ratio` present. | dvh-based height rule in CSS — deterministically guarantees fill at any viewport. | Pass |
| T8.1-03 | unit test | `.vapor-app-frame` retains `max-width: 26rem` and `width: 100%` after the change. | Centering constraint preserved in CSS — rule verification is sufficient. | Pass |
| T8.1-04 | unit test | `LobbyView` and `RoomView` have `min-h-11` on interactive elements. | Touch-target class present in JSX — `min-h-11` = 44 px by Tailwind spec. | Pass |

---

## VP-8.2 Post-Kick & Solo-Timer UX Fixes

### Implementation Plan

| Subtask | Task | Module / Interface | Detail | Status | Pass Criteria | Evidence Pointer |
|---|---|---|---|---|---|---|
| 8.2.1 | Shared payload: soloHostDeadlineAt on peer_left | `shared/payloads.ts` | Add `soloHostDeadlineAt?: number \| null` to `PeerLeftPayload`. Additive-only optional field; backward-compatible. | Done | TypeScript build passes with the new optional field. | build green |
| 8.2.2 | Backend: restart solo timer on kick | `backend/src/signaling/registerSocketHandlers.ts` (kick handler), `backend/src/signaling/roomLifecycle.ts` | In the kick handler, after the participant is removed: check if `room.participants.size === 1` (host only). If so, invoke the existing solo-host timer restart logic (extract into a shared helper if it isn't already one) and include the resulting `soloHostDeadlineAt` timestamp in the `peer_left` broadcast payload emitted to the host. | Done | When the host kicks the last non-host participant, `peer_left` is emitted with a valid `soloHostDeadlineAt`; `SoloWaitingChip` starts counting down in the host's view. | manual E2E |
| 8.2.3 | Frontend: consume soloHostDeadlineAt from peer_left | `frontend/src/features/room/useVaporRoom.ts` | In the `peer_left` handler: if `payload.soloHostDeadlineAt` is present and non-null, update `state.soloHostDeadlineAt`. This propagates to `SoloWaitingChip` via the existing state → prop chain without further changes. | Done | After the last guest is kicked, `SoloWaitingChip` appears and counts down correctly with no page refresh. | manual E2E |
| 8.2.4 | Frontend: kicked-participant socket reset | `frontend/src/features/room/useVaporRoom.ts` | In the `participant_kicked` handler: if `payload.participantId === state.participantId`, call `socket.disconnect()`, then `setTimeout(() => socket.connect(), 0)`, then transition to the `room-ended` screen. The `setTimeout(0)` tick ensures in-flight socket teardown microtasks complete before reconnecting (D-2). Also: added `connect()` to `RoomSocketClient` interface and factory; `withKickedFromRoom` now transitions to `screen: 'room-ended'` with the kicked message. | Done | Kicked participant can immediately join or create a new room from the room-ended screen with no "Connecting…" stall and no page refresh. | manual E2E |
| 8.2.5 | Post-kick rejoin policy documentation | `docs/system_design/Vapor_System_Design.md` | Add a short paragraph under the lifecycle section documenting the post-kick rejoin policy: a kicked participant may rejoin the same room immediately (no server-side cooldown; the host can kick again if needed). | Done | System design doc contains the post-kick policy paragraph. | doc review |
| 8.2.6 | Build and lint check | root | `npm run build` — no new errors. | Done | Build clean across shared, backend, and frontend. | build green |

### Test Plan

| Test # | Suite | Purpose | Verification Focus | Status |
|---|---|---|---|---|
| T8.2-01 | build | Build passes after all changes. | Regression gate. | Pass |
| T8.2-02 | integration test | Kicked socket can immediately create or join another room at the server level — no error returned. | Server accepts re-join after kick with no block. | Pass |
| T8.2-02 E2E | manual E2E | Guest is taken to room-ended screen after kick; clicks "Back to lobby" and joins a new room — no "Connecting…" stall visible in the UI. | Frontend socket reset (D-2) — no visible stall. | Pass |
| T8.2-03 | integration test | Host kicks the last remaining guest. `SoloWaitingChip` appears in the host's view within 1 s with a countdown. | Solo-timer restart on kick (D-3). | Pass |
| T8.2-04 | integration test | Guest leaves voluntarily (not kicked) — `SoloWaitingChip` still appears for the host (existing voluntary-leave behavior preserved). | Existing voluntary-leave solo-timer unaffected. | Pass |

---

## VP-8.3 Host Identity Badge in Chat

### Implementation Plan

| Subtask | Task | Module / Interface | Detail | Status | Pass Criteria | Evidence Pointer |
|---|---|---|---|---|---|---|
| 8.3.1 | Thread hostId to RoomView | `frontend/src/features/room/RoomView.tsx`, `frontend/src/App.tsx` | Add `hostId: string` to `RoomViewProps`. `hostId` is already stored in room state from `room_created`/`room_joined` payloads. Pass it from `App.tsx`. | Done | `RoomView` renders with `hostId` prop; no type errors. | build green |
| 8.3.2 | Crown badge on host chat messages | `frontend/src/features/room/RoomView.tsx` | In the message meta line: if `message.senderParticipantId === hostId`, render a small crown icon (inline SVG at 12 px) immediately after the sender name. Style via `--vapor-*` accent token (no raw color). Badge appears on the host's own outgoing messages too for consistency. | Done | Host messages show the crown icon; non-host messages do not. Badge appears on the host's own outgoing messages. | manual E2E |
| 8.3.3 | Build and lint check | `frontend/` | `npm run build` and `npm run lint` — no new errors. | Done | Build clean; no new lint errors on phase-8-touched files. | build green |

### Test Plan

| Test # | Suite | Purpose | Verification Focus | Status |
|---|---|---|---|---|
| T8.3-01 | build | Build passes after badge addition. | Regression gate. | Pass |
| T8.3-02 | manual E2E | 2-client session: host sends a message — crown icon in the meta line. Guest sends a message — no icon. | Badge appears only on host messages. | Pass |
| T8.3-03 | manual E2E | Host sees the crown badge on their own outgoing messages. | Self-badge consistency. | Pass |

---

## VP-8.4 Browser Push Notifications

### Implementation Plan

| Subtask | Task | Module / Interface | Detail | Status | Pass Criteria | Evidence Pointer |
|---|---|---|---|---|---|---|
| 8.4.1 | Notification hook | `frontend/src/lib/useNotifications.ts` (new) | Hook `useNotifications()` returns `{ requestPermission, notifyNewMessage }`. `requestPermission()` calls `Notification.requestPermission()` only when `Notification.permission === 'default'`; noop otherwise. `notifyNewMessage()` fires `new Notification('New message', { body: 'A new message arrived in your Vapor room.', tag: 'vapor-new-message' })` only when `document.hidden === true` and `Notification.permission === 'granted'`. `tag` deduplicates rapid notifications. All paths guard for `typeof Notification === 'undefined'` (Firefox private mode safety). No storage; no server interaction (D-5). | Done | `notifyNewMessage` fires only when document hidden and permission granted. `requestPermission` noops when not `'default'`. No errors in environments without the API. | build green; manual E2E |
| 8.4.2 | Request permission on room join | `frontend/src/features/room/useVaporRoom.ts` | Call `requestPermission()` when room state transitions to `in-room` (`room_created` or `room_joined` success). Pass `notifyNewMessage` as a callback into the WebRTC mesh initialization so the data-channel handler can invoke it without being inside a React component. | Done | Notification permission prompt appears on room join when permission is `'default'`. No prompt on lobby or info pages. | manual E2E |
| 8.4.3 | Fire notification on incoming message | `frontend/src/features/room/webrtc-chat-mesh.ts` (or equivalent data-channel handler) | Accept an optional `onNewMessage?: () => void` callback in the mesh constructor/init. Call it when a message is received from a remote peer. `useVaporRoom.ts` passes `notifyNewMessage` as this callback. The callback handles the `document.hidden` check internally; the mesh remains unaware of notification logic. | Done | Background notification fires when a message arrives while the tab is hidden. No notification when the tab is visible; no notification for the sender's own messages. | manual E2E |
| 8.4.4 | Build and lint check | `frontend/` | `npm run build` and `npm run lint` — no new errors. | Done | Build clean; no new lint errors. | build green |

### Test Plan

| Test # | Suite | Purpose | Verification Focus | Status |
|---|---|---|---|---|
| T8.4-01 | build | Build passes after notifications module. | Regression gate. | Pass |
| T8.4-02 | unit test + manual E2E | Join a room: notification permission prompt appears (if not already granted). Grant it. | Permission request on room join. | Pass |
| T8.4-03 | unit test | Background tab: switch away, send a message from a second client — notification fires. Content is generic (no message text). | Background notification content and trigger. | Pass |
| T8.4-04 | unit test | Foreground tab: message arrives — no notification fires. | Notification suppressed when tab is visible. | Pass |
| T8.4-05 | unit test | Send multiple messages in quick succession — only one notification appears (tag deduplication). | `tag` deduplication. | Pass |
| T8.4-06 | code review | Grep `frontend/src` for any write to `localStorage`/`sessionStorage` or any socket payload referencing notification state — must return nothing. | Zero persistence compliance (D-5). | Pass |

---

## VP-8.5 Human-Readable Room Names

### Implementation Plan

| Subtask | Task | Module / Interface | Detail | Status | Pass Criteria | Evidence Pointer |
|---|---|---|---|---|---|---|
| 8.5.1 | Shared type updates | `shared/payloads.ts` | Add `roomName?: string` to `CreateRoomPayload`, `RoomCreatedPayload`, and `RoomJoinedPayload`. No change to `JoinRoomPayload` — the existing `roomId` field accepts both generated IDs and room names; resolution is server-side (D-4). | Done | TypeScript build passes across shared, backend, and frontend with the new optional fields. | build green |
| 8.5.2 | Backend state expansion | `backend/src/signaling/state.ts` | Add `roomName?: string` to `RoomRecord`. Add `roomNameToId: Map<string, string>` to `SignalingState`. Update `createSignalingState()` to initialize the new map; `resetSignalingState()` to clear it. | Done | `createSignalingState()` returns a state with `roomNameToId` initialized; `resetSignalingState()` clears it. Build passes. | build green |
| 8.5.3 | Room name validation helper | `backend/src/signaling/backendUtils.ts` | Add `validateRoomName(name: unknown): string \| null` — returns normalized lowercase name if the input is a string of 3–24 chars matching `[a-z0-9-]` after lowercasing, otherwise `null`. | Done | Accepts `"my-room"`, `"abc"`, `"A1B"` (normalizes to `"a1b"`); rejects `""`, `"ab"`, 25-char strings, `"hello world"`, `"hi!"`. | build green |
| 8.5.4 | Create-room handler: name validation + storage | `backend/src/signaling/registerSocketHandlers.ts` (create_room handler) | Validate `payload.roomName` before room creation. If invalid or duplicate in `state.roomNameToId`, emit `INVALID_SIGNAL_PAYLOAD` with specific message and return early. Otherwise store name in `room.roomName` and `state.roomNameToId`. Include `roomName` in the `room_created` payload. Room name cleanup added to `destroyRoom` and `handleGuestGraceExpired`. | Done | Creating with a valid unique name succeeds; `room_created` carries `roomName`. Duplicate name returns `INVALID_SIGNAL_PAYLOAD`. Creating without a name succeeds as before. | manual E2E |
| 8.5.5 | Join-room handler: name resolution | `backend/src/signaling/registerSocketHandlers.ts` (join_room handler) | If `payload.roomId` doesn't match any key in `state.rooms`, attempt `state.roomNameToId.get(payload.roomId.toLowerCase())` and substitute the resolved ID. Include `roomName` in the `room_joined` payload. Also updated `resume_session` handler to include `roomName`. | Done | Joining by room name resolves correctly; joining by generated ID unchanged. Non-existent name/ID returns `ROOM_NOT_FOUND`. | manual E2E |
| 8.5.6 | Room destruction: name cleanup | `backend/src/signaling/roomLifecycle.ts` | In `removeParticipantBySocket`, delete from `state.roomNameToId` when isHost leaves or last participant leaves. Cleanup also added in `destroyRoom` and `handleGuestGraceExpired` in `registerSocketHandlers.ts`. | Done | After a room is destroyed, its name is freed for reuse (creating a new room with the same name succeeds). | manual E2E |
| 8.5.7 | Frontend — room name input in LobbyView | `frontend/src/features/room/LobbyView.tsx`, `frontend/src/features/room/useVaporRoom.ts`, `frontend/src/features/room/types.ts`, `frontend/src/features/room/state-utils.ts` | Added `roomNameInput` to `RoomSessionState` and `RoomSessionActions`. `LobbyView` shows room name field in create mode; join mode shows "Room ID or name" label. `submitLobby` passes `roomName` when non-empty. `onError` shows "Room name already taken or invalid." when `INVALID_SIGNAL_PAYLOAD` + create mode + non-empty `roomNameInput`. | Done | Room name field appears in create mode only; absent in join mode. Valid unique name submits; duplicate name shows inline error with specific copy. | manual E2E |
| 8.5.8 | Frontend — display room name in room header | `frontend/src/features/room/RoomView.tsx`, `frontend/src/features/room/state-utils.ts` | Added `activeRoomName` to `RoomSessionState`. `withRoomCreated`/`withRoomJoined` set it from payload. `RoomView` header shows `<name> · #<id>` when set, falls back to `#<id>`. | Done | Header shows name when one was set; shows only ID when no name. | manual E2E |
| 8.5.9 | Build and lint check | root | `npm run build` — no new errors. | Done | Build clean across shared, backend, and frontend. | build green |

### Test Plan

| Test # | Suite | Purpose | Verification Focus | Status |
|---|---|---|---|---|
| T8.5-01 | build | Build passes after all type and handler changes. | Regression gate. | Pass |
| T8.5-02 | integration test + manual E2E | Host creates room with name `"vapor-test"`. Header shows `"vapor-test · #<id>"`. Second client joins by entering `"vapor-test"` in the room field — succeeds. | End-to-end name creation and resolution. | Pass |
| T8.5-03 | integration test | Second host attempts to create a room named `"vapor-test"` while the first is live — receives error; first room unaffected. | Duplicate name rejection. | Pass |
| T8.5-04 | integration test | First room destroyed. Second host creates a room named `"vapor-test"` — succeeds (name freed on destroy). | Name freed on room destruction. | Pass |
| T8.5-05 | integration test | Host creates room without a name; header shows only `#<roomId>`. Joining by generated ID works as before. | Backward-compatible no-name path. | Pass |
| T8.5-06 | unit test | Attempt to create a room with name `"ab"` (too short) or `"room name"` (space) — error; room not created. | Format validation rejection. | Pass |

---

## VP-8.6 Desktop Layout & Participant Side Panel

Desktop and mobile room views are separated into distinct component files (D-6). The lobby UI is unchanged for all viewports. The participant panel is implemented within this architecture (D-7): mobile gets a full-width toggle row that expands the participant list **downward within the card** (accordion, not a side drawer) in `RoomView.tsx`; desktop gets a **collapsible** right-column panel in `RoomViewDesktop.tsx`. Desktop room view uses a fixed min/max-width centered container (D-9). All code work is preceded by Stitch reference generation.

### Implementation Plan

| Subtask | Task | Module / Interface | Detail | Status | Pass Criteria | Evidence Pointer |
|---|---|---|---|---|---|---|
| 8.6.1 | Stitch references: participant dropdown + desktop layout | Stitch MCP | Generate reference images: (a) desktop layout — full-width NavBar + two-column (chat left, participant panel right), no left sidebar; (b) mobile — toggle row with participant list dropping downward (open/closed states). Save to `docs/UI_design/reference/`. Reviewed and approved with two direction decisions: mobile uses top-dropdown not side drawer; desktop has no left nav sidebar. | Done | Reference images present in `docs/UI_design/reference/`. Directions confirmed per review: D-7 updated. | `RoomViewDesktop_phase8.jpg`, `RoomViewMobile_panel_closed_phase8.jpg`, `RoomViewMobile_panel_open_phase8.jpg` |
| 8.6.2 | Layout mode module + hook | `frontend/src/lib/layoutMode.ts` (new), `frontend/src/lib/useLayoutMode.ts` (new) | `layoutMode.ts`: `LAYOUT_MODE_KEY = 'vapor.layoutMode'`, `LAYOUT_MODES = ['mobile', 'desktop'] as const`, `type LayoutMode`, `isValidLayoutMode(v: unknown): v is LayoutMode` guard. No single `DEFAULT_LAYOUT_MODE` constant — default is device-derived. `useLayoutMode.ts`: returns `{ mode, setMode, isDesktopCapable }`. `isDesktopCapable` derived from `window.matchMedia('(min-width: 768px)')` with a `change` listener for live updates. Mode resolution order: (1) if `!isDesktopCapable`, pin to `'mobile'`; (2) if valid stored preference in `localStorage`, use it; (3) otherwise default to `isDesktopCapable ? 'desktop' : 'mobile'`. `setMode` writes to `localStorage[LAYOUT_MODE_KEY]`; all storage access in try/catch (D-8). | Done | ≥768 px, first visit: `mode === 'desktop'`. ≥768 px, returning with stored `'mobile'`: `mode === 'mobile'`. <768 px: `mode === 'mobile'` regardless of stored value. | build green; manual E2E |
| 8.6.3 | NavBar layout toggle | `frontend/src/App.tsx` (NavBar) | Add a two-state toggle ("Mobile" / "Desktop", icon or short label) to the NavBar right area, rendered only when `isDesktopCapable` (D-8). On mobile viewports (<768 px) the NavBar right-side slot does not exist — a dropdown menu is used instead; the layout toggle does not appear there. Active state highlighted; `aria-pressed`; visible focus ring; keyboard-operable. Calls `setMode` from `useLayoutMode`. | Done | Toggle visible at ≥768 px; absent at <768 px. Clicking switches mode; active state reflects current mode. | manual E2E |
| 8.6.4 | Lobby: no desktop variant | N/A | Lobby UI is unchanged for all viewports. `LobbyView.tsx` is the lobby component on both mobile and desktop — the `vapor-app-frame` centered card shape is retained as-is. `App.tsx` routes both `mode === 'desktop'` and `mode === 'mobile'` lobby state to `<LobbyView>`. No new file created. | Done (design decision) | Lobby renders identically on desktop and mobile. No LobbyViewDesktop created. | N/A |
| 8.6.5 | Mobile: top-dropdown participant toggle in RoomView | `frontend/src/features/room/RoomView.tsx` | Replace the `AvatarStack` collapsible toggle with a full-width toggle row at the top of the card content area (`aria-expanded`, `aria-controls`, distinct open ▴ / closed ▾ chevron). Toggle **expands the participant list downward within the card** (accordion — not a side drawer): each row shows avatar circle, nickname, host crown badge, Remove button (host-only). Participant count is shown in the toggle row itself ("N participants ▾"). `AvatarStack` component and its expansion logic are removed. All styles via `--vapor-*` tokens. | Done | Mobile (≤767 px): toggle row at top of card content; list drops down when open; participant rows show avatar, nickname, crown (host), Remove (host-only); chevron flips; `AvatarStack` no longer rendered. | manual E2E (mobile viewport) |
| 8.6.6 | RoomViewDesktop component | `frontend/src/features/room/RoomViewDesktop.tsx` (new) | Desktop room: centered container with fixed `min-width` and `max-width` (D-9) — chat feed on the left (flexible width), collapsible participant panel on the right (fixed ~280 px per D-7). Panel is visible by default; a toggle button in the room header collapses it completely. When collapsed the chat area expands to fill the full container width. Same props interface as `RoomView.tsx` — no fork. Participant rows reuse the visual pattern from 8.6.5 (avatar chip, nickname, host badge, Remove button). All existing behaviors (typing indicator, send, copy, leave, kick, diagnostics overlay) preserved. No `vapor-app-frame`. | Done | Desktop room renders centered two-column layout with collapsible participant panel. Panel toggles between visible and fully hidden. All existing room behaviors functional. Props interface identical to `RoomView.tsx`. | manual E2E (desktop viewport) |
| 8.6.7 | App.tsx routing by layout mode | `frontend/src/App.tsx` | Import `useLayoutMode`. In the main render path: `state.screen === 'lobby'` → always `<LobbyView>` (no desktop variant per 8.6.4). `state.screen === 'room'` → `<RoomViewDesktop>` when `mode === 'desktop'`, else `<RoomView>`. `RoomEndedView` has no desktop variant (terminal state is adequate on all viewports). | Done | Switching the NavBar toggle swaps room layouts with no state loss. Lobby and room-ended views unchanged on all viewports. | manual E2E |
| 8.6.8 | Isolation check + build | code review, `frontend/` | Grep `frontend/src` for `LAYOUT_MODE_KEY` — must only appear in `layoutMode.ts` and `useLayoutMode.ts`. Grep `backend/` for `layoutMode` — zero hits. Confirm no socket or WebRTC payload carries layout preference. Confirm `AvatarStack` and its expansion logic are fully removed from `RoomView.tsx` with no stale references. `npm run build` and `npm run lint` — no new errors. | Done | localStorage persistence isolated to the layout mode module; zero backend involvement (D-8); `AvatarStack` cleanly removed. Build clean. | code review; build green |

### Test Plan

| Test # | Suite | Purpose | Verification Focus | Status |
|---|---|---|---|---|
| T8.6-01 | doc review | Stitch reference images present in `docs/UI_design/reference/` for desktop layout and mobile panel open/closed states. | Reference completeness before code starts. | Pass |
| T8.6-02 | build | Build passes after all VP-8.6 subtasks. | Regression gate. | Pass |
| T8.6-03 | unit test | `App.tsx` imports `useLayoutMode` and `RoomViewDesktop`; routes to `RoomViewDesktop` on `'desktop'` mode; no `LobbyViewDesktop` exists. | Routing wiring and lobby-unchanged constraint. | Pass |
| T8.6-03 E2E | manual E2E | Desktop viewport (≥768 px): NavBar layout toggle visible; clicking switches room layout; lobby unchanged on both modes. | Visual routing at real viewport. | Pass |
| T8.6-04 | unit test | Set desktop mode, reload page — preference persists (localStorage). Close tab, reopen — mode still set to desktop. | localStorage persistence. | Pass |
| T8.6-05 | unit test | Mobile viewport (<768 px): NavBar toggle is absent; layout is always the mobile card regardless of any stored preference. | Toggle hidden and mode pinned on narrow viewport. | Pass |
| T8.6-06 | unit test | `RoomView.tsx` has `aria-expanded`, `aria-controls`, `participantCount` in toggle row, and `onKickParticipant` wired in participant rows. | Accessible dropdown structure and Remove wiring in JSX. | Pass |
| T8.6-06 E2E | manual E2E | Mobile (375 px): toggle row shows "N participants ▾"; tap expands list downward; chevron flips; `aria-expanded` matches state; participant rows show avatar, nickname, crown, Remove. | Visual and interaction at real mobile viewport. | Pass |
| T8.6-07 | unit test | `RoomViewDesktop.tsx` initialises `isPanelOpen` to `true` so the participant panel is visible by default. | Default-open panel state. | Pass |
| T8.6-07 E2E | manual E2E | Desktop layout (≥768 px): participant panel visible by default; two clients see each other in the panel. | Visual verification with real peers. | Pass |
| T8.6-11 | manual E2E | Desktop layout: panel toggle button collapses panel completely; chat expands to fill container; toggle again restores panel. | Desktop collapsible panel expand/collapse. | Pass |
| T8.6-08 | unit test | `RoomViewDesktop.tsx` accepts and wires `onSendChatMessage`, `onCopyRoomId`, `onLeaveRoom`, and `onKickParticipant`. | All core room actions present in desktop component. | Pass |
| T8.6-08 E2E | manual E2E | In desktop layout: send message, kick a participant, copy room ID, leave room — all function correctly end-to-end. | Full behavior at real runtime. | Pass |
| T8.6-09 | unit test | Both `RoomView.tsx` and `RoomViewDesktop.tsx` wire `onKickParticipant` to participant rows using the same prop name. | Kick wiring in both views with identical interface. | Pass |
| T8.6-09 E2E | manual E2E | Host clicks Remove from participant panel (mobile or desktop) — guest is kicked successfully. | Kick from panel at real runtime. | Pass |
| T8.6-10 | code review | `AvatarStack` and its expansion logic are removed from `RoomView.tsx`; no stale references remain. `LAYOUT_MODE_KEY` appears only in `layoutMode.ts` and `useLayoutMode.ts`. `backend/` has zero hits for `layoutMode`. | Clean removal and isolation (D-8). | Pass |

---

## Out of Scope

- Host transfer — `hostId` is static for the room lifetime; VP-8.3 badge tracks the original host only.
- Server-side kick cooldown — policy documented in 8.2.5; not enforced by the server.
- Persistent notification history — Web Notifications API is fire-and-forget.
- Desktop layout for `RoomEndedView` — terminal state is adequate on all viewports.
- Admin dashboard desktop layout — out of participant-facing scope.
- Tablet-specific breakpoints beyond the 768 px split.

## Dependency Order

**Independent — can begin in any order:**

- VP-8.1 (CSS fix, frontend-only)
- VP-8.2 (shared + backend + frontend bug fixes)
- VP-8.3 (frontend-only)
- VP-8.4 (frontend-only)
- VP-8.5 (shared + backend + frontend)

**Gated sequence:**

1. `8.6.1` — Stitch reference generation (prerequisite; no code begins until images are reviewed)
2. `8.6.2` — Layout mode module + hook (required before 8.6.3, 8.6.4, 8.6.5, 8.6.6, 8.6.7)
3. `[8.6.3, 8.6.5]` — NavBar toggle, mobile top-dropdown participant list (parallel once 8.6.2 is done; 8.6.4 is a design decision, no code)
4. `8.6.6` — RoomViewDesktop with collapsible panel (depends on 8.6.2; written after 8.6.5 to reuse the participant row pattern)
5. `8.6.7` — App.tsx routing (depends on 8.6.6 complete)
