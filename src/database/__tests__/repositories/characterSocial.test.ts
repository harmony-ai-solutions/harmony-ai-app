/**
 * Character Social Repository Tests
 *
 * Verifies the client-only social layer for AI characters:
 *   - profile likes (character_likes)
 *   - saves (character_saves + getSavedCharacterEntries)
 *   - image likes (character_image_likes)
 *   - image comments (character_image_comments)
 *   - creator tracking (character_creators)
 */

import { useFreshDatabase } from '../repositoryFixtures';
import {
  createCharacterProfile,
  createCharacterImage,
  deleteCharacterProfile,
} from '../../repositories/characters';
import {
  isCharacterLiked,
  addCharacterLike,
  removeCharacterLike,
  toggleCharacterLike,
  getCharacterLikesCount,
  isCharacterSaved,
  addCharacterSave,
  removeCharacterSave,
  toggleCharacterSave,
  getSavedCharacterProfileIds,
  getSavedCharacterEntries,
  isImageLiked,
  addImageLike,
  removeImageLike,
  toggleImageLike,
  getImageLikesCount,
  addImageComment,
  getImageComments,
  deleteImageComment,
  getImageCommentsCount,
  setCharacterCreator,
  getCharacterCreator,
  isCharacterCreator,
} from '../../repositories/characterSocial';

