# Active Context

## Current Focus
**Database Implementation Complete** - SQLite with SQLCipher encryption, complete repository layer, app integration, comprehensive testing, and in-app test runner. Ready for Harmony Link synchronization.

## Recent Work (January 2026)

### Database Test Runner Implementation ✅ COMPLETE (January 14, 2026)
- ✅ Created DatabaseTestScreen with real-time console output
- ✅ Integrated into Settings menu (hamburger menu)
- ✅ DEV-only visibility using __DEV__ checks
- ✅ Color-coded test results (success/error/warning)
- ✅ Live test execution in React Native environment
- ✅ Themed UI matching app design
- ✅ Updated database README with test instructions
- ✅ Auto-hidden in production builds

### Database Layer Implementation ✅ COMPLETE
- ✅ SQLite database with SQLCipher encryption for secure data storage
- ✅ Secure encryption key management via React Native Keychain
- ✅ Forward-only migration system (4 migrations, 100% Harmony Link compatible)
- ✅ Complete repository layer for all entity types:
  - Entity repository (11 tests)
  - Character repository with BLOB handling (18 tests)
  - Module repository for all 6 types (23 tests)
  - Provider repository for all 11 types (32 tests)
- ✅ Database context with automatic initialization
- ✅ Database loading screen with theme integration
- ✅ App.tsx integration with error recovery
- ✅ Comprehensive test suite (84 total tests)
- ✅ Complete documentation (README, IMPLEMENTATION_SUMMARY, NEXT_STEPS)

### Advanced Theming System Implementation
- ✅ Implemented `ThemeContext` with `AsyncStorage` persistence for built-in and custom themes.
- ✅ Created a library of themed components (`ThemedView`, `ThemedText`, `ThemedButton`, `ThemedCard`, `ThemedGradient`).
- ✅ Built an advanced Theme Editor that lists all color settings with an RGB slider-based overlay picker.
- ✅ Added management features: Create, Edit, and Delete custom themes.
- ✅ Migrated from `react-native-document-picker` to `@react-native-documents/picker` (v12.0.0) to fix compatibility issues with React Native 0.83.1.
- ✅ Integrated JSON-based theme import functionality.
- ✅ Created user documentation in `docs/THEMING.md`.

## Recent Work (December 2025)

### Bootstrap Implementation
- ✅ Initialized React Native 0.83.1 project with TypeScript
- ✅ Installed core dependencies (Navigation, Paper UI, AsyncStorage)
- ✅ Created organized src/ folder structure
- ✅ Implemented theme system matching Harmony Link design
- ✅ Built basic navigation (Home → Chat screens)
- ✅ Updated App.tsx with proper providers
- ✅ Created comprehensive README with deployment guides
- ✅ Verified .gitignore configuration

### Design System
**Theme Implementation**
- **Robust Theme Engine**: Implemented `ThemeContext` with 6 built-in themes and support for unlimited custom themes.
- **Dynamic Switching**: Instant theme application across the entire app without restart.
- **Advanced Editor**: Full-featured theme editor with RGB sliders for every color category (Accents, Backgrounds, Status, Text).
- **Themed Components**: Library of reusable components (`ThemedView`, `ThemedText`, `ThemedButton`, `ThemedCard`, `ThemedGradient`) for effortless UI consistency.
- **Persistence**: Theme preferences and custom themes persisted via `AsyncStorage`.
- **Import/Export**: JSON-based theme sharing using modern `@react-native-documents/picker`.
- **Material Design 3**: Seamless integration with React Native Paper.

### Project Structure
```
harmony-ai-app/
├── src/
│   ├── screens/          # HomeScreen, ChatScreen (placeholders)
│   ├── components/common/ # Ready for reusable components
│   ├── navigation/       # AppNavigator with stack
│   ├── theme/            # colors.ts, theme.ts
│   ├── services/api/     # Ready for backend integration
│   ├── types/            # TypeScript definitions
│   └── utils/            # Helper functions
├── android/              # Native Android code
├── design/               # Design document
├── memory-bank/          # Project documentation
└── App.tsx               # Root component with providers
```

