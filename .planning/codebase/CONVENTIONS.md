# Coding Conventions

**Analysis Date:** 2026-08-07

## Naming Patterns

**Files:**
- Components: PascalCase `.tsx` (e.g., `ChatBubble.tsx`, `ThemedButton.tsx`, `CloudProvisioningCard.tsx`, `StatusPulseDot.tsx`)
- Screens: PascalCase `.tsx` with `Screen` suffix (e.g., `ChatListScreen.tsx`, `SettingsScreen.tsx`, `EntityConfigEditScreen.tsx`)
- Services: PascalCase class names with `Service` suffix where stateful (e.g., `SyncService.ts`, `BiometricLockService.ts`, `EntitySessionService.ts`); utility-ish services without suffix (e.g., `AudioPlayer.ts`, `EmojiService.ts`)
- Repositories: lowercase plural `.ts` files (e.g., `src/database/repositories/characters.ts`, `entities.ts`, `modules.ts`, `providers.ts`, `memories.ts`); `emotion_state.ts` uses snake_case (table-name match)
- Utilities: camelCase `.ts` (e.g., `src/utils/logger.ts`, `haptics.ts`, `colorUtils.ts`, `uuid.ts`)
- Contexts: PascalCase `.tsx` with `Context` suffix (e.g., `AuthContext.tsx`, `BiometricLockContext.tsx`, `ThemeContext.tsx`)
- Migrations: zero-padded numeric prefix `0000NN_description.ts` (e.g., `000034_*.ts`), registered in `src/database/migrations/index.ts`
- Tests: `.test.ts` / `.test.tsx` suffix, placed in a co-located `__tests__/` directory (e.g., `src/database/__tests__/repositories/characters.test.ts`). Integration tests live in `__tests__/integration/` with `*.integration.test.ts` filename convention (e.g., `sync.conflict.integration.test.ts`)
- Test helpers: camelCase or PascalCase non-test files inside `__tests__/` and `__test_utils__/` (e.g., `repositoryFixtures.ts`, `testDatabase.ts`, `HarmonyLinkMockServer.ts`)
- E2E flows: `e2e/.maestro/NN-name.yaml` with zero-padded numeric prefix (e.g., `01-smoke-boot.yaml`, `04-network-reconnect.yaml`)

**Functions:**
- camelCase (e.g., `createCharacterProfile`, `runMigrations`, `classifyCloudStage`, `calcElapsedSeconds`)
- Async functions: prefix with action verb (`createX`, `getX`, `updateX`, `deleteX`, `startX`, `stopX`, `initiateX`)
- Pure helper functions extracted from components are **exported** for testability (e.g., `classifyCloudStage`, `calcElapsedSeconds` in `src/components/cloud/CloudProvisioningCard.tsx`)
- Hooks: `use` + camelCase (e.g., `useElapsed`, `useAppTheme`, `useSyncConnection`)
- Repository modules: plain exported named functions, no class wrapper

**Variables:**
- camelCase (e.g., `currentSession`, `syncPhase`, `elapsedSeconds`)
- Module-level constants: SCREAMING_SNAKE_CASE (e.g., `INACTIVE_LOCK_GRACE_MS`, `FLOW_CONCLUDE_CONFIRM_MS`, `APP_TAG`, `PNG_MAGIC_BASE64`)
- Private class properties: prefix with `private` keyword; underscore prefix (`_instance`, `_connectionManager`, `_serverData`) appears in older service code (`HarmonyLinkMockServer.ts`, `SyncService.ts`), while newer code omits the underscore (`this.connectionManager`, `this.sessions`). Follow the existing style of the file you touch; for new code prefer **no underscore** with `private` modifier
- Static storage keys: grouped under `private static readonly STORAGE_KEYS = {...}` map (see `src/services/ConnectionStateManager.ts`)

**Types/Interfaces:**
- PascalCase (e.g., `CharacterProfile`, `ConnectionState`, `ConversationMessage`, `CloudSessionStatus`)
- Event-map interfaces: suffix `Events` (e.g., `ConnectionStateEvents`, `SyncServiceEvents`) — used as the generic param of `EventEmitter<...>`
- Props interfaces: suffix `Props` (e.g., `ChatBubbleProps`, `BiometricLockProviderProps`)
- Context value types: suffix `ContextType` (e.g., `BiometricLockContextType`)
- Typed event payloads declared inline in the interface map: `'state:changed': (state: ConnectionState) => void`

## Code Style

**Formatting:**
- Tool: Prettier 2.8.8
- Settings in `.prettierrc.js`:
  - `arrowParens: 'avoid'` — omit parens for single-arg arrows
  - `singleQuote: true` — single quotes throughout
  - `trailingComma: 'all'` — trailing commas everywhere
