# Codebase Concerns

**Analysis Date:** 2026-08-07

Branch: `fix/rr-hotfixes-2` (last 20 commits are almost entirely `fix:` commits on sync, sessions, and connection handling — a strong signal these subsystems are the current fragile core).

## Tech Debt

**SyncService monolith (`src/services/SyncService.ts`, 1965 lines):**
- Issue: A single class handles handshake, buffering, atomic apply, name-clash resolution (`src/services/syncNameClash.ts`), size-estimate confirmation, PK-field special-casing (`entity_module_mappings`/`emotion_state` vs `id`), and a pending-confirmation state machine. Multiple singleton-style mutable fields (`pendingSyncConfirmation`, `pendingSizeEstimate`, `pendingHandshake`, `incomingDataBuffer`, `serverRecordIds`, `keepCascadedProviderKeys`).
- Files: `src/services/SyncService.ts`
- Impact: Every hotfix in the last two weeks (race conditions, confirmation timeouts, name-clash cascades) landed here. Each new fix adds another guarded branch, raising the chance of state-machine deadlock.
- Fix approach: Split into `SyncSessionManager` (session lifecycle), `SyncBuffer`/`SyncApplier` (incoming data), and `SyncClashResolver` (name-clash) modules with isolated tests. The integration tests in `__tests__/integration/sync.*.test.ts` already provide a safety net for such a refactor.

**EntitySessionService complexity (`src/services/EntitySessionService.ts`, 1449 lines):**
- Issue: Session tracking across a `Map` of `InteractionSession`, `pendingSessions`, `transcriptionStates`, `reconnectTimers`, plus an `appStateSubscription: any`. Events keyed by `interactionId`; dozens of `any`-typed payloads. Duplicate `session:started` races already required a `started?` guard flag (documented in `memory-bank/activeContext.toon`).
- Files: `src/services/EntitySessionService.ts`
- Impact: Message delivery, transcription timeouts, and reconnect logic are interleaved; a bug in one path stalls chat delivery. Recent commits `7530a6c` ("Session flow, switching & connection handling fixes") target exactly this file.
- Fix approach: Replace `any` payload types with discriminated unions; extract transcription tracking and reconnect scheduling into separate helpers.

**Copy-paste `setRefreshing(false)` timer hack:**
- Issue: The same `setTimeout(() => setRefreshing(false), 800)` pattern is duplicated in 10+ screens — `src/screens/CreateAIScreen.tsx:150`, `src/screens/settings/ThemeSettingsScreen.tsx:66`, `src/screens/auth/LoginScreen.tsx:72`, `src/screens/auth/RegisterScreen.tsx:56`, `src/screens/LandingScreen.tsx:30`, `src/screens/AIConfigScreen.tsx:18`, `src/screens/DiscoverScreen.tsx:30`, `src/screens/settings/ProfileSettingsScreen.tsx:30`, `src/screens/settings/ComingSoonScreen.tsx:35`, `src/screens/settings/BiometricLockSettingsScreen.tsx:52`.
- Impact: Magic 800ms delay baked into pull-to-refresh UX; arbitrary timing that will drift out of sync with actual refresh completion. Uncanceled timers on unmount.
- Fix approach: Extract a `useRefreshControl()` hook that ties `refreshing` to the actual async refresh promise.

