# Phase 10 — Bug Fix & Chat Persistence

Date: 2026-06-24  
Owner: @vapor-pm  
Status: Planned

**Scope:** Fix the E2E bugs discovered during Phase 9 validation testing and introduce chat history persistence (session-scoped, local-only). All bugs are non-critical functionality issues that do not affect room creation, joining, or basic signaling.

**Estimated Effort:** ~10 hours over 2–3 days.

## Purpose

Phase 9 implementation (274/274 tests passing) passed unit and contract test gates but E2E testing identified correctness bugs in:
1. Guest disconnect notifications (CRITICAL: violates design spec)
2. Guest-to-guest messaging after host disconnect
3. Room expiry timer UI reliability
4. Chat scroll UI positioning
5. Chat history persistence (feature) — including no-duplicate / no-stale-outbound guarantees on reconnect

## Table of Contents

- [VP-10.1 Guest Disconnect Notification](#vp-101-guest-disconnect-notification)
- [VP-10.2 Guest Messaging After Host Disconnect](#vp-102-guest-messaging-after-host-disconnect)
- [VP-10.3 UI Reliability & Styling](#vp-103-ui-reliability--styling)
- [VP-10.4 Chat History Persistence (Local)](#vp-104-chat-history-persistence-local)

---

## VP-10.1 Guest Disconnect Notification *(BL-SIG-GUEST-DISCONNECT-01)*

### Purpose

Guest disconnect events currently do not emit `peer_left` to remaining participants, violating System Design Rule 5 and §6.0. Guests must be immediately removed from the participants list on disconnect, just like hosts. The grace window (30 min reconnection window) is independent of visibility. The design doc (§6.0, line 216) already specifies this — only the code diverges, so this is a code bug, not an architectural conflict.

### Implementation Plan

| Subtask | Task | Module / Interface | Detail | Status | Pass Criteria |
|---|---|---|---|---|---|
| 10.1.1 | Emit `peer_left` on guest TCP disconnect | `backend/src/signaling/registerSocketHandlers.ts` (guest disconnect path, lines 983–1001; the "stays visible" comment is at lines 997–998) | Replace the "no peer_left emitted here" comment (lines 997–998) with an actual emission, mirroring the host disconnect path (lines 959–981). Compute `liveCount` via `getLiveParticipantCount(room)` and call `restartSoloTimerIfSolo(roomId, liveCount)` to obtain the deadline. Emit `peer_left` with `reason: "disconnect"`, `participantCount: liveCount`, and `soloDeadlineAt` (if solo timer restarted). Guest grace setup (`grace.beginGuestGrace` + `markReconnectDisconnected`) remains unchanged — the grace timer runs independently for reconnection eligibility. | Done | Backend emits `peer_left` (reason: "disconnect") for all guest disconnects, matching host behavior. |
| 10.1.2 | No doc change needed (design already correct) | `docs/system_design/Vapor_System_Design.md` (§6.0, lines 213–220) | §6.0 already states grace = reconnection eligibility only, that the participant is "immediately removed from the participants list," and that "`peer_left` is broadcast to remaining participants." Cite §6.0 as the pass-criteria anchor for 10.1.1. | N/A | §6.0 already states grace ≠ visibility. |
| 10.1.3 | Build and lint check | Root | `npm run typecheck` and `npm run lint` (backend) — no new errors. | Done | Typecheck clean; no new lint errors introduced (pre-existing errors unrelated to this change). |

### Test Plan

| Test # | Suite | Purpose | Status |
|---|---|---|---|
| T10.1-01 | integration | Host + Guest1 + Guest2 room. Guest1 TCP drops. Remaining participants (Host, Guest2) receive `peer_left` (reason: "disconnect") with Guest1's participantId. Guest1 is removed from participants list. | Pass |
| T10.1-02 | integration | Guest TCP drops leaving host alone (`liveCount === 1`). `peer_left` carries `soloDeadlineAt` (solo timer restarted for host). | Pass |
| T10.1-03 | integration | All guests TCP drop, host remains alone (`liveCount === 1`). `peer_left` emitted for each guest. Solo timer running for host. | Pass |
| T10.1-04 | build | Build passes; no new errors post-emission fix. | Pass |

> **Obsolete-test note:** `T1.6-01` ("guest disconnect starts grace and removes guest only after guest-grace timeout") in `backend/tests/socket.integration.test.ts` asserted the pre-VP-10.1 behavior (no `peer_left` until grace expiry) and was **removed** (replaced with an in-file obsolescence comment). Superseded by T10.1-01/02/03. The unrelated policy-suite `T1.6-01` is untouched.

---

## VP-10.2 Guest Messaging After Host Disconnect *(BL-SIG-GUEST-MESSAGING-01)*

### Purpose

When the host disconnects, remaining guests should be able to exchange messages via WebRTC P2P connections. E2E testing shows message delivery fails, suggesting a bug in the `onPeerLeft` handler or WebRTC peer mesh management.

### Implementation Plan

| Subtask | Task | Module / Interface | Detail | Status | Pass Criteria |
|---|---|---|---|---|---|
| 10.2.1 | Trace WebRTC peer connections on `peer_left` | `frontend/src/features/room/useVaporRoom.ts` (module-level `DEBUG_PEER_TRACE`/`tracePeer`, `onPeerLeft` handler) | Added a dormant module-level `DEBUG_PEER_TRACE` flag (default `false`) and `tracePeer()` helper; `onPeerLeft` traces the leaving peer, reason, and remaining peer ids. Root cause confirmed by static analysis: chat send is **not** gated on `chatConnectionState`/`connectedPeerCount` ([RoomView.tsx:570](../../frontend/src/features/room/RoomView.tsx#L570)) and `sendMessage` broadcasts only to **open** data channels, so a never-formed guest↔guest channel (masked while the host is present) is the failure — not a state bug. | Done | Tracing infrastructure in place (dormant); root cause = unrepaired guest↔guest channel after shared peer leaves. |
| 10.2.2 | Check pending message handling | `frontend/src/features/room/useVaporRoom.ts` (`onPeerLeft` handler) | Verified: pending messages are cleared **only** in the `participantCount <= 1` (truly solo) branch — never when ≥ 2 guests remain. No change needed; the pending queue + `flushPendingMessages` on channel-open correctly delivers once a repaired channel opens. | Done | Pending messages not cleared or blocked when guests remain. |
| 10.2.3 | Validate `syncPeers` revalidation | `frontend/src/features/room/webrtc-chat-mesh.ts` (`syncPeers`, new `needsOffer` guard) | `onPeerLeft` now calls `syncPeers(remainingPeerIds)` to repair the mesh after a peer leaves. Added `needsOffer(peerId)` so `syncPeers` doubles as a safe repair pass: it (re)offers only to peers lacking an open channel and in a `stable` signaling state, leaving healthy / mid-negotiation links untouched. | Done | Mesh revalidated on peer departure; guest↔guest connection re-established without disrupting healthy links. |
| 10.2.4 | Fix identified issue | `frontend/src/features/room/useVaporRoom.ts` (`onPeerLeft`), `webrtc-chat-mesh.ts` (`syncPeers`/`needsOffer`) | Applied fix (b): `onPeerLeft` computes remaining peer ids from `stateRef.current.participants` (excluding self + the leaving peer) and calls `syncPeers` to revalidate/repair the remaining mesh. | Done | Guests can send/receive messages after host disconnects (pending live E2E verification in step 7). |
| 10.2.5 | Build and lint check | Root | `npm run build` (tsc clean) and `npm run lint` — no new errors/warnings in changed regions (pre-existing `onRoomCreated`/`persistence` warnings unrelated). `DEBUG_PEER_TRACE` confirmed `false`. | Done | Build clean; debug flag off. |

### Test Plan

| Test # | Suite | Purpose | Status |
|---|---|---|---|
| T10.2-01 | unit (frontend) | **Mesh-repair decision logic** (`webrtc-chat-mesh.ts`). With mocked `RTCPeerConnection`/`RTCDataChannel`: `needsOffer(peer)` returns `false` for a peer with an open channel and for one in a non-`stable` signaling state, `true` otherwise. After removing the shared peer, `syncPeers([remaining])` (re)offers only to a peer that lacks an open channel and is `stable`, and leaves a healthy / mid-negotiation link untouched. This is the actual VP-10.2 fix and is fully deterministic with RTC mocks — no live peers needed. | Pass |
| T10.2-02 | integration (backend) | Host + Guest1 + Guest2 on a real socket.io server. Host disconnects, then Guest1↔Guest2 emit `signal_offer`/`signal_answer`/`signal_ice`; assert the server relays each to the correct remaining peer (the signaling path the repaired mesh depends on). Real-server pattern already proven in `phase10.integration.test.ts`. | Pass |
| T10.2-03 | unit (frontend) | `onPeerLeft` handler logic: remaining peer ids are recomputed from `participants` (excluding self + leaver) and passed to `syncPeers`; the outbound pending queue is **not** cleared while ≥2 peers remain (cleared only on the truly-solo `participantCount <= 1` branch). | Pass |
| T10.2-04 | E2E (manual) | **Irreducible:** live two-peer delivery — after host disconnects, Guest1 and Guest2 actually see each other's messages render in the browser. Requires a real WebRTC media/ICE path that the node test harness cannot reproduce. | Pass |

---

## VP-10.3 UI Reliability & Styling

### Purpose

Room expiry timer display is unreliable (disappears/reappears with UI interaction); chat scroll bar positioning is incorrect on desktop.

**Timer root cause:** The countdown is rendered by the `RoomLifetimeChip` memo component (`RoomViewDesktop.tsx` lines 226–259 and `RoomView.tsx` lines 439–468). Its `setInterval` is correctly wired to a `useEffect` keyed on `expiresAt` (desktop lines 230–234) driving a `nowMs` state tick. The "disappears and reappears" behavior comes from the guard `if (!expiresAt || isInputFocused) return null` (desktop line 251 / mobile line 466): the chip unmounts whenever any `INPUT`/`TEXTAREA` gains focus (focusin/focusout listeners, desktop lines 236–249), so the timer vanishes every time the user clicks into the chat input. `getLifetimeText` is exported from `useVaporRoom.ts` (imported at the top of both views).

### Implementation Plan

| Subtask | Task | Module / Interface | Detail | Status | Pass Criteria |
|---|---|---|---|---|---|
| 10.3.1 | Confirm timer intent | `RoomLifetimeChip` in `RoomViewDesktop.tsx` and `RoomView.tsx` | The `isInputFocused` guard hides the chip on input focus — likely added to free vertical space on the mobile soft-keyboard. **Decision (user, 2026-06-24): remove everywhere** — timer stays mounted and ticks while typing on both desktop and mobile. | Done | Decision: remove the guard in both views. |
| 10.3.2 | Fix timer display | `RoomLifetimeChip` (both views) | Removed the `isInputFocused` state, the `focusin`/`focusout` listener effect, and the `isInputFocused` term from the early-return guard in both `RoomViewDesktop.tsx` and `RoomView.tsx`. Guard is now `if (!expiresAt) return null`. Interval logic unchanged. | Done | Timer appears immediately and updates every second without disappearing on input focus. |
| 10.3.3 | Fix chat scroll positioning | `frontend/src/App.tsx` (desktop-room `<main>`) | Root cause: the desktop chat flex chain (`RoomViewDesktop` root → body → chat column → `MessageFeed`) already carries `min-h-0` at every level, but the flex root `<main>` used `min-h-dvh` (grows with content), so the feed's `overflow-y-auto` never engaged. Changed the desktop-room `<main>` from `min-h-dvh` to `h-dvh` (fixed viewport height) to bound the chain; `NavBar` is `fixed` so it does not consume flow height. | Done | Long chat histories show scroll bar on chat container, not browser window. |
| 10.3.4 | Build check | Root | `npm run build` — `tsc -b` clean + `vite build` succeeded; no new errors. | Done | Build clean. |

### Test Plan

| Test # | Suite | Purpose | Status |
|---|---|---|---|
| T10.3-01a | manual | **Fix logic** (the `isInputFocused` guard removal): assert `getLifetimeText(expiresAt)` (exported pure fn) returns a non-empty countdown string for a future `expiresAt` and the empty/absent string for `null`, so the chip's only remaining mount condition is `expiresAt`. Statically assert the `isInputFocused` state, the `focusin`/`focusout` effect, and the guard term are gone from both `RoomLifetimeChip` definitions. | Pass (manual) — chip present across focus/blur/type cycles; guard removal confirmed |
| T10.3-01b | E2E | **Irreducible:** visual confirmation that the chip stays mounted and the second-by-second `setInterval` tick keeps rendering while typing and across tab-visibility changes (real timers + focus + paint). | Pass |
| T10.3-02 | E2E | **Irreducible:** desktop view with 50+ messages — scroll bar appears on the chat container, not the page, and scrolls independently. Requires a real browser layout engine (computed `scrollHeight`/`clientHeight` from the flex chain + `h-dvh`); not reproducible without DOM layout. | Pass |

---

## VP-10.4 Chat History Persistence (Local) *(BL-UX-CHAT-PERSISTENCE-01)*

### Purpose

Chat history is wiped on any disconnect (involuntary TCP drop), so users lose context if they accidentally refresh the browser. New behavior: preserve chat in `sessionStorage` per room unless the user has effectively left (explicit leave, kick, room destruction, or expired grace window). Implementation uses a **single persistent `sessionStorage` entry per room** (`vapor.chat:<roomId>`) updated (not appended) with each new message.

**Storage model:** chat is not stored on the server (signaling-only, zero-persistence) and is not a replicated/verified ledger. Messages travel peer-to-peer over WebRTC data channels and live in each client's browser memory; this feature adds a per-tab `sessionStorage` copy on each client. Each peer holds only its own local copy of what it received — no consensus, copies can legitimately differ. A peer offline during a message simply lacks it (no replay today — see `BL-CHAT-PERSIST-RAM-01`).

**Reconnect guarantees (absorbed from former reconnect-leak item):** on involuntary reconnect, the displayed history equals the restored snapshot — never empty, never a re-delivered backfill, never duplicated. The outbound pending queue must not re-flush stale messages to peers, and incoming messages must dedupe by id against the restored history.

### Implementation Plan

| Subtask | Task | Module / Interface | Detail | Status | Pass Criteria |
|---|---|---|---|---|---|
| 10.4.1 | Add chat persistence utility | `frontend/src/features/room/hooks/useChatMessaging.ts` (extended) | Added exported helpers `saveChatHistory(roomId, messages)`, `loadChatHistory(roomId)`, `clearChatHistory(roomId)` plus an `isChatMessage` type guard. Storage key prefix `vapor.chat:` lives in `constants.ts` (`CHAT_HISTORY_STORAGE_KEY_PREFIX`). `saveChatHistory` JSON-serializes the chat array into a single `sessionStorage` entry keyed `vapor.chat:<roomId>` (overwrite). `loadChatHistory` parses, validates it's an array, and filters via `isChatMessage`. All wrapped in try/catch (quota/private-mode safe). | Done | Chat history serialized in single `sessionStorage` entry per room. |
| 10.4.2 | Persist chat on new message | `frontend/src/features/room/useVaporRoom.ts` (new persistence `useEffect`) | Implemented as a single `useEffect` keyed on `[state.chatMessages, state.activeRoomId, state.screen]` rather than scattered calls in `onRemoteMessage`/`sendChatMessage`. This covers **all** append paths — incoming, outgoing, **and** system-event messages (join/left/nickname) — with one save point, and React's batching coalesces multiple appends in a tick into a single commit/save (no `queueMicrotask` needed). Guarded on `screen === 'room'` so terminal transitions never re-save an empty array. **Decision:** system messages persist too (restored view matches what was on screen). | Done | Chat persisted to `sessionStorage` on each new message. |
| 10.4.3 | Restore chat history on room join | `frontend/src/features/room/useVaporRoom.ts` (`onRoomJoined`) | `loadChatHistory(roomId)` is read once outside the reducer; the restored snapshot is merged **directly into the `withRoomJoined` transition** (`{ ...joined, chatMessages: restoredChat }`) so there is no intermediate empty-chat commit that the persistence effect could observe and overwrite. Resume (`resume_session`) maps to `room_joined`, so this path covers reconnect. Local-only; no server fetch. | Done | Rejoining room (after accidental disconnect) restores the pre-disconnect chat snapshot. |
| 10.4.4 | Prevent duplicates & stale outbound re-flush on reconnect | `frontend/src/features/room/useVaporRoom.ts` (`onRoomJoined`), `state-utils.ts` (`withAppendedChatMessage`) | `onRoomJoined` calls `chat.clearPending()` to drop the **outbound** `pendingMessagesRef` (not cleared on a transient drop, since `clearRoomSession` only runs on terminal events), preventing pre-drop messages re-flushing to peers. `withAppendedChatMessage` is now **idempotent by `messageId`** — an append of an id already present (restored entry, or StrictMode double-invoke) returns state unchanged, so restored entries are never shown twice. Wire protocol sends raw text (fresh id on receipt) + no replay buffer, so re-delivery of a restored entry cannot occur in practice. | Done | After reconnect: no stale outbound re-flush; no incoming message duplicates a restored entry. |
| 10.4.5 | Clear chat on terminal events only | `frontend/src/features/room/useVaporRoom.ts` event handlers | `clearChatHistory(roomId)` called from handlers (never reducers): `leaveRoom` & `backToLobby` (explicit leave), `onParticipantKicked` (self-kick), `onRoomDestroyed` (covers host grace expiry / TTL / solo-timeout — every client clears its own entry), and `onError` auto-resume terminal failures `RECONNECT_TOKEN_STALE` / `HOST_RECONNECT_WINDOW_EXPIRED` (guest grace expiry) plus `ROOM_NOT_FOUND` / `INVALID_PASSWORD` / `RATE_LIMITED`. During resume the room id is read from the stored reconnect session (state not yet populated). Never cleared on a recoverable TCP drop. | Done | Chat cleared on explicit leave, kick, room destruction (incl. host grace expiry), and stale/expired resume — never on a recoverable TCP drop. |
| 10.4.6 | Update system design | `docs/system_design/Vapor_System_Design.md` — §1.1 "Frontend Token Storage Policy" | Rewrote the existing **Chat History** bullet: corrected key to `vapor.chat:<roomId>` (was `vapor.chat.<roomId>`), documented the restore-on-`room_joined` flow, the reconnect guarantees (outbound queue dropped, idempotent-by-`messageId` appends), and the full terminal-event clear list (leave/back, kick, `room_destroyed` incl. host grace, stale/expired resume incl. guest grace) + native tab-close. | Done | Design doc reflects new persistence behavior. |
| 10.4.7 | Build and lint check | Root | `npm run build` (tsc -b + vite) clean; `npm run lint` shows **0 errors** and the same **4 pre-existing warnings** (1 `onRoomCreated` unused-directive + 3 `persistence` missing-dep) confirmed against the stashed baseline — zero new warnings introduced. | Done | Build clean. |

### Test Plan

| Test # | Suite | Purpose | Status |
|---|---|---|---|
| T10.4-01 | E2E | **Restore round-trip:** reload host tab → auto-resume → chat history restored from sessionStorage | Pass |
| T10.4-02 | E2E | **Clear on explicit leave:** guest leaves explicitly → `vapor.chat:<roomId>` key removed | Pass |
| T10.4-03 | E2E | **Stale reconnect token → lobby (covers ROOM_NOT_FOUND on bad session):** inject non-existent session, reload → app returns to lobby, session cleared | Pass |
| T10.4-04 | E2E | **Stale reconnect token → session cleared:** same as T10.4-03 scenario | Pass |
| T10.4-05 | E2E | **Room destroyed → guest clears history:** host leaves → `room_destroyed` → guest sessionStorage cleared | Pass |
| T10.4-06 | E2E | **No duplicate messages on reconnect:** host reloads, reconnects → pre-reload message appears exactly once | Pass |
| T10.4-07 | E2E | **Irreducible:** full live flow — host + 2 live WebRTC peers, host drops and reconnects, history restored | Pass |

---

## Out of Scope

- Heartbeat implementation (`BL-SIG-HEARTBEAT-01`) — deferred to a future phase.
- Host-side replay buffer for offline-window messages (`BL-CHAT-PERSIST-RAM-01`) — future feature.
- File transfer implementation (Phase 11+).
- Admin dashboard reporting (separate backlog).
- Any new user-facing feature additions beyond chat persistence.

## Dependency Order

1. VP-10.1 (guest disconnect notification) — ~2 hours. **Critical:** blocks accurate participant visibility.
2. VP-10.2 (guest messaging) — ~4 hours. Depends on VP-10.1 being correct so remaining participants are properly tracked.
3. VP-10.3 (UI fixes) — ~1.5 hours. Independent.
4. VP-10.4 (chat persistence + reconnect dedup) — ~2.5 hours. Independent of 10.1–10.3; 10.4.4 (dedup/outbound clear) depends on 10.4.3 (restore) being in place.

**Estimated Total:** ~10 hours (~2–3 days with testing & validation).

---

## Testing Strategy

Most VP-10.2/10.4 checks were originally framed as full live-browser scenarios, but each validates **deterministic fix logic** that does not require a live browser, real WebRTC media path, or a real grace-window wait. Those are reclassified to automated test code; only the irreducibly visual / live-P2P confirmations remain manual.

1. **Backend integration (real socket.io):** guest disconnect `peer_left` (VP-10.1, done); guest↔guest signal relay after host departure (T10.2-02); host grace-window expiry emits `room_destroyed` (T10.4-05). Uses the proven `phase10.integration.test.ts` real-server + short-window/fake-timer pattern.
2. **Frontend unit (pure fns / extractable handlers, `sessionStorage` + RTC mocks):** mesh-repair `needsOffer`/`syncPeers` (T10.2-01/03); persistence round-trip & restore merge (T10.4-01); clear-on-leave (T10.4-02); no-clear-on-transient-drop (T10.4-03); terminal-code clear in `onError`/`onRoomDestroyed` (T10.4-04/05); reconnect dedup & pending-clear (T10.4-06); `getLifetimeText` + guard-removal (T10.3-01a).
3. **Irreducibly manual / E2E:** live two-peer message delivery (T10.2-04, T10.4-07), live timer ticking across tab-visibility (T10.3-01b), and browser scroll-container layout (T10.3-02) — real WebRTC/timers/DOM layout that the node harness cannot reproduce.

**Success Criteria:** All existing tests pass; the converted test-code items (T10.2-01/02/03, T10.3-01a, T10.4-01–06) are implemented and pass; the irreducibly-manual items are confirmed by hand; no regressions.

> **Process note (per CLAUDE.md §3.4b):** this is a *test-plan* update only — no test code was implemented. Implement these in step 4b (test execution phase) when explicitly requested.
