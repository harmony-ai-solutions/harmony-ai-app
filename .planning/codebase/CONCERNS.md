# Codebase Concerns

**Analysis Date:** 2026-03-05

## Tech Debt

**Hardcoded Fallback Entity:**
- Issue: Default impersonated entity is hardcoded to "user" with no proper handling
- Files: `src/screens/ChatListScreen.tsx` (lines 50, 63)
- Impact: Chat functionality may fail or behave unexpectedly when preferred entity is not set
- Fix approach: Implement proper entity selection UI or default to first available entity

**Theme Sync Not Implemented:**
- Issue: Harmony Link theme synchronization is marked as TODO
- Files: `src/contexts/ThemeContext.tsx` (line 297)
- Impact: Themes cannot be synced across devices via Harmony Link
- Fix approach: Implement Harmony Link API client for theme sync when backend is ready

**Large Monolithic Repository Files:**
- Issue: Provider repository is 2036 lines, modules repository is 1274 lines - both contain duplicated patterns
- Files: `src/database/repositories/providers.ts`, `src/database/repositories/modules.ts`
- Impact: Difficult to maintain, test, and extend; high risk of bugs when modifying
- Fix approach: Extract common database operations into shared utility functions or create a generic repository base class

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
- Files: `src/database/repositories/providers.ts` (lines 1268-1367), `src/database/models.ts` (line 135)
- Current mitigation: Database is encrypted with SQLCipher
- Recommendations: Consider hashing passwords before storage, though this may break provider integration

**JWT Token Storage:**
- Risk: JWT tokens stored in AsyncStorage
- Files: `src/services/ConnectionStateManager.ts`
- Current mitigation: Tokens have expiration timestamps
- Recommendations: Consider using more secure storage for tokens

## Performance Bottlenunks

**Large File Operations:**
- Problem: Database repositories have repetitive code patterns that could be optimized
- Files: `src/database/repositories/providers.ts` (2036 lines)
- Cause: Each provider type has nearly identical CRUD operations with minor variations
- Improvement path: Create generic CRUD templates or code generation

**No Query Optimization:**
- Problem: No visible query optimization (indexes, pagination)
- Files: `src/database/repositories/*.ts`
- Cause: All records fetched at once
- Improvement path: Add pagination support for list operations

## Fragile Areas

**WebSocket Connection Handling:**
- Files: `src/services/websocket/*.ts`
- Why fragile: Multiple connection implementations with similar code; reconnection logic may have race conditions
- Safe modification: Test all connection types (secure, insecure, unencrypted) after changes
- Test coverage: No visible tests for WebSocket connections

**Sync Service:**
- Files: `src/services/SyncService.ts` (801 lines)
- Why fragile: Complex state machine for sync operations; many async operations that could conflict
- Safe modification: Add detailed logging and state validation
- Test coverage: Limited - only `SyncService.test.ts` exists

**Entity Session Service:**
- Files: `src/services/EntitySessionService.ts` (873 lines)
- Why fragile: Manages complex dual-session state for chat partners
- Safe modification: Ensure proper cleanup on session termination
- Test coverage: No visible tests

## Scaling Limits

**Database:**
- Current capacity: SQLite on mobile device (limited by device storage)
- Limit: No visible pagination or batch operations - will struggle with large message histories
- Scaling path: Implement message archival/cleanup, add pagination

**WebSocket Connections:**
- Current capacity: Single connection per device
- Limit: Cannot handle multiple simultaneous sync operations
- Scaling path: Implement connection pooling or queue for sync requests

## Dependencies at Risk

**react-native-sqlite-storage:**
- Risk: Older package, may have compatibility issues with newer React Native versions
- Impact: Core database functionality depends on it
- Migration plan: Consider migrating to expo-sqlite or @op-engineering/op-sqlite

**react-native-keychain:**
- Risk: Stable but platform-specific behavior differences
- Impact: Encryption key storage depends on it
- Migration plan: Maintain current usage, test thoroughly on all platforms

## Missing Critical Features

**No End-to-End Encryption:**
- Problem: Messages stored in SQLite without end-to-end encryption
- Blocks: Secure message storage for sensitive conversations

**No Offline Message Queue:**
- Problem: Messages sent while offline may be lost
- Blocks: Reliable message delivery in poor network conditions

**No Message Search:**
- Problem: No full-text search for chat messages
- Blocks: Finding historical conversations

## Test Coverage Gaps

**No Screen/Component Tests:**
- What's not tested: All React Native screens and UI components
- Files: `src/screens/*.tsx`, `src/components/*.tsx`
- Risk: UI regressions go undetected
- Priority: High

**No WebSocket Tests:**
- What's not tested: WebSocket connection handling, reconnection, message parsing
- Files: `src/services/websocket/*.ts`
- Risk: Connection issues not detected until production
- Priority: High

**No Context Tests:**
- What's not tested: React Context providers (ThemeContext, SyncConnectionContext, etc.)
- Files: `src/contexts/*.tsx`
- Risk: State management bugs undetected
- Priority: Medium

**Limited Service Tests:**
- What's not tested: EntitySessionService, ConnectionStateManager, AudioPlayer, AudioRecorder
- Files: `src/services/*.ts`
- Risk: Business logic errors undetected
- Priority: Medium

---

*Concerns audit: 2026-03-05*
