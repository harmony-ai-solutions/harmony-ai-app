# Phase 7-9 — Soulbits Engine Labeling Pass (strings, artifacts, RN modules, dead-env cleanup)

> **Repos:** engine (`../harmony-link-private`), app (`../harmony-ai-app`), cloud (`soulbits-cloud-backend`)
> **Origin:** review follow-up 2026-10-12. **Owner ruling: MAXIMAL scope** — user-visible strings, gomobile
> artifact names, RN native-module renames (`HarmonyEngine`/`HarmonyBackup`/`HarmonyNotifications`),
> headless-task key, and the `harmony.pendingWake` UserDefaults key **with migration**. Fences are listed in
> Design §5 and are binding.
> **Sequencing:** independent of 7-6/7-7/7-8 — no contract-version changes anywhere in this pass (the
> `GET /public/appname` *value* change is display-only; shape and version are untouched). Parallelizable.

## Objective

One consistent product label — **Soulbits Engine** — everywhere a user can read it, and removal of the
dead `HARMONY_*`/`HL_*` env-var corpses and dead i18n namespaces that still carry the old brand.
Internal identifiers that are contract surface (plugin Events API, Go module path) are explicitly fenced
and MUST NOT change.

## Verified current state (anchors, 2026-10-12)

### Engine

