/**
 * Character Repository Tests
 * 
 * Manual test script for character profile and image CRUD operations
 * Run this to validate character repository implementation
 */

import {initializeDatabase} from '../connection';
import * as characters from '../repositories/characters';

/**
 * Run all character repository tests
 */
export async function runCharacterTests() {
  console.log('\n=== Character Repository Tests ===\n');
  
  try {
    // Initialize database
    console.log('[Test Setup] Initializing database...');
    await initializeDatabase();
    console.log('✅ Database initialized\n');
    
    // Test 1: Create Character Profile
    console.log('[Test 1] Create Character Profile');
    const testProfileId = 'test-profile-' + Date.now();
    const createdProfile = await characters.createCharacterProfile({
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
    console.log('✅ Character profile created:', createdProfile.name);
    console.log('   ID:', createdProfile.id);
    
    // Test 2: Get Character Profile
    console.log('\n[Test 2] Get Character Profile');
    const retrieved = await characters.getCharacterProfile(testProfileId);
    if (retrieved && retrieved.id === testProfileId) {
      console.log('✅ Character profile retrieved successfully');
      console.log('   Name:', retrieved.name);
      console.log('   Description:', retrieved.description);
    } else {
      console.log('❌ Failed to retrieve character profile');
    }
    
    // Test 3: Get All Character Profiles
    console.log('\n[Test 3] Get All Character Profiles');
    const allProfiles = await characters.getAllCharacterProfiles();
    console.log('✅ Retrieved all profiles:', allProfiles.length, 'total');
    
    // Test 4: Update Character Profile
    console.log('\n[Test 4] Update Character Profile');
    const updatedProfile = await characters.updateCharacterProfile({
      ...createdProfile,
      description: 'Updated description for testing',
      personality: 'Very friendly',
    });
    console.log('✅ Character profile updated');
    console.log('   Description:', updatedProfile.description);
    console.log('   Personality:', updatedProfile.personality);
    
    // Test 5: Check Profile In Use (should be false)
    console.log('\n[Test 5] Check Profile In Use');
    const inUse = await characters.isCharacterProfileInUse(testProfileId);
    if (!inUse) {
      console.log('✅ Profile correctly reports as not in use');
    } else {
      console.log('❌ Profile should not be in use');
    }
    
    // Test 6: Create Character Image (Mock BLOB data)
    console.log('\n[Test 6] Create Character Image');
    const mockImageData = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]); // PNG header
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
    console.log('✅ Character image created with ID:', imageId);
    
    // Test 7: Get Character Image
    console.log('\n[Test 7] Get Character Image');
    const retrievedImage = await characters.getCharacterImage(imageId);
    if (retrievedImage) {
      console.log('✅ Character image retrieved');
      console.log('   ID:', retrievedImage.id);
      console.log('   MIME type:', retrievedImage.mime_type);
      console.log('   Is Primary:', retrievedImage.is_primary);
      console.log('   Image data length:', retrievedImage.image_data.length, 'bytes');
    } else {
      console.log('❌ Failed to retrieve character image');
    }
    
    // Test 8: Get Character Images for Profile
    console.log('\n[Test 8] Get Character Images for Profile');
    const images = await characters.getCharacterImages(testProfileId);
    console.log('✅ Retrieved images:', images.length, 'total');
    
    // Test 9: Get Primary Image
    console.log('\n[Test 9] Get Primary Image');
    const primaryImage = await characters.getPrimaryImage(testProfileId);
    if (primaryImage) {
      console.log('✅ Primary image retrieved');
      console.log('   ID:', primaryImage.id);
      console.log('   Is Primary:', primaryImage.is_primary);
    } else {
      console.log('❌ Failed to retrieve primary image');
    }
    
    // Test 10: Image to Data URL Conversion
    console.log('\n[Test 10] Image to Data URL Conversion');
    if (retrievedImage) {
      const dataURL = characters.imageToDataURL(retrievedImage);
      console.log('✅ Image converted to data URL');
      console.log('   Data URL prefix:', dataURL.substring(0, 50) + '...');
    }
    
    // Test 11: Get Images with Data URLs
    console.log('\n[Test 11] Get Images with Data URLs');
    const imagesWithDataURLs = await characters.getCharacterImagesWithDataURLs(testProfileId);
    if (imagesWithDataURLs.length > 0) {
      console.log('✅ Images with data URLs retrieved:', imagesWithDataURLs.length);
      console.log('   First image data URL length:', imagesWithDataURLs[0].data_url.length);
    }
    
    // Test 12: Create Second Image (not primary)
    console.log('\n[Test 12] Create Second Image');
    const imageId2 = await characters.createCharacterImage({
      character_profile_id: testProfileId,
      image_data: mockImageData,
      mime_type: 'image/png',
      description: 'Second test image',
      is_primary: false,
      display_order: 1,
      vl_model_interpretation: 'Second interpretation',
      vl_model: 'test-model',
      vl_model_embedding: null,
    });
    console.log('✅ Second image created with ID:', imageId2);
    
    // Test 13: Set Primary Image (switch primary)
    console.log('\n[Test 13] Set Primary Image');
    await characters.setPrimaryImage(testProfileId, imageId2);
    const newPrimary = await characters.getPrimaryImage(testProfileId);
    if (newPrimary && newPrimary.id === imageId2) {
      console.log('✅ Primary image switched successfully');
      console.log('   New primary ID:', newPrimary.id);
    } else {
      console.log('❌ Failed to switch primary image');
    }
    
    // Test 14: Update Character Image
    console.log('\n[Test 14] Update Character Image');
    await characters.updateCharacterImage({
      id: imageId,
      description: 'Updated description',
      display_order: 2,
      is_primary: false,
    });
    console.log('✅ Character image updated');
    
    // Test 15: Delete Character Image
    console.log('\n[Test 15] Delete Character Image');
    await characters.deleteCharacterImage(imageId);
    const deletedImage = await characters.getCharacterImage(imageId);
    if (deletedImage === null) {
      console.log('✅ Character image deleted successfully');
    } else {
      console.log('❌ Image deletion failed');
    }
    
    // Test 16: Delete Character Profile
    console.log('\n[Test 16] Delete Character Profile');
    await characters.deleteCharacterProfile(testProfileId);
    const deletedProfile = await characters.getCharacterProfile(testProfileId);
    if (deletedProfile === null) {
      console.log('✅ Character profile deleted successfully');
    } else {
      console.log('❌ Profile deletion failed');
    }
    
    // Test 17: Verify CASCADE Delete (images should be deleted too)
    console.log('\n[Test 17] Verify CASCADE Delete');
    const remainingImages = await characters.getCharacterImages(testProfileId);
    if (remainingImages.length === 0) {
      console.log('✅ Images CASCADE deleted with profile');
    } else {
      console.log('❌ CASCADE delete failed, images still exist');
    }
    
    // Test 18: Error Handling - Update Non-existent Profile
    console.log('\n[Test 18] Update Non-existent Profile (Error Handling)');
    try {
      await characters.updateCharacterProfile({
        id: 'non-existent-id',
        name: 'Test',
        description: null,
        personality: null,
        appearance: null,
        backstory: null,
        voice_characteristics: null,
        base_prompt: null,
        scenario: null,
        example_dialogues: null,
        created_at: new Date(),
        updated_at: new Date(),
      });
      console.log('❌ Should have thrown error');
    } catch (error) {
      console.log('✅ Correctly throws error for non-existent profile');
      console.log('   Error:', (error as Error).message);
    }
    
    console.log('\n=== All Character Tests Complete ✅ ===\n');
    return true;
  } catch (error) {
    console.error('\n❌ Test failed with error:', error);
    return false;
  }
}

// Export for use in larger test suites
export default runCharacterTests;
