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
  getAICharacterProfile,
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
import {createEntity, getEntity, deleteEntity} from '../../repositories/entities';
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

    // Read-side completeness pin (persona cards 3-3): the Characters list must
    // never surface a persona-owned card. A LIVE persona (user entity) owner
    // hides the card; a SOFT-DELETED (tombstoned) owner does NOT — the owner
    // EXISTS subquery filters `deleted_at IS NULL` (Batch D.1 live-owner
    // consistency, matching isProfilePersonaOwned).
    it('excludes LIVE persona-owned profiles (user entity linkage) from the list', async () => {
      await createMinimalProfile('profile-persona-hidden');
      await createEntity(
        {
          id: 'profile-persona-owner',
          character_profile_id: 'profile-persona-hidden',
          alias: 'profile-persona-owner',
          lifecycle_config: '{}',
          rag_reindex_required: 1,
        },
        {entity_type: 'user'},
      );

      const visible = await getAllCharacterProfiles();
      expect(visible.some(p => p.id === 'profile-persona-hidden')).toBe(false);
      // A plain AI profile still surfaces alongside.
      await createMinimalProfile('profile-ai-visible');
      expect((await getAllCharacterProfiles()).some(p => p.id === 'profile-ai-visible')).toBe(true);
    });

    it('a tombstoned persona owner no longer hides the profile (Batch D.1 — deleted_at IS NULL in the owner subquery)', async () => {
      await createMinimalProfile('profile-owner-tombstoned');
      await createEntity(
        {
          id: 'profile-tombstone-owner',
          character_profile_id: 'profile-owner-tombstoned',
          alias: 'profile-tombstone-owner',
          lifecycle_config: '{}',
          rag_reindex_required: 1,
        },
        {entity_type: 'user'},
      );
      await deleteEntity('profile-tombstone-owner'); // soft-deleted owner

      // The freed card surfaces as an AI character again.
      const visible = await getAllCharacterProfiles();
      expect(visible.some(p => p.id === 'profile-owner-tombstoned')).toBe(true);
    });
  });

  describe('getAICharacterProfile (persona-owned read guard, 3-2-A)', () => {
    it('returns a plain AI profile (no user entity linkage)', async () => {
      await createMinimalProfile('ai-guard-1');
      const profile = await getAICharacterProfile('ai-guard-1');
      expect(profile?.id).toBe('ai-guard-1');
    });

    it('returns null for a persona-owned profile (linked to a user entity)', async () => {
      await createMinimalProfile('persona-guard-1');
      await createEntity(
        {
          id: 'persona-guard-entity',
          alias: 'persona-guard-entity',
          character_profile_id: 'persona-guard-1',
          lifecycle_config: '{}',
          rag_reindex_required: 1,
        },
        {entity_type: 'user'},
      );
      // The persona-owned card must never surface through the AI-profile read.
      expect(await getAICharacterProfile('persona-guard-1')).toBeNull();
    });

    it('returns the profile when its persona owner is tombstoned (Batch D.1 — live-owner consistency)', async () => {
      await createMinimalProfile('persona-guard-tombstoned');
      await createEntity(
        {
          id: 'persona-guard-tombstone-entity',
          alias: 'persona-guard-tombstone-entity',
          character_profile_id: 'persona-guard-tombstoned',
          lifecycle_config: '{}',
          rag_reindex_required: 1,
        },
        {entity_type: 'user'},
      );
      await deleteEntity('persona-guard-tombstone-entity');

      // The freed card is readable as an AI profile again.
      expect((await getAICharacterProfile('persona-guard-tombstoned'))?.id).toBe(
        'persona-guard-tombstoned',
      );
    });

    it('returns null for a missing profile and for a soft-deleted profile', async () => {
      expect(await getAICharacterProfile('missing-guard')).toBeNull();
      await createMinimalProfile('ai-guard-del');
      await deleteCharacterProfile('ai-guard-del');
      expect(await getAICharacterProfile('ai-guard-del')).toBeNull();
    });

    it('does not hide a profile linked only to an AI entity', async () => {
      await createMinimalProfile('ai-guard-linked');
      await createEntity(
        {
          id: 'ai-guard-entity',
          alias: 'ai-guard-entity',
          character_profile_id: 'ai-guard-linked',
          lifecycle_config: '{}',
          rag_reindex_required: 1,
        },
        {entity_type: 'ai'},
      );
      expect((await getAICharacterProfile('ai-guard-linked'))?.id).toBe('ai-guard-linked');
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

      // `permanent = true` is ignored (D1/D69–D78): the profile is tombstoned, not
      // physically deleted. The profile row stays present, so the
      // character_image ON DELETE CASCADE FK never fires — the image is
      // untouched (only deleteCharacterProfileCascade tombstones images).
      await deleteCharacterProfile(profileId);
      const profile = await getCharacterProfile(profileId, true);
      expect(profile).not.toBeNull();
      expect(profile!.deleted_at).not.toBeNull();
      const image = await getCharacterImage(imageId, true);
      expect(image).not.toBeNull();
      expect(image!.deleted_at).toBeNull();
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
  describe('character favorites (is_favorite column, migration 000044)', () => {
    // The sidecar table is gone: favorites are an `is_favorite` flag on the
    // profile row. A default profile is not favorited (0). This suite pins the
    // flag round-trip through getCharacterProfile, idempotency, the deleted-
    // profiles exclusion, and the updated_at bump that makes a favorite toggle
    // sync through the profile row's watermark (writers-supply-timestamps).
    it('is not favorited by default, and the flag round-trips as 0', async () => {
      await createMinimalProfile('fav-default');
      expect(await isCharacterFavorite('fav-default')).toBe(false);
      const p = await getCharacterProfile('fav-default');
      expect(p!.is_favorite).toBe(0);
    });

    it('addCharacterFavorite sets the flag (1) and isCharacterFavorite is true', async () => {
      await createMinimalProfile('fav-add');
      await addCharacterFavorite('fav-add');
      expect(await isCharacterFavorite('fav-add')).toBe(true);
      const p = await getCharacterProfile('fav-add');
      expect(p!.is_favorite).toBe(1);
    });

    it('addCharacterFavorite is idempotent (re-setting 1 → 1 is a no-op)', async () => {
      await createMinimalProfile('fav-add2');
      await addCharacterFavorite('fav-add2');
      await addCharacterFavorite('fav-add2');
      expect(await isCharacterFavorite('fav-add2')).toBe(true);
      const p = await getCharacterProfile('fav-add2');
      expect(p!.is_favorite).toBe(1);
    });

    it('removeCharacterFavorite clears the flag and is idempotent (plain flag clear, no tombstone)', async () => {
      await createMinimalProfile('fav-remove');
      await addCharacterFavorite('fav-remove');
      await removeCharacterFavorite('fav-remove');
      expect(await isCharacterFavorite('fav-remove')).toBe(false);
      const p = await getCharacterProfile('fav-remove');
      expect(p!.is_favorite).toBe(0);
      // Removing again is a no-op
      await removeCharacterFavorite('fav-remove');
      expect(await isCharacterFavorite('fav-remove')).toBe(false);
      const p2 = await getCharacterProfile('fav-remove');
      expect(p2!.is_favorite).toBe(0);
    });

    it('toggleCharacterFavorite flips state, bumps updated_at on every write, and returns new state', async () => {
      await createMinimalProfile('fav-toggle');
      const before = (await getCharacterProfile('fav-toggle'))!.updated_at.getTime();
      // Cursor-safe delay so the explicit updated_at strictly increases.
      await new Promise(r => setTimeout(r, 5));

      expect(await toggleCharacterFavorite('fav-toggle')).toBe(true);
      expect(await isCharacterFavorite('fav-toggle')).toBe(true);
      const afterAdd = (await getCharacterProfile('fav-toggle'))!.updated_at.getTime();
      expect(afterAdd).toBeGreaterThan(before);

      await new Promise(r => setTimeout(r, 5));
      expect(await toggleCharacterFavorite('fav-toggle')).toBe(false);
      expect(await isCharacterFavorite('fav-toggle')).toBe(false);
      const afterRemove = (await getCharacterProfile('fav-toggle'))!.updated_at.getTime();
      expect(afterRemove).toBeGreaterThan(afterAdd);
    });

    it('getFavoriteCharacterProfileIds returns only favorited, non-deleted profiles', async () => {
      await createMinimalProfile('fav-list-1');
      await createMinimalProfile('fav-list-2');
      await createMinimalProfile('fav-list-del');
      await addCharacterFavorite('fav-list-1');
      await addCharacterFavorite('fav-list-2');
      await addCharacterFavorite('fav-list-del');
      // Soft-delete one favorite — it must drop out of the favorite ids.
      await deleteCharacterProfile('fav-list-del');

      const ids = await getFavoriteCharacterProfileIds();
      expect(ids).toContain('fav-list-1');
      expect(ids).toContain('fav-list-2');
      expect(ids).not.toContain('fav-list-del');
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
    // interactions.entity_id FK-constrains entities(id) — ensure each entity
    // referenced by an interaction row exists. Tolerant: the "likes" test links
    // 'Max' to a profile via its own createEntity, so ignore pre-existing rows.
    async function ensureStatsEntity(id: string): Promise<void> {
      try {
        await createEntity(
          {id, alias: id, character_profile_id: null, lifecycle_config: '{}', rag_reindex_required: 1},
          {entity_type: id === 'user' ? 'user' : 'ai'},
        );
      } catch {
        // already exists — fine
      }
    }

    beforeEach(async () => {
      for (const id of ['user', 'Max', 'Max 2', 'Max 3', 'alice', 'bob', 'claire', 'Other']) {
        await ensureStatsEntity(id);
      }
    });

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
      // 'Max' entity is pre-seeded by beforeEach; link the profile for realism
      // (getCharacterStats reads messages + interactions only, not the profile —
      // but keep the profile so the entity is genuinely profiled).
      await createNamedProfile('max', 'Max');
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