- [`constants/constants.go:9`](../../../harmony-link-private/constants/constants.go) — `AppName = "Harmony Link"`. Flows into: `cmd/version.go:18-21` (CLI output), `cmd/run.go:47` + `:100` (Wails window title `"Harmony Link v0.3.0"`), `cmd/engine-sidecar/main.go:408` (`--version`), `eventserver/server.go:357` (shutdown log), **`management/server.go:192-194` `GET /public/appname` returns `{"appName": constants.AppName}`** — the one API surface this change touches; the app does not consume it (only hit in the codebase is a stdout-noise test string), the desktop UI displays it. Value change only.
- [`syncclient/client.go:230`](../../../harmony-link-private/syncclient/client.go) — default `DeviceName = "Harmony Engine"` (what the desktop sync device list shows for unconfigured embedded engines).
- [`eventserver/sync_handshake.go:282`](../../../harmony-link-private/eventserver/sync_handshake.go) — SYNC_REJECT message `"An update is required before syncing. Please update Harmony Link to sync with this engine."`; app mirror at `src/i18n/locales/en/desktopSync.json:21` + `:121-122` ("older Harmony Link build").
- [`providers/openrouter.go:63`](../../../harmony-link-private/providers/openrouter.go) — outbound X-Title `"Harmony Link - AI Character Engine"`.
- [`wails.json:3,16`](../../../harmony-link-private/wails.json) — `"name": "Harmony Link v0.3.0"`, `productName: "Harmony Link"`, `outputfilename: "harmony-link-v0.3.0"` (⚠ outputfilename feeds build/release scripts — verify consumers before changing); [`versioninfo.json:31`](../../../harmony-link-private/versioninfo.json) ProductName.
- Docs prose is saturated ("Harmony Link" ≈ everywhere): `README.md:1-6`, `docs/README.md`, `docs/Concepts.md`, `docs/Events-API.md`, `docs/Database-Encryption.md`, `docs/Development-Tools.md`, `docs/processing/*`, `Makefile:1`, `cmd/engine-sidecar/main.go:5`, `embed/facade.go:1-3`, `database/sessionext/sessionext.go:2`.
- Env: `HL_INFERENCE_TOKEN` is gone (deleted with 6-4 cloud-mode removal). **CORRECTION 2026-10-13 (7-13):**
  `CLOUD_MODE` was NOT gone at 7-9 time — `config.IsCloudMode()` lived outside `cmd/` and dodged this doc's
  grep; it kept bypassing management/WS auth + device approval until 7-13-A1 deleted it. Likewise the env
  namespace was NOT uniformly `SE_*` then: the main binary's viper prefix was `HARMONY_LINK` (inert in
  practice — never mapped) and only the sidecar read `SE_*`; 7-13-A1 unified everything onto `SE_*` via
  `config.ApplyEnvOverrides`. The 7-9 §9 grep gate (0 residual `HL_` reads) became fully enforceable after
  7-13-A1 (verified: 0 live `HL_*` reads engine-side; e2e's dead `HL_*` vars fixed in 7-13-B1).
- Facade artifacts: [`build_facade_ios.sh:64-65`](../../../harmony-link-private/build_facade_ios.sh) and [`build_facade_android.sh:66-67`](../../../harmony-link-private/build_facade_android.sh) emit `HarmonyEngine.xcframework` / `HarmonyEngine.aar`; `Makefile:29-30` echo lines; `docs/Embed-Facade.md:164-174`.

### App

- iOS engine module: [`ios/EngineModule/HarmonyEngineModule.m`](../../../harmony-ai-app/ios/EngineModule/HarmonyEngineModule.m) — `:27` `#import <HarmonyEngine/HarmonyEngine.h>`, `:33-35` NSNotification names (`HarmonyEngineWake`, `HarmonyEngineWakeFinished`, `HarmonyPushToken`), `:36` UserDefaults key `harmony.pendingWake`, `:59` `RCT_EXPORT_MODULE(HarmonyEngine)`. JS binding: `src/services/engine/EngineEmbeddedModule.ts` (`NativeModules.HarmonyEngine`, docstring `:2-7`), `src/services/engine/EngineHost.ts:13-14`, test mock `src/services/engine/__tests__/EngineEmbeddedModule.test.ts:7`.
- iOS backup module: `ios/HarmonyBackup/` — `HarmonyBackupModule.m:12` `RCT_EXTERN_MODULE(HarmonyBackup, …)`, `HarmonyBackupModule.swift:47` `@objc(HarmonyBackup)`. Android: `backup/BackupModule.kt:232` `NAME = "HarmonyBackup"`, `BackupPackage.kt:9` (JS `NativeModules.HarmonyBackup`). JS: `src/services/backup/backupNative.ts:21` (Android), `backupNativeIos.ts:25` (iOS).
- Headless task key: `src/services/backup/backupHeadlessTask.ts:17` `BACKUP_HEADLESS_TASK = 'HarmonyBackupTask'` ↔ `backup/BackupHeadlessTaskService.kt:29` `TASK_KEY = "HarmonyBackupTask"` — must match exactly or background backup dies silently.
- Notifications: `ios/Notifications/HarmonyNotificationsModule.m:34` `RCT_EXPORT_MODULE(HarmonyNotifications)` ↔ `src/services/notifications/NotificationPermission.ts:34-35`.
- Wake bridge counterparts in [`ios/HarmonyAIChat/AppDelegate.swift`](../../../harmony-ai-app/ios/HarmonyAIChat/AppDelegate.swift): `:17` BGTask id `com.soulbits.engine.maintenance` (already Soulbits — **must never change**, see §5), `:18-20` notification names + `kPendingWakeKey = "harmony.pendingWake"`.
- i18n (only `en/` exists): **live** namespaces with "Harmony Link" copy — `desktopSync.json:21,121-122`, `auth.json:43-45,54`, `chatList.json:7,10`, `moduleConfig.json:30-31`, `voiceInput.json:13,29-30`, `themeSettings.json:17,36`, `syncConnection.json` (consumed by `SyncConnectionContext.tsx:170,192,325`), `theme.json:21-22`, plus user-visible `CertificateDetailsModal.tsx:112-113` (`Self-Signed (Harmony Link)`). **Dead**: `connection.json` — 0 `.tsx` consumers (verified 2026-10-12); `modals.json:2-7` welcome modal is pre-parity copy needing rewording, not blind replace.
- Env corpses: [`e2e/.env.e2e:29-30`](../../../harmony-ai-app/e2e/.env.e2e), `e2e/.env.e2e.ios:18-19`, [`.env.example:33-34`](../../../harmony-ai-app/.env.example) — `HARMONY_LINK_WSS_URL` / `HARMONY_LINK_WS_URL`, consumed by gradle `-P` → BuildConfig → `ConnectionStateManager.applyE2EOverride()` pre-seeding the **retired** remote-WSS pairing model. Post-parity the app has no remote connect path.

### Cloud

- [`portal/src/components/developers/DevResources.tsx:67`](../../../soulbits-cloud-backend/portal/src/components/developers/DevResources.tsx) + `portal/src/i18n/locales/{en,de,ar}/translation.json` (`sourceUrl`/`docsUrl` ≈ en:959-960) link to `https://github.com/harmony-ai-solutions/harmony-link` — stale public-repo URL (the engine repo is `harmony-link-private`, which is private and must not be linked from a user-facing portal).
- [`infrastructure/tofu/modules/ecs-services/variables.tf:606`](../../../soulbits-cloud-backend/infrastructure/tofu/modules/ecs-services/variables.tf) — `SE_INFERENCE_BASE_URL` description still speaks of injecting into "session engine containers" and cites `harmony-link-private/cmd/cloud_mode.go`, which 6-4 deleted. Stale pre-6-1 description.
- Engine-side prose in this repo already says "Soulbits Engine" (`README.md:172`); 7-7 already owns the `/lifecycle`→`/push` RabbitMQ renames — no overlap.

## Design

### 1. Canonical labels

| Surface | Old | New |
|---|---|---|
| `constants.AppName` (window title, CLI, `/public/appname` value, logs) | `Harmony Link` | `Soulbits Engine` |
| Default sync `DeviceName` (`client.go:230`) | `Harmony Engine` | `Soulbits Engine` |
| SYNC_REJECT message + app `desktopSync` mirrors | "update Harmony Link…" | "update Soulbits Engine…" |
| OpenRouter X-Title | `Harmony Link - AI Character Engine` | `Soulbits Engine - AI Character Engine` |
| `wails.json` productName / `versioninfo.json` | `Harmony Link` | `Soulbits Engine` |
| App i18n engine-product references | "Harmony Link" | "Soulbits Engine" |
| App i18n peer-device references (e.g. `desktopSync` approval copy) | "Harmony Link" where the *desktop peer* is meant | "the desktop app" / "the desktop engine" — context judgment, not blind replace |
| Cert-details issuer (`CertificateDetailsModal`) | `Self-Signed (Harmony Link)` | `Self-Signed (Soulbits Engine)` |

Notes: (a) the `DeviceName` change affects only the **default** for new registrations — already-stored
`sync_devices` rows keep their recorded names; no migration. (b) `modals.json` welcome copy gets a
minimal reword to embedded-engine reality (data on-device; pair with a desktop engine to sync) — do not
invent new flows. (c) **Portal URL decision slot (owner): RULED 2026-10-12 — Soulbits website pages:**
`sourceUrl` → `https://soulbits.app/download`, `docsUrl` → `https://soulbits.app/docs` (all locales; never the private repo).

### 2. Artifact renames (owner-gated rebuilds)

`HarmonyEngine.xcframework` → `SoulbitsEngine.xcframework`; `HarmonyEngine.aar` → `SoulbitsEngine.aar`.
Engine: both `build_facade_*.sh` `-o` targets + echo lines, `Makefile:29-30` (+ `FACADE_*_OUT` defaults if
named), `docs/Embed-Facade.md`. App iOS: `ios/Frameworks/` directory + [`Frameworks/README.md`](../../../harmony-ai-app/ios/Frameworks/README.md),
pbxproj references (`project.pbxproj:18` build file, `:37` fileRef, `:47` Embed/Frameworks entry, `:96`
group child), `#import <SoulbitsEngine/SoulbitsEngine.h>`. The Android `.aar` is the fallback artifact
(sidecar is primary) — rename the script anyway; rebuild only if a consumer exists at execution time.

### 3. RN native-module renames (maximal-scope ruling)

- `HarmonyEngine` → **`SoulbitsEngine`**: `RCT_EXPORT_MODULE(SoulbitsEngine)`; JS binding in
  `EngineEmbeddedModule.ts` + mocks in its test; file renames `HarmonyEngineModule.{h,m}` →
  `SoulbitsEngineModule.{h,m}` (+ pbxproj `:14,31-32,70-71,292`).
- `HarmonyBackup` → **`SoulbitsBackup`**: iOS extern module + Swift `@objc(SoulbitsBackup)`; Android
  `BackupModule.kt` `NAME`; JS `backupNative.ts` / `backupNativeIos.ts`; directory `ios/HarmonyBackup/` →
  `ios/SoulbitsBackup/` (+ pbxproj group `:76-83`).
- `HarmonyNotifications` → **`SoulbitsNotifications`**: both sides.
- Headless task key `HarmonyBackupTask` → **`SoulbitsBackupTask`**: `backupHeadlessTask.ts:17` AND
  `BackupHeadlessTaskService.kt:29` — **one atomic change on both sides**; a mismatch silently kills
  background backup.
- In-process NSNotification names (`HarmonyEngineWake`/`WakeFinished`/`HarmonyPushToken` →
  `SoulbitsEngineWake`/…) — both counterparts (`HarmonyEngineModule.m:33-35` ↔ `AppDelegate.swift:18-19`)
  in the same change; process-local, no persistence.
- **UserDefaults migration** `harmony.pendingWake` → `soulbits.pendingWake`: **dual-read** (read new key;
  on miss read legacy key and use it; always write the new key; remove the legacy key after a successful
  read). Sites: `HarmonyEngineModule.m:36` and `AppDelegate.swift:20` (each keeps its single constant).
  Worst case if skipped: one queued cold-launch wake lost on upgrade — cheap to do right.
- Upgrade-drill requirement (owner device gate): old build queues a wake → install new build → wake is
  consumed via the legacy key.

### 4. Dead env + dead i18n cleanup

- **App**: delete the whole `HARMONY_LINK_WSS_URL`/`HARMONY_LINK_WS_URL` chain — `.env.e2e`, `.env.e2e.ios`,
  `.env.example`, gradle `-P` handling + BuildConfig fields in `android/app/build.gradle`,
  `ConnectionStateManager.applyE2EOverride()` + its tests. Precondition: grep the e2e specs for the
  override path — the remote-WSS client it pre-seeded is deleted (3-4), so it is expected dead; if any
  spec still references it, that spec is stale too and gets pruned in the same commit.
- **Engine**: `HL_*` gone with 6-4; `CLOUD_MODE` actually removed in **7-13-A1** (not 6-4 — see the
  corrected line-28 note); the grep gate asserting 0 residual `HL_`-prefixed env reads is enforced and
  green since 7-13-A1/B1.
- **Cloud**: rewrite the `variables.tf:606` description to post-6-1 reality; if the variable has no
  remaining injection site after 6-1, mark it deprecated in the description (removal is a tofu decision —
  do not silently break plans).
- **Dead i18n**: delete `src/i18n/locales/en/connection.json` + its registration in `locales/index.ts`
  (0 consumers verified). During execution re-run the consumer check for `syncSettings.json` /
  `theme.json` and sweep-or-delete accordingly (their sync strings smell pre-parity).

### 5. Fences — MUST NOT change (binding)

1. **Go module path** `github.com/harmony-ai-solutions/harmony-link-private`, the GitHub repo name, and
   the cloud `replace` directive / AGENTS.md notes — pure churn, no user value.
2. **Events-API plugin contract**: `HarmonyLinkEvent` wire type, `docs/api/asyncapi.yaml` schema names,
   `Harmony-Session-Id` / `Harmony-Result-Port` headers, the `HarmonyLinkEventServer` Go type —
   grandfathered contract names; renaming breaks existing VNGE/ProjectP plugins.
3. **Management openapi `title`** (`docs/api/management/openapi.yaml:3`) — optional cosmetic title change
   allowed WITHOUT a contract-version bump (title is not the version); version stays.
4. **iOS platform identifiers**: BGTask id `com.soulbits.engine.maintenance` (BGTaskSchedulerPermittedIdentifiers
   must never change once shipped), bundle id `ai.soulbits.chat`, iCloud container `iCloud.ai.soulbits.chat`,
   Keychain `EngineDbKey` (rename = data loss).
5. **App brand (separate owner ruling, out of scope here)**: `HarmonyAIChat` target/product name
   (`project.pbxproj:328`), `strings.xml:2` `app_name`, LaunchScreen label, "Harmony AI" welcome title,
   `ChatBubbleService.kt:329` notification title. This pass labels the **engine**, not the app.

## Implementation steps (ordered, atomic commits)

1. **Engine display strings** — `constants.go` AppName, `wails.json`, `versioninfo.json` (verify
   `outputfilename` consumers), `client.go:230` DeviceName, `sync_handshake.go:282` message,
   `openrouter.go:63` X-Title, log/comment strings (`server.go:357`, `engine-sidecar/main.go:5`,
   `embed/facade.go:1-3`, `Makefile:1`). Engine CHANGELOG entry.
2. **Engine docs sweep** — titles/prose across `README.md` + `docs/**` (mechanical replace; keep the
   `harmony-link` module path and fenced contract names intact); optionally the management-openapi title
   (§5.3).
3. **Engine facade artifact rename** — `build_facade_ios.sh` / `build_facade_android.sh` / `Makefile` /
   `docs/Embed-Facade.md`. **OWNER GATE: rebuild XCFramework (macOS+Xcode); rebuild .aar only if consumed.**
4. **iOS engine module** — framework dir + README, `HarmonyEngineModule.{h,m}` → `SoulbitsEngineModule.{h,m}`,
   `RCT_EXPORT_MODULE(SoulbitsEngine)`, import line, pbxproj, NSNotification names (module + AppDelegate
   same commit), UserDefaults dual-read migration.
5. **iOS backup module** — dir rename `ios/HarmonyBackup/` → `ios/SoulbitsBackup/`, `@objc(SoulbitsBackup)`,
   extern module, pbxproj.
6. **Android** — `BackupModule.NAME` + `BackupHeadlessTaskService.TASK_KEY` (+ `BackupPackage.kt` comment);
   nothing else (sidecar naming already neutral).
7. **App JS** — module bindings (`EngineEmbeddedModule.ts`, `backupNative.ts`, `backupNativeIos.ts`,
   `NotificationPermission.ts`), `BACKUP_HEADLESS_TASK`, test mocks, comment references
   (`EngineHost.ts`, `types/engineSidecar.ts`, `EngineSidecarModule.ts:5-6`, `EntitySessionService.ts:1890`,
   `ConnectionStateManager.ts:351`).
8. **App i18n** — label sweep per Design §1 table over live `en/` namespaces; reword `modals.json`
   welcome copy; delete `connection.json` (+ registration); verdict + sweep/delete for
   `syncSettings.json` / `theme.json`; fix `CertificateDetailsModal` issuer strings. App CHANGELOG entry.
9. **App env plumbing deletion** — `.env*` files, gradle `-P`/BuildConfig chain, `applyE2EOverride` +
   tests; prune stale e2e specs found by the precondition grep.
10. **Portal** — `DevResources.tsx` href + `translation.json` `sourceUrl`/`docsUrl` in en/de/ar (after the
    owner URL ruling; §1c). Cloud CHANGELOG if user-visible.
11. **Cloud tofu** — `variables.tf:606` description rewrite; `tofu validate`.
12. **Memory banks + plan docs** — engine/app/cloud memory-bank (`.toon` first) brand references where they
    describe *current* state (historical entries stay as-is); update this checklist.

## Files to create/modify

- **Engine:** `constants/constants.go`, `wails.json`, `versioninfo.json`, `syncclient/client.go`,
  `eventserver/sync_handshake.go`, `providers/openrouter.go`, `cmd/run.go` (title), `cmd/version.go`,
  `cmd/engine-sidecar/main.go`, `eventserver/server.go`, `embed/facade.go`, `database/sessionext/sessionext.go`,
  `Makefile`, `build_facade_ios.sh`, `build_facade_android.sh`, `docs/**` (sweep), `docs/Embed-Facade.md`,
  `CHANGELOG.md`.
- **App:** `ios/Frameworks/` (+README), `ios/EngineModule/SoulbitsEngineModule.{h,m}`,
  `ios/SoulbitsBackup/*` (renamed), `ios/Notifications/HarmonyNotificationsModule.m` (→
  `SoulbitsNotificationsModule.m`), `ios/HarmonyAIChat/AppDelegate.swift`, `ios/HarmonyAIChat.xcodeproj/project.pbxproj`,
  `android/app/build.gradle`, `android/.../backup/{BackupModule,BackupHeadlessTaskService,BackupPackage}.kt`,
  `src/services/engine/{EngineEmbeddedModule.ts,EngineHost.ts,EngineSidecarModule.ts}`,
  `src/services/backup/{backupNative.ts,backupNativeIos.ts,backupHeadlessTask.ts}`,
  `src/services/notifications/NotificationPermission.ts`, `src/services/ConnectionStateManager.ts`,
  `src/services/EntitySessionService.ts`, `src/types/engineSidecar.ts`,
  `src/components/modals/CertificateDetailsModal.tsx`, `src/i18n/locales/en/*` (sweep + `connection.json`
  delete), `.env.example`, `e2e/.env.e2e`, `e2e/.env.e2e.ios`, affected tests, `CHANGELOG.md`.
- **Cloud:** `portal/src/components/developers/DevResources.tsx`, `portal/src/i18n/locales/{en,de,ar}/translation.json`,
  `infrastructure/tofu/modules/ecs-services/variables.tf`, `CHANGELOG.md` (if user-visible).

## Verification gates (owner-run, repo conventions)

- **Engine:** `CGO_CFLAGS='-DSQLITE_ENABLE_SESSION -DSQLITE_ENABLE_PREUPDATE_HOOK'` build/vet/test green;
  `make facade-test` green; grep gate: zero `Harmony Link|Harmony Engine` matches outside the whitelist
  (`CHANGELOG.md`, `docs/history/`, `release_notes/`, fenced identifiers per §5, memory-bank history).
- **App:** `tsc` 0 errors; full jest suite green (module-name mocks updated); `gradle assembleDevDebug`;
  `pod install` + iOS build after the framework rebuild; app e2e suite green after env deletion.
- **Cloud:** `tofu validate`; portal build green.
- **Device drills:** (1) fresh pairing — desktop device list shows "Soulbits Engine" for the phone;
  version-mismatch rejection shows the new copy on both surfaces; (2) Android background backup fires
  after the task-key rename; (3) pending-wake upgrade path consumes the legacy key (§3 drill).

## Owner gates

- macOS + Xcode rebuild of `SoulbitsEngine.xcframework` (commands in `docs/Embed-Facade.md`); Android
  `.aar` rebuild only if consumed.
- Portal URL target ruling (§1c decision slot).
- Acknowledge the app-brand fence (§5.5) as a separate future ruling.

## Progress checklist

- [x] 1. Engine display strings + CHANGELOG
- [x] 2. Engine docs sweep (+ optional openapi title)
- [x] 3. Facade artifact rename (scripts/Makefile/docs)
- [x] 4. iOS engine module rename + UserDefaults dual-read migration
- [x] 5. iOS backup module rename
- [x] 6. Android module/task-key rename (atomic with JS)
- [x] 7. App JS bindings + tests + comments
- [x] 8. App i18n sweep + connection.json deletion + modals reword
- [x] 9. App env plumbing deletion (+ stale e2e prune)
- [x] 10. Portal URL fix (after ruling) + locales
- [x] 11. Cloud tofu description fix + validate
- [x] 12. Memory banks + changelogs + this checklist
- [ ] Owner: XCFramework rebuild · portal URL ruling · device drills (pairing copy / background backup / wake upgrade)
