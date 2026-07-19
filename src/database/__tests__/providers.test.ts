/**
 * Provider Repository Tests
 */

import {initializeDatabase, clearDatabaseData} from '../connection';
import * as openai from '../repositories/providers/OpenAIProviderConfigRepository';
import * as openrouter from '../repositories/providers/OpenRouterProviderConfigRepository';
import * as openaicompatible from '../repositories/providers/OpenAICompatibleProviderConfigRepository';
import * as harmonyspeech from '../repositories/providers/HarmonySpeechProviderConfigRepository';
import * as elevenlabs from '../repositories/providers/ElevenLabsProviderConfigRepository';
import * as kindroid from '../repositories/providers/KindroidProviderConfigRepository';
import * as kajiwoto from '../repositories/providers/KajiwotoProviderConfigRepository';
import * as characterai from '../repositories/providers/CharacterAIProviderConfigRepository';
import * as localai from '../repositories/providers/LocalAIProviderConfigRepository';
import * as mistral from '../repositories/providers/MistralProviderConfigRepository';
import * as ollama from '../repositories/providers/OllamaProviderConfigRepository';
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
        const id = await openai.createOpenAIProviderConfig({
          name: 'Test OpenAI',
          api_key: 'test-key',
          model: 'gpt-4',
          max_tokens: null,
          temperature: null,
          top_p: null,
          n: null,
          stop_tokens: null,
          voice: null,
          speed: null,
          format: null,
        });
        const retrieved = await openai.getOpenAIProviderConfig(id);
        if (!retrieved || retrieved.name !== 'Test OpenAI') throw new Error('Mismatch');
        await openai.deleteOpenAIProviderConfig(id);
      })
    );

    // Test 2: OpenRouter
    results.push(
      await runTestWithCleanup('OpenRouter Provider CRUD', async () => {
        const id = await openrouter.createOpenRouterProviderConfig({
          name: 'Test OpenRouter',
          api_key: 'test-key',
          model: 'meta-llama/llama-3-70b',
          max_tokens: null,
          temperature: null,
          top_p: null,
          n: null,
          stop_tokens: null,
        });
        const retrieved = await openrouter.getOpenRouterProviderConfig(id);
        if (!retrieved) throw new Error('Failed to retrieve');
        await openrouter.deleteOpenRouterProviderConfig(id);
      })
    );

    // Test 3: OpenAI Compatible
    results.push(
      await runTestWithCleanup('OpenAI Compatible Provider CRUD', async () => {
        const id = await openaicompatible.createOpenAICompatibleProviderConfig({
          name: 'Test Compatible',
          base_url: 'http://localhost:8080',
          api_key: 'test-key',
          model: 'local-model',
          max_tokens: null,
          temperature: null,
          top_p: null,
          n: null,
          stop_tokens: null,
        });
        const retrieved = await openaicompatible.getOpenAICompatibleProviderConfig(id);
        if (!retrieved) throw new Error('Failed to retrieve');
        await openaicompatible.deleteOpenAICompatibleProviderConfig(id);
      })
    );

    // Test 4: Harmony Speech
    results.push(
      await runTestWithCleanup('Harmony Speech Provider CRUD', async () => {
        const id = await harmonyspeech.createHarmonySpeechProviderConfig({
          name: 'Test Harmony',
          endpoint: 'http://localhost:5000',
          model: 'harmony-v1',
          voice_config_file: null,
          format: null,
          sample_rate: null,
          stream: null,
        });
        const retrieved = await harmonyspeech.getHarmonySpeechProviderConfig(id);
        if (!retrieved) throw new Error('Failed to retrieve');
        await harmonyspeech.deleteHarmonySpeechProviderConfig(id);
      })
    );

    // Test 5: ElevenLabs
    results.push(
      await runTestWithCleanup('ElevenLabs Provider CRUD', async () => {
        const id = await elevenlabs.createElevenLabsProviderConfig({
          name: 'Test ElevenLabs',
          api_key: 'test-key',
          voice_id: 'test-voice',
          model_id: null,
          stability: null,
          similarity_boost: null,
          style: null,
          speaker_boost: null,
        });
        const retrieved = await elevenlabs.getElevenLabsProviderConfig(id);
        if (!retrieved) throw new Error('Failed to retrieve');
        await elevenlabs.deleteElevenLabsProviderConfig(id);
      })
    );

    // Test 6: Kindroid
    results.push(
      await runTestWithCleanup('Kindroid Provider CRUD', async () => {
        const id = await kindroid.createKindroidProviderConfig({
          name: 'Test Kindroid',
          api_key: 'test-key',
          kindroid_id: 'test-id',
        });
        const retrieved = await kindroid.getKindroidProviderConfig(id);
        if (!retrieved) throw new Error('Failed to retrieve');
        await kindroid.deleteKindroidProviderConfig(id);
      })
    );

    // Test 7: Kajiwoto
    results.push(
      await runTestWithCleanup('Kajiwoto Provider CRUD', async () => {
        const id = await kajiwoto.createKajiwotoProviderConfig({
          name: 'Test Kaji',
          username: 'user',
          password: 'pass',
          room_url: 'http://kaji',
        });
        const retrieved = await kajiwoto.getKajiwotoProviderConfig(id);
        if (!retrieved) throw new Error('Failed to retrieve');
        await kajiwoto.deleteKajiwotoProviderConfig(id);
      })
    );

    // Test 8: CharacterAI
    results.push(
      await runTestWithCleanup('CharacterAI Provider CRUD', async () => {
        const id = await characterai.createCharacterAIProviderConfig({
          name: 'Test CAI',
          api_token: 'token',
          chatroom_url: 'http://cai',
        });
        const retrieved = await characterai.getCharacterAIProviderConfig(id);
        if (!retrieved) throw new Error('Failed to retrieve');
        await characterai.deleteCharacterAIProviderConfig(id);
      })
    );

    // Test 9: LocalAI
    results.push(
      await runTestWithCleanup('LocalAI Provider CRUD', async () => {
        const id = await localai.createLocalAIProviderConfig({
          name: 'Test LocalAI',
          model: 'bert',
        });
        const retrieved = await localai.getLocalAIProviderConfig(id);
        if (!retrieved) throw new Error('Failed to retrieve');
        await localai.deleteLocalAIProviderConfig(id);
      })
    );

    // Test 10: Mistral
    results.push(
      await runTestWithCleanup('Mistral Provider CRUD', async () => {
        const id = await mistral.createMistralProviderConfig({
          name: 'Test Mistral',
          api_key: 'key',
        });
        const retrieved = await mistral.getMistralProviderConfig(id);
        if (!retrieved) throw new Error('Failed to retrieve');
        await mistral.deleteMistralProviderConfig(id);
      })
    );

    // Test 11: Ollama
    results.push(
      await runTestWithCleanup('Ollama Provider CRUD', async () => {
        const id = await ollama.createOllamaProviderConfig({
          name: 'Test Ollama',
          base_url: 'http://ollama',
          model: null,
        });
        const retrieved = await ollama.getOllamaProviderConfig(id);
        if (!retrieved) throw new Error('Failed to retrieve');
        await ollama.deleteOllamaProviderConfig(id);
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
