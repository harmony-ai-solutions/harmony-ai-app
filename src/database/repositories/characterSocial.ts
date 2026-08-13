/**
 * Character Social Repository — client-only social layer for AI characters.
 *
 * Everything here is stored in CLIENT-ONLY sidecar tables (never synced to the
 * engine — strict schema parity, see docs/schema-parity.md), mirroring the
 * `character_favorites` / `character_profile_sources` / `personas` pattern:
 *
 *   character_likes           — the local user liked this AI character
 *   character_saves           — the local user saved this AI character
 *   character_image_likes     — the local user liked a gallery image (post)
 *   character_image_comments  — comments on a gallery image (post)
 *   character_creators        — which cloud user created this AI character
 *
 * A profile with no rows simply means "not liked / not saved / no creator
 * recorded yet".
 */

import { getDatabase } from '../connection';
import { generateId } from '../../utils/uuid';
import { getCharacterProfile, getPrimaryImage } from './characters';
import { createDataURL } from '../base64';
import type { CharacterProfile } from '../models';

// ============================================================================
// Character Likes (profile-level)
// ============================================================================

/**
 * True when the local user has liked the character profile.
 */
export async function isCharacterLiked(profileId: string): Promise<boolean> {
  const db = getDatabase();
  const [results] = await db.executeSql(
    'SELECT 1 FROM character_likes WHERE profile_id = ?',
    [profileId],
  );
  return results.rows.length > 0;
}

/**
 * Like a character profile (idempotent).
 */
export async function addCharacterLike(profileId: string): Promise<void> {
  const db = getDatabase();
  await db.executeSql(
    `INSERT OR IGNORE INTO character_likes (profile_id, liked_at)
     VALUES (?, ?)`,
    [profileId, new Date().toISOString()],
  );
}

/**
 * Remove a character profile like (idempotent).
 */
export async function removeCharacterLike(profileId: string): Promise<void> {
  const db = getDatabase();
  await db.executeSql('DELETE FROM character_likes WHERE profile_id = ?', [
    profileId,
  ]);
}

/**
 * Toggle the like state and return the new state.
 */
export async function toggleCharacterLike(profileId: string): Promise<boolean> {
  const liked = await isCharacterLiked(profileId);
  if (liked) {
    await removeCharacterLike(profileId);
    return false;
  }
  await addCharacterLike(profileId);
  return true;
}

/**
 * Total number of likes on a character profile.
 */
export async function getCharacterLikesCount(profileId: string): Promise<number> {
  const db = getDatabase();
  const [results] = await db.executeSql(
    'SELECT COUNT(*) as count FROM character_likes WHERE profile_id = ?',
    [profileId],
  );
  return results.rows.item(0).count;
}

// ============================================================================
// Character Saves (My Profile > Saved)
// ============================================================================

/**
 * True when the local user has saved the character profile.
 */
export async function isCharacterSaved(profileId: string): Promise<boolean> {
  const db = getDatabase();
  const [results] = await db.executeSql(
    'SELECT 1 FROM character_saves WHERE profile_id = ?',
    [profileId],
  );
  return results.rows.length > 0;
}

/**
 * Save a character profile (idempotent).
 */
export async function addCharacterSave(profileId: string): Promise<void> {
  const db = getDatabase();
  await db.executeSql(
    `INSERT OR IGNORE INTO character_saves (profile_id, saved_at)
     VALUES (?, ?)`,
    [profileId, new Date().toISOString()],
  );
}

/**
 * Remove a character save (idempotent).
 */
export async function removeCharacterSave(profileId: string): Promise<void> {
  const db = getDatabase();
  await db.executeSql('DELETE FROM character_saves WHERE profile_id = ?', [
    profileId,
  ]);
}

/**
 * Toggle the saved state and return the new state.
 */
export async function toggleCharacterSave(profileId: string): Promise<boolean> {
  const saved = await isCharacterSaved(profileId);
  if (saved) {
    await removeCharacterSave(profileId);
    return false;
  }
  await addCharacterSave(profileId);
  return true;
}

