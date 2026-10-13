# Contributing to Harmony AI App

## Pull Request Requirements

Before a pull request can be merged into `main`, ALL of the following must pass:

1. **Type-check** — `npx tsc --noEmit` (no TypeScript errors)
2. **Lint** — `npm run lint` (no ESLint errors)
3. **Unit tests** — `npx jest --selectProjects unit` (all passing; includes the
   engine-contract conformance + loopback-smoke gates — see
   [`docs/engine-contract-gates.md`](docs/engine-contract-gates.md))

These checks run automatically as part of the **Tests** workflow (`.github/workflows/test.yml`) on every pull request. They are required status checks in branch protection for `main`.

## Pre-Release Requirements

To create a release (tag push `v*`), ALL of the following must pass:

1. All PR checks (see above)
2. **Engine-contract check** — the app's `ENGINE_CONTRACT_VERSION` matches the
   engine's `docs/api/management/openapi.yaml` (the `contract-drift` CI job, when
   `HARMONY_LINK_REPO_PAT` is configured — see
   [`docs/engine-contract-gates.md`](docs/engine-contract-gates.md))
3. **Nightly E2E** (recommended) — Android + iOS E2E suites should be green

The release pipeline is defined in `.github/workflows/build-release.yml`.

## Local Development

```bash
# Install dependencies
npm install

# Run all tests
npm test

# Run specific test projects
npx jest --selectProjects unit
npx jest --selectProjects integration
npx jest --selectProjects unit --testPathPatterns migrations

# Type-check
npx tsc --noEmit

# Lint
npm run lint
```

## Test Convention

- Unit tests: `src/**/*.test.ts` or `__tests__/**/*.test.ts` (excludes `__tests__/integration/`)
- Integration tests: `__tests__/integration/**/*.test.ts`
- Migration tests: `__tests__/**/migrations*.test.ts` (included in unit project)
- E2E tests: `e2e/.maestro/*.yaml` (Maestro flows, not Jest)

## Questions?

See `.github/workflows/` for CI configuration and `docs/` for architecture documentation.
