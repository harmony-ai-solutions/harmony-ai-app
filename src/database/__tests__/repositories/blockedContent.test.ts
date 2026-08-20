/**
 * Blocked Content Filtering Tests
 *
 * Verifies the central helpers that hide content belonging to blocked cloud
 * users app-wide:
 *   - getBlockedProfileIds — character profiles created by a blocked user
 *   - filterBlockedCharacterProfiles — drops those profiles from lists
 *     (works for bare profiles and marketplace-style wrappers)
 *   - filterBlockedUserPosts — drops posts authored by a blocked user
 *   - filterBlockedUserNotifications — drops notifications from blocked actors
 */

import { useFreshDatabase } from '../repositoryFixtures';
import { createCharacterProfile } from '../../repositories/characters';
import { setCharacterCreator } from '../../repositories/characterSocial';
import {
  createUserPost,
  addNotification,
  getNotifications,
  addBlockedUser,
  removeBlockedUser,
} from '../../repositories/userSocial';
import {
  getBlockedProfileIds,
  filterBlockedCharacterProfiles,
  filterBlockedUserPosts,
  filterBlockedUserNotifications,
} from '../../repositories/blockedContent';

describe('blocked content filtering', () => {
  useFreshDatabase();

  async function createMinimalProfile(id: string) {
    return createCharacterProfile({
      id,
      name: 'Test Character',
      description: '',
      personality: '',
      appearance: '',
      backstory: '',
      voice_characteristics: '',
      base_prompt: null,
      scenario: null,
      example_dialogues: null,
      typing_speed_wpm: 60,
      audio_response_chance_percent: 50,
      vision_config_id: null,
      lifecycle_config: '{}',
    });
  }

  describe('character profile filtering', () => {
    it('resolves profile ids created by blocked users', async () => {
      await createMinimalProfile('p1');
      await createMinimalProfile('p2');
      await createMinimalProfile('p3');
      await setCharacterCreator({
        profileId: 'p1',
        creatorUserId: 'bad-user',
        creatorDisplayName: 'Bad User',
        creatorAvatarUrl: null,
      });
      await setCharacterCreator({
        profileId: 'p3',
        creatorUserId: 'bad-user',
        creatorDisplayName: 'Bad User',
        creatorAvatarUrl: null,
      });
      await addBlockedUser({
        blockedUserId: 'bad-user',
        blockedDisplayName: 'Bad User',
        blockedAvatarUrl: null,
      });

      const ids = await getBlockedProfileIds();
      expect([...ids].sort()).toEqual(['p1', 'p3']);
    });

    it('filters bare profiles out of a list', async () => {
      await createMinimalProfile('p1');
      await createMinimalProfile('p2');
      await setCharacterCreator({
        profileId: 'p1',
        creatorUserId: 'bad-user',
        creatorDisplayName: 'Bad User',
        creatorAvatarUrl: null,
      });
      await addBlockedUser({
        blockedUserId: 'bad-user',
        blockedDisplayName: 'Bad User',
        blockedAvatarUrl: null,
      });

      const filtered = await filterBlockedCharacterProfiles([
        { id: 'p1' },
        { id: 'p2' },
      ]);
      expect(filtered).toEqual([{ id: 'p2' }]);
    });

    it('filters marketplace-style wrappers carrying a profile', async () => {
      await createMinimalProfile('p1');
      await createMinimalProfile('p2');
      await setCharacterCreator({
        profileId: 'p2',
        creatorUserId: 'bad-user',
        creatorDisplayName: 'Bad User',
        creatorAvatarUrl: null,
      });
      await addBlockedUser({
        blockedUserId: 'bad-user',
        blockedDisplayName: 'Bad User',
        blockedAvatarUrl: null,
      });

      const filtered = await filterBlockedCharacterProfiles([
        { profileId: 'p1', profile: { id: 'p1' } },
        { profileId: 'p2', profile: { id: 'p2' } },
      ]);
      expect(filtered).toEqual([{ profileId: 'p1', profile: { id: 'p1' } }]);
    });

    it('leaves lists untouched when nobody is blocked', async () => {
      await createMinimalProfile('p1');
      const filtered = await filterBlockedCharacterProfiles([{ id: 'p1' }]);
      expect(filtered).toEqual([{ id: 'p1' }]);
    });
  });

  describe('user post filtering', () => {
    it('drops posts authored by a blocked user', async () => {
      await createUserPost({
        authorUserId: 'good-user',
        authorDisplayName: 'Good User',
        authorAvatarUrl: null,
        text: 'hello',
      });
      await createUserPost({
        authorUserId: 'bad-user',
        authorDisplayName: 'Bad User',
        authorAvatarUrl: null,
        text: 'spam',
      });
      await addBlockedUser({
        blockedUserId: 'bad-user',
        blockedDisplayName: 'Bad User',
        blockedAvatarUrl: null,
      });

      const filtered = await filterBlockedUserPosts([
        { authorUserId: 'good-user' },
        { authorUserId: 'bad-user' },
        { authorUserId: null },
      ]);
      expect(filtered).toEqual([{ authorUserId: 'good-user' }, { authorUserId: null }]);
    });
  });

  describe('notification filtering', () => {
    it('drops notifications whose actor is a blocked user', async () => {
      await addBlockedUser({
        blockedUserId: 'bad-user',
        blockedDisplayName: 'Bad User',
        blockedAvatarUrl: null,
      });
      await addNotification({
        recipientUserId: 'me',
        actorUserId: 'good-user',
        actorDisplayName: 'Good',
        actorAvatarUrl: null,
        type: 'follow',
      });
      await addNotification({
        recipientUserId: 'me',
        actorUserId: 'bad-user',
        actorDisplayName: 'Bad',
        actorAvatarUrl: null,
        type: 'post_like',
      });

      const filtered = await filterBlockedUserNotifications(
        await getNotifications('me'),
      );
      expect(filtered).toHaveLength(1);
      expect(filtered[0].actorUserId).toBe('good-user');

      // Unblocking restores the notification immediately.
      await removeBlockedUser('bad-user');
      const restored = await filterBlockedUserNotifications(
        await getNotifications('me'),
      );
      expect(restored).toHaveLength(2);
    });
  });
});