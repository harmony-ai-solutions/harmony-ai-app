/**
 * socialStubBackend — in-memory social store behind SocialService.
 *
 * Replaces the doomed SQLite sidecar repos (`characterSocial.ts`,
 * `userSocial.ts`, `blocked_users` table) with module-level in-memory state
 * seeded from `src/constants/socialFixtures.ts`: profiles, posts, follows,
 * character likes/saves, image likes/comments, the block list (starts empty)
 * and creator attribution rows. NO persistence.
 *
 * Design decisions:
 *   - The local user's identity is a stub constant (`CURRENT_USER_ID` /
 *     `CURRENT_USER_DISPLAY_NAME`) — the future backend derives it from auth.
 *   - Like counts are a seeded community baseline + the local user's like
 *     (toggle flips ±1), so counts stay realistic.
 *   - `blockUser` also drops any follow (you can't follow someone you've
 *     blocked — mirrors the old `blocked_users` repo behavior).
 *   - Honest errors: unknown users/posts/comments throw `SocialError` (404).
 *   - `__resetForTests()` re-seeds the store so test suites are
 *     order-independent.
 */

import { simulateLatency } from '../stub/stubBackendUtils';
import { SocialError } from '../stub/StubServiceError';
import { generateId } from '../../utils/uuid';
import {
  SOCIAL_USERS,
  SOCIAL_POSTS,
  SOCIAL_FOLLOW_SEED,
  SOCIAL_IMAGE_COMMENTS,
  SOCIAL_CHARACTER_LIKE_COUNTS,
  SOCIAL_IMAGE_LIKE_COUNTS,
  SOCIAL_CHARACTER_NAMES,
  SOCIAL_CHARACTER_AVATAR_TEXT,
  SOCIAL_CHARACTER_CREATORS,
} from '../../constants/socialFixtures';
import type {
  SavedCharacterEntry,
  StubCharacterCreator,
  StubImageComment,
  StubPost,
  StubPostComment,
  StubUserProfile,
} from './SocialService';

// ── Constants ────────────────────────────────────────────────────────────

/** Stand-in identity for the signed-in user (the future backend derives this from auth). */
export const CURRENT_USER_ID = 'local-user';
/** Display name the stub attributes to the local user's activity. */
export const CURRENT_USER_DISPLAY_NAME = 'You';

// ── Store ────────────────────────────────────────────────────────────────

interface PostRecord {
  id: string;
  authorUserId: string | null;
  authorDisplayName: string;
  authorAvatarUrl: string | null;
  text: string;
  imageData: string | null;
  imageMimeType: string | null;
  /** ISO 8601 timestamp. */
  createdAt: string;
  likedBy: Set<string>;
  comments: StubPostComment[];
}

const users = new Map<string, StubUserProfile>();
const posts = new Map<string, PostRecord>();
const follows = new Set<string>();
const likedProfiles = new Set<string>();
const savedProfiles = new Set<string>();
const savedAt = new Map<string, string>();
const likedImages = new Set<string>();
const imageComments = new Map<string, StubImageComment[]>();
const characterLikeCounts = new Map<string, number>();
const imageLikeCounts = new Map<string, number>();
const blocked = new Set<string>();
const creators = new Map<string, StubCharacterCreator>();

// ── Seeding / reset ──────────────────────────────────────────────────────

