# External Integrations

**Analysis Date:** 2026-05-24

## Primary Integration

**Harmony Link (Backend):**
- Primary integration point - all AI capabilities provided through Harmony Link
- Connection via WebSocket (ws:// or wss://) with three security modes: unencrypted, secure (WSS with CA certs), insecure-ssl (self-signed certs)
- Connection management: `src/services/connection/ConnectionManager.ts`
- Connection state & JWT lifecycle: `src/services/ConnectionStateManager.ts`
- Sync service: `src/services/SyncService.ts`
- WebSocket protocol implementations in `src/services/websocket/`:
  - `BaseWebSocketConnection.ts` - Abstract base class
  - `SecureWebSocketConnection.ts` - WSS with CA-signed certificates
  - `InsecureSSLWebSocketConnection.ts` - WSS with self-signed certificates
  - `UnencryptedWebSocketConnection.ts` - Plain WS
  - `WebSocketConnectionFactory.ts` - Factory for connection creation
- Entity session management: `src/services/EntitySessionService.ts` (replaces old DualEntitySession)
- Participants have N+1 WebSocket connections per interaction (D-18)

**Connection Protocol:**
- JWT token obtained via HTTP handshake (stored in AsyncStorage key `harmony_jwt`)
- Bearer token sent in `Sec-WebSocket-Protocol` header during WebSocket upgrade
- Three connection lifecycle modes: pairing → JWT grant → WebSocket session
- Security mode per-device stored in AsyncStorage (`harmony_security_mode`)
- Auto-reconnect with exponential backoff capped at 30s for partner disconnects

**Event Flow:**
- `INIT_ENTITY` - Register an entity for a chat session
- `ENTITY_UTTERANCE` - Send/receive chat messages
- `ENTITY_UTTERANCE_EDIT` - Edit sent messages
- `STT_INPUT_AUDIO` / `STT_OUTPUT_TEXT` - Speech-to-text transcription
- `TYPING_INDICATOR` / `RECORDING_INDICATOR` - Presence indicators
- `SET_REPLY_MODE` - Toggle instant vs realistic reply mode
- `ENTITY_SESSION_END` - End a session
- `SYNC_*` - Database synchronization events

**Harmony Cloud:**
- Optional cloud backend (future)
- Not currently implemented - database table placeholders exist

## Data Storage

**Database:**
- SQLite via react-native-sqlite-storage 6.0.1
- Database name: `harmony.db`
- Location: App's document directory
- Encryption: SQLCipher with 256-bit key stored in device keychain (service: `com.harmonyai.database`)
- Connection: `src/database/connection.ts`
- Schema: `src/database/migrations/` (28 migrations, up from 11 in March 2026)

**New Tables Since March 2026:**
- `entity_emoji_actions` - Per-entity emoji-to-RP-text mappings with emotion effects and metabolism vectors
- `interactions` - Interaction session tracking with scope-aware indexing (world/private/group), presence_type, memory_id, continued_interaction_id

**Schema Changes Since March 2026:**
- `entities` - Added `alias` column (unique, human-readable name)
- `conversation_messages` - Added `is_recon_followup`, `is_edited`, `edit_of_message_id`; removed `session_id`; added `interaction_id`
- `provider_config_openai` - Added 10 LLM params (frequency_penalty, presence_penalty, max_completion_tokens, seed, response_format, reasoning_effort, top_k, top_a, min_p, repetition_penalty, sampling_preset_name, extra_params); dropped chat_template_kwargs
- `provider_config_openaicompatible` - Added 9+ LLM params; dropped chat_template_kwargs
- `provider_config_openrouter` - Added 9+ LLM params; dropped chat_template_kwargs

**File Storage:**
- Local filesystem only (react-native-fs 20.0.0)
- Audio files, images stored in app's document directory
- Emoji sprite sheets: `src/assets/emoji/sheets/google-64.png`, `twitter-64.png`
- No cloud storage integration

**Caching:**
- @react-native-async-storage/async-storage for key-value caching
- Stores: JWT tokens, WebSocket URLs (WS + WSS), server certificates, user preferences, global impersonated entity, reply mode preferences, last-read timestamps

## Authentication & Identity

**Auth Provider:**
- Custom JWT-based authentication with Harmony Link
- JWT stored in AsyncStorage (`harmony_jwt` key)
- Token expiry tracked in AsyncStorage (`harmony_token_expires_at`)
- WebSocket connections use Bearer token in Sec-WebSocket-Protocol header
- Connection state managed by singleton `ConnectionStateManager` (`src/services/ConnectionStateManager.ts`)
- States: paired/unpaired, connected/disconnected, token valid/expired, requires re-pairing

**Secure Storage:**
- React Native Keychain for sensitive data (service: `com.harmonyai.database`)
- Database encryption key stored in keychain
- JWT tokens and connection URLs stored in AsyncStorage (non-keychain, encrypted at rest by OS)

**Device Identity:**
- Device unique ID via `react-native-device-info` used during pairing
- Device ID used in INIT_ENTITY payload

## Monitoring & Observability

**Error Tracking:**
- Not detected - No external error tracking service integrated

**Logs:**
- react-native-logs 5.5.0 - Structured logging
- Custom logger in `src/utils/logger.ts`
- Log tags: `[ConnectionManager]`, `[ConnectionStateManager]`, `[EntitySessionService]`, `[EmojiService]`, `[SyncService]`, `[AudioPlayer]`, `[AudioRecorder]`

## CI/CD & Deployment

**Hosting:**
- Not applicable - Mobile app distributed via app stores

**CI Pipeline:**
- Not detected - No CI/CD configuration found

## Environment Configuration

**Required env vars:**
- None detected - All configuration stored in-app or synced from Harmony Link

**Secrets location:**
- Provider API keys: SQLite database (`provider_config_*` tables)
- Database encryption key: Device keychain
- JWT tokens: AsyncStorage (key `harmony_jwt`)
- Server certificate: AsyncStorage (key `harmony_server_cert`)
- Harmony Link WebSocket URLs: AsyncStorage (keys `harmony_ws_url`, `harmony_wss_url`)

## Webhooks & Callbacks

**Incoming:**
- WebSocket connections from Harmony Link devices
- Connection modes: unencrypted (ws://), secure (wss://), insecure-ssl (for self-signed certs)
- Endpoints configured by user in settings screen
- Event types handled: INIT_ENTITY responses, ENTITY_UTTERANCE, ENTITY_UTTERANCE_EDIT, STT_OUTPUT_TEXT, TYPING_INDICATOR, RECORDING_INDICATOR

**Outgoing:**
- WebSocket connections to Harmony Link sync server and per-entity session connections (N+1 per interaction)
- Entity session events: INIT_ENTITY, ENTITY_UTTERANCE, STT_INPUT_AUDIO, SET_REPLY_MODE, ENTITY_SESSION_END

## AI Provider Integration (On-Device Mode)

**Database tables exist for future AI provider configuration:**
- `provider_config_openai` - OpenAI API (now with 10+ LLM sampling parameters)
- `provider_config_ollama` - Local Ollama
- `provider_config_openaicompatible` - Custom OpenAI-compatible endpoints
- `provider_config_openrouter` - OpenRouter aggregator
- `provider_config_mistral` - Mistral AI
- Repository: `src/database/repositories/providers.ts`
- UI: `src/screens/AIConfigScreen.tsx` (currently non-functional)
- These are placeholders for Phase 2 "On-Device AI model integration"
- Migration 020 added per-provider LLM params (frequency_penalty, presence_penalty, top_k, top_a, min_p, repetition_penalty, etc.)
- Migration 021 added sampling preset names and extra_params (JSON); dropped deprecated chat_template_kwargs

## Special Integration Notes

**Emoji System:**
- Dual-data-source architecture: `@emoji-mart/data` for structure (categories, names, keywords), `emoji-datasource-twitter` for authoritative sprite sheet coordinates matching bundled PNGs
- Local sprite sheets: `src/assets/emoji/sheets/google-64.png`, `twitter-64.png`
- Service: `src/services/EmojiService.ts` (singleton, lazy-loaded)
- Per-entity emoji action mappings in `entity_emoji_actions` table
- Actions resolve emoji → RP substitution text with aggregated emotion effects (Ekman 8 emotions)
- Service: `src/services/EntityEmojiActionService.ts` (singleton, cached)
- 20 default emoji action seeds matching food/drink/emotion/action categories

**Harmony Link Sync:**
- Local network device pairing via WebSocket
- Certificate-based secure connections supported
- Multiple concurrent entity sessions supported (N+1 connections per interaction)
- Session persistence with JWT expiry tracking (auto-detects expired tokens, flags for re-pairing)
- Auto-sync triggers on session start, incoming messages, and explicit sync requests
- Partner auto-reconnect with exponential backoff (1s → 30s max, 5+ attempts)
- App background → all sessions closed gracefully
- See `src/services/SyncService.ts`, `src/services/EntitySessionService.ts`, `src/services/ConnectionStateManager.ts`

**Audio Processing:**
- Audio recording via `react-native-audio-record` (`src/services/AudioRecorder.ts`)
- Audio playback via `react-native-track-player` (`src/services/AudioPlayer.ts`) - binary TTS output
- STT transcription flow: record → store locally → send via WebSocket → receive text on callback
- 30-second transcription timeout with retry support
- music-metadata for audio duration parsing on incoming audio messages

**Chat Preferences:**
- Per-chat impersonated entity stored in AsyncStorage (`chat_entity_pref_*`)
- Global impersonated entity stored in AsyncStorage (`chat_global_impersonated_entity`)
- Per-chat reply mode (instant/realistic) stored in AsyncStorage (`chat_reply_mode_*`)
- Last-read timestamp tracking for unread indicators
- Service: `src/services/ChatPreferencesService.ts`

---

*Integration audit: 2026-05-24 (updated from 2026-03-05)*
