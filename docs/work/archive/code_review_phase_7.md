# Phase 7 Code Review

Date: 2026-06-17 (current state; supersedes the 2026-06-16 first pass)
Reviewer: Claude (claude-opus-4-8)
Scope: phase-7.md spec fidelity for VP-7.1 (Stitch UI redesign + mobile-frame rework), VP-7.2 (Light/Dark/Blue theme system), and VP-7.3 (info-page restructure). Focus on token discipline (D-5), zero-persistence/contract freeze (D-6), per-theme accessibility, the **T7.1-08 a11y code review** (focus-ring `--ring` application + `aria-pressed`/`aria-expanded`/`aria-live` presence in source), behavior preservation (D-2), and build/lint health.

Verification:
- `npm run build` (frontend) — **green** (tsc -b + vite build, 1014 modules, 887 kB / 270 kB gzip).
- `npm run lint` (frontend) — **4 errors + 6 warnings**, all in out-of-scope `useVaporRoom.ts` (see §3.1); no new lint on any phase-7-touched file.
- §1.1 fix re-confirmed **present in code** (`RoomView.tsx:43–69` + `index.css:12` custom variant); hash→tone identity mapping unchanged.
- **T7.1-08 a11y (focus + aria):** the shared `Button`/`Input` primitives, the avatar-stack toggle, the theme switcher, and the kick button all carry the `--ring` focus-visible treatment; `aria-pressed` (theme switcher, lobby toggle), `aria-expanded`+`aria-controls` (avatar stack → `participants-roster`), `aria-live="polite"` (copy feedback, chat status, typing, rate-limit hint) and `role="alert"` (error) are all present. One consistency nit on the lobby toggle / NavBar links — §1.5.
- Grep `theme` over `backend/` — **0 hits** (T7.2-07 ✅).
- Grep `localStorage`/`document.cookie` over `frontend/src` — theme uses `sessionStorage` only; the only `localStorage` is the pre-existing admin auth token, unrelated to theme (T7.2-07 ✅).
- VP-7.3 numbering: privacy `h2` and FAQ `h3` use independent counters scoped to `.vapor-md-content`; privacy has only `h2`, FAQ only `h3`, so there is no cross-numbering.

---

## 1. Findings — Accessibility / Spec Conflicts

### 1.1 [High] Participant tone colors fail WCAG AA on the Dark and Blue (default) themes

**Files:** `frontend/src/features/room/RoomView.tsx:37–43`, used at `:180` (roster chip), `:257` (message sender name).

`PARTICIPANT_TONES` hardcodes Tailwind palette literals tuned for a **light** surface:

```ts
{ chip: '… text-cyan-800', avatar: 'bg-cyan-800 text-white', name: 'text-cyan-800' }
```

- The `avatar` tone (`bg-*-800 text-white`) is fine in every theme — dark chip, white text.
- The `chip` and `name` tones use dark `text-*-800` ink. These render on `bg-card` (roster) and on the `bg-background/45` feed surface (sender meta line). In the **Blue (default)** and **Dark** themes those surfaces are deep/dark, so dark-cyan/indigo/emerald text on a dark field is low-contrast and fails AA.

This directly contradicts **D-6 / 7.2.2** ("foreground+surface overridden together so AA holds per theme") and the **T7.2-06** pass criterion ("body text, muted text, chips, bubbles … remain AA-readable in Light, Dark, and Blue"). It is most visible on the **default** theme, so every fresh visitor sees it.

**Confirmed (2026-06-16):** owner verified against the refreshed `docs/UI_design/current/RoomView_phase7_blue.jpg` and `RoomView_phase7_dark.jpg` — the `text-rose-800` incoming sender name is barely legible on both the deep-blue and slate fields. The fix should also bound the palette so identity colors stay both distinguishable and comfortable to read (not eye-hurting) across all three themes.

**Why it slipped:** these tones are reused verbatim from the pre-redesign light-only palette (7.1.6 says "reuse the existing `getParticipantTone`"), but VP-7.2 then made dark themes the default without re-tuning the per-participant ink.

**Resolution options:**
- Make the tone set theme-aware: either route the chip/name ink through a `--vapor-*` token pair, or use lighter shades (`text-*-300/400`) that pass on the dark fields, with light-theme overrides. Keep the stable hash→tone mapping (identity coloring) intact.
- At minimum, drop the colored `name`/`chip` ink and rely on the (already AA-safe) avatar chips for identity color, using `text-foreground`/`text-muted-foreground` for the names.

