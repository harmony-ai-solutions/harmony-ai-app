# Phase 7-13 — CLOUD_MODE Removal + Harmony→Soulbits Cleanup Pass

> **Repos:** `harmony-link-private` (engine) · `harmony-ai-app` (app) · cloud untouched (zero changes expected)
> **Created:** 2026-10-13, triggered by an owner-run review of the app repo (leftover Harmony references +
> the "superseded" cloud-mode boot flag) + owner goal: "cleaning up and renaming old harmony references to
> soulbits. Also harmony Speech engine should be renamed to Soulvoice engine."
> **Depends on:** 6-1/6-2 (conduct-proxy retirement — why CLOUD_MODE is now an uncompensated auth bypass) ·
> 7-9 (labeling fences this pass partially re-opens by explicit ruling) · 7-12 (routes_notifications_ws.go
> inherited the CLOUD_MODE bypass from the 7-11 log-WS pattern)
> **STATUS: APPROVED 2026-10-13 — dispatching (rulings below).**

## Owner rulings (2026-10-13)

1. **CLOUD_MODE: DELETE entirely** — `config.IsCloudMode()` + all call sites; management API/WS auth and
   device approval become unconditionally enforced. E2E harness repair lands in the same pass (it runs with
   `CLOUD_MODE=true` today → exercises no auth).
2. **App `ENGINE_CLOUD_MODE_ON_DEVICE` flag: INVESTIGATE FIRST** — trace what actually starts the embedded
   engine for signed-in users today; report back; the default-flip/removal decision is a follow-up ruling.
3. **User-visible app brand: "Soulbits"** (single word) — app.json, Android `app_name`, i18n strings,
   iOS display name + camera-permission string.
4. **Engine env namespace: unify to `SE_*`** — `HARMONY_LINK_*` (main binary, viper prefix at
   `constants/constants.go:13` + `cmd/root.go:104,133`) and the dead `HL_*` names fold into the sidecar's
   `SE_*` namespace. Unlaunched → clean break acceptable (owner re-provisions own devices).
5. **HarmonySpeech → Soulvoice: RENAME EVERYTHING** — TS types, display strings ("Soulvoice" /
   "Soulvoice Engine" where engine context needs it), persisted provider identifiers, and **engine-side
   table/column names + constants with a proper engine DB migration**.
6. **Dispatch immediately after rulings** (standing rules; judgment calls reported at the end as in 7-12).

## Stays fenced (explicit non-goals — owner confirmed by non-selection)

- Xcode project/target/scheme name `HarmonyAIChat` (+ `ios/HarmonyAIChat/` dir) — pbxproj surgery from
  Windows, macOS verification later.
- Wire-contract identifiers: `HarmonyLinkEvent`, `Harmony-Session-Id` / `Harmony-Result-Port` headers.
- Go module path `github.com/harmony-ai-solutions/harmony-link-private` (+ repo dir names).
- Legacy dual-read storage keys `harmony.pendingWake` / `harmony.pendingPushToken` (feeds the 7-9
  pending-wake legacy-key upgrade drill).
- Stray root file `harmony 78 DONE_AI_CHAT_FEATURES_ANALYSIS.md` — kept (owner did not select deletion).
- `coverage/`, `.idea/shelf/`, `android/build/`, `.gitnexus/` artifacts — generated, ignored.

## Work split (5 agents + orchestrator)

- **A1 · engine (code-expert):** delete CLOUD_MODE (config helper + ~6 call sites incl.
  `routes_notifications_ws.go:43`, `mobile_auth.go:74-75`, `server.go:83-84`, `routes_logs_ws.go:74`,
  `sync_handshake.go:244/315/348`, `request.go:124-126`, `entity_controller.go:67-69`; update affected
  tests incl. today's 7-12 auth matrices). Unify env namespace → `SE_*` (viper prefix, `cmd/root.go`,
  enginehost env injection, `cmd/run.go`, tests; verify whether `HL_*` names are read at all and what the
  REAL FCM env names are today — the 7-12 doc/self-builder recipe say `SE_FCM_*`, which may only become
  true after this unification). Gates: CGO canonical build/vet/test; grep gates: zero `CLOUD_MODE`,
  zero `HARMONY_LINK` env-prefix refs (fenced Go module path excluded).
