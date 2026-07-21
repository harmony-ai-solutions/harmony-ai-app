/**
 * Module Configuration Repository Tests
 *
 * Ported from the deleted hand-rolled test file. 7 test cases.
 * Each test creates a provider config first (because module configs FK-reference
 * provider configs), then exercises the module config CRUD, then cleans up.
 *
 * Uses useFreshDatabase() fixture for per-test DB isolation.
 */

import {useFreshDatabase} from '../repositoryFixtures';
import {
  createBackendConfig,
  getBackendConfig,
  updateBackendConfig,
  deleteBackendConfig,
} from '../../repositories/modules';
import {
  createMovementConfig,
  getMovementConfig,
  deleteMovementConfig,
} from '../../repositories/modules';
import {
  createSTTConfig,
  getSTTConfig,
  deleteSTTConfig,
} from '../../repositories/modules';
import {
  createCognitionConfig,
  getCognitionConfig,
  deleteCognitionConfig,
} from '../../repositories/modules';
import {
  createRAGConfig,
  getRAGConfig,
  deleteRAGConfig,
} from '../../repositories/modules';
import {
  createTTSConfig,
  getTTSConfig,
  deleteTTSConfig,
} from '../../repositories/modules';
import {
  createVisionConfig,
  getVisionConfig,
  updateVisionConfig,
  deleteVisionConfig,
} from '../../repositories/modules';
import {
  createOpenAIProviderConfig,
  deleteOpenAIProviderConfig,
} from '../../repositories/providers/OpenAIProviderConfigRepository';
import {
  createOpenRouterProviderConfig,
  deleteOpenRouterProviderConfig,
} from '../../repositories/providers/OpenRouterProviderConfigRepository';
import {
  createOllamaProviderConfig,
  deleteOllamaProviderConfig,
} from '../../repositories/providers/OllamaProviderConfigRepository';

