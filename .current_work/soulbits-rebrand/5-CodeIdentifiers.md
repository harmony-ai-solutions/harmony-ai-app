# Phase 5: Code Identifiers, Types, and Test Mocks

> **Goal**: Rename all TypeScript identifiers, types, and test mock classes from "HarmonyLink" / "harmony_link" to "SoulbitsEngine" / "soulbits_app" naming.

## Files to Modify

### 1. `src/theme/types.ts` — Interface method name

Line 178:
```typescript
// Change:
syncWithHarmonyLink: () => Promise<void>;
// To:
syncWithSoulbitsEngine: () => Promise<void>;
```

### 2. `src/contexts/ThemeContext.tsx` — Implementation

Lines 307, 382:
```typescript
// Change:
const syncWithHarmonyLink = useCallback(async () => { ... }
// To:
const syncWithSoulbitsEngine = useCallback(async () => { ... }
```

### 3. `src/screens/settings/ThemeSettingsScreen.tsx` — Consumer

Lines 41, 159:
```typescript
// Change:
syncWithHarmonyLink
// To:
syncWithSoulbitsEngine
```

### 4. `__tests__/integration/helpers/HarmonyLinkMockServer.ts` — Test mock

Rename class `HarmonyLinkMockServer` → `SoulbitsEngineMockServer`
Update all internal references (file is 260+ lines, but it's the class name + constructor).

### 5. `__tests__/integration/` — Test data

In all test files (`sync.clock.test.ts`, `sync.failures.test.ts`, `sync.network.test.ts`):

Test payload values:
```typescript
// Change:
device_id: 'harmony_link',
device_type: 'harmony_link',
// To:
device_id: 'soulbits_engine',
device_type: 'soulbits_engine',
```

Also update expected assertion strings inside test cases.

### 6. `src/services/auth/AuthService.ts` — Comments

Line 9:
```typescript
// Change:
// ... independent from the self-hosted HL `harmony_jwt` path
// To:
// ... independent from the self-hosted `soulbits_jwt` path
```

### 7. `src/services/auth/tokenStorage.ts` — Comments

Line 6:
```typescript
// Change:
// ... the self-hosted HL path that uses AsyncStorage (`harmony_jwt`).
// To:
// ... the self-hosted path that uses AsyncStorage (`soulbits_jwt`).
```

## Test Fixture Files

Update the `HarmonyLinkMockServer.ts` test data and the inline test fixture data in all integration test files.
