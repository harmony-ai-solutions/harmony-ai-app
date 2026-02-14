# Message Flows

This diagram shows the complete flow for text, voice, and image messages between the mobile app and AI characters.

## Text Message Flow

### Sending Text Message

```mermaid
sequenceDiagram
    participant User
    participant UI as ChatDetailScreen
    participant ESS as EntitySessionService
    participant DB as SQLite DB
    participant HL as Harmony Link
    participant AI as AI Character
    
    User->>UI: Type message & send
    UI->>ESS: sendTextMessage(partnerId, text)
    
    ESS->>ESS: Generate UUID v7 messageId
    ESS->>DB: INSERT message (optimistic)
    DB-->>ESS: Stored
    
    ESS->>UI: Reload messages
    UI->>User: Show message immediately
    
    ESS->>HL: ENTITY_UTTERANCE
    Note over ESS,HL: Via partner connection<br/>type: UTTERANCE_COMBINED
    
    HL->>AI: Process message
    AI->>AI: Generate response
    
    alt Text Response
        AI->>HL: Response ready
        HL->>ESS: TYPING_INDICATOR (is_typing: true)
        ESS->>UI: Show typing indicator
        
        Note over AI: Realistic typing delay
        
        HL->>ESS: ENTITY_UTTERANCE (text response)
        ESS->>DB: INSERT AI message
        ESS->>UI: message:received event
        
        HL->>ESS: TYPING_INDICATOR (is_typing: false)
        ESS->>UI: Hide typing indicator
        UI->>UI: Reload & show AI message
        
    else Voice Response
        AI->>HL: Response ready
        HL->>ESS: RECORDING_INDICATOR (is_recording: true)
        ESS->>UI: Show recording indicator
        
        Note over AI: Realistic recording delay
        
        HL->>ESS: ENTITY_UTTERANCE (audio + text)
        Note over ESS,HL: Base64 audio + transcript
        ESS->>DB: INSERT AI message with audio
        ESS->>UI: message:received event
        
        HL->>ESS: RECORDING_INDICATOR (is_recording: false)
        ESS->>UI: Hide recording indicator
        UI->>UI: Reload & show AI message with play button
    end
```

### ENTITY_UTTERANCE Payload (Text)

```json
{
  "event_id": "evt_1234567890_xyz",
  "event_type": "ENTITY_UTTERANCE",
  "status": "NEW",
  "payload": {
    "message_id": "msg_01234567-89ab-7cde",
    "entity_id": "user",
    "content": "Hello, how are you?",
    "type": "UTTERANCE_COMBINED"
  }
}
```

## Voice Message Flow

### Recording and Sending Voice

```mermaid
sequenceDiagram
    participant User
    participant UI as ChatInput
    participant AR as AudioRecorder
    participant ESS as EntitySessionService
    participant DB as SQLite DB
    participant HL as Harmony Link
    
    User->>UI: Hold mic button
    UI->>AR: startRecording()
    AR->>AR: Check microphone permission
    AR->>AR: Start recording (16kHz, 16-bit, mono)
    UI->>User: Show recording UI
    
    User->>UI: Release mic button
    UI->>AR: stopRecording()
    AR-->>UI: { uri, duration, base64 }
    
    UI->>ESS: newAudioMessage(partnerId, base64, mimeType, duration)
    
    ESS->>ESS: Generate UUID v7 messageId
    ESS->>DB: INSERT message (audio, no transcript yet)
    DB-->>ESS: Stored
    
    ESS->>UI: Reload messages
    UI->>User: Show audio message with "Transcribing..."
    
    ESS->>HL: STT_INPUT_AUDIO
    Note over ESS,HL: Via user connection<br/>result_mode: 'return'
    
    HL->>HL: Transcribe audio
    
    alt Transcription Success
        HL->>ESS: STT_OUTPUT_TEXT
        Note over HL,ESS: Contains message_id + transcript
        ESS->>DB: UPDATE message SET content=transcript
        ESS->>UI: transcription:completed event
        UI->>UI: Replace "Transcribing..." with text
        
        Note over UI: User reviews & confirms
        User->>UI: Tap send button
        
        UI->>ESS: sendUtterance (with transcript)
        ESS->>HL: ENTITY_UTTERANCE
        Note over ESS,HL: Audio + transcript to AI
        
    else Transcription Failed
        HL->>ESS: Error or timeout
        ESS->>UI: transcription:failed event
        UI->>UI: Show "Retry" button
        
        opt User retries
            User->>UI: Tap retry
            UI->>ESS: retryTranscription(messageId)
            ESS->>HL: STT_INPUT_AUDIO (retry)
        end
    end
```

### STT_INPUT_AUDIO Payload

```json
{
  "event_id": "evt_1234567890_abc",
  "event_type": "STT_INPUT_AUDIO",
  "status": "NEW",
  "payload": {
    "message_id": "msg_01234567-89ab-7cde",
    "audio_data": {
      "audio_bytes": "base64_encoded_wav_data...",
      "channels": 1,
      "bit_depth": 16,
      "sample_rate": 16000
    },
    "result_mode": "return"
  }
}
```

**Result Modes:**
- `"return"`: Sends STT_OUTPUT_TEXT back to client (used by app)
- `"process"`: Forwards transcript to Cognition module (used by plugins)

### STT_OUTPUT_TEXT Response

```json
{
  "event_id": "evt_1234567890_abc",
  "event_type": "STT_OUTPUT_TEXT",
  "status": "NEW",
  "payload": {
    "message_id": "msg_01234567-89ab-7cde",
    "content": "Hello, how are you?"
  }
}
```

