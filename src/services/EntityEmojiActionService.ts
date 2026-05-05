/**
 * EntityEmojiActionService - Manages per-entity emoji action mappings
 *
 * Handles CRUD operations for emoji actions and resolves message text
 * by substituting emoji with RP text and collecting emotion effects.
 */
import { createLogger } from '../utils/logger';
import { EmojiService } from './EmojiService';
import { EmojiAction } from '../database/models';
import {
  EmotionEffect,
  AdditionalEffects,
  ResolvedMessageActions,
  Ekman8Emotion,
} from '../types/emoji';
import * as emojiActionRepo from '../database/repositories/emoji_actions';

const log = createLogger('[EntityEmojiActionService]');

// Default action seeds for initial population
interface DefaultActionSeed {
  emoji: string;
  emotion?: EmotionEffect;
  metabolism?: { type: string; item: string };
  substitution: string;
}

const DEFAULT_ACTION_SEEDS: DefaultActionSeed[] = [
  // Food & Drink — sender offers/shares with the AI character
  { emoji: '🍔', metabolism: { type: 'eat', item: 'a burger' }, emotion: { emotion: 'joy', delta: 1.5 }, substitution: '*offers you a juicy burger to enjoy*' },
  { emoji: '🍕', metabolism: { type: 'eat', item: 'a pizza' }, emotion: { emotion: 'joy', delta: 1.0 }, substitution: '*shares a slice of pizza with you*' },
  { emoji: '🍎', metabolism: { type: 'eat', item: 'an apple' }, emotion: { emotion: 'trust', delta: 0.5 }, substitution: '*hands you a fresh, crisp apple*' },
  { emoji: '🥗', metabolism: { type: 'eat', item: 'a salad' }, emotion: { emotion: 'trust', delta: 0.5 }, substitution: '*sets a fresh salad in front of you*' },
  { emoji: '🍰', metabolism: { type: 'eat', item: 'a slice of cake' }, emotion: { emotion: 'joy', delta: 2.0 }, substitution: '*slides a generous slice of cake toward you with a smile*' },
  { emoji: '☕', metabolism: { type: 'drink', item: 'a coffee' }, emotion: { emotion: 'anticipation', delta: 1.0 }, substitution: '*hands you a warm, freshly brewed cup of coffee*' },
  { emoji: '🍵', metabolism: { type: 'drink', item: 'some tea' }, emotion: { emotion: 'trust', delta: 1.0 }, substitution: '*pours you a soothing cup of tea*' },
  { emoji: '🍺', metabolism: { type: 'drink', item: 'a beer' }, emotion: { emotion: 'joy', delta: 1.5 }, substitution: '*cracks open a cold beer and passes it to you*' },
  { emoji: '💧', metabolism: { type: 'drink', item: 'some water' }, emotion: { emotion: 'trust', delta: 0.3 }, substitution: '*hands you a cold glass of water*' },
  { emoji: '🍷', metabolism: { type: 'drink', item: 'some wine' }, emotion: { emotion: 'joy', delta: 1.5 }, substitution: '*pours you a glass of wine and raises their own in a toast*' },
  // Emotion — sender expresses feeling toward the AI character
  { emoji: '❤️', emotion: { emotion: 'joy', delta: 3.0 }, substitution: '*wraps you in a warm embrace, showing deep affection*' },
  { emoji: '😢', emotion: { emotion: 'sadness', delta: 2.0 }, substitution: '*looks at you with tearful eyes, clearly moved*' },
  { emoji: '😡', emotion: { emotion: 'anger', delta: 2.5 }, substitution: '*turns to you with visible frustration*' },
  { emoji: '😱', emotion: { emotion: 'fear', delta: 2.5 }, substitution: '*grabs your arm in sudden panic*' },
  { emoji: '😄', emotion: { emotion: 'joy', delta: 2.0 }, substitution: '*grins at you with genuine happiness*' },
  // Actions — sender does something toward or with the AI character
  { emoji: '👋', emotion: { emotion: 'anticipation', delta: 0.5 }, substitution: '*waves at you cheerfully in greeting*' },
  { emoji: '🤗', emotion: { emotion: 'trust', delta: 2.0 }, substitution: '*pulls you into a warm, tight hug*' },
  { emoji: '💤', emotion: { emotion: 'sadness', delta: -0.5 }, substitution: '*yawns and starts drifting off to sleep beside you*' },
  { emoji: '🎶', emotion: { emotion: 'joy', delta: 1.5 }, substitution: '*hums a cheerful melody for you*' },
  { emoji: '📖', emotion: { emotion: 'anticipation', delta: 1.0 }, substitution: '*settles down to read quietly beside you*' },
];

