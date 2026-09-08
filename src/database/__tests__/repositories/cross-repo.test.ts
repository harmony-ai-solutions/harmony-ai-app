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
    it('deleting an entity tombstones dependent entity_module_mappings', async () => {
      const entityId = 'cascade-entity-1';
      await createEntity({id: entityId, character_profile_id: null, alias: '', lifecycle_config: '{}', rag_reindex_required: 1});

      // Verify direct table access: insert into entity_module_mappings
      const db = getDb();
      await db.executeSql(
        `INSERT INTO entity_module_mappings (entity_id) VALUES (?)`,
        [entityId],
      );

      // Delete entity (permanent flag ignored — D1/D69–D78) — the mapping is
      // tombstoned, not CASCADE-deleted.
      await deleteEntity(entityId);

      // Verify mapping is still physically present with deleted_at set
      const [result] = await db.executeSql(
        'SELECT COUNT(*) as count FROM entity_module_mappings WHERE entity_id = ? AND deleted_at IS NOT NULL',
        [entityId],
      );
      expect(result.rows.item(0).count).toBe(1);
    });

    it('soft-deleting a character profile tombstones the profile and leaves character_image untouched', async () => {
      const profileId = 'cascade-profile-1';

      // Create profile with minimal fields
      await createCharacterProfile({
        id: profileId,
        name: 'Cascade Test',
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

      // Insert a character image directly
      const db = getDb();
      const imageId = 'cascade-image-1';
      await db.executeSql(
        `INSERT INTO character_image (id, character_profile_id, image_data, mime_type, description, is_primary, display_order, vl_model_interpretation, vl_model)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [imageId, profileId, 'testdata', 'image/png', 'Test', 0, 0, '', ''],
      );

      // Delete profile (permanent flag ignored — D1/D69–D78). The soft path
      // tombstones the profile row; the profile row stays physically present,
      // so the character_image ON DELETE CASCADE FK never fires — the image is
      // untouched (only deleteCharacterProfileCascade tombstones images).
      await deleteCharacterProfile(profileId);

      const profile = await getCharacterProfile(profileId, true);
      expect(profile).not.toBeNull();
      expect(profile!.deleted_at).not.toBeNull();
      const image = await getCharacterImage(imageId, true);
      expect(image).not.toBeNull();
      expect(image!.deleted_at).toBeNull();
    });

    it('deleting an entity tombstones its memories', async () => {
      const entityId = 'cascade-mem-entity-1';
      await createEntity({id: entityId, character_profile_id: null, alias: '', lifecycle_config: '{}', rag_reindex_required: 1});

      const db = getDb();
      await db.executeSql(
        `INSERT INTO memories (id, entity_id, compaction_level, content, emotional_state_bits, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
        ['mem-cascade-1', entityId, 1, 'Cascade test memory', 0],
      );

      // Delete entity (permanent flag ignored — D1/D69–D78) — memories are
      // tombstoned by the cascade, not FK-deleted.
      await deleteEntity(entityId);

      const [result] = await db.executeSql(
        'SELECT COUNT(*) as count FROM memories WHERE entity_id = ? AND deleted_at IS NOT NULL',
        [entityId],
      );
      expect(result.rows.item(0).count).toBe(1);
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
        voice_characteristics: '',
        base_prompt: '',
        scenario: '',
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
        voice_characteristics: '',
        base_prompt: '',
        scenario: '',
        typing_speed_wpm: 60,
        audio_response_chance_percent: 50,
        vision_config_id: null,
        lifecycle_config: '{}',
      });

      // Create an entity referencing the profile
      await createEntity({id: 'restrict-entity-2', character_profile_id: profileId, alias: '', lifecycle_config: '{}', rag_reindex_required: 1});

      // Hard-delete should also fail due to FK RESTRICT
      await expect(deleteCharacterProfile(profileId)).rejects.toThrow();
    });

    it('can soft-delete a profile not in use', async () => {
      const profileId = 'restrict-profile-3';

      await createCharacterProfile({
        id: profileId,
        name: 'Not In Use',
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

  describe('cascade delete entity also tombstones memories', () => {
    it('entity delete tombstones its memories (soft cascade, not FK CASCADE)', async () => {
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

      // Delete entity (permanent flag ignored — D1/D69–D78)
      await deleteEntity(entityId);

      // Verify memory is tombstoned, not gone via CASCADE
      const [after] = await db.executeSql(
        'SELECT COUNT(*) as count FROM memories WHERE entity_id = ? AND deleted_at IS NOT NULL',
        [entityId],
      );
      expect(after.rows.item(0).count).toBe(1);
    });
  });
});
