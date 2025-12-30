# Technical Context

## Technology Stack

### Core Framework
**React Native 0.83.1**
- Cross-platform mobile development
- JavaScript/TypeScript codebase
- Native performance
- Hot reload for rapid development
- Large ecosystem and community support

### Language
**TypeScript**
- Type safety for reduced bugs
- Better IDE support and autocomplete
- Improved code maintainability
- Self-documenting code through types

### Navigation
**React Navigation (Native Stack)**
- De-facto standard for React Native
- Native animations and gestures
- Deep linking support
- TypeScript integration
- Stack, tabs, and drawer patterns

### UI Library
**React Native Paper (Material Design 3)**
- Material Design components
- Theming system
- Dark mode support
- Accessibility built-in
- Consistent cross-platform UI

### State Management
**React Hooks (Current), Future: Redux/Zustand**
- useState, useEffect for local state
- Context API for shared state
- Future: Redux Toolkit or Zustand for complex state
- Async state management needs evaluation

### Data Persistence
**Current: AsyncStorage, Future: SQLite**
- AsyncStorage: Simple key-value storage
- Future SQLite: Relational database for messages/characters
- React Native SQLite Storage or WatermelonDB
- Sync strategy with Harmony Link backend

### Networking
**Planned: Axios + WebSocket**
- REST API calls via Axios
- Real-time updates via WebSocket
- Reconnection logic
- Request/response interceptors
- Error handling and retry logic

## Development Environment

### Prerequisites
- Node.js 18+
- npm or yarn
- JDK 17 (Java Development Kit)
- Android Studio
- Android SDK (API 33+)
- Git

### Build Tools
- Metro Bundler (React Native)
- Gradle (Android builds)
- Android SDK Platform-Tools
- Android SDK Build-Tools

### Development Tools
- TypeScript Compiler
- ESLint for code quality
- Prettier for formatting
- Jest for testing
- React Native Debugger

## Architecture Patterns

### Component Structure
```
/src
  /screens - Full-page views
  /components - Reusable UI pieces
  /navigation - Routing configuration
  /services - Business logic & API calls
  /theme - Design system
  /types - TypeScript definitions
  /utils - Helper functions
```

### Data Flow
1. User interaction in Screen
2. Event handler calls Service
3. Service communicates with Backend/Storage
4. State updates via hooks
5. UI re-renders automatically

### Styling Approach
- React Native StyleSheet API
- Centralized theme system (colors, spacing)
- Component-level styles
- Responsive design considerations
- Dark mode as default

## Technical Constraints

### Mobile Limitations
- Battery consumption (optimize background tasks)
- Storage space (efficient data management)
- Network variability (offline support critical)
- Device diversity (test on multiple devices)
- Memory constraints (careful with large data sets)

### React Native Constraints
- Limited access to native APIs (may need custom modules)
- Bridge overhead for native communication
- Some libraries require native linking
- Platform-specific code sometimes necessary
- Performance considerations for complex UIs

### Android Specific
- Minimum SDK: API 24 (Android 7.0)
- Target SDK: API 33 (Android 13)
- Permissions management
- Background service limitations
- Battery optimization restrictions

## Future Technical Additions

### On-Device AI
**React Native Executorch**
- Run PyTorch models on-device
- Quantized models for mobile (up to 7B parameters)
- Integration with Hugging Face models
- Model downloading and caching
- Performance optimization

### Media Processing
**Audio/Video**
- React Native Voice for STT
- React Native TTS for speech synthesis
- React Native Image Picker
- React Native Camera (video analysis)
- FFmpeg for media processing

### Advanced Features
**Planned Integrations**
- Push notifications (Firebase Cloud Messaging)
- Background sync
- Biometric authentication
- Cloud backup integration
- Analytics (privacy-respecting)

## API Integration

### Harmony Link APIs
**REST API**
- Character list and details
- Configuration management
- Message history
- Sync operations

**WebSocket/Events API**
- Real-time message delivery
- Character status updates
- Typing indicators
- Connection status

### Data Sync Strategy
- Optimistic UI updates
- Conflict resolution
- Background sync queue
- Retry logic with exponential backoff
- Version tracking for entities

## Performance Considerations

### Optimization Strategies
- Lazy loading for screens
- Image optimization and caching
- FlatList virtualization for long lists
- Memoization for expensive computations
- Code splitting where possible

### Monitoring
- Performance metrics tracking
- Crash reporting
- Network request monitoring
- Memory usage tracking
- User experience metrics

## Security

### Data Protection
- Secure storage for sensitive data
- HTTPS for all network communications
- Token-based authentication
- SSL certificate pinning (consideration)
- No plaintext storage of credentials

### Privacy
- Minimal data collection
- User consent for tracking
- Clear data usage policies
- Easy data export/deletion
- No third-party analytics (or privacy-respecting only)

## Build & Deploy

### Development
- Local development with Metro
- Hot reload for quick iterations
- Debug builds with source maps
- React Native Debugger integration

### Testing
- Emulator testing (Android Studio AVD)
- Physical device testing via ADB
- Wireless debugging for convenience
- Manual QA process initially

### Production
- Release builds with optimization
- Code obfuscation
- APK generation via Gradle
- Future: Play Store deployment
- Versioning strategy

## Dependencies Management

### Key Dependencies
```json
{
  "react": "18.3.1",
  "react-native": "0.83.1",
  "@react-navigation/native": "^6.x",
  "@react-navigation/native-stack": "^6.x",
  "react-native-paper": "^5.x",
  "react-native-vector-icons": "^10.x",
  "@react-native-async-storage/async-storage": "^1.x",
  "react-native-screens": "^3.x",
  "react-native-safe-area-context": "^4.x"
}
```

### Update Strategy
- Regular dependency updates
- Security vulnerability monitoring
- Breaking change assessment
- Gradual migration approach
- Compatibility testing
