# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased - 0.1.0]

### Chat & Messaging

#### Added
- Real-time chat interface with AI characters
- Text messaging with send/receive capabilities
- Audio messages with automatic transcription support
  - Record voice messages with one-tap microphone button
  - Automatic transcription via Harmony Link STT module
  - Edit transcription before sending
  - Send audio + text to chat partners
- Image message support with send/receive capabilities (UI not fully complete)
- Message history with persistent storage
- Typing indicators showing when partner is composing a message
- Chat list showing all conversations with last message preview
- Entity selection for roleplay identities
  - Choose which entity identity to use per conversation
  - Preferences saved automatically for each chat partner
  - Smart defaults favoring "user" entity
- Per-chat-partner reply mode toggle (instant vs. realistic reply times)
  - "Realistic" mode introduces a simulated typing delay matching average human response time
  - "Instant" mode delivers replies immediately without delay
  - Preference persisted per chat partner via AsyncStorage
  - Defaults to "realistic" when no preference is stored
  - Reply mode sent as `reply_mode` capability during session initialization (`INIT_ENTITY`)
- Resume sessions on disconnect with dangling event synchronization
  - Sessions are automatically resumed when connection is re-established
  - Backend re-fires any events that were queued during disconnection
  - Session resume indicated via `resumed: true` flag in `INIT_ENTITY` response
- Emoji picker with three configurable emoji sets (Native, Twemoji, Noto)
  - Full-screen modal with category tabs and search
  - Inline compact variant for chat input use
  - Skin tone selector with 5 modifier options
  - Keyword-based emoji search
  - Emoji autocomplete in chat input
- Emoji-aware text rendering in chat bubbles
  - Intelligent text/emoji segmentation via `EmojiAwareText`
  - Sprite-based emoji display with caching via `EmojiText`
  - Cross-set style preference persistence
- Emoji Action system for per-entity emoji behavior
  - Entity-level emoji-to-action mappings stored in dedicated database table
  - Each emoji can trigger emotion effects on the target entity
  - Emotion effects based on the Ekman8 emotion model (joy, sadness, trust, disgust, fear, anger, surprise, anticipation)
  - Signed intensity deltas (-5.0 to +5.0) for each emotion per emoji
  - Action definitions include optional style customization and cooldown
- Emoji Action editor screen for entity-level management
  - Action list with enable/disable toggle per emoji
  - Action creation and editing modals
  - Per-emoji emotion effect customization
- Message send pipeline integration for emoji actions
  - Outgoing messages scanned for emoji with configured actions
  - `AdditionalEffects` payload generated and sent with `SEND_MESSAGE` events
  - Emotion effects delivered to Harmony Link for entity state updates
- Database migrations for emoji actions (022–023)
- Emoji action synchronization over WebSocket sync pipeline
- Emoji style preferences persisted via AsyncStorage
- Interaction system for session management
  - Interaction data model mirroring Harmony Link Go struct with fields: id, entity_id, scope, participant_key, participant_ids, status, presence_type, summary, memory_id, continued_interaction_id
  - Scope types: "world" (0-1 participants), "private" (2 participants), "group" (3+ participants)
  - Participant key derivation: alphabetically sorted entity ID pairs for deterministic lookup
  - Presence type: "phone" for chat interactions
  - Interaction repository with full CRUD: `getInteractionById`, `getInteractionByParticipantKey`, `createInteraction`, `updateInteraction`, `getActiveInteractionsByEntity`, `getRecentPhoneInteractions`, `entityHasPhoneInteraction`, `getLastInteractionMessage`
- Database migrations for interaction system (024–028)
- JOIN-based query for chat list last message preview (`conversation_messages JOIN interactions`)
- Interaction sync integration over WebSocket pipeline
- ChatListScreen adapted to InteractionSession model with JOIN-based interaction queries
- ChatDetailScreen refactored for InteractionSession lifecycle with reply mode toggle
- Force full database synchronization option in SyncSettingsScreen

#### Changed
- Refactored `DualEntitySession` to `InteractionSession` — session management is now interaction-scoped instead of entity-pair-scoped
  - `InteractionSession` interface: interactionId, interaction, participantIds, ownEntityId, per-connection status tracking
  - Events keyed by `interactionId` instead of `partnerEntityId`: `session:started`, `session:stopped`, `message:received`, etc.
  - Supports N participants per session (world/private/group scopes)
  - Navigation adapted to use `interactionId` for session lookup

#### Fixed
- Fixed audio messages loading incorrect audio data after reconnection
  - All audio bubbles now load their own audio only when explicitly tapped for playback
  - Eliminates race condition where concurrent mount-time preloads corrupted the shared audio queue
- Audio message duration is now correctly shown before playback begins
  - Duration is automatically detected from the audio data and stored when messages are received
- Fixed crash when attempting to record audio messages without microphone permission
- Added proper runtime permission handling for audio recording on Android
- Improved user feedback when microphone permission is denied
- Added visual indication of microphone permission state
- Fixed audio message transcription showing infinite loading animation after timeout or disconnection
- Added transcription timeout detection (30-second timeout) with visual feedback
- Added retry button for failed audio transcriptions
- Automatic cleanup of pending transcriptions when session disconnects
- Chat list UI fixes for edge cases with interaction-based rendering
- Message ID handling consistency across send and receive flows
- Cleanup of deprecated methods from previous session management approach

### Harmony Link Integration & Device Sync

#### Added
- Device pairing system with Harmony Link backend
  - Initial handshake flow requiring approval on Harmony Link
  - JWT token-based authentication
  - Persistent pairing across app restarts