/**
 * All saved profile IDs, most-recently-saved first.
 */
export async function getSavedCharacterProfileIds(): Promise<string[]> {
  const db = getDatabase();
  const [results] = await db.executeSql(
    'SELECT profile_id FROM character_saves ORDER BY saved_at DESC',
  );
  const ids: string[] = [];
  for (let i = 0; i < results.rows.length; i++) {
    ids.push(results.rows.item(i).profile_id);
  }
  return ids;
}

/** A saved character paired with its primary avatar data URL (for the grid). */
export interface SavedCharacterEntry {
  profile: CharacterProfile;
  avatarUri: string | null;
}

/**
 * All saved character profiles (most recently saved first) with their primary
 * avatar data URLs resolved. Soft-deleted profiles are skipped. Best-effort on
 * per-profile avatar loading (a failure yields a null avatar, not a throw).
 */
export async function getSavedCharacterEntries(): Promise<SavedCharacterEntry[]> {
  const ids = await getSavedCharacterProfileIds();
  const entries: SavedCharacterEntry[] = [];
  for (const profileId of ids) {
    try {
      const profile = await getCharacterProfile(profileId);
      if (!profile) continue; // soft-deleted or gone
      let avatarUri: string | null = null;
      try {
        const primary = await getPrimaryImage(profileId);
        if (primary) {
          avatarUri = createDataURL(primary.image_data, primary.mime_type);
        }
      } catch {
        avatarUri = null;
      }
      entries.push({ profile, avatarUri });
    } catch {
      // Skip profiles that fail to load entirely.
      continue;
    }
  }
  return entries;
}

// ============================================================================
// Character Image Likes (post-level interaction)
// ============================================================================

/**
 * True when the local user has liked a character image (post).
 */
export async function isImageLiked(imageId: number): Promise<boolean> {
  const db = getDatabase();
  const [results] = await db.executeSql(
    'SELECT 1 FROM character_image_likes WHERE image_id = ?',
    [imageId],
  );
  return results.rows.length > 0;
}

/**
 * Like a character image (idempotent).
 */
export async function addImageLike(imageId: number): Promise<void> {
  const db = getDatabase();
  await db.executeSql(
    `INSERT OR IGNORE INTO character_image_likes (image_id, liked_at)
     VALUES (?, ?)`,
    [imageId, new Date().toISOString()],
  );
}

/**
 * Remove a character image like (idempotent).
 */
export async function removeImageLike(imageId: number): Promise<void> {
  const db = getDatabase();
  await db.executeSql('DELETE FROM character_image_likes WHERE image_id = ?', [
    imageId,
  ]);
}

/**
 * Toggle an image like and return the new state.
 */
export async function toggleImageLike(imageId: number): Promise<boolean> {
  const liked = await isImageLiked(imageId);
  if (liked) {
    await removeImageLike(imageId);
    return false;
  }
  await addImageLike(imageId);
  return true;
}

/**
 * Total number of likes on a character image (post).
 */
export async function getImageLikesCount(imageId: number): Promise<number> {
  const db = getDatabase();
  const [results] = await db.executeSql(
    'SELECT COUNT(*) as count FROM character_image_likes WHERE image_id = ?',
    [imageId],
  );
  return results.rows.item(0).count;
}

// ============================================================================
// Character Image Comments (post-level interaction)
// ============================================================================

export interface CharacterImageComment {
  id: string;
  imageId: number;
  authorUserId: string | null;
  authorDisplayName: string;
  authorAvatarUrl: string | null;
  text: string;
  createdAt: Date;
}

/**
 * Add a comment to a character image. Returns the created comment.
 */