function reseed(): void {
  users.clear();
  posts.clear();
  follows.clear();
  likedProfiles.clear();
  savedProfiles.clear();
  savedAt.clear();
  likedImages.clear();
  imageComments.clear();
  characterLikeCounts.clear();
  imageLikeCounts.clear();
  blocked.clear();
  creators.clear();

  for (const seed of SOCIAL_USERS) {
    users.set(seed.id, {
      id: seed.id,
      displayName: seed.displayName,
      avatarUrl: seed.avatarUrl ?? null,
      avatarText: seed.avatarText,
      bio: seed.bio ?? null,
      followerCount: seed.followerCount,
      followingCount: seed.followingCount,
    });
  }

  for (const seed of SOCIAL_POSTS) {
    const author = users.get(seed.authorUserId);
    posts.set(seed.id, {
      id: seed.id,
      authorUserId: seed.authorUserId,
      authorDisplayName: author?.displayName ?? seed.authorUserId,
      authorAvatarUrl: author?.avatarUrl ?? null,
      text: seed.text,
      imageData: seed.imageData ?? null,
      imageMimeType: seed.imageMimeType ?? null,
      createdAt: seed.createdAt,
      likedBy: new Set(),
      comments: [],
    });
  }

  for (const id of SOCIAL_FOLLOW_SEED) {
    if (users.has(id)) follows.add(id);
  }

  for (const [profileId, count] of Object.entries(SOCIAL_CHARACTER_LIKE_COUNTS)) {
    characterLikeCounts.set(profileId, count);
  }
  for (const [imageId, count] of Object.entries(SOCIAL_IMAGE_LIKE_COUNTS)) {
    imageLikeCounts.set(imageId, count);
  }

  for (const seed of SOCIAL_IMAGE_COMMENTS) {
    const list = imageComments.get(seed.imageId) ?? [];
    list.push({
      id: seed.id,
      imageId: seed.imageId,
      authorUserId: seed.authorUserId,
      authorDisplayName: seed.authorDisplayName,
      text: seed.text,
      createdAt: seed.createdAt,
    });
    imageComments.set(seed.imageId, list);
  }

  for (const seed of SOCIAL_CHARACTER_CREATORS) {
    const user = users.get(seed.creatorUserId);
    creators.set(seed.profileId, {
      profileId: seed.profileId,
      creatorUserId: seed.creatorUserId,
      creatorDisplayName: user?.displayName ?? seed.creatorUserId,
      creatorAvatarUrl: user?.avatarUrl ?? null,
    });
  }
}

/** Test-only reset — re-seeds the store to its pristine fixture state. */
export function __resetForTests(): void {
  reseed();
}

// ── Profiles & follows ───────────────────────────────────────────────────

/** Public profile for a cloud user. */
export async function getUserProfile(userId: string): Promise<StubUserProfile> {
  await simulateLatency();
  const user = users.get(userId);
  if (!user) {
    throw new SocialError(404, `user not found: ${userId}`, { code: 'not_found' });
  }
  return { ...user };
}

/** True when the local user follows the given cloud user. */
export async function isFollowing(userId: string): Promise<boolean> {
  await simulateLatency();
  return follows.has(userId);
}

/** Toggle a follow; returns the new state. */
export async function toggleFollow(userId: string): Promise<boolean> {
  await simulateLatency();
  if (!users.has(userId)) {
    throw new SocialError(404, `user not found: ${userId}`, { code: 'not_found' });
  }
  if (follows.has(userId)) {
    follows.delete(userId);
    return false;
  }
  follows.add(userId);
  return true;
}

/** Profiles of all followed cloud users. */
export async function getFollowedUsers(): Promise<StubUserProfile[]> {
  await simulateLatency();
  const result: StubUserProfile[] = [];
  for (const id of follows) {
    const user = users.get(id);
    if (user) result.push({ ...user });
  }
  return result;
}

// ── Posts (community feed) ───────────────────────────────────────────────

/** All posts (optionally filtered by author), newest first. */
export async function getPosts(opts?: { authorId?: string }): Promise<StubPost[]> {
  await simulateLatency();
  let records = [...posts.values()];
  if (opts?.authorId) {
    records = records.filter(p => p.authorUserId === opts.authorId);
  }
  records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return records.map(toPost);
}

/** Create a post authored by the local user. */
export async function createPost(input: {
  text: string;
  imageData?: string | null;
  imageMimeType?: string | null;
}): Promise<StubPost> {
  await simulateLatency();
  const record: PostRecord = {
    id: generateId(),
    authorUserId: CURRENT_USER_ID,
    authorDisplayName: CURRENT_USER_DISPLAY_NAME,
    authorAvatarUrl: null,
    text: input.text.trim(),
    imageData: input.imageData ?? null,
    imageMimeType: input.imageMimeType ?? null,
    createdAt: new Date().toISOString(),
    likedBy: new Set(),
    comments: [],
  };
  posts.set(record.id, record);
  return toPost(record);
}

