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
import {getChangedRecords} from '../../sync';
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
  updateCognitionConfig,
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

      await deleteBackendConfig(backendId);
      const afterDelete = await getBackendConfig(backendId, true);
      expect(afterDelete).not.toBeNull();
      expect(afterDelete!.deleted_at).not.toBeNull();

      await deleteOpenAIProviderConfig(providerId);
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

      await deleteMovementConfig(movId);
      const afterDelete = await getMovementConfig(movId, true);
      expect(afterDelete).not.toBeNull();
      expect(afterDelete!.deleted_at).not.toBeNull();

      await deleteOpenRouterProviderConfig(providerId);
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

      await deleteSTTConfig(sttId);
      const afterDelete = await getSTTConfig(sttId, true);
      expect(afterDelete).not.toBeNull();
      expect(afterDelete!.deleted_at).not.toBeNull();

      await deleteOpenAIProviderConfig(txProviderId);
      await deleteOpenAIProviderConfig(vadProviderId);
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

      await deleteCognitionConfig(cogId);
      const afterDelete = await getCognitionConfig(cogId, true);
      expect(afterDelete).not.toBeNull();
      expect(afterDelete!.deleted_at).not.toBeNull();

      await deleteOpenAIProviderConfig(providerId);
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

      await deleteRAGConfig(ragId);
      const afterDelete = await getRAGConfig(ragId, true);
      expect(afterDelete).not.toBeNull();
      expect(afterDelete!.deleted_at).not.toBeNull();

      await deleteOllamaProviderConfig(providerId);
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

      await deleteTTSConfig(ttsId);
      const afterDelete = await getTTSConfig(ttsId, true);
      expect(afterDelete).not.toBeNull();
      expect(afterDelete!.deleted_at).not.toBeNull();

      await deleteOpenAIProviderConfig(providerId);
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

      await deleteVisionConfig(visId);
      const afterDelete = await getVisionConfig(visId, true);
      expect(afterDelete).not.toBeNull();
      expect(afterDelete!.deleted_at).not.toBeNull();

      await deleteOpenAIProviderConfig(providerId);
    });
  });

  describe('updated_at bump on update (sync dirty-tracking)', () => {
    const makeOpenAIProvider = () =>
      createOpenAIProviderConfig({
        name: 'Bump OpenAI',
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

    it('updateBackendConfig bumps updated_at so the change is picked up by sync', async () => {
      const providerId = await makeOpenAIProvider();
      const backendId = await createBackendConfig({
        name: 'Bump Backend',
        provider: 'openai',
        provider_config_id: providerId,
      });

      // Push created_at/updated_at into the past so the row is NOT dirty
      // before the update and the sync pick-up can only come from the bump.
      await getDb().executeSql(
        'UPDATE backend_configs SET created_at = ?, updated_at = ? WHERE id = ?',
        ['2000-01-01 00:00:00', '2000-01-01 00:00:00', backendId]
      );

      await updateBackendConfig({
        id: backendId,
        name: 'Bump Backend',
        provider: 'openai',
        provider_config_id: providerId,
        deleted_at: null,
      });

      // updated_at must now be newer than the forced past value.
      const [result] = await getDb().executeSql(
        "SELECT CAST(strftime('%s', updated_at) AS INTEGER) AS updated_at_unix FROM backend_configs WHERE id = ?",
        [backendId]
      );
      const pastUnix = Math.floor(new Date('2000-01-01T00:00:00Z').getTime() / 1000);
      expect(result.rows.item(0).updated_at_unix).toBeGreaterThan(pastUnix);

      // getChangedRecords must include the row for a lastSync between past and now.
      const records = await getChangedRecords('backend_configs', pastUnix);
      expect(records.some(r => r.id === backendId)).toBe(true);

      await deleteBackendConfig(backendId);
      await deleteOpenAIProviderConfig(providerId);
    });

    it('updateCognitionConfig bumps updated_at so the change is picked up by sync', async () => {
      const providerId = await makeOpenAIProvider();
      const cogId = await createCognitionConfig({
        name: 'Bump Cognition',
        provider: 'openai',
        provider_config_id: providerId,
        max_cognition_events: 20,
        generate_expressions: 1,
      });

      await getDb().executeSql(
        'UPDATE cognition_configs SET created_at = ?, updated_at = ? WHERE id = ?',
        ['2000-01-01 00:00:00', '2000-01-01 00:00:00', cogId]
      );

      await updateCognitionConfig({
        id: cogId,
        name: 'Bump Cognition',
        provider: 'openai',
        provider_config_id: providerId,
        max_cognition_events: 20,
        generate_expressions: 1,
        deleted_at: null,
      });

      const [result] = await getDb().executeSql(
        "SELECT CAST(strftime('%s', updated_at) AS INTEGER) AS updated_at_unix FROM cognition_configs WHERE id = ?",
        [cogId]
      );
      const pastUnix = Math.floor(new Date('2000-01-01T00:00:00Z').getTime() / 1000);
      expect(result.rows.item(0).updated_at_unix).toBeGreaterThan(pastUnix);

      const records = await getChangedRecords('cognition_configs', pastUnix);
      expect(records.some(r => r.id === cogId)).toBe(true);

      await deleteCognitionConfig(cogId);
      await deleteOpenAIProviderConfig(providerId);
    });
  });
});
