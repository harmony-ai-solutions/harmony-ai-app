# Coding Conventions

**Analysis Date:** 2026-05-24

## Naming Patterns

**Files:**
- Components: PascalCase (e.g., `ChatBubble.tsx`, `ThemedButton.tsx`, `EmojiAwareText.tsx`)
- Services: PascalCase with Service suffix (e.g., `SyncService.ts`, `EntitySessionService.ts`, `EntityEmojiActionService.ts`)
- Services without Service suffix: PascalCase (e.g., `AudioPlayer.ts`, `EmojiService.ts`)
- Repositories: PascalCase (e.g., `characters.ts`, `entities.ts`, `interactions.ts`, `emoji_actions.ts`)
- Utilities: camelCase (e.g., `base64.ts`, `connection.ts`, `emojiSprite.ts`)
- Types: PascalCase (e.g., `types.d.ts`)
- Tests: `.test.ts` or `.test.tsx` suffix (e.g., `SyncService.test.ts`, `memories.test.ts`)
- Migrations: Zero-padded numeric prefix (e.g., `000024_create_interactions_table.ts`)

**Functions:**
- camelCase (e.g., `createCharacterProfile`, `getDatabase`, `initiateSync`)
- Async functions: Prefix with action verb (e.g., `createX`, `getX`, `updateX`, `deleteX`, `startX`, `stopX`)
- Repository functions: Exported directly as named functions from module

**Variables:**
- camelCase (e.g., `currentSession`, `syncPhase`, `interactionId`)
- Private class properties: Prefix with underscore (e.g., `_instance`, `_connectionManager`)
- Private class properties also used without underscore in newer code: `this.connectionManager`, `this.sessions` (Map type)

**Types/Interfaces:**
- PascalCase (e.g., `SyncServiceEvents`, `CharacterProfile`, `ChatBubbleProps`, `InteractionSession`, `EntitySession`)
- Event interfaces: Suffix with `Events` (e.g., `SyncServiceEvents`, `EntitySessionEvents`, `ConnectionManagerEvents`)
- Props interfaces: Suffix with `Props` (e.g., `ChatBubbleProps`, `ThemedButtonProps`)
- Context types: Suffix with `Type` or `ContextType` (e.g., `EntitySessionContextType`)

## Code Style

**Formatting:**
- Tool: Prettier 2.8.8
- Settings in `.prettierrc.js`:
  - `arrowParens: 'avoid'` - Omit parens when possible
  - `singleQuote: true` - Use single quotes
  - `trailingComma: 'all'` - Trailing commas everywhere

**Linting:**
- Tool: ESLint 8.19.0
- Config: `.eslintrc.js` extends `@react-native` preset

**TypeScript:**
- Strict mode enabled via `@react-native/typescript-config` (v0.83.1)
- Version: 5.8.3
- `"types": ["jest"]` in `tsconfig.json` for test type support

## Import Organization

**Order:**
1. Standard library / Node modules (e.g., `import http from 'http'`)
2. Third-party library imports (e.g., `import EventEmitter from 'eventemitter3'`, `import { Avatar, IconButton } from 'react-native-paper'`)
3. React imports (`import React from 'react'`)
4. React Native imports (`import { StyleSheet, View } from 'react-native'`)
5. Relative imports from same package (`../components/...`, `./services/...`, `../../database/models`)

**Path Aliases:**
- Not detected - all imports use relative paths

**Specific import patterns:**
- Database repository imports use namespace import: `import * as characters from '../repositories/characters'`
- Service imports use default export of singleton: `import EntitySessionService from '../../services/EntitySessionService'`
- Type-only imports for interfaces: `import type { ConnectionManager } from './connection/ConnectionManager'`

## Event System

**Library:** `eventemitter3` (v5.0.1) - replaces Node.js EventEmitter

**Pattern:**
```typescript
import EventEmitter from 'eventemitter3';

interface ServiceEvents {
  'event:name': (param1: string, param2: any) => void;
}

export class MyService extends EventEmitter<ServiceEvents> {
  // ...
  private constructor() {
    super();
  }
}
```

