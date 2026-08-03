/**
 * Entity Repository Tests
 *
 * Ported from the deleted hand-rolled test file. 11 test cases.
 * Uses useFreshDatabase() fixture for per-test DB isolation.
 */

import {useFreshDatabase} from '../repositoryFixtures';
import {
  createEntity,
  getEntity,
  getAllEntities,
  updateEntity,
  deleteEntity,
  createEntityModuleMapping,
  createOrUpdateEntityModuleMapping,
  getEntityModuleMapping,
  updateEntityModuleMapping,
  deleteEntityModuleMapping,
} from '../../repositories/entities';

describe('entities repository', () => {
  const {getDb} = useFreshDatabase();

  describe('createEntity', () => {
    it('Create Entity', async () => {
      const id = 'test-entity-' + Date.now();
      const created = await createEntity({
        id,
        character_profile_id: null,
        alias: '',
        lifecycle_config: '{}',
        rag_reindex_required: 1,
      });
      expect(created).toBeDefined();
      expect(created.id).toBe(id);
    });

    it('Get Entity', async () => {
      const id = 'test-entity-persist';
      await createEntity({id, character_profile_id: null, alias: '', lifecycle_config: '{}', rag_reindex_required: 1});
      const retrieved = await getEntity(id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(id);
    });
  });

  describe('getEntity', () => {
    it('Get Non-existent Entity', async () => {
      const result = await getEntity('non-existent-id');
      expect(result).toBeNull();
    });
  });

  describe('getAllEntities', () => {
    it('Get All Entities (improved: asserts count)', async () => {
      // Create multiple entities and assert the count
      await createEntity({id: 'entity-1', character_profile_id: null, alias: '', lifecycle_config: '{}', rag_reindex_required: 1});
      await createEntity({id: 'entity-2', character_profile_id: null, alias: '', lifecycle_config: '{}', rag_reindex_required: 1});
      await createEntity({id: 'entity-3', character_profile_id: null, alias: '', lifecycle_config: '{}', rag_reindex_required: 1});

      const all = await getAllEntities();
      expect(all.length).toBeGreaterThanOrEqual(3);
      const ids = all.map(e => e.id);
      expect(ids).toContain('entity-1');
      expect(ids).toContain('entity-2');
      expect(ids).toContain('entity-3');
    });
  });

  describe('updateEntity', () => {
    it('Update Entity', async () => {
      const id = 'entity-upd-1';
      await createEntity({id, character_profile_id: null, alias: '', lifecycle_config: '{}', rag_reindex_required: 1});
      const updated = await updateEntity({
        id,
        alias: 'updated-alias',
        character_profile_id: null,
        lifecycle_config: '{}',
        rag_reindex_required: 1,
        created_at: new Date(),
        updated_at: new Date(),
        deleted_at: null,
      });
      expect(updated).toBeDefined();
    });

    it('Update Non-existent Entity (Error Handling)', async () => {
      await expect(
        updateEntity({
          id: 'non-existent-id',
          alias: '',
          character_profile_id: null,
          lifecycle_config: '{}',
          rag_reindex_required: 1,
          created_at: new Date(),
          updated_at: new Date(),
          deleted_at: null,
        }),
      ).rejects.toThrow();
    });
  });

  describe('deleteEntity', () => {
    it('Delete Non-existent Entity (Error Handling)', async () => {
      await expect(deleteEntity('non-existent-id')).rejects.toThrow();
    });
  });

  describe('entity module mappings', () => {
    it('Create Entity Module Mapping', async () => {
      const entityId = 'entity-mapping-1';
      await createEntity({id: entityId, character_profile_id: null, alias: '', lifecycle_config: '{}', rag_reindex_required: 1});
      // Should not throw
      await expect(
        createEntityModuleMapping({
          entity_id: entityId,
          backend_config_id: null,
          cognition_config_id: null,
          imagination_config_id: null,
          movement_config_id: null,
          rag_config_id: null,
          stt_config_id: null,
          tts_config_id: null,
          vision_config_id: null,
          deleted_at: null,
        }),
      ).resolves.toBeUndefined();
    });

    it('Get Entity Module Mapping', async () => {
      const entityId = 'entity-mapping-2';
      await createEntity({id: entityId, character_profile_id: null, alias: '', lifecycle_config: '{}', rag_reindex_required: 1});
      await createEntityModuleMapping({
        entity_id: entityId,
        backend_config_id: null,
        cognition_config_id: null,
        imagination_config_id: null,
        movement_config_id: null,
        rag_config_id: null,
        stt_config_id: null,
        tts_config_id: null,
        vision_config_id: null,
        deleted_at: null,
      });
      const mapping = await getEntityModuleMapping(entityId);
      expect(mapping).not.toBeNull();
      expect(mapping!.entity_id).toBe(entityId);
    });

    it('Update Entity Module Mapping', async () => {
      const entityId = 'entity-mapping-3';
      await createEntity({id: entityId, character_profile_id: null, alias: '', lifecycle_config: '{}', rag_reindex_required: 1});
      await createEntityModuleMapping({
        entity_id: entityId,
        backend_config_id: null,
        cognition_config_id: null,
        imagination_config_id: null,
        movement_config_id: null,
        rag_config_id: null,
        stt_config_id: null,
        tts_config_id: null,
        vision_config_id: null,
        deleted_at: null,
      });
      // Update with same data should not throw
      await expect(
        updateEntityModuleMapping({
          entity_id: entityId,
          backend_config_id: null,
          cognition_config_id: null,
          imagination_config_id: null,
          movement_config_id: null,
          rag_config_id: null,
          stt_config_id: null,
          tts_config_id: null,
          vision_config_id: null,
          deleted_at: null,
        }),
      ).resolves.toBeUndefined();
    });

    it('Create Entity Module Mapping with empty-string config IDs (defaults from CreateAIScreen) does not throw FK error', async () => {
      const entityId = 'entity-mapping-empty-string';
      await createEntity({id: entityId, character_profile_id: null, alias: '', lifecycle_config: '{}', rag_reindex_required: 1});
      // Reproduces the CreateAIScreen bug: config IDs default to '' (empty string)
      // when the advanced panel was never opened, and '' ?? null still yields ''.
      // Inserting '' into FK columns violated the config-table constraints (code 787).
      await expect(
        createEntityModuleMapping({
          entity_id: entityId,
          backend_config_id: '',
          cognition_config_id: '',
          imagination_config_id: '',
          movement_config_id: '',
          rag_config_id: '',
          stt_config_id: '',
          tts_config_id: '',
          vision_config_id: '',
          deleted_at: null,
        }),
      ).resolves.toBeUndefined();

      // The stored mapping must have NULLs, not empty strings, so sync doesn't
      // propagate garbage and the FK columns stay valid.
      const mapping = await getEntityModuleMapping(entityId);
      expect(mapping).not.toBeNull();
      expect(mapping!.backend_config_id).toBeNull();
      expect(mapping!.cognition_config_id).toBeNull();
      expect(mapping!.imagination_config_id).toBeNull();
      expect(mapping!.movement_config_id).toBeNull();
      expect(mapping!.rag_config_id).toBeNull();
      expect(mapping!.stt_config_id).toBeNull();
      expect(mapping!.tts_config_id).toBeNull();
      expect(mapping!.vision_config_id).toBeNull();
    });

    it('createOrUpdateEntityModuleMapping with empty-string config IDs does not throw FK error', async () => {
      const entityId = 'entity-mapping-empty-string-upsert';
      await createEntity({id: entityId, character_profile_id: null, alias: '', lifecycle_config: '{}', rag_reindex_required: 1});
      // EntityConfigEditScreen passes '' defaults the same way ('' ?? null == '').
      await expect(
        createOrUpdateEntityModuleMapping({
          entity_id: entityId,
          backend_config_id: '',
          cognition_config_id: '',
          imagination_config_id: '',
          movement_config_id: '',
          rag_config_id: '',
          stt_config_id: '',
          tts_config_id: '',
          vision_config_id: '',
        }),
      ).resolves.toBeUndefined();

      const mapping = await getEntityModuleMapping(entityId);
      expect(mapping).not.toBeNull();
      expect(mapping!.backend_config_id).toBeNull();
      expect(mapping!.cognition_config_id).toBeNull();
    });

    it('CASCADE Delete Test', async () => {
      const entityId = 'entity-cascade-1';
      await createEntity({id: entityId, character_profile_id: null, alias: '', lifecycle_config: '{}', rag_reindex_required: 1});
      await createEntityModuleMapping({
        entity_id: entityId,
        backend_config_id: null,
        cognition_config_id: null,
        imagination_config_id: null,
        movement_config_id: null,
        rag_config_id: null,
        stt_config_id: null,
        tts_config_id: null,
        vision_config_id: null,
        deleted_at: null,
      });
      // Permanent delete should cascade to entity_module_mappings
      await deleteEntity(entityId, true);
      const entity = await getEntity(entityId, true);
      expect(entity).toBeNull();
      const mapping = await getEntityModuleMapping(entityId, true);
      expect(mapping).toBeNull();
    });
  });
});
