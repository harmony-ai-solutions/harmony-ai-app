/**
 * Cross-Repository Behavior Tests
 *
 * Covers FK CASCADE deletes, FK RESTRICT constraints, and other
 * cross-repository interactions that span multiple domain boundaries.
 *
 * Uses useFreshDatabase() fixture for per-test DB isolation.
 */

import {useFreshDatabase} from '../repositoryFixtures';
import {createEntity, deleteEntity, getEntity} from '../../repositories/entities';
import {createCharacterProfile, deleteCharacterProfile, getCharacterProfile} from '../../repositories/characters';
import {createOpenAIProviderConfig, deleteOpenAIProviderConfig} from '../../repositories/providers/OpenAIProviderConfigRepository';
import {createCharacterImage, getCharacterImage} from '../../repositories/characters';

describe('cross-repository behavior', () => {
  const {getDb} = useFreshDatabase();

  describe('FK CASCADE', () => {
    it('deleting an entity cascades to dependent entity_module_mappings', async () => {
      const entityId = 'cascade-entity-1';
      await createEntity({id: entityId, character_profile_id: null, alias: '', lifecycle_config: '{}', rag_reindex_required: 1});

      // Verify direct table access: insert into entity_module_mappings
      const db = getDb();
      await db.executeSql(
        `INSERT INTO entity_module_mappings (entity_id) VALUES (?)`,
        [entityId],
      );

      // Permanent delete entity — should CASCADE to entity_module_mappings
      await deleteEntity(entityId, true);

      // Verify mapping is gone
      const [result] = await db.executeSql(
        'SELECT COUNT(*) as count FROM entity_module_mappings WHERE entity_id = ?',
        [entityId],
      );
      expect(result.rows.item(0).count).toBe(0);
    });

    it('deleting a character profile cascades to character_image', async () => {
      const profileId = 'cascade-profile-1';

      // Create profile with minimal fields
      await createCharacterProfile({
        id: profileId,
        name: 'Cascade Test',
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

      // Insert a character image directly (to test CASCADE)
      const db = getDb();
      const [insertResult] = await db.executeSql(
        `INSERT INTO character_image (character_profile_id, image_data, mime_type, description, is_primary, display_order, vl_model_interpretation, vl_model)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [profileId, 'testdata', 'image/png', 'Test', 0, 0, '', ''],
      );
      const imageId = insertResult.insertId!;

      // Permanent delete profile — should CASCADE to character_image
      await deleteCharacterProfile(profileId, true);

      // Verify image is gone
      const image = await getCharacterImage(imageId, true);
      expect(image).toBeNull();
    });

    it('deleting an entity cascades to memories', async () => {
      const entityId = 'cascade-mem-entity-1';
      await createEntity({id: entityId, character_profile_id: null, alias: '', lifecycle_config: '{}', rag_reindex_required: 1});

      const db = getDb();
      await db.executeSql(
        `INSERT INTO memories (id, entity_id, compaction_level, content, emotional_state_bits, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
        ['mem-cascade-1', entityId, 1, 'Cascade test memory', 0],
      );

      // Permanent delete entity — should CASCADE to memories
      await deleteEntity(entityId, true);

      const [result] = await db.executeSql(
        'SELECT COUNT(*) as count FROM memories WHERE entity_id = ?',
        [entityId],
      );
      expect(result.rows.item(0).count).toBe(0);
    });
  });

  describe('FK RESTRICT', () => {
    it('cannot delete a character profile that is referenced by an entity', async () => {
      const profileId = 'restrict-profile-1';

      await createCharacterProfile({
        id: profileId,
        name: 'Restrict Test',
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

      // Create an entity referencing the profile
      await createEntity({id: 'restrict-entity-1', character_profile_id: profileId, alias: '', lifecycle_config: '{}', rag_reindex_required: 1});

      // Trying to soft-delete the profile should throw because it's in use
      await expect(deleteCharacterProfile(profileId)).rejects.toThrow(/in use/);
    });

    it('cannot hard-delete a character profile that has an entity referencing it (FK RESTRICT)', async () => {
      const profileId = 'restrict-profile-2';

      await createCharacterProfile({
        id: profileId,
        name: 'Restrict Hard Delete',
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

      // Create an entity referencing the profile
      await createEntity({id: 'restrict-entity-2', character_profile_id: profileId, alias: '', lifecycle_config: '{}', rag_reindex_required: 1});

      // Hard-delete should also fail due to FK RESTRICT
      await expect(deleteCharacterProfile(profileId, true)).rejects.toThrow();
    });

    it('can soft-delete a profile not in use', async () => {
      const profileId = 'restrict-profile-3';

      await createCharacterProfile({
        id: profileId,
        name: 'Not In Use',
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

      // Soft delete should succeed (no entity references it)
      await deleteCharacterProfile(profileId);

      const profile = await getCharacterProfile(profileId, true);
      expect(profile).not.toBeNull();
      expect(profile!.deleted_at).not.toBeNull();
    });
  });

  describe('entity alias', () => {
    it('uses unique aliases', async () => {
      const db = getDb();
      await createEntity({id: 'alias-e1', character_profile_id: null, alias: 'alias-one', lifecycle_config: '{}', rag_reindex_required: 1});
      await createEntity({id: 'alias-e2', character_profile_id: null, alias: 'alias-two', lifecycle_config: '{}', rag_reindex_required: 1});

      const e1 = await getEntity('alias-e1');
      const e2 = await getEntity('alias-e2');
      expect(e1).not.toBeNull();
      expect(e2).not.toBeNull();
      expect(e1!.alias).toBe('alias-one');
      expect(e2!.alias).toBe('alias-two');
    });
  });

  describe('cascade delete entity also removes memories', () => {
    it('FK CASCADE from entities to memories on permanent delete', async () => {
      const entityId = 'cascade-mem-only';
      await createEntity({id: entityId, character_profile_id: null, alias: '', lifecycle_config: '{}', rag_reindex_required: 1});

      const db = getDb();
      // Insert memory directly
      await db.executeSql(
        `INSERT INTO memories (id, entity_id, compaction_level, content, emotional_state_bits, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
        ['mem-only-1', entityId, 1, 'Memory for cascade test', 0],
      );

      // Verify memory exists
      const [before] = await db.executeSql(
        'SELECT COUNT(*) as count FROM memories WHERE entity_id = ?',
        [entityId],
      );
      expect(before.rows.item(0).count).toBe(1);

      // Delete entity permanently
      await deleteEntity(entityId, true);

      // Verify memory is gone via CASCADE
      const [after] = await db.executeSql(
        'SELECT COUNT(*) as count FROM memories WHERE entity_id = ?',
        [entityId],
      );
      expect(after.rows.item(0).count).toBe(0);
    });
  });
});
