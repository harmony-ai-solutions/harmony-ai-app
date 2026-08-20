/**
 * User Social Repository — client-only posts, follows & notifications layer.
 *
 * Mirrors the character social layer (characterSocial.ts) but for the LOCAL
 * user's own content: posts published on My Profile, follows of other cloud
 * users, and a local notification feed.
 *
 * Everything here lives in CLIENT-ONLY sidecar tables (never synced to the
 * engine — strict schema parity, see docs/schema-parity.md):
 *
 *   user_posts          — the local user's posts (text + optional image)
 *   user_post_likes     — the local user liked a post
 *   user_post_comments  — comments on a post
 *   follows             — the local user follows a cloud user (e.g. AI creator)
 *   notifications       — local notification feed
 */

import { getDatabase } from '../connection';
import { generateId } from '../../utils/uuid';
import { createDataURL } from '../base64';

// ============================================================================
// User Posts
// ============================================================================

export interface UserPost {
  id: string;
  authorUserId: string | null;
  authorDisplayName: string;
  authorAvatarUrl: string | null;
  text: string;
  imageData: string | null;
  imageMimeType: string | null;
  createdAt: Date;
  /** Derived for the feed: data URL when an image is attached */
  imageDataUrl?: string | null;
}

/**
 * Create a post authored by the current user. Returns the created post.
 */
