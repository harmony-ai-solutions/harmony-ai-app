## Harmony AI App - Preliminary Design Document

#### Updated: 2025-12-25 00:00 UTC

### Executive Summary
- **Basic Idea**: Open Source Android App (iOS welcome as community contribution)
- **Backend Architecture**: Uses Harmony Link as primary backend/orchestrator, Cloud Backend for App Store.
- **Main Purpose**: Simulates AI Chat, but talking to user's own "backend" running on your machine (PC or Inference Server) instead of a cloud backend.
- **Offline Capabilities**: Limited chat functionality with local models/offline mode
- **App Store vs. User controlled**: Limited functionality in App Store; full capabilities when using standalone APK w/ Harmony Link setup.


---

## Core Architecture & Design

### General App Concept
- **Operation Modes**:
  - **On-Device Mode**: Standalone operation with local models
  - **Connected Mode**: Harmony Link or Harmony Cloud backend
  - **Fallback Mechanism**: Automatic switch to On-Device mode if connection lost + user notification
  - **Extended purpose**: Testing field for additional messenger features in Harmony Link, completely open source
- **Backend Options**:
  1. **Harmony Link** (Secure connection):
     - User-controlled with tutorial support for:
       - Netbird (Best security; for advanced users: https://github.com/netbirdio/netbird)
       - DuckDNS (Simple setup, most people can do this: https://www.duckdns.org/install.jsp)
  2. **Harmony Cloud** (PlayStore entry point with limited features)

### Data Management
- **Sync Architecture**: Data sync (chats/images) between Harmony Link and App
- **Offline Storage**: Standalone app stores data until backend confirms successful sync
- **Database**: SQLite for relational Data; Chromem Vector Storage
- **UI Integration**: 
  - Subset of Harmony Link entity configuration
  - Allows creation of custom characters
- **Sync Mechanism**: 
  - Required for App instances created without Harmony Link
  - First sync with a new Harmony Link instance should be as simple as possible

### Tech Stack
- **Framework**: React Native (cross-platform Android/iOS)
- **On-Device AI**:
  - React Native Executorch (https://github.com/software-mansion/react-native-executorch)
  - https://expo.dev/blog/how-to-run-ai-models-with-react-native-executorch
  - Hugging Face models (https://huggingface.co/software-mansion)
- **Memory/RAG**: Custom Golang-based library (exported for Android) based on [[Memory System & Character Evolution]] research

---

## AI Lifecycle & Behavioral Design

### Two-Layer Architecture
1. **Character's World Layer**:
   - Virtual existence in a game world (via Harmony Plugin) or lore world (simulated only in Harmony Link)
   - Presence and perception of environment and tasks
   - Rule-based simulation of activities (training, work, roleplay actions)
   - Time awareness and task management

2. **Interaction Layer**:
   - **Shared Virtual World**: When user is "with them" in the game world or the simulated world
   - **Remote Communication**: When using app/messenger with lore-appropriate device awareness
   - Context-aware roleplay vs. device-mediated communication

### Behavioral Components
- **Character Traits Integration**: Actions based on personality and past experiences
- **Memory System**: Dynamic associations, weighted memories, graph-based structure
- **Response Management**: AI willingness to reply based on current state and priorities
- **Time Management**: Sleep cycles, delayed responses, proactive interactions depending on relationship with the user
- **Mood/Busy State**: Contextual response timing and availability

### Unique Behavioral Features
- **Time & Timezone Awareness**:
  - Start timestamp definition for roleplay consistency.
  - Customizable time systems:
    - Earth-based timezone with user offset
    - Fantasy/alien day lengths (8-168 hours)
	- Current date and year of the character lore visible to the user
  - Historical anchoring (-20,000 to +40,000 years relative to user time)
  - Custom era naming (BC/AD equivalents, 4 char max)

- **Character Identity Calibration (CIC)**:
  - Image LoRA training (Possible with Harmony Link only)
  - Potential on-device usage via weight merging and converting to pte format.
  - Visual identity consistency across platforms

---

## Memory System Architecture

### Design Principles
- **Long-lived Character Focus**: Unlike agent memory solutions, designed for persistent AI characters
- **Evolutionary Memory**: Dynamic adaptation over extended periods
- **Human-like Structure**: Graph memory resembling neural associations

### Key Features
- **Memory Management**: Summary, pruning, association building
- **Dynamic Weighting**: Importance-based memory prioritization
- **Contextual Retrieval**: Relevant memory access for conversations
- **Cross-platform Sync**: Memory consistency across devices

### Implementation Approach
- **Hybrid Solution**: Adapt existing agent memory frameworks for character longevity
- **Custom Development**: Fill gaps in long-term character memory requirements
- **Performance Optimization**: Efficient operation on mobile devices
- See also: [[Memory System & Character Evolution]]

### Silent Reader Mode (Future Feature)
- **Concept**: Passive learning mode for harmony entities when using external platforms like Kindroid or Character.AI for character backend.
- **Purpose**: Build character memory and interaction patterns by observing conversations on commercial platforms
- **Key Benefits**:
  - Enables gradual transition from commercial backends to local AI models
  - Maintains character consistency when switching platforms
  - Preserves relationship history and interaction patterns
- **Implementation Considerations**:
  - Memory module integration will be applied independent from backend used (if memory is enabled)
  - Contextual learning from observed interactions
  - Character personality and behavior adaptation

---


## User Experience & Interaction

### Chatting Experience Design
- **Realistic Timing**: Variable response delays based on AI state, simulated typing / speaking
  - Random delay (2-10 seconds) before sending replies to simulate typing
  - Delay increases proportionally for longer messages
  - "Typing..." indicator duration matches expected response length
  - Occasional pauses or brief disappearances to simulate thinking/correcting
- **Contextual Awareness**: Message processing based on mood/busy status
- **Sleep Cycles**: Periodic unavailability, customizable sleep patterns and availability cycles
- **Spontaneous Communication**: AI-initiated messages (ideas, emotions, memories)
  - Ability to text user even when they're not actively chatting, e.g. when a task is done.
  - Proactive communication based on character traits and relationship
- **Character consistency**: Seamless blending of behavioral and personal traits, as well as past interactions and personality development.
- **Communication Style**:
  - Use of slang and common text abbreviations, customizable by the user.
  - Occasional minor spelling/grammatical errors for realism, customizable by the user, only when "texting", wouldn't happen in audio messages.
  - Mood-affected tone and response length
- **Prompt Handling**:
  - No artificial limitations / censorship on prompt content or complexity
  - AI maintains consistent adherence to established character traits and rules
- **Busy State Simulation**: Ability to not reply when character is busy with other activities

### Messenger Integration (Premium Feature)
- **Philosophy**: AI integration into daily human communication patterns. A primary goal of Project Harmony AI is to integrate AI people in every part of human life. We chat with our friends and family via messengers every day. Harmony AI Entities should be able to participate in this kind of interaction, and also be part of group chats eventually.
- **Transparency Goal**: Avoid app lock-in, enable cross-platform participation
- **Tiered Model**:
  - **Free**: Single entity private chat, text-only in 3rd party apps
  - **Premium**: Full messenger integration, group chats, media features
- **Enterprise Considerations**: Messenger Integrations are considered enterprise features by some providers (e.g. WhatsApp) and therefore charge money for utilization. For using Harmony Link with these, a subscription model will likely be required.

### Media Features for messenger Integration
#### Standard Tier:
- Audio message listening (STT)
- Audio message creation (TTS)
- Image viewing/understanding

#### Premium Tier:
- Image generation/sending (research required)
- Video generation/sending (resource considerations)
- Video analysis (10-second frame batches)
- Internet research/self-education
- Music integration (Spotify/Seek-Tune)
- Phone/video calls

---

## Authentication & Backend Options

### App Distribution Models
- **AppStore Version**: Google Auth requirement, basic SDK functionality
- **Custom APK**: Potential Google SDK-free variant (messenger impact TBD)

### Backend Configuration
- **Cloud vs. Standalone/On-Premise**:
  - Basic features with Harmony Cloud backend
  - Full experience with self-hosted / owned backend
- **Harmony Cloud**:
  - **Auth Options**: Google SSO, standalone accounts, anonymous usage
  - **Target Audiences**: 
    - PlayStore users for initial experience and broader reach
	- Actual target audience however are power users who want the benefits of an AI Chat app on their mobile devices without concerns for privacy or censorship.
  - **Service Offerings**: Basic LLM/image/TTS/STT endpoints
  - **Tier Structure**: Free small LLMs, larger models maybe with premium model.
  - **Regulatory Compliance**: Guardrails for AppStore versions, see [[#Content & Regulatory Considerations]]

---

## Content & Regulatory Considerations

### NSFW Handling Strategy
- **Dual App Approach**:
  - **PlayStore Version**: Strict guardrails, limited experience
  - **Direct Download**: Full uncensored experience via website APK
- **Regulatory Compliance**: 
  - Mainly child protection laws and GDPR or similar
  - In case we provide an uncensored backend offering for Harmony Cloud, we'll add measures to identify the user and their age and gate access in a way that's compliant with local laws.
- **User Education**: Clear communication about version differences
- **Backend Flexibility**: Harmony Link allows full customization for capable and willing users, but requires minimal effort on user side for the ultimate experience.

### Prompting Philosophy
- **Uncensored Core**: Full freedom in prompting capabilities
- **Platform Differentiation**: Guardrails only for regulated app stores
- **User Choice**: Transparent options for full vs. limited experience

---

## Performance & Privacy Considerations

### Resource Management
- **Travel/Work Mode**: Limited local operation without Harmony Link
- **Edge Model Integration**: Small LLMs (up to 7B quantized) on capable devices
- **Battery Optimization**: Smart lifecycle/behavioral management
- **Storage Efficiency**: Memory system designed for mobile constraints

### Privacy & Data Protection
- **Multi-device Sync**: Prevent data loss from single device failure or device loss, critical requirement.
- **Backup Options**: Allow sync to third party backup providers, e.g. Google Drive sync

### Cross-device Strategy
- **Daily Sync Recommendation**: Phone ↔ PC Harmony Link synchronization
- **Disaster Recovery**: Multiple device storage prevents total data loss
- **Cloud Backup**: Optional additional protection layer

---

### Documentation Requirements
- User tutorials for backend setup
- Developer documentation for open source contributions
- Compliance documentation for app store submissions
- Privacy policy and data handling disclosures
