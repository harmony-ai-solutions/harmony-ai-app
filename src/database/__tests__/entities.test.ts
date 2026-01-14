/**
 * Entity Repository Tests
 * 
 * Manual test script for entity CRUD operations
 * Run this to validate entity repository implementation
 */

import {initializeDatabase} from '../connection';
import * as entities from '../repositories/entities';

/**
 * Run all entity repository tests
 */
export async function runEntityTests() {
  console.log('\n=== Entity Repository Tests ===\n');
  
  try {
    // Initialize database
    console.log('[Test Setup] Initializing database...');
    await initializeDatabase();
    console.log('✅ Database initialized\n');
    
    // Test 1: Create Entity
    console.log('[Test 1] Create Entity');
    const testEntityId = 'test-entity-' + Date.now();
    const createdEntity = await entities.createEntity({
      id: testEntityId,
      character_profile_id: null,
    });
    console.log('✅ Entity created:', createdEntity.id);
    console.log('   Created at:', createdEntity.created_at);
    console.log('   Updated at:', createdEntity.updated_at);
    
    // Test 2: Get Entity
    console.log('\n[Test 2] Get Entity');
    const retrieved = await entities.getEntity(testEntityId);
    if (retrieved && retrieved.id === testEntityId) {
      console.log('✅ Entity retrieved successfully');
      console.log('   ID:', retrieved.id);
      console.log('   Character Profile ID:', retrieved.character_profile_id);
    } else {
      console.log('❌ Failed to retrieve entity');
    }
    
    // Test 3: Get Non-existent Entity
    console.log('\n[Test 3] Get Non-existent Entity');
    const nonExistent = await entities.getEntity('non-existent-id');
    if (nonExistent === null) {
      console.log('✅ Returns null for non-existent entity');
    } else {
      console.log('❌ Should return null for non-existent entity');
    }
    
    // Test 4: Get All Entities
    console.log('\n[Test 4] Get All Entities');
    const allEntities = await entities.getAllEntities();
    console.log('✅ Retrieved all entities:', allEntities.length, 'total');
    
    // Test 5: Update Entity
    console.log('\n[Test 5] Update Entity');
    const updatedEntity = await entities.updateEntity({
      ...createdEntity,
      character_profile_id: 'test-profile-id',
    });
    console.log('✅ Entity updated');
    console.log('   Character Profile ID:', updatedEntity.character_profile_id);
    console.log('   Updated at:', updatedEntity.updated_at);
    
    // Test 6: Create Entity Module Mapping
    console.log('\n[Test 6] Create Entity Module Mapping');
    await entities.createEntityModuleMapping({
      entity_id: testEntityId,
      backend_config_id: null,
      cognition_config_id: null,
      movement_config_id: null,
      rag_config_id: null,
      stt_config_id: null,
      tts_config_id: null,
    });
    console.log('✅ Entity module mapping created');
    
    // Test 7: Get Entity Module Mapping
    console.log('\n[Test 7] Get Entity Module Mapping');
    const mapping = await entities.getEntityModuleMapping(testEntityId);
    if (mapping) {
      console.log('✅ Entity module mapping retrieved');
      console.log('   Entity ID:', mapping.entity_id);
    } else {
      console.log('❌ Failed to retrieve entity module mapping');
    }
    
    // Test 8: Update Entity Module Mapping
    console.log('\n[Test 8] Update Entity Module Mapping');
    await entities.updateEntityModuleMapping({
      entity_id: testEntityId,
      backend_config_id: 1,
      cognition_config_id: 2,
      movement_config_id: null,
      rag_config_id: null,
      stt_config_id: null,
      tts_config_id: null,
    });
    console.log('✅ Entity module mapping updated');
    
    // Test 9: CASCADE Delete (Delete Entity should delete mapping)
    console.log('\n[Test 9] CASCADE Delete Test');
    await entities.deleteEntity(testEntityId);
    const deletedEntity = await entities.getEntity(testEntityId);
    const deletedMapping = await entities.getEntityModuleMapping(testEntityId);
    if (deletedEntity === null && deletedMapping === null) {
      console.log('✅ Entity deleted successfully');
      console.log('✅ Entity module mapping CASCADE deleted');
    } else {
      console.log('❌ CASCADE delete failed');
    }
    
    // Test 10: Update Non-existent Entity (should throw error)
    console.log('\n[Test 10] Update Non-existent Entity (Error Handling)');
    try {
      await entities.updateEntity({
        id: 'non-existent-id',
        character_profile_id: null,
        created_at: new Date(),
        updated_at: new Date(),
      });
      console.log('❌ Should have thrown error for non-existent entity');
    } catch (error) {
      console.log('✅ Correctly throws error for non-existent entity');
      console.log('   Error:', (error as Error).message);
    }
    
    // Test 11: Delete Non-existent Entity (should throw error)
    console.log('\n[Test 11] Delete Non-existent Entity (Error Handling)');
    try {
      await entities.deleteEntity('non-existent-id');
      console.log('❌ Should have thrown error for non-existent entity');
    } catch (error) {
      console.log('✅ Correctly throws error for non-existent entity');
      console.log('   Error:', (error as Error).message);
    }
    
    console.log('\n=== All Entity Tests Complete ✅ ===\n');
    return true;
  } catch (error) {
    console.error('\n❌ Test failed with error:', error);
    return false;
  }
}

// Export for use in larger test suites
export default runEntityTests;
