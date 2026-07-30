# Phase 12 Test Results

Date: 2026-07-30

**Overall: Historical Pass (pre-remediation).** The full verification run completed successfully before the CR12-10 and CR12-15 implementation changes.

**Current verification boundary:** no tests were run after those changes, by request. The current frontend lint passes with 0 errors and the same 3 pre-existing warnings; `npm.cmd run build --prefix frontend` passes (TypeScript and Vite). The Phase 12 matrix now marks the affected runtime coverage deferred rather than claiming this historical run validates it.

## Commands and Results

| Area | Command | Fresh result |
|---|---|---|
| Backend unit | `npm.cmd run test:unit --prefix backend` | Pass — 72/72 |
| Backend integration | `npm.cmd run test:integration --prefix backend` | Pass — 133/133 |
| Backend policy | `npm.cmd run test:policy --prefix backend` | Pass — 13/13 |
| Backend socket subset | `npm.cmd run test:socket --prefix backend` | Pass — 80/80 |
| Backend security subset | `npm.cmd run test:security --prefix backend` | Pass — 13/13 |
| Backend typecheck | `npm.cmd run typecheck --prefix backend` | Pass |
| Frontend integration | `npm.cmd run test:integration --prefix frontend` | Pass — 22/22 structural checks |
| Frontend contract subset | `npm.cmd run test:contract --prefix frontend` | Pass — 21/21 structural checks |
| Frontend unit | `npm.cmd run test:unit --prefix frontend` | Pass — 104/104 structural checks and 18/18 Vitest runtime tests |
| Frontend test typecheck | `npm.cmd run test:typecheck --prefix frontend` | Pass |
| Production build | `npm.cmd run build` | Pass — frontend TypeScript build and Vite bundle completed |
| End-to-end | `npm.cmd run test:e2e` | Pass — 25/25 Chromium browser flows |

The backend socket and security commands are focused subsets of the integration and policy suites. They are listed separately because the repository exposes them as required commands; their counts must not be added to the full-suite total.

## Execution Notes

- The initial sandboxed frontend runtime and browser-server starts could not read the Vite configuration. Re-running the same commands with the required local workspace/server permission passed. These were sandbox-access failures before application-test execution, not product test failures.
- Playwright ran with one Chromium worker and passed every smoke, authentication, lifecycle, chat-persistence, peer-to-peer, and UI reliability flow.
- The frontend `test:integration` and `test:contract` scripts inspect source contracts. They are valid supplemental checks, but they are not substitutes for runtime coverage.

## Evidence Boundary

This result report records command execution only. The fresh green run does not resolve the missing-behavioral-coverage finding in [CR12-9](../work/code_review_phase_12.md#cr12-9-fresh-full-suite-pass-does-not-execute-every-phase-12-claim): several matrix claims still require dedicated runtime setup/action/assertion tests.

No lint command was run as part of this verification pass. See the Phase 12 code-review report for the separately recorded lint findings.
