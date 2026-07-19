# Codebase Concerns

**Analysis Date:** 2026-05-24

## Tech Debt

**Hardcoded Fallback Entity:**
- Issue: Default impersonated entity is hardcoded to "user" with no proper handling
- Files: `src/screens/ChatListScreen.tsx` (lines 88, 338-341)
- Impact: Chat functionality may fail or behave unexpectedly when preferred entity is not set
- Fix approach: Implement proper entity selection UI or default to first available entity; partially mitigated by fallback logic at line 335-341 that checks stored preference first

**Theme Sync Not Implemented:**
- Issue: Harmony Link theme synchronization is marked as TODO
- Files: `src/contexts/ThemeContext.tsx` (line 297)
- Impact: Themes cannot be synced across devices via Harmony Link
- Fix approach: Implement Harmony Link API client for theme sync when backend is ready

**Large Monolithic Repository Files (RESOLVED):**
- Issue: Provider repository was 2279 lines (+243 since March), modules repository is 1324 lines (+50 since March) - both contained duplicated patterns
- Fix approach: Provider repo was split per-file in Phase 7-0a into per-provider files in `src/database/repositories/providers/` (e.g., `OpenAIProviderConfigRepository.ts`, `SoulbitsCloudProviderConfigRepository.ts`). Monolithic `providers.ts` deleted. Modules repo (`modules.ts`) remains as a single file — splitting deferred; patterns already extracted into `shared.ts`.

**ChatDetailScreen Monolithic Component:**
- Issue: Chat detail screen is 1414 lines with 30+ imports, mixing message handling, audio recording, emoji input, session management, and connection state
- Files: `src/screens/ChatDetailScreen.tsx`
- Impact: Single file handles too many responsibilities; difficult to test, understand, or modify safely
- Fix approach: Extract message list, header, input area, and emoji picker into separate focused components; move business logic to hooks

**Monolithic EntitySessionService:**
- Issue: EntitySessionService has grown to 1143 lines (+270 since March) with complex state machine handling dual sessions, reconnection logic, and message routing
- Files: `src/services/EntitySessionService.ts`
- Impact: Fragile 1347-line service with 30+ methods; reconnection timers, transcription tracking, and session management tightly coupled
- Fix approach: Split into focused services (SessionManager, ReconnectionManager, TranscriptionManager)

**WebSocket Code Duplication:**
- Issue: Three concrete WebSocket connection classes (Secure, InsecureSSL, Unencrypted) share significant code patterns beyond what BaseWebSocketConnection abstracts
- Files: `src/services/websocket/SecureWebSocketConnection.ts` (186 lines), `src/services/websocket/InsecureSSLWebSocketConnection.ts` (181 lines), `src/services/websocket/UnencryptedWebSocketConnection.ts` (113 lines)
- Impact: Bug fixes or feature additions to connection logic require updating 3 files identically
- Fix approach: Move more shared logic into BaseWebSocketConnection, use strategy pattern for SSL differences only

**Growing DB Migration Chain:**
- Issue: 28 migration files (up from ~16 in March), `migrations.ts` orchestrator at 318 lines
- Files: `src/database/migrations/` (28 files), `src/database/migrations.ts`
- Impact: Each new migration adds overhead; clean installs must run all 28 migrations sequentially
- Fix approach: Consider squashing migrations periodically, or using a migration tool that supports squashing

**Excessive `any` Type Usage in Sync Module:**
- Issue: Core sync functions use `any` types extensively instead of proper TypeScript generics/interfaces
- Files: `src/database/sync.ts` (lines 40, 79, 189, 220, 262, 271, 387 — 9+ occurrences)
- Impact: Loss of type safety in critical data synchronization logic; runtime errors harder to catch
- Fix approach: Define proper type aliases for sync record shapes, use generics for table-specific operations

**`console.error` in Production Code:**
- Issue: Several production screens use `console.error` directly instead of the project's `createLogger` utility
- Files: `src/screens/CharacterProfileEditScreen.tsx` (lines 104, 178, 236, 251, 271), `src/screens/CharactersScreen.tsx` (line 82), `src/screens/ChatListScreen.tsx` (line 321), `src/screens/CreateAIScreen.tsx` (line 452), `src/screens/EntityConfigEditScreen.tsx` (lines 152, 256)
- Impact: Inconsistent logging; console.error may not respect log levels and clutters production logs
- Fix approach: Replace console.error calls with `createLogger` instances consistent with the rest of the codebase

