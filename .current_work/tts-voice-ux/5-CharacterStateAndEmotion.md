# Phase 5: Character State & Emotion (combined surface)

## Objective

One coherent "Character state" surface that combines three things the owner
wanted: an example of the engine-derived **vocal expressiveness** level, an
**emotional-state indicator** for the AI (with an enable/disable toggle in chat
settings), and the entry point for the **memory + RAG browser** (Phase 6).

Design principle: ONE entry point (a tappable mood chip in the chat header) →
ONE bottom sheet with tabs `State | Memories | Knowledge`. No new top-level
screen, no scattered indicators.

## Context (verified)

- `ScreenHeader` (`src/components/themed/ScreenHeader.tsx`) accepts
  `titleRight?: React.ReactNode`, `right?: React.ReactNode`, `subtitle?: string`.
  `ChatDetailScreen.tsx:2798-2839` currently puts the connection status dot in
  `titleRight` — wrap dot + mood chip in one View.
- `ChatDetailScreen.tsx:2901+` renders the in-chat overflow menu (Modal) with
  persona switcher, partner settings, background, bubble, disable, delete.
  `ChatConversationMenuModal.tsx` holds per-chat toggles (reply pacing etc.) on
  the chat list.
- Emotion data: `GET /api/entities/:id/emotion` → `EmotionResponseDto`
  (`EngineApiClient.ts:243-245`, `entityEmotion()` at `:1392`), repository
  `src/services/engine/repositories/emotion_state.ts` `getEmotionState(entityId)`
  → `EmotionState` (`database/models.ts:612-652`): 8 `*_intensity`, 8
  `*_baseline`, 8 `*_crystallize_start`, `decay_tau`, `high_threshold`,
  `low_threshold`, `crystallize_*`, `last_update`. Write paths are unsupported
  (engine owns writes) — this is a READ-ONLY indicator.
- `src/types/emoji.ts`: `EKMAN8_EMOTIONS = [joy, sadness, trust, disgust, fear,
  anger, surprise, anticipation]` (must stay in engine order).
- NO live emotion event exists in the app → v1 is pull-based: refresh on chat
  focus, on sheet open, and after each assistant turn. Show "as of <time>" so a
  stale vector is never presented as real-time. A sync event is a v2 engine
  companion (open item).
- Expressiveness: `config.CharacterProfileConfig.VocalExpressiveness`
  (`json:"vocal_expressiveness,omitempty"`) is marshalled directly by
  `handleListCharacterProfiles` (`routes_character_profiles.go:39-62`), so it is
  on the wire; `CharacterProfileDto` (`EngineApiClient.ts:259-290`) lacks the
  field. Levels `subdued | natural | expressive` (blank → natural), budgets
  cues 1/3/5 and tones 1/2/3. Owner decision: DERIVED, NOT a manual knob →
  READ-ONLY display in v1.
- Toggle: app-local AsyncStorage preference keyed by participantKey (like
  `utils/haptics.ts` persistence pattern). NO engine change in v1.

## Design

### 1. Mood chip (chat header)

`<status dot> <tap chip: "😊 Joy 7.2 · curious">` in `titleRight`.
Dominant emotion = max `*_intensity`; chip shows its label + value, plus a
muted secondary hint when a crystallization is active. Hidden entirely when the
toggle is off (default: off — opt-in). Accessible: `accessibilityRole="button"`,
label "Open character state", `testID="chat-mood-chip"`.

### 2. Toggle (chat settings)

New "Chat settings" entry in the in-chat overflow menu → small sheet with:

```
Show emotional state              [ ON  ]   ← chat.showEmotionState:<participantKey>
Show mood chip in header          (hint: off hides the chip but the state
                                  sheet stays reachable from this menu)
```

Also add the same toggle as a state-aware action in
`ChatConversationMenuModal` (chat list long-press) for parity — it owns the
per-chat settings snapshot. Default off; read once on chat focus; write
immediately (AsyncStorage) with an in-memory mirror so the chip flips without
waiting for a re-render fetch.

