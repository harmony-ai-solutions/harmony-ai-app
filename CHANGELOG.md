# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased - 0.1.0]

### Chat & Messaging

#### Fixed
- Fixed audio messages loading incorrect audio data after reconnection
  - All audio bubbles now load their own audio only when explicitly tapped for playback
  - Eliminates race condition where concurrent mount-time preloads corrupted the shared audio queue
- Audio message duration is now correctly shown before playback begins
  - Duration is automatically detected from the audio data and stored when messages are received

#### Added
- Real-time chat interface with AI characters
- Text messaging with send/receive capabilities
- Audio messages with automatic transcription support
  - Record voice messages with one-tap microphone button
  - Automatic transcription via Harmony Link STT module
  - Edit transcription before sending
  - Send audio + text to chat partners
- Image message support with send/receive capabilities
- Message history with persistent storage
- Typing indicators showing when partner is composing a message
- Chat list showing all conversations with last message preview
- Entity selection for roleplay identities
  - Choose which entity identity to use per conversation
  - Preferences saved automatically for each chat partner
  - Smart defaults favoring "user" entity

#### Fixed
- Fixed crash when attempting to record audio messages without microphone permission
- Added proper runtime permission handling for audio recording on Android
- Improved user feedback when microphone permission is denied
- Added visual indication of microphone permission state
- Fixed audio message transcription showing infinite loading animation after timeout or disconnection
- Added transcription timeout detection (30-second timeout) with visual feedback
- Added retry button for failed audio transcriptions
- Automatic cleanup of pending transcriptions when session disconnects

### Harmony Link Integration

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
  - Manual sync trigger with progress tracking
- Connection status monitoring
  - Visual connection indicators
  - Real-time status updates (Connected/Disconnected/Reconnecting)
  - Automatic reconnection with exponential backoff
  - Countdown timer for next reconnection attempt
- Device management
  - Unpair device option
  - Clear all pairing data and credentials

### Theming & Personalization

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

### Data Storage & Security

#### Added
- Encrypted local database with SQLCipher
  - 256-bit encryption for all stored data
  - Secure key storage via device keychain
  - Hardware-backed encryption when available
- Character profile storage
  - Character names, personalities, and attributes
  - Character avatars with image support
  - Character card fields (creator, version, tags)
- Message persistence
  - Complete chat history storage
  - Audio data embedded in messages
  - Image messages with BLOB storage
  - Message metadata (timestamps, sender info)
- Settings and preferences storage
  - Connection credentials (encrypted)
  - Theme preferences
  - Per-chat entity preferences
  - Last sync timestamps

### User Interface

#### Added
- Bottom navigation with tabs
  - Chats tab (conversation list)
  - Characters tab (placeholder for future features)
- Hamburger menu (settings) accessible from all main screens
- Settings screens
  - Appearance & Theme settings
  - Data Synchronization settings
  - Connection Setup screen
  - Theme Editor screen
- Chat interface
  - Message bubbles with sender differentiation
  - Character avatars in messages
  - Timestamp display with smart formatting (today/yesterday/date)
  - Scrollable message history
  - Keyboard-aware input area
  - Connection status indicator in header
- Empty state messages
  - Helpful prompts when no conversations exist
  - Connection guidance when not paired
  - Visual icons for better user guidance

### User Experience

#### Added
- Pull-to-refresh on chat list
- Real-time message updates without manual refresh
- Toast notifications for important events
  - Connection status changes
  - Sync completion
  - Message send confirmations
  - Error notifications
- Loading indicators
  - Database initialization screen
  - Message loading spinners
  - Sync progress display with record counts
- Offline awareness
  - Clear indication when not connected
  - Graceful degradation of features requiring connection
  - "Connect Now" prompts with direct navigation
- Smart time formatting
  - "Just now" for recent messages
  - "Yesterday" for previous day
  - Day names for last week
  - Dates for older messages

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
