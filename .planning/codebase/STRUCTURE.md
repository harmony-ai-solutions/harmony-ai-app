# Codebase Structure

**Analysis Date:** 2026-08-07

## Directory Layout

```
harmony-ai-app/                        # React Native app (bare RN 0.86, TypeScript)
├── index.js                           # Native entry — registers App component
├── App.tsx                            # Root component — provider tree + AppShell
├── app.json                           # App name/displayName ("HarmonyAIChat")
├── package.json                       # Deps/scripts (android/ios/start/test/lint/e2e)
├── tsconfig.json                      # TypeScript config
├── babel.config.js / metro.config.js  # Build tooling
├── jest.config.js / jest.setup.js     # Multi-project Jest (unit + integration)
├── .eslintrc.js / .prettierrc.js      # Lint/format
├── react-native.config.js             # RN asset/vector-icons config
├── .env.example                       # Env template (react-native-config)
├── src/                               # ★ All application code (TS/TSX)
│   ├── components/                    #   Reusable UI (feature-sliced)
│   ├── config/                        #   Environment/host resolution
│   ├── constants/                     #   Static metadata (models, modules, providers)
│   ├── contexts/                      #   React Context providers + hooks
│   ├── database/                      #   SQLite layer, migrations, repositories
│   ├── i18n/                          #   Locale namespaces (en/*)
│   ├── navigation/                    #   Root stack + tab navigators
│   ├── screens/                       #   Route components (30)
│   ├── services/                      #   Singleton services (sync, auth, cloud, ws)
│   ├── theme/                         #   Theme types + 9 theme definitions
│   ├── types/                         #   Shared TS types (emoji, config decls)
│   ├── utils/                         #   Logging, colors, uuid, permissions, charactercard
│   └── assets/emoji/                  #   Emoji sprite sheets
├── ios/                               # Native iOS project (Xcode)
│   └── HarmonyAIChat/                 #   AppDelegate.swift, Info.plist, OAuth plists
├── android/                           # Native Android project (Gradle)
│   └── app/src/main/java/ai/soulbits/chat/   # MainActivity.kt, MainApplication.kt
├── __tests__/                         # App-level + integration tests (sync, wss)
│   └── integration/                   #   Sync protocol integration suite + mock server
├── e2e/                               # Maestro E2E flows + Docker harness
│   ├── .maestro/                      #   YAML flows + config
│   └── docker-compose.yml             #   maestro-runner + harmony-link + emulator
├── schema/                            # rn-schema.json dump + compare scripts
├── scripts/                           # dump-schema.ts, oauth-secrets.cjs, IPA packaging
├── docs/                              # Design docs, TESTING.md, architecture diagrams
├── design/                            # Theming/UI design proposals
├── plans/                             # Implementation plan notes
├── reports/                           # CI/test report output
├── memory-bank/                       # Roo memory-bank project context
├── .planning/                         # GSD codebase map (this folder)
└── undefined/.cache/huggingface/      # ⚠ Stray artifact dir — ONNX embedding cache
```

## Directory Purposes

**src/components:**
- Purpose: Reusable, feature-sliced UI components. Subfolders: `themed/` (design-system primitives: `ThemedText.tsx`, `ThemedButton.tsx`, `ThemedCard.tsx`, `ThemedView.tsx`, `ThemedAppbar.tsx`, `ThemedFab.tsx`, `ScreenHeader.tsx`, `SectionHeader.tsx`), `chat/`, `emoji/`, `modals/`, `settings/`, `background/`, `characters/`, `cloud/`, `config/`, `entities/`, `landing/`, `lock/`, `navigation/` (`GlassTabBar.tsx`, `HeaderMenuButton.tsx`), `sync/`, `database/` (`DatabaseLoadingScreen.tsx`), plus `ErrorBoundary.tsx`.
- Key files: `src/components/themed/ThemedButton.tsx`, `src/components/navigation/GlassTabBar.tsx`, `src/components/modals/InitialPairingModal.tsx`, `src/components/background/DynamicBackground.tsx`, `src/components/ErrorBoundary.tsx`.

**src/screens:**
- Purpose: Route-level components. Top-level: `DiscoverScreen.tsx`, `ChatListScreen.tsx` (tab "Chat"), `CharactersScreen.tsx`, `SettingsScreen.tsx`, `ChatDetailScreen.tsx`, `CreateAIScreen.tsx`, `EntityConfigScreen.tsx`, `EntityConfigEditScreen.tsx`, `CharacterProfileEditScreen.tsx`, `AIConfigScreen.tsx`, `LandingScreen.tsx` (legacy).
- Subfolders: `auth/` (`LoginScreen.tsx`, `RegisterScreen.tsx`, `VerifyPrompt.tsx`), `settings/` (13 subpages incl. `SyncSettingsScreen.tsx`, `ThemeSettingsScreen.tsx`, `BiometricLockSettingsScreen.tsx`, `EmojiActionEditorScreen.tsx`, `ComingSoonScreen.tsx`), `setup/` (`ConnectionSetupScreen.tsx`), `config/` (`ModuleConfigEditScreen.tsx`), `development/` (`DatabaseTableViewerScreen.tsx` — DEV-only).

