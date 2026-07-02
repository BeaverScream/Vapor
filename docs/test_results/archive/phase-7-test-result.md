# Phase 7 Test Evidence Matrix

Date: 2026-06-16

---

## Run Summary (2026-06-16)

| Suite | Command | Pass | Fail | Total |
|---|---|---|---|---|
| frontend/tests/theme.unit.test.mjs | `npm run test:unit --prefix frontend` | 8 | 0 | 8 |
| frontend build (tsc -b + vite build) | `npm run build --prefix frontend` | ✓ | — | green |
| frontend lint (eslint) | `npm run lint --prefix frontend` | clean on all phase-7-touched files | — | see §4 |
| **Automated total** | | **8** | **0** | **8** |

Scope note: Per the verification request, this run covers only the **automated test code** for Phase 7. Manual E2E, code-review, and doc-review test rows are explicitly excluded and remain pending (they require a running app / headless-capture tooling not available in this environment).

---

## 1. Test-Code Implementation Audit

Inventory of every Phase 7 test row, classified by suite. The only automated suite in Phase 7 is `frontend/tests/theme.unit.test.mjs` (T7.2-01, T7.2-02) plus the build-verification gate (T7.1-01). All other rows are manual E2E, code review, or doc review.

| VP | Automated test rows | Implemented? | Non-automated rows (excluded from this run) |
|---|---|---|---|
| VP-7.1 | T7.1-01 (build verification) | ✅ via `npm run build` + `npm run lint` | T7.1-02…05, 07, 08, 11, 12 (manual E2E); T7.1-06, 09 (code review); T7.1-10 (doc review) |
| VP-7.2 | T7.2-01, T7.2-02 (`theme.unit.test.mjs`) | ✅ Implemented (8 test cases) | T7.2-03…06 (manual E2E); T7.2-07 (code review); T7.2-08 (doc review) |
| VP-7.3 | — (none) | n/a | T7.3-01, 03 (manual E2E); T7.3-02, 03, 04 (doc/code review) |

**Conclusion:** All automated test code defined for Phase 7 is implemented. No automated test row is missing an implementation.

---

## 2. VP-7.1 UI Redesign — Build Verification

| Test # | Suite | Test Name | Status | Notes |
|---|---|---|---|---|
| T7.1-01 | build verification | `npm run build` and `npm run lint` pass in `frontend/` | ✅ Pass (build) / ⚠️ scoped (lint) | Build (tsc -b + vite) green — 1014 modules transformed, built in 6.41s. Lint clean on all phase-7-touched files; 4 errors + 6 warnings remain only in `useVaporRoom.ts` (deferred backlog BL-FRONTEND-LINT-REFS-01, not a phase-7 file). See §4. |
| T7.1-02…05, 07, 08, 11, 12 | manual E2E | Visual conformance, behavior regression, responsive & a11y sweeps, connection-label de-dup | ⏳ Pending | Excluded from this run (no running app / headless capture). |
| T7.1-06, 09 | code review | Token discipline; performance-safeguard preservation | ⏳ Pending | Excluded from this run. |
| T7.1-10 | doc review | Reference snapshot refresh | ⏳ Pending | Screenshot recapture pending (no headless tooling). |

**Coverage: 1 / 1 automated (build) executed; lint scoped per BL-FRONTEND-LINT-REFS-01. 11 non-automated rows pending.**

---

## 3. VP-7.2 Theme System — Unit Tests

Suite: `frontend/tests/theme.unit.test.mjs` (node `--test`). Validates the pure registry [theme.ts](/frontend/src/lib/theme.ts) and mirrors the persistence read path in [useTheme.ts](/frontend/src/lib/useTheme.ts).