### 3. CharacterStateSheet (`State` tab)

- Header: avatar + name + "as of 14:32 · decays over ~1h" (from `decay_tau`).
- Dominant emotion card: big label + intensity, e.g. "Joy · 7.2 / baseline 3.1".
- All 8 emotions as horizontal bars (intensity vs max(`high_threshold`, 10)),
  each with a baseline tick and a small "crystallized" badge when
  `*_crystallize_start != null`. Colors: 8 distinct accent hues, consistent
  with `EmotionEffect` usage in `EmojiItem.tsx`.
- "Voice expression" card (READ-ONLY):
  ```
  Voice expression   [EXPRESSIVE]
  Cues 5 · tones 3 per message · derived from personality
  "Expressive" scales how often audible cues appear — the engine keeps a hard cap.
  ```
  Tap → deep link to the TTS config capability card (Phase 2), if reachable.
- Empty state: "No emotional state yet — it appears after the first turn."

### 4. Tabs

`State | Memories | Knowledge` — Phase 6 fills the latter two; ship the tab bar
in Phase 5 with disabled/placeholder tabs so the combined surface is visible
from day one.

## Steps

1. `EngineApiClient.ts` — add `vocal_expressiveness?: string` to
   `CharacterProfileDto`; add `EmotionStateDto` field list already present
   (`engineApiMappers.mapEmotionState` exists).
2. `src/utils/chatDisplayPrefs.ts` — AsyncStorage helpers
   `getShowEmotionState(participantKey)` / `setShowEmotionState(...)` with
   in-memory mirror; fail-safe default `false`.
3. `src/hooks/useEmotionState.ts` — refresh triggers (focus, sheet open, after
   assistant message), last-update timestamp, loading/empty/error states.
4. `src/components/chat/EmotionBars.tsx` + `CharacterStateSheet.tsx` (RN
   `Modal` bottom sheet, following `ScenarioGeneratorSheet.tsx` /
   `TtsTagPickerModal.tsx` conventions: safe-area insets, search-free,
   haptics, `useAppTheme`, `createLogger`).
5. `ChatDetailScreen.tsx` — mood chip in `titleRight`, menu entry +
   `ChatSettingsSheet` state, sheet mount; wire `chatEntityId` / `participantKey`.
6. `ChatConversationMenuModal.tsx` — add state-aware toggle action + prop.
7. i18n keys (Phase 7): `chatSettings`, `showEmotionState`,
   `showEmotionStateHint`, `characterState`, `emotionAsOf`, `dominantEmotion`,
   `emotionCrystallized`, `voiceExpressionLevel`, `voiceExpressionDerivedHint`,
   `emotionEmpty`, `tabState`, `tabMemories`, `tabKnowledge`.
8. Tests: chip hidden by default / visible when on; toggle persists per chat;
   bars render all 8 with dominance + crystallization; empty state; expressiveness
   read-only (no knob); `getEmotionState` failure degrades gracefully.

## Files

- `src/services/engine/EngineApiClient.ts`
- `src/utils/chatDisplayPrefs.ts` (new)
- `src/hooks/useEmotionState.ts` (new)
- `src/components/chat/EmotionBars.tsx` (new)
- `src/components/chat/CharacterStateSheet.tsx` (new)
- `src/components/chat/ChatSettingsSheet.tsx` (new, or inline in ChatDetailScreen)
- `src/screens/ChatDetailScreen.tsx`
- `src/components/chat/ChatConversationMenuModal.tsx`
- tests alongside each

## Checklist

- [ ] Mood chip (opt-in, tap → sheet) in chat header
- [ ] "Show emotional state" toggle in chat settings (+ chat-list parity)
- [ ] State tab: 8 emotion bars, baseline/crystallization, "as of" timestamp
- [ ] Expressiveness shown READ-ONLY with budget hint
- [ ] Tab bar shipped (Memories/Knowledge placeholders until Phase 6)
- [ ] No engine change; tests pass; nothing committed
