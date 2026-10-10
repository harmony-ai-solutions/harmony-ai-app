# Phase 5-3 — Rollout & Version Matrix

> **Repos:** all; process/ops phase
> **Assessment basis:** §12.5 (coupled releases, gates), memory-bank release-order conventions

## Objective

A staged rollout that never strands a user on either side of the protocol transition, with an explicit rollback story.

## Version compatibility matrix (the contract this phase enforces)

| Client | Engine peer | Path | Gate |
|---|---|---|---|
| New app (embedded engine) | New desktop/cloud engine | changeset-v1 | — |
| New app (embedded engine) | OLD desktop engine | rejected cleanly | handshake typed reject + UI "update Harmony Link" (mirror of sticky `serverUpdateRequired`) |
| OLD app (rows-v1 TS sync) | New cloud/desktop engine | legacy rows-v1 | dual-protocol server window (2-3/2-5) |
| OLD app | OLD engine | unchanged | — |

## Rollout stages

1. **Engine release** (desktop + cloud session images + lifecycle-worker bump) — dual protocol live; nothing user-visible changes.
2. **App beta channel** (Android first): Phase 1–2 behaviors flagged off by default; local mode opt-in for internal/testers (1-4 cohort).
3. **Transition release** (3-4): import mode + new paths default for opt-in; soak ≥2 weeks with telemetry thresholds before deletion PR.
4. **Deletion release** (3-4 final): TS stack removed; legacy backup files retained on devices.
5. **iOS release** (4-x): follow Android by ≥1 cycle unless matrix review clears simultaneous shipping.
6. **Cloud-cleanup plan kickoff** (separate, deferred): session-broker/warm-pool/conduct-proxy retirement + thin-lifecycle service — only after deletion-release stability.

## Rollback story

- Engine: revert images (dual protocol keeps old apps alive); changeset data written by new peers remains valid (epoch ledger readable by the reverted version only if no schema migration intervened — constraint: no engine schema changes in the same window as a protocol rollout; enforce in release checklist)
- App: feature flags per phase; import is non-destructive (legacy DB retained); worst case = old architecture reactivated per device
- Cloud: image revert; lifecycle-worker pinned to matching engine version

## Release checklist artifacts (committed)

- `[ ]` per-stage checklists in this file executed
- `[ ]` compatibility matrix tested in staging per release
- `[ ]` telemetry dashboards (import success, protocol split, crash-free) live before each stage

## Progress checklist

- [ ] Stages executed with sign-offs recorded here
- [ ] Matrix verified per release
- [ ] Rollback rehearsed once in staging
- [ ] Cloud-cleanup plan handed off