export async function createUserPost(input: {
  authorUserId: string | null;
  authorDisplayName: string;
  authorAvatarUrl: string | null;
  text: string;
  imageData?: string | null;
  imageMimeType?: string | null;
}): Promise<UserPost> {
  const db = getDatabase();
  const id = generateId();
  const now = new Date();
  await db.executeSql(
    `INSERT INTO user_posts (
       id, author_user_id, author_display_name, author_avatar_url,
       text, image_data, image_mime_type, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.authorUserId,
      input.authorDisplayName.trim() || '',
      input.authorAvatarUrl,
      input.text.trim(),
      input.imageData ?? null,
      input.imageMimeType ?? null,
      now.toISOString(),
    ],
  );
  return {
    id,
    authorUserId: input.authorUserId,
    authorDisplayName: input.authorDisplayName.trim() || '',
    authorAvatarUrl: input.authorAvatarUrl,
    text: input.text.trim(),
    imageData: input.imageData ?? null,
    imageMimeType: input.imageMimeType ?? null,
    createdAt: now,
    imageDataUrl:
      input.imageData && input.imageMimeType
        ? createDataURL(input.imageData, input.imageMimeType)
        : null,
  };
}

/**
 * A post by id (with derived image data URL).
 */
export async function getUserPost(postId: string): Promise<UserPost | null> {
  const db = getDatabase();
  const [results] = await db.executeSql(
    'SELECT * FROM user_posts WHERE id = ?',
    [postId],
  );
  if (results.rows.length === 0) return null;
  return mapRowToUserPost(results.rows.item(0));
}

/**
 * All posts authored by a user, newest first.
 */
export async function getUserPostsByAuthor(
  authorUserId: string,
): Promise<UserPost[]> {
  const db = getDatabase();
  const [results] = await db.executeSql(
    'SELECT * FROM user_posts WHERE author_user_id = ? ORDER BY created_at DESC, id DESC',
    [authorUserId],
  );
  const posts: UserPost[] = [];
  for (let i = 0; i < results.rows.length; i++) {
    posts.push(mapRowToUserPost(results.rows.item(i)));
  }
  return posts;
}

/**
 * The current user's own posts (used by My Profile > Posts tab), newest first.
 */
export async function getMyUserPosts(
  authorUserId: string | null,
): Promise<UserPost[]> {
  if (!authorUserId) return [];
  return getUserPostsByAuthor(authorUserId);
}

/**
 * All posts across all authors (used by the Discover feed), newest first.
 */
export async function getAllUserPosts(): Promise<UserPost[]> {
  const db = getDatabase();
  const [results] = await db.executeSql(
    'SELECT * FROM user_posts ORDER BY created_at DESC',
  );
  const posts: UserPost[] = [];
  for (let i = 0; i < results.rows.length; i++) {
    posts.push(mapRowToUserPost(results.rows.item(i)));
  }
  return posts;
}

/**
 * Delete a post (author-only). Cascades to likes + comments.
 */
export async function deleteUserPost(postId: string): Promise<void> {
  const db = getDatabase();
  await db.executeSql('DELETE FROM user_posts WHERE id = ?', [postId]);
}

// ============================================================================
// User Post Likes
// ============================================================================

/**
 * True when the local user has liked the post.
 */
export async function isPostLiked(postId: string): Promise<boolean> {
  const db = getDatabase();
  const [results] = await db.executeSql(
    'SELECT 1 FROM user_post_likes WHERE post_id = ?',
    [postId],
  );
  return results.rows.length > 0;
}

/**
 * Like a post (idempotent).
 */
export async function addPostLike(postId: string): Promise<void> {
  const db = getDatabase();
  await db.executeSql(
    'INSERT OR IGNORE INTO user_post_likes (post_id, liked_at) VALUES (?, ?)',
    [postId, new Date().toISOString()],
  );
}

/**
 * Remove a post like (idempotent).
 */
export async function removePostLike(postId: string): Promise<void> {
  const db = getDatabase();
  await db.executeSql('DELETE FROM user_post_likes WHERE post_id = ?', [postId]);
}

/**
 * Toggle the like state and return the new state.
 */
export async function togglePostLike(postId: string): Promise<boolean> {
  const liked = await isPostLiked(postId);
  if (liked) {
    await removePostLike(postId);
    return false;
  }
  await addPostLike(postId);
  return true;
}

/**
 * Total number of likes on a post.
 */
export async function getPostLikesCount(postId: string): Promise<number> {
  const db = getDatabase();
  const [results] = await db.executeSql(
    'SELECT COUNT(*) as count FROM user_post_likes WHERE post_id = ?',
    [postId],
  );
  return results.rows.item(0).count;
}

// ============================================================================
// User Post Comments
// ============================================================================

export interface UserPostComment {
  id: string;
  postId: string;
  authorUserId: string | null;
  authorDisplayName: string;
  authorAvatarUrl: string | null;
  text: string;
  createdAt: Date;
}

/**
 * Add a comment to a post. Returns the created comment.
 */
export async function addPostComment(input: {
  postId: string;
  authorUserId: string | null;
  authorDisplayName: string;
  authorAvatarUrl: string | null;
  text: string;
}): Promise<UserPostComment> {
  const db = getDatabase();
  const id = generateId();
  const now = new Date();
  await db.executeSql(
    `INSERT INTO user_post_comments (
       id, post_id, author_user_id, author_display_name, author_avatar_url,
       text, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.postId,
      input.authorUserId,
      input.authorDisplayName.trim() || '',
      input.authorAvatarUrl,
      input.text.trim(),
      now.toISOString(),
    ],
  );
  return {
    id,
    postId: input.postId,
    authorUserId: input.authorUserId,
    authorDisplayName: input.authorDisplayName.trim() || '',
    authorAvatarUrl: input.authorAvatarUrl,
    text: input.text.trim(),
    createdAt: now,
  };
}

/**
 * All comments on a post, oldest first.
 */