- **I · app investigation (explore, read-only):** the ENGINE_CLOUD_MODE_ON_DEVICE question — who starts
  the embedded engine for signed-in users today; whether cloud chat works with the flag off; what flipping
  it on would change. Report only; no edits. Owner decides the flag's fate afterward.
- **B1 · app (code-expert):** brand "Soulbits" (app.json name+displayName w/ gradle/settings.gradle
  coherence check, `strings.xml`, i18n `en/modals|landing|common|chatList`, iOS `CFBundleDisplayName` +
  camera string); E2E harness repair (drop `CLOUD_MODE=true` from `e2e/docker-compose.yml` +
  `.github/workflows/e2e-ios.yml`, fix dead `HL_*` env → verified `SE_*` names, provision real auth —
  loopback token/admin key + device approval per how the harness drives the app; reconcile
  `e2e-android.yml` `harmonyai/harmony-link` Docker-Hub image vs compose's local
  `soulbits/harmony-link`); docs B2 (INSTALLATION.md package ids → `ai.soulbits.chat(.dev)` + env names →
  `SE_*` incl. `docs/SELF-BUILDER-NOTIFICATIONS.md` FCM env names per A1's verified reality;
  TESTING.md + e2e/README.md image story). Gates: tsc, jest, gradle (brand/label changes).
- **C1 · engine (code-expert):** HarmonySpeech→Soulvoice discovery + rename + **DB migration** for any
  table/column names; constants; canonical fixtures. **Checkpoint:** if affected tables/columns
  participate in the changeset/dataset sync schema, assess mixed-version changeset compatibility
  (unlaunched fleet upgrades together; DLQ TTL 7d) and HALT if it needs a schema-version/product decision.
- **C2 · app (code-expert, after B1):** app side of Soulvoice (moduleConfiguration provider key,
  models.ts fields + WatermelonDB migration + tests, TS types, i18n labels, vendored fixtures lockstep,
  drift CLI green, changelog).
- **Orchestrator:** this doc, 7-9 doc premise corrections (line 28 "CLOUD_MODE gone" was false — it goes
  in 7-13, not 6-4; §9 grep gate becomes enforceable after A1), summary.md, final report.

## Binding contracts

- Management contract stays **1.4.0** (fixture VALUE changes for provider keys are set-for-set lockstep,
  not additive-schema — no bump per 7-11 precedent; drift CLI must stay green).
- Sync relay wire contract untouched. Cloud repo: zero changes expected.
- Relay/lifecycle/notify untouched.

## Verification gates

- Engine (canonical env MANDATORY): `go build ./...`, `go vet ./...`, `go test ./...` → 0; grep gates
  above; drift CLI green (run by C2 at the end).
- App: `npx.cmd tsc --noEmit` → 0; `npm.cmd run test` green (baseline 146 suites / 1267 tests);
  `android\gradlew.bat assembleDevDebug` green wherever android files change (B1, C2-if-native-touched).
- E2E CI runs themselves are owner-gated (dispatch-only workflows).

## Owner gates

- Re-provision own devices/desktop env after the `SE_*` unification (HARMONY_LINK_*/HL_* names die).
- E2E workflow dispatches (android + iOS) to validate the auth-enforced harness on CI.
- macOS-side verification later (iOS build, Xcode naming untouched this pass).
- Rule the ENGINE_CLOUD_MODE_ON_DEVICE flag after the investigation report.

## Progress checklist

- [x] A1 engine: CLOUD_MODE deletion + SE_* unification + grep gates (2026-10-13; incl. shared
      `config.ApplyEnvOverrides` mechanism — judgment call: the old `HARMONY_LINK_*` viper prefix was
      empirically inert, so A1 made `SE_*` actually functional on both boot paths)
- [x] I app: cloud-mode flag investigation report (verdict: flag is moot — engine starts unconditionally
      at boot, token injection runs unconditionally via soulbitsTokenSync, orchestration module fully
      subsumed; recommendation: remove flag + delete `cloudModeOrchestration.ts`) → **owner ruling pending**
- [x] B1 app: brand "Soulbits" (incl. RN registration-name lockstep: MainActivity/AppDelegate/settings.gradle)
      + e2e harness repair (SE_* env, SE_WSS_PORT=28443 explicit, admin-key auth + `approve-pending-devices.sh`,
      image/workflow reconciliation, devRelease APK fix) + docs B2 (INSTALLATION ids/env, TESTING image story)