export async function addImageComment(input: {
  imageId: number;
  authorUserId: string | null;
  authorDisplayName: string;
  authorAvatarUrl: string | null;
  text: string;
}): Promise<CharacterImageComment> {
  const db = getDatabase();
  const id = generateId();
  const now = new Date();
  await db.executeSql(
    `INSERT INTO character_image_comments (
       id, image_id, author_user_id, author_display_name, author_avatar_url,
       text, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.imageId,
      input.authorUserId,
      input.authorDisplayName.trim() || '',
      input.authorAvatarUrl,
      input.text.trim(),
      now.toISOString(),
    ],
  );
  return {
    id,
    imageId: input.imageId,
    authorUserId: input.authorUserId,
    authorDisplayName: input.authorDisplayName.trim() || '',
    authorAvatarUrl: input.authorAvatarUrl,
    text: input.text.trim(),
    createdAt: now,
  };
}

/**
 * All comments on a character image, oldest first.
 */
export async function getImageComments(
  imageId: number,
): Promise<CharacterImageComment[]> {
  const db = getDatabase();
  const [results] = await db.executeSql(
    'SELECT id, image_id, author_user_id, author_display_name, author_avatar_url, text, created_at FROM character_image_comments WHERE image_id = ? ORDER BY created_at ASC',
    [imageId],
  );
  const comments: CharacterImageComment[] = [];
  for (let i = 0; i < results.rows.length; i++) {
    const row = results.rows.item(i);
    comments.push({
      id: row.id,
      imageId: row.image_id,
      authorUserId: row.author_user_id,
      authorDisplayName: row.author_display_name,
      authorAvatarUrl: row.author_avatar_url,
      text: row.text,
      createdAt: new Date(row.created_at),
    });
  }
  return comments;
}

/**
 * Delete a comment (only meaningful for the author — the UI gates this).
 */
export async function deleteImageComment(id: string): Promise<void> {
  const db = getDatabase();
  await db.executeSql('DELETE FROM character_image_comments WHERE id = ?', [id]);
}

/**
 * Total number of comments on a character image (post).
 */
export async function getImageCommentsCount(imageId: number): Promise<number> {
  const db = getDatabase();
  const [results] = await db.executeSql(
    'SELECT COUNT(*) as count FROM character_image_comments WHERE image_id = ?',
    [imageId],
  );
  return results.rows.item(0).count;
}

// ============================================================================
// Character Creator (creator badge + creator-only editing)
// ============================================================================

export interface CharacterCreator {
  profileId: string;
  creatorUserId: string;
  creatorDisplayName: string;
  creatorAvatarUrl: string | null;
}

/**
 * Record which cloud user created an AI character. Idempotent — the FIRST
 * creator wins (a community character later adopted by another user keeps its
 * original creator).
 */
export async function setCharacterCreator(input: {
  profileId: string;
  creatorUserId: string;
  creatorDisplayName: string;
  creatorAvatarUrl: string | null;
}): Promise<void> {
  const db = getDatabase();
  await db.executeSql(
    `INSERT OR IGNORE INTO character_creators (
       profile_id, creator_user_id, creator_display_name, creator_avatar_url, created_at
     ) VALUES (?, ?, ?, ?, ?)`,
    [
      input.profileId,
      input.creatorUserId,
      input.creatorDisplayName.trim() || '',
      input.creatorAvatarUrl,
      new Date().toISOString(),
    ],
  );
}

/**
 * The recorded creator of a character profile, or null when none is known.
 */
export async function getCharacterCreator(
  profileId: string,
): Promise<CharacterCreator | null> {
  const db = getDatabase();
  const [results] = await db.executeSql(
    'SELECT profile_id, creator_user_id, creator_display_name, creator_avatar_url FROM character_creators WHERE profile_id = ?',
    [profileId],
  );
  if (results.rows.length === 0) return null;
  const row = results.rows.item(0);
  return {
    profileId: row.profile_id,
    creatorUserId: row.creator_user_id,
    creatorDisplayName: row.creator_display_name,
    creatorAvatarUrl: row.creator_avatar_url,
  };
}

/**
 * True when the given user id is the recorded creator of the profile.
 * A profile with no creator record is never "owned" by anyone.
 */
export async function isCharacterCreator(
  profileId: string,
  userId: string | null | undefined,
): Promise<boolean> {
  if (!userId) return false;
  const creator = await getCharacterCreator(profileId);
  return creator !== null && creator.creatorUserId === userId;
}
