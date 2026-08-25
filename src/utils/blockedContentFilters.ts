/**
 * blockedContentFilters — PURE filter helpers for hiding content belonging to
 * blocked cloud users.
 *
 * The Phase-3 home of the doomed SQLite `blockedContent.ts` filtering logic
 * (its callers — Discover, Characters, Notifications, UserProfile posts — were
 * rewired to these). Unlike the repo version, these functions are pure — no
 * database access — taking the `blockedIds: Set<string>` explicitly, so they
 * are trivially unit-testable and work against any item shape (stub service
 * records, marketplace listings, feed posts, notifications).
 *
 * Item-shape contracts (mirror the current repo signatures so Phase 3 callers
 * pass the same shapes):
 *   - Character profiles: `{ id }` or `{ profile: { id } }` (e.g. a
 *     marketplace listing carrying a profile).
 *   - Posts: any shape with `authorUserId: string | null` (a blocked user's
 *     posts are dropped; author-less posts are kept).
 *   - Notifications: any shape with `actorUserId: string | null` (a blocked
 *     user's likes/comments/follows must not surface in the feed).
 */

/** A character profile or a wrapper carrying one (e.g. a marketplace listing). */
type WithProfileId = { id: string } | { profile: { id: string } };

/** Resolve the character profile id from either supported shape. */
function profileIdOf(item: WithProfileId): string {
  if ('profile' in item && item.profile) {
    return (item as { profile: { id: string } }).profile.id;
  }
  return (item as { id: string }).id;
}

/**
 * Filter character profiles (or marketplace listings carrying a profile),
 * dropping any whose profile id is in `blockedIds`.
 */
export function filterBlockedCharacterProfiles<T extends WithProfileId>(
  items: T[],
  blockedIds: Set<string>,
): T[] {
  if (items.length === 0 || blockedIds.size === 0) return items;
  return items.filter(item => !blockedIds.has(profileIdOf(item)));
}

/**
 * Filter user posts, dropping any authored by a blocked user (author-less
 * posts are kept — local/system posts must stay visible).
 */
export function filterBlockedUserPosts<T extends { authorUserId: string | null }>(
  posts: T[],
  blockedIds: Set<string>,
): T[] {
  if (posts.length === 0 || blockedIds.size === 0) return posts;
  return posts.filter(p => !p.authorUserId || !blockedIds.has(p.authorUserId));
}

/**
 * Filter notifications, dropping any whose actor is a blocked user (a blocked
 * user's likes / comments / follows must not surface in the feed).
 */
export function filterBlockedUserNotifications<T extends { actorUserId: string | null }>(
  items: T[],
  blockedIds: Set<string>,
): T[] {
  if (items.length === 0 || blockedIds.size === 0) return items;
  return items.filter(i => !i.actorUserId || !blockedIds.has(i.actorUserId));
}