**`any` types (293 matches in `src/`):**
- Heaviest offenders: `src/services/EntitySessionService.ts` (~15), `src/services/SyncService.ts` (~10), `src/services/connection/ConnectionManager.ts` (~10), `src/contexts/EntitySessionContext.tsx` (4). Most are event-payload types (`message: any`, `event: any`, `payload: any`).
- Impact: No compile-time check on the wire protocol shapes — exactly the class of bug that produced the sync/connection race hotfixes.
- Fix approach: Define typed payload interfaces for the Harmony Link protocol once (mirroring the Go server's message types) and type the event maps against them.

**Mangled commit history / hygiene:**
- Issue: Commit `8e7e472` is literally titled `git stash popMerge branch 'pr-16-branch' into senju-design-updates`; several messages describe in-progress debugging ("the fingerprint works FINALLYYYYYYY", "it doesnt sign u in"). Stray artifacts in repo root: `harmony 78 DONE_AI_CHAT_FEATURES_ANALYSIS.md` and a gitignored `undefined/` directory (huggingface model cache, `.gitignore` line 87).
- Impact: History is hard to bisect; root directory is polluted.
- Fix approach: Rename the stray markdown file, move `undefined/` cache out of the repo (e.g., to `%LOCALAPPDATA%`), and follow conventional-commit discipline going forward.

**Dead/unused encryption scaffolding (`src/database/connection.ts`):**
- Issue: `generateEncryptionKey()` (line 44) "generates" a 32-byte key using `Math.floor(Math.random() * 256)` — not cryptographically secure — and `getOrCreateEncryptionKey()` (line 65) returns it without ever touching Keychain. Comments admit: "SQLCipher is not linked, so the key is unused for DB encryption."
- Files: `src/database/connection.ts`
- Impact: Misleading security posture. Anyone reading the code believes the DB is encrypted at rest. If SQLCipher is ever linked, this `Math.random()` key would be a critical vulnerability. The DB file `harmony.db` is stored unencrypted in the app documents directory.
- Fix approach: Either remove the dead code and clearly document "DB at rest is NOT encrypted", or link SQLCipher and generate the key via `getRandomValues` from `react-native-get-random-values` (already a dependency) stored in Keychain.

## Known Bugs

**WebSocket native-module defect cascade (`react-native-websocket-self-signed` v0.4.0):**
- Symptoms: Server-initiated `close()` leaves a stale entry in the native active-socket map → next `connect()` fails with "Already Connected"; missing-socket `close()` emits `onError("No active WebSocket for this URL")` which, fed into an error→close→error loop, flooded the app on 2026-08-05 and crashed via JNI global reference table overflow (logcat + docker logs diagnosed).
- Files: `src/services/websocket/InsecureSSLWebSocketConnection.ts` (JS-side mitigation), dependency declared in `package.json` (`react-native-websocket-self-signed: ^0.4.0`)
- Trigger: Any server-initiated close followed by a reconnect; documented in `docs/future-work.md` item 24.
- Workaround: `InsecureSSLWebSocketConnection.ts` removes all listeners before close and guards with a `failureSignalled` single-settle flag. Cost: one failed-then-retried connect after every server close; iOS side of the library never audited. `node_modules` edits are forbidden in this repo (no patch-package), so the fix must land upstream.
- Fix approach: Upstream patch (silent close on missing socket, map removal in `onClosing`/`onClosed`, in-flight connect guard) + dependency bump.

**Duplicate `session:started` emission race:**
- Symptoms: Both participants' `INIT_ENTITY SUCCESS` responses race through the own-entity's `await createInteraction(...)` window and double-emit `session:started` (double-triggering on-start sync).
- Files: `src/services/EntitySessionService.ts` (guard flag `started?` on `InteractionSession`, line 45)
- Workaround: A boolean guard flag suppresses the second emission — but the race window still exists and the guard is a manual band-aid.
- Fix approach: Serialize the all-active check through the promise returned by `createInteraction` rather than relying on a flag.

**AppAlert popup race:**
- Symptoms: Popup vanishes on fast dismiss/replace (`AppAlertContext.handleDismiss` race), documented in `memory-bank/activeContext.toon` (2026-08-04).
- Files: `src/contexts/AppAlertContext.tsx`
- Fix approach: Queue alerts with a monotonically increasing ID and ignore stale dismiss/replace calls.

**SQLite drop-column dead code (migrations 7 & 21):**
- Symptoms: The deprecated `chat_messages.audio_file` and provider `chat_template_kwargs` columns were never actually dropped — the `DROP COLUMN` statements are commented out with `FIXME` notes because SQLite versions on older Android devices don't support the syntax.
- Files: `src/database/migrations/000007_add_chat_images.ts:10`, `src/database/migrations/000021_add_sampling_preset_and_extra_params.ts:23`
- Impact: Dead columns accumulate in the schema, and the RN/Go schema parity gate now has to ignore them (they exist in RN dumps but not Go). The guard `assertMigrationSqlSupported` in `src/database/migrations.ts` enforces the `_new`-table rebuild pattern for future drops.
- Fix approach: Write a follow-up migration using the `_new`-table rebuild pattern to physically remove the columns, and mirror it in the Go repo.

## Security Considerations

**Database-at-rest encryption is not implemented (claimed in code):**
- Risk: User chat history, provider API keys (`api_key` columns in `provider_config_*` tables), and entity data sit in a plaintext SQLite file in the app documents directory. Any app with backup enabled (Android Auto Backup / iOS iCloud) could exfiltrate them.
- Files: `src/database/connection.ts` (openDatabase at line 72, `DATABASE_NAME = 'harmony.db'`)
- Current mitigation: None. The "encryption key" is a `Math.random()` string that is never used.
- Recommendations: Either wire SQLCipher (note `docs/future-work.md` item 3 — no smoke test exists) or explicitly document plaintext-at-rest in `docs/CONNECTION-SECURITY.md` and disable device backups for the DB file.

**Database deletion on open failure — silent data wipe:**
- Risk: If `SQLite.openDatabase` throws for any reason (corruption, disk error, version incompatibility), `openDatabase()` deletes `harmony.db` and recreates an empty one. All local chat history is lost without confirmation, and the full-sync repair path (`src/services/SyncService.ts`, commit `998ea94`) only recovers if the server still has the data.
- Files: `src/database/connection.ts:95-106`
- Current mitigation: A log line. No backup copy, no user prompt.
- Recommendations: Before deleting, copy the file to `harmony.db.corrupt-<timestamp>` for forensic recovery, and gate deletion behind a user-facing "restore from server" flow.

**JWT stored in plaintext AsyncStorage:**
- Risk: `harmony_jwt` (and `harmony_server_cert`) stored via `AsyncStorage.setItem` in `src/services/ConnectionStateManager.ts` (STORAGE_KEYS, line 40-51). AsyncStorage is unencrypted on both platforms.
- Files: `src/services/ConnectionStateManager.ts`, `src/services/websocket/InsecureSSLWebSocketConnection.ts:17`
- Current mitigation: PASETO tokens have short TTLs and the server can cut them off via Valkey; proactive refresh on `expires_at`.
- Recommendations: Consider moving tokens to `react-native-keychain` (already a dependency) if the threat model includes rooted devices.

**Self-signed / unencrypted connection modes are first-class:**
- Risk: `SECURITY_MODES.INSECURE_SSL` and `SECURITY_MODES.UNENCRYPTED` (`src/services/ConnectionStateManager.ts:56-60`) intentionally accept self-signed certs and plaintext `ws://`. This is a deliberate feature for self-hosted LAN servers, but there is no user-facing warning about MITM exposure.
- Files: `src/services/websocket/InsecureSSLWebSocketConnection.ts`, `src/services/websocket/UnencryptedWebSocketConnection.ts`
- Recommendations: Add a persistent "not encrypted" warning banner in the connection settings screen when these modes are active.

**`release.keystore` file present in repo root:**
- Risk: The signing keystore physically sits in the working directory (gitignored via `*.keystore`, so not committed — verified `git ls-files release.keystore` returns empty). `memory-bank/activeContext.toon` notes "no release keystore exists locally — generate one", yet the file exists on disk.
- Files: `release.keystore` (untracked)
- Recommendations: Move to a secure location outside the repo (`~/.android/` or a password manager), and verify it is empty/no-longer-used or properly password-protected.

## Performance Bottlenecks

**Chat history loading without pagination:**
- Problem: `ChatDetailScreen` loads a fixed window (`MESSAGES_PAGE_SIZE = 200`, `src/screens/ChatDetailScreen.tsx:76`) with no scrollback pagination. A documented TODO (line 69) explains the intended `getConversationMessagesByParticipantKey` with `beforeTimestamp` cursor. Refreshes replace the entire list instead of smart-merging, so already-loaded older history is dropped on every new message.
- Files: `src/screens/ChatDetailScreen.tsx`
- Cause: Scrollback pagination was deferred; the TODO is explicit.
- Improvement path: Implement cursor-based pagination and merge-only refresh. Also unblocked by the WAL-mode secondary connection (`syncDb` in `src/database/connection.ts`) which already keeps message queries non-blocking during sync.

**Sync payload size measurement allocates a full copy:**
- Problem: `sendSyncDataWithConfirmation` in `src/services/SyncService.ts:1244-1247` does `new Blob([payloadJSON]).size` on every SYNC_DATA event to log MB. For large records this doubles peak memory transiently.
- Files: `src/services/SyncService.ts`
- Improvement path: Use `payloadJSON.length * 2` (UTF-16 estimate) or `Buffer.byteLength` in the Jest/Node test environment instead of allocating a Blob.

**Heartbeat/interval proliferation:**
- Problem: Heartbeat `setInterval`/`setTimeout` in `BaseWebSocketConnection.ts:30,62`; audio progress `setInterval` in `src/components/chat/ChatBubble.tsx:124`; cloud provisioning ticker in `src/components/cloud/CloudProvisioningCard.tsx:85`. None have `.unref()` (React Native ignores `unref`, so this is primarily a Jest-process concern).
- Files: `src/services/websocket/BaseWebSocketConnection.ts`, `src/components/chat/ChatBubble.tsx`, `src/components/cloud/CloudProvisioningCard.tsx`
- Note: The known `setTimeout` without `.unref()` in `SyncService.sendSyncDataWithConfirmation` (line 1255) still produces the "worker process has failed to exit gracefully" Jest warning on every run (future-work item 17).

## Fragile Areas

**Sync + connection + encryption path (hotfix hotspot):**
- Files: `src/services/SyncService.ts`, `src/services/ConnectionStateManager.ts`, `src/contexts/SyncConnectionContext.tsx`, `src/services/connection/ConnectionManager.ts`, `src/database/connection.ts`
- Why fragile: The last 10 commits are: encryption race fix (`fe1a30d`), full-sync trigger on wiped DB (`998ea94`), entity sync (`f0d9208`), name-clash resolution (`0e4d087`), session flow fixes (`7530a6c`). Each fix changed the same shared state. The WSS protocol is bidirectional and stateful — a change on one side (e.g., new handshake estimate messages) requires coordinated changes in the Go server.
- Safe modification: Keep every new behavior behind the existing `syncPhase` state machine and add integration tests in `__tests__/integration/sync.*.test.ts` before changing behavior. Use `HarmonyLinkMockServer` (`__tests__/integration/helpers/HarmonyLinkMockServer.ts`) for message-level testing.
- Test coverage: Good — 8 integration suites exist, but they run against a mock server, not the real Go engine.

**Migration 000031 — UUID primary-key rebuild (1156 lines):**
- Files: `src/database/migrations/000031_config_uuid_primary_keys.ts`
- Why fragile: Rebuilds 15 provider-config tables + FK chain using `_new`-table copy with `_idmap_*` mapping tables. Generates UUIDs in SQL via `lower(hex(randomblob(4)) ... random() % 4 ...)` — the `random()` in the variant nibble is not fully UUID-spec compliant and collision-safe only by 122-bit entropy. Any existing install running this migration mid-flight (crash between `DROP TABLE` and `RENAME`) is left with a half-migrated DB; migrations are forward-only with no rollback (`src/database/migrations.ts` header).
- Safe modification: Never edit applied migrations — a new migration must repair. If a user reports a broken install, the delete-and-retry path in `src/database/connection.ts:95` will wipe their data.
- Test coverage: Covered by `migrations.rollforward.test.ts` and `migrations.snapshot.test.ts` snapshots, but not on-device with SQLCipher.

**Name-clash resolution logic (new, complex, DEVICE-VERIFIED bugs):**
- Files: `src/services/syncNameClash.ts`, name-clash handling inside `src/services/SyncService.ts`
- Why fragile: Three sequential device-verified bugs in one day (2026-08-04, `memory-bank/activeContext.toon`): keep-resolution never re-sent the adopted record, keep didn't cascade to local provider configs, and `stt_configs` lacks a `provider_config_id` column. Uses `CONFIG_ID_REFERENCES`/`PROVIDER_CONFIG_REFERENCES` hardcoded tables.
- Safe modification: Every table whose rows are name-unique must be added to both the clash registry and the `isNameUniqueTable` helper — a missing entry silently corrupts data on "keep" resolution.
- Test coverage: `__tests__/integration/syncNameClash.integration.test.ts` exists; ensure it covers every provider config table.

**Biometric lock + image picker interaction:**
- Files: `src/contexts/BiometricLockContext.tsx`, `src/services/BiometricLockService.ts`, `src/components/lock/LockScreen.tsx`
- Why fragile: Commit history shows ~5 sequential attempts to make fingerprint unlock work ("the fingerprint works FINALLYYYYYYY", "the fingerprint doesnt work again", `bdc1073` "do not trigger biometric / pin lock when using an image picker"). The lock triggers on backgrounding and interacts badly with the system image picker overlay. Two timer refs (`inactiveTimerRef`, `flowConfirmTimerRef`) plus a 4–6 digit PIN fallback.
- Safe modification: Any change to app-state detection must account for the image-picker/photo-flow AppState transitions; test on-device (unit tests can't cover native biometric prompts).

## Scaling Limits

**Chat history window:**
- Current capacity: 200 messages rendered per conversation (`src/screens/ChatDetailScreen.tsx:76`).
- Limit: Conversations longer than 200 messages silently drop older history from the UI on refresh.
- Scaling path: Cursor-based scrollback pagination (see Performance section).

**Sync batch/estimate:**
- Current: Client sends per-record `SYNC_DATA` confirmations with a 30s timeout (`_syncTimeoutMs` default in `src/services/SyncService.ts:94`), and the engine can block on `SYNC_DATA_SIZE_ESTIMATE` until the user confirms (engine 60s abort). No chunking/backpressure beyond the size-estimate gate (`sync_estimate_limit_mb` in `ConnectionStateManager.STORAGE_KEYS`).
- Limit: A large DB (thousands of rows) with per-row round-trips will exceed the engine's 60s estimate timeout or hit the 30s per-confirmation timeout.
- Scaling path: Batch multiple rows per SYNC_DATA event and apply confirmation at batch level.

**Schema parity maintenance (two-repo migrations):**
- Current: RN migrations in `src/database/migrations/` must mirror `harmony-link-private/database/migrations/` 1:1; a CI gate (`docs/schema-parity.md`, `.github/workflows/schema-parity.yml`) diffs dumps.
- Limit: 9 known divergences already exist (2 CRITICAL — missing FKs on `conversation_messages` and `interactions` in the RN schema; future-work item 16). Every new migration doubles the manual mirroring burden.
- Scaling path: Adopt the proposed vendored canonical schema or Atlas HCL (future-work item 1).

## Dependencies at Risk

**`react-native-websocket-self-signed@^0.4.0` (`package.json:65`):**
- Risk: Known native defects (see Known Bugs) with no in-repo patching allowed. The JS guards add ~100 lines of workaround code.
- Impact: One failed-then-retried connect after every server close; iOS side unaudited; risk of the JNI-overflow crash returning if guards regress.
- Migration plan: Upstream the 3 fixes and bump; or replace with a maintained fork / `react-native-tcp-socket`-based TLS option for self-signed certs.

**`react-native-track-player@^5.0.0-alpha0` (`package.json:63`):**
- Risk: Alpha-versioned dependency for audio playback.
- Impact: Audio message playback stability; undocumented breaking changes between alpha releases.
- Migration plan: Pin exact version (no caret drift) and verify against the audio message flow before each release.

**`better-sqlite3@^12.11.1` (devDependency):**
- Risk: Native module — causes intermittent install pain on Windows/CI and the known test flakiness ("Received function did not execute" on Node 25, `memory-bank/activeContext.toon` 2026-07-24). Only used for tests; the app uses `react-native-sqlite-storage`.
- Impact: Flaky unit suite erodes trust in the gate.
- Migration plan: `node:sqlite` when it hits Stability 2/3 in an LTS (future-work item 14), or pin the working version and document the Node-version constraint.

**`react-test-renderer@^19.2.7` (devDependency):**
- Risk: Officially deprecated in React 19; `__tests__/App.test.tsx` still uses it.
- Impact: Forced migration before the next RN major bump (future-work item 4).
- Migration plan: Migrate `App.test.tsx` to `@testing-library/react-native` (already installed).

## Missing Critical Features

**Scrollback pagination (documented TODO):**
- Problem: `src/screens/ChatDetailScreen.tsx:69-76` — long conversations can't be browsed; history beyond 200 messages is unreachable in the UI.
- Blocks: Full chat-history UX; performance of long threads.

**Database-at-rest encryption:**
- Problem: Claimed by code comments, not implemented (see Security). `docs/future-work.md` item 3 (SQLCipher smoke test) is unimplemented.
- Blocks: Enterprise/privacy positioning; secure handling of stored provider API keys.

**Local schema-parity CLI:**
- Problem: The parity check only runs in CI (`.github/workflows/schema-parity.yml`); no `npm run schema:parity` for local dev (future-work item 12).
- Blocks: Fast feedback on schema drift; contributors only discover divergences after push.

## Test Coverage Gaps

**Zero-coverage repositories:**
- What's not tested: `src/database/repositories/conversation_messages.ts` (core chat data), `src/database/repositories/interactions.ts` (drives chat list), `src/database/repositories/emoji_actions.ts`, `src/database/repositories/sync.ts` (SyncDevice pairing). `emotion_state.ts` gained tests in commit `e3da8eb`, and `entities.ts`/`modules.ts`/`providers.ts`/`characters.ts`/`memories.ts` are covered.
- Files: `src/database/repositories/` (missing tests), pattern established by `src/database/__tests__/repositories/entities.test.ts` using `useFreshDatabase()`.
- Risk: Sync/chat regressions go unnoticed — exactly where the last two weeks of hotfixes landed.
- Priority: High (future-work item 18).

**E2E never fully executed:**
- What's not tested: The full Docker compose E2E stack (harmony-link + Android emulator + Maestro) has never had a successful end-to-end run (future-work item 20). iOS E2E workflow exists but is untriggered (item 21). Only 22 tests/7 suites in E2E, `docs/TESTING.md` shows ~3% E2E share; `e2e/.env.e2e` and `e2e/.env.e2e.ios` are tracked.
- Files: `e2e/docker-compose.yml`, `e2e/.maestro/*.yaml`, `.github/workflows/e2e-ios.yml`
- Risk: The app's core value (real-time chat + sync) has no automated on-device verification.
- Priority: High.

**Component/UI coverage:**
- What's not tested: All screens except `App.tsx` (`__tests__/App.test.tsx`). `ChatDetailScreen`, `SettingsScreen`, `ConnectionSetupScreen`, etc. have zero component tests (future-work item 7).
- Files: `src/screens/`, `src/components/`
- Risk: UI regressions (wrong labels, broken navigation) reach users.
- Priority: Medium.

**Encryption smoke test missing:**
- What's not tested: Whether the production SQLCipher-encrypted DB (when/if enabled) opens, persists, and is actually encrypted on disk (future-work item 3).
- Risk: A release could ship "encryption" that doesn't encrypt, or a DB that fails to open in production.
- Priority: Medium (blocks the encryption feature).

**Coverage gating absent:**
- What's not tested: No CI-enforced coverage threshold. Line coverage measured from `coverage/lcov.info` is ~14% overall (1,215/8,601 lines) — but this artifact covers only the tested subset and is not representative of the app. `docs/TESTING.md` records 154 tests across 18 suites (153 passing, 1 skipped).
- Risk: Coverage erosion as new features land without tests.
- Priority: Low (future-work item 10 — needs 3 months of baseline first).

---

*Concerns audit: 2026-08-07*
