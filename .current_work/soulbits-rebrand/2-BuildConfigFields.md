# Phase 2: Build Config Fields (Gradle + react-native-config)

> **Goal**: Rename `HARMONY_LINK_WSS_URL` and `HARMONY_LINK_WS_URL` build config fields to `SOULBITS_ENGINE_WSS_URL` / `SOULBITS_ENGINE_WS_URL`.

## Files to Modify

### 1. `android/app/build.gradle` — Build Config Fields

Lines 101-106, 113-114:

```groovy
// Change from:
buildConfigField "String", "HARMONY_LINK_WSS_URL", "\"${project.findProperty('HARMONY_LINK_WSS_URL') ?: ''}\""
buildConfigField "String", "HARMONY_LINK_WS_URL", "\"${project.findProperty('HARMONY_LINK_WS_URL') ?: ''}\""
// To:
buildConfigField "String", "SOULBITS_ENGINE_WSS_URL", "\"${project.findProperty('SOULBITS_ENGINE_WSS_URL') ?: ''}\""
buildConfigField "String", "SOULBITS_ENGINE_WS_URL", "\"${project.findProperty('SOULBITS_ENGINE_WS_URL') ?: ''}\""
```

Also update the Gradle property names in comments:
- `-PHARMONY_LINK_WSS_URL=wss://10.0.2.2:28443` → `-PSOULBITS_ENGINE_WSS_URL=wss://10.0.2.2:28443`
- `-PHARMONY_LINK_WS_URL=ws://10.0.2.2:28080` → `-PSOULBITS_ENGINE_WS_URL=ws://10.0.2.2:28080`

### 2. `src/types/react-native-config.d.ts` — Type Declarations

```typescript
// Change:
HARMONY_LINK_WSS_URL?: string;
HARMONY_LINK_WS_URL?: string;
// To:
SOULBITS_ENGINE_WSS_URL?: string;
SOULBITS_ENGINE_WS_URL?: string;
```

### 3. `src/services/ConnectionStateManager.ts` — Config references

Lines 182-183:
```typescript
// Change:
const e2eWssUrl = Config.HARMONY_LINK_WSS_URL;
const e2eWsUrl = Config.HARMONY_LINK_WS_URL;
// To:
const e2eWssUrl = Config.SOULBITS_ENGINE_WSS_URL;
const e2eWsUrl = Config.SOULBITS_ENGINE_WS_URL;
```

Also update all comments referencing `HARMONY_LINK_WSS_URL` / `HARMONY_LINK_WS_URL`.

### 4. `.env.example` — Env var names

```bash
# Change:
# HARMONY_LINK_WSS_URL=wss://10.0.2.2:28443
# HARMONY_LINK_WS_URL=ws://10.0.2.2:28080
# To:
# SOULBITS_ENGINE_WSS_URL=wss://10.0.2.2:28443
# SOULBITS_ENGINE_WS_URL=ws://10.0.2.2:28080
```

### 5. `e2e/.env.e2e` — E2E env

```bash
# Change:
HARMONY_LINK_WSS_URL=wss://10.0.2.2:28443
HARMONY_LINK_WS_URL=ws://10.0.2.2:28080
# To:
SOULBITS_ENGINE_WSS_URL=wss://10.0.2.2:28443
SOULBITS_ENGINE_WS_URL=ws://10.0.2.2:28080
```

Also update all comments referencing HARMONY_LINK_WSS_URL/WS_URL.

### 6. `e2e/.env.e2e.ios` — iOS E2E env

Same change as above.

### 7. `e2e/build-apk.sh` and `e2e/build-apk.ps1` — Build scripts

If present, update the `-P` flag names from `-PHARMONY_LINK_*` to `-PSOULBITS_ENGINE_*`.

## References

- `android/app/build.gradle:101-106,113-114`
- `src/types/react-native-config.d.ts:31,41`
- `src/services/ConnectionStateManager.ts:147,182-183,188`
- `.env.example`
- `e2e/.env.e2e`
- `e2e/.env.e2e.ios`
