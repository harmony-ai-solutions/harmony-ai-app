# Coding Conventions

**Analysis Date:** 2026-03-05

## Naming Patterns

**Files:**
- Components: PascalCase (e.g., `ChatBubble.tsx`, `ThemedButton.tsx`)
- Services: PascalCase with Service suffix (e.g., `SyncService.ts`, `AudioPlayer.ts`)
- Repositories: PascalCase (e.g., `characters.ts`, `entities.ts`)
- Utilities: camelCase (e.g., `base64.ts`, `connection.ts`)
- Types: PascalCase (e.g., `types.d.ts`)
- Tests: `.test.ts` or `.test.tsx` suffix (e.g., `SyncService.test.ts`)

**Functions:**
- camelCase (e.g., `createCharacterProfile`, `getDatabase`)
- Async functions: Prefix with action verb (e.g., `createX`, `getX`, `updateX`, `deleteX`)

**Variables:**
- camelCase (e.g., `currentSession`, `syncPhase`)
- Private class properties: Prefix with underscore (e.g., `_instance`, `_connectionManager`)

**Types/Interfaces:**
- PascalCase (e.g., `SyncServiceEvents`, `CharacterProfile`, `ChatBubbleProps`)
- Event interfaces: Suffix with `Events` (e.g., `SyncServiceEvents`)

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
- Strict mode enabled via `@react-native/typescript-config`
- Version: 5.8.3

## Import Organization

**Order:**
1. React imports (`import React from 'react'`)
2. React Native imports (`import { StyleSheet, View } from 'react-native'`)
3. Third-party library imports (`import { Avatar, IconButton } from 'react-native-paper'`)
4. Relative imports from same package (`../components/...`, `./services/...`)

**Example from** [`src/components/chat/ChatBubble.tsx`](src/components/chat/ChatBubble.tsx:1):
```typescript
import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, View, TouchableOpacity, Image, Dimensions, TextInput, ActivityIndicator } from 'react-native';
import { Avatar, IconButton, Menu } from 'react-native-paper';
import { ThemedText } from '../themed/ThemedText';
import AudioPlayer from '../../services/AudioPlayer';
import { Theme } from '../../theme/types';
import { ConversationMessage } from '../../database/models';
```

**Path Aliases:**
- Not detected - all imports use relative paths

## Error Handling

**Patterns:**
- Use try/catch with async/await for database operations
- Return `null` for not-found cases (e.g., `getCharacterProfile` returns `Promise<CharacterProfile | null>`)
- Emit error events for service-level failures (e.g., `this.emit('sync:error', error)`)
- Log errors with contextual information using logger utility

**Example from** [`src/services/SyncService.ts`](src/services/SyncService.ts:82):
```typescript
private routeSyncEvent(data: any) {
  log.info(`Received sync event: ${data.event_type} status: ${data.status}`);
  // ...
}
```

## Logging

**Framework:** `react-native-logs` (v5.5.0)

**Pattern:** Create logger with context tag
```typescript
import { createLogger } from '../utils/logger';
const log = createLogger('[SyncService]');
```

**Log levels:** `log.info()`, `log.debug()`, `log.warn()`, `log.error()`

## Comments

**When to Comment:**
- JSDoc for public API functions (exported functions)
- Inline comments for complex logic or protocol-specific behavior
- TODO/FIXME comments for technical debt

**JSDoc Usage:**
- Used for exported functions in repositories and services
- Includes description and parameter types

**Example from** [`src/database/repositories/characters.ts`](src/database/repositories/characters.ts:19):
```typescript
/**
 * Create a new character profile
 */
export async function createCharacterProfile(
  profile: Omit<CharacterProfile, 'created_at' | 'updated_at' | 'deleted_at'>
): Promise<CharacterProfile> {
```

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

## Module Design

**Exports:**
- Named exports for functions and types
- Singleton pattern for services (e.g., `SyncService.getInstance()`)
- Repository functions exported directly

**Barrel Files:**
- Use `index.ts` for re-exporting (e.g., `src/database/index.ts`)

**Class-based Services:**
- Singleton pattern with private constructor
- Static `getInstance()` method
- Extend EventEmitter for event-driven communication

**Example from** [`src/services/SyncService.ts`](src/services/SyncService.ts:37):
```typescript
export class SyncService extends EventEmitter<SyncServiceEvents> {
  private static instance: SyncService;
  
  private constructor() {
    super();
    // ...
  }

  static getInstance(): SyncService {
    if (!SyncService.instance) {
      SyncService.instance = new SyncService();
    }
    return SyncService.instance;
  }
}
```

## Component Patterns

**React Components:**
- Functional components with TypeScript
- Use `React.FC<Props>` type for component definition
- Destructure props in function signature
- Default values for optional props

**Example from** [`src/components/chat/ChatBubble.tsx`](src/components/chat/ChatBubble.tsx:27):
```typescript
export const ChatBubble: React.FC<ChatBubbleProps> = ({
  message,
  isOwn,
  isLastMessage = false,
  isTranscriptionFailed = false,
  partnerAvatar,
  partnerName = 'AI',
  // ...
  theme,
}) => {
```

**Hooks:**
- Use built-in hooks (`useState`, `useEffect`, `useRef`, `useCallback`)
- Custom hooks for reusable logic (e.g., contexts in `src/contexts/`)

---

*Convention analysis: 2026-03-05*
