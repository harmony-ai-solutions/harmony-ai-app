# Phase 6-4 — App: Seeding Ensure-Flow (token + gap-fill)

**Repo:** harmony-ai-app · **Depends on:** 6-1, 4-12 (meta.min_tier/model_type), 5-1 (models route) · Serial app chain
**Refs:** plan.md §5 (amended), §11 A8–A11 · SYNTHESIS §6 (corrected) · research/soulbitscloud.md §8.3

## Objective

The app-side half of seeding (ruling A9). The ENGINE is the structural
seeder on empty DBs (3-1's reworked `createDefaultData`: account + 7
module configs, `qwen-35-9b` chat default, `silero-vad` VAD, imagination
skipped). This phase owns what the engine can't: **put the signed-in
PASETO into the account on every cloud authentication AND
re-authentication/token renewal**, and gap-fill configs the user deleted.

## Implementation steps

1. New `src/services/providers/seeding.ts` — `ensureSeededDefaults()`:
   - **Token first (never flag-gated):** ensure the soulbitscloud account
     exists and carries the CURRENT PASETO — `{api_key: <PASETO>,
     base_url: CLOUD_HOSTS.inference}` (config/cloud.ts:121-124);
     update-if-exists (subsumes rotation). `updateAllSoulbitsCloudApiKeys`
     (providers.ts:338) stays as the bulk-refresh path; the engine-side
     refresh-token route + cloud-mode refresh remain authoritative for
     their surfaces — all converge on the single account row post-3-2
   - **Gap-fill (flag-gated):** fetch gateway models via
     `listProviderModels`; select per `meta.model_type` + `meta.min_tier`
     (4-12/5-1). Per module type (7; imagination skipped —
     skip-when-no-model) AND per STT slot (transcription, VAD — VAD
     seeds `silero-vad` per A8): if the user has zero configs of that
     type/slot → create `Soulbits Cloud (default)` referencing the
     account. On fresh installs the engine seeder already created them —
     this no-ops by design. Fallback = existing
     `SOULBITS_FALLBACK_MODELS` constants (ids in research §8.3; aligned
     with the engine seeder per A10). Never overwrite existing configs;
     per-slot check (a VAD-only config must not block transcription
     gap-fill and vice versa)
2. **Triggers (A9 — auth AND re-auth):** `auth:changed` listener
   (AuthContext.tsx:113-151 — fires on login AND hourly token renewal)
   + the bootstrap-authenticated path (cold start already signed in — cf.
   startSoulbitsTokenSync, AuthContext.tsx:172-174). Token updates run on
   every trigger; the gap-fill scan is guard-gated
3. Persisted guard: `seeding_done_v1:<accountId>` (AsyncStorage — app
   convention) gates the gap-fill scan only; re-runs when absent or the
   account changed; failures log via `createLogger`, never block sign-in
4. i18n for default config names
5. Tests (mocked repos+models — soulbitsTokenSync.test.ts pattern):
   - fresh install (engine-init'd configs present): token filled,
     configs untouched, gap-fill no-ops
   - deleted-config gap-fill recreates it (transcription and VAD slots
     independently)
   - re-auth/token renewal updates the account key (NOT flag-gated)
   - account-change re-runs; never-overwrite; VAD seeded when missing

## Test gates

- `npx.cmd tsc --noEmit` + `npm.cmd run test` green incl. seeding suite

## Checklist

- [ ] Token ensure on auth + re-auth (ungated) via account update
- [ ] Gap-fill per module type ×7 + per STT slot (VAD = silero-vad)
- [ ] Engine-init no-op path tested; never-overwrite semantics
- [ ] meta.model_type/min_tier selection + SOULBITS_FALLBACK_MODELS fallback
- [ ] Per-account flag key gates gap-fill only
- [ ] Localized names; gates green