- Manual formatting convention in tests/source: section separators with `// ── Section name ──...` and `// ====` blocks to group logic

**Linting:**
- Tool: ESLint 8.19.0
- Config: `.eslintrc.js` — `root: true`, `extends: '@react-native'` (legacy `.eslintrc` format; not flat config)
- Run: `npm run lint` (eslint ., `scripts.lint` in `package.json`)

**TypeScript:**
- Version 5.8.3; `tsconfig.json` extends `@react-native/typescript-config` (strict by default)
- `"types": ["jest"]` enables Jest globals in tests without importing
- Explicit return types on exported functions and async functions
- `import type` for type-only imports (e.g., `import type { NodeDatabase } from '../__test_utils__/nodeDatabase'`)
- Type-only re-exports and discriminated unions used heavily in service/state types

## Import Organization

**Order (observed in `src/components/chat/ChatBubble.tsx`, `src/services/ConnectionStateManager.ts`):**
1. React / React Native imports (`import React, { useState } from 'react'`; `import { StyleSheet, View } from 'react-native'`)
2. Third-party libraries (`react-native-paper`, `react-native-linear-gradient`, `react-i18next`, `eventemitter3`, `react-native-logs`)
3. Relative app imports — components first, then services, then types/models/utils (relative depth from shallowest to deepest)

**Path Aliases:**
- Only one Jest moduleNameMapper alias: `^@test-utils/database$` → `<rootDir>/src/database/__test_utils__/testDatabase` (defined in `jest.config.js`; usable only in tests, not runtime)
- All runtime imports use relative paths — no `@/` or `~` aliases

**Specific import patterns:**
- Repository imports use namespace import: `import * as characters from '../../repositories/characters'`
- Singleton services imported by name (class): `import { ConnectionStateManager } from '../ConnectionStateManager'` then `ConnectionStateManager.getInstance()`
- Default-export singleton services: `import EntitySessionService from '../../services/EntitySessionService'`
- Logger: `import { createLogger } from '../utils/logger'`; local `const log = createLogger('[ComponentName]')`
- ESM-only packages inside `jest.mock` factories use `require()` (factories are hoisted and cannot reference outer scope) — see `src/components/cloud/__tests__/CloudProvisioningCard.render.test.tsx`

## Event System

**Library:** `eventemitter3` (v5.0.1) — replaces Node.js `EventEmitter`

**Pattern:**
```typescript
import EventEmitter from 'eventemitter3';

interface ConnectionStateEvents {
  'state:changed': (state: ConnectionState) => void;
  'error': (error: any) => void;
}

export class ConnectionStateManager extends EventEmitter<ConnectionStateEvents> {
  private static instance: ConnectionStateManager;
  static getInstance(): ConnectionStateManager { ... }
}
```

**Used by:** `SyncService.ts`, `ConnectionStateManager.ts`, `EntitySessionService.ts`, `ConnectionManager` (`src/services/connection/`), `BaseWebSocketConnection` (`src/services/websocket/`), and the test-side `HarmonyLinkMockServer.ts`

**Event naming:** `domain:action` colon-separated (e.g., `'sync:completed'`, `'sync:error'`, `'state:changed'`, `'session:started'`, `'message:received'`)

## Error Handling

**Patterns:**
- try/catch with async/await for DB and I/O operations; `finally` blocks for cleanup (see `withFreshDatabase` in `src/database/__tests__/repositoryFixtures.ts`)
- Return `null` for not-found cases: `Promise<CharacterProfile | null>` (repositories), and Promise.resolve(false) style boolean outcomes for guards (e.g., `BiometricLockService.authenticateBiometric` returns `false` rather than rejecting on user cancel)
- Service-level failures emit error events: `this.emit('sync:error', error)`
- Timeout safety nets for native prompts that may never settle (see `BiometricLockService.ts` — bounded with `setTimeout`, tested with fake timers)
- Log errors with namespace logger: `log.error('context', error)`
- `as any` casts for crossing mock boundaries in tests only (e.g., `(syncService as any).connectionManager = mockCm` in `__tests__/integration/syncService.integration.test.ts`)

## Logging

**Framework:** `react-native-logs` (v5.5.0) via `src/utils/logger.ts`

**Pattern:**
```typescript
import { createLogger } from '../utils/logger';
const log = createLogger('[BiometricLockContext]');
```

