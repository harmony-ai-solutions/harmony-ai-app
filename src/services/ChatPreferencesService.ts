/**
 * Chat Preferences Service
 * 
 * Manages per-chat-partner entity selection preferences using AsyncStorage.
 * Allows users to persist which entity they want to impersonate for each chat.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createLogger } from '../utils/logger';

const log = createLogger('[ChatPreferencesService]');
const STORAGE_KEY_PREFIX = 'chat_entity_pref_';

/**
 * Get the preferred impersonated entity for a chat partner
 * @param partnerEntityId The entity ID of the chat partner
 * @returns The entity ID to impersonate, or null if no preference set
 */
async function getPreferredEntity(partnerEntityId: string): Promise<string | null> {
  try {
    const key = `${STORAGE_KEY_PREFIX}${partnerEntityId}`;
    const value = await AsyncStorage.getItem(key);
    log.debug(`Retrieved preference for ${partnerEntityId}: ${value}`);
    return value;
  } catch (error) {
    log.error(`Failed to get preference for ${partnerEntityId}:`, error);
    return null;
  }
}

/**
 * Set the preferred impersonated entity for a chat partner
 * @param partnerEntityId The entity ID of the chat partner
 * @param impersonatedEntityId The entity ID to impersonate
 */
async function setPreferredEntity(
  partnerEntityId: string,
  impersonatedEntityId: string
): Promise<void> {
  try {
    const key = `${STORAGE_KEY_PREFIX}${partnerEntityId}`;
    await AsyncStorage.setItem(key, impersonatedEntityId);
    log.info(`Set preference for ${partnerEntityId} → ${impersonatedEntityId}`);
  } catch (error) {
    log.error(`Failed to set preference for ${partnerEntityId}:`, error);
    throw error;
  }
}

/**
 * Clear the preferred impersonated entity for a chat partner
 * @param partnerEntityId The entity ID of the chat partner
 */
async function clearPreferredEntity(partnerEntityId: string): Promise<void> {
  try {
    const key = `${STORAGE_KEY_PREFIX}${partnerEntityId}`;
    await AsyncStorage.removeItem(key);
    log.info(`Cleared preference for ${partnerEntityId}`);
  } catch (error) {
    log.error(`Failed to clear preference for ${partnerEntityId}:`, error);
    throw error;
  }
}

export default {
  getPreferredEntity,
  setPreferredEntity,
  clearPreferredEntity,
};