- Multiple security modes for connections
  - **Secure Mode**: Full SSL/TLS with verified certificates
  - **Trusted Certificate Mode**: Accept self-signed certificates
  - **Unencrypted Mode**: WebSocket without SSL (local networks only)
- Certificate verification with user choice
  - View certificate details before trusting
  - Option to switch between security modes
  - Reset security preferences
- Real-time data synchronization
  - Sync characters from Harmony Link
  - Sync messages and conversation history
  - Sync module and provider configurations
  - Sync interactions and emoji actions over WebSocket pipeline
  - Manual sync trigger with progress tracking
- Connection status monitoring
  - Visual connection indicators
  - Real-time status updates (Connected/Disconnected/Reconnecting)
  - Automatic reconnection with exponential backoff
  - Countdown timer for next reconnection attempt
- Device management
  - Unpair device option
  - Clear all pairing data and credentials

### User Interface & Experience

#### Added
- Dynamic theming system with instant switching
- 6 professionally designed built-in themes
  - **Classic Harmony**: Original dark theme with orange accents
  - **Midnight Rose**: Deep purples with pink highlights
  - **Forest Night**: Green and teal nature-inspired palette
  - **Ocean Breeze**: Blues and aqua for calm atmosphere
  - **Sunset Glow**: Warm oranges and amber tones
  - **Pure Dark**: Minimalist true black design
- Custom theme creation
  - Full color customization for all UI elements
  - RGB slider-based color picker overlay
  - Organized by category (Background, Accent, Status, Text)
  - Theme naming and descriptions
- Theme management
  - Import themes from JSON files
  - Export custom themes for sharing
  - Delete custom themes (built-in themes protected)
  - Theme preview cards with color swatches
- Theme persistence across app restarts
- Bottom navigation with tabs (Chats, Characters)
- Hamburger menu (settings) accessible from all main screens
- Settings screens (Appearance & Theme, Data Synchronization, Connection Setup, Theme Editor)
- Chat interface components
  - Message bubbles with sender differentiation and character avatars
  - Timestamp display with smart formatting (today/yesterday/date)
  - Scrollable message history
  - Keyboard-aware input area
  - Connection status indicator in header
- Empty state messages with helpful prompts and visual icons
- Styled entity context menu in chat screen (⋮ button)
  - Custom Modal with LinearGradient background, prismatic tint, accent stripe
  - Icon badge rows with chevron-right — matching SettingsMenu visual language
- Top bar headers on previously unheadered screens (ThemeSettings, ConnectionSetup, SyncSettings)
- Tappable settings cards for Connection and Sync with chevron-right hints
- Pull-to-refresh on chat list
- Real-time message updates without manual refresh
- Toast notifications for connection status, sync completion, message confirmations, errors
- Loading indicators (database initialization, message loading, sync progress)
- Offline awareness with clear indication and "Connect Now" prompts
- Smart time formatting ("Just now", "Yesterday", day names, dates)
- Safe area bottom insets applied to all scrollable screens for Android system navigation bar support
  - ChatInput, CharacterProfileEditScreen, CharactersScreen, ChatListScreen, CreateAIScreen
  - EntityConfigEditScreen, EntityConfigScreen, LandingScreen, SettingsScreen, ModuleConfigEditScreen

#### Changed
- "Reset Security Mode" button moved from SyncSettingsScreen to ConnectionSetupScreen
  - Button now appears alongside other connection management actions (Connect & Pair, Reconnect, Unpair Device)
  - Security mode display row remains in SyncSettingsScreen

### Data Management & Configuration

#### Added
- Encrypted local database with SQLCipher
  - 256-bit encryption for all stored data
  - Secure key storage via device keychain
  - Hardware-backed encryption when available
- Character profile storage (names, personalities, attributes, avatars, card fields)
- Message persistence (complete chat history, audio/image data embedded, metadata)
- Settings and preferences storage (encrypted credentials, themes, entity preferences, sync timestamps)
- Modular config infrastructure mirroring Harmony Link web frontend
  - `providerFieldSchemas.ts` — schema-driven field definitions for all provider types
  - `moduleConfiguration.ts` — module type definitions, provider options per module, and MODULES/PROVIDERS constants
  - `moduleDefaults.ts` — PROVIDER_DEFAULTS and MODULE_DEFAULTS for form initialization
  - `configHelpers.ts` — utility functions for provider field resolution
- Module config editor screen (`ModuleConfigEditScreen`) with inline provider config editing
  - Provider type selector chips with dynamic form field rendering
  - Dual-slot support: standard modules (single "provider" slot) and STT (dual "transcription"/"vad" slots)
  - Advanced Sampling Parameters for OpenAI-family providers
  - Provider config auto-created/updated during module config save via `saveProviderConfig()`
- Entity config integration with edit/create buttons on module selectors
  - `EntityModuleSelectorWithActions` wrapper component with ✏️ and ＋ buttons
- DB schema sync — migration 021: `sampling_preset_name` and `extra_params` columns
- Comprehensive type definitions for emoji system (`src/types/emoji.ts`)
- Database migrations for emoji actions (022–023) and interactions (024–028)

## Initial Bootstrap

### Added
- React Native 0.83.1 project foundation
- TypeScript configuration with strict mode
- Navigation system (React Navigation)
- Material Design 3 UI components (React Native Paper)
- Project structure and organization
- Development environment setup guides
- Android build configuration
- Basic app icon and branding

---

**Note**: This app is in active development. Features and functionality are being continuously added and improved. Version numbers will be assigned once the app reaches a stable release state.
