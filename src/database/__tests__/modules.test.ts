/**
 * Module Repository Tests
 * 
 * Manual test script for all module configuration CRUD operations
 * Tests: Backend, Cognition, Movement, RAG, STT, TTS
 */

import {initializeDatabase} from '../connection';
import * as modules from '../repositories/modules';

/**
 * Run all module repository tests
 */
export async function runModuleTests() {
  console.log('\n=== Module Repository Tests ===\n');
  
  try {
    // Initialize database
    console.log('[Test Setup] Initializing database...');
    await initializeDatabase();
    console.log('✅ Database initialized\n');
    
    // ========================================================================
    // Backend Config Tests
    // ========================================================================
    
    console.log('[Test 1] Create Backend Config');
    const backendId = await modules.createBackendConfig({
      name: 'Test Backend',
      provider: 'openai',
      provider_config_id: 1,
    });
    console.log('✅ Backend config created with ID:', backendId);
    
    console.log('\n[Test 2] Get Backend Config');
    const backend = await modules.getBackendConfig(backendId);
    if (backend) {
      console.log('✅ Backend config retrieved:', backend.name);
    } else {
      console.log('❌ Failed to retrieve backend config');
    }
    
    console.log('\n[Test 3] Get Backend Config By Name');
    const backendByName = await modules.getBackendConfigByName('Test Backend');
    if (backendByName) {
      console.log('✅ Backend config retrieved by name:', backendByName.id);
    }
    
    console.log('\n[Test 4] Get All Backend Configs');
    const allBackends = await modules.getAllBackendConfigs();
    console.log('✅ Retrieved all backend configs:', allBackends.length);
    
    console.log('\n[Test 5] Update Backend Config');
    if (backend) {
      await modules.updateBackendConfig({
        ...backend,
        name: 'Updated Backend',
      });
      console.log('✅ Backend config updated');
    }
    
    // ========================================================================
    // Cognition Config Tests
    // ========================================================================
    
    console.log('\n[Test 6] Create Cognition Config');
    const cognitionId = await modules.createCognitionConfig({
      name: 'Test Cognition',
      provider: 'openai',
      provider_config_id: 1,
      max_cognition_events: 10,
      generate_expressions: 1,
    });
    console.log('✅ Cognition config created with ID:', cognitionId);
    
    console.log('\n[Test 7] Get Cognition Config');
    const cognition = await modules.getCognitionConfig(cognitionId);
    if (cognition) {
      console.log('✅ Cognition config retrieved:', cognition.name);
      console.log('   Max events:', cognition.max_cognition_events);
      console.log('   Generate expressions:', cognition.generate_expressions);
    }
    
    console.log('\n[Test 8] Update Cognition Config');
    if (cognition) {
      await modules.updateCognitionConfig({
        ...cognition,
        max_cognition_events: 20,
      });
      console.log('✅ Cognition config updated');
    }
    
    // ========================================================================
    // Movement Config Tests
    // ========================================================================
    
    console.log('\n[Test 9] Create Movement Config');
    const movementId = await modules.createMovementConfig({
      name: 'Test Movement',
      provider: 'openai',
      provider_config_id: 1,
      startup_sync_timeout: 5000,
      execution_threshold: 0.7,
    });
    console.log('✅ Movement config created with ID:', movementId);
    
    console.log('\n[Test 10] Get Movement Config');
    const movement = await modules.getMovementConfig(movementId);
    if (movement) {
      console.log('✅ Movement config retrieved:', movement.name);
      console.log('   Timeout:', movement.startup_sync_timeout);
      console.log('   Threshold:', movement.execution_threshold);
    }
    
    // ========================================================================
    // RAG Config Tests
    // ========================================================================
    
    console.log('\n[Test 11] Create RAG Config');
    const ragId = await modules.createRAGConfig({
      name: 'Test RAG',
      provider: 'openai',
      provider_config_id: 1,
      embedding_concurrency: 5,
    });
    console.log('✅ RAG config created with ID:', ragId);
    
    console.log('\n[Test 12] Get RAG Config');
    const rag = await modules.getRAGConfig(ragId);
    if (rag) {
      console.log('✅ RAG config retrieved:', rag.name);
      console.log('   Concurrency:', rag.embedding_concurrency);
    }
    
    console.log('\n[Test 13] Get All RAG Configs');
    const allRAGs = await modules.getAllRAGConfigs();
    console.log('✅ Retrieved all RAG configs:', allRAGs.length);
    
    // ========================================================================
    // STT Config Tests
    // ========================================================================
    
    console.log('\n[Test 14] Create STT Config');
    const sttId = await modules.createSTTConfig({
      name: 'Test STT',
      main_stream_time_millis: 1000,
      transition_stream_time_millis: 500,
      max_buffer_count: 10,
      transcription_provider: 'openai',
      transcription_provider_config_id: 1,
      vad_provider: 'openai',
      vad_provider_config_id: 1,
    });
    console.log('✅ STT config created with ID:', sttId);
    
    console.log('\n[Test 15] Get STT Config');
    const stt = await modules.getSTTConfig(sttId);
    if (stt) {
      console.log('✅ STT config retrieved:', stt.name);
      console.log('   Main stream time:', stt.main_stream_time_millis);
      console.log('   Transcription provider:', stt.transcription_provider);
      console.log('   VAD provider:', stt.vad_provider);
    }
    
    console.log('\n[Test 16] Update STT Config');
    if (stt) {
      await modules.updateSTTConfig({
        ...stt,
        max_buffer_count: 15,
      });
      console.log('✅ STT config updated');
    }
    
    // ========================================================================
    // TTS Config Tests
    // ========================================================================
    
    console.log('\n[Test 17] Create TTS Config');
    const ttsId = await modules.createTTSConfig({
      name: 'Test TTS',
      provider: 'openai',
      provider_config_id: 1,
      output_type: 'audio/mp3',
      words_to_replace: '{"um": "umm"}',
      vocalize_nonverbal: 1,
    });
    console.log('✅ TTS config created with ID:', ttsId);
    
    console.log('\n[Test 18] Get TTS Config');
    const tts = await modules.getTTSConfig(ttsId);
    if (tts) {
      console.log('✅ TTS config retrieved:', tts.name);
      console.log('   Output type:', tts.output_type);
      console.log('   Vocalize nonverbal:', tts.vocalize_nonverbal);
    }
    
    console.log('\n[Test 19] Get All TTS Configs');
    const allTTS = await modules.getAllTTSConfigs();
    console.log('✅ Retrieved all TTS configs:', allTTS.length);
    
    // ========================================================================
    // Cleanup Tests
    // ========================================================================
    
    console.log('\n[Test 20] Delete Module Configs');
    await modules.deleteBackendConfig(backendId);
    console.log('✅ Backend config deleted');
    
    await modules.deleteCognitionConfig(cognitionId);
    console.log('✅ Cognition config deleted');
    
    await modules.deleteMovementConfig(movementId);
    console.log('✅ Movement config deleted');
    
    await modules.deleteRAGConfig(ragId);
    console.log('✅ RAG config deleted');
    
    await modules.deleteSTTConfig(sttId);
    console.log('✅ STT config deleted');
    
    await modules.deleteTTSConfig(ttsId);
    console.log('✅ TTS config deleted');
    
    // ========================================================================
    // Error Handling Tests
    // ========================================================================
    
    console.log('\n[Test 21] Get Non-existent Config (Error Handling)');
    const nonExistent = await modules.getBackendConfig(99999);
    if (nonExistent === null) {
      console.log('✅ Returns null for non-existent config');
    }
    
    console.log('\n[Test 22] Update Non-existent Config (Error Handling)');
    try {
      await modules.updateBackendConfig({
        id: 99999,
        name: 'Non-existent',
        provider: 'openai',
        provider_config_id: 1,
      });
      console.log('❌ Should have thrown error');
    } catch (error) {
      console.log('✅ Correctly throws error for non-existent config');
      console.log('   Error:', (error as Error).message);
    }
    
    console.log('\n[Test 23] Delete Non-existent Config (Error Handling)');
    try {
      await modules.deleteBackendConfig(99999);
      console.log('❌ Should have thrown error');
    } catch (error) {
      console.log('✅ Correctly throws error for non-existent config');
      console.log('   Error:', (error as Error).message);
    }
    
    console.log('\n=== All Module Tests Complete ✅ ===\n');
    return true;
  } catch (error) {
    console.error('\n❌ Test failed with error:', error);
    return false;
  }
}

// Export for use in larger test suites
export default runModuleTests;
