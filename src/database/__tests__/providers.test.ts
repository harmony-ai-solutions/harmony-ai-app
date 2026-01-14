/**
 * Provider Repository Tests
 * 
 * Manual test script for all provider configuration CRUD operations
 * Tests: OpenAI, OpenRouter, OpenAI Compatible, HarmonySpeech, ElevenLabs,
 *        Kindroid, Kajiwoto, CharacterAI, LocalAI, Mistral, Ollama
 */

import {initializeDatabase} from '../connection';
import * as providers from '../repositories/providers';

/**
 * Run all provider repository tests
 */
export async function runProviderTests() {
  console.log('\n=== Provider Repository Tests ===\n');
  
  try {
    // Initialize database
    console.log('[Test Setup] Initializing database...');
    await initializeDatabase();
    console.log('✅ Database initialized\n');
    
    // ========================================================================
    // OpenAI Provider Config Tests
    // ========================================================================
    
    console.log('[Test 1] Create OpenAI Provider Config');
    const openaiId = await providers.createOpenAIProviderConfig({
      name: 'Test OpenAI',
      api_key: 'test-key-123',
      model: 'gpt-4',
      max_tokens: 2000,
      temperature: 0.7,
      top_p: 0.9,
      n: 1,
      stop_tokens: '["\\n\\n"]',
      embedding_model: 'text-embedding-ada-002',
      voice: 'alloy',
      speed: 1.0,
      format: 'mp3',
    });
    console.log('✅ OpenAI config created with ID:', openaiId);
    
    console.log('\n[Test 2] Get OpenAI Provider Config');
    const openai = await providers.getOpenAIProviderConfig(openaiId);
    if (openai) {
      console.log('✅ OpenAI config retrieved:', openai.name);
      console.log('   Model:', openai.model);
      console.log('   Temperature:', openai.temperature);
    }
    
    console.log('\n[Test 3] Get OpenAI Config By Name');
    const openaiByName = await providers.getOpenAIProviderConfigByName('Test OpenAI');
    if (openaiByName) {
      console.log('✅ OpenAI config retrieved by name');
    }
    
    console.log('\n[Test 4] Get All OpenAI Configs');
    const allOpenAI = await providers.getAllOpenAIProviderConfigs();
    console.log('✅ Retrieved all OpenAI configs:', allOpenAI.length);
    
    console.log('\n[Test 5] Update OpenAI Config');
    if (openai) {
      await providers.updateOpenAIProviderConfig({
        ...openai,
        model: 'gpt-4-turbo',
        temperature: 0.8,
      });
      console.log('✅ OpenAI config updated');
    }
    
    // ========================================================================
    // OpenRouter Provider Config Tests
    // ========================================================================
    
    console.log('\n[Test 6] Create OpenRouter Provider Config');
    const openrouterId = await providers.createOpenRouterProviderConfig({
      name: 'Test OpenRouter',
      api_key: 'test-key-456',
      model: 'anthropic/claude-2',
      max_tokens: 4000,
      temperature: 0.7,
      top_p: 0.9,
      n: 1,
      stop_tokens: null,
    });
    console.log('✅ OpenRouter config created with ID:', openrouterId);
    
    console.log('\n[Test 7] Get OpenRouter Provider Config');
    const openrouter = await providers.getOpenRouterProviderConfig(openrouterId);
    if (openrouter) {
      console.log('✅ OpenRouter config retrieved:', openrouter.name);
      console.log('   Model:', openrouter.model);
    }
    
    // ========================================================================
    // OpenAI Compatible Provider Config Tests
    // ========================================================================
    
    console.log('\n[Test 8] Create OpenAI Compatible Provider Config');
    const compatibleId = await providers.createOpenAICompatibleProviderConfig({
      name: 'Test Compatible',
      base_url: 'http://localhost:8000',
      api_key: 'test-key-789',
      model: 'llama-2-70b',
      max_tokens: 2000,
      temperature: 0.7,
      top_p: 0.95,
      n: 1,
      stop_tokens: null,
      embedding_model: null,
    });
    console.log('✅ OpenAI Compatible config created with ID:', compatibleId);
    
    console.log('\n[Test 9] Get OpenAI Compatible Config');
    const compatible = await providers.getOpenAICompatibleProviderConfig(compatibleId);
    if (compatible) {
      console.log('✅ OpenAI Compatible config retrieved:', compatible.name);
      console.log('   Base URL:', compatible.base_url);
    }
    
    // ========================================================================
    // HarmonySpeech Provider Config Tests
    // ========================================================================
    
    console.log('\n[Test 10] Create HarmonySpeech Provider Config');
    const harmonyspeechId = await providers.createHarmonySpeechProviderConfig({
      name: 'Test HarmonySpeech',
      endpoint: 'http://localhost:5000',
      model: 'harmony-tts-v1',
      voice_config_file: 'voices/default.json',
      format: 'wav',
      sample_rate: 22050,
      stream: 1,
    });
    console.log('✅ HarmonySpeech config created with ID:', harmonyspeechId);
    
    console.log('\n[Test 11] Get HarmonySpeech Config');
    const harmonyspeech = await providers.getHarmonySpeechProviderConfig(harmonyspeechId);
    if (harmonyspeech) {
      console.log('✅ HarmonySpeech config retrieved:', harmonyspeech.name);
      console.log('   Sample rate:', harmonyspeech.sample_rate);
      console.log('   Stream:', harmonyspeech.stream);
    }
    
    // ========================================================================
    // ElevenLabs Provider Config Tests
    // ========================================================================
    
    console.log('\n[Test 12] Create ElevenLabs Provider Config');
    const elevenlabsId = await providers.createElevenLabsProviderConfig({
      name: 'Test ElevenLabs',
      api_key: 'test-key-elevenlabs',
      voice_id: 'voice-123',
      model_id: 'eleven_multilingual_v2',
      stability: 0.5,
      similarity_boost: 0.75,
      style: 0.0,
      speaker_boost: 1,
    });
    console.log('✅ ElevenLabs config created with ID:', elevenlabsId);
    
    console.log('\n[Test 13] Get ElevenLabs Config');
    const elevenlabs = await providers.getElevenLabsProviderConfig(elevenlabsId);
    if (elevenlabs) {
      console.log('✅ ElevenLabs config retrieved:', elevenlabs.name);
      console.log('   Voice ID:', elevenlabs.voice_id);
      console.log('   Stability:', elevenlabs.stability);
    }
    
    // ========================================================================
    // Kindroid Provider Config Tests
    // ========================================================================
    
    console.log('\n[Test 14] Create Kindroid Provider Config');
    const kindroidId = await providers.createKindroidProviderConfig({
      name: 'Test Kindroid',
      api_key: 'test-key-kindroid',
      kindroid_id: 'kindroid-123',
    });
    console.log('✅ Kindroid config created with ID:', kindroidId);
    
    console.log('\n[Test 15] Get Kindroid Config');
    const kindroid = await providers.getKindroidProviderConfig(kindroidId);
    if (kindroid) {
      console.log('✅ Kindroid config retrieved:', kindroid.name);
      console.log('   Kindroid ID:', kindroid.kindroid_id);
    }
    
    console.log('\n[Test 16] Get All Kindroid Configs');
    const allKindroid = await providers.getAllKindroidProviderConfigs();
    console.log('✅ Retrieved all Kindroid configs:', allKindroid.length);
    
    // ========================================================================
    // Kajiwoto Provider Config Tests
    // ========================================================================
    
    console.log('\n[Test 17] Create Kajiwoto Provider Config');
    const kajiwotoId = await providers.createKajiwotoProviderConfig({
      name: 'Test Kajiwoto',
      username: 'testuser',
      password: 'testpass',
      room_url: 'https://kajiwoto.ai/room/123',
    });
    console.log('✅ Kajiwoto config created with ID:', kajiwotoId);
    
    console.log('\n[Test 18] Get Kajiwoto Config');
    const kajiwoto = await providers.getKajiwotoProviderConfig(kajiwotoId);
    if (kajiwoto) {
      console.log('✅ Kajiwoto config retrieved:', kajiwoto.name);
      console.log('   Username:', kajiwoto.username);
    }
    
    // ========================================================================
    // CharacterAI Provider Config Tests
    // ========================================================================
    
    console.log('\n[Test 19] Create CharacterAI Provider Config');
    const characteraiId = await providers.createCharacterAIProviderConfig({
      name: 'Test CharacterAI',
      api_token: 'test-token-cai',
      chatroom_url: 'https://character.ai/chat/123',
    });
    console.log('✅ CharacterAI config created with ID:', characteraiId);
    
    console.log('\n[Test 20] Get CharacterAI Config');
    const characterai = await providers.getCharacterAIProviderConfig(characteraiId);
    if (characterai) {
      console.log('✅ CharacterAI config retrieved:', characterai.name);
      console.log('   Chatroom URL:', characterai.chatroom_url);
    }
    
    // ========================================================================
    // LocalAI Provider Config Tests
    // ========================================================================
    
    console.log('\n[Test 21] Create LocalAI Provider Config');
    const localaiId = await providers.createLocalAIProviderConfig({
      name: 'Test LocalAI',
      embedding_model: 'all-minilm-l6-v2',
    });
    console.log('✅ LocalAI config created with ID:', localaiId);
    
    console.log('\n[Test 22] Get LocalAI Config');
    const localai = await providers.getLocalAIProviderConfig(localaiId);
    if (localai) {
      console.log('✅ LocalAI config retrieved:', localai.name);
      console.log('   Embedding model:', localai.embedding_model);
    }
    
    // ========================================================================
    // Mistral Provider Config Tests
    // ========================================================================
    
    console.log('\n[Test 23] Create Mistral Provider Config');
    const mistralId = await providers.createMistralProviderConfig({
      name: 'Test Mistral',
      api_key: 'test-key-mistral',
    });
    console.log('✅ Mistral config created with ID:', mistralId);
    
    console.log('\n[Test 24] Get Mistral Config');
    const mistral = await providers.getMistralProviderConfig(mistralId);
    if (mistral) {
      console.log('✅ Mistral config retrieved:', mistral.name);
    }
    
    console.log('\n[Test 25] Get All Mistral Configs');
    const allMistral = await providers.getAllMistralProviderConfigs();
    console.log('✅ Retrieved all Mistral configs:', allMistral.length);
    
    // ========================================================================
    // Ollama Provider Config Tests
    // ========================================================================
    
    console.log('\n[Test 26] Create Ollama Provider Config');
    const ollamaId = await providers.createOllamaProviderConfig({
      name: 'Test Ollama',
      base_url: 'http://localhost:11434',
      embedding_model: 'nomic-embed-text',
    });
    console.log('✅ Ollama config created with ID:', ollamaId);
    
    console.log('\n[Test 27] Get Ollama Config');
    const ollama = await providers.getOllamaProviderConfig(ollamaId);
    if (ollama) {
      console.log('✅ Ollama config retrieved:', ollama.name);
      console.log('   Base URL:', ollama.base_url);
      console.log('   Embedding model:', ollama.embedding_model);
    }
    
    console.log('\n[Test 28] Update Ollama Config');
    if (ollama) {
      await providers.updateOllamaProviderConfig({
        ...ollama,
        embedding_model: 'llama2',
      });
      console.log('✅ Ollama config updated');
    }
    
    // ========================================================================
    // Cleanup Tests
    // ========================================================================
    
    console.log('\n[Test 29] Delete Provider Configs');
    await providers.deleteOpenAIProviderConfig(openaiId);
    console.log('✅ OpenAI config deleted');
    
    await providers.deleteOpenRouterProviderConfig(openrouterId);
    console.log('✅ OpenRouter config deleted');
    
    await providers.deleteOpenAICompatibleProviderConfig(compatibleId);
    console.log('✅ OpenAI Compatible config deleted');
    
    await providers.deleteHarmonySpeechProviderConfig(harmonyspeechId);
    console.log('✅ HarmonySpeech config deleted');
    
    await providers.deleteElevenLabsProviderConfig(elevenlabsId);
    console.log('✅ ElevenLabs config deleted');
    
    await providers.deleteKindroidProviderConfig(kindroidId);
    console.log('✅ Kindroid config deleted');
    
    await providers.deleteKajiwotoProviderConfig(kajiwotoId);
    console.log('✅ Kajiwoto config deleted');
    
    await providers.deleteCharacterAIProviderConfig(characteraiId);
    console.log('✅ CharacterAI config deleted');
    
    await providers.deleteLocalAIProviderConfig(localaiId);
    console.log('✅ LocalAI config deleted');
    
    await providers.deleteMistralProviderConfig(mistralId);
    console.log('✅ Mistral config deleted');
    
    await providers.deleteOllamaProviderConfig(ollamaId);
    console.log('✅ Ollama config deleted');
    
    // ========================================================================
    // Error Handling Tests
    // ========================================================================
    
    console.log('\n[Test 30] Get Non-existent Config (Error Handling)');
    const nonExistent = await providers.getOpenAIProviderConfig(99999);
    if (nonExistent === null) {
      console.log('✅ Returns null for non-existent config');
    }
    
    console.log('\n[Test 31] Update Non-existent Config (Error Handling)');
    try {
      await providers.updateOpenAIProviderConfig({
        id: 99999,
        name: 'Non-existent',
        api_key: 'fake',
        model: 'fake',
        max_tokens: 100,
        temperature: 0.5,
        top_p: 0.9,
        n: 1,
        stop_tokens: null,
        embedding_model: null,
        voice: null,
        speed: null,
        format: null,
      });
      console.log('❌ Should have thrown error');
    } catch (error) {
      console.log('✅ Correctly throws error for non-existent config');
      console.log('   Error:', (error as Error).message);
    }
    
    console.log('\n[Test 32] Delete Non-existent Config (Error Handling)');
    try {
      await providers.deleteOpenAIProviderConfig(99999);
      console.log('❌ Should have thrown error');
    } catch (error) {
      console.log('✅ Correctly throws error for non-existent config');
      console.log('   Error:', (error as Error).message);
    }
    
    console.log('\n=== All Provider Tests Complete ✅ ===\n');
    return true;
  } catch (error) {
    console.error('\n❌ Test failed with error:', error);
    return false;
  }
}

// Export for use in larger test suites
export default runProviderTests;