> **✅ FIXED (2026-06-16):** Made the tones theme-aware while keeping the stable hash→tone mapping. Added a `theme-light` Tailwind custom variant in `index.css` (`@custom-variant theme-light ([data-theme='light'] &)`). `PARTICIPANT_TONES` now carries a **light-on-dark** ink by default — `text-cyan-300` / chip `text-cyan-200` on a `bg-*-400/15` tint — for the dark and blue (default) fields, and overrides to the original **dark-on-light** `text-*-800` under `theme-light:` for the light theme. The solid avatar chips (`bg-*-800 text-white`) were already AA-safe on every surface and are unchanged. Build green; generated CSS confirmed to emit `[data-theme=light] .theme-light\:text-*-800{…}` (so light-theme overrides win by specificity, dark/blue keep the lighter default). Files: `frontend/src/index.css`, `frontend/src/features/room/RoomView.tsx`. **Screenshot recapture for `docs/UI_design/current/RoomView_phase7_*.jpg` is still pending** (no headless-capture tooling in this environment).

---

### 1.2 [Low] Privacy "last updated" date is hardcoded in component source (out of phase-7 scope)

**File:** `frontend/src/features/info/PrivacyPolicyPage.tsx:14`.

> **Correction (2026-06-16):** my original note assumed the removed `**Effective as of launch · Last updated March 2026**` markdown line left the policy's "an updated date above" sentence dangling. It does not — the date still renders in the UI because it is the `subtitle` prop passed to `MarkdownPage`:
> ```tsx
> subtitle="Effective as of launch · Last updated March 2026"
> ```
> So the rendered "date above" reference (privacy-policy.md:77) is still satisfied. The 7.3 trim correctly removed the *duplicate* date line from the markdown body. **No phase-7 inconsistency.**

The remaining concern is maintainability, not correctness: the date is a literal embedded in the component, so updating it requires a source edit and rebuild. Extracting the date into a single constant (so only the date string is touched on each policy update) is a small improvement but is **out of phase-7 scope** — tracked as **BL-PRIVACY-DATE-EXTRACT-01** in `docs/Backlog.md`.

---

### 1.3 [Low] Stale "atmosphere" copy references the retired concept (cosmetic)

**File:** `frontend/src/App.tsx:73` — `<p className="sr-only">Connection secure visual atmosphere active.</p>`.

This screen-reader-only line references the retired "Atmosphere" concept (dropped in the 2026-06-15 D-1 revision in favour of personal themes). It is harmless and invisible, but it is dead/misleading copy. Trivial cleanup (drop the line or reword to e.g. "Secure connection active"); not on the §1.1 blocker path and does not gate E2E.

---

### 1.4 [Nit] FAQ questions render as `1. Q: …` (cosmetic)

**Files:** `frontend/src/features/info/faq.md` + the `.vapor-md-content` h3 counter.

The CSS auto-number prefix plus the literal `Q:` in each FAQ question read slightly redundant (`1. Q: Why doesn't…`). Numbering itself is correct (point 4). Cosmetic only — eyeball during the T7.3-01 manual numbering check and decide whether to drop the `Q:` prefix from the markdown.

---

### 1.5 [Nit] Lobby mode toggle and NavBar links lack the explicit `--ring` focus treatment (T7.1-08)

**Files:** `frontend/src/features/room/LobbyView.tsx:93–118` (Create/Join segmented toggle), `frontend/src/App.tsx:150–161` (Privacy Policy / FAQ links).

Every other interactive control applies the explicit `--ring` focus-visible box-shadow: `Button` (`focus-visible:ring-[3px] focus-visible:ring-ring/50`, covers CTAs/send/leave/copy), `Input` (`focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]`), the avatar-stack toggle (`focus-visible:ring-[3px] focus-visible:ring-ring/50`), the theme switcher (`focus-visible:ring-2 focus-visible:ring-ring`), and the kick button (`focus-visible:ring-1 focus-visible:ring-destructive`).

The lobby segmented toggle carries only `transition-colors` + active fill, and the NavBar links carry only `focus-visible:text-foreground`. Neither sets `focus-visible:outline-none`, so they still get a **visible** keyboard focus indicator from the global base rule `* { @apply … outline-ring/50 }` (`index.css:289`) — the native UA outline tinted with the ring token. So there is no a11y failure; it is purely a visual-consistency gap (native outline vs. the token box-shadow ring used everywhere else). Optional: add `focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none` to these controls for parity. Does not gate E2E.

---

## 2. Out-of-Phase Changes (informational — not regressions)

