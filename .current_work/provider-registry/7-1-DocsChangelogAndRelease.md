# Phase 7-1 — Docs, Changelog, and the Single Big Release (dev channel)

**Repo:** both · **Depends on:** ALL previous phases · **Refs:** plan.md §8 Phase 4, §3.3, §11 (channel ruling) · workspace-rules.md (memory bank)

## Objective

Ship the workstream as ONE engine+app release on the **dev channel**
(owner ruling 2026-10-18), with documentation and memory banks updated.

## Implementation steps

1. **Docs (app repo `/docs`):** provider-registry architecture note
   (accounts vs overlays vs catalog; verify state machine; discovery
   recipes — links to plan.md); TESTING.md update (new suites,
   contract-gate 1.6.0 shape); README feature mention (user-level only)
2. **CHANGELOG.md (both repos — both exist):** user-relevant entries only:
   shared provider accounts (enter a key once), API-key testing, live
   model lists, presets, Mistral/Ollama/LocalAI activation, removal of
   Kindroid/Character.AI/Kajiwoto, seeded Soulbits defaults
3. **Memory banks:** app + harmony-link-private banks (`.toon` first,
   then markdown, per memory-bank rules). **Speech-engine bank NOT
   touched** (audit: no phase modifies harmony-speech-engine — only the
   harmony-speech-engine-client-go module bump in 4-11)
4. **Engine release — DISPATCH-ONLY, NEVER A TAG (audit: engine versioning
   is constant-based; a tag push triggers the FULL desktop/prod pipeline):**
   - Bump `constants.AppVersion` (constants/constants.go:10,
   currently "v0.4.2-dev") → next version
   - Full engine gate; push; dispatch build with `android_only=true`,
     `version=<vX.Y.Z-dev>`. android_only intentionally never writes
     engine/latest.json (build.yml:489-492,616-626) — the app provisions
     by explicit version. **No per-channel engine manifest exists**
   - Verify the engine artifact is live BEFORE the app dispatch:
     `curl -I <engine-artifact-url>/<v>/arm64/libengine.so` → 200
     (gradle hard-fails otherwise — DEV-RELEASE.md:119-128)
5. **App release:** update the `ENGINE_SIDECAR_VERSION` repo variable →
   new engine version; full app gates; build-release dispatch with
   `publish_latest` (writes app/dev/latest.json ONLY — build-release.
   yml:341,413-417), the app `version` input, and **`build_ios=false`**
   (android_only leaves the iOS xcframework unpublished — an iOS build
   would fail; build-release.yml:19-22,247); verify APK 200 + manifest
   serves the new version. **Never republish a burned version**
   (versioned paths are edge-cached immutable — cut a new version;
   `manifests_only` exists for manifest-only republish)
6. **Owner rollout:** direct-install the new build once (banner silent
   when installed == manifest), then upgrade remaining devices in quick
   succession (sync-surface mitigation, plan §3.3). Prod channel is NOT
   in scope for this release (owner ruling)
7. Post-ship: mark all phases complete in summary.md; note deviations

## Test gates

- Engine gate + app gates green on the release commits
- Release verification: engine artifact 200 → APK 200 → manifest version;
  post-install emulator smoke (providers screen renders, fresh-sign-in
  seeding produces the 7 configs, module config saves against the new API)

## Checklist

- [ ] Docs + TESTING.md updated
- [ ] CHANGELOGs (user-level, both repos)
- [ ] Memory banks (.toon first; app + harmony-link-private only)
- [ ] Engine: AppVersion bump + android_only dispatch (NO tag); artifact 200 verified
- [ ] ENGINE_SIDECAR_VERSION updated; app dispatched (publish_latest, build_ios=false)
- [ ] APK 200 + manifest verified; never-republish honored
- [ ] Emulator smoke (seeding ×7, providers screen, config save)
- [ ] summary.md finalized; deviations noted