**src/contexts:**
- Purpose: React Context providers exposing typed hooks. 11 providers: `ThemeContext.tsx`, `I18nContext.tsx`, `DatabaseContext.tsx`, `AuthContext.tsx`, `AppAlertContext.tsx`, `SyncConnectionContext.tsx` (833 lines — largest), `EntitySessionContext.tsx`, `EmojiContext.tsx`, `BiometricLockContext.tsx`; helpers `connectionStatusHelper.ts`, `syncEstimateHelper.ts`, `syncSettlementHelper.ts`.
- Key files: `src/contexts/SyncConnectionContext.tsx`, `src/contexts/ThemeContext.tsx`.

**src/services:**
- Purpose: Singleton business-logic services (EventEmitter-based). Root: `SyncService.ts` (1746 lines), `EntitySessionService.ts` (1449 lines), `ConnectionStateManager.ts`, `AudioPlayer.ts`, `AudioRecorder.ts`, `BiometricLockService.ts`, `CharacterCardImportService.ts`, `ChatPreferencesService.ts`, `EmojiService.ts`, `EntityEmojiActionService.ts`, `syncNameClash.ts`.
- Subfolders: `auth/` (`AuthService.ts`, `authFetch.ts`, `googleSignIn.ts`, `appleSignIn.ts`, `tokenStorage.ts`), `cloud/` (`CloudSessionService.ts`, `soulbitsClient.ts`, `soulbitsModelsCatalog.ts`, `soulbitsTokenSync.ts`), `connection/` (`ConnectionManager.ts`, `createWebSocket.ts`), `websocket/` (interface + factory + 4 mode implementations).
- Key files: `src/services/SyncService.ts`, `src/services/connection/ConnectionManager.ts`, `src/services/auth/AuthService.ts`.

**src/database:**
- Purpose: Data layer. Root modules: `connection.ts` (open/close/WAL/secondary sync connection), `migrations.ts`, `models.ts` (TS interfaces mirroring Go structs), `sync.ts` (serialization/chunking), `transaction.ts`, `types.ts`, `reactNativeDatabase.ts`, `index.ts` (barrel).
- Subfolders: `migrations/` (36 files `000001_…` → `000036_backfill_character_profile_source`), `repositories/` (per-table modules + `providers/` with 16 per-provider repos), `__tests__/`, `__test_utils__/` (`testDatabase.ts`, `nodeDatabase.ts`, `dumpSchema.ts`).
- Key files: `src/database/connection.ts`, `src/database/index.ts`, `src/database/migrations.ts`, `src/database/repositories/interactions.ts`.

**src/theme:**
- Purpose: Theme typing + definitions. `types.ts`; `themes/` contains `classicHarmony.ts`, `forestNight.ts`, `hauteGoth.ts`, `midnightRose.ts`, `oceanBreeze.ts`, `pureDark.ts`, `soulBitsLight.ts`, `sunsetGlow.ts`, `index.ts` (registry).

**src/i18n:**
- Purpose: i18next resources. `src/i18n/locales/index.ts`; `src/i18n/locales/en/` holds 24 JSON namespaces (e.g. `common.json`, `chatList.json`, `chatDetail.json`, `settings.json`, `connection.json`, `syncConnection.json`, `entityConfig.json`).

**src/config & src/constants:**
- Purpose: `src/config/cloud.ts` — single source of truth for cloud hosts, OAuth IDs, WS paths, auth endpoints (driven by `react-native-config`). `src/constants/` — `soulbitsModels.ts`, `moduleConfiguration.ts`, `moduleDefaults.ts`, `providerFieldSchemas.ts`, `extendedParamMetadata.ts`.

**src/utils:**
- Purpose: Shared helpers: `logger.ts` (`createLogger`), `colorUtils.ts`, `uuid.ts`, `haptics.ts`, `permissions.ts`, `version.ts`, `configHelpers.ts`, `emojiSprite.ts`, `charactercard/` (SillyTavern PNG/JSON card import: `index.ts`, `pngParser.ts`, `jsonParser.ts`, `mapper.ts`, `types.ts`).

## Key File Locations