**Configuration** (`src/utils/logger.ts`):
- Global tag `SOULBITS`; every line formatted `[SOULBITS] | [Namespace] | LEVEL | message` (filter in logcat: `adb logcat | grep "[SOULBITS]"`)
- Dev (`__DEV__`): all levels (debug, info, warn, error) with timestamps
- Production: only `error` level, no timestamps
- Error objects stringified with stack (`m.stack || m.message`)
- Levels: `log.debug()`, `log.info()`, `log.warn()`, `log.error()`

## Comments

**When to Comment:**
- JSDoc/TSDoc block on every exported function, class, and non-trivial hook — states purpose, parameters, and behavioral contract (see `src/contexts/BiometricLockContext.tsx`, `src/utils/logger.ts`)
- Header comment on every test file explaining what scenario it covers and why (regression context, decision references)
- Inline `// NOTE:` / `// IMPORTANT:` for gotchas (hoisting limits of `jest.mock`, WAL-on-`:memory:` hazards, RNTL v14 async `render()`)
- Decision references: `// decision 2/3`, `// Per spec:`, `// Per D-03/D-32/D-35:` — links design decisions to implementation
- Section separators: `// ── Section name ───...` and `// ====` rule lines in both source and tests
- TODO/FIXME comments used sparingly for known debt

## Function Design

**Size:** No strict limit; prefer focused single-responsibility functions. `CloudProvisioningCard.tsx` explicitly extracts pure helpers from the render component

**Parameters:**
- Object params typed via interfaces; optional props with default values in component signatures (`isLastMessage = false`)
- Factory-style test helpers take an `overrides: Partial<Record<string, any>> = {}` object spread last (see `sampleCharacter` in `__tests__/integration/helpers/fixtures.ts`)
- Numeric tolerances/timings as named constants with `_MS` suffix

**Return Values:**
- Explicit return types everywhere (e.g., `(status: CloudSessionStatus, isConnected: boolean): RadarState`)
- `Promise<T>` for async, `null` for not-found, `boolean` for predicate/guard outcomes
- Collections returned as arrays; counts never implied by `length` alone without assertions

**Private methods:** `private` keyword; helper groups under `// ---- Internal helpers ----` or `// ── ... ──` section comments

## Module Design

**Exports:**
- Named exports for functions, types, and classes; default export for the root logger (`src/utils/logger.ts`)
- Singleton services: `private static instance` + `static getInstance()` (e.g., `ConnectionStateManager`, `SyncService`, `BiometricLockService`)
- Some services export both class and a default singleton (e.g., `EntitySessionService`, `EmojiService`, `AudioPlayer`)
- Repository modules: named function exports only
- Pure helpers exported from components for unit testing (`classifyCloudStage`, `calcElapsedSeconds`, `useElapsed`)

**Barrel Files:**
- `src/database/index.ts` re-exports; `src/database/migrations/index.ts` aggregates migration list (`MIGRATIONS` array with `version`)
- Contexts export `XProvider` + `useX` hook from the same file

## Component Patterns

**React Components:**
- Functional components with TypeScript, typed `React.FC<Props>` (or `React.FC<{...}>` for inline sub-components like `FormattedRPText` in `ChatBubble.tsx`)
- Props destructured in signature with defaults for optional props
- Local state via `useState`; effects via `useEffect`; perf via `useCallback`/`useRef`
- Sub-components kept in the same file when only used there (e.g., `FormattedRPText` in `src/components/chat/ChatBubble.tsx`)
- `testID` attributes used on interactive elements for RNTL queries (`testID="alert-button-0"` in `AppAlertContext.test.tsx`)

**Theming:**
- `useAppTheme()` from `src/contexts/ThemeContext.tsx` returns `{ theme }`; colors/spacing/typography read from the `theme` object
- Themed wrappers in `src/components/themed/`: `ThemedText`, `ThemedButton`, `ThemedCard`, `ThemedView`, `ThemedGradient`, `ThemedAppbar`, `ThemedFab`, `ScreenHeader`, `SectionHeader`

**Context Pattern** (all in `src/contexts/`, e.g., `BiometricLockContext.tsx`):
- Value type interface suffixed `ContextType`
- `createContext<ContextType>(defaultValue)` — often a functional default, not `undefined`
- Provider: `export const XProvider: React.FC<ProviderProps>`
- Hook: `export const useX = (): ContextType => useContext(XContext)`
- Newer contexts (e.g., `BiometricLockContext`) prefer a non-throwing default context value over the throw-if-outside-provider pattern; older contexts (`ThemeContext`) may throw — check the file

**Hooks:**
- Custom hooks exported from component files (e.g., `useElapsed` in `CloudProvisioningCard.tsx`) or context files
- Hooks that drive timers use `setInterval`/`setTimeout` and must be testable via fake timers

---

*Convention analysis: 2026-08-07*
