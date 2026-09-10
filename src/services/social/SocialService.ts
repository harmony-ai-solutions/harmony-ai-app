/**
 * SocialService — app-facing typed API over the in-memory social stub.
 *
 * This is the ONLY module the social screens import (the swap seam for the
 * future real backend). It replaces the doomed SQLite sidecar repos
 * (`characterSocial.ts`, `userSocial.ts`, `blocked_users`) with the in-memory
 * stub store: profiles/follows, community posts + likes/comments, character
 * likes/saves, gallery-image likes/comments, the block list and creator
 * attribution rows. NO persistence.
 *
 * Key design decisions:
 *   - Types are REST-shaped and documented for the future backend concept
 *     (Phase 9). `SavedCharacterEntry` intentionally does NOT embed the local
 *     DB `CharacterProfile` — the stub returns a self-contained
 *     profileId/name/avatarText shape instead (Phase 2/3 UI rewiring maps it).
 *   - The pure block-filter helpers live in `src/utils/blockedContentFilters.ts`
 *     (Phase 3 rewires the `blockedContent.ts` repo callers to them).
 *   - Honest errors: unknown users/posts/comments throw `SocialError` (404).
 */

import { createLogger } from '../../utils/logger';
import * as socialBackend from './socialStubBackend';

const log = createLogger('[Social]');

// ── Stub identity (the signed-in user) ─────────────────────────────────────
// The stub backend stands in for auth with a fixed local-user id. Screens that
// need "my own posts" (My Profile > Posts) pass LOCAL_USER_ID to getPosts().
// The future backend derives this from the auth token — no UI change needed.

/** The stub user id attributed to the signed-in user's own activity. */
export const LOCAL_USER_ID = socialBackend.CURRENT_USER_ID;
/** Display name the stub attributes to the signed-in user's activity. */
export const LOCAL_USER_DISPLAY_NAME = socialBackend.CURRENT_USER_DISPLAY_NAME;

// ── Types (REST-shaped, documented for the future backend) ───────────────

/** Public cloud-user profile. */
export interface StubUserProfile {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  avatarText?: string;
  bio?: string | null;
  followerCount: number;
  followingCount: number;
}

/** A community-feed post (counts derived at read time). */
export interface StubPost {
  id: string;
  authorUserId: string | null;
  authorDisplayName: string;
  authorAvatarUrl: string | null;
  text: string;
  imageData: string | null;
  imageMimeType: string | null;
  /** ISO 8601 timestamp. */
  createdAt: string;
  likeCount: number;
  commentCount: number;
}

/** A comment on a community post. */
export interface StubPostComment {
  id: string;
  postId: string;
  authorUserId: string | null;
  authorDisplayName: string;
  authorAvatarUrl: string | null;
  text: string;
  /** ISO 8601 timestamp. */
  createdAt: string;
}

/** A comment on a gallery image (post). */
export interface StubImageComment {
  id: string;
  imageId: string;
  authorUserId: string | null;
  authorDisplayName: string;
  text: string;
  /** ISO 8601 timestamp. */
  createdAt: string;
}

/** A saved character (My Profile > Saved). Self-contained stub shape. */
export interface SavedCharacterEntry {
  profileId: string;
  name: string;
  avatarText?: string | null;
  /** ISO 8601 timestamp. */
  savedAt: string;
}

/** Creator attribution row (until V3-authorship derivation lands). */
export interface StubCharacterCreator {
  profileId: string;
  creatorUserId: string;
  creatorDisplayName: string;
  creatorAvatarUrl: string | null;
}

export interface CreatePostInput {
  text: string;
  imageData?: string | null;
  imageMimeType?: string | null;
}

export interface AddPostCommentInput {
  postId: string;
  text: string;
}

export interface AddImageCommentInput {
  imageId: string;
  text: string;
}

// ── Profiles & follows ────────────────────────────────────────────────────

/** Public profile for a cloud user. @throws {SocialError} 404 when unknown. */
export async function getPublicUserProfile(userId: string): Promise<StubUserProfile> {
  return socialBackend.getUserProfile(userId);
}

/** Follow/unfollow a cloud user; returns the new state. */
export async function toggleFollow(userId: string): Promise<boolean> {
  const following = await socialBackend.toggleFollow(userId);
  log.info(`${following ? 'Followed' : 'Unfollowed'} ${userId}`);
  return following;
}

/** True when the local user follows the given cloud user. */
export async function isFollowing(userId: string): Promise<boolean> {
  return socialBackend.isFollowing(userId);
}

/** Profiles of all followed cloud users. */
export async function getFollowedUsers(): Promise<StubUserProfile[]> {
  return socialBackend.getFollowedUsers();
}