## Next Steps

### Immediate Priorities (Phase 1)
- **Entity Selection System for Chat**: COMPLETED the implementation of a user entity selection system for chat conversations.
    - **ChatPreferencesService**: Implemented a new service using `AsyncStorage` to persist per-partner entity selection preferences.
    - **EntitySelectionModal**: Created a Material Design 3 modal for selecting the impersonated entity with smart defaults (favoring "user").
    - **ChatList Integration**: Integrated the selection flow into `ChatListScreen`. The list now filters for entities with character profiles and uses preferences to show accurate last message previews.
    - **ChatDetail Update**: Updated `ChatDetailScreen` to use the `impersonatedEntityId` from navigation parameters, enabling dynamic roleplay identities.
    - **Type Safety**: Updated navigation types to require `impersonatedEntityId` for the `ChatDetail` route.
- **Theming System Refinement**: COMPLETED the enhancement of the theming system, adding custom theme deletion and a full-featured color editor with an RGB slider-based overlay. Migrated to `@react-native-documents/picker` for modern build compatibility.
1. **Chat Interface**
   - Message list with FlatList virtualization
   - Message bubble components (user/AI differentiation)
   - Text input component
   - Send button and message handling
   - Timestamp display

2. **Harmony Link Integration**
   - Backend service implementation
   - WebSocket connection setup
   - REST API client configuration
   - Authentication flow
   - Error handling and retry logic

3. **Local Storage**
   - SQLite database setup
   - Message persistence
   - Character data caching
   - Settings storage
   - Sync queue for offline messages

4. **Character Management**
   - Character list screen
   - Character selection
   - Character profile display
   - Avatar rendering
   - Character state tracking

### Short-Term Goals (Next 2-4 Weeks)
- Implement functional chat interface
- Connect to Harmony Link backend (test environment)
- Set up local database for messages
- Basic character selection
- Simple settings screen

### Medium-Term Goals (1-3 Months)
- On-device AI model integration (React Native Executorch)
- Voice message support (STT/TTS)
- Image viewing and generation
- Character memory visualization
- Enhanced offline capabilities

### Long-Term Vision (3-6+ Months)
- Messenger platform integration
- Group chat support
- Advanced personalization
- Custom character creation
- Premium features

## Current Decisions & Considerations

### Technical Decisions Made
- **Framework**: React Native CLI (not Expo) for full control and native module support
- **UI Library**: React Native Paper for Material Design 3 consistency
- **Navigation**: React Navigation stack navigator for simplicity
- **Language**: TypeScript for type safety
- **State**: React Hooks initially, evaluate Redux/Zustand as complexity grows

### Open Questions
1. **State Management**: When to introduce Redux/Zustand? Monitor complexity.
2. **On-Device AI**: Performance testing needed for React Native Executorch
3. **Messenger Integration**: WhatsApp/Telegram SDK compatibility research
4. **Backend API**: Final Harmony Link mobile API specification
5. **Testing Strategy**: Jest + React Native Testing Library sufficient?

### Design Patterns Established
- Screen-level components for pages
- Service layer for backend communication
- Centralized theme configuration
- Type-safe navigation with typed routes
- Component-level styling with StyleSheet

## Important Learnings

### React Native Insights
- Metro bundler is fast with hot reload
- TypeScript support is excellent in latest RN
- React Native Paper provides good dark theme support
- Navigation setup is straightforward with typed routes
- Android development workflow is smooth
- **Metro Bundler Limitation**: Cannot resolve imports from `__tests__` directories by default
  - Solution: Create wrapper files outside `__tests__` to re-export test modules
  - Example: `src/database/test-runner.ts` wraps `src/database/__tests__/run-all-tests.ts`