**Entry Points:**
- `index.js`: AppRegistry registration + uuid polyfill import.
- `App.tsx`: Provider tree + `AppShell` (DB gate, pairing modal, lock overlay, background layer).
- `src/navigation/AppNavigator.tsx`: Root native-stack (`RootStackParamList`).
- `src/navigation/MainTabNavigator.tsx`: 4-tab layout (`MainTabParamList`); Settings is a root-stack screen accessed via the header hamburger menu (`HeaderMenuButton`).
- Native: `android/app/src/main/java/ai/soulbits/chat/MainApplication.kt` (Android), `ios/HarmonyAIChat/AppDelegate.swift` (iOS).

**Configuration:**
- `src/config/cloud.ts`: Hosts, OAuth IDs, endpoints, env metadata.
- `scripts/oauth-secrets.cjs`: Injects OAuth secrets + `APP_ENV` per build flavor (`npm run oauth:dev` / `oauth:prod`).
- `.env.example`: Env var template (react-native-config). Real `.env*` files are gitignored.
- `jest.config.js`: Unit + integration project split.
- `babel.config.js`, `metro.config.js`, `react-native.config.js`, `tsconfig.json`, `.eslintrc.js`, `.prettierrc.js`.

**Core Logic:**
- `src/services/SyncService.ts`: Sync engine (handshake, buffered atomic apply, name-clash and size-estimate pauses).
- `src/services/connection/ConnectionManager.ts`: WebSocket connection lifecycle + typed events.
- `src/services/websocket/WebSocketConnectionFactory.ts`: Mode→implementation mapping.
- `src/services/EntitySessionService.ts`: Chat session protocol (INIT_ENTITY, per-participant connections).
- `src/services/auth/AuthService.ts`: Cloud PASETO lifecycle + refresh dedup.
- `src/services/cloud/CloudSessionService.ts` + `soulbitsClient.ts`: Cloud session broker integration.
- `src/database/connection.ts`: DB init, WAL, secondary sync connection.
- `src/database/sync.ts`: Sync record serialization + chunked large-field transfer.

**Testing:**
- `jest.config.js`: Two projects — `unit` (`src/**/*.test.{ts,tsx}` + `__tests__/**` excluding `integration/`) and `integration` (`__tests__/integration/**`).
- `__tests__/App.test.tsx`: Root render smoke test.
- `__tests__/integration/`: Sync protocol suite — `sync.abort.test.ts`, `sync.conflict.test.ts`, `sync.concurrent.test.ts`, `sync.network.test.ts`, `sync.failures.test.ts`, `sync.clock.test.ts`, `syncService.integration.test.ts`, `syncNameClash.integration.test.ts`, `wss.smoke.integration.test.ts`; harness in `helpers/` (`HarmonyLinkMockServer.ts`, `runFullSync.ts`, `resetSyncService.ts`, `fixtures.ts`).
- Co-located unit tests: `src/database/__tests__/`, `src/contexts/__tests__/`, `src/services/__tests__/`, `src/services/websocket/__tests__/`, `src/constants/__tests__/`, `src/database/__test_utils__/`.
- E2E: `e2e/.maestro/` (`01-smoke-boot.yaml`, `02-happy-path-pull.yaml`, `03-conflict-resolution.yaml`, `04-network-reconnect.yaml`), run via `docker compose -f e2e/docker-compose.yml`.

## Naming Conventions

**Files:**
- Screens: `PascalCaseScreen.tsx` (e.g. `ChatDetailScreen.tsx`, `SettingsScreen.tsx`); subfolder screens keep suffix (`AccountSettingsScreen.tsx`).
- Components: `PascalCase.tsx` (e.g. `ThemedButton.tsx`, `ChatBubble.tsx`, `GlassTabBar.tsx`); index barrels named `index.ts` (used in `src/components/emoji/index.ts`, `src/components/background/index.ts`, `src/theme/themes/index.ts`).
- Services: `PascalCaseService.ts` for domain services (`SyncService.ts`, `EntitySessionService.ts`, `BiometricLockService.ts`); infrastructure services plain PascalCase (`ConnectionManager.ts`, `AudioPlayer.ts`, `EmojiService.ts`).
- WebSocket variants: `{SecurityMode}WebSocketConnection.ts` (`Unencrypted`, `Secure`, `InsecureSSL`, `Cloud`).
- Migrations: `NNNNNN_snake_case_description.ts` (zero-padded 6-digit version prefix).
- Repositories: `snake_case_table_name.ts` for tables (`conversation_messages.ts`, `emoji_actions.ts`); `PascalCaseProviderConfigRepository.ts` for providers (`OpenAIProviderConfigRepository.ts`).
- Tests: co-located `*.test.ts` / `*.test.tsx` beside source; integration in `__tests__/integration/` as `*.integration.test.ts` or `sync.<topic>.test.ts`.