> Both items below are now recorded in the **VP-7.1 Implementation Notes** of `phase-7.md` (out-of-scope cleanups landed in passing), per the review-feedback request to document done-but-out-of-scope changes there.

### 2.1 [Info] Lint/type cleanups landed in signaling-adjacent files

`types.ts`, `room-socket-client.ts`, `webrtc-chat-mesh.ts`, and `useSocketConnection.ts` were modified. Reviewed for D-6 contract-freeze compliance: **no theme data, no new socket/data-channel events, no payload shape changes.** The edits are pure lint/type hygiene (drop unused imports, `interface extends` → `type =`, `void` floating promises, `RTCStats` annotation, a typed cast for the runtime-only `pong` manager event). These resolve **BL-FRONTEND-TYPES-01** — `tsc -b` / `npm run build` is now green (verified this pass) — which is moved to Resolved in `docs/Backlog.md`. Signaling contract remains frozen ✅.

### 2.2 [Info] `useSocketConnection.ts` moved ref writes from render to an effect

Handler/dispose ref assignment moved out of render into a deps-less `useEffect`, and the unused `socketRef` return was dropped. This is the correct fix for the `react-hooks/refs` "Cannot update ref during render" rule and is behavior-neutral in practice (socket callbacks fire post-commit). Worth noting only because it is an unmentioned plumbing change inside a UI phase. **Note the inconsistency:** the identical fix was *not* applied to `useVaporRoom.ts`, which is the source of the remaining lint errors (§3.1, tracked as BL-FRONTEND-LINT-REFS-01).

---

## 3. Build / Lint / Verification

### 3.1 [Medium] `npm run lint` does not pass — T7.1-01 pass criterion unmet

T7.1-01 states "`npm run build` **and** `npm run lint` pass in `frontend/`". Build passes, but lint reports **4 errors** (plus 6 warnings), all in `frontend/src/features/room/useVaporRoom.ts`:

```
useVaporRoom.ts:141  error  Cannot update ref during render (stateRef.current = state)
useVaporRoom.ts:143  error  Cannot access/update refs during render (socketStateRef…)
```

