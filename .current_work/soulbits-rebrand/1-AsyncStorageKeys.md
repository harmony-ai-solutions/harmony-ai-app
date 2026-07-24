# Phase 1: AsyncStorage Key Migration

> **Goal**: Rename all Harmony Link AsyncStorage keys to Soulbits Engine naming.
> **⚠️ Requires migration strategy**: Existing users have saved state under old keys.

## Context

The app stores pairing state, JWT tokens, and connection settings in AsyncStorage (persistent key-value store on mobile). These keys are hardcoded as string literals throughout the codebase.

## Files to Modify

### 1. `src/services/ConnectionStateManager.ts` — Storage keys definition

**Current keys (all need renaming):**

| Current Key | New Key |
|-------------|---------|
| `harmony_jwt` | `soulbits_jwt` |
| `harmony_ws_url` | `soulbits_ws_url` |
| `harmony_wss_url` | `soulbits_wss_url` |
| `harmony_server_cert` | `soulbits_server_cert` |
| `harmony_token_expires_at` | `soulbits_token_expires_at` |
| `harmony_device_id` | `soulbits_device_id` |
| `last_sync_timestamp` | (keep — not harmony-specific) |
| `harmony_connected` | `soulbits_connected` |
| `harmony_paired` | `soulbits_paired` |
| `harmony_security_mode` | `soulbits_security_mode` |

**Migration logic needed** — in `initialize()`, read old keys and migrate to new keys on first launch after update:

```typescript
// Migration from old keys
const oldKeys = ['harmony_jwt', 'harmony_ws_url', /* ... */];
for (const oldKey of oldKeys) {
  const val = await AsyncStorage.getItem(oldKey);
  if (val) {
    const newKey = oldKey.replace('harmony_', 'soulbits_');
    await AsyncStorage.setItem(newKey, val);
    await AsyncStorage.removeItem(oldKey);
  }
}
```

### 2. `src/services/SyncService.ts` — JWT/URL storage writes

Lines 228-249 write to old key names:
- `'harmony_jwt'` → `'soulbits_jwt'`
- `'harmony_wss_url'` → `'soulbits_wss_url'`
- `'harmony_server_cert'` → `'soulbits_server_cert'`
- `'harmony_token_expires_at'` → `'soulbits_token_expires_at'`

### 3. `src/services/websocket/InsecureSSLWebSocketConnection.ts` — Reads JWT

Line 17: `'harmony_jwt'` → `'soulbits_jwt'`

### 4. `src/services/websocket/SecureWebSocketConnection.ts` — Reads JWT

Line 33: `'harmony_jwt'` → `'soulbits_jwt'`

### 5. `src/screens/SettingsScreen.tsx` — Reads URLs

Lines 39-40: `'harmony_ws_url'` and `'harmony_wss_url'` → `'soulbits_ws_url'` and `'soulbits_wss_url'`

## References

- `src/services/ConnectionStateManager.ts` (keys definition, comments, all consumers)
- `src/services/SyncService.ts` (write paths)
- `src/services/websocket/InsecureSSLWebSocketConnection.ts` (read path)
- `src/services/websocket/SecureWebSocketConnection.ts` (read path)
- `src/screens/SettingsScreen.tsx` (read path)