**Directories:**
- Feature-sliced: `src/components/<feature>/`, `src/screens/<feature>/`, `src/services/<feature>/`.
- Provider configs: `src/database/repositories/providers/`.
- Tests: `__tests__/` (integration), `*.test.ts` co-located.
- Internal doc/plan dirs: `docs/`, `plans/`, `design/`, `.planning/`.

## Where to Add New Code

**New Feature (e.g. a new settings page):**
- Screen: `src/screens/settings/<Feature>SettingsScreen.tsx`; register in `src/navigation/AppNavigator.tsx` (`RootStackParamList` + `<Stack.Screen>`).
- Components: `src/components/settings/` (or a new feature subfolder under `src/components/`).
- Business logic: `src/services/<Feature>Service.ts` (follow the `extends EventEmitter` + `getInstance()` singleton pattern if long-lived).
- State: `src/contexts/<Feature>Context.tsx` if cross-cutting; provider must be wired into the tree in `App.tsx` (mind nesting order).
- Persistence: add SQL to a new migration `src/database/migrations/NNNNNN_<snake_case>.ts`, register in `src/database/migrations.ts`, add repository functions in `src/database/repositories/<table>.ts`, re-export from `src/database/index.ts`.
- i18n: add strings to the matching namespace in `src/i18n/locales/en/` (or a new namespace file + register in `src/i18n/locales/index.ts`).
- Tests: co-located `*.test.ts(x)` for unit; integration under `__tests__/integration/` if it touches the sync protocol.

**New Component/Module:**
- Implementation: `src/components/<feature>/<PascalCase>.tsx`; design-system primitives go in `src/components/themed/`.
- If used across screens, add to a barrel `index.ts` only where a barrel already exists (emoji, background).

**Utilities:**
- Shared helpers: `src/utils/<camelCase>.ts`; log via `createLogger('[Tag]')` from `src/utils/logger.ts`.

**New Provider (LLM/TTS backend):**
- Repo: `src/database/repositories/providers/<PascalCase>ProviderConfigRepository.ts` (mirror an existing provider repo, e.g. `OpenAIProviderConfigRepository.ts`), export from `src/database/index.ts`.
- Schema: `src/database/repositories/providers/shared.ts` for shared helpers.
- Config UI metadata: `src/constants/providerFieldSchemas.ts`, `src/constants/soulbitsModels.ts`.

## Special Directories

**android/ & ios/:**
- Purpose: Native build projects (bare RN; not generated per build — committed).
- Generated: No (checked in).
- Committed: Yes.
- Note: `android/app/src/main/java/ai/soulbits/chat/` holds `MainActivity.kt`/`MainApplication.kt`; iOS holds OAuth plists (`GoogleService-Info.plist`, `GoogleService-Info-Dev.plist`) and `PrivacyInfo.xcprivacy`. `release.keystore` sits at repo root (do not read/commit secrets).

**__tests__/integration/:**
- Purpose: Node-environment sync-protocol integration tests with an in-process `HarmonyLinkMockServer`.
- Generated: No.
- Committed: Yes.

**e2e/:**
- Purpose: Maestro E2E flows + Docker Compose harness (`maestro-runner`, `harmony-link`, `android-emulator`).
- Generated: `app-debug.apk`, `reports/junit-report.xml`, `.maestro;C`/`app-debug.apk;C` stray entries are build artifacts.
- Committed: Partially (flows and compose are committed; artifacts should not be).

**coverage/ & reports/:**
- Purpose: Jest coverage (`coverage/lcov-report/`) and CI/JUnit report output.
- Generated: Yes.
- Committed: No (build output).

**schema/:**
- Purpose: `rn-schema.json` (DB schema dump) + `scripts/compare-schemas.py` parity check against backend schemas.
- Generated: `schema/rn-schema.json` regenerated via `npm run schema:dump`.
- Committed: Yes.

**undefined/:**
- Purpose: None — stray artifact. Contains `.cache/huggingface/Snowflake/snowflake-arctic-embed-xs/` (ONNX tokenizer/model) — an embedding-model download that landed in the wrong working directory during a RAG experiment.
- Generated: Yes.
- Committed: Unknown — should be removed and gitignored.

**memory-bank/, plans/, .current_work/, .planning/:**
- Purpose: Project-context memory (Roo memory-bank), implementation-plan notes, in-progress work scratch, and GSD codebase maps.
- Committed: Yes (memory-bank, plans, .planning are tracked; `.current_work/` is scratch).

**design/:**
- Purpose: Theming/UI design proposal docs (`00 Design Document.md`, `01 Theming Implementation Plan.md`, `02 UI Visual Enhancement Proposal.md`).

---

*Structure analysis: 2026-08-07*
