## Vapor Test Commands (run from repo root)

### Backend tests

- Socket integration suite:
	- `npm run test:socket --prefix backend`

- Admin suite (Unit + Integration):
	- `node --import tsx --test backend/tests/admin.unit.test.ts; node --import tsx --test backend/tests/admin.integration.test.ts`

- Room lifecycle unit suite:
	- `node --import tsx --test backend/tests/roomLifecycle.unit.test.ts`

- Security/policy suite:
	- `npm run test:security --prefix backend`

- All backend unit tests:
	- `npm run test:unit --prefix backend`

- All backend integration tests:
	- `npm run test:integration --prefix backend`

- All backend policy tests:
	- `npm run test:policy --prefix backend`

### Frontend tests

- Contract integration suite:
	- `npm run test:contract --prefix frontend`

- All frontend integration tests:
	- `npm run test:integration --prefix frontend`

- Run all current frontend tests:
	- `npm run test:contract --prefix frontend; npm run test:integration --prefix frontend`

### Common QA gate commands

- Backend typecheck:
	- `npm run typecheck --prefix backend`

- Frontend build:
	- `npm run build --prefix frontend`

### Full smoke/guardrail run order (Complete)

1. `npm run test:unit --prefix backend`
2. `npm run test:integration --prefix backend`
3. `npm run test:policy --prefix backend`
4. `npm run test:contract --prefix frontend`
5. `npm run typecheck --prefix backend`
6. `npm run build --prefix frontend`

### Windows VS Code terminal note (PowerShell 5.x)

`&&` is not supported in Windows PowerShell 5.x (default in many VS Code setups).

- Run all backend test groups (always continue):
	- `npm run test:unit --prefix backend; npm run test:integration --prefix backend; npm run test:policy --prefix backend`

- Run all backend test groups (stop on first failure):
	- `npm run test:unit --prefix backend; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; npm run test:integration --prefix backend; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; npm run test:policy --prefix backend`

If you switch terminal profile to PowerShell 7 (`pwsh`), `&&` works.

- Run all fronted test groups (stop on first failure):
    - `npm run test:integration --prefix frontend`