describe('modules repository', () => {
  const {getDb} = useFreshDatabase();

  describe('Backend Config CRUD', () => {
    it('Backend Config CRUD', async () => {
      // Create OpenAI provider first
      const providerId = await createOpenAIProviderConfig({
        name: 'Test OpenAI',
        api_key: 'sk-test',
        model: 'gpt-4',
        max_tokens: 0,
        temperature: 0,
        top_p: 0,
        n: 0,
        stop_tokens: '',
        voice: '',
        speed: 0,
        format: '',
        frequency_penalty: 0,
        presence_penalty: 0,
        max_completion_tokens: 0,
        seed: 0,
        response_format: '',
        reasoning_effort: '',
        top_k: 0,
        top_a: 0,
        min_p: 0,
        repetition_penalty: 0,
        sampling_preset_name: '',
        extra_params: '{}',
      });

      const backendId = await createBackendConfig({
        name: 'Test Backend',
        provider: 'openai',
        provider_config_id: providerId,
      });
      expect(backendId).toBeDefined();

      const retrieved = await getBackendConfig(backendId);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.name).toBe('Test Backend');

      await updateBackendConfig({
        id: backendId,
        name: 'Test Backend',
        provider: 'openai',
        provider_config_id: providerId,
        deleted_at: null,
      });

      await deleteBackendConfig(backendId, true);
      const afterDelete = await getBackendConfig(backendId, true);
      expect(afterDelete).toBeNull();

      await deleteOpenAIProviderConfig(providerId, true);
    });
  });

  describe('Movement Config CRUD', () => {
    it('Movement Config CRUD', async () => {
      const providerId = await createOpenRouterProviderConfig({
        name: 'Test OpenRouter',
        api_key: 'sk-test',
        model: 'meta-llama/llama-3-70b',
        max_tokens: 0,
        temperature: 0,
        top_p: 0,
        n: 0,
        stop_tokens: '',
        frequency_penalty: 0,
        presence_penalty: 0,
        max_completion_tokens: 0,
        seed: 0,
        response_format: '',
        top_k: 0,
        top_a: 0,
        min_p: 0,
        repetition_penalty: 0,
        sampling_preset_name: '',
        extra_params: '{}',
        voice: '',
        speed: 1.0,
        format: 'mp3',
        image_aspect_ratio: '',
        image_size: '',
      });

      const movId = await createMovementConfig({
        name: 'Test Movement',
        provider: 'openrouter',
        provider_config_id: providerId,
        startup_sync_timeout: 0,
        execution_threshold: 0,
      });
      expect(movId).toBeDefined();

      const retrieved = await getMovementConfig(movId);
      expect(retrieved).not.toBeNull();

      await deleteMovementConfig(movId, true);
      const afterDelete = await getMovementConfig(movId, true);
      expect(afterDelete).toBeNull();

      await deleteOpenRouterProviderConfig(providerId, true);
    });
  });

  describe('STT Config CRUD', () => {
    it('STT Config CRUD', async () => {
      const txProviderId = await createOpenAIProviderConfig({
        name: 'STT Transcription',
        api_key: 'sk-test',
        model: 'whisper-1',
        max_tokens: 0,
        temperature: 0,
        top_p: 0,
        n: 0,
        stop_tokens: '',
        voice: '',
        speed: 0,
        format: '',
        frequency_penalty: 0,
        presence_penalty: 0,
        max_completion_tokens: 0,
        seed: 0,
        response_format: '',
        reasoning_effort: '',
        top_k: 0,
        top_a: 0,
        min_p: 0,
        repetition_penalty: 0,
        sampling_preset_name: '',
        extra_params: '{}',
      });

      const vadProviderId = await createOpenAIProviderConfig({
        name: 'STT VAD',
        api_key: 'sk-test',
        model: 'whisper-1',
        max_tokens: 0,
        temperature: 0,
        top_p: 0,
        n: 0,
        stop_tokens: '',
        voice: '',
        speed: 0,
        format: '',
        frequency_penalty: 0,
        presence_penalty: 0,
        max_completion_tokens: 0,
        seed: 0,
        response_format: '',
        reasoning_effort: '',
        top_k: 0,
        top_a: 0,
        min_p: 0,
        repetition_penalty: 0,
        sampling_preset_name: '',
        extra_params: '{}',
      });

      const sttId = await createSTTConfig({
        name: 'Test STT',
        main_stream_time_millis: 0,
        transition_stream_time_millis: 0,
        max_buffer_count: 0,
        transcription_provider: 'openai',
        transcription_provider_config_id: txProviderId,
        vad_provider: 'openai',
        vad_provider_config_id: vadProviderId,
      });
      expect(sttId).toBeDefined();

      const retrieved = await getSTTConfig(sttId);
      expect(retrieved).not.toBeNull();

      await deleteSTTConfig(sttId, true);
      const afterDelete = await getSTTConfig(sttId, true);
      expect(afterDelete).toBeNull();

      await deleteOpenAIProviderConfig(txProviderId, true);
      await deleteOpenAIProviderConfig(vadProviderId, true);
    });
  });

  describe('Cognition Config CRUD', () => {
    it('Cognition Config CRUD', async () => {
      const providerId = await createOpenAIProviderConfig({
        name: 'Cognition Provider',
        api_key: 'sk-test',
        model: 'gpt-4',
        max_tokens: 0,
        temperature: 0,
        top_p: 0,
        n: 0,
        stop_tokens: '',
        voice: '',
        speed: 0,
        format: '',
        frequency_penalty: 0,
        presence_penalty: 0,
        max_completion_tokens: 0,
        seed: 0,
        response_format: '',
        reasoning_effort: '',
        top_k: 0,
        top_a: 0,
        min_p: 0,
        repetition_penalty: 0,
        sampling_preset_name: '',
        extra_params: '{}',
      });

      const cogId = await createCognitionConfig({
        name: 'Test Cognition',
        provider: 'openai',
        provider_config_id: providerId,
        max_cognition_events: 20,
        generate_expressions: 1,
      });
      expect(cogId).toBeDefined();

      const retrieved = await getCognitionConfig(cogId);
      expect(retrieved).not.toBeNull();

      await deleteCognitionConfig(cogId, true);
      const afterDelete = await getCognitionConfig(cogId, true);
      expect(afterDelete).toBeNull();

      await deleteOpenAIProviderConfig(providerId, true);
    });
  });

  describe('RAG Config CRUD', () => {
    it('RAG Config CRUD', async () => {
      const providerId = await createOllamaProviderConfig({
        name: 'RAG Ollama',
        base_url: 'http://ollama',
        model: null,
      });

      const ragId = await createRAGConfig({
        name: 'Test RAG',
        provider: 'ollama',
        provider_config_id: providerId,
        embedding_concurrency: 0,
      });
      expect(ragId).toBeDefined();

      const retrieved = await getRAGConfig(ragId);
      expect(retrieved).not.toBeNull();

      await deleteRAGConfig(ragId, true);
      const afterDelete = await getRAGConfig(ragId, true);
      expect(afterDelete).toBeNull();

      await deleteOllamaProviderConfig(providerId, true);
    });
  });

  describe('TTS Config CRUD', () => {
    it('TTS Config CRUD', async () => {
      const providerId = await createOpenAIProviderConfig({
        name: 'TTS Provider',
        api_key: 'sk-test',
        model: 'tts-1',
        max_tokens: 0,
        temperature: 0,
        top_p: 0,
        n: 0,
        stop_tokens: '',
        voice: '',
        speed: 0,
        format: '',
        frequency_penalty: 0,
        presence_penalty: 0,
        max_completion_tokens: 0,
        seed: 0,
        response_format: '',
        reasoning_effort: '',
        top_k: 0,
        top_a: 0,
        min_p: 0,
        repetition_penalty: 0,
        sampling_preset_name: '',
        extra_params: '{}',
      });

      const ttsId = await createTTSConfig({
        name: 'Test TTS',
        provider: 'openai',
        provider_config_id: providerId,
        output_type: '',
        words_to_replace: '',
        vocalize_nonverbal: 0,
      });
      expect(ttsId).toBeDefined();

      const retrieved = await getTTSConfig(ttsId);
      expect(retrieved).not.toBeNull();

      await deleteTTSConfig(ttsId, true);
      const afterDelete = await getTTSConfig(ttsId, true);
      expect(afterDelete).toBeNull();

      await deleteOpenAIProviderConfig(providerId, true);
    });
  });

  describe('Vision Config CRUD', () => {
    it('Vision Config CRUD', async () => {
      const providerId = await createOpenAIProviderConfig({
        name: 'Vision Provider',
        api_key: 'sk-test',
        model: 'gpt-4-vision',
        max_tokens: 0,
        temperature: 0,
        top_p: 0,
        n: 0,
        stop_tokens: '',
        voice: '',
        speed: 0,
        format: '',
        frequency_penalty: 0,
        presence_penalty: 0,
        max_completion_tokens: 0,
        seed: 0,
        response_format: '',
        reasoning_effort: '',
        top_k: 0,
        top_a: 0,
        min_p: 0,
        repetition_penalty: 0,
        sampling_preset_name: '',
        extra_params: '{}',
      });

      const visId = await createVisionConfig({
        name: 'Test Vision',
        provider: 'openai',
        provider_config_id: providerId,
        resolution_width: 640,
        resolution_height: 480,
      });
      expect(visId).toBeDefined();

      const retrieved1 = await getVisionConfig(visId);
      expect(retrieved1).not.toBeNull();
      expect(retrieved1!.resolution_width).toBe(640);
      expect(retrieved1!.resolution_height).toBe(480);

      // Update resolution
      await updateVisionConfig({
        id: visId,
        name: 'Test Vision',
        provider: 'openai',
        provider_config_id: providerId,
        resolution_width: 1280,
        resolution_height: 720,
        deleted_at: null,
      });

      const retrieved2 = await getVisionConfig(visId);
      expect(retrieved2!.resolution_width).toBe(1280);
      expect(retrieved2!.resolution_height).toBe(720);

      await deleteVisionConfig(visId, true);
      const afterDelete = await getVisionConfig(visId, true);
      expect(afterDelete).toBeNull();

      await deleteOpenAIProviderConfig(providerId, true);
    });
  });
});
