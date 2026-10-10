# Phase 1-4 — Pilot Verification: Old-Protocol Bridge (device)

> **Repo:** `harmony-ai-app` + `harmony-link-private`
> **Assessment basis:** §12.8 step 1–4 (the bridge: old sync protocol moves all app data into the engine DB)

## Objective

Device-verified proof that the existing app, pointed at the local sidecar, performs a complete full sync — populating the engine's SQLite with the user's entire dataset via the existing 35-table protocol. This simultaneously validates embedding end-to-end AND executes the data migration the later deletion phases depend on.

## Verification checklist (owner-run, on-device)

1. **Cold start:** fresh app install, local mode selected → sidecar starts, engine DB created, migrations run (engine log shows current schema version), default `user` entity seeded.
2. **Full sync up:** existing-account dataset (populate app DB first via cloud/self-hosted sync or fixture import) → force full sync → engine DB contains all 35 tables' rows; spot-check: entities, character_profiles + images, interactions, conversation_messages (audio/image blobs round-trip), memories, emotion_state, provider/module configs.
3. **Chat round-trip:** open a conversation through local mode → messages flow (entity session via loopback WS) → LLM inference works with user's provider configs (or Soulbits defaults via cloud PASETO injection — token injection path `soulbitsTokenSync` must be re-targeted at local source).
4. **Full sync down / wipe-rebuild:** wipe engine data dir → app re-pushes (watermark semantics) — validates the reverse path.
5. **Restart resilience:** kill app + sidecar → relaunch → engine restarts, watermark-aware incremental sync, no duplicates (PK upserts).
6. **Estimate gate:** first-sync size-estimate prompt appears (existing UX) — confirm engine-side estimate event fires over loopback.
7. **Battery/thermal sanity:** 30-min chat session — sidecar CPU idle between messages; record numbers.

## Known divergences to watch (from app memory bank)

- `D67` memory-consolidation hard-delete exception behavior (engine-side) — unchanged, just confirm no orphan errors on loopback
- Name-clash resolution paths (`syncNameClash`) — unchanged; confirm dialog flows still work against local engine

## Exit criteria

- All checklist items green on a physical device (primary test device `d608825c` or successor)
- Engine-side logs clean (no FK errors, no sync rejects)
- Decision checkpoint documented in this file: **GO for Phase 2** (or blocking findings list)

## Rollback

- Pilot is feature-flagged; disabling local mode reverts to cloud/self-hosted with zero residue (sidecar data dir disposable)

## Progress checklist

- [ ] Cold start verified
- [ ] Full sync up verified (35 tables, blobs)
- [ ] Chat round-trip + inference verified
- [ ] Wipe-rebuild reverse path verified
- [ ] Restart resilience verified
- [ ] Estimate gate verified
- [ ] Battery/thermal numbers recorded
- [ ] GO/NO-GO checkpoint recorded
