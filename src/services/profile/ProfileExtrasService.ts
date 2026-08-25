/**
 * ProfileExtrasService — STUB SEAM for per-device profile extras (username,
 * bio, locally-picked avatar).
 *
 * The cloud `GET /v1/auth/me` profile carries only the base fields —
 * `display_name` is the single cloud-persisted field today
 * (`AuthService.updateDisplayName` → `PATCH /v1/auth/me`). Username, bio and
 * avatar have NO backend endpoint yet; the extension is tracked in
 * `.current_work/senju-rebase-integration/20-Backend-Concept-Marketplace-Profile.md`
 * §5 (extend PATCH /v1/auth/me with `username` / `bio` + an avatar upload
 * endpoint + `avatar_url` in responses). Until then this module is the
 * EXPLICIT stub seam: an AsyncStorage preview scoped per user id
 * (`@harmony_profile/<userId>` — deliberately the OLD UserProfileStore key so
 * existing dev devices keep their data).
 *
 * Follows the CategoryPreferencesService pattern: module-level key constant,
 * plain async functions, AsyncStorage-only persistence, default export.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createLogger } from '../../utils/logger';

const log = createLogger('[ProfileExtrasService]');

/** Storage prefix — reused from the deleted UserProfileStore shadow store. */
const STORAGE_PREFIX = '@harmony_profile';

/** Per-user profile extras (the stub seam's persisted shape). */
export interface ProfileExtras {
  username: string;
  bio: string;
  /** Base64 data URL (e.g. "data:image/jpeg;base64,...") or null when none. */
  avatarDataUrl: string | null;
}

const EMPTY_EXTRAS: ProfileExtras = { username: '', bio: '', avatarDataUrl: null };

function storageKey(userId: string): string {
  return `${STORAGE_PREFIX}/${userId}`;
}

/**
 * Load the locally-stored extras for a user. Returns the empty shape
 * ({ username: '', bio: '', avatarDataUrl: null }) when nothing is stored or
 * the stored value is malformed (defensive parse).
 */
async function getExtras(userId: string): Promise<ProfileExtras> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(userId));
    if (!raw) return { ...EMPTY_EXTRAS };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return { ...EMPTY_EXTRAS };
    const rec = parsed as Record<string, unknown>;
    return {
      username: typeof rec.username === 'string' ? rec.username : '',
      bio: typeof rec.bio === 'string' ? rec.bio : '',
      avatarDataUrl: typeof rec.avatarDataUrl === 'string' ? rec.avatarDataUrl : null,
    };
  } catch (error) {
    log.error(`Failed to read profile extras for ${userId}:`, error);
    return { ...EMPTY_EXTRAS };
  }
}

/**
 * Persist the user's extras — FULL REPLACE of the stored shape with the given
 * value (strings are trimmed; `avatarDataUrl` passes through as-is).
 * @throws Rethrows AsyncStorage write failures (no fake success).
 */
async function saveExtras(userId: string, extras: ProfileExtras): Promise<void> {
  const clean: ProfileExtras = {
    username: extras.username.trim(),
    bio: extras.bio.trim(),
    avatarDataUrl: extras.avatarDataUrl,
  };
  await AsyncStorage.setItem(storageKey(userId), JSON.stringify(clean));
  log.info(`Saved profile extras for ${userId}`);
}

export default {
  getExtras,
  saveExtras,
};