// ── Posts (community feed) ────────────────────────────────────────────────

/** All posts (optionally filtered by author), newest first. */
export async function getPosts(opts?: { authorId?: string }): Promise<StubPost[]> {
  return socialBackend.getPosts(opts);
}

/** Create a post authored by the current user. */
export async function createPost(input: CreatePostInput): Promise<StubPost> {
  const post = await socialBackend.createPost(input);
  log.info(`Created post ${post.id}`);
  return post;
}

/** Delete a post (author-only — the UI gates this). */
export async function deletePost(id: string): Promise<void> {
  await socialBackend.deletePost(id);
}

/** Toggle the current user's like on a post; returns the new state. */
export async function togglePostLike(id: string): Promise<boolean> {
  return socialBackend.togglePostLike(id);
}

/** Comments on a post, oldest first. */
export async function getPostComments(id: string): Promise<StubPostComment[]> {
  return socialBackend.getPostComments(id);
}

/** Add a comment to a post. */
export async function addPostComment(input: AddPostCommentInput): Promise<StubPostComment> {
  return socialBackend.addPostComment(input);
}

/** Delete a post comment (author-only — the UI gates this). */
export async function deletePostComment(id: string): Promise<void> {
  await socialBackend.deletePostComment(id);
}

// ── Character social (AIProfileScreen) ───────────────────────────────────

/** Toggle the current user's like on a character profile; returns the new state. */
export async function toggleCharacterLike(profileId: string): Promise<boolean> {
  return socialBackend.toggleCharacterLike(profileId);
}

/** True when the current user has liked the character profile. */
export async function isCharacterLiked(profileId: string): Promise<boolean> {
  return socialBackend.isCharacterLiked(profileId);
}

/** Total likes on a character profile. */
export async function getCharacterLikesCount(profileId: string): Promise<number> {
  return socialBackend.getCharacterLikesCount(profileId);
}

/** Toggle the current user's save on a character profile; returns the new state. */
export async function toggleCharacterSave(profileId: string): Promise<boolean> {
  return socialBackend.toggleCharacterSave(profileId);
}

/** Saved character entries, most recently saved first. */
export async function getSavedCharacterEntries(): Promise<SavedCharacterEntry[]> {
  return socialBackend.getSavedCharacterEntries();
}

// ── Image social (gallery images as posts) ───────────────────────────────

/** Toggle the current user's like on a gallery image; returns the new state. */
export async function toggleImageLike(imageId: string): Promise<boolean> {
  return socialBackend.toggleImageLike(imageId);
}

/** Total likes on a gallery image. */
export async function getImageLikesCount(imageId: string): Promise<number> {
  return socialBackend.getImageLikesCount(imageId);
}

/** Add a comment to a gallery image. */
export async function addImageComment(input: AddImageCommentInput): Promise<StubImageComment> {
  return socialBackend.addImageComment(input);
}

/** Comments on a gallery image, oldest first. */
export async function getImageComments(imageId: string): Promise<StubImageComment[]> {
  return socialBackend.getImageComments(imageId);
}

/** Delete a gallery-image comment (author-only — the UI gates this). */
export async function deleteImageComment(id: string): Promise<void> {
  await socialBackend.deleteImageComment(id);
}

// ── Block list (replaces blocked_users table + blockedContent repo reads) ─

/** The set of blocked cloud user ids (empty by default — stub starts clean). */
export async function getBlockedUserIds(): Promise<Set<string>> {
  return socialBackend.getBlockedUserIds();
}

/** Block a cloud user (idempotent — also drops any existing follow). */
export async function blockUser(userId: string): Promise<void> {
  await socialBackend.blockUser(userId);
  log.info(`Blocked ${userId}`);
}

/** Unblock a cloud user (idempotent). */
export async function unblockUser(userId: string): Promise<void> {
  await socialBackend.unblockUser(userId);
  log.info(`Unblocked ${userId}`);
}

// ── Creators (attribution row — until V3-authorship derivation lands) ────

/** Record which cloud user created an AI character (idempotent upsert). */
export async function setCharacterCreator(input: {
  profileId: string;
  userId: string;
}): Promise<void> {
  await socialBackend.setCharacterCreator(input);
}

/** The recorded creator of a character profile, or null when none is known. */
export async function getCharacterCreator(
  profileId: string,
): Promise<StubCharacterCreator | null> {
  return socialBackend.getCharacterCreator(profileId);
}

/** True when the given user id is the recorded creator of the profile. */
export async function isCharacterCreator(
  profileId: string,
  userId: string | null | undefined,
): Promise<boolean> {
  return socialBackend.isCharacterCreator(profileId, userId);
}