**Used by:** All major services - `SyncService`, `EntitySessionService`, `ConnectionStateManager`, `ConnectionManager`, `BaseWebSocketConnection`

**Event naming convention:** `domain:action` (colon-separated, e.g., `'sync:started'`, `'session:started'`, `'message:received'`)

## Error Handling

**Patterns:**
- Use try/catch with async/await for database operations
- Return `null` for not-found cases (e.g., `getCharacterProfile` returns `Promise<CharacterProfile | null>`)
- Emit error events for service-level failures (e.g., `this.emit('sync:error', error)`)
- Log errors with contextual information using logger utility
- Use `InstanceType<typeof setTimeout>` for timeout return types (e.g., `ReturnType<typeof setTimeout>`)

## Logging

**Framework:** `react-native-logs` (v5.5.0)

**Pattern:** Create logger with context tag
```typescript
import { createLogger } from '../utils/logger';
const log = createLogger('[ServiceName]');
```

**Log levels:** `log.info()`, `log.debug()`, `log.warn()`, `log.error()`

**Configuration** (in `src/utils/logger.ts`):
- Development (`__DEV__`): All levels enabled (debug, info, warn, error)
- Production: Only ERROR level
- Error objects automatically stringified with stack traces
- Timestamps shown in dev only

## Comments

**When to Comment:**
- JSDoc for public API functions (exported functions)
- Inline comments for complex logic or protocol-specific behavior
- TODO/FIXME comments for technical debt
- Section comments with visual separators: `// ============================================================================`
- Design doc references: `// Per D-03/D-32/D-35:` style comments referencing design documents

## Function Design

**Size:** No strict limit, but prefer focused single-responsibility functions

**Parameters:**
- Use TypeScript interfaces for complex parameter objects
- Optional parameters with default values
- Use `Omit` utility type when creating new objects from existing types

**Return Values:**
- Explicit return types in function signatures
- Return `Promise<T>` for async functions
- Return `null` for not-found cases
- Return arrays for collection queries

**Private methods:**
- Prefix private methods with `private` keyword (TypeScript)
- Helper methods organized under `// ---- Internal helpers ----` section comments

## Module Design

**Exports:**
- Named exports for functions and types
- Singleton pattern for services via `getInstance()` static method
- Repository functions exported directly as named exports
- Some services export both the class AND a default singleton instance (e.g., `EntityEmojiActionService`)

**Barrel Files:**
- Use `index.ts` for re-exporting (e.g., `src/database/index.ts`)

**Class-based Services:**
- Singleton pattern with private constructor
- Static `getInstance()` method
- Extend `EventEmitter` from `eventemitter3` for event-driven communication

**Alternative module pattern:**
- Function-based modules with named exports (e.g., `src/database/repositories/`, `src/utils/`)
- No class wrapper - exports are standalone async functions

## Component Patterns

**React Components:**
- Functional components with TypeScript
- Use `React.FC<Props>` type for component definition (preferred)
- Destructure props in function signature
- Default values for optional props

**Theming:**
- Use `useAppTheme()` hook from `ThemeContext` (e.g., `const { theme } = useAppTheme()`)
- Components reference `theme` object for colors, spacing, typography
- Themed wrapper components in `src/components/themed/` (e.g., `ThemedText`, `ThemedButton`, `ThemedCard`, `ThemedView`, `ThemedGradient`)

**Hooks:**
- Use built-in hooks (`useState`, `useEffect`, `useRef`, `useCallback`)
- Custom hooks for reusable logic (e.g., contexts in `src/contexts/`)

**Context Pattern:**
- Create context with `createContext<Type | undefined>(undefined)`
- Provider component as `export const XProvider: React.FC<Props>`
- Consumer hook as `export function useX(): XType`
- Hook throws if used outside provider: `if (!context) throw new Error(...)`

---

*Convention analysis: 2026-05-24*
