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
  isCharacterProfileInUse,
  createCharacterImage,
  getCharacterImage,
  getCharacterImages,
  deleteCharacterImage,
  setPrimaryImage,
  getPrimaryImage,
  imageToDataURL,
  getCharacterImagesWithDataURLs,
  setCharacterProfileSource,
  getCharacterProfileSource,
  getCommunityCharacterProfiles,
} from '../../repositories/characters';
import type {CharacterImage} from '../../models';

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
  describe('character profile source tagging', () => {
    it('defaults to community when no sidecar row exists', async () => {
      await createMinimalProfile('src-default-community');
      const source = await getCharacterProfileSource('src-default-community');
      expect(source).toBe('community');
    });

    it('setCharacterProfileSource marks a profile as user', async () => {
      await createMinimalProfile('src-user');
      await setCharacterProfileSource('src-user', 'user');
      expect(await getCharacterProfileSource('src-user')).toBe('user');
    });

    it('setCharacterProfileSource upserts (idempotent re-tag)', async () => {
      await createMinimalProfile('src-retag');
      await setCharacterProfileSource('src-retag', 'community');
      expect(await getCharacterProfileSource('src-retag')).toBe('community');
      await setCharacterProfileSource('src-retag', 'user');
      expect(await getCharacterProfileSource('src-retag')).toBe('user');
    });

    it('getCommunityCharacterProfiles excludes user-tagged profiles', async () => {
      await createMinimalProfile('src-comm-1');
      await createMinimalProfile('src-comm-2');
      await createMinimalProfile('src-user-1');
      await setCharacterProfileSource('src-user-1', 'user');

      const community = await getCommunityCharacterProfiles();
      const ids = community.map(p => p.id);
      expect(ids).toContain('src-comm-1');
      expect(ids).toContain('src-comm-2');
      expect(ids).not.toContain('src-user-1');
    });

    it('getCommunityCharacterProfiles excludes soft-deleted profiles', async () => {
      await createMinimalProfile('src-del-1');
      await deleteCharacterProfile('src-del-1');
      const community = await getCommunityCharacterProfiles();
      expect(community.some(p => p.id === 'src-del-1')).toBe(false);
    });
  });
});
