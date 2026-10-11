# Phase 5-2 — Docs & Memory Banks

> **Repos:** all three
> **Workspace rules:** memory-bank conventions (`.toon` first, then markdown; docs + changelogs checked in every touched repo)
> **Codebase mapping consulted:** `.planning/codebase/` — all three repos (ARCHITECTURE.md, STRUCTURE.md, CONVENTIONS.md; TESTING.md where present)

## Objective

Bring all documentation in line with the shipped architecture; per workspace rules this is mandatory, not optional.

## Work items

### harmony-ai-app
- `memory-bank/*.toon`: systemPatterns (Sync section rewritten: changeset epochs; new EngineHost/embedding section), techContext (engine artifact dependency, loopback, API data layer), activeContext entry for this plan, progress entries per phase as executed
- `README.md`, `docs/HARMONY-LINK-INTEGRATION.md` (engine-in-app model: local engine primary, desktop pairing engine-side, cloud account), `docs/entity-interaction-model.md` (unchanged concepts; update storage references), `docs/TESTING.md` (new suites), `docs/INSTALLATION.md` (local mode setup)
- `CHANGELOG.md` — major entry (engine embedding, TS stack removal)

### harmony-link-private
- `memory-bank/*.toon`: systemPatterns (lazy temporal model, catch-up seam, changeset sync, embed facade, sidecar build), techContext (session-extension fork flags, gomobile artifacts), progress
- `docs/Entity-Lifecycle.md` (D1/D2), `docs/Changeset-Sync.md` (epochs, policy, wire spec), `docs/Sidecar-Deployment.md`, `docs/Embed-Facade.md` — final polish pass
- `CHANGELOG.md`

### soulbits-cloud-backend
- `memory-bank/*.toon`: systemPatterns (data-blind cloud: keepalive cron + relay, lifecycle-worker removal), progress
- Ops/README (keepalive cron + push relay, lifecycle-worker removal); `CHANGELOG.md`

## Verification gates

- Memory banks updated in all touched repos; changelogs present; no doc still describing the TS replica as current
- This plan's `summary.md` implementation status fully checked off

## Progress checklist

- [ ] App memory bank + docs + changelog
- [ ] Engine memory bank + docs + changelog
- [ ] Cloud memory bank + docs + changelog
- [ ] Plan status finalized
