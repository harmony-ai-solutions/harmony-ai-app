# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased - 0.1.0]

### Security & Configuration
#### Added
- Environment-aware Google OAuth secret wiring: OAuth client IDs are no longer hardcoded in tracked files. A loader (`scripts/oauth-secrets.cjs`) reads the gitignored GCP `client_secret_*.json` per environment (`dev`/`prod`) and generates the derived build config (`.env` + Android `gradle-secrets.<flavor>.properties`). `npm run oauth:dev` / `npm run oauth:prod` expose this; the `android`, `ios`, `start`, and E2E build scripts auto-load. The runtime config now exposes the active environment (`APP_ENV`/`APP_ENVIRONMENT`) for dev/prod awareness.

### Cloud Integration
#### Added
- Device authorization is now one click away: the emailed **Authorize device** button (or opening the link on the phone) authorizes a new device automatically, and the in-app verification screen continues on its own once it is approved. The manual 6-digit code entry remains as fallback.
- Cloud connection now polls the session broker until the secure session is ready, showing a multi-stage progress indicator (Requesting → Preparing → Establishing → Connected ✓ / failed + retry). Chat list and settings correctly reflect cloud vs self-hosted connection state.
- Soulbits Cloud login: email/password, Google Sign-In (Android), and Apple Sign-In (iOS).
- Cloud connection via the Soulbits conduct proxy; switch between self-hosted Harmony Link and Soulbits Cloud.
- Tier-1 roaming sync: per-source lastSync, standard upsert-by-PK across UUID-keyed config tables, switch-warning UX.
- Proactive PASETO refresh using `TokenResponse.expires_at`; reactive refresh on WebSocket close (1008/4401).
- Logout instantly invalidates the PASETO server-side via Valkey cutoff.
- Build flavours: Android `dev`/`prod` productFlavors; iOS dev/prod via CI build-matrix (react-native-config `.env` + bundle-ID override).
- Soulbits Cloud module configs now auto-fill the inference endpoint (`base_url`) with the correct beta-aware API URL when the app is connected to the cloud (beta builds use `https://beta.api.soulbits.app`). Previously the field always showed the production URL, even in beta builds.
- Soulbits Cloud model picker: when configuring a Soulbits Cloud provider, the model field is now a dropdown pre-filtered to the models valid for that module type (text LLM, Whisper for STT, TTS, embeddings, image, etc.). The list is fetched live from the public model catalog, with a cached static fallback when offline, and a free-text override for advanced entry.
- FormField `select` fields (e.g. OpenAI/xAI `reasoning_effort`, Google/xAI aspect ratios) are now real interactive themed dropdowns instead of read-only disabled text inputs.
- **Reset Cloud Data** in Settings → Data Synchronization (cloud mode only): a destructive card that permanently deletes your cloud-side engine data via `POST /v1/session/data/delete`. It requires a type-to-confirm step, runs with bounded retries while surfacing the server's typed status (in-progress / snapshot-busy / confirmation-required / purge-in-progress), and suppresses reconnect churn with a toast while the purge is active.
#### Changed
- Cloud session provisioning is now fully asynchronous — the session broker returns immediately and the app polls until ready. Removed the client-side connect-timeout hack; WebSocket connectivity is tracked separately from the broker session status. Consecutive WebSocket failures (5) trigger a fresh broker re-provision. Token-expiry pre-check runs before every cloud WebSocket dial to prevent expired-PASETO reconnect loops.
- Cloud session broker requests (connect/disconnect polling) now go through the first-party Soulbits API client. The client is wired in PASETO-only mode so token refresh on 401 stays with the app's auth layer — keeping one persisted, broadcast credential for both REST and WebSocket paths.
- The first-party Soulbits API client is now pulled directly from its GitHub repository as a dependency, replacing a local folder link. This makes installs consistent and reproducible across developer machines and CI.
- Soulbits Cloud is now listed as a provider for every module that supports it — including Speech-to-Text (STT), Voice Activity Detection (VAD), Text-to-Speech (TTS), and RAG — so the provider picker is consistent with the model catalog. The VAD model picker now filters to actual voice-activity models (e.g. silero-vad).
- Module configuration now has a compact Simple vs Advanced segmented toggle (remembered across sessions). Simple mode shows only the essentials (provider, model, credentials); Advanced mode reveals the full sampling/limit fields. When a managed Soulbits Cloud provider is selected in cloud mode, the endpoint and API key/token fields are hidden entirely because they are auto-synced from the backend.
- Module config selectors no longer show a trailing "+" button per module. "Create new config…" now lives as the last row inside the module picker sheet, and the pencil edit icon still appears beside the selector when a config is selected.

