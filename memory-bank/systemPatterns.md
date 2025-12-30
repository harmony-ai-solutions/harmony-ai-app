# System Patterns

## Architecture Overview

### Three-Tier Mobile Architecture
```
┌─────────────────────────────────────┐
│         Presentation Layer          │
│   (Screens, Components, Theme)      │
└──────────────┬──────────────────────┘
               │
┌──────────────┴──────────────────────┐
│         Business Logic Layer         │
│  (Services, State, Navigation)       │
└──────────────┬──────────────────────┘
               │
┌──────────────┴──────────────────────┐
│          Data Layer                  │
│ (Storage, API, Sync, Models)         │
└──────────────────────────────────────┘
```

## Key Design Patterns

### Component Patterns

**Screen Components**
- Full-page views
- Handle navigation
- Coordinate multiple sub-components
- Manage screen-level state
- Example: HomeScreen, ChatScreen

**Presentational Components**
- Pure display logic
- Receive data via props
- No business logic
- Reusable across screens
- Example: MessageBubble, CharacterAvatar

**Container Components**
- Fetch and manage data
- Pass data to presentational components
- Handle side effects
- Connect to services
- Example: ChatContainer, CharacterListContainer

### State Management Patterns

**Local State (useState)**
- UI state (form inputs, toggles)
- Component-specific data
- Temporary state
- No cross-component sharing

**Context State (useContext)**
- Theme configuration
- User authentication
- Global settings
- Shared UI state

**Async State (Future: Redux/Zustand)**
- Backend data
- Complex state trees
- Time-travel debugging needs
- State persistence requirements

### Navigation Patterns

**Stack Navigation**
- Primary navigation pattern
- Home → Character List → Chat
- Back button behavior
- Header configuration per screen

**Modal Navigation** (Future)
- Settings overlay
- Character profile pop-up
- Image viewer
- Confirmation dialogs

### Data Sync Patterns

**Optimistic Updates**
```typescript
// User sends message
1. Update local UI immediately
2. Store message in queue
3. Send to backend async
4. Update with server response
5. Handle conflicts/errors
```

**Background Sync**
```typescript
// When app comes online
1. Check for pending operations
2. Process queue in order
3. Resolve conflicts
4. Update UI with results
5. Clear processed items
```

**Conflict Resolution**
- Last-write-wins for most data
- Server authoritative for character state
- Client authoritative for pending messages
- Timestamp-based ordering

## Communication Patterns

### Backend Integration

**REST API Pattern**
```typescript
// Service layer handles all API calls
class HarmonyLinkService {
  async getCharacters() {
    // Fetch, cache, return
  }
  
  async sendMessage(characterId, text) {
    // Send, queue if offline, return
  }
}
```

**WebSocket Pattern**
```typescript
// Real-time event handling
class WebSocketService {
  connect() {
    // Establish connection
    // Setup event listeners
    // Handle reconnection
  }
  
  onMessage(callback) {
    // Subscribe to messages
  }
}
```

### Offline Support Pattern
```typescript
// Queue-based offline handling
1. Detect connection status
2. Queue operations when offline
3. Process queue when online
4. Retry failed operations
5. Notify user of status
```

## UI/UX Patterns

### Theme System
```typescript
// Centralized theme management
const theme = {
  colors: { /* Harmony Link palette */ },
  spacing: { /* Consistent spacing */ },
  typography: { /* Font system */ },
};

// Apply via React Native Paper Provider
<PaperProvider theme={theme}>
  <App />
</PaperProvider>
```

### Responsive Design
- Flexible layouts using Flexbox
- Percentage-based sizing
- SafeAreaView for notches/insets
- Platform-specific adjustments

### Loading States
- Skeleton screens for initial load
- Spinners for operations
- Pull-to-refresh for lists
- Optimistic UI where appropriate

### Error Handling
- User-friendly error messages
- Retry mechanisms
- Fallback UI states
- Error boundary components

## Performance Patterns

### List Optimization
```typescript
// Virtualized lists for performance
<FlatList
  data={messages}
  renderItem={renderMessage}
  keyExtractor={(item) => item.id}
  removeClippedSubviews={true}
  maxToRenderPerBatch={10}
  windowSize={21}
/>
```

### Image Optimization
- Lazy loading
- Progressive loading
- Caching strategy
- Placeholder images
- Appropriate resolutions

### Memory Management
- Clean up listeners on unmount
- Avoid memory leaks
- Efficient data structures
- Garbage collection awareness

## Security Patterns

### Secure Storage
```typescript
// Sensitive data encryption
import EncryptedStorage from 'react-native-encrypted-storage';

await EncryptedStorage.setItem(
  'auth_token',
  JSON.stringify(token)
);
```

### API Security
- HTTPS only
- Token-based auth
- Request signing
- Certificate pinning (consideration)
- No credentials in code

## Testing Patterns

### Unit Testing
```typescript
// Test individual functions
describe('MessageFormatter', () => {
  it('formats timestamps correctly', () => {
    // Test implementation
  });
});
```

### Component Testing
```typescript
// Test React components
render(<MessageBubble text="Hello" />);
expect(screen.getByText('Hello')).toBeTruthy();
```

### Integration Testing
- Test service integration
- API mocking
- State management flows
- Navigation paths

## Code Organization Patterns

### File Naming
- PascalCase for components: `HomeScreen.tsx`
- camelCase for utilities: `formatDate.ts`
- kebab-case for styles: `home-screen-styles.ts`
- Descriptive, not abbreviated

### Import Organization
```typescript
// 1. External libraries
import React from 'react';
import { View } from 'react-native';

// 2. Internal modules
import { HarmonyLinkService } from '@/services';
import { theme } from '@/theme';

// 3. Types
import type { Character } from '@/types';

// 4. Styles
import { styles } from './styles';
```

### Folder Structure
```
src/
├── screens/          # Screen components
├── components/       # Reusable components
│   ├── common/      # Generic UI elements
│   └── chat/        # Chat-specific components
├── navigation/       # Navigation config
├── services/         # Business logic & API
│   ├── api/         # Backend communication
│   └── storage/     # Local persistence
├── theme/           # Design system
├── types/           # TypeScript definitions
└── utils/           # Helper functions
```

## Best Practices

### React Native Specific
- Use functional components with hooks
- Avoid inline styles
- Memoize expensive computations
- Use React.memo for pure components
- Proper key props in lists

### TypeScript Usage
- Define interfaces for all data structures
- Avoid `any` type
- Use strict mode
- Type all function parameters and returns
- Use union types for states

### Error Prevention
- Null/undefined checks
- Try-catch for async operations
- Validate user input
- Handle edge cases
- Defensive programming

### Code Quality
- ESLint for consistency
- Prettier for formatting
- Meaningful variable names
- Comments for complex logic
- DRY principle (Don't Repeat Yourself)
