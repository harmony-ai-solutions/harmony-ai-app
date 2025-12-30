# Product Context

## Why This Exists
The Harmony AI ecosystem lacked mobile access - users with Harmony Link could only interact with their AI characters from desktop applications or game engines. Harmony AI Chat bridges this gap, bringing AI character conversations to mobile devices where people naturally communicate throughout their day.

## Problems It Solves

### For Privacy-Conscious Users
- **Problem**: Cloud AI services collect and analyze all user data
- **Solution**: Connect to self-hosted Harmony Link for complete data privacy
- **Benefit**: Full control over conversations, no third-party data access

### For Harmony Link Users
- **Problem**: AI characters only accessible from desktop/game environments
- **Solution**: Mobile app syncs with Harmony Link backend
- **Benefit**: Continue conversations anywhere, seamless character persistence

### For Power Users
- **Problem**: Limited customization with commercial AI chat apps
- **Solution**: Open-source codebase with flexible backend options
- **Benefit**: Modify, extend, and customize every aspect of the experience

### For Offline/Travel Scenarios
- **Problem**: Cloud AI requires constant internet connection
- **Solution**: On-device AI models via React Native Executorch
- **Benefit**: Basic chat functionality even when offline

## How It Should Work

### Core User Flow
1. **Setup**: User chooses between Harmony Link connection or Harmony Cloud
2. **Character Selection**: Browse and select AI character from available entities
3. **Chat**: Natural conversation with realistic timing and character consistency
4. **Sync**: Automatic data synchronization across devices
5. **Offline**: Graceful fallback to local models when connection lost

### Key Behaviors

**Realistic Chat Experience**
- Variable response delays simulating typing/thinking
- "Typing..." indicator matching message length
- Occasional pauses for authenticity
- Character stays in-character with consistent personality

**Smart Connection Management**
- Automatic reconnection attempts
- Clear status indicators (connected/offline)
- Seamless fallback to on-device mode
- Data queuing for offline messages

**Character Persistence**
- Memory of past conversations
- Personality evolution over time
- Cross-device conversation continuity
- Time-aware interactions (sleep cycles, availability)

## User Experience Goals

### Simplicity
- One-tap setup for Harmony Cloud
- Clear tutorials for self-hosted Link
- Intuitive chat interface
- Minimal configuration required

### Privacy
- Transparent data handling
- Clear indication of backend mode
- No hidden cloud connections
- User controls all data

### Reliability
- Stable connections to Harmony Link
- Robust offline functionality
- Automatic sync recovery
- No message loss

### Natural Interaction
- Conversations feel authentic
- Characters maintain personality
- Realistic timing and delays
- Context-aware responses

## Future Vision

### Phase 1: Foundation (Current Bootstrap)
- Basic chat interface
- Harmony Link connection
- Local data persistence
- Simple character selection

### Phase 2: Enhanced Experience
- On-device AI models
- Voice messages (STT/TTS)
- Image viewing/generation
- Rich character profiles

### Phase 3: Integration
- Messenger platforms (WhatsApp, Telegram)
- Group chat support
- Multi-character conversations
- Cross-platform presence

### Phase 4: Advanced Features
- Custom character creation
- Memory system visualization
- Character relationship graphs
- Advanced personalization

## Success Metrics
- **Adoption**: Monthly active users, retention rate
- **Engagement**: Messages per day, session length
- **Performance**: Message latency, sync reliability
- **Privacy**: Self-hosted vs cloud split, data volume
- **Satisfaction**: User reviews, feature requests

## Key Differentiators
1. **Privacy-First**: Self-hosted option unavailable in commercial apps
2. **Character Persistence**: Deep memory and personality evolution
3. **Open Source**: Full transparency and customization
4. **Ecosystem Integration**: Seamless with Harmony Link and game engines
5. **Realistic Behavior**: Advanced timing and personality simulation
