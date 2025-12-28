# Active Context

## Current Focus
**Bootstrap Phase Complete** - Foundation is ready for feature development. The app has a working React Native structure with navigation, theming, and basic screens.

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
- Dark theme as default (#282828 background)
- Orange accent color (#ea580c) matching Harmony Link
- React Native Paper Material Design 3 integration
- Consistent color palette throughout
- Type-safe theme configuration

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
