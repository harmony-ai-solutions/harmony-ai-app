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
const LAST_READ_PREFIX = 'chat_last_read_';

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

/**
 * Get the last-read timestamp for a specific chat
 * Returns 0 if no timestamp is stored (all messages are new)
 * @param partnerEntityId The entity ID of the chat partner
 * @returns Unix timestamp in milliseconds, or 0 if not set
 */
async function getLastReadTimestamp(partnerEntityId: string): Promise<number> {
  try {
    const key = `${LAST_READ_PREFIX}${partnerEntityId}`;
    const value = await AsyncStorage.getItem(key);
    
    if (value === null) {
      return 0;
    }
    
    const timestamp = parseInt(value, 10);
    return isNaN(timestamp) ? 0 : timestamp;
  } catch (error) {
    log.error(`Failed to get last-read timestamp for ${partnerEntityId}:`, error);
    return 0;
  }
}

/**
 * Set the last-read timestamp for a specific chat
 * @param partnerEntityId The entity ID of the chat partner
 * @param timestamp Unix timestamp in milliseconds
 */
async function setLastReadTimestamp(partnerEntityId: string, timestamp: number): Promise<void> {
  try {
    const key = `${LAST_READ_PREFIX}${partnerEntityId}`;
    await AsyncStorage.setItem(key, timestamp.toString());
    log.debug(`Updated last-read timestamp for ${partnerEntityId}: ${timestamp}`);
  } catch (error) {
    log.error(`Failed to set last-read timestamp for ${partnerEntityId}:`, error);
  }
}

/**
 * Clear last-read timestamp for a specific chat
 * @param partnerEntityId The entity ID of the chat partner
 */
async function clearLastReadTimestamp(partnerEntityId: string): Promise<void> {
  try {
    const key = `${LAST_READ_PREFIX}${partnerEntityId}`;
    await AsyncStorage.removeItem(key);
    log.debug(`Cleared last-read timestamp for ${partnerEntityId}`);
  } catch (error) {
    log.error(`Failed to clear last-read timestamp for ${partnerEntityId}:`, error);
  }
}

/**
 * Mark all messages as read (set timestamp to now)
 * @param partnerEntityId The entity ID of the chat partner
 */
async function markAllAsRead(partnerEntityId: string): Promise<void> {
  await setLastReadTimestamp(partnerEntityId, Date.now());
}

export default {
  getPreferredEntity,
  setPreferredEntity,
  clearPreferredEntity,
  getLastReadTimestamp,
  setLastReadTimestamp,
  clearLastReadTimestamp,
  markAllAsRead,
};