describe('character social repository', () => {
  useFreshDatabase();

  async function createMinimalProfile(id: string) {
    return createCharacterProfile({
      id,
      name: 'Test Character',
      description: '',
      personality: '',
      voice_characteristics: '',
      base_prompt: '',
      scenario: '',
      typing_speed_wpm: 60,
      audio_response_chance_percent: 50,
      vision_config_id: null,
      lifecycle_config: '{}',
    });
  }

  const PNG_MAGIC_BASE64 = 'iVBORw0KGgo';

  async function createMinimalImage(profileId: string): Promise<string> {
    const now = new Date();
    return createCharacterImage({
      character_profile_id: profileId,
      image_data: PNG_MAGIC_BASE64,
      mime_type: 'image/png',
      description: '',
      is_primary: true,
      display_order: 0,
      vl_model_interpretation: '',
      vl_model: '',
      updated_at: now,
    });
  }

  // ── Profile likes ──────────────────────────────────────────────────────
  describe('character likes', () => {
    it('starts unliked, like → liked, unlike → unliked', async () => {
      const profileId = 'like-1';
      await createMinimalProfile(profileId);

      expect(await isCharacterLiked(profileId)).toBe(false);
      await addCharacterLike(profileId);
      expect(await isCharacterLiked(profileId)).toBe(true);
      expect(await getCharacterLikesCount(profileId)).toBe(1);

      await removeCharacterLike(profileId);
      expect(await isCharacterLiked(profileId)).toBe(false);
      expect(await getCharacterLikesCount(profileId)).toBe(0);
    });

    it('addCharacterLike is idempotent', async () => {
      const profileId = 'like-2';
      await createMinimalProfile(profileId);
      await addCharacterLike(profileId);
      await addCharacterLike(profileId);
      expect(await getCharacterLikesCount(profileId)).toBe(1);
    });

    it('toggleCharacterLike returns the new state', async () => {
      const profileId = 'like-3';
      await createMinimalProfile(profileId);
      expect(await toggleCharacterLike(profileId)).toBe(true);
      expect(await toggleCharacterLike(profileId)).toBe(false);
    });
  });

  // ── Saves ──────────────────────────────────────────────────────────────
  describe('character saves', () => {
    it('starts unsaved, save → saved, unsave → unsaved', async () => {
      const profileId = 'save-1';
      await createMinimalProfile(profileId);

      expect(await isCharacterSaved(profileId)).toBe(false);
      await addCharacterSave(profileId);
      expect(await isCharacterSaved(profileId)).toBe(true);

      const ids = await getSavedCharacterProfileIds();
      expect(ids).toContain(profileId);

      await removeCharacterSave(profileId);
      expect(await isCharacterSaved(profileId)).toBe(false);
    });

    it('toggleCharacterSave returns the new state', async () => {
      const profileId = 'save-2';
      await createMinimalProfile(profileId);
      expect(await toggleCharacterSave(profileId)).toBe(true);
      expect(await toggleCharacterSave(profileId)).toBe(false);
    });

    it('getSavedCharacterEntries returns saved profiles with avatars', async () => {
      const profileId = 'save-3';
      await createMinimalProfile(profileId);
      await createMinimalImage(profileId);
      await addCharacterSave(profileId);

      const entries = await getSavedCharacterEntries();
      const entry = entries.find(e => e.profile.id === profileId);
      expect(entry).toBeDefined();
      expect(entry!.profile.name).toBe('Test Character');
      expect(entry!.avatarUri).toContain('data:image');
    });

    it('getSavedCharacterEntries skips soft-deleted profiles', async () => {
      const profileId = 'save-4';
      await createMinimalProfile(profileId);
      await addCharacterSave(profileId);
      // Soft-delete the profile (permanent delete would also be fine)
      await deleteCharacterProfile(profileId, true);
      const entries = await getSavedCharacterEntries();
      expect(entries.find(e => e.profile.id === profileId)).toBeUndefined();
    });
  });

  // ── Image likes ────────────────────────────────────────────────────────
  describe('image likes', () => {
    it('starts unliked, like → liked, unlike → unliked, count reflects', async () => {
      const profileId = 'img-like-1';
      await createMinimalProfile(profileId);
      const imageId = await createMinimalImage(profileId);

      expect(await isImageLiked(imageId)).toBe(false);
      await addImageLike(imageId);
      expect(await isImageLiked(imageId)).toBe(true);
      expect(await getImageLikesCount(imageId)).toBe(1);

      await removeImageLike(imageId);
      expect(await isImageLiked(imageId)).toBe(false);
      expect(await getImageLikesCount(imageId)).toBe(0);
    });

    it('toggleImageLike returns the new state', async () => {
      const profileId = 'img-like-2';
      await createMinimalProfile(profileId);
      const imageId = await createMinimalImage(profileId);
      expect(await toggleImageLike(imageId)).toBe(true);
      expect(await toggleImageLike(imageId)).toBe(false);
    });
  });

  // ── Image comments ─────────────────────────────────────────────────────
  describe('image comments', () => {
    it('adds, lists and counts comments', async () => {
      const profileId = 'img-comment-1';
      await createMinimalProfile(profileId);
      const imageId = await createMinimalImage(profileId);

      await addImageComment({
        imageId,
        authorUserId: 'user-a',
        authorDisplayName: 'Alice',
        authorAvatarUrl: null,
        text: 'First!',
      });
      await addImageComment({
        imageId,
        authorUserId: 'user-b',
        authorDisplayName: 'Bob',
        authorAvatarUrl: null,
        text: 'Nice pic',
      });

      const comments = await getImageComments(imageId);
      expect(comments.length).toBe(2);
      expect(comments[0].text).toBe('First!');
      expect(comments[1].text).toBe('Nice pic');
      expect(await getImageCommentsCount(imageId)).toBe(2);
    });

    it('deletes a comment', async () => {
      const profileId = 'img-comment-2';
      await createMinimalProfile(profileId);
      const imageId = await createMinimalImage(profileId);

      const created = await addImageComment({
        imageId,
        authorUserId: 'user-a',
        authorDisplayName: 'Alice',
        authorAvatarUrl: null,
        text: 'To delete',
      });
      expect(await getImageCommentsCount(imageId)).toBe(1);

      await deleteImageComment(created.id);
      expect(await getImageCommentsCount(imageId)).toBe(0);
    });
  });

  // ── Creator tracking ───────────────────────────────────────────────────
  describe('character creator', () => {
    it('records and reads a creator', async () => {
      const profileId = 'creator-1';
      await createMinimalProfile(profileId);

      expect(await getCharacterCreator(profileId)).toBeNull();

      await setCharacterCreator({
        profileId,
        creatorUserId: 'user-42',
        creatorDisplayName: 'Jane',
        creatorAvatarUrl: null,
      });

      const creator = await getCharacterCreator(profileId);
      expect(creator).not.toBeNull();
      expect(creator!.creatorUserId).toBe('user-42');
      expect(creator!.creatorDisplayName).toBe('Jane');
    });

    it('first creator wins (INSERT OR IGNORE)', async () => {
      const profileId = 'creator-2';
      await createMinimalProfile(profileId);

      await setCharacterCreator({
        profileId,
        creatorUserId: 'user-1',
        creatorDisplayName: 'First',
        creatorAvatarUrl: null,
      });
      await setCharacterCreator({
        profileId,
        creatorUserId: 'user-2',
        creatorDisplayName: 'Second',
        creatorAvatarUrl: null,
      });

      const creator = await getCharacterCreator(profileId);
      expect(creator!.creatorUserId).toBe('user-1');
    });

    it('isCharacterCreator matches only the recorded user', async () => {
      const profileId = 'creator-3';
      await createMinimalProfile(profileId);
      await setCharacterCreator({
        profileId,
        creatorUserId: 'user-42',
        creatorDisplayName: 'Jane',
        creatorAvatarUrl: null,
      });

      expect(await isCharacterCreator(profileId, 'user-42')).toBe(true);
      expect(await isCharacterCreator(profileId, 'other')).toBe(false);
      expect(await isCharacterCreator(profileId, null)).toBe(false);
      expect(await isCharacterCreator(profileId, undefined)).toBe(false);
    });

    it('isCharacterCreator is false when no creator is recorded', async () => {
      const profileId = 'creator-4';
      await createMinimalProfile(profileId);
      expect(await isCharacterCreator(profileId, 'user-42')).toBe(false);
    });
  });
});