These are **pre-existing and out of phase-7 scope** (acknowledged in the matrix's implementation notes), and the count is down from the noted 24 thanks to §2.1's cleanups. So this is **not a phase-7 regression** — but the matrix's own pass criterion as literally written ("lint pass") is not met, and 7.1.9 should be qualified to "clean on all phase-7-touched files" rather than implying a globally green lint.

**Already tracked:** this is **BL-FRONTEND-LINT-REFS-01** in `docs/Backlog.md` (added 2026-06-15 after the Phase-7 lint sweep) — no new backlog item is needed. The fix is the same one already applied in §2.2 (move the four ref writes into an effect), deliberately deferred because `useVaporRoom` is the timing-sensitive socket/WebRTC session hook and the change must be validated against the gated room test suites.

---

## 4. Spec-Fidelity Checks That Passed

- **D-5 token discipline (T7.1-06):** No raw color literals added to `components/ui/*` or feature views *except* two documented exceptions — the `PARTICIPANT_TONES` identity palette (the subject of §1.1) and the `DiagnosticsOverlay` terminal look (`bg-black/85 text-green-400`, intentionally fixed per 7.1.8). The theme-switcher `swatch` literals are by-design (a multi-theme preview can't use the active token). All other color flows through `--vapor-*` → semantic tokens.
- **D-5 foundation (7.1.1/7.2.2):** Every theme-dependent value is a `--vapor-*` property under `[data-theme]`; `blue` backs `:root` as the pre-binding fallback and is declared first so `light`/`dark` override by source order. Field gradient stops are `@property`-registered with a 300ms transition on `:root`; surfaces/text swap instantly (intended). No component remount on swap.
- **D-6 zero-persistence (T7.2-07/08):** `backend/` has zero `theme` references; persistence is `sessionStorage` only (`vapor.theme`); `isValidThemeId` is a strict allowlist guard (rejects casing variants, trailing space, non-strings); storage access is try/catch-guarded; no `theme_change` socket/data-channel event. The no-FOUC inline script in `index.html` duplicates the `light|dark|blue` allowlist with an in-code comment flagging the required sync — acceptable, low maintenance risk.
- **No-FOUC + in-tab persistence:** `useTheme` reads/validates `sessionStorage` on init and binds `data-theme` to `<html>` in `useLayoutEffect` (pre-paint), matching the inline-script value — no flash, survives reload, resets to `blue` on tab close.
- **D-2 behavior preservation:** Lobby form logic (mode toggle field swap, disabled states, rate-limit hint, error alert, maxLength) and room behavior (kick, host badge, copy ID, solo/lifetime chips, typing indicator, Ctrl+Shift+D diagnostics, send disable/maxLength) are restyle-only — handlers and validation unchanged.
- **A11y source-level checks (T7.1-08):** Focus-ring `--ring` token applied on all shared primitives and the avatar-stack/theme-switcher/kick controls (the only gap is a cosmetic consistency nit on the lobby toggle + NavBar links, which still focus-indicate via the global native outline — §1.5). `aria-pressed` present on the theme switcher and the lobby Create/Join toggle; `aria-expanded` + `aria-controls="participants-roster"` on the avatar-stack toggle with a matching `id` on the roster wrapper; `aria-live="polite"` on the copy feedback, chat status, typing indicator, and rate-limit hint regions; `role="alert"` on the lobby error; `aria-label` on every icon-only button (Copy ID, Send, avatar stack, kick, theme swatches); decorative glyphs marked `aria-hidden`; `sr-only` headings/labels preserved. Static per-theme AA contrast is covered by T7.2-06; interactive keyboard/screen-reader sweeps remain a separate specialised QA activity, not gated here.
- **Performance safeguards (T7.1-09):** Input-focus animation-pause guard (`main:has(input:focus…)`) intact (`index.css:380`); `MessageFeed` `scrollIntoView` on `chatMessages.length` intact; `memo` boundaries on `LobbyView`/`RoomView`/`MessageFeed`/`ParticipantsRoster`/`AvatarStack` preserved.
- **VP-7.3:** CSS-counter auto-numbering scoped to `.vapor-md-content` (h2/h3, no hardcoded numbers); the five technical privacy sections and the "See also" footer are removed; dead `assets/content/*.md` deleted with no dangling references (build green).

---

## 5. Disposition Summary

| # | Severity | Finding | Suggested action |
|---|---|---|---|
| 1.1 | **High** | Participant `chip`/`name` tones fail AA on Dark + Blue (default) themes (owner-confirmed via screenshots) | ✅ **Fixed 2026-06-16** — theme-aware tones via `theme-light` custom variant (light-on-dark default, dark-on-light in light theme); screenshot recapture pending |
| 1.2 | Low | Privacy "last updated" date hardcoded in `PrivacyPolicyPage.tsx` subtitle (no phase-7 inconsistency — corrected) | Out of scope → **BL-PRIVACY-DATE-EXTRACT-01** |
| 1.3 | Low | Stale "atmosphere" sr-only copy (`App.tsx:73`) references the retired Atmosphere concept | Cosmetic; trivial cleanup, does not gate E2E |
| 1.4 | Nit | FAQ renders `1. Q: …` (auto-number + literal `Q:`) | Cosmetic; eyeball during T7.3-01 |
| 1.5 | Nit | Lobby toggle + NavBar links lack the explicit `--ring` ring (focus still visible via native outline) — T7.1-08 | Cosmetic consistency; optional `focus-visible:ring-2`, does not gate E2E |
| 3.1 | Medium | `npm run lint` not green (4 errors in out-of-scope `useVaporRoom.ts`); T7.1-01 criterion unmet | Already tracked as **BL-FRONTEND-LINT-REFS-01**; qualify 7.1.9 wording |
| 2.1 | Info | Lint/type cleanups in signaling-adjacent files (resolves **BL-FRONTEND-TYPES-01**) | Recorded in phase-7 impl notes; backlog item → Resolved |
| 2.2 | Info | `useSocketConnection` ref-write moved to effect | Recorded in phase-7 impl notes; mirrors fix deferred for `useVaporRoom` |

No security or zero-persistence issues found. No signaling-contract changes. Build is green; the redesign, theme system, and info-page restructure conform to the phase spec. The one finding that blocked the per-theme accessibility criterion — the participant-tone AA gap (§1.1) — is **fixed** and re-confirmed present in code. The **T7.1-08 a11y code review** (focus-ring `--ring` application + `aria-pressed`/`aria-expanded`/`aria-live` presence) passes at the source level: all controls focus-indicate and the required aria attributes are present; the lone item is a cosmetic focus-ring consistency nit (§1.5). The remaining open items are three cosmetic nits (§1.3, §1.4, §1.5) and out-of-scope backlog items (BL-FRONTEND-LINT-REFS-01, BL-PRIVACY-DATE-EXTRACT-01). None gate manual E2E — **the phase is ready for E2E.** The sole carry-over follow-up is recapturing the `RoomView_phase7_*.jpg` reference screenshots (no headless-capture tooling here).