### Characters
#### Added
- Import Tavern Card V1/V2/V3 character cards from raw JSON or PNG-embedded (`chara`/`ccv3` `tEXt`/`iTXt` chunks) files. Imported cards are mapped to the existing character profile model (with the PNG used as the primary avatar) and persist locally, syncing through the normal pipeline. Reachable from the Characters screen header.
- Character cards on the Characters screen now have a chat button that opens a direct chat with that character. If no AI entity exists for the profile yet, one is created and synced automatically before the chat opens.
- AI Lifecycle editor on the character profile: configure the autonomous-beat defaults (autonomy, beat schedule, sleep & exhaustion, emotion decay, crystallization, memory) that new AI characters inherit from the profile. Each section has a tap-to-expand explanation, and a banner notes these are profile defaults that can be overridden per character.
- The Characters screen now supports **favorites** and **custom categories** for organizing AI characters. A filter chip row under the search bar offers **All**, **Favorites**, and any user-created categories; a **"Manage categories"** chip opens a sheet to create, rename, or delete categories. **Long-pressing a character card** now opens a quick-action sheet with **Add to category** and **Delete** (delete keeps the confirmation dialog). Each character card also has a heart button to toggle favorites. The organization data lives in client-only tables and is never synced to the engine.
- The **Create AI Partner** screen is now split into three sections: **General** (name — required, description, avatar), **Details** (personality, appearance, backstory, plus **Voice & Behavior** — voice characteristics, typing speed, audio response chance), and **Advanced** (AI model, voice, and config module pickers). The **Details** and **Advanced** cards are collapsible dropdowns so the essential General section stays front and center. The user can start chatting with just a name — when no module config is selected, Soulbits Cloud default configs (LLM, TTS, STT, vision, RAG, etc.) are created automatically in the background so the partner is chat-ready out of the box. Two action buttons sit side by side at the bottom: **Save** (persists the character without starting a chat) and **Start Chatting** (persists and jumps straight into a conversation).
- **Duplicate an AI partner**: tapping an existing AI character card now opens a sleek 3D Vertical/Perspective **Cover Flow carousel** listing every partner as a stacked, tappable deck — the active center card is highlighted at full scale with an elevated neon glow while preceding/following cards are angled, scaled down and recessed along the Z-axis (glassmorphism dark aesthetic, portrait avatar, name, persona tag, live search, springy sheet entrance). Swipe left/right to flip through the deck, or tap any card to smoothly bring it to the center focus and select it. Picking one opens the **Create AI Partner** screen as a full copy — the name is auto-numbered ("Aria" → "Aria 02", "Aria 03", …), and all details, voice settings, the primary avatar, and the module configuration (AI model, voice, config) carry over. The copy is fully editable and can be saved or started chatting immediately.
- Tapping a character card no longer opens the profile editor directly — it opens the duplicate picker. **Editing** a profile now lives in the long-press context menu (Edit Profile), which also keeps **Add to category** and **Delete**.
- **AI character profile page**: tapping an AI character card now opens the character's own profile screen, mirroring the user's My Profile layout — the AI's avatar, name, description, a primary **Chat** button (opens a direct conversation with the character), small rounded **Like** and **Save** buttons, a stats row showing **Likes** and **Chats**, an icon tab bar with **Images** and **Copies**, and a **creator badge** (the avatar + name of the user who created the AI, tappable to open the creator's profile). The **Chats** stat counts distinct users who have chatted with the character (1 per user), not chat sessions or individual messages.
- The AI profile's **Images** tab now renders every gallery image — including the avatar — as a **post** with **Like** and **Comment** buttons. Any user can like an image or leave a comment; like counts and the comment thread (with author names and avatars) are visible to everyone.
- On the AI profile, **Edit Profile** and **Edit AI Settings** are now merged into a single **Edit AI Profile and Settings** button (shown above the Chat button) that opens the full AI configuration screen. It appears **only for the creator** of the character — other users never see editing controls for characters they don't own. The creator check now also works for user-created characters in self-hosted mode and legacy characters, and the "Created by …" badge (with the creator's avatar) is always shown for user-created characters. Tapping the creator badge now pushes the My Profile screen on top so going back returns to the AI profile you were on, instead of dropping you to the previous tab.
- **Save an AI character**: the bookmark button on the AI profile saves the character, and saved characters appear in **My Profile → Saved** as avatar + name tiles that open the AI's profile.
- The AI profile's **Likes** stat now also includes character profile likes (from the heart button), alongside the existing chat-reaction likes.
- **From an Existing One** now creates a **full copy** of the chosen character — same info, avatar and settings — with an auto-numbered name ("Max" → "Max 2", "Max 3", …). The "From an Existing One" option is hidden entirely when the user has no existing characters.
- Saving a character without starting a chat no longer waits for a full engine sync (which could take up to 45s); the save returns immediately and the entity is synced in the background.
- The **Create AI Partner** screen now has a **Public AI / Private AI** toggle under the General section. Public partners are visible and searchable on the **Discover** screen (both community characters and your own public partners); private partners are hidden from Discover and search entirely. The setting is persisted per character and can be changed later when editing a partner.
- **Deleting an AI character now works** — previously the delete button failed because every AI character is linked to a chat entity, and the soft-delete guard refused to delete a profile still in use. Deleting now cascades: it soft-deletes the linked entity (and its chats/memories/settings) first, then the profile. A confirmation toast shows the deleted character's name.
- Tapping an AI character card on the **Discover** screen now opens the character's **AI profile page** (viewing) instead of the edit screen — editing stays in the long-press menu on the Characters screen.
#### Changed
- Character profile editor section order now matches the desktop UI: Images appear right after the identity/persona basics, the AI Lifecycle section sits after the Lorebook, and Attribution is last.
- The lorebook entry editor no longer shows the Advanced (export-only) fields; name and comment now appear above the content. Existing advanced data is still preserved when saving and exporting.
- The "Advanced" profile section is now labelled "AI Behaviour".
- The Characters screen **＋ button** now opens a "New AI Partner" sheet instead of a speed-dial menu. It asks how you'd like to create the partner — **New AI Partner** (opens the Create AI Partner wizard), **From an Existing One** (opens the card picker to pick an existing character profile, then opens the Create AI Partner wizard with that profile linked), or **Import Character Card** (existing PNG/JSON import).
- The "No config selected — Soulbits Cloud defaults" hint on the Create AI Partner screen now appears at the **top** of the Advanced section (above the module pickers) instead of at the bottom.
- The "Manage categories" sheet no longer shows a per-category plus button that expanded a character-member list. Assigning characters to categories is now done exclusively from a character card's **Add to category** action.
- The AI profile **Chats** stat now counts **1 per distinct user** who has chatted with the character, instead of one per chat session. Re-opening a conversation with the same AI no longer inflates the count. A duplicated character (a copy) is fully independent and its chat count starts at 0.
- The **My AI Characters** screen now has a **sort button** in the header to order characters alphabetically (A–Z), newest first, or oldest first.
- The **Chats** screen **＋ button** now opens a character picker listing your AI characters (with search + a per-row chat icon) instead of jumping straight to the Create AI Partner wizard.
- The AI profile now shows a **Follow / Following** button on the creator badge (for creators other than yourself).
- AI character image posts now show a **date/time** caption under the image.
- Added a **Notifications** bell to the header of the principal screens (Characters, Chat, Discover, Market, My Profile) with an unread badge. The feed shows follows, AI profile likes, AI image likes/comments, and post likes/comments.
- **My Profile → Posts** now supports publishing **text and/or image posts** (via a ＋ button) with Like and Comment buttons; posts appear on the Discover screen as a "Recent Posts" section with the author's avatar + name, and tapping the author opens their profile.

