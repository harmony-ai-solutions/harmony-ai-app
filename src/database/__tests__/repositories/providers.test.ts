/**
 * Provider Configuration Repository Tests
 *
 * Ported from the deleted hand-rolled test file. 11 ported tests + 5 new
 * tests for providers that had zero coverage.
 *
 * Uses useFreshDatabase() fixture for per-test DB isolation.
 * Each test follows the same create → get → delete pattern with a minimal config.
 */

import {useFreshDatabase} from '../repositoryFixtures';

// Ported providers (11 types)
import {
  createOpenAIProviderConfig,
  getOpenAIProviderConfig,
  deleteOpenAIProviderConfig,
} from '../../repositories/providers/OpenAIProviderConfigRepository';
import {
  createOpenRouterProviderConfig,
  getOpenRouterProviderConfig,
  deleteOpenRouterProviderConfig,
} from '../../repositories/providers/OpenRouterProviderConfigRepository';
import {
  createOpenAICompatibleProviderConfig,
  getOpenAICompatibleProviderConfig,
  deleteOpenAICompatibleProviderConfig,
} from '../../repositories/providers/OpenAICompatibleProviderConfigRepository';
import {
  createHarmonySpeechProviderConfig,
  getHarmonySpeechProviderConfig,
  deleteHarmonySpeechProviderConfig,
} from '../../repositories/providers/HarmonySpeechProviderConfigRepository';
import {
  createElevenLabsProviderConfig,
  getElevenLabsProviderConfig,
  deleteElevenLabsProviderConfig,
} from '../../repositories/providers/ElevenLabsProviderConfigRepository';
import {
  createKindroidProviderConfig,
  getKindroidProviderConfig,
  deleteKindroidProviderConfig,
} from '../../repositories/providers/KindroidProviderConfigRepository';
import {
  createKajiwotoProviderConfig,
  getKajiwotoProviderConfig,
  deleteKajiwotoProviderConfig,
} from '../../repositories/providers/KajiwotoProviderConfigRepository';
import {
  createCharacterAIProviderConfig,
  getCharacterAIProviderConfig,
  deleteCharacterAIProviderConfig,
} from '../../repositories/providers/CharacterAIProviderConfigRepository';
import {
  createLocalAIProviderConfig,
  getLocalAIProviderConfig,
  deleteLocalAIProviderConfig,
} from '../../repositories/providers/LocalAIProviderConfigRepository';
import {
  createMistralProviderConfig,
  getMistralProviderConfig,
  deleteMistralProviderConfig,
} from '../../repositories/providers/MistralProviderConfigRepository';
import {
  createOllamaProviderConfig,
  getOllamaProviderConfig,
  deleteOllamaProviderConfig,
} from '../../repositories/providers/OllamaProviderConfigRepository';

// NEW providers (5 types - missing from original tests)
import {
  createComfyUIProviderConfig,
  getComfyUIProviderConfig,
  deleteComfyUIProviderConfig,
} from '../../repositories/providers/ComfyUIProviderConfigRepository';
import {
  createXAIProviderConfig,
  getXAIProviderConfig,
  deleteXAIProviderConfig,
} from '../../repositories/providers/XAIProviderConfigRepository';
import {
  createGoogleProviderConfig,
  getGoogleProviderConfig,
  deleteGoogleProviderConfig,
} from '../../repositories/providers/GoogleProviderConfigRepository';
import {
  createAnthropicProviderConfig,
  getAnthropicProviderConfig,
  deleteAnthropicProviderConfig,
} from '../../repositories/providers/AnthropicProviderConfigRepository';
import {
  createSoulbitsCloudProviderConfig,
  getSoulbitsCloudProviderConfig,
  deleteSoulbitsCloudProviderConfig,
} from '../../repositories/providers/SoulbitsCloudProviderConfigRepository';

