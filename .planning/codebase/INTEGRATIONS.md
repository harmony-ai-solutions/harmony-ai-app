# External Integrations

**Analysis Date:** 2026-03-05

## Primary Integration

**Harmony Link (Backend):**
- Primary integration point - all AI capabilities provided through Harmony Link
- Connection via WebSocket (ws:// or wss://)
- Configured in: `src/screens/settings/SyncSettingsScreen.tsx`
- Connection management: `src/services/connection/ConnectionManager.ts`
- Sync service: `src/services/SyncService.ts`

**Harmony Cloud:**
- Optional cloud backend (future)
- Not currently implemented

## Data Storage

**Database:**
- SQLite (react-native-sqlite-storage 6.0.1)
- Database name: `harmony.db`
- Location: App's document directory
- Encryption: SQLCipher with 256-bit key stored in device keychain
- Connection: `src/database/connection.ts`
- Schema: `src/database/migrations/` (11 migrations)

**File Storage:**
- Local filesystem only (react-native-fs 20.0.0)
- Audio files, images stored in app's document directory
- No cloud storage integration

**Caching:**
- @react-native-async-storage/async-storage for key-value caching
- Stores: JWT tokens, WebSocket URLs, server certificates, user preferences

## Authentication & Identity

**Auth Provider:**
- Custom JWT-based authentication with Harmony Link
- JWT stored in AsyncStorage (`harmony_jwt` key)
- WebSocket connections use Bearer token in Sec-WebSocket-Protocol header

**Secure Storage:**
- React Native Keychain for sensitive data
- Database encryption key stored in keychain
- Service: `com.harmonyai.database`

## Monitoring & Observability

**Error Tracking:**
- Not detected - No external error tracking service integrated

**Logs:**
- react-native-logs 5.5.0 - Structured logging
- Log output to console in development
- Custom logger in `src/utils/logger.ts`

## CI/CD & Deployment

**Hosting:**
- Not applicable - Mobile app distributed via app stores

**CI Pipeline:**
- Not detected - No CI/CD configuration found

## Environment Configuration

**Required env vars:**
- None detected - All configuration stored in-app

**Secrets location:**
- Provider API keys: SQLite database (`provider_config_*` tables)
- Database encryption key: Device keychain
- JWT tokens: AsyncStorage

## Webhooks & Callbacks

**Incoming:**
- WebSocket connections from Harmony Link devices
- Connection modes: unencrypted (ws://), secure (wss://), insecure-ssl (for self-signed certs)
- Endpoints configured by user in settings

**Outgoing:**
- WebSocket connections to sync server and entity sessions
- No HTTP webhooks detected

## Future Integrations (Not Yet Implemented)

**AI Providers (On-Device Mode):**
- Database tables exist for future AI provider configuration:
  - `provider_config_openai` - OpenAI API
  - `provider_config_ollama` - Local Ollama
  - `provider_config_openaicompatible` - Custom OpenAI-compatible endpoints
  - `provider_config_openrouter` - OpenRouter aggregator
  - `provider_config_mistral` - Mistral AI
- Repository: `src/database/repositories/providers.ts`
- UI: `src/screens/AIConfigScreen.tsx` (currently non-functional)
- These are placeholders for Phase 2 "On-Device AI model integration"

## Special Integration Notes

**Harmony Link Sync:**
- Local network device pairing via WebSocket
- Certificate-based secure connections supported
- Multiple concurrent entity sessions supported
- See `src/services/SyncService.ts` and `src/services/connection/ConnectionManager.ts`

**Audio Processing:**
- react-native-audio-record for voice input
- react-native-track-player for audio playback
- music-metadata for audio file parsing

---

*Integration audit: 2026-03-05*
