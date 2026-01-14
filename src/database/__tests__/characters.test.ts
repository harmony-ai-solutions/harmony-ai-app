/**
 * Character Repository Tests
 */

import {initializeDatabase, clearDatabaseData} from '../connection';
import * as characters from '../repositories/characters';
import {runTestWithCleanup, TestResult} from './test-utils';

/**
 * Run all character repository tests
 */
export async function runCharacterTests(): Promise<TestResult[]> {
  const results: TestResult[] = [];

  try {
    console.log('[Test Setup] Initializing database...');
    await initializeDatabase(true);
    await clearDatabaseData(true);

    // Test 1: Create Character Profile
    results.push(
      await runTestWithCleanup('Create Character Profile', async () => {
        const testProfileId = 'test-profile-' + Date.now();
        await characters.createCharacterProfile({
          id: testProfileId,
          name: 'Test Character',
          description: 'A test character for database testing',
          personality: 'Friendly and helpful',
          appearance: 'Tall with blue eyes',
          backstory: 'Created for testing purposes',
          voice_characteristics: 'Calm and soothing',
          base_prompt: 'You are a helpful assistant',
          scenario: 'Testing scenario',
          example_dialogues: 'User: Hello\nAssistant: Hi there!',
        });
      })
    );

    // Test 2: Get Character Profile
    results.push(
      await runTestWithCleanup('Get Character Profile', async () => {
        const testProfileId = 'test-profile-get-' + Date.now();
        await characters.createCharacterProfile({
          id: testProfileId,
          name: 'Test',
          description: null,
          personality: null,
          appearance: null,
          backstory: null,
          voice_characteristics: null,
          base_prompt: null,
          scenario: null,
          example_dialogues: null,
        });
        const retrieved = await characters.getCharacterProfile(testProfileId);
        if (!retrieved || retrieved.id !== testProfileId) {
          throw new Error('Failed to retrieve character profile');
        }
      })
    );

    // Test 3: Get All Character Profiles
    results.push(
      await runTestWithCleanup('Get All Character Profiles', async () => {
        await characters.getAllCharacterProfiles();
      })
    );

    // Test 4: Update Character Profile
    results.push(
      await runTestWithCleanup('Update Character Profile', async () => {
        const testProfileId = 'test-profile-upd-' + Date.now();
        const created = await characters.createCharacterProfile({
          id: testProfileId,
          name: 'Original',
          description: null,
          personality: null,
          appearance: null,
          backstory: null,
          voice_characteristics: null,
          base_prompt: null,
          scenario: null,
          example_dialogues: null,
        });
        await characters.updateCharacterProfile({
          ...created,
          description: 'Updated',
        });
      })
    );

    // Test 5: Check Profile In Use
    results.push(
      await runTestWithCleanup('Check Profile In Use', async () => {
        const testProfileId = 'test-profile-inuse-' + Date.now();
        await characters.createCharacterProfile({
          id: testProfileId,
          name: 'Test',
          description: null,
          personality: null,
          appearance: null,
          backstory: null,
          voice_characteristics: null,
          base_prompt: null,
          scenario: null,
          example_dialogues: null,
        });
        const inUse = await characters.isCharacterProfileInUse(testProfileId);
        if (inUse) {
          throw new Error('Profile should not be in use');
        }
      })
    );

    // Test 6: Create Character Image
    results.push(
      await runTestWithCleanup('Create Character Image', async () => {
        const testProfileId = 'test-profile-img-' + Date.now();
        await characters.createCharacterProfile({
          id: testProfileId,
          name: 'Test',
          description: null,
          personality: null,
          appearance: null,
          backstory: null,
          voice_characteristics: null,
          base_prompt: null,
          scenario: null,
          example_dialogues: null,
        });
        const mockImageData = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
        await characters.createCharacterImage({
          character_profile_id: testProfileId,
          image_data: mockImageData,
          mime_type: 'image/png',
          description: 'Test avatar',
          is_primary: true,
          display_order: 0,
          vl_model_interpretation: 'Test interpretation',
          vl_model: 'test-model',
          vl_model_embedding: null,
        });
      })
    );

    // Test 7: Get Character Image
    results.push(
      await runTestWithCleanup('Get Character Image', async () => {
        const testProfileId = 'test-profile-img-get-' + Date.now();
        await characters.createCharacterProfile({
          id: testProfileId,
          name: 'Test',
          description: null,
          personality: null,
          appearance: null,
          backstory: null,
          voice_characteristics: null,
          base_prompt: null,
          scenario: null,
          example_dialogues: null,
        });
        const mockImageData = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
        const imageId = await characters.createCharacterImage({
          character_profile_id: testProfileId,
          image_data: mockImageData,
          mime_type: 'image/png',
          description: 'Test avatar',
          is_primary: true,
          display_order: 0,
          vl_model_interpretation: 'Test interpretation',
          vl_model: 'test-model',
          vl_model_embedding: null,
        });
        const retrieved = await characters.getCharacterImage(imageId);
        if (!retrieved) {
          throw new Error('Failed to retrieve image');
        }
      })
    );

    // Test 8: Get Character Images for Profile
    results.push(
      await runTestWithCleanup('Get Character Images for Profile', async () => {
        const testProfileId = 'test-profile-imgs-' + Date.now();
        await characters.createCharacterProfile({
          id: testProfileId,
          name: 'Test',
          description: null,
          personality: null,
          appearance: null,
          backstory: null,
          voice_characteristics: null,
          base_prompt: null,
          scenario: null,
          example_dialogues: null,
        });
        await characters.getCharacterImages(testProfileId);
      })
    );

    // Test 9: Get Primary Image
    results.push(
      await runTestWithCleanup('Get Primary Image', async () => {
        const testProfileId = 'test-profile-primary-' + Date.now();
        await characters.createCharacterProfile({
          id: testProfileId,
          name: 'Test',
          description: null,
          personality: null,
          appearance: null,
          backstory: null,
          voice_characteristics: null,
          base_prompt: null,
          scenario: null,
          example_dialogues: null,
        });
        const mockImageData = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
        await characters.createCharacterImage({
          character_profile_id: testProfileId,
          image_data: mockImageData,
          mime_type: 'image/png',
          description: 'Test avatar',
          is_primary: true,
          display_order: 0,
          vl_model_interpretation: 'Test interpretation',
          vl_model: 'test-model',
          vl_model_embedding: null,
        });
        const primary = await characters.getPrimaryImage(testProfileId);
        if (!primary) {
          throw new Error('Failed to retrieve primary image');
        }
      })
    );

    // Test 10: Image to Data URL
    results.push(
      await runTestWithCleanup('Image to Data URL Conversion', async () => {
        const mockImage = {
          id: 1,
          character_profile_id: 'test',
          image_data: new Uint8Array([1, 2, 3]),
          mime_type: 'image/png',
          is_primary: true,
          display_order: 0,
          description: 'Test',
          vl_model_interpretation: 'Test',
          vl_model: 'Test',
          vl_model_embedding: null,
          created_at: new Date(),
          updated_at: new Date(),
        };
        const url = characters.imageToDataURL(mockImage);
        if (!url.startsWith('data:image/png;base64,')) {
          throw new Error('Invalid data URL');
        }
      })
    );

    // Test 11: Get Images with Data URLs
    results.push(
      await runTestWithCleanup('Get Images with Data URLs', async () => {
        const testProfileId = 'test-profile-dataurls-' + Date.now();
        await characters.createCharacterProfile({
          id: testProfileId,
          name: 'Test',
          description: null,
          personality: null,
          appearance: null,
          backstory: null,
          voice_characteristics: null,
          base_prompt: null,
          scenario: null,
          example_dialogues: null,
        });
        await characters.getCharacterImagesWithDataURLs(testProfileId);
      })
    );

    // Test 12: Set Primary Image
    results.push(
      await runTestWithCleanup('Set Primary Image', async () => {
        const testProfileId = 'test-profile-set-primary-' + Date.now();
        await characters.createCharacterProfile({
          id: testProfileId,
          name: 'Test',
          description: null,
          personality: null,
          appearance: null,
          backstory: null,
          voice_characteristics: null,
          base_prompt: null,
          scenario: null,
          example_dialogues: null,
        });
        const mockImageData = new Uint8Array([1, 2, 3]);
        const baseParams = {
          character_profile_id: testProfileId,
          image_data: mockImageData,
          mime_type: 'image/png',
          description: '',
          vl_model_interpretation: '',
          vl_model: '',
          vl_model_embedding: null,
        };
        const id1 = await characters.createCharacterImage({
          ...baseParams,
          is_primary: true,
          display_order: 0,
        });
        const id2 = await characters.createCharacterImage({
          ...baseParams,
          is_primary: false,
          display_order: 1,
        });
        await characters.setPrimaryImage(testProfileId, id2);
        const primary = await characters.getPrimaryImage(testProfileId);
        if (!primary || primary.id !== id2) {
          throw new Error('Primary image not switched');
        }
      })
    );

    // Test 13: Delete Character Image
    results.push(
      await runTestWithCleanup('Delete Character Image', async () => {
        const testProfileId = 'test-profile-del-img-' + Date.now();
        await characters.createCharacterProfile({
          id: testProfileId,
          name: 'Test',
          description: null,
          personality: null,
          appearance: null,
          backstory: null,
          voice_characteristics: null,
          base_prompt: null,
          scenario: null,
          example_dialogues: null,
        });
        const id = await characters.createCharacterImage({
          character_profile_id: testProfileId,
          image_data: new Uint8Array([1]),
          mime_type: 'image/png',
          is_primary: true,
          display_order: 0,
          description: '',
          vl_model_interpretation: '',
          vl_model: '',
          vl_model_embedding: null,
        });
        await characters.deleteCharacterImage(id);
        const retrieved = await characters.getCharacterImage(id);
        if (retrieved !== null) {
          throw new Error('Image not deleted');
        }
      })
    );

    // Test 14: Delete Character Profile & CASCADE
    results.push(
      await runTestWithCleanup('Delete Character Profile & CASCADE', async () => {
        const testProfileId = 'test-profile-del-cascade-' + Date.now();
        await characters.createCharacterProfile({
          id: testProfileId,
          name: 'Test',
          description: null,
          personality: null,
          appearance: null,
          backstory: null,
          voice_characteristics: null,
          base_prompt: null,
          scenario: null,
          example_dialogues: null,
        });
        const id = await characters.createCharacterImage({
          character_profile_id: testProfileId,
          image_data: new Uint8Array([1]),
          mime_type: 'image/png',
          is_primary: true,
          display_order: 0,
          description: '',
          vl_model_interpretation: '',
          vl_model: '',
          vl_model_embedding: null,
        });
        await characters.deleteCharacterProfile(testProfileId);
        const profile = await characters.getCharacterProfile(testProfileId);
        const image = await characters.getCharacterImage(id);
        if (profile !== null || image !== null) {
          throw new Error('Profile or image not deleted (CASCADE failed)');
        }
      })
    );

    return results;
  } catch (error) {
    console.error('Critical failure in Character tests:', error);
    results.push({
      name: 'Critical Failure',
      passed: false,
      error: (error as Error).message,
    });
    return results;
  }
}

export default runCharacterTests;
