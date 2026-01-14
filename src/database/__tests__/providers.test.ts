/**
 * Provider Repository Tests
 */

import {initializeDatabase, clearDatabaseData} from '../connection';
import * as providers from '../repositories/providers';
import {runTestWithCleanup, TestResult} from './test-utils';

/**
 * Run all provider repository tests
 */
export async function runProviderTests(): Promise<TestResult[]> {
  const results: TestResult[] = [];

  try {
    console.log('[Test Setup] Initializing database...');
    await initializeDatabase(true);
    await clearDatabaseData(true);

    // Test 1: OpenAI
    results.push(
      await runTestWithCleanup('OpenAI Provider CRUD', async () => {
        const id = await providers.createOpenAIProviderConfig({
          name: 'Test OpenAI',
          api_key: 'test-key',
          model: 'gpt-4',
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
        const retrieved = await providers.getOpenAIProviderConfig(id);
        if (!retrieved || retrieved.name !== 'Test OpenAI') throw new Error('Mismatch');
        await providers.deleteOpenAIProviderConfig(id);
      })
    );

    // Test 2: OpenRouter
    results.push(
      await runTestWithCleanup('OpenRouter Provider CRUD', async () => {
        const id = await providers.createOpenRouterProviderConfig({
          name: 'Test OpenRouter',
          api_key: 'test-key',
          model: 'meta-llama/llama-3-70b',
          max_tokens: null,
          temperature: null,
          top_p: null,
          n: null,
          stop_tokens: null,
        });
        const retrieved = await providers.getOpenRouterProviderConfig(id);
        if (!retrieved) throw new Error('Failed to retrieve');
        await providers.deleteOpenRouterProviderConfig(id);
      })
    );

    // Test 3: OpenAI Compatible
    results.push(
      await runTestWithCleanup('OpenAI Compatible Provider CRUD', async () => {
        const id = await providers.createOpenAICompatibleProviderConfig({
          name: 'Test Compatible',
          base_url: 'http://localhost:8080',
          api_key: 'test-key',
          model: 'local-model',
          max_tokens: null,
          temperature: null,
          top_p: null,
          n: null,
          stop_tokens: null,
          embedding_model: null,
        });
        const retrieved = await providers.getOpenAICompatibleProviderConfig(id);
        if (!retrieved) throw new Error('Failed to retrieve');
        await providers.deleteOpenAICompatibleProviderConfig(id);
      })
    );

    // Test 4: Harmony Speech
    results.push(
      await runTestWithCleanup('Harmony Speech Provider CRUD', async () => {
        const id = await providers.createHarmonySpeechProviderConfig({
          name: 'Test Harmony',
          endpoint: 'http://localhost:5000',
          model: 'harmony-v1',
          voice_config_file: null,
          format: null,
          sample_rate: null,
          stream: null,
        });
        const retrieved = await providers.getHarmonySpeechProviderConfig(id);
        if (!retrieved) throw new Error('Failed to retrieve');
        await providers.deleteHarmonySpeechProviderConfig(id);
      })
    );

    // Test 5: ElevenLabs
    results.push(
      await runTestWithCleanup('ElevenLabs Provider CRUD', async () => {
        const id = await providers.createElevenLabsProviderConfig({
          name: 'Test ElevenLabs',
          api_key: 'test-key',
          voice_id: 'test-voice',
          model_id: null,
          stability: null,
          similarity_boost: null,
          style: null,
          speaker_boost: null,
        });
        const retrieved = await providers.getElevenLabsProviderConfig(id);
        if (!retrieved) throw new Error('Failed to retrieve');
        await providers.deleteElevenLabsProviderConfig(id);
      })
    );

    // Test 6: Kindroid
    results.push(
      await runTestWithCleanup('Kindroid Provider CRUD', async () => {
        const id = await providers.createKindroidProviderConfig({
          name: 'Test Kindroid',
          api_key: 'test-key',
          kindroid_id: 'test-id',
        });
        const retrieved = await providers.getKindroidProviderConfig(id);
        if (!retrieved) throw new Error('Failed to retrieve');
        await providers.deleteKindroidProviderConfig(id);
      })
    );

    // Test 7: Kajiwoto
    results.push(
      await runTestWithCleanup('Kajiwoto Provider CRUD', async () => {
        const id = await providers.createKajiwotoProviderConfig({
          name: 'Test Kaji',
          username: 'user',
          password: 'pass',
          room_url: 'http://kaji',
        });
        const retrieved = await providers.getKajiwotoProviderConfig(id);
        if (!retrieved) throw new Error('Failed to retrieve');
        await providers.deleteKajiwotoProviderConfig(id);
      })
    );

    // Test 8: CharacterAI
    results.push(
      await runTestWithCleanup('CharacterAI Provider CRUD', async () => {
        const id = await providers.createCharacterAIProviderConfig({
          name: 'Test CAI',
          api_token: 'token',
          chatroom_url: 'http://cai',
        });
        const retrieved = await providers.getCharacterAIProviderConfig(id);
        if (!retrieved) throw new Error('Failed to retrieve');
        await providers.deleteCharacterAIProviderConfig(id);
      })
    );

    // Test 9: LocalAI
    results.push(
      await runTestWithCleanup('LocalAI Provider CRUD', async () => {
        const id = await providers.createLocalAIProviderConfig({
          name: 'Test LocalAI',
          embedding_model: 'bert',
        });
        const retrieved = await providers.getLocalAIProviderConfig(id);
        if (!retrieved) throw new Error('Failed to retrieve');
        await providers.deleteLocalAIProviderConfig(id);
      })
    );

    // Test 10: Mistral
    results.push(
      await runTestWithCleanup('Mistral Provider CRUD', async () => {
        const id = await providers.createMistralProviderConfig({
          name: 'Test Mistral',
          api_key: 'key',
        });
        const retrieved = await providers.getMistralProviderConfig(id);
        if (!retrieved) throw new Error('Failed to retrieve');
        await providers.deleteMistralProviderConfig(id);
      })
    );

    // Test 11: Ollama
    results.push(
      await runTestWithCleanup('Ollama Provider CRUD', async () => {
        const id = await providers.createOllamaProviderConfig({
          name: 'Test Ollama',
          base_url: 'http://ollama',
          embedding_model: null,
        });
        const retrieved = await providers.getOllamaProviderConfig(id);
        if (!retrieved) throw new Error('Failed to retrieve');
        await providers.deleteOllamaProviderConfig(id);
      })
    );

    return results;
  } catch (error) {
    console.error('Critical failure in Provider tests:', error);
    results.push({
      name: 'Critical Failure',
      passed: false,
      error: (error as Error).message,
    });
    return results;
  }
}

export default runProviderTests;