/** Delete a post (author-only — the UI gates this). */
export async function deletePost(id: string): Promise<void> {
  await simulateLatency();
  if (!posts.has(id)) {
    throw new SocialError(404, `post not found: ${id}`, { code: 'not_found' });
  }
  posts.delete(id);
}

/** Toggle the local user's like on a post; returns the new state. */
export async function togglePostLike(postId: string): Promise<boolean> {
  await simulateLatency();
  const record = posts.get(postId);
  if (!record) {
    throw new SocialError(404, `post not found: ${postId}`, { code: 'not_found' });
  }
  if (record.likedBy.has(CURRENT_USER_ID)) {
    record.likedBy.delete(CURRENT_USER_ID);
    return false;
  }
  record.likedBy.add(CURRENT_USER_ID);
  return true;
}

/** Comments on a post, oldest first. */
export async function getPostComments(postId: string): Promise<StubPostComment[]> {
  await simulateLatency();
  const record = posts.get(postId);
  if (!record) {
    throw new SocialError(404, `post not found: ${postId}`, { code: 'not_found' });
  }
  return [...record.comments];
}

/** Add a comment to a post. */
export async function addPostComment(input: {
  postId: string;
  text: string;
}): Promise<StubPostComment> {
  await simulateLatency();
  const record = posts.get(input.postId);
  if (!record) {
    throw new SocialError(404, `post not found: ${input.postId}`, { code: 'not_found' });
  }
  const comment: StubPostComment = {
    id: generateId(),
    postId: input.postId,
    authorUserId: CURRENT_USER_ID,
    authorDisplayName: CURRENT_USER_DISPLAY_NAME,
    authorAvatarUrl: null,
    text: input.text.trim(),
    createdAt: new Date().toISOString(),
  };
  record.comments.push(comment);
  return comment;
}

/** Delete a comment (author-only — the UI gates this). */
export async function deletePostComment(id: string): Promise<void> {
  await simulateLatency();
  for (const record of posts.values()) {
    const index = record.comments.findIndex(c => c.id === id);
    if (index >= 0) {
      record.comments.splice(index, 1);
      return;
    }
  }
  throw new SocialError(404, `comment not found: ${id}`, { code: 'not_found' });
}

// ── Character social (AIProfileScreen) ───────────────────────────────────

/** True when the local user has liked the character profile. */
export async function isCharacterLiked(profileId: string): Promise<boolean> {
  await simulateLatency();
  return likedProfiles.has(profileId);
}

/** Toggle the character like; returns the new state. */
export async function toggleCharacterLike(profileId: string): Promise<boolean> {
  await simulateLatency();
  if (likedProfiles.has(profileId)) {
    likedProfiles.delete(profileId);
    return false;
  }
  likedProfiles.add(profileId);
  return true;
}

/** Total likes on a character profile (seeded community baseline + local like). */
export async function getCharacterLikesCount(profileId: string): Promise<number> {
  await simulateLatency();
  return (characterLikeCounts.get(profileId) ?? 0) + (likedProfiles.has(profileId) ? 1 : 0);
}

/** Toggle the character save; returns the new state. */
export async function toggleCharacterSave(profileId: string): Promise<boolean> {
  await simulateLatency();
  if (savedProfiles.has(profileId)) {
    savedProfiles.delete(profileId);
    savedAt.delete(profileId);
    return false;
  }
  savedProfiles.add(profileId);
  savedAt.set(profileId, new Date().toISOString());
  return true;
}

/** Saved character entries, most recently saved first. */
export async function getSavedCharacterEntries(): Promise<SavedCharacterEntry[]> {
  await simulateLatency();
  const entries: SavedCharacterEntry[] = [];
  for (const profileId of savedProfiles) {
    entries.push({
      profileId,
      name: SOCIAL_CHARACTER_NAMES[profileId] ?? profileId,
      avatarText: SOCIAL_CHARACTER_AVATAR_TEXT[profileId] ?? null,
      savedAt: savedAt.get(profileId) ?? new Date().toISOString(),
    });
  }
  return entries;
}

// ── Image social (gallery images as posts) ───────────────────────────────

