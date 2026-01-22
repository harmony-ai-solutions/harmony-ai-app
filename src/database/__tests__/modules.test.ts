/**
 * Module Repository Tests
 */

import {initializeDatabase, clearDatabaseData} from '../connection';
import * as modules from '../repositories/modules';
import * as providers from '../repositories/providers';
import {runTestWithCleanup, TestResult} from './test-utils';

/**
 * Run all module repository tests
 */
export async function runModuleTests(): Promise<TestResult[]> {
  const results: TestResult[] = [];

  try {
    console.log('[Test Setup] Initializing database...');
    await initializeDatabase(true);
    await clearDatabaseData(true);

    // Test 1: Backend Config
    results.push(
      await runTestWithCleanup('Backend Config CRUD', async () => {
        // Create provider config first
        const providerId = await providers.createOpenAIProviderConfig({
          name: 'Test Provider',
          api_key: 'test-key',
          model: null,
          max_tokens: null,
          temperature: null,
          top_p: null,
          n: null,
          stop_tokens: null,
          embedding_model: null,
          voice: null,
          speed: null,
          format: null,
        });
        
        console.log('[DEBUG] Provider ID returned:', providerId, 'Type:', typeof providerId);
        
        if (!providerId || typeof providerId !== 'number') {
          throw new Error(`Provider creation failed. Got ID: ${providerId} (type: ${typeof providerId})`);
        }
        
        const id = await modules.createBackendConfig({
          name: 'Test Backend',
          provider: 'openai',
          provider_config_id: providerId,
        });
        const retrieved = await modules.getBackendConfig(id);
        if (!retrieved || retrieved.name !== 'Test Backend') {
          throw new Error('Backend config mismatch');
        }
        await modules.updateBackendConfig({
          id,
          name: 'Updated Backend',
          provider: 'openai',
          provider_config_id: providerId,
        });
        await modules.deleteBackendConfig(id);
        await providers.deleteOpenAIProviderConfig(providerId);
      })
    );

    // Test 2: Movement Config
    results.push(
      await runTestWithCleanup('Movement Config CRUD', async () => {
        // Create provider config first
        const providerId = await providers.createOpenRouterProviderConfig({
          name: 'Test Provider Movement',
          api_key: 'test-key',
          model: null,
          max_tokens: null,
          temperature: null,
          top_p: null,
          n: null,
          stop_tokens: null,
        });
        
        const id = await modules.createMovementConfig({
          name: 'Test Movement',
          provider: 'openrouter',
          provider_config_id: providerId,
          startup_sync_timeout: 5000,
          execution_threshold: 0.5,
        });
        const retrieved = await modules.getMovementConfig(id);
        if (!retrieved) throw new Error('Failed to retrieve');
        await modules.deleteMovementConfig(id);
        await providers.deleteOpenRouterProviderConfig(providerId);
      })
    );

    // Test 3: STT Config
    results.push(
      await runTestWithCleanup('STT Config CRUD', async () => {
        // Create provider configs first (STT needs two)
        const transcriptionProviderId = await providers.createOpenAIProviderConfig({
          name: 'Test Provider STT Transcription',
          api_key: 'test-key',
          model: null,
          max_tokens: null,
          temperature: null,
          top_p: null,
          n: null,
          stop_tokens: null,
          embedding_model: null,
          voice: null,
          speed: null,
          format: null,
        });
        
        const vadProviderId = await providers.createOpenAIProviderConfig({
          name: 'Test Provider STT VAD',
          api_key: 'test-key',
          model: null,
          max_tokens: null,
          temperature: null,
          top_p: null,
          n: null,
          stop_tokens: null,
          embedding_model: null,
          voice: null,
          speed: null,
          format: null,
        });
        
        const id = await modules.createSTTConfig({
          name: 'Test STT',
          main_stream_time_millis: 100,
          transition_stream_time_millis: 200,
          max_buffer_count: 5,
          transcription_provider: 'openai',
          transcription_provider_config_id: transcriptionProviderId,
          vad_provider: 'openai',
          vad_provider_config_id: vadProviderId,
        });
        const retrieved = await modules.getSTTConfig(id);
        if (!retrieved) throw new Error('Failed to retrieve');
        await modules.deleteSTTConfig(id);
        await providers.deleteOpenAIProviderConfig(transcriptionProviderId);
        await providers.deleteOpenAIProviderConfig(vadProviderId);
      })
    );

    // Test 4: Cognition Config
    results.push(
      await runTestWithCleanup('Cognition Config CRUD', async () => {
        // Create provider config first
        const providerId = await providers.createOpenAIProviderConfig({
          name: 'Test Provider Cognition',
          api_key: 'test-key',
          model: null,
          max_tokens: null,
          temperature: null,
          top_p: null,
          n: null,
          stop_tokens: null,
          embedding_model: null,
          voice: null,
          speed: null,
          format: null,
        });
        
        const id = await modules.createCognitionConfig({
          name: 'Test Cognition',
          provider: 'openai',
          provider_config_id: providerId,
          max_cognition_events: 10,
          generate_expressions: 1,
        });
        const retrieved = await modules.getCognitionConfig(id);
        if (!retrieved) throw new Error('Failed to retrieve');
        await modules.deleteCognitionConfig(id);
        await providers.deleteOpenAIProviderConfig(providerId);
      })
    );

    // Test 5: RAG Config
    results.push(
      await runTestWithCleanup('RAG Config CRUD', async () => {
        // Create provider config first
        const providerId = await providers.createOllamaProviderConfig({
          name: 'Test Provider RAG',
          base_url: 'http://localhost:11434',
          embedding_model: null,
        });
        
        const id = await modules.createRAGConfig({
          name: 'Test RAG',
          provider: 'ollama',
          provider_config_id: providerId,
          embedding_concurrency: 2,
        });
        const retrieved = await modules.getRAGConfig(id);
        if (!retrieved) throw new Error('Failed to retrieve');
        await modules.deleteRAGConfig(id);
        await providers.deleteOllamaProviderConfig(providerId);
      })
    );

    // Test 6: TTS Config
    results.push(
      await runTestWithCleanup('TTS Config CRUD', async () => {
        // Create provider config first
        const providerId = await providers.createOpenAIProviderConfig({
          name: 'Test Provider TTS',
          api_key: 'test-key',
          model: null,
          max_tokens: null,
          temperature: null,
          top_p: null,
          n: null,
          stop_tokens: null,
          embedding_model: null,
          voice: null,
          speed: null,
          format: null,
        });
        
        const id = await modules.createTTSConfig({
          name: 'Test TTS',
          provider: 'openai',
          provider_config_id: providerId,
          output_type: 'mp3',
          words_to_replace: '{}',
          vocalize_nonverbal: 1,
        });
        const retrieved = await modules.getTTSConfig(id);
        if (!retrieved) throw new Error('Failed to retrieve');
        await modules.deleteTTSConfig(id);
        await providers.deleteOpenAIProviderConfig(providerId);
      })
    );

    return results;
  } catch (error) {
    console.error('Critical failure in Module tests:', error);
    results.push({
      name: 'Critical Failure',
      passed: false,
      error: (error as Error).message,
    });
    return results;
  }
}

export default runModuleTests;