describe('providers repository', () => {
  const {getDb} = useFreshDatabase();

  // ===========================================================================
  // Ported tests (11 providers)
  // ===========================================================================

  describe('OpenAI Provider CRUD', () => {
    it('OpenAI Provider CRUD', async () => {
      const id = await createOpenAIProviderConfig({
        name: 'Test OpenAI',
        api_key: 'sk-test-123',
        model: 'gpt-4',
        max_tokens: 0,            // NOT NULL DEFAULT 0
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
      expect(id).toBeDefined();

      const retrieved = await getOpenAIProviderConfig(id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.name).toBe('Test OpenAI');

      await deleteOpenAIProviderConfig(id, true);
      const afterDelete = await getOpenAIProviderConfig(id, true);
      expect(afterDelete).toBeNull();
    });
  });

  describe('OpenRouter Provider CRUD', () => {
    it('OpenRouter Provider CRUD', async () => {
      const id = await createOpenRouterProviderConfig({
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
      expect(id).toBeDefined();

      const retrieved = await getOpenRouterProviderConfig(id);
      expect(retrieved).not.toBeNull();

      await deleteOpenRouterProviderConfig(id, true);
      const afterDelete = await getOpenRouterProviderConfig(id, true);
      expect(afterDelete).toBeNull();
    });
  });

  describe('OpenAI Compatible Provider CRUD', () => {
    it('OpenAI Compatible Provider CRUD', async () => {
      const id = await createOpenAICompatibleProviderConfig({
        name: 'Test Compatible',
        base_url: 'http://localhost:8080',
        api_key: '',        // NOT NULL DEFAULT ''
        model: '',
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
      });
      expect(id).toBeDefined();

      const retrieved = await getOpenAICompatibleProviderConfig(id);
      expect(retrieved).not.toBeNull();

      await deleteOpenAICompatibleProviderConfig(id, true);
      const afterDelete = await getOpenAICompatibleProviderConfig(id, true);
      expect(afterDelete).toBeNull();
    });
  });

  describe('Harmony Speech Provider CRUD', () => {
    it('Harmony Speech Provider CRUD', async () => {
      const id = await createHarmonySpeechProviderConfig({
        name: 'Test HS',
        endpoint: 'http://localhost:9000',
        model: 'default',
        voice_config_file: '',  // NOT NULL DEFAULT ''
        format: '',
        sample_rate: 0,
        stream: 0,
      });
      expect(id).toBeDefined();

      const retrieved = await getHarmonySpeechProviderConfig(id);
      expect(retrieved).not.toBeNull();

      await deleteHarmonySpeechProviderConfig(id, true);
      const afterDelete = await getHarmonySpeechProviderConfig(id, true);
      expect(afterDelete).toBeNull();
    });
  });

  describe('ElevenLabs Provider CRUD', () => {
    it('ElevenLabs Provider CRUD', async () => {
      const id = await createElevenLabsProviderConfig({
        name: 'Test ElevenLabs',
        api_key: 'sk-test',
        voice_id: 'test-voice',
        model_id: '',      // NOT NULL DEFAULT ''
        stability: 0,
        similarity_boost: 0,
        style: 0,
        speaker_boost: 0,
      });
      expect(id).toBeDefined();

      const retrieved = await getElevenLabsProviderConfig(id);
      expect(retrieved).not.toBeNull();

      await deleteElevenLabsProviderConfig(id, true);
      const afterDelete = await getElevenLabsProviderConfig(id, true);
      expect(afterDelete).toBeNull();
    });
  });

  describe('Kindroid Provider CRUD', () => {
    it('Kindroid Provider CRUD', async () => {
      const id = await createKindroidProviderConfig({
        name: 'Test Kindroid',
        api_key: 'sk-test',
        kindroid_id: 'kid-123',
      });
      expect(id).toBeDefined();

      const retrieved = await getKindroidProviderConfig(id);
      expect(retrieved).not.toBeNull();

      await deleteKindroidProviderConfig(id, true);
      const afterDelete = await getKindroidProviderConfig(id, true);
      expect(afterDelete).toBeNull();
    });
  });

  describe('Kajiwoto Provider CRUD', () => {
    it('Kajiwoto Provider CRUD', async () => {
      const id = await createKajiwotoProviderConfig({
        name: 'Test Kajiwoto',
        username: 'testuser',
        password: 'testpass',
        room_url: 'http://kajiwoto.com/room',
      });
      expect(id).toBeDefined();

      const retrieved = await getKajiwotoProviderConfig(id);
      expect(retrieved).not.toBeNull();

      await deleteKajiwotoProviderConfig(id, true);
      const afterDelete = await getKajiwotoProviderConfig(id, true);
      expect(afterDelete).toBeNull();
    });
  });

  describe('CharacterAI Provider CRUD', () => {
    it('CharacterAI Provider CRUD', async () => {
      const id = await createCharacterAIProviderConfig({
        name: 'Test CAI',
        api_token: 'test-token',
        chatroom_url: 'http://character.ai/room',
      });
      expect(id).toBeDefined();

      const retrieved = await getCharacterAIProviderConfig(id);
      expect(retrieved).not.toBeNull();

      await deleteCharacterAIProviderConfig(id, true);
      const afterDelete = await getCharacterAIProviderConfig(id, true);
      expect(afterDelete).toBeNull();
    });
  });

  describe('LocalAI Provider CRUD', () => {
    it('LocalAI Provider CRUD', async () => {
      const id = await createLocalAIProviderConfig({
        name: 'Test LocalAI',
        model: 'local-model',
      });
      expect(id).toBeDefined();

      const retrieved = await getLocalAIProviderConfig(id);
      expect(retrieved).not.toBeNull();

      await deleteLocalAIProviderConfig(id, true);
      const afterDelete = await getLocalAIProviderConfig(id, true);
      expect(afterDelete).toBeNull();
    });
  });

  describe('Mistral Provider CRUD', () => {
    it('Mistral Provider CRUD', async () => {
      const id = await createMistralProviderConfig({
        name: 'Test Mistral',
        api_key: 'sk-test',
      });
      expect(id).toBeDefined();

      const retrieved = await getMistralProviderConfig(id);
      expect(retrieved).not.toBeNull();

      await deleteMistralProviderConfig(id, true);
      const afterDelete = await getMistralProviderConfig(id, true);
      expect(afterDelete).toBeNull();
    });
  });

  describe('Ollama Provider CRUD', () => {
    it('Ollama Provider CRUD', async () => {
      const id = await createOllamaProviderConfig({
        name: 'Test Ollama',
        base_url: 'http://ollama',
        model: null,
      });
      expect(id).toBeDefined();

      const retrieved = await getOllamaProviderConfig(id);
      expect(retrieved).not.toBeNull();

      await deleteOllamaProviderConfig(id, true);
      const afterDelete = await getOllamaProviderConfig(id, true);
      expect(afterDelete).toBeNull();
    });
  });

  // ===========================================================================
  // NEW tests — providers with zero coverage in the old test suite
  // ===========================================================================

  describe('ComfyUI Provider CRUD (NEW)', () => {
    it('ComfyUI Provider CRUD', async () => {
      const id = await createComfyUIProviderConfig({
        name: 'Test ComfyUI',
        base_url: 'http://localhost:8188',
        api_key: '',
        workflow_profiles: '{}',
      });
      expect(id).toBeDefined();

      const retrieved = await getComfyUIProviderConfig(id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.base_url).toBe('http://localhost:8188');

      await deleteComfyUIProviderConfig(id, true);
      const afterDelete = await getComfyUIProviderConfig(id, true);
      expect(afterDelete).toBeNull();
    });
  });

  describe('XAI Provider CRUD (NEW)', () => {
    it('XAI Provider CRUD', async () => {
      const id = await createXAIProviderConfig({
        name: 'Test XAI',
        api_key: 'sk-test',
        model: 'grok-4.3',
        max_tokens: 0,              // NOT NULL DEFAULT 0
        max_completion_tokens: 0,
        temperature: 0,
        top_p: 0,
        frequency_penalty: 0,
        presence_penalty: 0,
        n: 0,
        stop_tokens: '[]',
        seed: 0,
        response_format: '',
        reasoning_effort: '',
        sampling_preset_name: '',
        extra_params: '{}',
        image_aspect_ratio: '1:1',
        image_resolution: '1k',
      });
      expect(id).toBeDefined();

      const retrieved = await getXAIProviderConfig(id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.name).toBe('Test XAI');

      await deleteXAIProviderConfig(id, true);
      const afterDelete = await getXAIProviderConfig(id, true);
      expect(afterDelete).toBeNull();
    });
  });

  describe('Google Provider CRUD (NEW)', () => {
    it('Google Provider CRUD', async () => {
      const id = await createGoogleProviderConfig({
        name: 'Test Google',
        api_key: 'sk-test',
        model: 'gemini-2.0',
        max_output_tokens: 0,     // NOT NULL DEFAULT 0
        temperature: 0,
        top_p: 0,
        top_k: 0,
        stop_tokens: '[]',
        seed: 0,
        response_mime_type: '',
        sampling_preset_name: '',
        extra_params: '{}',
        number_of_images: 1,
        aspect_ratio: '1:1',
      });
      expect(id).toBeDefined();

      const retrieved = await getGoogleProviderConfig(id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.name).toBe('Test Google');

      await deleteGoogleProviderConfig(id, true);
      const afterDelete = await getGoogleProviderConfig(id, true);
      expect(afterDelete).toBeNull();
    });
  });

  describe('Anthropic Provider CRUD (NEW)', () => {
    it('Anthropic Provider CRUD', async () => {
      const id = await createAnthropicProviderConfig({
        name: 'Test Anthropic',
        api_key: 'sk-test',
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,       // NOT NULL DEFAULT 4096
        temperature: 0,
        top_p: 0,
        top_k: 0,
        stop_sequences: '[]',
        sampling_preset_name: '',
        extra_params: '{}',
      });
      expect(id).toBeDefined();

      const retrieved = await getAnthropicProviderConfig(id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.name).toBe('Test Anthropic');

      await deleteAnthropicProviderConfig(id, true);
      const afterDelete = await getAnthropicProviderConfig(id, true);
      expect(afterDelete).toBeNull();
    });
  });

  describe('SoulbitsCloud Provider CRUD (NEW)', () => {
    it('SoulbitsCloud Provider CRUD', async () => {
      const id = await createSoulbitsCloudProviderConfig({
        name: 'Test Soulbits',
        base_url: 'https://api.soulbits.app',
        api_key: '',
        model: '',            // NOT NULL DEFAULT ''
        max_tokens: 0,
        max_completion_tokens: 0,
        temperature: 0,
        top_p: 0,
        frequency_penalty: 0,
        presence_penalty: 0,
        n: 0,
        stop_tokens: '[]',
        seed: 0,
        response_format: '',
        sampling_preset_name: '',
        extra_params: '{}',
        voice: '',
        speed: 1.0,
        format: 'mp3',
        image_aspect_ratio: '1:1',
        image_size: '1k',
      });
      expect(id).toBeDefined();

      const retrieved = await getSoulbitsCloudProviderConfig(id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.name).toBe('Test Soulbits');

      await deleteSoulbitsCloudProviderConfig(id, true);
      const afterDelete = await getSoulbitsCloudProviderConfig(id, true);
      expect(afterDelete).toBeNull();
    });
  });
});
