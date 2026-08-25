/**
 * Character Repository Tests
 *
 * Ported from the deleted hand-rolled test file. 14 test cases.
 * Uses useFreshDatabase() fixture for per-test DB isolation.
 */

import {useFreshDatabase} from '../repositoryFixtures';
import {
  createCharacterProfile,
  getCharacterProfile,
  getAllCharacterProfiles,
  updateCharacterProfile,
  deleteCharacterProfile,
  deleteCharacterProfileCascade,
  isCharacterProfileInUse,
  createCharacterImage,
  getCharacterImage,
  getCharacterImages,
  deleteCharacterImage,
  updateCharacterImage,
  setPrimaryImage,
  getPrimaryImage,
  imageToDataURL,
  getCharacterImagesWithDataURLs,
  isCharacterFavorite,
  addCharacterFavorite,
  removeCharacterFavorite,
  toggleCharacterFavorite,
  getFavoriteCharacterProfileIds,
  getSiblingCharacterProfiles,
  getCharacterStats,
} from '../../repositories/characters';
import {createEntity, getEntity} from '../../repositories/entities';
import {createInteraction} from '../../repositories/interactions';
import {createConversationMessage} from '../../repositories/conversation_messages';
import type {CharacterImage, Interaction} from '../../models';

describe('characters repository', () => {
  const {getDb} = useFreshDatabase();

  // Helper: create a basic character profile with minimal fields
  // Note: description, personality, voice_characteristics
  // are NOT NULL DEFAULT '' in the schema — must pass '' not null.
  // lifecycle_config is NOT NULL DEFAULT '{}'.
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

  // Helper: create a profile with a specific name (for copy-grouping tests)
  async function createNamedProfile(id: string, name: string) {
    return createCharacterProfile({
      id,
      name,
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

  // Helper: create a mock character image blob (small PNG magic bytes as base64)
  const PNG_MAGIC_BASE64 = 'iVBORw0KGgo'; // truncated PNG header

  describe('createCharacterProfile', () => {
    it('Create Character Profile', async () => {
      const id = 'profile-1';
      const profile = await createMinimalProfile(id);
      expect(profile).toBeDefined();
      expect(profile.id).toBe(id);
      expect(profile.name).toBe('Test Character');
    });
  });

  describe('getCharacterProfile', () => {
    it('Get Character Profile', async () => {
      const id = 'profile-2';
      await createMinimalProfile(id);
      const retrieved = await getCharacterProfile(id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(id);
    });
  });

  describe('getAllCharacterProfiles', () => {
    it('Get All Character Profiles (improved: asserts count)', async () => {
      await createMinimalProfile('profile-list-1');
      await createMinimalProfile('profile-list-2');
      await createMinimalProfile('profile-list-3');

      const all = await getAllCharacterProfiles();
      expect(all.length).toBeGreaterThanOrEqual(3);
      const names = all.map(p => p.name);
      expect(names).toContain('Test Character');
    });
  });

  describe('updateCharacterProfile', () => {
    it('Update Character Profile', async () => {
      const id = 'profile-upd-1';
      await createMinimalProfile(id);
      const existing = await getCharacterProfile(id);
      expect(existing).not.toBeNull();

      const updated = await updateCharacterProfile({
        ...existing!,
        description: 'Updated description',
      });
      expect(updated).toBeDefined();

      const retrieved = await getCharacterProfile(id);
      expect(retrieved!.description).toBe('Updated description');
    });
  });

  describe('isCharacterProfileInUse', () => {
    it('Check Profile In Use', async () => {
      const id = 'profile-inuse-1';
      await createMinimalProfile(id);
      const inUse = await isCharacterProfileInUse(id);
      expect(inUse).toBe(false);
    });
  });

  describe('createCharacterImage', () => {
    it('Create Character Image', async () => {
      const now = new Date();
      const profileId = 'profile-img-1';
      await createMinimalProfile(profileId);
      const imageId = await createCharacterImage({
        character_profile_id: profileId,
        image_data: PNG_MAGIC_BASE64,
        mime_type: 'image/png',
        description: 'Test image',
        is_primary: true,
        display_order: 1,
        vl_model_interpretation: '',
        vl_model: '',
        updated_at: now,
      });
      expect(typeof imageId).toBe('string');
      expect(imageId.length).toBeGreaterThan(0);
    });
  });

  describe('getCharacterImage', () => {
    it('Get Character Image', async () => {
      const profileId = 'profile-img-2';
      await createMinimalProfile(profileId);
      const now = new Date();
      const imageId = await createCharacterImage({
        character_profile_id: profileId,
        image_data: PNG_MAGIC_BASE64,
        mime_type: 'image/png',
        description: 'Test image',
        is_primary: true,
        display_order: 1,
        vl_model_interpretation: '',
        vl_model: '',
        updated_at: now,
      });
      const image = await getCharacterImage(imageId);
      expect(image).not.toBeNull();
      expect(image!.id).toBe(imageId);
    });
  });

  describe('getCharacterImages', () => {
    it('Get Character Images for Profile', async () => {
      const profileId = 'profile-imgs-1';
      await createMinimalProfile(profileId);
      const images = await getCharacterImages(profileId);
      expect(images).toBeDefined();
      expect(Array.isArray(images)).toBe(true);
    });
  });

  describe('getPrimaryImage', () => {
    it('Get Primary Image', async () => {
      const profileId = 'profile-primary-1';
      await createMinimalProfile(profileId);
      const now = new Date();
      const imageId = await createCharacterImage({
        character_profile_id: profileId,
        image_data: PNG_MAGIC_BASE64,
        mime_type: 'image/png',
        description: 'Primary image',
        is_primary: true,
        display_order: 1,
        vl_model_interpretation: '',
        vl_model: '',
        updated_at: now,
      });
      const primary = await getPrimaryImage(profileId);
      expect(primary).not.toBeNull();
      expect(primary!.id).toBe(imageId);
    });
  });

  describe('imageToDataURL', () => {
    it('Image to Data URL Conversion', async () => {
      const image: CharacterImage = {
        id: 'image-1',
        character_profile_id: 'profile-dummy',
        image_data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk',
        mime_type: 'image/png',
        description: '',
        is_primary: true,
        display_order: 1,
        vl_model_interpretation: '',
        vl_model: '',
        created_at: new Date(),
        updated_at: new Date(),
        deleted_at: null,
      };
      const url = imageToDataURL(image);
      expect(url).toContain('data:image/png;base64,');
    });
  });

  describe('getCharacterImagesWithDataURLs', () => {
    it('Get Images with Data URLs', async () => {
      const profileId = 'profile-daturl-1';
      await createMinimalProfile(profileId);
      const now = new Date();
      await createCharacterImage({
        character_profile_id: profileId,
        image_data: PNG_MAGIC_BASE64,
        mime_type: 'image/png',
        description: 'Test image',
        is_primary: true,
        display_order: 1,
        vl_model_interpretation: '',
        vl_model: '',
        updated_at: now,
      });
      const images = await getCharacterImagesWithDataURLs(profileId);
      expect(images).toBeDefined();
      expect(Array.isArray(images)).toBe(true);
    });
  });

  describe('setPrimaryImage', () => {
    it('Set Primary Image', async () => {
      const profileId = 'profile-setprimary-1';
      await createMinimalProfile(profileId);
      const now = new Date();
      const id1 = await createCharacterImage({
        character_profile_id: profileId,
        image_data: PNG_MAGIC_BASE64,
        mime_type: 'image/png',
        description: 'First image',
        is_primary: true,
        display_order: 1,
        vl_model_interpretation: '',
        vl_model: '',
        updated_at: now,
      });
      const id2 = await createCharacterImage({
        character_profile_id: profileId,
        image_data: PNG_MAGIC_BASE64,
        mime_type: 'image/png',
        description: 'Second image',
        is_primary: false,
        display_order: 2,
        vl_model_interpretation: '',
        vl_model: '',
        updated_at: now,
      });

      // Switch primary to id2
      await setPrimaryImage(profileId, id2);
      const primary = await getPrimaryImage(profileId);
      expect(primary).not.toBeNull();
      expect(primary!.id).toBe(id2);
    });
  });

  describe('updateCharacterImage', () => {
    it('updates caption/order/primary IN PLACE — the row id stays stable (Phase 8 image-churn gate)', async () => {
      const profileId = 'profile-img-upd-caption';
      await createMinimalProfile(profileId);
      const now = new Date();
      const imageId = await createCharacterImage({
        character_profile_id: profileId,
        image_data: PNG_MAGIC_BASE64,
        mime_type: 'image/png',
        description: 'Original caption',
        is_primary: false,
        display_order: 1,
        vl_model_interpretation: '',
        vl_model: '',
        updated_at: now,
      });

      // Simulate the diff-based reconcile updating only changed fields.
      await updateCharacterImage({
        id: imageId,
        description: 'New caption',
        display_order: 2,
        is_primary: true,
      });

      const image = await getCharacterImage(imageId);
      expect(image).not.toBeNull();
      expect(image!.id).toBe(imageId); // id preserved — no churn
      expect(image!.description).toBe('New caption');
      expect(image!.display_order).toBe(2);
      expect(image!.is_primary).toBe(true);
    });
  });

  describe('deleteCharacterImage', () => {
    it('Delete Character Image', async () => {
      const profileId = 'profile-delimg-1';
      await createMinimalProfile(profileId);
      const now = new Date();
      const imageId = await createCharacterImage({
        character_profile_id: profileId,
        image_data: PNG_MAGIC_BASE64,
        mime_type: 'image/png',
        description: 'To delete',
        is_primary: false,
        display_order: 1,
        vl_model_interpretation: '',
        vl_model: '',
        updated_at: now,
      });
      await deleteCharacterImage(imageId);
      const image = await getCharacterImage(imageId, true);
      expect(image).not.toBeNull();
      expect(image!.deleted_at).not.toBeNull();
    });
  });

  describe('deleteCharacterProfile', () => {
    it('Delete Character Profile & CASCADE', async () => {
      const profileId = 'profile-delcascade-1';
      await createMinimalProfile(profileId);
      const now = new Date();
      const imageId = await createCharacterImage({
        character_profile_id: profileId,
        image_data: PNG_MAGIC_BASE64,
        mime_type: 'image/png',
        description: 'Cascaded image',
        is_primary: false,
        display_order: 1,
        vl_model_interpretation: '',
        vl_model: '',
        updated_at: now,
      });

      // Permanent delete (hard delete) should cascade to images
      await deleteCharacterProfile(profileId, true);
      const profile = await getCharacterProfile(profileId, true);
      expect(profile).toBeNull();
      const image = await getCharacterImage(imageId, true);
      expect(image).toBeNull();
    });

    it('deleteCharacterProfileCascade soft-deletes the profile and its linked entities', async () => {
      const profileId = 'del-cascade-ui-1';
      await createMinimalProfile(profileId);
      // Create an entity referencing the profile (like the Create AI flow does)
      await createEntity({id: 'del-cascade-ui-entity', character_profile_id: profileId, alias: 'Del Cascade', lifecycle_config: '{}', rag_reindex_required: 1});

      // Plain soft-delete must fail (entity in use)
      await expect(deleteCharacterProfile(profileId)).rejects.toThrow(/in use/);

      // Cascade delete succeeds
      await deleteCharacterProfileCascade(profileId);

      const profile = await getCharacterProfile(profileId, true);
      expect(profile).not.toBeNull();
      expect(profile!.deleted_at).not.toBeNull();

      const entity = await getEntity('del-cascade-ui-entity', true);
      expect(entity).not.toBeNull();
      expect(entity!.deleted_at).not.toBeNull();
    });

    // Regression: the reported bug — a duplicate-save that fails on the entity
    // alias UNIQUE constraint (name already in use) left an ORPHANED duplicate
    // profile in the Characters list. CreateAIScreen now rolls the brand-new
    // profile back via deleteCharacterProfileCascade, which must work even when
    // NO entity was ever created (the entity insert is what failed).
    it('deleteCharacterProfileCascade cleans up an orphaned profile with no entity (duplicate-save rollback)', async () => {
      const profileId = 'del-cascade-orphan-1';
      await createMinimalProfile(profileId);

      // Simulate the failed duplicate save: profile exists, entity insert never
      // happened (alias conflict) → no entity rows reference the profile.
      await deleteCharacterProfileCascade(profileId);

      const profile = await getCharacterProfile(profileId, true);
      expect(profile).not.toBeNull();
      expect(profile!.deleted_at).not.toBeNull();
      // getAllCharacterProfiles (what the Characters list uses) no longer shows it
      const visible = await getAllCharacterProfiles();
      expect(visible.some(p => p.id === profileId)).toBe(false);
    });
  });

  describe('character card V3 standard fields (migration 000037)', () => {
    // Distinctive values so a round-trip failure (column omitted from INSERT,
    // SELECT, or row-map) is immediately obvious.
    const v3Fields = {
      first_mes: 'Hello there!',
      mes_example: '<START>\n{{user}}: Hi\n{{char}}: Hello',
      alternate_greetings: '["Hi there!","Hey!"]',
      post_history_instructions: 'Keep responses in character.',
      creator_notes: 'Test card notes',
      creator: 'Test Creator',
      character_version: '1.0.0',
      nickname: 'Test Nick',
      tags: '["fantasy","wizard"]',
      group_only_greetings: '["greet group"]',
      extensions: '{"project":"test"}',
      assets: '[{"type":"character","uri":"http://example.com/a.png"}]',
      card_provenance: '{"source":"test"}',
      character_book: '{"name":"Test Book","entries":[]}',
    };

    it('round-trips all 14 fields through create → get', async () => {
      const id = 'profile-v3-1';
      const created = await createCharacterProfile({
        id,
        name: 'V3 Character',
        description: '',
        personality: '',
        voice_characteristics: '',
        base_prompt: '',
        scenario: '',
        typing_speed_wpm: 60,
        audio_response_chance_percent: 50,
        vision_config_id: null,
        lifecycle_config: '{}',
        ...v3Fields,
      });

      // The repository returns the input object — assert it carried the fields.
      for (const [key, value] of Object.entries(v3Fields)) {
        expect(created[key as keyof typeof v3Fields]).toBe(value);
      }

      const retrieved = await getCharacterProfile(id);
      expect(retrieved).not.toBeNull();
      for (const [key, value] of Object.entries(v3Fields)) {
        expect(retrieved![key as keyof typeof v3Fields]).toBe(value);
      }

      // SELECT-all path + row-map must carry them too.
      const all = await getAllCharacterProfiles();
      const fromAll = all.find(p => p.id === id);
      expect(fromAll).toBeDefined();
      for (const [key, value] of Object.entries(v3Fields)) {
        expect(fromAll![key as keyof typeof v3Fields]).toBe(value);
      }
    });

    it('persists all 14 fields through update → get', async () => {
      const id = 'profile-v3-upd-1';
      await createCharacterProfile({
        id,
        name: 'V3 Update Target',
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

      const existing = await getCharacterProfile(id);
      expect(existing).not.toBeNull();

      await updateCharacterProfile({
        ...existing!,
        ...v3Fields,
      });

      const retrieved = await getCharacterProfile(id);
      expect(retrieved).not.toBeNull();
      for (const [key, value] of Object.entries(v3Fields)) {
        expect(retrieved![key as keyof typeof v3Fields]).toBe(value);
      }
    });
  });
  describe('character favorites', () => {
    it('is not favorited by default', async () => {
      await createMinimalProfile('fav-default');
      expect(await isCharacterFavorite('fav-default')).toBe(false);
    });

    it('addCharacterFavorite then isCharacterFavorite is true', async () => {
      await createMinimalProfile('fav-add');
      await addCharacterFavorite('fav-add');
      expect(await isCharacterFavorite('fav-add')).toBe(true);
    });

    it('removeCharacterFavorite is idempotent', async () => {
      await createMinimalProfile('fav-remove');
      await addCharacterFavorite('fav-remove');
      await removeCharacterFavorite('fav-remove');
      expect(await isCharacterFavorite('fav-remove')).toBe(false);
      // Removing again is a no-op
      await removeCharacterFavorite('fav-remove');
      expect(await isCharacterFavorite('fav-remove')).toBe(false);
    });

    it('toggleCharacterFavorite flips state and returns new state', async () => {
      await createMinimalProfile('fav-toggle');
      expect(await toggleCharacterFavorite('fav-toggle')).toBe(true);
      expect(await isCharacterFavorite('fav-toggle')).toBe(true);
      expect(await toggleCharacterFavorite('fav-toggle')).toBe(false);
      expect(await isCharacterFavorite('fav-toggle')).toBe(false);
    });

    it('getFavoriteCharacterProfileIds returns most-recent first', async () => {
      await createMinimalProfile('fav-list-1');
      await createMinimalProfile('fav-list-2');
      await addCharacterFavorite('fav-list-1');
      // Small delay so ordering by favorited_at is deterministic.
      await new Promise(r => setTimeout(r, 5));
      await addCharacterFavorite('fav-list-2');

      const ids = await getFavoriteCharacterProfileIds();
      expect(ids).toContain('fav-list-1');
      expect(ids).toContain('fav-list-2');
      // fav-list-2 was favorited last → newest first
      expect(ids.indexOf('fav-list-2')).toBeLessThan(ids.indexOf('fav-list-1'));
    });
  });

  describe('getSiblingCharacterProfiles', () => {
    it('groups copies of the same AI by base name', async () => {
      await createNamedProfile('max', 'Max');
      await createNamedProfile('max-2', 'Max 2');
      await createNamedProfile('max-3', 'Max 3');
      // Unrelated profile that merely starts with "Max"
      await createNamedProfile('maximilian', 'Maximilian');

      const siblings = await getSiblingCharacterProfiles('Max');
      const names = siblings.map(s => s.name).sort();
      expect(names).toEqual(['Max', 'Max 2', 'Max 3']);
    });

    it('returns only itself when no copies exist', async () => {
      await createNamedProfile('luna', 'Luna');
      const siblings = await getSiblingCharacterProfiles('Luna');
      expect(siblings.map(s => s.name)).toEqual(['Luna']);
    });
  });

  describe('getCharacterStats', () => {
    function makeInteraction(id: string, entityId: string, participantIds: string[]): Interaction {
      return {
        id,
        entity_id: entityId,
        interaction_scope: 'private',
        participant_key: `${entityId}+user`,
        participant_ids: JSON.stringify(participantIds),
        status: 'active',
        started_at: '2026-01-01T00:00:00Z',
        last_activity_at: '2026-01-01T00:00:00Z',
        ended_at: null,
        memory_id: null,
        continued_interaction_id: null,
        metadata: null,
        summary: null,
        presence_type: 'phone',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        deleted_at: null,
      };
    }

    it('counts 1 when a single chat is mirrored as two rows (local + sync)', async () => {
      // One chat between "Max" and "user". The app stores it locally with
      // entity_id = 'user', then the engine syncs the same interaction back
      // with entity_id = 'Max' — two rows, ONE real chat. Counting distinct
      // owners would wrongly report 2; the fix counts the OTHER participant.
      await createInteraction(makeInteraction('i1', 'user', ['Max', 'user']));
      await createInteraction(makeInteraction('i2', 'Max', ['Max', 'user']));

      expect((await getCharacterStats('Max')).chats).toBe(1);
    });

    it('counts 1 per distinct user even when the same user opens the chat multiple times', async () => {
      // The same user ('user') opens the chat WITH "Max" three times — the
      // stats must count ONE, not three, because it is 1 per user.
      await createInteraction(makeInteraction('i1', 'user', ['Max', 'user']));
      await createInteraction(makeInteraction('i2', 'user', ['Max', 'user']));
      await createInteraction(makeInteraction('i3', 'user', ['Max', 'user']));
      // A chat with "Max 2" — must NOT count toward "Max"
      await createInteraction(makeInteraction('i4', 'user', ['Max 2', 'user']));
      // A chat with another partner — must not count
      await createInteraction(makeInteraction('i5', 'user', ['Other', 'user']));

      expect((await getCharacterStats('Max')).chats).toBe(1);
    });

    it('counts each distinct user once (exact element match)', async () => {
      // 'user' chatted with "Max" once, 'alice' twice — 2 distinct users.
      await createInteraction(makeInteraction('i1', 'user', ['Max', 'user']));
      await createInteraction(makeInteraction('i2', 'alice', ['Max', 'alice']));
      await createInteraction(makeInteraction('i3', 'alice', ['Max', 'alice']));
      // A chat with "Max 2" — must NOT count toward "Max"
      await createInteraction(makeInteraction('i4', 'alice', ['Max 2', 'alice']));

      expect((await getCharacterStats('Max')).chats).toBe(2);
    });

    it('counts chats for a copy independently from the original (copy starts at 0)', async () => {
      // "Max" has 2 distinct users chatting with it.
      await createInteraction(makeInteraction('i1', 'user', ['Max', 'user']));
      await createInteraction(makeInteraction('i2', 'alice', ['Max', 'alice']));
      // "Max 2" (the copy) has its own entity id and its own chat — the copy's
      // count must reflect ONLY the copy's interactions, starting from 0 if the
      // copy has never been chatted with.
      await createInteraction(makeInteraction('i3', 'user', ['Max 2', 'user']));

      expect((await getCharacterStats('Max')).chats).toBe(2);
      expect((await getCharacterStats('Max 2')).chats).toBe(1);

      // A freshly duplicated character with NO interactions yet → 0 chats.
      expect((await getCharacterStats('Max 3')).chats).toBe(0);
    });

    it('counts each distinct other participant in a group chat (aggregate SQL, D1-12)', async () => {
      // One group chat: Max + alice + bob → 2 distinct users chatted with Max.
      await createInteraction(makeInteraction('g1', 'user', ['Max', 'alice', 'bob']));
      // Another group chat with the same users — still 2 (COUNT DISTINCT).
      await createInteraction(makeInteraction('g2', 'user', ['Max', 'alice', 'bob']));
      // A group chat Max is NOT in — must not count.
      await createInteraction(makeInteraction('g3', 'user', ['claire', 'alice', 'bob']));

      expect((await getCharacterStats('Max')).chats).toBe(2);
    });

    it('falls back to the client-side scan when participant_ids is malformed (D1-12)', async () => {
      // A malformed participant_ids row makes json_each throw — the fallback
      // path must still produce the correct count from the valid rows.
      const bad = makeInteraction('b1', 'user', ['Max', 'user']);
      bad.participant_ids = '{not-json';
      await createInteraction(bad);
      await createInteraction(makeInteraction('ok1', 'user', ['Max', 'alice']));
      await createInteraction(makeInteraction('ok2', 'user', ['Max', 'bob']));

      expect((await getCharacterStats('Max')).chats).toBe(2);
    });

    it('counts likes = total emoji reactions on messages sent by the character', async () => {
      await createNamedProfile('max', 'Max');
      await createEntity({
        id: 'Max',
        alias: 'Max',
        character_profile_id: 'max',
        lifecycle_config: '{}',
        rag_reindex_required: 1,
      });
      await createInteraction(makeInteraction('i5', 'user', ['Max', 'user']));

      await createConversationMessage({
        id: 'm1',
        entity_id: 'Max',
        sender_entity_id: 'Max',
        interaction_id: 'i5',
        content: 'hi',
        audio_duration: null,
        message_type: 'text',
        emotional_state_bits: 0,
        is_recon_followup: false,
        is_edited: false,
        edit_of_message_id: null,
        reactions_json: '["❤️","👍"]',
        is_pinned: false,
      });
      await createConversationMessage({
        id: 'm2',
        entity_id: 'Max',
        sender_entity_id: 'Max',
        interaction_id: 'i5',
        content: 'again',
        audio_duration: null,
        message_type: 'text',
        emotional_state_bits: 0,
        is_recon_followup: false,
        is_edited: false,
        edit_of_message_id: null,
        reactions_json: '["😂"]',
        is_pinned: false,
      });

      const stats = await getCharacterStats('Max');
      expect(stats.likes).toBe(3);
      expect(stats.chats).toBe(1);
    });
  });
});
