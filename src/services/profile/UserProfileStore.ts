/**
 * UserProfileStore — local persistence for My Profile extras.
 *
 * The cloud `GET /v1/auth/me` response carries only the base UserProfile
 * (id, email, display_name, ...). This store persists the profile fields the
 * My Profile feature adds on top — username, bio and the locally-picked
 * avatar (base64 data URL) — so the profile is fully editable and survives
 * app restarts without requiring a backend endpoint yet.
 *
 * Storage is scoped per user id (`@harmony_profile/<userId>`) so switching
 * cloud accounts shows the correct profile. When the backend grows a
 * `PATCH /v1/auth/me`, this store remains the offline cache / merge layer.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createLogger } from '../../utils/logger';

const log = createLogger('[UserProfileStore]');

const STORAGE_PREFIX = '@harmony_profile';

export interface LocalProfileData {
  /** Display name — persisted locally because the backend has no profile
   *  update endpoint yet. MyProfileScreen prefers this over the cloud value. */
  displayName?: string;
  username?: string;
  bio?: string;
  /** Base64 data URL (e.g. "data:image/jpeg;base64,...") or null when removed. */
  avatar_data_url?: string | null;
}

function storageKey(userId: string): string {
  return `${STORAGE_PREFIX}/${userId}`;
}

/**
 * Load the locally-stored profile extras for a user.
 * Returns an empty object when nothing is stored yet.
 */
export async function getLocalProfile(userId: string): Promise<LocalProfileData> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(userId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as LocalProfileData;
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch (err) {
    log.error(`Failed to load local profile for ${userId}:`, err);
    return {};
  }
}

/**
 * Persist (merge) profile extras for a user. Passed fields are merged over
 * whatever is stored; pass `avatar_data_url: null` to clear the avatar.
 */
export async function saveLocalProfile(
  userId: string,
  data: LocalProfileData,
): Promise<void> {
  try {
    const existing = await getLocalProfile(userId);
    const merged: LocalProfileData = { ...existing, ...data };
    await AsyncStorage.setItem(storageKey(userId), JSON.stringify(merged));
  } catch (err) {
    log.error(`Failed to save local profile for ${userId}:`, err);
    throw err;
  }
}

/**
 * Clear all stored profile extras for a user (used on logout / account switch).
 */
export async function clearLocalProfile(userId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(storageKey(userId));
  } catch (err) {
    log.error(`Failed to clear local profile for ${userId}:`, err);
  }
}

export default {
  getLocalProfile,
  saveLocalProfile,
  clearLocalProfile,
};