## Receiving AI Voice Response

```mermaid
sequenceDiagram
    participant HL as Harmony Link
    participant ESS as EntitySessionService
    participant DB as SQLite DB
    participant AP as AudioPlayer
    participant UI as ChatDetailScreen
    participant User
    
    HL->>ESS: ENTITY_UTTERANCE
    Note over HL,ESS: audio + content + audio_type
    
    ESS->>DB: INSERT AI message
    Note over DB: Store base64 audio + transcript
    
    ESS->>UI: message:received event
    UI->>UI: Reload messages
    UI->>User: Show message with play button
    
    opt User plays audio
        User->>UI: Tap play button
        UI->>AP: playAudio(base64, mimeType, messageId)
        AP->>AP: Decode base64 to audio
        AP->>AP: Initialize TrackPlayer
        AP->>User: 🔊 Audio plays
        
        AP->>UI: Progress updates
        UI->>UI: Update playback progress bar
        
        AP->>UI: Playback complete
        UI->>UI: Reset play button
    end
```

## Image Message Flow (In Progress)

### Sending Image Message

```mermaid
sequenceDiagram
    participant User
    participant UI as ChatInput
    participant Picker as ImagePicker
    participant ESS as EntitySessionService
    participant HL as Harmony Link
    
    User->>UI: Tap image button
    UI->>Picker: Open image picker
    Picker-->>UI: { uri, base64, mimeType }
    
    opt Add caption
        User->>UI: Type caption
    end
    
    UI->>ESS: sendImageMessage(partnerId, base64, mime, caption)
    
    ESS->>ESS: Generate UUID v7 messageId
    ESS->>HL: ENTITY_UTTERANCE
    Note over ESS,HL: image_data + image_mime_type + content
    
    HL->>HL: Process image (vision model)
    HL-->>ESS: AI response with image context
```

**Note**: Image messages are currently in progress. The protocol supports them but full integration with vision models is pending.

## Chat Indicators

### Typing Indicator Flow

```mermaid
sequenceDiagram
    participant HL as Harmony Link
    participant ESS as EntitySessionService
    participant UI as ChatDetailScreen
    participant User
    
    Note over HL: AI starts composing response
    HL->>ESS: TYPING_INDICATOR
    Note over HL,ESS: is_typing: true
    
    ESS->>UI: typing:indicator event
    UI->>User: Show "Alice is typing..."
    
    Note over HL: Realistic typing duration
    Note over HL: (based on response length)
    
    HL->>ESS: Response ready
    HL->>ESS: TYPING_INDICATOR
    Note over HL,ESS: is_typing: false
    
    ESS->>UI: typing:indicator event
    UI->>User: Hide typing indicator
    UI->>User: Show actual message
```

### Recording Indicator Flow

Similar to typing, but shows "Alice is recording a voice message..."

## Message Storage Schema

```sql
CREATE TABLE conversation_messages (
  id TEXT PRIMARY KEY,                  -- UUID v7
  entity_id TEXT NOT NULL,              -- Partner entity (from user's view)
  sender_entity_id TEXT NOT NULL,       -- Who sent it
  session_id TEXT NOT NULL,             -- Entity session ID
  content TEXT NOT NULL,                -- Message text
  audio_duration REAL,                  -- Voice message duration (seconds)
  message_type TEXT NOT NULL,           -- 'text', 'audio', 'combined', 'image'
  audio_data TEXT,                      -- Base64 encoded audio
  audio_mime_type TEXT,                 -- 'audio/wav', etc.
  image_data TEXT,                      -- Base64 encoded image
  image_mime_type TEXT,                 -- 'image/jpeg', etc.
  vl_model TEXT,                        -- Vision model used (if any)
  vl_model_interpretation TEXT,         -- Vision model analysis
  vl_model_embedding TEXT,              -- Vision embedding (JSON)
  created_at INTEGER NOT NULL,          -- Unix timestamp
  updated_at INTEGER NOT NULL,          -- Unix timestamp
  deleted_at INTEGER                    -- Soft delete timestamp
);
```

## Optimistic UI Pattern

The app uses optimistic updates for better UX:

```mermaid
graph TD
    Send[User sends message] --> Local[Store in local DB immediately]
    Local --> UI[Show in UI instantly]
    UI --> Network[Send to Harmony Link]
    
    Network -->|Success| Confirm[Message delivered]
    Network -->|Failure| Retry[Retry logic]
    
    Retry -->|Success| Confirm
    Retry -->|Failed| Show[Show error to user]
```

**Benefits:**
- Instant feedback (no waiting for network)
- Messages appear immediately
- Network latency hidden from user
- Failures handled gracefully

## Message Lifecycle States

```mermaid
stateDiagram-v2
    [*] --> Composing: User types/records
    
    Composing --> LocalStored: Save to DB
    LocalStored --> Sending: Send to Harmony Link
    
    Sending --> Sent: Delivered successfully
    Sending --> Failed: Network error
    
    Failed --> Retry: Auto/manual retry
    Retry --> Sending
    Retry --> PermanentlyFailed: Max retries exceeded
    
    Sent --> [*]
    PermanentlyFailed --> [*]
```

**Current Implementation:**
- The app stores messages locally first (optimistic)
- Network send happens asynchronously
- No explicit retry mechanism yet (manual resend only)
- Failed messages remain in DB for user reference

---

[← Previous: Entity Sessions](./04-entity-sessions.md) | [Back to Overview](../HARMONY-LINK-INTEGRATION.md)