### Navigation Modification Checklist
When adding a new screen to Settings navigation, **ALL 3 files must be updated**:
1. **`src/navigation/AppNavigator.tsx`** - Register the route in the Stack.Navigator
   - Add route name to RootStackParamList type
   - Add Stack.Screen with component reference
2. **`src/screens/settings/SettingsHomeScreen.tsx`** - Add button in main settings list
   - Add TouchableOpacity with icon and label
   - Configure navigation.navigate() call
   - Use `__DEV__` conditional for development-only features
3. **`src/components/navigation/SettingsMenu.tsx`** - Add item to hamburger menu
   - Add MenuItem to appropriate menuSections array
   - Use spread operator for conditional sections: `...(__DEV__ ? [section] : [])`
   - Ensure icon, label, and screen match other locations

**Common Pitfall**: Forgetting to update SettingsMenu.tsx causes the item to be missing from the hamburger menu even though it works from the main settings screen.

### Project-Specific Notes
- Keep harmony-link design consistency (colors, spacing)
- Bootstrap phase took ~4 hours as planned
- Documentation is critical for mobile deployment
- ADB setup is key pain point for newcomers
- Good foundation prevents technical debt

## Development Environment Notes

### Setup Requirements
- Node.js 18+, npm/yarn
- JDK 17 for Android builds
- Android Studio with SDK
- ADB for device deployment
- Git for version control

### Known Issues
**Resolved with Documentation**:
- **ADB PATH Issue**: Android SDK platform-tools must be in system PATH - documented in README troubleshooting
- **Gradle 9.0 Incompatibility**: React Native 0.83.1 incompatible with Gradle 9.0+ - project now uses Gradle 8.13
- **ANDROID_HOME Setup**: Environment variables must be properly configured - comprehensive guide in README
- **First Build**: Takes time due to Gradle download (expected behavior)
- **Emulator Requirements**: Virtualization must be enabled in BIOS/UEFI

**Key Configuration**:
- Gradle Version: 8.13 (configured in `android/gradle/wrapper/gradle-wrapper.properties`)
- JDK Version: 17 (can install via Chocolatey: `choco install openjdk --version=17.0.2`)
- Required Environment Variables: `ANDROID_HOME`, `JAVA_HOME`, PATH entries for platform-tools and emulator

**References**:
- [RN 0.83 Gradle Compatibility](https://medium.com/@bebongnchuy/fixing-jvmvendorspec-ibm-semeru-and-java-25-errors-in-react-native-0-83-on-ubuntu-238b273cdb89)
- [Android SDK Environment Setup](https://stackoverflow.com/questions/23042638/how-do-i-set-android-sdk-home-environment-variable)

### Development Workflow
1. Metro bundler in one terminal: `npm start`
2. Android build in another: `npm run android`
3. Hot reload for most changes
4. Full rebuild for native changes
5. Use React Native Debugger for complex issues

## Collaboration Notes

### For Future Contributors
- Read README.md for setup
- Check design/00 Design Document.md for vision
- Follow TypeScript strict mode
- Use provided theme system
- Keep components small and focused
- Test on both emulator and real device

### Code Style
- ESLint and Prettier configured
- TypeScript strict mode enabled
- Functional components with hooks
- Meaningful variable names
- Comments for complex logic

## Resources & References

### Documentation Links
- Design Doc: `/design/00 Design Document.md`
- README: `/README.md`
- Harmony Link: https://github.com/harmony-ai-solutions/harmony-link-private
- React Native: https://reactnative.dev/
- React Navigation: https://reactnavigation.org/
- React Native Paper: https://callstack.github.io/react-native-paper/

### Related Repositories
- **harmony-link-private**: Backend orchestration system
- **vnge-harmony-link-plugin**: Game engine integration
- **harmony-speech-engine**: STT/TTS services
- **quickstart**: Docker compose templates

## Status Summary
**Current Phase**: Bootstrap Complete ✅  
**Next Phase**: Feature Development (Chat Interface)  
**Blockers**: None  
**Ready For**: Implementation of core chat functionality