### Profile
#### Added
- Full **My Profile** screen in the profile tab: gradient-ring avatar, display name with the username underneath (small, non-bold), an Edit Profile button, a stats card (Followers · Following · AI Characters), a bio block, and three sections — **AI Characters**, **Posts**, and **Saved**.
- The **Saved** section of My Profile now lists the AI characters you saved from their AI profile (avatar + name tiles that open the AI's profile).
- **Edit Profile** screen to set the display name, username, bio and a locally-stored avatar (picked from the photo library). The editable extras persist per cloud account via local storage until the backend exposes a profile-update endpoint.
- **Personas**: the profile now lists the identities the user chats as (the "Chatting as" concept). Each persona shows its avatar, name and description, can be set as the active chat identity, and opens a dedicated **Persona** editor where the name, description, personality and picture can be managed — or a new persona created. Personas are stored independently of AI characters (a dedicated client-only table) and carry only identity fields — they have no AI models, module configs, or character profiles. AI characters (the entities the user chats with) are never shown as personas and keep their full AI configuration.
- After a successful sign-in (email/password, Google, or Apple), the app now takes the user straight to their **My Profile** page.

### Navigation
#### Changed
- The **Haptic feedback** Settings toggle now actually controls tactile feedback: when turned off, button presses across the app no longer vibrate. The preference is applied at startup and takes effect immediately when toggled.
- Haptic feedback (a light double-tap pulse) is now triggered on all primary buttons across the app, including the new profile pills (Edit Profile / New Persona), the Characters "New AI Partner" sheet actions, character-card chat and favorite buttons, chat send/mic/stop controls, save buttons on edit screens, and modal action buttons.
- The Characters tab is now labeled **Characters** on the bottom navigation bar (was "My Characters").
- The Settings screen is no longer a bottom tab. It is now opened from a "three lines" (☰) menu button in the header of every primary screen, which opens the full Settings screen. The bottom tab bar now contains Chat, Discover, Characters, and Market only.
- The "Chatting as" persona pill and its adjacent identity-settings (⚙) button were removed from the Chat list header. The underlying persona selection feature and its components are preserved for reuse on another screen; the selected persona still determines which conversations appear in the Chat list.
- The "My Identity Settings" entry in the chat screen (which opened the AI module editor for the persona) has been replaced with **My Personas** — a switcher that lists the user's personas and lets them pick a different one or create a new one. Switching personas shows an in-chat confirmation row ("Now chatting as …") styled like the chat's divider text. Personas only carry identity fields; AI module configuration remains on the partner character.
- Removed the dedicated Search tab. The Discover tab now includes a search bar and displays the user's AI characters in a two-column grid, so browsing and searching happen on one screen. Tapping a card opens its profile, and the chat button starts a conversation with that character.
- Discover now shows **AI characters created by other users** (characters synced down from the engine). The current user's own characters — created through "Create AI", the profile editor, or imported character cards — are hidden from their own Discover grid (tracked via a client-only source tag that never affects engine sync), while remaining fully available on the Characters screen and still syncing up so other users can discover them.
- All empty states across the app now share the Market screen's premium design — a gradient-ringed icon with a bold title and muted hint, consistently sized and positioned right below the header. This covers the "no conversations", "no characters/profiles", "no search results", "not paired / cloud preparing", "no entities", and emoji search empty states.
- Removed the dedicated "AI emoji actions" editor screen (and its "advanced emoji actions" button in the chat emoji picker). Emoji actions still resolve automatically when sending messages; only the per-entity editor UI was removed.

### Security & Privacy

#### Added
- Biometric/PIN app lock: optionally require fingerprint, face, or a 4–6 digit PIN to unlock the app.
  - Automatically locks when the app moves to the background and prompts to unlock on return.
  - Biometric unlock with a PIN fallback, or PIN-only when biometrics are unavailable.
  - A "Test Lock" action in the lock settings lets you preview the unlock experience.

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
- Tapping the AI partner's avatar or name in the chat header now opens the character's AI profile page

#### Changed
- The chat screen's bottom input bar (text field with send, emoji, image, and microphone buttons) has been removed. The chat now displays messages only; the message long-press action sheet no longer includes the "Reply" action.
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
- The chat input bar and keyboard no longer overlap the Android system navigation buttons. On devices where the app runs edge-to-edge (React Native New Architecture), the input bar is now pushed above the on-screen keyboard while typing instead of being covered by it.

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
- All toast notifications now use the app's branded themed toast (obsidian-glass pill) on every platform — the last remaining OS-native Android toast (used for connection/sync status) was replaced, so connection status, sync completion, message confirmations, and errors all share one consistent design
- Settings menu reorganized into sub-menus to reduce clutter on the main Settings screen
  - Account & Security and Billing & Purchases grouped under an "Account" sub-menu
  - Appearance options (theme, language, font size, app icon) grouped under an "Appearance" sub-menu
  - AI & Conversation options grouped under their own sub-menu
  - Support & Legal options grouped under a "Help & Support" sub-menu
  - Frequently used controls (Connection status, Sync status, Notifications toggles) remain directly on the main Settings screen
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