## Known Bugs

**No Known Critical Bugs:**
- No explicit bug reports found in codebase
- Error handling is present but may not cover all edge cases

## Security Considerations

**API Keys in AsyncStorage:**
- Risk: API keys stored in AsyncStorage are not encrypted
- Files: `src/services/SyncService.ts`, `src/services/ChatPreferencesService.ts`
- Current mitigation: None
- Recommendations: Consider using react-native-keychain for sensitive data storage

**Password Storage in Database:**
- Risk: Passwords stored in plaintext in SQLite database (Kajiwoto provider)
- Files: `src/database/repositories/providers.ts` (lines 1511-1592), `src/database/models.ts` (line 179)
- Current mitigation: Database is encrypted with SQLCipher
- Recommendations: Consider hashing passwords before storage, though this may break provider integration

**JWT Token Storage:**
- Risk: JWT tokens stored in AsyncStorage
- Files: `src/services/ConnectionStateManager.ts`
- Current mitigation: Tokens have expiration timestamps
- Recommendations: Consider using more secure storage for tokens

**Multiple API Key Fields Across Models:**
- Risk: API keys defined on multiple model types (provider, module configs) — stored in SQLite and potentially cached in AsyncStorage
- Files: `src/database/models.ts` (lines 63, 93, 119, 157, 170, 202)
- Current mitigation: SQLite database encrypted with SQLCipher
- Recommendations: Audit all API key storage paths; ensure consistent encryption at rest

## Performance Bottlenecks

**Large File Operations:**
- Problem: Database repositories have repetitive code patterns that could be optimized
- Files: `src/database/repositories/providers.ts` (2279 lines), `src/database/repositories/modules.ts` (1324 lines)
- Cause: Each provider type has nearly identical CRUD operations with minor variations
- Improvement path: Create generic CRUD templates or code generation

**No Query Optimization:**
- Problem: No visible query optimization (indexes, pagination)
- Files: `src/database/repositories/*.ts`
- Cause: All records fetched at once
- Improvement path: Add pagination support for list operations

**Emoji Data Bundle Size:**
- Problem: Emoji system loads multiple emoji-datasource packages (twitter, google) and large sprite sheet images (~64px sheets) into memory
- Files: `src/services/EmojiService.ts`, `src/assets/emoji/sheets/`
- Cause: Three emoji sets (native, noto, twemoji) each with full sprite sheets; emoji-mart data and emoji-datasource JSON loaded at runtime
- Impact: Significant memory usage on mobile; app bundle size increased by ~2-5MB from emoji assets
- Improvement path: Lazy-load only the active emoji set, consider downloading optional sets on demand

**ChatDetailScreen Fixed Page Size:**
- Problem: Message history limited to fixed MESSAGES_PAGE_SIZE (200) with no scroll-back pagination
- Files: `src/screens/ChatDetailScreen.tsx` (lines 67-74)
- Cause: TODO for scrollback pagination never implemented; initial load and refresh both use same fixed window
- Improvement path: Implement cursor-based pagination using message creation timestamps, smart-merge new messages instead of full replacement

## Fragile Areas

**WebSocket Connection Handling:**
- Files: `src/services/websocket/*.ts`, `src/services/connection/ConnectionManager.ts` (345 lines)
- Why fragile: Multiple connection implementations with similar code; reconnection logic may have race conditions; ConnectionManager orchestrates 3 connection types and entity events
- Safe modification: Test all connection types (secure, insecure, unencrypted) after changes
- Test coverage: No visible tests for WebSocket connections or ConnectionManager

**Sync Service:**
- Files: `src/services/SyncService.ts` (884 lines, +83 since March)
- Why fragile: Complex state machine for sync operations; many async operations that could conflict
- Safe modification: Add detailed logging and state validation
- Test coverage: Limited - only `SyncService.test.ts` exists

**Entity Session Service:**
- Files: `src/services/EntitySessionService.ts` (1143 lines, +270 since March)
- Why fragile: Manages complex dual-session state for chat partners; 30+ methods; multiple state maps (sessions, pendingSessions, transcriptionStates, reconnectTimers)
- Safe modification: Ensure proper cleanup on session termination; test all event handler paths
- Test coverage: No visible tests

