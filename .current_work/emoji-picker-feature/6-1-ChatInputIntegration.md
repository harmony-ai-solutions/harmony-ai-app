# Phase 6: ChatInput Integration

## Objective

Integrate the emoji picker into the existing `ChatInput` component. Add an emoji toggle button that opens the picker modal, and handle emoji insertion into the text input field.

## Codebase References

- [`src/components/chat/ChatInput.tsx`](../../src/components/chat/ChatInput.tsx) — the input bar to modify
- [`src/screens/ChatDetailScreen.tsx`](../../src/screens/ChatDetailScreen.tsx) — parent screen that owns the ChatInput
- [`src/components/emoji/EmojiPickerModal.tsx`](../../src/components/emoji/EmojiPickerModal.tsx) — the picker modal
- [`.planning/codebase/CONVENTIONS.md`](../../.planning/codebase/CONVENTIONS.md) — component patterns

---

## Task 1 — Add emoji toggle button to ChatInput

**File:** `src/components/chat/ChatInput.tsx`

### Changes to props:

Add `onEmojiToggle` callback to `ChatInputProps`:

```typescript
interface ChatInputProps {
  onSendText: (text: string) => void;
  onSendAudio: (audioData: string, duration: number) => void;
  onSendImage: (imageBase64: string, mimeType: string, caption?: string) => void;
  onTypingStart?: () => void;
  onEmojiToggle?: () => void;    // ← NEW: toggles emoji picker visibility
  showEmojiButton?: boolean;     // ← NEW: whether emoji button is visible
  disabled?: boolean;
  theme: Theme;
}
```

### Changes to the input row:

Add the emoji button to the left side of the input (before the image picker button). This is the standard position in chat apps (WhatsApp, Telegram, Discord):

In the main `return` block, add before the image picker `<TouchableOpacity>`:

```typescript
{/* Emoji toggle button */}
{showEmojiButton !== false && onEmojiToggle && (
  <TouchableOpacity
    onPress={onEmojiToggle}
    disabled={disabled || isProcessing}
    style={styles.iconButton}
  >
    <Icon
      name="emoticon-outline"
      size={24}
      color={disabled ? theme.colors.text.disabled : theme.colors.accent.primary}
    />
  </TouchableOpacity>
)}
```

> **Design decision:** The emoji button uses `emoticon-outline` from MaterialCommunityIcons (already in the project). It sits next to the existing image picker button on the left side of the text input.

---

## Task 2 — Integrate EmojiPickerModal into ChatDetailScreen

**File:** `src/screens/ChatDetailScreen.tsx`

Add the emoji picker modal state and rendering to the chat detail screen.

### Add state:

```typescript
const [showEmojiPicker, setShowEmojiPicker] = useState(false);
```

### Add emoji selection handler:

```typescript
const handleEmojiSelected = useCallback((emoji: EmojiEntry) => {
  // Insert emoji into the text input — we need a ref to the ChatInput's text state
  // Approach: pass emoji to ChatInput via a ref or callback
  setShowEmojiPicker(false);
  
  // Option A: Use a ref to append emoji to input text
  // Option B: Use an event/state to pass the emoji down to ChatInput
}, []);
```

### Render the picker modal:

Add inside the render tree, alongside the existing `<ChatInput>`:

```typescript
{/* Emoji Picker Modal */}
<EmojiPickerModal
  visible={showEmojiPicker}
  onClose={() => setShowEmojiPicker(false)}
  onEmojiSelected={handleEmojiSelected}
/>

{/* Existing ChatInput */}
<ChatInput
  onSendText={handleSendText}
  onSendAudio={handleSendAudio}
  onSendImage={handleSendImage}
  onTypingStart={handleTypingStart}
  onEmojiToggle={() => setShowEmojiPicker(prev => !prev)}
  showEmojiButton={true}
  disabled={isDualSessionActive}
  theme={theme}
/>
```

---

## Task 3 — Handle emoji insertion into text input

There are two approaches for inserting emojis into the `TextInput`:

### Approach A: Expose a method via `useImperativeHandle` (Recommended)

**File:** `src/components/chat/ChatInput.tsx`

```typescript
// Add forwardRef to ChatInput
export const ChatInput = React.forwardRef<ChatInputRef, ChatInputProps>(({
  // ... existing props
}, ref) => {
  const [text, setText] = useState('');
  
  // Expose insertEmoji method
  useImperativeHandle(ref, () => ({
    insertEmoji: (emoji: string) => {
      setText(prev => prev + emoji);
    },
  }));
  
  // ... rest of component
});

// Type for the ref
export interface ChatInputRef {
  insertEmoji: (emoji: string) => void;
}
```

**File:** `src/screens/ChatDetailScreen.tsx`

```typescript
const chatInputRef = useRef<ChatInputRef>(null);

const handleEmojiSelected = useCallback((emoji: EmojiEntry) => {
  chatInputRef.current?.insertEmoji(emoji.native);
  // Don't close the picker — let user pick multiple emojis
  // The picker closes when tapping outside or pressing the emoji button again
}, []);

// ...

<ChatInput
  ref={chatInputRef}
  // ... other props
/>
```

### Why this approach?
- User can pick **multiple emojis** without the modal closing between selections
- Text input is updated via ref — no state lifting needed
- Matches the UX of WhatsApp, Telegram, Discord

---

## Task 4 — Handle keyboard/emoji picker transitions

When the emoji picker is open and the user taps the text input, the software keyboard should dismiss the emoji picker (and vice versa).

Add keyboard listener logic in `ChatDetailScreen`:

```typescript
import { Keyboard } from 'react-native';

// In the screen component:
useEffect(() => {
  const keyboardListener = Keyboard.addListener('keyboardDidShow', () => {
    // When keyboard opens, close emoji picker
    if (showEmojiPicker) setShowEmojiPicker(false);
  });
  
  return () => keyboardListener.remove();
}, [showEmojiPicker]);
```

And when toggling the emoji picker:

```typescript
const handleEmojiToggle = useCallback(() => {
  if (!showEmojiPicker) {
    // Opening emoji picker — dismiss keyboard first
    Keyboard.dismiss();
  }
  setShowEmojiPicker(prev => !prev);
}, [showEmojiPicker]);
```

---

## Progress Checklist

- [ ] `ChatInputProps` extended with `onEmojiToggle` and `showEmojiButton`
- [ ] Emoji toggle button added to ChatInput layout (left of image picker)
- [ ] `ChatInputRef` with `insertEmoji` method exposed via `useImperativeHandle`
- [ ] `ChatInput` converted to `forwardRef` pattern
- [ ] `ChatDetailScreen` has `showEmojiPicker` state and `EmojiPickerModal` rendered
- [ ] `handleEmojiSelected` inserts emoji into input via ref
- [ ] Emoji picker stays open after selection (multi-pick UX)
- [ ] Keyboard dismisses when emoji picker opens and vice versa
- [ ] No regression to existing text/voice/image send functionality
