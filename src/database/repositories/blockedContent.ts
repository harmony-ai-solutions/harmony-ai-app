/**
 * Blocked Content Filtering
 *
 * Central helper for hiding content belonging to blocked cloud users across
 * every surface (Discover, Market, Characters, profile pages). A blocked
 * user's AI characters (character_creators rows), user posts (author rows),
 * and profile are excluded until unblocked.
 *
 * Kept separate from `characters` / `userSocial` so there are no circular
 * imports — this module depends on those repositories, never vice-versa.
 */

import { getDatabase } from '../connection';
import { getBlockedUserIds } from './userSocial';

/**
 * The set of AI character profile ids created by a blocked cloud user.
 */
export async function getBlockedProfileIds(): Promise<Set<string>> {
  const blockedUserIds = await getBlockedUserIds();
  if (blockedUserIds.length === 0) return new Set();

  const db = getDatabase();
  const placeholders = blockedUserIds.map(() => '?').join(', ');
  const [results] = await db.executeSql(
    `SELECT profile_id FROM character_creators
      WHERE creator_user_id IN (${placeholders})`,
    blockedUserIds,
  );
  const ids = new Set<string>();
  for (let i = 0; i < results.rows.length; i++) {
    ids.add(results.rows.item(i).profile_id);
  }
  return ids;
}

/** A character profile or a wrapper carrying one (e.g. a marketplace listing). */
type WithProfileId = { id: string } | { profile: { id: string } };

/** Resolve the character profile id from either supported shape. */
function profileIdOf(item: WithProfileId): string {
  if ('profile' in item && item.profile) return (item as { profile: { id: string } }).profile.id;
  return (item as { id: string }).id;
}

/**
 * Filter a list of character profiles (or marketplace listings carrying a
 * profile), dropping any whose recorded creator is a blocked user.
 */
export async function filterBlockedCharacterProfiles<T extends WithProfileId>(
  profiles: T[],
): Promise<T[]> {
  if (profiles.length === 0) return profiles;
  const blockedIds = await getBlockedProfileIds();
  if (blockedIds.size === 0) return profiles;
  return profiles.filter(p => !blockedIds.has(profileIdOf(p)));
}

/**
 * Filter a list of user posts, dropping any authored by a blocked user.
 */
export async function filterBlockedUserPosts<T extends { authorUserId: string | null }>(
  posts: T[],
): Promise<T[]> {
  if (posts.length === 0) return posts;
  const blockedUserIds = await getBlockedUserIds();
  if (blockedUserIds.length === 0) return posts;
  const blockedSet = new Set(blockedUserIds);
  return posts.filter(p => !p.authorUserId || !blockedSet.has(p.authorUserId));
}

/**
 * Filter a list of notifications, dropping any whose actor is a blocked user.
 * A blocked user's likes / comments / follows must not surface in the feed.
 */
export async function filterBlockedUserNotifications<T extends { actorUserId: string | null }>(
  items: T[],
): Promise<T[]> {
  if (items.length === 0) return items;
  const blockedUserIds = await getBlockedUserIds();
  if (blockedUserIds.length === 0) return items;
  const blockedSet = new Set(blockedUserIds);
  return items.filter(i => !i.actorUserId || !blockedSet.has(i.actorUserId));
}