/** Toggle the local user's like on a gallery image; returns the new state. */
export async function toggleImageLike(imageId: string): Promise<boolean> {
  await simulateLatency();
  if (likedImages.has(imageId)) {
    likedImages.delete(imageId);
    return false;
  }
  likedImages.add(imageId);
  return true;
}

/** Total likes on a gallery image (seeded community baseline + local like). */
export async function getImageLikesCount(imageId: string): Promise<number> {
  await simulateLatency();
  return (imageLikeCounts.get(imageId) ?? 0) + (likedImages.has(imageId) ? 1 : 0);
}

/** Add a comment to a gallery image. */
export async function addImageComment(input: {
  imageId: string;
  text: string;
}): Promise<StubImageComment> {
  await simulateLatency();
  const comment: StubImageComment = {
    id: generateId(),
    imageId: input.imageId,
    authorUserId: CURRENT_USER_ID,
    authorDisplayName: CURRENT_USER_DISPLAY_NAME,
    text: input.text.trim(),
    createdAt: new Date().toISOString(),
  };
  const list = imageComments.get(input.imageId) ?? [];
  list.push(comment);
  imageComments.set(input.imageId, list);
  return comment;
}

/** Comments on a gallery image, oldest first. */
export async function getImageComments(imageId: string): Promise<StubImageComment[]> {
  await simulateLatency();
  return [...(imageComments.get(imageId) ?? [])];
}

/** Delete a gallery-image comment (author-only — the UI gates this). */
export async function deleteImageComment(id: string): Promise<void> {
  await simulateLatency();
  for (const list of imageComments.values()) {
    const index = list.findIndex(c => c.id === id);
    if (index >= 0) {
      list.splice(index, 1);
      return;
    }
  }
  throw new SocialError(404, `comment not found: ${id}`, { code: 'not_found' });
}

// ── Block list (replaces blocked_users table + blockedContent repo reads) ─

/** The set of blocked cloud user ids. */
export async function getBlockedUserIds(): Promise<Set<string>> {
  await simulateLatency();
  return new Set(blocked);
}

/** Block a cloud user (idempotent). Also drops any existing follow. */
export async function blockUser(userId: string): Promise<void> {
  await simulateLatency();
  if (!users.has(userId)) {
    throw new SocialError(404, `user not found: ${userId}`, { code: 'not_found' });
  }
  blocked.add(userId);
  follows.delete(userId); // can't follow someone you've blocked
}

/** Unblock a cloud user (idempotent). */
export async function unblockUser(userId: string): Promise<void> {
  await simulateLatency();
  blocked.delete(userId);
}

// ── Creators (attribution row — until V3-authorship derivation lands) ────

/** Record which cloud user created an AI character (idempotent upsert). */
export async function setCharacterCreator(input: {
  profileId: string;
  userId: string;
}): Promise<void> {
  await simulateLatency();
  const user = users.get(input.userId);
  creators.set(input.profileId, {
    profileId: input.profileId,
    creatorUserId: input.userId,
    creatorDisplayName: user?.displayName ?? input.userId,
    creatorAvatarUrl: user?.avatarUrl ?? null,
  });
}

/** The recorded creator of a character profile, or null when none is known. */
export async function getCharacterCreator(
  profileId: string,
): Promise<StubCharacterCreator | null> {
  await simulateLatency();
  const creator = creators.get(profileId);
  if (!creator) return null;
  return { ...creator };
}

/** True when the given user id is the recorded creator of the profile. */
export async function isCharacterCreator(
  profileId: string,
  userId: string | null | undefined,
): Promise<boolean> {
  await simulateLatency();
  if (!userId) return false;
  const creator = creators.get(profileId);
  return creator !== undefined && creator.creatorUserId === userId;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function toPost(record: PostRecord): StubPost {
  return {
    id: record.id,
    authorUserId: record.authorUserId,
    authorDisplayName: record.authorDisplayName,
    authorAvatarUrl: record.authorAvatarUrl,
    text: record.text,
    imageData: record.imageData,
    imageMimeType: record.imageMimeType,
    createdAt: record.createdAt,
    likeCount: record.likedBy.size,
    commentCount: record.comments.length,
  };
}