**Database Sync Module:**
- Files: `src/database/sync.ts` (488 lines, added since March)
- Why fragile: Handles large TEXT field chunking (1MB chunks), timestamp normalization, orphan cleanup, and full table sync — all with heavy `any` typing
- Safe modification: Test with various data sizes and edge cases (null timestamps, empty tables, large binary data)
- Test coverage: No dedicated sync tests

## Scaling Limits

**Database:**
- Current capacity: SQLite on mobile device (limited by device storage)
- Limit: No visible pagination or batch operations - will struggle with large message histories
- Scaling path: Implement message archival/cleanup, add pagination

**WebSocket Connections:**
- Current capacity: Single connection per device
- Limit: Cannot handle multiple simultaneous sync operations
- Scaling path: Implement connection pooling or queue for sync requests

**Emoji Data:**
- Current capacity: Full emoji dataset (~3,500+ emoji entries) loaded into memory
- Limit: Memory usage scales with number of emoji sets loaded; all sprite sheets held simultaneously
- Scaling path: Lazy-load sprite sheets, render emoji on demand using native text fallback

## Dependencies at Risk

**react-native-sqlite-storage:**
- Risk: Older package, may have compatibility issues with newer React Native versions
- Impact: Core database functionality depends on it
- Migration plan: Consider migrating to expo-sqlite or @op-engineering/op-sqlite

**react-native-keychain:**
- Risk: Stable but platform-specific behavior differences
- Impact: Encryption key storage depends on it
- Migration plan: Maintain current usage, test thoroughly on all platforms

**emoji-datasource / emoji-datasource-*:**
- Risk: V16 packages may lag behind Unicode updates; each adds bundle size
- Impact: Emoji rendering system depends on these for sprite coordinates
- Migration plan: Monitor for updates; consider switching to native emoji rendering where possible

## Missing Critical Features

**No End-to-End Encryption:**
- Problem: Messages stored in SQLite without end-to-end encryption
- Blocks: Secure message storage for sensitive conversations

**No Offline Message Queue:**
- Problem: Messages sent while offline may be lost
- Blocks: Reliable message delivery in poor network conditions

**No Message Search:**
- Problem: No full-text search for chat messages
- Files: `src/database/repositories/conversation_messages.ts` (no FTS index or search queries)
- Blocks: Finding historical conversations

## Test Coverage Gaps

**No Screen/Component Tests:**
- What's not tested: All React Native screens and UI components (20+ screens added since March, none have tests)
- Files: `src/screens/*.tsx` (19 screens), `src/components/*.tsx` (30+ components)
- Risk: UI regressions go undetected
- Priority: High

**No WebSocket Tests:**
- What's not tested: WebSocket connection handling, reconnection, message parsing
- Files: `src/services/websocket/*.ts`, `src/services/connection/ConnectionManager.ts`
- Risk: Connection issues not detected until production
- Priority: High

**No Context Tests:**
- What's not tested: React Context providers (ThemeContext, SyncConnectionContext, EntitySessionContext, EmojiContext)
- Files: `src/contexts/*.tsx`
- Risk: State management bugs undetected
- Priority: Medium

**Limited Service Tests:**
- What's not tested: EntitySessionService, ConnectionStateManager, AudioPlayer, AudioRecorder, EmojiService, EntityEmojiActionService
- Files: `src/services/*.ts` (12 services, 0 test files)
- Risk: Business logic errors undetected
- Priority: Medium

**No Emoji System Tests:**
- What's not tested: Emoji rendering, sprite coordinate calculation, emoji action CRUD, category filtering
- Files: `src/services/EmojiService.ts` (308 lines), `src/services/EntityEmojiActionService.ts` (280 lines), `src/components/emoji/*.tsx` (10 components)
- Risk: Emoji display and action system bugs undetected
- Priority: Medium

**No Database Sync Tests:**
- What's not tested: Sync upsert logic, timestamp normalization, TEXT field chunking, orphan cleanup
- Files: `src/database/sync.ts` (488 lines)
- Risk: Data corruption during sync operations undetected
- Priority: High

---

*Concerns audit: 2026-05-24*