| Test # | Test case (node --test name) | Status |
|---|---|---|
| T7.2-01 | `isValidThemeId` accepts exactly the `THEME_IDS` allowlist | ✅ Pass |
| T7.2-01 | `isValidThemeId` rejects empty string, casing variants (`'LIGHT'`), and retired ids (`'mist'`, `'neon'`) | ✅ Pass |
| T7.2-01 | `isValidThemeId` rejects non-string types (`42`, `null`, `undefined`, `{}`) | ✅ Pass |
| T7.2-01 | `isValidThemeId` rejects trailing-space variants (`'blue '`) | ✅ Pass |
| T7.2-02 | A valid id written to storage reads back equal (all of `light`/`dark`/`blue`) | ✅ Pass |
| T7.2-02 | A malformed stored value (`'mist'`) resolves to `DEFAULT_THEME` | ✅ Pass |
| T7.2-02 | An absent stored value resolves to `DEFAULT_THEME` | ✅ Pass |
| T7.2-02 | A corrupt (non-string `42`) stored value resolves to `DEFAULT_THEME` without throwing | ✅ Pass |

**Coverage: 8 / 8 pass (T7.2-01: 4 cases, T7.2-02: 4 cases).**

| Test # | Suite | Test Name | Status | Notes |
|---|---|---|---|---|
| T7.2-03…06 | manual E2E | Live theme swap, sessionStorage-only persistence, personal-scope, per-theme AA contrast | ⏳ Pending | Excluded from this run. |
| T7.2-07 | code review | Zero shared-data persistence / contract freeze (D-6) | ⏳ Pending | Excluded from this run. |
| T7.2-08 | doc review | System Design themes paragraph; signaling contract unchanged | ⏳ Pending | Excluded from this run. |

---

## 4. Lint Status (T7.1-01 detail)

`npm run lint --prefix frontend` exits 1, with **all** problems confined to a single non-phase-7 file:

```
src/features/room/useVaporRoom.ts
  4 errors  (react-hooks/refs — "Cannot access/update refs during render", lines 134, 137, 141, 143)
  6 warnings (react-hooks/exhaustive-deps, lines 171, 206, 224, 242, 257, 382)
✖ 10 problems (4 errors, 6 warnings)
```

This is the deliberately-deferred backlog item **BL-FRONTEND-LINT-REFS-01** documented in the VP-7.1 Implementation Notes — `useVaporRoom.ts` is the timing-sensitive socket/WebRTC session hook, not a Phase 7-touched file. Per the phase-7.md pass criterion, T7.1-01/7.1.9 is satisfied as **"clean on all phase-7-touched files,"** not globally green lint. No Phase 7 file (`theme.ts`, `useTheme.ts`, `index.css`, UI primitives, LobbyView/RoomView/RoomEndedView/App/MarkdownPage) produced any lint diagnostic.

---

## 5. Phase 7 Coverage Summary

| VP Slice | Automated Tests | Failing | Pending (manual / review) | Gate |
|---|---|---|---|---|
| VP-7.1 UI Redesign | 1 / 1 (build verification) | 0 | 11 (manual E2E / code / doc review) | ✅ Automated clean (lint scoped) |
| VP-7.2 Theme System | 8 / 8 (unit) | 0 | 6 (manual E2E / code / doc review) | ✅ Complete |
| VP-7.3 Info-Page Restructure | 0 / 0 (no automated tests) | 0 | 4 (manual E2E / doc / code review) | n/a — review-only slice |
| **Phase 7 automated total** | **8 / 8 unit + build green** | **0** | — | **✅ Automated gate clean** |

---

## 6. Bugs Found & Fixed

None. All implemented automated tests passed on first run; no fixes required.

---

## 7. Regression Status

Frontend build (`tsc -b && vite build`) is green. The unit suite is net-new for Phase 7 and introduces no regression against prior suites. The only lint failures are the pre-existing, deferred `useVaporRoom.ts` ref-rule issues (BL-FRONTEND-LINT-REFS-01), unchanged by Phase 7.

---

## 8. Blocking Items

No automated tests are failing. The following non-automated items remain before the full Phase 7 gate can close (out of scope for this run):

1. **Manual E2E block** — VP-7.1 visual/behavior/responsive/a11y sweeps (T7.1-02…05, 07, 08, 11, 12) and VP-7.2 live-swap/persistence/personal-scope/contrast sweeps (T7.2-03…06) require a running app.
2. **Reference snapshot recapture** — T7.1-10 LobbyView/RoomView screenshots pending; no headless-browser capture tooling in this environment.
3. **Code/doc review rows** — T7.1-06/09, T7.2-07/08, T7.3-02/03/04 remain to be performed as part of the phase review step.