- [x] C1 engine: Soulvoice rename + migration `000050` (`ALTER TABLE provider_config_harmonyspeech RENAME
      TO provider_config_soulvoice`) + both sync-table registries in lockstep + A1 doc residuals
      (sync-schema checkpoint: SyncSchemaVersion advisory-only post-6-4, no bump — mixed-version changesets
      fail-apply accepted per unlaunched clean-break ruling)
- [x] C2 app: Soulvoice rename (types/constants/provider id `soulvoice`/catalog fallback id/HSE placeholder)
      + THEMING.md + package.json/lock name `soulbits` (app has NO migration layer since 3-4 — engine's
      000050 owns the DB rename; correctly not fabricated) + drift CLI green 1.4.0 + grep gates 0
- [x] Orchestrator: 7-9 premise corrections + summary + final report
- [x] F1 app (owner-ruled follow-ups): flag + module removed; E2E-only engine override
      (BuildConfig-gated, embedded-engine sync-client mechanism, no auth shortcut)
- [x] F2 cloud (owner-ruled follow-up): migration `000039` `harmonyspeech`→`soulvoice` + gateway/openapi/
      docs/portal/deploy-script; up-chain smoke-verified on real Postgres

### Open items → owner rulings (2026-10-13) — ALL RULED + IMPLEMENTED (F1/F2)

1. **ENGINE_CLOUD_MODE_ON_DEVICE flag: RULED — remove flag + delete module.** DONE (F1): module + test
   deleted, flag block + tests removed (data-layer flag intact), AuthContext wiring removed
   (`startSoulbitsTokenSync` untouched), stale comments fixed. Net suites 146 (−1 module suite, +1 override
   suite), tests 1264.
2. **E2E pairing depth: RULED — E2E-only override.** DONE (F1): `e2eEngineOverride.ts` + BuildConfig fields
   gated on `-PE2E_DEBUG_SIGNING` only (devDebug builds contain nothing; gating proven via generated
   BuildConfig across all three build shapes). Mechanism: points the app's EMBEDDED engine sync client at
   the container engine (`PUT /api/sync/client`) — deliberately NOT a remote-management override, so the
   real pending-device → approval → JWT handshake is what e2e exercises (no auth shortcut). README
   documents the pairing sequence; maestro flow stays boot-only (E2E APK is currently engine-less — see
   open note below).
3. **Cloud model-catalog id: RULED — rename cloud-side.** DONE (F2): migration `000039` renames
   `model_tier_access` row `harmonyspeech`→`soulvoice` (natural TEXT PK, no FK rows; up-chain 000001→000039
   smoke-verified on real Postgres incl. down/re-up), gateway handlers/tests, openapi, docs (api-usage ×2),
   portal data + i18n (en/de/ar), deploy-script decoupling (`--model soulvoice` ↔ engine group
   `harmonyspeech` via new optional arg), CHANGELOG. Cloud gates green.
4. **Minor acceptances: confirmed** (THEMING line-4 fix kept; charactercard extension-namespace comments
   left; archival `.current_work` mentions left).

### Remaining owner-side notes (no code ruling needed)

- **External `harmony-speech-engine` repo rename** (GitHub + `harmony-speech-engine-client-go` module + HSE
  model-group name): owner-side; when done, flip the deploy script's `--server-model-name` arg and the
  README/adapter/portal external references (2-line class of changes).
- **Worker VMs**: deploy script must be re-run (`--model soulvoice`, groups `soulvoice-tts`/`soulvoice-embed`);
  gateway model-access cache expires old ids in 5 min.
- **E2E sidecar vendoring**: the override is inert until the E2E APK embeds `libengine.so` (gradle
  `-PENGINE_SIDECAR_ARTIFACTS_DIR`/`VERSION+BASE_URL` — owner/CI-published artifact). Optional harness
  enhancement; flow stays boot-only meanwhile.
- Compose endpoint default is `10.0.2.2:28080/28443` (Android emulator bridge);
  `host.docker.internal` documented as the Windows-host fallback.
- `.env.e2e` no-op in CI (`ENVFILE` still set) — harmless; tidy opportunistically.
