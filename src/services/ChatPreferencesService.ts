/**
 * Chat Preferences Service
 *
 * Manages per-chat-partner entity selection preferences using AsyncStorage.
 * Allows users to persist which entity they want to impersonate for each chat.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createLogger } from '../utils/logger';

const log = createLogger('[ChatPreferencesService]');
const GLOBAL_ENTITY_KEY = 'chat_global_impersonated_entity';
// Reply pacing preference (A6): stored per participant key. The `@harmony_`
// prefix matches the app's reserved AsyncStorage key convention (cf.
// `@harmony_character_categories`, `@harmony_setting_biometric_lock`).
// Interim client-side storage — becomes a synced `chat_conversation_settings`
// column in engine Phase 2 (B2). Kept here; dies in Phase 4-4.
const REPLY_MODE_PREFIX = '@harmony_chat_reply_mode_';
// Legacy "chat as an AI character" per-chat persona preference (O2/P4). Dead —
// persona resolution now runs off `entities` (the persona switcher + global
// key). These keys are swept once at app bootstrap (Q14); nothing writes them.
const LEGACY_ENTITY_PREF_PREFIX = 'chat_entity_pref_';

/** Reply pacing for a conversation: instant, or realistic (typing-delay). */
export type ChatReplyMode = 'instant' | 'realistic';

/**
 * Get the globally selected impersonated entity (used across all chats).
 * Falls back to null if no preference is set.
 */
async function getGlobalImpersonatedEntity(): Promise<string | null> {
  try {
    const value = await AsyncStorage.getItem(GLOBAL_ENTITY_KEY);
    log.debug(`Retrieved global impersonated entity: ${value}`);
    return value;
  } catch (error) {
    log.error('Failed to get global impersonated entity:', error);
    return null;
  }
}

/**
 * Set the globally selected impersonated entity.
 * @param entityId The entity ID to use as the global persona
 */
async function setGlobalImpersonatedEntity(entityId: string): Promise<void> {
  try {
    await AsyncStorage.setItem(GLOBAL_ENTITY_KEY, entityId);
    log.info(`Set global impersonated entity: ${entityId}`);
  } catch (error) {
    log.error('Failed to set global impersonated entity:', error);
    throw error;
  }
}

/**
 * Get the reply pacing mode for a specific chat (A6).
 * Returns "realistic" if no preference is stored (default behavior).
 * @param participantKey The participant key (engine-aligned, F4/O3) of the chat
 * @returns "instant" or "realistic"
 */
async function getReplyMode(participantKey: string): Promise<ChatReplyMode> {
  try {
    const key = `${REPLY_MODE_PREFIX}${participantKey}`;
    const value = await AsyncStorage.getItem(key);
    return value === 'instant' ? 'instant' : 'realistic';
  } catch (error) {
    log.error(`Failed to get reply mode for ${participantKey}:`, error);
    return 'realistic';
  }
}

/**
 * Set the reply pacing mode for a specific chat (A6).
 * @param participantKey The participant key (engine-aligned, F4/O3) of the chat
 * @param mode "instant" or "realistic"
 */
async function setReplyMode(participantKey: string, mode: ChatReplyMode): Promise<void> {
  try {
    const key = `${REPLY_MODE_PREFIX}${participantKey}`;
    await AsyncStorage.setItem(key, mode);
    log.info(`Set reply mode for ${participantKey}: ${mode}`);
  } catch (error) {
    log.error(`Failed to set reply mode for ${participantKey}:`, error);
    throw error;
  }
}

/**
 * One-time sweep of dead legacy `chat_entity_pref_*` AsyncStorage keys (Q14).
 *
 * These are the O2/P4 "chat as an AI character" per-chat persona prefs. Persona
 * resolution now runs off `entities` (resolvePersonaId sanitizes a stale value),
 * so the keys are dead weight. Enumerates AsyncStorage, removes every key with
 * the `chat_entity_pref_` prefix, and leaves everything else (global entity
 * key, reply-mode keys) untouched. Best-effort — never throws.
 *
 * Called ONCE lazily from the app-shell bootstrap (App.tsx).
 */
async function sweepLegacyEntityPrefs(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const legacyKeys = (keys ?? []).filter(key =>
      key.startsWith(LEGACY_ENTITY_PREF_PREFIX),
    );
    if (legacyKeys.length > 0) {
      await AsyncStorage.multiRemove(legacyKeys);
      log.info(`Swept ${legacyKeys.length} legacy chat_entity_pref_* keys`);
    }
  } catch (error) {
    log.error('Failed to sweep legacy entity prefs:', error);
  }
}

export default {
  getGlobalImpersonatedEntity,
  setGlobalImpersonatedEntity,
  getReplyMode,
  setReplyMode,
  sweepLegacyEntityPrefs,
};