// Generate a unique ID
function generateId(): string {
  return `ea_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

// Clamp a value between min and max
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

class EntityEmojiActionServiceClass {
  // In-memory cache: entityId -> (emojiNative -> EmojiAction)
  private actionCache: Map<string, Map<string, EmojiAction>> = new Map();

  /**
   * Get the actions map for an entity (cached)
   */
  async getActionsMap(entityId: string): Promise<Map<string, EmojiAction>> {
    let cached = this.actionCache.get(entityId);
    if (cached) {
      return cached;
    }

    // Load from database
    const map = await emojiActionRepo.getEmojiActionsForEntity(entityId);
    this.actionCache.set(entityId, map);
    return map;
  }

  /**
   * Get a single action for an entity + emoji
   */
  async getAction(entityId: string, emojiNative: string): Promise<EmojiAction | null> {
    const actionsMap = await this.getActionsMap(entityId);
    return actionsMap.get(emojiNative) || null;
  }

  /**
   * Get all actions for an entity as an array (for editor screen)
   */
  async getAllActions(entityId: string): Promise<EmojiAction[]> {
    return emojiActionRepo.getAllEmojiActionsArray(entityId);
  }

  /**
   * Save (upsert) an emoji action
   */
  async saveAction(action: Omit<EmojiAction, 'createdAt' | 'updatedAt'>): Promise<void> {
    await emojiActionRepo.upsertEmojiAction(action);
    this.invalidateCache(action.entityId);
    log.debug(`Saved emoji action for entity ${action.entityId}, emoji ${action.emojiNative}`);
  }

  /**
   * Remove an emoji action by ID
   */
  async removeAction(actionId: string, entityId: string): Promise<void> {
    await emojiActionRepo.deleteEmojiAction(actionId);
    this.invalidateCache(entityId);
    log.debug(`Removed emoji action ${actionId}`);
  }

  /**
   * Resolve emoji actions in a message text
   * - Splits text into segments
   * - Replaces emojis with substitution text
   * - Collects and aggregates emotion effects
   */
  async resolveMessageActions(entityId: string, text: string): Promise<ResolvedMessageActions> {
    // Get actions map
    const actionsMap = await this.getActionsMap(entityId);

    // Split text on emojis
    const segments = EmojiService.splitTextOnEmojis(text);

    // Build substituted text and collect effects
    const substitutedParts: string[] = [];
    const collectedEffects: EmotionEffect[] = [];

    for (const segment of segments) {
      if (segment.type === 'text') {
        substitutedParts.push(segment.value);
      } else if (segment.type === 'emoji') {
        const action = actionsMap.get(segment.value);
        if (action && action.substitutionText) {
          // Replace emoji with substitution text
          substitutedParts.push(action.substitutionText);
          // Collect emotion effect if present
          if (action.emotionEffect) {
            collectedEffects.push(action.emotionEffect);
          }
        } else {
          // No action found, keep original emoji
          substitutedParts.push(segment.value);
        }
      }
    }

    // Aggregate emotion effects with clamping
    const aggregatedEffects = this.aggregateEmotionEffects(collectedEffects);

    return {
      substitutedText: substitutedParts.join(''),
      effects: {
        emotionEffects: aggregatedEffects,
      },
      hasActions: collectedEffects.length > 0,
    };
  }

  /**
   * Aggregate emotion effects with clamping rule:
   * - Group effects by emotion name
   * - Sum all deltas
   * - Clamp result: result = clamp(sum, negCeiling, posCeiling)
   *   where posCeiling = max positive individual delta, negCeiling = min negative delta
   */
  aggregateEmotionEffects(effects: EmotionEffect[]): EmotionEffect[] {
    // Group by emotion
    const grouped: Map<Ekman8Emotion, EmotionEffect[]> = new Map();
    for (const effect of effects) {
      const existing = grouped.get(effect.emotion) || [];
      existing.push(effect);
      grouped.set(effect.emotion, existing);
    }

    // Aggregate each group
    const result: EmotionEffect[] = [];
    for (const [emotion, groupEffects] of grouped) {
      // Sum all deltas
      const sum = groupEffects.reduce((acc, e) => acc + e.delta, 0);

      // Find posCeiling (max positive individual delta)
      const positives = groupEffects.filter(e => e.delta > 0);
      const posCeiling = positives.length > 0
        ? Math.max(...positives.map(e => e.delta))
        : 0;

      // Find negCeiling (min negative individual delta, i.e., most negative)
      const negatives = groupEffects.filter(e => e.delta < 0);
      const negCeiling = negatives.length > 0
        ? Math.min(...negatives.map(e => e.delta))
        : 0;

      // Apply clamping
      const clampedSum = clamp(sum, negCeiling, posCeiling);

      // Only include non-zero results
      if (Math.abs(clampedSum) > 0.001) {
        result.push({
          emotion,
          delta: clampedSum,
        });
      }
    }

    return result;
  }

  /**
   * Generate substitution text from emotion effect and/or metabolism
   */
  generateSubstitutionText(action: EmojiAction): string {
    const parts: string[] = [];

    if (action.metabolismVector) {
      const { type, item } = action.metabolismVector;
      if (type === 'eat') {
        parts.push(`*eats ${item}*`);
      } else if (type === 'drink') {
        parts.push(`*drinks ${item}*`);
      } else if (type === 'sleep') {
        parts.push(`*falls asleep*`);
      } else {
        parts.push(`*does ${type} ${item}*`);
      }
    }

    if (action.emotionEffect) {
      const { emotion, delta } = action.emotionEffect;
      if (delta > 0) {
        if (emotion === 'joy') parts.push('*feels happy*');
        else if (emotion === 'sadness') parts.push('*feels sad*');
        else if (emotion === 'anger') parts.push('*feels angry*');
        else if (emotion === 'fear') parts.push('*feels afraid*');
        else if (emotion === 'trust') parts.push('*feels trusting*');
        else if (emotion === 'disgust') parts.push('*feels disgusted*');
        else if (emotion === 'surprise') parts.push('*feels surprised*');
        else if (emotion === 'anticipation') parts.push('*feels expectant*');
      } else if (delta < 0) {
        if (emotion === 'joy') parts.push('*feels less happy*');
        else if (emotion === 'sadness') parts.push('*feels less sad*');
        else if (emotion === 'anger') parts.push('*feels less angry*');
        else if (emotion === 'fear') parts.push('*feels less afraid*');
        else parts.push(`*feels less ${emotion}*`);
      }
    }

    return parts.join(' ') || '*performs an action*';
  }

  /**
   * Seed default emoji actions for an entity
   */
  async seedDefaults(entityId: string, force: boolean = false): Promise<number> {
    // Check if already has actions
    if (!force) {
      const count = await emojiActionRepo.countEmojiActions(entityId);
      if (count > 0) {
        log.debug(`Entity ${entityId} already has ${count} emoji actions, skipping seed`);
        return 0;
      }
    }

    // When forcing, delete existing defaults first (preserves user-created actions)
    if (force) {
      const removed = await emojiActionRepo.deleteDefaultEmojiActions(entityId);
      log.debug(`Removed ${removed} existing default emoji actions for entity ${entityId}`);
    }

    // Create default actions
    let seeded = 0;
    for (const seed of DEFAULT_ACTION_SEEDS) {
      const action: Omit<EmojiAction, 'createdAt' | 'updatedAt'> = {
        id: generateId(),
        entityId,
        emojiNative: seed.emoji,
        emotionEffect: seed.emotion || null,
        metabolismVector: seed.metabolism || null,
        substitutionText: seed.substitution,
        autoGenerated: true,
        isDefault: true,
      };

      await emojiActionRepo.upsertEmojiAction(action);
      seeded++;
    }

    // Invalidate cache
    this.invalidateCache(entityId);
    log.info(`Seeded ${seeded} default emoji actions for entity ${entityId}`);
    return seeded;
  }

  /**
   * Invalidate cache for an entity
   */
  invalidateCache(entityId: string): void {
    this.actionCache.delete(entityId);
    log.debug(`Invalidated cache for entity ${entityId}`);
  }

  /**
   * Invalidate all caches
   */
  invalidateAllCaches(): void {
    this.actionCache.clear();
    log.debug('Invalidated all emoji action caches');
  }
}

// Export singleton instance
export const EntityEmojiActionService = new EntityEmojiActionServiceClass();
export default EntityEmojiActionService;