# Phase 5-3 — Release Sequencing & Rollback

> **Repos:** all; process/ops phase
> **Assessment basis:** §12.5 (coupled releases) — reduced 2026-10-11: the product is unlaunched, so there is no version matrix to enforce and no staged rollout; every build goes to fresh installs on our own devices.

## Objective

Land the three repos in a working order on fresh installs, with a rollback story that is purely git/image-level (no user-data migration ever runs).

## Pairing contract (the only compatibility that matters)

| Relationship | Path | Guard |
|---|---|---|
| New app (embedded engine) ↔ desktop engine | changeset-v1 (2-3) | handshake negotiation; mismatched engine → typed reject + "update Harmony Link" UX (existing sticky pattern) |
| New app ↔ cloud | **no engine peer, no user-data storage** — inference API + account/W1 escrow (2-5) + user-owned-storage backup/restore (2-6); keepalive cron + push relay (4-4) | — |

## Release order

1. **Engine** (desktop builds updated): changeset protocol + lazy/catch-up/batch live; desktop↔embedded pairing available.
2. **Cloud backend** (4-4): keepalive cron + relay + tier extension deployed. The lifecycle-worker deletion lands here only after 4-3 is verified on devices (order 4) — otherwise it follows in the same step as order 4.
3. **App, Android** (1-x + 2-x + 3-x complete): management-API-only data layer, TS stack deleted (3-4), cloud mode = 2-5 path.
4. **App, iOS** (4-x): requires 4-1/4-2 in the build, because 3-4 made the embedded engine mandatory — ship in the same release cycle as Android or after it. Verify 4-3 wakes against the deployed 4-4 cloud pieces; then execute the worker deletion if it hasn't run yet.
5. **Phase 6 — Cloud Cleanup (in this plan, previously deferred):** after orders 1–4 are verified on devices — 6-1 session-infra retirement → 6-2 snapshot plane + DEK retirement + GDPR purge rework (**gated on 2-6 verified**: its replacement backup must be proven first) → 6-3 engine-import zeroing → 6-4 engine dead-code removal. Detailed ordering + the irreversible bucket-purge runbook live in the 6-x files.

## Rollback story

- Every repo: git/image revert — no release is one-way. No data migration, no import, no user fleet mid-transition; the old protocol's deletion is exactly git history.
- Engine constraint: don't land an engine schema migration in the same window as a changeset-protocol rollout (epoch-ledger readability on revert) — enforce in the release checklist.
- Keepalive cron + relay have independent kill switches (correctness never depends on either).
- **Phase 6 exception:** infrastructure deletion is git-revertable per component, but the 6-2 **bucket purge is irreversible** — its runbook (verify zero consumers → purge all versions → destroy) must complete in dev before prod, with completion recorded.

## Release checklist artifacts (committed)

- `[ ]` per-order checklists in this file executed
- `[ ]` device smoke per order (Android fresh install, iOS fresh install, desktop pairing, cloud chat on-device + 2-6 backup/restore round-trip)
- `[ ]` Phase 6 executed per the 6-x files (bucket-purge runbook recorded)

## Progress checklist

- [ ] Release order executed with sign-offs recorded here
- [ ] Rollback rehearsed once in staging (image-revert path)
- [ ] Phase 6 executed (6-1 → 6-2 → 6-3 → 6-4) with gates green
