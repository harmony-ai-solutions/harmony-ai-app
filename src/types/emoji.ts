/**
 * Emoji Type Definitions
 */

export type EmojiSet = 'native' | 'noto' | 'twemoji';

export interface EmojiSkin {
  unified: string;
  native: string;
  sheetX: number;
  sheetY: number;
}

export interface EmojiEntry {
  id: string;
  name: string;
  native: string;
  unified: string;
  category: string;
  keywords: string[];
  skins: EmojiSkin[];
  sheetX: number;
  sheetY: number;
}

export interface EmojiCategory {
  id: string;
  name: string;
  icon: string;
  emojis: EmojiEntry[];
}

export interface TextSegment {
  type: 'text' | 'emoji';
  value: string;
  emojiEntry?: EmojiEntry;
}

export interface EmojiStylePreference {
  set: EmojiSet;
  skinTone: number;
}

// ============================================================================
// Emoji Action Types (Phases 10-17)
// ============================================================================

/**
 * The 8 Ekman/Plutchik base emotions.
 * Must match exactly the backend's emotion.Ekman8Names.
 */
export type Ekman8Emotion =
  | 'joy'
  | 'sadness'
  | 'trust'
  | 'disgust'
  | 'fear'
  | 'anger'
  | 'surprise'
  | 'anticipation';

/**
 * Array of all Ekman8 emotion names for iteration/validation.
 */
export const EKMAN8_EMOTIONS: Ekman8Emotion[] = [
  'joy',
  'sadness',
  'trust',
  'disgust',
  'fear',
  'anger',
  'surprise',
  'anticipation',
];

/**
 * A single emotion effect: an emotion name + a signed intensity delta.
 */
export interface EmotionEffect {
  emotion: Ekman8Emotion;
  delta: number; // signed, range -5.0 to +5.0
}

/**
 * Metabolism vector placeholder.
 */
export interface MetabolismVector {
  type: string;    // e.g., "eat", "drink", "sleep"
  item: string;    // e.g., "burger", "water", "coffee"
}

/**
 * An emoji action mapping — defines what happens when a specific emoji is sent.
 * Defined in src/database/models.ts as EmojiAction.
 */

/**
 * AdditionalEffects payload sent with an utterance to the backend.
 */
export interface AdditionalEffects {
  emotionEffects: EmotionEffect[];
}

/**
 * Result of resolving all emoji actions in a message text.
 */
export interface ResolvedMessageActions {
  substitutedText: string;
  effects: AdditionalEffects;
  hasActions: boolean;
}