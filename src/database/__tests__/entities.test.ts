/**
 * Entity Repository Tests
 */

import {initializeDatabase, clearDatabaseData} from '../connection';
import * as entities from '../repositories/entities';
import {runTestWithCleanup, TestResult} from './test-utils';

/**
 * Run all entity repository tests
 */
export async function runEntityTests(): Promise<TestResult[]> {
  const results: TestResult[] = [];

  try {
    console.log('[Test Setup] Initializing database...');
    await initializeDatabase(true);
    await clearDatabaseData(true);

    // Test 1: Create Entity
    results.push(
      await runTestWithCleanup('Create Entity', async () => {
        const testEntityId = 'test-entity-' + Date.now();
        const createdEntity = await entities.createEntity({
          id: testEntityId,
          character_profile_id: null,
        });
        if (!createdEntity || createdEntity.id !== testEntityId) {
          throw new Error('Entity creation failed or ID mismatch');
        }
      })
    );

    // Test 2: Get Entity
    results.push(
      await runTestWithCleanup('Get Entity', async () => {
        const testEntityId = 'test-entity-get-' + Date.now();
        await entities.createEntity({id: testEntityId, character_profile_id: null});
        const retrieved = await entities.getEntity(testEntityId);
        if (!retrieved || retrieved.id !== testEntityId) {
          throw new Error('Failed to retrieve entity');
        }
      })
    );

    // Test 3: Get Non-existent Entity
    results.push(
      await runTestWithCleanup('Get Non-existent Entity', async () => {
        const nonExistent = await entities.getEntity('non-existent-id');
        if (nonExistent !== null) {
          throw new Error('Should return null for non-existent entity');
        }
      })
    );

    // Test 4: Get All Entities
    results.push(
      await runTestWithCleanup('Get All Entities', async () => {
        await entities.getAllEntities();
      })
    );

    // Test 5: Update Entity
    results.push(
      await runTestWithCleanup('Update Entity', async () => {
        const testEntityId = 'test-entity-update-' + Date.now();
        const created = await entities.createEntity({id: testEntityId, character_profile_id: null});
        const updated = await entities.updateEntity({
          ...created,
          character_profile_id: null,
        });
        if (!updated) {
          throw new Error('Update failed');
        }
      })
    );

    // Test 6: Create Entity Module Mapping
    results.push(
      await runTestWithCleanup('Create Entity Module Mapping', async () => {
        const testEntityId = 'test-entity-mapping-' + Date.now();
        await entities.createEntity({id: testEntityId, character_profile_id: null});
        await entities.createEntityModuleMapping({
          entity_id: testEntityId,
          backend_config_id: null,
          cognition_config_id: null,
          movement_config_id: null,
          rag_config_id: null,
          stt_config_id: null,
          tts_config_id: null,
        });
      })
    );

    // Test 7: Get Entity Module Mapping
    results.push(
      await runTestWithCleanup('Get Entity Module Mapping', async () => {
        const testEntityId = 'test-entity-get-mapping-' + Date.now();
        await entities.createEntity({id: testEntityId, character_profile_id: null});
        await entities.createEntityModuleMapping({
          entity_id: testEntityId,
          backend_config_id: null,
          cognition_config_id: null,
          movement_config_id: null,
          rag_config_id: null,
          stt_config_id: null,
          tts_config_id: null,
        });
        const mapping = await entities.getEntityModuleMapping(testEntityId);
        if (!mapping) {
          throw new Error('Failed to retrieve mapping');
        }
      })
    );

    // Test 8: Update Entity Module Mapping
    results.push(
      await runTestWithCleanup('Update Entity Module Mapping', async () => {
        const testEntityId = 'test-entity-upd-mapping-' + Date.now();
        await entities.createEntity({id: testEntityId, character_profile_id: null});
        await entities.createEntityModuleMapping({
          entity_id: testEntityId,
          backend_config_id: null,
          cognition_config_id: null,
          movement_config_id: null,
          rag_config_id: null,
          stt_config_id: null,
          tts_config_id: null,
        });
        await entities.updateEntityModuleMapping({
          entity_id: testEntityId,
          backend_config_id: null,
          cognition_config_id: null,
          movement_config_id: null,
          rag_config_id: null,
          stt_config_id: null,
          tts_config_id: null,
        });
      })
    );

    // Test 9: CASCADE Delete
    results.push(
      await runTestWithCleanup('CASCADE Delete Test', async () => {
        const testEntityId = 'test-entity-cascade-' + Date.now();
        await entities.createEntity({id: testEntityId, character_profile_id: null});
        await entities.createEntityModuleMapping({
          entity_id: testEntityId,
          backend_config_id: null,
          cognition_config_id: null,
          movement_config_id: null,
          rag_config_id: null,
          stt_config_id: null,
          tts_config_id: null,
        });
        await entities.deleteEntity(testEntityId);
        const deletedEntity = await entities.getEntity(testEntityId);
        const deletedMapping = await entities.getEntityModuleMapping(testEntityId);
        if (deletedEntity !== null || deletedMapping !== null) {
          throw new Error('CASCADE delete failed');
        }
      })
    );

    // Test 10: Update Non-existent Entity
    results.push(
      await runTestWithCleanup('Update Non-existent Entity (Error Handling)', async () => {
        try {
          await entities.updateEntity({
            id: 'non-existent-id',
            character_profile_id: null,
            created_at: new Date(),
            updated_at: new Date(),
          });
          throw new Error('Should have thrown error');
        } catch (error) {
          if ((error as Error).message === 'Should have thrown error') {
            throw error;
          }
          // Correctly threw
        }
      })
    );

    // Test 11: Delete Non-existent Entity
    results.push(
      await runTestWithCleanup('Delete Non-existent Entity (Error Handling)', async () => {
        try {
          await entities.deleteEntity('non-existent-id');
          throw new Error('Should have thrown error');
        } catch (error) {
          if ((error as Error).message === 'Should have thrown error') {
            throw error;
          }
          // Correctly threw
        }
      })
    );

    return results;
  } catch (error) {
    console.error('Critical failure in Entity tests:', error);
    results.push({
      name: 'Critical Failure',
      passed: false,
      error: (error as Error).message,
    });
    return results;
  }
}

export default runEntityTests;