export async function getPostComments(
  postId: string,
): Promise<UserPostComment[]> {
  const db = getDatabase();
  const [results] = await db.executeSql(
    'SELECT id, post_id, author_user_id, author_display_name, author_avatar_url, text, created_at FROM user_post_comments WHERE post_id = ? ORDER BY created_at ASC',
    [postId],
  );
  const comments: UserPostComment[] = [];
  for (let i = 0; i < results.rows.length; i++) {
    const row = results.rows.item(i);
    comments.push({
      id: row.id,
      postId: row.post_id,
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
 * Delete a comment (author-only — the UI gates this).
 */
export async function deletePostComment(id: string): Promise<void> {
  const db = getDatabase();
  await db.executeSql('DELETE FROM user_post_comments WHERE id = ?', [id]);
}

/**
 * Total number of comments on a post.
 */
export async function getPostCommentsCount(postId: string): Promise<number> {
  const db = getDatabase();
  const [results] = await db.executeSql(
    'SELECT COUNT(*) as count FROM user_post_comments WHERE post_id = ?',
    [postId],
  );
  return results.rows.item(0).count;
}

// ============================================================================
// Follows
// ============================================================================

export interface FollowEntry {
  targetUserId: string;
  targetDisplayName: string;
  targetAvatarUrl: string | null;
  followedAt: Date;
}

/**
 * True when the local user follows the given cloud user.
 */
export async function isFollowing(targetUserId: string): Promise<boolean> {
  const db = getDatabase();
  const [results] = await db.executeSql(
    'SELECT 1 FROM follows WHERE target_user_id = ?',
    [targetUserId],
  );
  return results.rows.length > 0;
}

/**
 * Follow a cloud user (idempotent).
 */
export async function addFollow(input: {
  targetUserId: string;
  targetDisplayName: string;
  targetAvatarUrl: string | null;
}): Promise<void> {
  const db = getDatabase();
  await db.executeSql(
    `INSERT OR IGNORE INTO follows (
       target_user_id, target_display_name, target_avatar_url, followed_at
     ) VALUES (?, ?, ?, ?)`,
    [
      input.targetUserId,
      input.targetDisplayName.trim() || '',
      input.targetAvatarUrl,
      new Date().toISOString(),
    ],
  );
}

/**
 * Unfollow a cloud user (idempotent).
 */
export async function removeFollow(targetUserId: string): Promise<void> {
  const db = getDatabase();
  await db.executeSql('DELETE FROM follows WHERE target_user_id = ?', [targetUserId]);
}

/**
 * All users the local user follows, most recent first.
 */
export async function getFollowedUsers(): Promise<FollowEntry[]> {
  const db = getDatabase();
  const [results] = await db.executeSql(
    'SELECT target_user_id, target_display_name, target_avatar_url, followed_at FROM follows ORDER BY followed_at DESC',
  );
  const entries: FollowEntry[] = [];
  for (let i = 0; i < results.rows.length; i++) {
    const row = results.rows.item(i);
    entries.push({
      targetUserId: row.target_user_id,
      targetDisplayName: row.target_display_name,
      targetAvatarUrl: row.target_avatar_url,
      followedAt: new Date(row.followed_at),
    });
  }
  return entries;
}

// ============================================================================
// Blocked Users
// ============================================================================

export interface BlockedUserEntry {
  blockedUserId: string;
  blockedDisplayName: string;
  blockedAvatarUrl: string | null;
  blockedAt: Date;
}

/**
 * The raw set of blocked cloud user ids (used by `blockedContent` filtering).
 */
export async function getBlockedUserIds(): Promise<string[]> {
  const db = getDatabase();
  const [results] = await db.executeSql(
    'SELECT blocked_user_id FROM blocked_users ORDER BY created_at DESC',
  );
  const ids: string[] = [];
  for (let i = 0; i < results.rows.length; i++) {
    ids.push(results.rows.item(i).blocked_user_id);
  }
  return ids;
}

/**
 * True when the local user has blocked the given cloud user.
 */
export async function isUserBlocked(blockedUserId: string): Promise<boolean> {
  const db = getDatabase();
  const [results] = await db.executeSql(
    'SELECT 1 FROM blocked_users WHERE blocked_user_id = ?',
    [blockedUserId],
  );
  return results.rows.length > 0;
}

/**
 * Block a cloud user (idempotent). Also drops any existing follow — you can't
 * follow someone you've blocked.
 */
export async function addBlockedUser(input: {
  blockedUserId: string;
  blockedDisplayName: string;
  blockedAvatarUrl?: string | null;
}): Promise<void> {
  const db = getDatabase();
  await db.executeSql(
    `INSERT OR IGNORE INTO blocked_users (
       blocked_user_id, blocked_display_name, blocked_avatar_url, created_at
     ) VALUES (?, ?, ?, ?)`,
    [
      input.blockedUserId,
      input.blockedDisplayName.trim() || '',
      input.blockedAvatarUrl ?? null,
      new Date().toISOString(),
    ],
  );
  // Can't follow a blocked user.
  await db.executeSql('DELETE FROM follows WHERE target_user_id = ?', [
    input.blockedUserId,
  ]);
}

/**
 * Blocked cloud users, most recently blocked first.
 */
export async function getBlockedUsers(): Promise<BlockedUserEntry[]> {
  const db = getDatabase();
  const [results] = await db.executeSql(
    `SELECT blocked_user_id, blocked_display_name, blocked_avatar_url, created_at
     FROM blocked_users ORDER BY created_at DESC`,
  );
  const entries: BlockedUserEntry[] = [];
  for (let i = 0; i < results.rows.length; i++) {
    const row = results.rows.item(i);
    entries.push({
      blockedUserId: row.blocked_user_id,
      blockedDisplayName: row.blocked_display_name,
      blockedAvatarUrl: row.blocked_avatar_url ?? null,
      blockedAt: new Date(row.created_at),
    });
  }
  return entries;
}

/**
 * Unblock a cloud user (idempotent) — restores their AIs, posts and profile.
 */
export async function removeBlockedUser(blockedUserId: string): Promise<void> {
  const db = getDatabase();
  await db.executeSql('DELETE FROM blocked_users WHERE blocked_user_id = ?', [
    blockedUserId,
  ]);
}

// ============================================================================
// Notifications
// ============================================================================

export type NotificationType =
  | 'follow'
  | 'profile_like'
  | 'image_like'
  | 'image_comment'
  | 'post_like'
  | 'post_comment';

export interface AppNotification {
  id: string;
  recipientUserId: string;
  actorUserId: string | null;
  actorDisplayName: string;
  actorAvatarUrl: string | null;
  type: NotificationType;
  targetType: string;
  targetId: string | null;
  targetLabel: string;
  text: string;
  createdAt: Date;
  isRead: boolean;
}

/**
 * Add a notification to a recipient's feed.
 */
export async function addNotification(input: {
  recipientUserId: string;
  actorUserId: string | null;
  actorDisplayName: string;
  actorAvatarUrl: string | null;
  type: NotificationType;
  targetType?: string;
  targetId?: string | null;
  targetLabel?: string;
  text?: string;
}): Promise<AppNotification> {
  const db = getDatabase();
  const id = generateId();
  const now = new Date();
  const type = input.type;
  const targetType = input.targetType ?? '';
  const targetId = input.targetId ?? null;
  const targetLabel = input.targetLabel ?? '';

  // Default text per type when none is provided.
  const actor = input.actorDisplayName.trim() || 'Someone';
  let text = input.text ?? '';
  if (!text) {
    switch (type) {
      case 'follow':
        text = `${actor} started following you`;
        break;
      case 'profile_like':
        text = `${actor} liked your AI profile`;
        break;
      case 'image_like':
        text = `${actor} liked your AI image`;
        break;
      case 'image_comment':
        text = `${actor} commented on your AI image`;
        break;
      case 'post_like':
        text = `${actor} liked your post`;
        break;
      case 'post_comment':
        text = `${actor} commented on your post`;
        break;
    }
  }

  await db.executeSql(
    `INSERT INTO notifications (
       id, recipient_user_id, actor_user_id, actor_display_name, actor_avatar_url,
       type, target_type, target_id, target_label, text, created_at, is_read
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    [
      id,
      input.recipientUserId,
      input.actorUserId,
      input.actorDisplayName.trim() || '',
      input.actorAvatarUrl,
      type,
      targetType,
      targetId,
      targetLabel,
      text,
      now.toISOString(),
    ],
  );
  return {
    id,
    recipientUserId: input.recipientUserId,
    actorUserId: input.actorUserId,
    actorDisplayName: input.actorDisplayName.trim() || '',
    actorAvatarUrl: input.actorAvatarUrl,
    type,
    targetType,
    targetId,
    targetLabel,
    text,
    createdAt: now,
    isRead: false,
  };
}

/**
 * All notifications for a user, newest first.
 */
export async function getNotifications(
  recipientUserId: string,
): Promise<AppNotification[]> {
  const db = getDatabase();
  const [results] = await db.executeSql(
    `SELECT id, recipient_user_id, actor_user_id, actor_display_name, actor_avatar_url,
            type, target_type, target_id, target_label, text, created_at, is_read
     FROM notifications WHERE recipient_user_id = ?
     ORDER BY created_at DESC, id DESC`,
    [recipientUserId],
  );
  const items: AppNotification[] = [];
  for (let i = 0; i < results.rows.length; i++) {
    items.push(mapRowToNotification(results.rows.item(i)));
  }
  return items;
}

/**
 * Count of unread notifications for a user (badge on the header bell).
 */
export async function getUnreadNotificationCount(
  recipientUserId: string,
): Promise<number> {
  const db = getDatabase();
  const [results] = await db.executeSql(
    'SELECT COUNT(*) as count FROM notifications WHERE recipient_user_id = ? AND is_read = 0',
    [recipientUserId],
  );
  return results.rows.item(0).count;
}

/**
 * Mark a notification as read.
 */
export async function markNotificationRead(id: string): Promise<void> {
  const db = getDatabase();
  await db.executeSql('UPDATE notifications SET is_read = 1 WHERE id = ?', [id]);
}

/**
 * Mark all notifications as read for a user.
 */
export async function markAllNotificationsRead(
  recipientUserId: string,
): Promise<void> {
  const db = getDatabase();
  await db.executeSql(
    'UPDATE notifications SET is_read = 1 WHERE recipient_user_id = ? AND is_read = 0',
    [recipientUserId],
  );
}

// ============================================================================
// Helpers
// ============================================================================

function mapRowToUserPost(row: any): UserPost {
  const imageData: string | null = row.image_data ?? null;
  const imageMimeType: string | null = row.image_mime_type ?? null;
  return {
    id: row.id,
    authorUserId: row.author_user_id ?? null,
    authorDisplayName: row.author_display_name ?? '',
    authorAvatarUrl: row.author_avatar_url ?? null,
    text: row.text ?? '',
    imageData,
    imageMimeType,
    createdAt: new Date(row.created_at),
    imageDataUrl:
      imageData && imageMimeType ? createDataURL(imageData, imageMimeType) : null,
  };
}

function mapRowToNotification(row: any): AppNotification {
  return {
    id: row.id,
    recipientUserId: row.recipient_user_id,
    actorUserId: row.actor_user_id ?? null,
    actorDisplayName: row.actor_display_name ?? '',
    actorAvatarUrl: row.actor_avatar_url ?? null,
    type: row.type,
    targetType: row.target_type ?? '',
    targetId: row.target_id ?? null,
    targetLabel: row.target_label ?? '',
    text: row.text ?? '',
    createdAt: new Date(row.created_at),
    isRead: row.is_read === 1,
  };
}

export default {
  createUserPost,
  getUserPost,
  getUserPostsByAuthor,
  getMyUserPosts,
  getAllUserPosts,
  deleteUserPost,
  isPostLiked,
  addPostLike,
  removePostLike,
  togglePostLike,
  getPostLikesCount,
  addPostComment,
  getPostComments,
  deletePostComment,
  getPostCommentsCount,
  isFollowing,
  addFollow,
  removeFollow,
  getFollowedUsers,
  getBlockedUserIds,
  isUserBlocked,
  addBlockedUser,
  getBlockedUsers,
  removeBlockedUser,
  addNotification,
  getNotifications,
  getUnreadNotificationCount,
  markNotificationRead,
  markAllNotificationsRead,
};
