/**
 * Provider Configuration Repositories
 * 
 * Provides CRUD operations for all provider configuration types:
 * - OpenAI, OpenRouter, OpenAI Compatible
 * - HarmonySpeech, ElevenLabs
 * - Kindroid, Kajiwoto, CharacterAI
 * - LocalAI, Mistral, Ollama
 * 
 * Mirrors the Go implementation in harmony-link-private/database/repository/providers/
 */

import {getDatabase} from '../connection';
import {withTransaction} from '../transaction';
import {
  OpenAIProviderConfig,
  OpenRouterProviderConfig,
  OpenAICompatibleProviderConfig,
  HarmonySpeechProviderConfig,
  ElevenLabsProviderConfig,
  KindroidProviderConfig,
  KajiwotoProviderConfig,
  CharacterAIProviderConfig,
  LocalAIProviderConfig,
  MistralProviderConfig,
  OllamaProviderConfig,
  ComfyUIProviderConfig,
  XAIProviderConfig,
  GoogleProviderConfig,
  AnthropicProviderConfig,
} from '../models';

/**
 * Check if a provider config is referenced by any active module config.
 * Checks ALL module tables so it's future-proof — if a provider gains
 * new module support later, it's automatically covered.
 * 
 * stt_configs uses a dual-FK schema (transcription_provider_config_id +
 * vad_provider_config_id) instead of the standard provider_config_id.
 */
async function isProviderConfigInUse(providerName: string, id: number): Promise<boolean> {
  const db = getDatabase();
  const checkQuery = `
    SELECT COUNT(*) as count FROM (
      SELECT 1 FROM backend_configs WHERE provider = ? AND provider_config_id = ? AND deleted_at IS NULL
      UNION ALL
      SELECT 1 FROM cognition_configs WHERE provider = ? AND provider_config_id = ? AND deleted_at IS NULL
      UNION ALL
      SELECT 1 FROM movement_configs WHERE provider = ? AND provider_config_id = ? AND deleted_at IS NULL
      UNION ALL
      SELECT 1 FROM vision_configs WHERE provider = ? AND provider_config_id = ? AND deleted_at IS NULL
      UNION ALL
      SELECT 1 FROM tts_configs WHERE provider = ? AND provider_config_id = ? AND deleted_at IS NULL
      UNION ALL
      SELECT 1 FROM imagination_configs WHERE provider = ? AND provider_config_id = ? AND deleted_at IS NULL
      UNION ALL
      SELECT 1 FROM rag_configs WHERE provider = ? AND provider_config_id = ? AND deleted_at IS NULL
      UNION ALL
      SELECT 1 FROM stt_configs WHERE transcription_provider = ? AND transcription_provider_config_id = ? AND deleted_at IS NULL
      UNION ALL
      SELECT 1 FROM stt_configs WHERE vad_provider = ? AND vad_provider_config_id = ? AND deleted_at IS NULL
    )
  `;
  // 9 arms, each with 2 params = 18 total
  const params = [providerName, id, providerName, id, providerName, id, providerName, id,
                  providerName, id, providerName, id, providerName, id, providerName, id,
                  providerName, id];
  const [results] = await db.executeSql(checkQuery, params);
  return results.rows.item(0).count > 0;
}

// ============================================================================
// OpenAI Provider Config Operations
// ============================================================================

export async function createOpenAIProviderConfig(
  config: Omit<OpenAIProviderConfig, 'id' | 'deleted_at'>
): Promise<number> {
  const db = getDatabase();
  
  return new Promise<number>((resolve, reject) => {
    db.transaction(
      (tx) => {
        tx.executeSql(
          `INSERT INTO provider_config_openai (
            name, api_key, model, max_tokens, temperature, top_p, n,
            stop_tokens, voice, speed, format,
            frequency_penalty, presence_penalty, max_completion_tokens,
            seed, response_format, reasoning_effort,
            top_k, top_a, min_p, repetition_penalty, sampling_preset_name, extra_params
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            config.name,
            config.api_key,
            config.model,
            config.max_tokens,
            config.temperature,
            config.top_p,
            config.n,
            config.stop_tokens,
            config.voice,
            config.speed,
            config.format,
            config.frequency_penalty,
            config.presence_penalty,
            config.max_completion_tokens,
            config.seed,
            config.response_format,
            config.reasoning_effort,
            config.top_k,
            config.top_a,
            config.min_p,
            config.repetition_penalty,
            config.sampling_preset_name,
            config.extra_params,
          ],
          (_, result) => {
            resolve(result.insertId!);
          },
          (_, error) => {
            reject(error);
            return false;
          }
        );
      },
      (error) => reject(error)
    );
  });
}

export async function getOpenAIProviderConfig(id: number, includeDeleted = false): Promise<OpenAIProviderConfig | null> {
  const db = getDatabase();
  
  const query = includeDeleted
    ? `SELECT id, name, api_key, model, max_tokens, temperature, top_p, n,
            stop_tokens, voice, speed, format,
            frequency_penalty, presence_penalty, max_completion_tokens,
            seed, response_format, reasoning_effort,
            top_k, top_a, min_p, repetition_penalty, sampling_preset_name, extra_params, deleted_at
     FROM provider_config_openai WHERE id = ?`
    : `SELECT id, name, api_key, model, max_tokens, temperature, top_p, n,
            stop_tokens, voice, speed, format,
            frequency_penalty, presence_penalty, max_completion_tokens,
            seed, response_format, reasoning_effort,
            top_k, top_a, min_p, repetition_penalty, sampling_preset_name, extra_params, deleted_at
     FROM provider_config_openai WHERE id = ? AND deleted_at IS NULL`;

  const [results] = await db.executeSql(query, [id]);
  
  if (results.rows.length === 0) {
    return null;
  }
  
  const row = results.rows.item(0);
  return {
    id: row.id,
    name: row.name,
    api_key: row.api_key,
    model: row.model,
    max_tokens: row.max_tokens,
    temperature: row.temperature,
    top_p: row.top_p,
    n: row.n,
    stop_tokens: row.stop_tokens,
    voice: row.voice,
    speed: row.speed,
    format: row.format,
    frequency_penalty: row.frequency_penalty,
    presence_penalty: row.presence_penalty,
    max_completion_tokens: row.max_completion_tokens,
    seed: row.seed,
    response_format: row.response_format,
    reasoning_effort: row.reasoning_effort,
    top_k: row.top_k,
    top_a: row.top_a,
    min_p: row.min_p,
    repetition_penalty: row.repetition_penalty,
    sampling_preset_name: row.sampling_preset_name,
    extra_params: row.extra_params,
    deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
  };
}

export async function getOpenAIProviderConfigByName(name: string, includeDeleted = false): Promise<OpenAIProviderConfig | null> {
  const db = getDatabase();
  
  const query = includeDeleted
    ? `SELECT id, name, api_key, model, max_tokens, temperature, top_p, n,
            stop_tokens, voice, speed, format,
            frequency_penalty, presence_penalty, max_completion_tokens,
            seed, response_format, reasoning_effort,
            top_k, top_a, min_p, repetition_penalty, sampling_preset_name, extra_params, deleted_at
     FROM provider_config_openai WHERE name = ?`
    : `SELECT id, name, api_key, model, max_tokens, temperature, top_p, n,
            stop_tokens, voice, speed, format,
            frequency_penalty, presence_penalty, max_completion_tokens,
            seed, response_format, reasoning_effort,
            top_k, top_a, min_p, repetition_penalty, sampling_preset_name, extra_params, deleted_at
     FROM provider_config_openai WHERE name = ? AND deleted_at IS NULL`;

  const [results] = await db.executeSql(query, [name]);
  
  if (results.rows.length === 0) {
    return null;
  }
  
  const row = results.rows.item(0);
  return {
    id: row.id,
    name: row.name,
    api_key: row.api_key,
    model: row.model,
    max_tokens: row.max_tokens,
    temperature: row.temperature,
    top_p: row.top_p,
    n: row.n,
    stop_tokens: row.stop_tokens,
    voice: row.voice,
    speed: row.speed,
    format: row.format,
    frequency_penalty: row.frequency_penalty,
    presence_penalty: row.presence_penalty,
    max_completion_tokens: row.max_completion_tokens,
    seed: row.seed,
    response_format: row.response_format,
    reasoning_effort: row.reasoning_effort,
    top_k: row.top_k,
    top_a: row.top_a,
    min_p: row.min_p,
    repetition_penalty: row.repetition_penalty,
    sampling_preset_name: row.sampling_preset_name,
    extra_params: row.extra_params,
    deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
  };
}

export async function getAllOpenAIProviderConfigs(includeDeleted = false): Promise<OpenAIProviderConfig[]> {
  const db = getDatabase();
  
  const query = includeDeleted
    ? `SELECT id, name, api_key, model, max_tokens, temperature, top_p, n,
            stop_tokens, voice, speed, format,
            frequency_penalty, presence_penalty, max_completion_tokens,
            seed, response_format, reasoning_effort,
            top_k, top_a, min_p, repetition_penalty, sampling_preset_name, extra_params, deleted_at
     FROM provider_config_openai ORDER BY name`
    : `SELECT id, name, api_key, model, max_tokens, temperature, top_p, n,
            stop_tokens, voice, speed, format,
            frequency_penalty, presence_penalty, max_completion_tokens,
            seed, response_format, reasoning_effort,
            top_k, top_a, min_p, repetition_penalty, sampling_preset_name, extra_params, deleted_at
     FROM provider_config_openai WHERE deleted_at IS NULL ORDER BY name`;

  const [results] = await db.executeSql(query);
  
  const configs: OpenAIProviderConfig[] = [];
  for (let i = 0; i < results.rows.length; i++) {
    const row = results.rows.item(i);
    configs.push({
      id: row.id,
      name: row.name,
      api_key: row.api_key,
      model: row.model,
      max_tokens: row.max_tokens,
      temperature: row.temperature,
      top_p: row.top_p,
      n: row.n,
      stop_tokens: row.stop_tokens,
      voice: row.voice,
      speed: row.speed,
      format: row.format,
      frequency_penalty: row.frequency_penalty,
      presence_penalty: row.presence_penalty,
      max_completion_tokens: row.max_completion_tokens,
      seed: row.seed,
      response_format: row.response_format,
      reasoning_effort: row.reasoning_effort,
      top_k: row.top_k,
      top_a: row.top_a,
      min_p: row.min_p,
      repetition_penalty: row.repetition_penalty,
      sampling_preset_name: row.sampling_preset_name,
      extra_params: row.extra_params,
      deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
    });
  }
  
  return configs;
}

export async function updateOpenAIProviderConfig(config: OpenAIProviderConfig): Promise<void> {
  const db = getDatabase();
  
  return withTransaction(db, async (tx) => {
    const [result] = await tx.executeSql(
      `UPDATE provider_config_openai
       SET name = ?, api_key = ?, model = ?, max_tokens = ?, temperature = ?,
           top_p = ?, n = ?, stop_tokens = ?,
           voice = ?, speed = ?, format = ?,
           frequency_penalty = ?, presence_penalty = ?, max_completion_tokens = ?,
           seed = ?, response_format = ?, reasoning_effort = ?,
           top_k = ?, top_a = ?, min_p = ?, repetition_penalty = ?, sampling_preset_name = ?, extra_params = ?
       WHERE id = ?`,
      [
        config.name,
        config.api_key,
        config.model,
        config.max_tokens,
        config.temperature,
        config.top_p,
        config.n,
        config.stop_tokens,
        config.voice,
        config.speed,
        config.format,
        config.frequency_penalty,
        config.presence_penalty,
        config.max_completion_tokens,
        config.seed,
        config.response_format,
        config.reasoning_effort,
        config.top_k,
        config.top_a,
        config.min_p,
        config.repetition_penalty,
        config.sampling_preset_name,
        config.extra_params,
        config.id,
      ]
    );
    
    if (result.rowsAffected === 0) {
      throw new Error(`OpenAI provider config not found: ${config.id}`);
    }
  });
}

/**
 * Check if an OpenAI provider config is in use by any modules
 */
export async function isOpenAIProviderConfigInUse(id: number): Promise<boolean> {
  return isProviderConfigInUse('openai', id);
}

export async function deleteOpenAIProviderConfig(id: number, permanent = false): Promise<void> {
  const db = getDatabase();
  
  if (!permanent && await isOpenAIProviderConfigInUse(id)) {
    throw new Error(`OpenAI provider config ${id} is in use and cannot be soft deleted`);
  }

  return withTransaction(db, async (tx) => {
    if (permanent) {
      const [result] = await tx.executeSql('DELETE FROM provider_config_openai WHERE id = ?', [id]);
      if (result.rowsAffected === 0) {
        throw new Error(`OpenAI provider config not found: ${id}`);
      }
    } else {
      const now = new Date().toISOString();
      const [result] = await tx.executeSql(
        'UPDATE provider_config_openai SET deleted_at = ? WHERE id = ?',
        [now, id]
      );
      if (result.rowsAffected === 0) {
        throw new Error(`OpenAI provider config not found: ${id}`);
      }
    }
  });
}

// ============================================================================
// OpenRouter Provider Config Operations
// ============================================================================

export async function createOpenRouterProviderConfig(
  config: Omit<OpenRouterProviderConfig, 'id' | 'deleted_at'>
): Promise<number> {
  const db = getDatabase();
  
  return new Promise<number>((resolve, reject) => {
    db.transaction(
      (tx) => {
        tx.executeSql(
      `INSERT INTO provider_config_openrouter (
        name, api_key, model, max_tokens, temperature, top_p, n, stop_tokens,
        frequency_penalty, presence_penalty, max_completion_tokens,
        seed, response_format, top_k, top_a, min_p, repetition_penalty,
        sampling_preset_name, extra_params,
        voice, speed, format, image_aspect_ratio, image_size
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        config.name,
        config.api_key,
        config.model,
        config.max_tokens,
        config.temperature,
        config.top_p,
        config.n,
        config.stop_tokens,
        config.frequency_penalty,
        config.presence_penalty,
        config.max_completion_tokens,
        config.seed,
        config.response_format,
        config.top_k,
        config.top_a,
        config.min_p,
        config.repetition_penalty,
        config.sampling_preset_name,
        config.extra_params,
        config.voice,
        config.speed,
        config.format,
        config.image_aspect_ratio,
        config.image_size,
      ],
      (_, result) => {
            resolve(result.insertId!);
          },
          (_, error) => {
            reject(error);
            return false;
          }
        );
      },
      (error) => reject(error)
    );
  });
}

export async function getOpenRouterProviderConfig(id: number, includeDeleted = false): Promise<OpenRouterProviderConfig | null> {
  const db = getDatabase();
  
  const query = includeDeleted
    ? `SELECT id, name, api_key, model, max_tokens, temperature, top_p, n, stop_tokens,
            frequency_penalty, presence_penalty, max_completion_tokens,
            seed, response_format, top_k, top_a, min_p, repetition_penalty,
            sampling_preset_name, extra_params,
            voice, speed, format, image_aspect_ratio, image_size, deleted_at
     FROM provider_config_openrouter WHERE id = ?`
    : `SELECT id, name, api_key, model, max_tokens, temperature, top_p, n, stop_tokens,
            frequency_penalty, presence_penalty, max_completion_tokens,
            seed, response_format, top_k, top_a, min_p, repetition_penalty,
            sampling_preset_name, extra_params,
            voice, speed, format, image_aspect_ratio, image_size, deleted_at
     FROM provider_config_openrouter WHERE id = ? AND deleted_at IS NULL`;

  const [results] = await db.executeSql(query, [id]);
  
  if (results.rows.length === 0) {
    return null;
  }
  
  const row = results.rows.item(0);
  return {
    id: row.id,
    name: row.name,
    api_key: row.api_key,
    model: row.model,
    max_tokens: row.max_tokens,
    temperature: row.temperature,
    top_p: row.top_p,
    n: row.n,
    stop_tokens: row.stop_tokens,
    frequency_penalty: row.frequency_penalty,
    presence_penalty: row.presence_penalty,
    max_completion_tokens: row.max_completion_tokens,
    seed: row.seed,
    response_format: row.response_format,
    top_k: row.top_k,
    top_a: row.top_a,
    min_p: row.min_p,
    repetition_penalty: row.repetition_penalty,
    sampling_preset_name: row.sampling_preset_name,
    extra_params: row.extra_params,
    voice: row.voice,
    speed: row.speed,
    format: row.format,
    image_aspect_ratio: row.image_aspect_ratio,
    image_size: row.image_size,
    deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
  };
}

export async function getOpenRouterProviderConfigByName(name: string, includeDeleted = false): Promise<OpenRouterProviderConfig | null> {
  const db = getDatabase();
  
  const query = includeDeleted
    ? `SELECT id, name, api_key, model, max_tokens, temperature, top_p, n, stop_tokens,
            frequency_penalty, presence_penalty, max_completion_tokens,
            seed, response_format, top_k, top_a, min_p, repetition_penalty,
            sampling_preset_name, extra_params,
            voice, speed, format, image_aspect_ratio, image_size, deleted_at
     FROM provider_config_openrouter WHERE name = ?`
    : `SELECT id, name, api_key, model, max_tokens, temperature, top_p, n, stop_tokens,
            frequency_penalty, presence_penalty, max_completion_tokens,
            seed, response_format, top_k, top_a, min_p, repetition_penalty,
            sampling_preset_name, extra_params,
            voice, speed, format, image_aspect_ratio, image_size, deleted_at
     FROM provider_config_openrouter WHERE name = ? AND deleted_at IS NULL`;

  const [results] = await db.executeSql(query, [name]);
  
  if (results.rows.length === 0) {
    return null;
  }
  
  const row = results.rows.item(0);
  return {
    id: row.id,
    name: row.name,
    api_key: row.api_key,
    model: row.model,
    max_tokens: row.max_tokens,
    temperature: row.temperature,
    top_p: row.top_p,
    n: row.n,
    stop_tokens: row.stop_tokens,
    frequency_penalty: row.frequency_penalty,
    presence_penalty: row.presence_penalty,
    max_completion_tokens: row.max_completion_tokens,
    seed: row.seed,
    response_format: row.response_format,
    top_k: row.top_k,
    top_a: row.top_a,
    min_p: row.min_p,
    repetition_penalty: row.repetition_penalty,
    sampling_preset_name: row.sampling_preset_name,
    extra_params: row.extra_params,
    voice: row.voice,
    speed: row.speed,
    format: row.format,
    image_aspect_ratio: row.image_aspect_ratio,
    image_size: row.image_size,
    deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
  };
}

export async function getAllOpenRouterProviderConfigs(includeDeleted = false): Promise<OpenRouterProviderConfig[]> {
  const db = getDatabase();
  
  const query = includeDeleted
    ? `SELECT id, name, api_key, model, max_tokens, temperature, top_p, n, stop_tokens,
            frequency_penalty, presence_penalty, max_completion_tokens,
            seed, response_format, top_k, top_a, min_p, repetition_penalty,
            sampling_preset_name, extra_params,
            voice, speed, format, image_aspect_ratio, image_size, deleted_at
     FROM provider_config_openrouter ORDER BY name`
    : `SELECT id, name, api_key, model, max_tokens, temperature, top_p, n, stop_tokens,
            frequency_penalty, presence_penalty, max_completion_tokens,
            seed, response_format, top_k, top_a, min_p, repetition_penalty,
            sampling_preset_name, extra_params,
            voice, speed, format, image_aspect_ratio, image_size, deleted_at
     FROM provider_config_openrouter WHERE deleted_at IS NULL ORDER BY name`;

  const [results] = await db.executeSql(query);
  
  const configs: OpenRouterProviderConfig[] = [];
  for (let i = 0; i < results.rows.length; i++) {
    const row = results.rows.item(i);
    configs.push({
      id: row.id,
      name: row.name,
      api_key: row.api_key,
      model: row.model,
      max_tokens: row.max_tokens,
      temperature: row.temperature,
      top_p: row.top_p,
      n: row.n,
      stop_tokens: row.stop_tokens,
      frequency_penalty: row.frequency_penalty,
      presence_penalty: row.presence_penalty,
      max_completion_tokens: row.max_completion_tokens,
      seed: row.seed,
      response_format: row.response_format,
      top_k: row.top_k,
      top_a: row.top_a,
      min_p: row.min_p,
      repetition_penalty: row.repetition_penalty,
      sampling_preset_name: row.sampling_preset_name,
      extra_params: row.extra_params,
      voice: row.voice,
      speed: row.speed,
      format: row.format,
      image_aspect_ratio: row.image_aspect_ratio,
      image_size: row.image_size,
      deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
    });
  }
  
  return configs;
}

export async function updateOpenRouterProviderConfig(config: OpenRouterProviderConfig): Promise<void> {
  const db = getDatabase();
  
  return withTransaction(db, async (tx) => {
    const [result] = await tx.executeSql(
      `UPDATE provider_config_openrouter
       SET name = ?, api_key = ?, model = ?, max_tokens = ?, temperature = ?,
           top_p = ?, n = ?, stop_tokens = ?,
           frequency_penalty = ?, presence_penalty = ?, max_completion_tokens = ?,
           seed = ?, response_format = ?, top_k = ?, top_a = ?, min_p = ?,
           repetition_penalty = ?, sampling_preset_name = ?, extra_params = ?,
           voice = ?, speed = ?, format = ?, image_aspect_ratio = ?, image_size = ?
       WHERE id = ?`,
      [
        config.name,
        config.api_key,
        config.model,
        config.max_tokens,
        config.temperature,
        config.top_p,
        config.n,
        config.stop_tokens,
        config.frequency_penalty,
        config.presence_penalty,
        config.max_completion_tokens,
        config.seed,
        config.response_format,
        config.top_k,
        config.top_a,
        config.min_p,
        config.repetition_penalty,
        config.sampling_preset_name,
        config.extra_params,
        config.voice,
        config.speed,
        config.format,
        config.image_aspect_ratio,
        config.image_size,
        config.id,
      ]
    );
    
    if (result.rowsAffected === 0) {
      throw new Error(`OpenRouter provider config not found: ${config.id}`);
    }
  });
}

/**
 * Check if an OpenRouter provider config is in use by any modules
 */
export async function isOpenRouterProviderConfigInUse(id: number): Promise<boolean> {
  return isProviderConfigInUse('openrouter', id);
}

export async function deleteOpenRouterProviderConfig(id: number, permanent = false): Promise<void> {
  const db = getDatabase();
  
  if (!permanent && await isOpenRouterProviderConfigInUse(id)) {
    throw new Error(`OpenRouter provider config ${id} is in use and cannot be soft deleted`);
  }

  return withTransaction(db, async (tx) => {
    if (permanent) {
      const [result] = await tx.executeSql('DELETE FROM provider_config_openrouter WHERE id = ?', [id]);
      if (result.rowsAffected === 0) {
        throw new Error(`OpenRouter provider config not found: ${id}`);
      }
    } else {
      const now = new Date().toISOString();
      const [result] = await tx.executeSql(
        'UPDATE provider_config_openrouter SET deleted_at = ? WHERE id = ?',
        [now, id]
      );
      if (result.rowsAffected === 0) {
        throw new Error(`OpenRouter provider config not found: ${id}`);
      }
    }
  });
}

// ============================================================================
// OpenAI Compatible Provider Config Operations
// ============================================================================

export async function createOpenAICompatibleProviderConfig(
  config: Omit<OpenAICompatibleProviderConfig, 'id' | 'deleted_at'>
): Promise<number> {
  const db = getDatabase();
  
  return new Promise<number>((resolve, reject) => {
    db.transaction(
      (tx) => {
        tx.executeSql(
      `INSERT INTO provider_config_openaicompatible (
        name, base_url, api_key, model, max_tokens, temperature, top_p, n,
        stop_tokens,
        frequency_penalty, presence_penalty, max_completion_tokens,
        seed, response_format,
        top_k, top_a, min_p, repetition_penalty, sampling_preset_name, extra_params
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        config.name,
        config.base_url,
        config.api_key,
        config.model,
        config.max_tokens,
        config.temperature,
        config.top_p,
        config.n,
        config.stop_tokens,
        config.frequency_penalty,
        config.presence_penalty,
        config.max_completion_tokens,
        config.seed,
        config.response_format,
        config.top_k,
        config.top_a,
        config.min_p,
        config.repetition_penalty,
        config.sampling_preset_name,
        config.extra_params,
      ],
          (_, result) => {
            resolve(result.insertId!);
          },
          (_, error) => {
            reject(error);
            return false;
          }
        );
      },
      (error) => reject(error)
    );
  });
}

export async function getOpenAICompatibleProviderConfig(id: number, includeDeleted = false): Promise<OpenAICompatibleProviderConfig | null> {
  const db = getDatabase();
  
  const query = includeDeleted
    ? `SELECT id, name, base_url, api_key, model, max_tokens, temperature, top_p, n,
            stop_tokens,
            frequency_penalty, presence_penalty, max_completion_tokens,
            seed, response_format,
            top_k, top_a, min_p, repetition_penalty, sampling_preset_name, extra_params, deleted_at
     FROM provider_config_openaicompatible WHERE id = ?`
    : `SELECT id, name, base_url, api_key, model, max_tokens, temperature, top_p, n,
            stop_tokens,
            frequency_penalty, presence_penalty, max_completion_tokens,
            seed, response_format,
            top_k, top_a, min_p, repetition_penalty, sampling_preset_name, extra_params, deleted_at
     FROM provider_config_openaicompatible WHERE id = ? AND deleted_at IS NULL`;

  const [results] = await db.executeSql(query, [id]);
  
  if (results.rows.length === 0) {
    return null;
  }
  
  const row = results.rows.item(0);
  return {
    id: row.id,
    name: row.name,
    base_url: row.base_url,
    api_key: row.api_key,
    model: row.model,
    max_tokens: row.max_tokens,
    temperature: row.temperature,
    top_p: row.top_p,
    n: row.n,
    stop_tokens: row.stop_tokens,
    frequency_penalty: row.frequency_penalty,
    presence_penalty: row.presence_penalty,
    max_completion_tokens: row.max_completion_tokens,
    seed: row.seed,
    response_format: row.response_format,
    top_k: row.top_k,
    top_a: row.top_a,
    min_p: row.min_p,
    repetition_penalty: row.repetition_penalty,
    sampling_preset_name: row.sampling_preset_name,
    extra_params: row.extra_params,
    deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
  };
}

export async function getOpenAICompatibleProviderConfigByName(name: string, includeDeleted = false): Promise<OpenAICompatibleProviderConfig | null> {
  const db = getDatabase();
  
  const query = includeDeleted
    ? `SELECT id, name, base_url, api_key, model, max_tokens, temperature, top_p, n,
            stop_tokens,
            frequency_penalty, presence_penalty, max_completion_tokens,
            seed, response_format,
            top_k, top_a, min_p, repetition_penalty, sampling_preset_name, extra_params, deleted_at
     FROM provider_config_openaicompatible WHERE name = ?`
    : `SELECT id, name, base_url, api_key, model, max_tokens, temperature, top_p, n,
            stop_tokens,
            frequency_penalty, presence_penalty, max_completion_tokens,
            seed, response_format,
            top_k, top_a, min_p, repetition_penalty, sampling_preset_name, extra_params, deleted_at
     FROM provider_config_openaicompatible WHERE name = ? AND deleted_at IS NULL`;

  const [results] = await db.executeSql(query, [name]);
  
  if (results.rows.length === 0) {
    return null;
  }
  
  const row = results.rows.item(0);
  return {
    id: row.id,
    name: row.name,
    base_url: row.base_url,
    api_key: row.api_key,
    model: row.model,
    max_tokens: row.max_tokens,
    temperature: row.temperature,
    top_p: row.top_p,
    n: row.n,
    stop_tokens: row.stop_tokens,
    frequency_penalty: row.frequency_penalty,
    presence_penalty: row.presence_penalty,
    max_completion_tokens: row.max_completion_tokens,
    seed: row.seed,
    response_format: row.response_format,
    top_k: row.top_k,
    top_a: row.top_a,
    min_p: row.min_p,
    repetition_penalty: row.repetition_penalty,
    sampling_preset_name: row.sampling_preset_name,
    extra_params: row.extra_params,
    deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
  };
}

export async function getAllOpenAICompatibleProviderConfigs(includeDeleted = false): Promise<OpenAICompatibleProviderConfig[]> {
  const db = getDatabase();
  
  const query = includeDeleted
    ? `SELECT id, name, base_url, api_key, model, max_tokens, temperature, top_p, n,
            stop_tokens,
            frequency_penalty, presence_penalty, max_completion_tokens,
            seed, response_format,
            top_k, top_a, min_p, repetition_penalty, sampling_preset_name, extra_params, deleted_at
     FROM provider_config_openaicompatible ORDER BY name`
    : `SELECT id, name, base_url, api_key, model, max_tokens, temperature, top_p, n,
            stop_tokens,
            frequency_penalty, presence_penalty, max_completion_tokens,
            seed, response_format,
            top_k, top_a, min_p, repetition_penalty, sampling_preset_name, extra_params, deleted_at
     FROM provider_config_openaicompatible WHERE deleted_at IS NULL ORDER BY name`;

  const [results] = await db.executeSql(query);
  
  const configs: OpenAICompatibleProviderConfig[] = [];
  for (let i = 0; i < results.rows.length; i++) {
    const row = results.rows.item(i);
    configs.push({
      id: row.id,
      name: row.name,
      base_url: row.base_url,
      api_key: row.api_key,
      model: row.model,
      max_tokens: row.max_tokens,
      temperature: row.temperature,
      top_p: row.top_p,
      n: row.n,
      stop_tokens: row.stop_tokens,
      frequency_penalty: row.frequency_penalty,
      presence_penalty: row.presence_penalty,
      max_completion_tokens: row.max_completion_tokens,
      seed: row.seed,
      response_format: row.response_format,
      top_k: row.top_k,
      top_a: row.top_a,
      min_p: row.min_p,
      repetition_penalty: row.repetition_penalty,
      sampling_preset_name: row.sampling_preset_name,
      extra_params: row.extra_params,
      deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
    });
  }
  
  return configs;
}

export async function updateOpenAICompatibleProviderConfig(config: OpenAICompatibleProviderConfig): Promise<void> {
  const db = getDatabase();
  
  return withTransaction(db, async (tx) => {
    const [result] = await tx.executeSql(
      `UPDATE provider_config_openaicompatible
       SET name = ?, base_url = ?, api_key = ?, model = ?, max_tokens = ?,
           temperature = ?, top_p = ?, n = ?, stop_tokens = ?,
           frequency_penalty = ?, presence_penalty = ?, max_completion_tokens = ?,
           seed = ?, response_format = ?,
           top_k = ?, top_a = ?, min_p = ?, repetition_penalty = ?, sampling_preset_name = ?, extra_params = ?
       WHERE id = ?`,
      [
        config.name,
        config.base_url,
        config.api_key,
        config.model,
        config.max_tokens,
        config.temperature,
        config.top_p,
        config.n,
        config.stop_tokens,
        config.frequency_penalty,
        config.presence_penalty,
        config.max_completion_tokens,
        config.seed,
        config.response_format,
        config.top_k,
        config.top_a,
        config.min_p,
        config.repetition_penalty,
        config.sampling_preset_name,
        config.extra_params,
        config.id,
      ]
    );
    
    if (result.rowsAffected === 0) {
      throw new Error(`OpenAI Compatible provider config not found: ${config.id}`);
    }
  });
}

/**
 * Check if an OpenAI Compatible provider config is in use by any modules
 */
export async function isOpenAICompatibleProviderConfigInUse(id: number): Promise<boolean> {
  return isProviderConfigInUse('openaicompatible', id);
}

export async function deleteOpenAICompatibleProviderConfig(id: number, permanent = false): Promise<void> {
  const db = getDatabase();
  
  if (!permanent && await isOpenAICompatibleProviderConfigInUse(id)) {
    throw new Error(`OpenAI Compatible provider config ${id} is in use and cannot be soft deleted`);
  }

  return withTransaction(db, async (tx) => {
    if (permanent) {
      const [result] = await tx.executeSql('DELETE FROM provider_config_openaicompatible WHERE id = ?', [id]);
      if (result.rowsAffected === 0) {
        throw new Error(`OpenAI Compatible provider config not found: ${id}`);
      }
    } else {
      const now = new Date().toISOString();
      const [result] = await tx.executeSql(
        'UPDATE provider_config_openaicompatible SET deleted_at = ? WHERE id = ?',
        [now, id]
      );
      if (result.rowsAffected === 0) {
        throw new Error(`OpenAI Compatible provider config not found: ${id}`);
      }
    }
  });
}

// ============================================================================
// HarmonySpeech Provider Config Operations
// ============================================================================

export async function createHarmonySpeechProviderConfig(
  config: Omit<HarmonySpeechProviderConfig, 'id' | 'deleted_at'>
): Promise<number> {
  const db = getDatabase();
  
  return new Promise<number>((resolve, reject) => {
    db.transaction(
      (tx) => {
        tx.executeSql(
      `INSERT INTO provider_config_harmonyspeech (
        name, endpoint, model, voice_config_file, format, sample_rate, stream
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        config.name,
        config.endpoint,
        config.model,
        config.voice_config_file,
        config.format,
        config.sample_rate,
        config.stream,
      ],
          (_, result) => {
            resolve(result.insertId!);
          },
          (_, error) => {
            reject(error);
            return false;
          }
        );
      },
      (error) => reject(error)
    );
  });
}

export async function getHarmonySpeechProviderConfig(id: number, includeDeleted = false): Promise<HarmonySpeechProviderConfig | null> {
  const db = getDatabase();
  
  const query = includeDeleted
    ? `SELECT id, name, endpoint, model, voice_config_file, format, sample_rate, stream, deleted_at
     FROM provider_config_harmonyspeech WHERE id = ?`
    : `SELECT id, name, endpoint, model, voice_config_file, format, sample_rate, stream, deleted_at
     FROM provider_config_harmonyspeech WHERE id = ? AND deleted_at IS NULL`;

  const [results] = await db.executeSql(query, [id]);
  
  if (results.rows.length === 0) {
    return null;
  }
  
  const row = results.rows.item(0);
  return {
    id: row.id,
    name: row.name,
    endpoint: row.endpoint,
    model: row.model,
    voice_config_file: row.voice_config_file,
    format: row.format,
    sample_rate: row.sample_rate,
    stream: row.stream,
    deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
  };
}

export async function getHarmonySpeechProviderConfigByName(name: string, includeDeleted = false): Promise<HarmonySpeechProviderConfig | null> {
  const db = getDatabase();
  
  const query = includeDeleted
    ? `SELECT id, name, endpoint, model, voice_config_file, format, sample_rate, stream, deleted_at
     FROM provider_config_harmonyspeech WHERE name = ?`
    : `SELECT id, name, endpoint, model, voice_config_file, format, sample_rate, stream, deleted_at
     FROM provider_config_harmonyspeech WHERE name = ? AND deleted_at IS NULL`;

  const [results] = await db.executeSql(query, [name]);
  
  if (results.rows.length === 0) {
    return null;
  }
  
  const row = results.rows.item(0);
  return {
    id: row.id,
    name: row.name,
    endpoint: row.endpoint,
    model: row.model,
    voice_config_file: row.voice_config_file,
    format: row.format,
    sample_rate: row.sample_rate,
    stream: row.stream,
    deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
  };
}

export async function getAllHarmonySpeechProviderConfigs(includeDeleted = false): Promise<HarmonySpeechProviderConfig[]> {
  const db = getDatabase();
  
  const query = includeDeleted
    ? `SELECT id, name, endpoint, model, voice_config_file, format, sample_rate, stream, deleted_at
     FROM provider_config_harmonyspeech ORDER BY name`
    : `SELECT id, name, endpoint, model, voice_config_file, format, sample_rate, stream, deleted_at
     FROM provider_config_harmonyspeech WHERE deleted_at IS NULL ORDER BY name`;

  const [results] = await db.executeSql(query);
  
  const configs: HarmonySpeechProviderConfig[] = [];
  for (let i = 0; i < results.rows.length; i++) {
    const row = results.rows.item(i);
    configs.push({
      id: row.id,
      name: row.name,
      endpoint: row.endpoint,
      model: row.model,
      voice_config_file: row.voice_config_file,
      format: row.format,
      sample_rate: row.sample_rate,
      stream: row.stream,
      deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
    });
  }
  
  return configs;
}

export async function updateHarmonySpeechProviderConfig(config: HarmonySpeechProviderConfig): Promise<void> {
  const db = getDatabase();
  
  return withTransaction(db, async (tx) => {
    const [result] = await tx.executeSql(
      `UPDATE provider_config_harmonyspeech
       SET name = ?, endpoint = ?, model = ?, voice_config_file = ?,
           format = ?, sample_rate = ?, stream = ?
       WHERE id = ?`,
      [
        config.name,
        config.endpoint,
        config.model,
        config.voice_config_file,
        config.format,
        config.sample_rate,
        config.stream,
        config.id,
      ]
    );
    
    if (result.rowsAffected === 0) {
      throw new Error(`HarmonySpeech provider config not found: ${config.id}`);
    }
  });
}

/**
 * Check if a HarmonySpeech provider config is in use by any modules
 */
export async function isHarmonySpeechProviderConfigInUse(id: number): Promise<boolean> {
  return isProviderConfigInUse('harmonyspeech', id);
}

export async function deleteHarmonySpeechProviderConfig(id: number, permanent = false): Promise<void> {
  const db = getDatabase();
  
  if (!permanent && await isHarmonySpeechProviderConfigInUse(id)) {
    throw new Error(`HarmonySpeech provider config ${id} is in use and cannot be soft deleted`);
  }

  return withTransaction(db, async (tx) => {
    if (permanent) {
      const [result] = await tx.executeSql('DELETE FROM provider_config_harmonyspeech WHERE id = ?', [id]);
      if (result.rowsAffected === 0) {
        throw new Error(`HarmonySpeech provider config not found: ${id}`);
      }
    } else {
      const now = new Date().toISOString();
      const [result] = await tx.executeSql(
        'UPDATE provider_config_harmonyspeech SET deleted_at = ? WHERE id = ?',
        [now, id]
      );
      if (result.rowsAffected === 0) {
        throw new Error(`HarmonySpeech provider config not found: ${id}`);
      }
    }
  });
}

// ============================================================================
// ElevenLabs Provider Config Operations
// ============================================================================

export async function createElevenLabsProviderConfig(
  config: Omit<ElevenLabsProviderConfig, 'id' | 'deleted_at'>
): Promise<number> {
  const db = getDatabase();
  
  return new Promise<number>((resolve, reject) => {
    db.transaction(
      (tx) => {
        tx.executeSql(
      `INSERT INTO provider_config_elevenlabs (
        name, api_key, voice_id, model_id, stability, similarity_boost, style, speaker_boost
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        config.name,
        config.api_key,
        config.voice_id,
        config.model_id,
        config.stability,
        config.similarity_boost,
        config.style,
        config.speaker_boost,
      ],
          (_, result) => {
            resolve(result.insertId!);
          },
          (_, error) => {
            reject(error);
            return false;
          }
        );
      },
      (error) => reject(error)
    );
  });
}

export async function getElevenLabsProviderConfig(id: number, includeDeleted = false): Promise<ElevenLabsProviderConfig | null> {
  const db = getDatabase();
  
  const query = includeDeleted
    ? `SELECT id, name, api_key, voice_id, model_id, stability, similarity_boost, style, speaker_boost, deleted_at
     FROM provider_config_elevenlabs WHERE id = ?`
    : `SELECT id, name, api_key, voice_id, model_id, stability, similarity_boost, style, speaker_boost, deleted_at
     FROM provider_config_elevenlabs WHERE id = ? AND deleted_at IS NULL`;

  const [results] = await db.executeSql(query, [id]);
  
  if (results.rows.length === 0) {
    return null;
  }
  
  const row = results.rows.item(0);
  return {
    id: row.id,
    name: row.name,
    api_key: row.api_key,
    voice_id: row.voice_id,
    model_id: row.model_id,
    stability: row.stability,
    similarity_boost: row.similarity_boost,
    style: row.style,
    speaker_boost: row.speaker_boost,
    deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
  };
}

export async function getElevenLabsProviderConfigByName(name: string, includeDeleted = false): Promise<ElevenLabsProviderConfig | null> {
  const db = getDatabase();
  
  const query = includeDeleted
    ? `SELECT id, name, api_key, voice_id, model_id, stability, similarity_boost, style, speaker_boost, deleted_at
     FROM provider_config_elevenlabs WHERE name = ?`
    : `SELECT id, name, api_key, voice_id, model_id, stability, similarity_boost, style, speaker_boost, deleted_at
     FROM provider_config_elevenlabs WHERE name = ? AND deleted_at IS NULL`;

  const [results] = await db.executeSql(query, [name]);
  
  if (results.rows.length === 0) {
    return null;
  }
  
  const row = results.rows.item(0);
  return {
    id: row.id,
    name: row.name,
    api_key: row.api_key,
    voice_id: row.voice_id,
    model_id: row.model_id,
    stability: row.stability,
    similarity_boost: row.similarity_boost,
    style: row.style,
    speaker_boost: row.speaker_boost,
    deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
  };
}

export async function getAllElevenLabsProviderConfigs(includeDeleted = false): Promise<ElevenLabsProviderConfig[]> {
  const db = getDatabase();
  
  const query = includeDeleted
    ? `SELECT id, name, api_key, voice_id, model_id, stability, similarity_boost, style, speaker_boost, deleted_at
     FROM provider_config_elevenlabs ORDER BY name`
    : `SELECT id, name, api_key, voice_id, model_id, stability, similarity_boost, style, speaker_boost, deleted_at
     FROM provider_config_elevenlabs WHERE deleted_at IS NULL ORDER BY name`;

  const [results] = await db.executeSql(query);
  
  const configs: ElevenLabsProviderConfig[] = [];
  for (let i = 0; i < results.rows.length; i++) {
    const row = results.rows.item(i);
    configs.push({
      id: row.id,
      name: row.name,
      api_key: row.api_key,
      voice_id: row.voice_id,
      model_id: row.model_id,
      stability: row.stability,
      similarity_boost: row.similarity_boost,
      style: row.style,
      speaker_boost: row.speaker_boost,
      deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
    });
  }
  
  return configs;
}

export async function updateElevenLabsProviderConfig(config: ElevenLabsProviderConfig): Promise<void> {
  const db = getDatabase();
  
  return withTransaction(db, async (tx) => {
    const [result] = await tx.executeSql(
      `UPDATE provider_config_elevenlabs
       SET name = ?, api_key = ?, voice_id = ?, model_id = ?, stability = ?,
           similarity_boost = ?, style = ?, speaker_boost = ?
       WHERE id = ?`,
      [
        config.name,
        config.api_key,
        config.voice_id,
        config.model_id,
        config.stability,
        config.similarity_boost,
        config.style,
        config.speaker_boost,
        config.id,
      ]
    );
    
    if (result.rowsAffected === 0) {
      throw new Error(`ElevenLabs provider config not found: ${config.id}`);
    }
  });
}

/**
 * Check if an ElevenLabs provider config is in use by any modules
 */
export async function isElevenLabsProviderConfigInUse(id: number): Promise<boolean> {
  return isProviderConfigInUse('elevenlabs', id);
}

export async function deleteElevenLabsProviderConfig(id: number, permanent = false): Promise<void> {
  const db = getDatabase();
  
  if (!permanent && await isElevenLabsProviderConfigInUse(id)) {
    throw new Error(`ElevenLabs provider config ${id} is in use and cannot be soft deleted`);
  }

  return withTransaction(db, async (tx) => {
    if (permanent) {
      const [result] = await tx.executeSql('DELETE FROM provider_config_elevenlabs WHERE id = ?', [id]);
      if (result.rowsAffected === 0) {
        throw new Error(`ElevenLabs provider config not found: ${id}`);
      }
    } else {
      const now = new Date().toISOString();
      const [result] = await tx.executeSql(
        'UPDATE provider_config_elevenlabs SET deleted_at = ? WHERE id = ?',
        [now, id]
      );
      if (result.rowsAffected === 0) {
        throw new Error(`ElevenLabs provider config not found: ${id}`);
      }
    }
  });
}

// ============================================================================
// Kindroid Provider Config Operations
// ============================================================================

export async function createKindroidProviderConfig(
  config: Omit<KindroidProviderConfig, 'id' | 'deleted_at'>
): Promise<number> {
  const db = getDatabase();
  
  return new Promise<number>((resolve, reject) => {
    db.transaction(
      (tx) => {
        tx.executeSql(
      `INSERT INTO provider_config_kindroid (name, api_key, kindroid_id)
       VALUES (?, ?, ?)`,
      [config.name, config.api_key, config.kindroid_id],
          (_, result) => {
            resolve(result.insertId!);
          },
          (_, error) => {
            reject(error);
            return false;
          }
        );
      },
      (error) => reject(error)
    );
  });
}

export async function getKindroidProviderConfig(id: number, includeDeleted = false): Promise<KindroidProviderConfig | null> {
  const db = getDatabase();
  
  const query = includeDeleted
    ? 'SELECT id, name, api_key, kindroid_id, deleted_at FROM provider_config_kindroid WHERE id = ?'
    : 'SELECT id, name, api_key, kindroid_id, deleted_at FROM provider_config_kindroid WHERE id = ? AND deleted_at IS NULL';

  const [results] = await db.executeSql(query, [id]);
  
  if (results.rows.length === 0) {
    return null;
  }
  
  const row = results.rows.item(0);
  return {
    id: row.id,
    name: row.name,
    api_key: row.api_key,
    kindroid_id: row.kindroid_id,
    deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
  };
}

export async function getKindroidProviderConfigByName(name: string, includeDeleted = false): Promise<KindroidProviderConfig | null> {
  const db = getDatabase();
  
  const query = includeDeleted
    ? 'SELECT id, name, api_key, kindroid_id, deleted_at FROM provider_config_kindroid WHERE name = ?'
    : 'SELECT id, name, api_key, kindroid_id, deleted_at FROM provider_config_kindroid WHERE name = ? AND deleted_at IS NULL';

  const [results] = await db.executeSql(query, [name]);
  
  if (results.rows.length === 0) {
    return null;
  }
  
  const row = results.rows.item(0);
  return {
    id: row.id,
    name: row.name,
    api_key: row.api_key,
    kindroid_id: row.kindroid_id,
    deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
  };
}

export async function getAllKindroidProviderConfigs(includeDeleted = false): Promise<KindroidProviderConfig[]> {
  const db = getDatabase();
  
  const query = includeDeleted
    ? 'SELECT id, name, api_key, kindroid_id, deleted_at FROM provider_config_kindroid ORDER BY name'
    : 'SELECT id, name, api_key, kindroid_id, deleted_at FROM provider_config_kindroid WHERE deleted_at IS NULL ORDER BY name';

  const [results] = await db.executeSql(query);
  
  const configs: KindroidProviderConfig[] = [];
  for (let i = 0; i < results.rows.length; i++) {
    const row = results.rows.item(i);
    configs.push({
      id: row.id,
      name: row.name,
      api_key: row.api_key,
      kindroid_id: row.kindroid_id,
      deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
    });
  }
  
  return configs;
}

export async function updateKindroidProviderConfig(config: KindroidProviderConfig): Promise<void> {
  const db = getDatabase();
  
  return withTransaction(db, async (tx) => {
    const [result] = await tx.executeSql(
      'UPDATE provider_config_kindroid SET name = ?, api_key = ?, kindroid_id = ? WHERE id = ?',
      [config.name, config.api_key, config.kindroid_id, config.id]
    );
    
    if (result.rowsAffected === 0) {
      throw new Error(`Kindroid provider config not found: ${config.id}`);
    }
  });
}

/**
 * Check if a Kindroid provider config is in use by any modules
 */
export async function isKindroidProviderConfigInUse(id: number): Promise<boolean> {
  return isProviderConfigInUse('kindroid', id);
}

export async function deleteKindroidProviderConfig(id: number, permanent = false): Promise<void> {
  const db = getDatabase();
  
  if (!permanent && await isKindroidProviderConfigInUse(id)) {
    throw new Error(`Kindroid provider config ${id} is in use and cannot be soft deleted`);
  }

  return withTransaction(db, async (tx) => {
    if (permanent) {
      const [result] = await tx.executeSql('DELETE FROM provider_config_kindroid WHERE id = ?', [id]);
      if (result.rowsAffected === 0) {
        throw new Error(`Kindroid provider config not found: ${id}`);
      }
    } else {
      const now = new Date().toISOString();
      const [result] = await tx.executeSql(
        'UPDATE provider_config_kindroid SET deleted_at = ? WHERE id = ?',
        [now, id]
      );
      if (result.rowsAffected === 0) {
        throw new Error(`Kindroid provider config not found: ${id}`);
      }
    }
  });
}

// ============================================================================
// Kajiwoto Provider Config Operations
// ============================================================================

export async function createKajiwotoProviderConfig(
  config: Omit<KajiwotoProviderConfig, 'id' | 'deleted_at'>
): Promise<number> {
  const db = getDatabase();
  
  return new Promise<number>((resolve, reject) => {
    db.transaction(
      (tx) => {
        tx.executeSql(
      `INSERT INTO provider_config_kajiwoto (name, username, password, room_url)
       VALUES (?, ?, ?, ?)`,
      [config.name, config.username, config.password, config.room_url],
          (_, result) => {
            resolve(result.insertId!);
          },
          (_, error) => {
            reject(error);
            return false;
          }
        );
      },
      (error) => reject(error)
    );
  });
}

export async function getKajiwotoProviderConfig(id: number, includeDeleted = false): Promise<KajiwotoProviderConfig | null> {
  const db = getDatabase();
  
  const query = includeDeleted
    ? 'SELECT id, name, username, password, room_url, deleted_at FROM provider_config_kajiwoto WHERE id = ?'
    : 'SELECT id, name, username, password, room_url, deleted_at FROM provider_config_kajiwoto WHERE id = ? AND deleted_at IS NULL';

  const [results] = await db.executeSql(query, [id]);
  
  if (results.rows.length === 0) {
    return null;
  }
  
  const row = results.rows.item(0);
  return {
    id: row.id,
    name: row.name,
    username: row.username,
    password: row.password,
    room_url: row.room_url,
    deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
  };
}

export async function getKajiwotoProviderConfigByName(name: string, includeDeleted = false): Promise<KajiwotoProviderConfig | null> {
  const db = getDatabase();
  
  const query = includeDeleted
    ? 'SELECT id, name, username, password, room_url, deleted_at FROM provider_config_kajiwoto WHERE name = ?'
    : 'SELECT id, name, username, password, room_url, deleted_at FROM provider_config_kajiwoto WHERE name = ? AND deleted_at IS NULL';

  const [results] = await db.executeSql(query, [name]);
  
  if (results.rows.length === 0) {
    return null;
  }
  
  const row = results.rows.item(0);
  return {
    id: row.id,
    name: row.name,
    username: row.username,
    password: row.password,
    room_url: row.room_url,
    deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
  };
}

export async function getAllKajiwotoProviderConfigs(includeDeleted = false): Promise<KajiwotoProviderConfig[]> {
  const db = getDatabase();
  
  const query = includeDeleted
    ? 'SELECT id, name, username, password, room_url, deleted_at FROM provider_config_kajiwoto ORDER BY name'
    : 'SELECT id, name, username, password, room_url, deleted_at FROM provider_config_kajiwoto WHERE deleted_at IS NULL ORDER BY name';

  const [results] = await db.executeSql(query);
  
  const configs: KajiwotoProviderConfig[] = [];
  for (let i = 0; i < results.rows.length; i++) {
    const row = results.rows.item(i);
    configs.push({
      id: row.id,
      name: row.name,
      username: row.username,
      password: row.password,
      room_url: row.room_url,
      deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
    });
  }
  
  return configs;
}

export async function updateKajiwotoProviderConfig(config: KajiwotoProviderConfig): Promise<void> {
  const db = getDatabase();
  
  return withTransaction(db, async (tx) => {
    const [result] = await tx.executeSql(
      `UPDATE provider_config_kajiwoto
       SET name = ?, username = ?, password = ?, room_url = ?
       WHERE id = ?`,
      [config.name, config.username, config.password, config.room_url, config.id]
    );
    
    if (result.rowsAffected === 0) {
      throw new Error(`Kajiwoto provider config not found: ${config.id}`);
    }
  });
}

/**
 * Check if a Kajiwoto provider config is in use by any modules
 */
export async function isKajiwotoProviderConfigInUse(id: number): Promise<boolean> {
  return isProviderConfigInUse('kajiwoto', id);
}

export async function deleteKajiwotoProviderConfig(id: number, permanent = false): Promise<void> {
  const db = getDatabase();
  
  if (!permanent && await isKajiwotoProviderConfigInUse(id)) {
    throw new Error(`Kajiwoto provider config ${id} is in use and cannot be soft deleted`);
  }

  return withTransaction(db, async (tx) => {
    if (permanent) {
      const [result] = await tx.executeSql('DELETE FROM provider_config_kajiwoto WHERE id = ?', [id]);
      if (result.rowsAffected === 0) {
        throw new Error(`Kajiwoto provider config not found: ${id}`);
      }
    } else {
      const now = new Date().toISOString();
      const [result] = await tx.executeSql(
        'UPDATE provider_config_kajiwoto SET deleted_at = ? WHERE id = ?',
        [now, id]
      );
      if (result.rowsAffected === 0) {
        throw new Error(`Kajiwoto provider config not found: ${id}`);
      }
    }
  });
}

// ============================================================================
// CharacterAI Provider Config Operations
// ============================================================================

export async function createCharacterAIProviderConfig(
  config: Omit<CharacterAIProviderConfig, 'id' | 'deleted_at'>
): Promise<number> {
  const db = getDatabase();
  
  return new Promise<number>((resolve, reject) => {
    db.transaction(
      (tx) => {
        tx.executeSql(
      `INSERT INTO provider_config_characterai (name, api_token, chatroom_url)
       VALUES (?, ?, ?)`,
      [config.name, config.api_token, config.chatroom_url],
          (_, result) => {
            resolve(result.insertId!);
          },
          (_, error) => {
            reject(error);
            return false;
          }
        );
      },
      (error) => reject(error)
    );
  });
}

export async function getCharacterAIProviderConfig(id: number, includeDeleted = false): Promise<CharacterAIProviderConfig | null> {
  const db = getDatabase();
  
  const query = includeDeleted
    ? 'SELECT id, name, api_token, chatroom_url, deleted_at FROM provider_config_characterai WHERE id = ?'
    : 'SELECT id, name, api_token, chatroom_url, deleted_at FROM provider_config_characterai WHERE id = ? AND deleted_at IS NULL';

  const [results] = await db.executeSql(query, [id]);
  
  if (results.rows.length === 0) {
    return null;
  }
  
  const row = results.rows.item(0);
  return {
    id: row.id,
    name: row.name,
    api_token: row.api_token,
    chatroom_url: row.chatroom_url,
    deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
  };
}

export async function getCharacterAIProviderConfigByName(name: string, includeDeleted = false): Promise<CharacterAIProviderConfig | null> {
  const db = getDatabase();
  
  const query = includeDeleted
    ? 'SELECT id, name, api_token, chatroom_url, deleted_at FROM provider_config_characterai WHERE name = ?'
    : 'SELECT id, name, api_token, chatroom_url, deleted_at FROM provider_config_characterai WHERE name = ? AND deleted_at IS NULL';

  const [results] = await db.executeSql(query, [name]);
  
  if (results.rows.length === 0) {
    return null;
  }
  
  const row = results.rows.item(0);
  return {
    id: row.id,
    name: row.name,
    api_token: row.api_token,
    chatroom_url: row.chatroom_url,
    deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
  };
}

export async function getAllCharacterAIProviderConfigs(includeDeleted = false): Promise<CharacterAIProviderConfig[]> {
  const db = getDatabase();
  
  const query = includeDeleted
    ? 'SELECT id, name, api_token, chatroom_url, deleted_at FROM provider_config_characterai ORDER BY name'
    : 'SELECT id, name, api_token, chatroom_url, deleted_at FROM provider_config_characterai WHERE deleted_at IS NULL ORDER BY name';

  const [results] = await db.executeSql(query);
  
  const configs: CharacterAIProviderConfig[] = [];
  for (let i = 0; i < results.rows.length; i++) {
    const row = results.rows.item(i);
    configs.push({
      id: row.id,
      name: row.name,
      api_token: row.api_token,
      chatroom_url: row.chatroom_url,
      deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
    });
  }
  
  return configs;
}

export async function updateCharacterAIProviderConfig(config: CharacterAIProviderConfig): Promise<void> {
  const db = getDatabase();
  
  return withTransaction(db, async (tx) => {
    const [result] = await tx.executeSql(
      `UPDATE provider_config_characterai
       SET name = ?, api_token = ?, chatroom_url = ?
       WHERE id = ?`,
      [config.name, config.api_token, config.chatroom_url, config.id]
    );
    
    if (result.rowsAffected === 0) {
      throw new Error(`CharacterAI provider config not found: ${config.id}`);
    }
  });
}

/**
 * Check if a CharacterAI provider config is in use by any modules
 */
export async function isCharacterAIProviderConfigInUse(id: number): Promise<boolean> {
  return isProviderConfigInUse('characterai', id);
}

export async function deleteCharacterAIProviderConfig(id: number, permanent = false): Promise<void> {
  const db = getDatabase();
  
  if (!permanent && await isCharacterAIProviderConfigInUse(id)) {
    throw new Error(`CharacterAI provider config ${id} is in use and cannot be soft deleted`);
  }

  return withTransaction(db, async (tx) => {
    if (permanent) {
      const [result] = await tx.executeSql('DELETE FROM provider_config_characterai WHERE id = ?', [id]);
      if (result.rowsAffected === 0) {
        throw new Error(`CharacterAI provider config not found: ${id}`);
      }
    } else {
      const now = new Date().toISOString();
      const [result] = await tx.executeSql(
        'UPDATE provider_config_characterai SET deleted_at = ? WHERE id = ?',
        [now, id]
      );
      if (result.rowsAffected === 0) {
        throw new Error(`CharacterAI provider config not found: ${id}`);
      }
    }
  });
}

// ============================================================================
// LocalAI Provider Config Operations
// ============================================================================

export async function createLocalAIProviderConfig(
  config: Omit<LocalAIProviderConfig, 'id' | 'deleted_at'>
): Promise<number> {
  const db = getDatabase();
  
  return new Promise<number>((resolve, reject) => {
    db.transaction(
      (tx) => {
        tx.executeSql(
      'INSERT INTO provider_config_localai (name, model) VALUES (?, ?)',
      [config.name, config.model],
          (_, result) => {
            resolve(result.insertId!);
          },
          (_, error) => {
            reject(error);
            return false;
          }
        );
      },
      (error) => reject(error)
    );
  });
}

export async function getLocalAIProviderConfig(id: number, includeDeleted = false): Promise<LocalAIProviderConfig | null> {
  const db = getDatabase();
  
  const query = includeDeleted
    ? 'SELECT id, name, model, deleted_at FROM provider_config_localai WHERE id = ?'
    : 'SELECT id, name, model, deleted_at FROM provider_config_localai WHERE id = ? AND deleted_at IS NULL';

  const [results] = await db.executeSql(query, [id]);
  
  if (results.rows.length === 0) {
    return null;
  }
  
  const row = results.rows.item(0);
  return {
    id: row.id,
    name: row.name,
    model: row.model,
    deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
  };
}

export async function getLocalAIProviderConfigByName(name: string, includeDeleted = false): Promise<LocalAIProviderConfig | null> {
  const db = getDatabase();
  
  const query = includeDeleted
    ? 'SELECT id, name, model, deleted_at FROM provider_config_localai WHERE name = ?'
    : 'SELECT id, name, model, deleted_at FROM provider_config_localai WHERE name = ? AND deleted_at IS NULL';

  const [results] = await db.executeSql(query, [name]);
  
  if (results.rows.length === 0) {
    return null;
  }
  
  const row = results.rows.item(0);
  return {
    id: row.id,
    name: row.name,
    model: row.model,
    deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
  };
}

export async function getAllLocalAIProviderConfigs(includeDeleted = false): Promise<LocalAIProviderConfig[]> {
  const db = getDatabase();
  
  const query = includeDeleted
    ? 'SELECT id, name, model, deleted_at FROM provider_config_localai ORDER BY name'
    : 'SELECT id, name, model, deleted_at FROM provider_config_localai WHERE deleted_at IS NULL ORDER BY name';

  const [results] = await db.executeSql(query);
  
  const configs: LocalAIProviderConfig[] = [];
  for (let i = 0; i < results.rows.length; i++) {
    const row = results.rows.item(i);
    configs.push({
      id: row.id,
      name: row.name,
      model: row.model,
      deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
    });
  }
  
  return configs;
}

export async function updateLocalAIProviderConfig(config: LocalAIProviderConfig): Promise<void> {
  const db = getDatabase();
  
  return withTransaction(db, async (tx) => {
    const [result] = await tx.executeSql(
      'UPDATE provider_config_localai SET name = ?, model = ? WHERE id = ?',
      [config.name, config.model, config.id]
    );
    
    if (result.rowsAffected === 0) {
      throw new Error(`LocalAI provider config not found: ${config.id}`);
    }
  });
}

/**
 * Check if a LocalAI provider config is in use by any modules
 */
export async function isLocalAIProviderConfigInUse(id: number): Promise<boolean> {
  return isProviderConfigInUse('localai', id);
}

export async function deleteLocalAIProviderConfig(id: number, permanent = false): Promise<void> {
  const db = getDatabase();
  
  if (!permanent && await isLocalAIProviderConfigInUse(id)) {
    throw new Error(`LocalAI provider config ${id} is in use and cannot be soft deleted`);
  }

  return withTransaction(db, async (tx) => {
    if (permanent) {
      const [result] = await tx.executeSql('DELETE FROM provider_config_localai WHERE id = ?', [id]);
      if (result.rowsAffected === 0) {
        throw new Error(`LocalAI provider config not found: ${id}`);
      }
    } else {
      const now = new Date().toISOString();
      const [result] = await tx.executeSql(
        'UPDATE provider_config_localai SET deleted_at = ? WHERE id = ?',
        [now, id]
      );
      if (result.rowsAffected === 0) {
        throw new Error(`LocalAI provider config not found: ${id}`);
      }
    }
  });
}

// ============================================================================
// Mistral Provider Config Operations
// ============================================================================

export async function createMistralProviderConfig(
  config: Omit<MistralProviderConfig, 'id' | 'deleted_at'>
): Promise<number> {
  const db = getDatabase();
  
  return new Promise<number>((resolve, reject) => {
    db.transaction(
      (tx) => {
        tx.executeSql(
      'INSERT INTO provider_config_mistral (name, api_key) VALUES (?, ?)',
      [config.name, config.api_key],
          (_, result) => {
            resolve(result.insertId!);
          },
          (_, error) => {
            reject(error);
            return false;
          }
        );
      },
      (error) => reject(error)
    );
  });
}

export async function getMistralProviderConfig(id: number, includeDeleted = false): Promise<MistralProviderConfig | null> {
  const db = getDatabase();
  
  const query = includeDeleted
    ? 'SELECT id, name, api_key, deleted_at FROM provider_config_mistral WHERE id = ?'
    : 'SELECT id, name, api_key, deleted_at FROM provider_config_mistral WHERE id = ? AND deleted_at IS NULL';

  const [results] = await db.executeSql(query, [id]);
  
  if (results.rows.length === 0) {
    return null;
  }
  
  const row = results.rows.item(0);
  return {
    id: row.id,
    name: row.name,
    api_key: row.api_key,
    deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
  };
}

export async function getMistralProviderConfigByName(name: string, includeDeleted = false): Promise<MistralProviderConfig | null> {
  const db = getDatabase();
  
  const query = includeDeleted
    ? 'SELECT id, name, api_key, deleted_at FROM provider_config_mistral WHERE name = ?'
    : 'SELECT id, name, api_key, deleted_at FROM provider_config_mistral WHERE name = ? AND deleted_at IS NULL';

  const [results] = await db.executeSql(query, [name]);
  
  if (results.rows.length === 0) {
    return null;
  }
  
  const row = results.rows.item(0);
  return {
    id: row.id,
    name: row.name,
    api_key: row.api_key,
    deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
  };
}

export async function getAllMistralProviderConfigs(includeDeleted = false): Promise<MistralProviderConfig[]> {
  const db = getDatabase();
  
  const query = includeDeleted
    ? 'SELECT id, name, api_key, deleted_at FROM provider_config_mistral ORDER BY name'
    : 'SELECT id, name, api_key, deleted_at FROM provider_config_mistral WHERE deleted_at IS NULL ORDER BY name';

  const [results] = await db.executeSql(query);
  
  const configs: MistralProviderConfig[] = [];
  for (let i = 0; i < results.rows.length; i++) {
    const row = results.rows.item(i);
    configs.push({
      id: row.id,
      name: row.name,
      api_key: row.api_key,
      deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
    });
  }
  
  return configs;
}

export async function updateMistralProviderConfig(config: MistralProviderConfig): Promise<void> {
  const db = getDatabase();
  
  return withTransaction(db, async (tx) => {
    const [result] = await tx.executeSql(
      'UPDATE provider_config_mistral SET name = ?, api_key = ? WHERE id = ?',
      [config.name, config.api_key, config.id]
    );
    
    if (result.rowsAffected === 0) {
      throw new Error(`Mistral provider config not found: ${config.id}`);
    }
  });
}

/**
 * Check if a Mistral provider config is in use by any modules
 */
export async function isMistralProviderConfigInUse(id: number): Promise<boolean> {
  return isProviderConfigInUse('mistral', id);
}

export async function deleteMistralProviderConfig(id: number, permanent = false): Promise<void> {
  const db = getDatabase();
  
  if (!permanent && await isMistralProviderConfigInUse(id)) {
    throw new Error(`Mistral provider config ${id} is in use and cannot be soft deleted`);
  }

  return withTransaction(db, async (tx) => {
    if (permanent) {
      const [result] = await tx.executeSql('DELETE FROM provider_config_mistral WHERE id = ?', [id]);
      if (result.rowsAffected === 0) {
        throw new Error(`Mistral provider config not found: ${id}`);
      }
    } else {
      const now = new Date().toISOString();
      const [result] = await tx.executeSql(
        'UPDATE provider_config_mistral SET deleted_at = ? WHERE id = ?',
        [now, id]
      );
      if (result.rowsAffected === 0) {
        throw new Error(`Mistral provider config not found: ${id}`);
      }
    }
  });
}

// ============================================================================
// Ollama Provider Config Operations
// ============================================================================

export async function createOllamaProviderConfig(
  config: Omit<OllamaProviderConfig, 'id' | 'deleted_at'>
): Promise<number> {
  const db = getDatabase();
  
  return new Promise<number>((resolve, reject) => {
    db.transaction(
      (tx) => {
        tx.executeSql(
      'INSERT INTO provider_config_ollama (name, base_url, model) VALUES (?, ?, ?)',
      [config.name, config.base_url, config.model],
          (_, result) => {
            resolve(result.insertId!);
          },
          (_, error) => {
            reject(error);
            return false;
          }
        );
      },
      (error) => reject(error)
    );
  });
}

export async function getOllamaProviderConfig(id: number, includeDeleted = false): Promise<OllamaProviderConfig | null> {
  const db = getDatabase();
  
  const query = includeDeleted
    ? 'SELECT id, name, base_url, model, deleted_at FROM provider_config_ollama WHERE id = ?'
    : 'SELECT id, name, base_url, model, deleted_at FROM provider_config_ollama WHERE id = ? AND deleted_at IS NULL';

  const [results] = await db.executeSql(query, [id]);
  
  if (results.rows.length === 0) {
    return null;
  }
  
  const row = results.rows.item(0);
  return {
    id: row.id,
    name: row.name,
    base_url: row.base_url,
    model: row.model,
    deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
  };
}

export async function getOllamaProviderConfigByName(name: string, includeDeleted = false): Promise<OllamaProviderConfig | null> {
  const db = getDatabase();
  
  const query = includeDeleted
    ? 'SELECT id, name, base_url, model, deleted_at FROM provider_config_ollama WHERE name = ?'
    : 'SELECT id, name, base_url, model, deleted_at FROM provider_config_ollama WHERE name = ? AND deleted_at IS NULL';

  const [results] = await db.executeSql(query, [name]);
  
  if (results.rows.length === 0) {
    return null;
  }
  
  const row = results.rows.item(0);
  return {
    id: row.id,
    name: row.name,
    base_url: row.base_url,
    model: row.model,
    deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
  };
}

export async function getAllOllamaProviderConfigs(includeDeleted = false): Promise<OllamaProviderConfig[]> {
  const db = getDatabase();
  
  const query = includeDeleted
    ? 'SELECT id, name, base_url, model, deleted_at FROM provider_config_ollama ORDER BY name'
    : 'SELECT id, name, base_url, model, deleted_at FROM provider_config_ollama WHERE deleted_at IS NULL ORDER BY name';

  const [results] = await db.executeSql(query);
  
  const configs: OllamaProviderConfig[] = [];
  for (let i = 0; i < results.rows.length; i++) {
    const row = results.rows.item(i);
    configs.push({
      id: row.id,
      name: row.name,
      base_url: row.base_url,
      model: row.model,
      deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
    });
  }
  
  return configs;
}

export async function updateOllamaProviderConfig(config: OllamaProviderConfig): Promise<void> {
  const db = getDatabase();
  
  return withTransaction(db, async (tx) => {
    const [result] = await tx.executeSql(
      'UPDATE provider_config_ollama SET name = ?, base_url = ?, model = ? WHERE id = ?',
      [config.name, config.base_url, config.model, config.id]
    );
    
    if (result.rowsAffected === 0) {
      throw new Error(`Ollama provider config not found: ${config.id}`);
    }
  });
}

/**
 * Check if an Ollama provider config is in use by any modules
 */
export async function isOllamaProviderConfigInUse(id: number): Promise<boolean> {
  return isProviderConfigInUse('ollama', id);
}

export async function deleteOllamaProviderConfig(id: number, permanent = false): Promise<void> {
  const db = getDatabase();
  
  if (!permanent && await isOllamaProviderConfigInUse(id)) {
    throw new Error(`Ollama provider config ${id} is in use and cannot be soft deleted`);
  }

  return withTransaction(db, async (tx) => {
    if (permanent) {
      const [result] = await tx.executeSql('DELETE FROM provider_config_ollama WHERE id = ?', [id]);
      if (result.rowsAffected === 0) {
        throw new Error(`Ollama provider config not found: ${id}`);
      }
    } else {
      const now = new Date().toISOString();
      const [result] = await tx.executeSql(
        'UPDATE provider_config_ollama SET deleted_at = ? WHERE id = ?',
        [now, id]
      );
      if (result.rowsAffected === 0) {
        throw new Error(`Ollama provider config not found: ${id}`);
      }
    }
  });
}

// ============================================================================
// ComfyUI Provider Config Operations
// ============================================================================

export async function createComfyUIProviderConfig(
  config: Omit<ComfyUIProviderConfig, 'id' | 'deleted_at'>
): Promise<number> {
  const db = getDatabase();

  return new Promise<number>((resolve, reject) => {
    db.transaction(
      (tx) => {
        tx.executeSql(
          `INSERT INTO provider_config_comfyui (name, base_url, api_key, workflow_profiles)
           VALUES (?, ?, ?, ?)`,
          [config.name, config.base_url, config.api_key, config.workflow_profiles],
          (_, result) => {
            resolve(result.insertId!);
          },
          (_, error) => {
            reject(error);
            return false;
          }
        );
      },
      (error) => reject(error)
    );
  });
}

export async function getComfyUIProviderConfig(id: number, includeDeleted = false): Promise<ComfyUIProviderConfig | null> {
  const db = getDatabase();

  const query = includeDeleted
    ? 'SELECT id, name, base_url, api_key, workflow_profiles, deleted_at FROM provider_config_comfyui WHERE id = ?'
    : 'SELECT id, name, base_url, api_key, workflow_profiles, deleted_at FROM provider_config_comfyui WHERE id = ? AND deleted_at IS NULL';

  const [results] = await db.executeSql(query, [id]);

  if (results.rows.length === 0) {
    return null;
  }

  const row = results.rows.item(0);
  return {
    id: row.id,
    name: row.name,
    base_url: row.base_url,
    api_key: row.api_key,
    workflow_profiles: row.workflow_profiles,
    deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
  };
}

export async function getComfyUIProviderConfigByName(name: string, includeDeleted = false): Promise<ComfyUIProviderConfig | null> {
  const db = getDatabase();

  const query = includeDeleted
    ? 'SELECT id, name, base_url, api_key, workflow_profiles, deleted_at FROM provider_config_comfyui WHERE name = ?'
    : 'SELECT id, name, base_url, api_key, workflow_profiles, deleted_at FROM provider_config_comfyui WHERE name = ? AND deleted_at IS NULL';

  const [results] = await db.executeSql(query, [name]);

  if (results.rows.length === 0) {
    return null;
  }

  const row = results.rows.item(0);
  return {
    id: row.id,
    name: row.name,
    base_url: row.base_url,
    api_key: row.api_key,
    workflow_profiles: row.workflow_profiles,
    deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
  };
}

export async function getAllComfyUIProviderConfigs(includeDeleted = false): Promise<ComfyUIProviderConfig[]> {
  const db = getDatabase();

  const query = includeDeleted
    ? 'SELECT id, name, base_url, api_key, workflow_profiles, deleted_at FROM provider_config_comfyui ORDER BY name'
    : 'SELECT id, name, base_url, api_key, workflow_profiles, deleted_at FROM provider_config_comfyui WHERE deleted_at IS NULL ORDER BY name';

  const [results] = await db.executeSql(query);

  const configs: ComfyUIProviderConfig[] = [];
  for (let i = 0; i < results.rows.length; i++) {
    const row = results.rows.item(i);
    configs.push({
      id: row.id,
      name: row.name,
      base_url: row.base_url,
      api_key: row.api_key,
      workflow_profiles: row.workflow_profiles,
      deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
    });
  }

  return configs;
}

export async function updateComfyUIProviderConfig(config: ComfyUIProviderConfig): Promise<void> {
  const db = getDatabase();

  return withTransaction(db, async (tx) => {
    const [result] = await tx.executeSql(
      `UPDATE provider_config_comfyui
       SET name = ?, base_url = ?, api_key = ?, workflow_profiles = ?
       WHERE id = ?`,
      [config.name, config.base_url, config.api_key, config.workflow_profiles, config.id]
    );

    if (result.rowsAffected === 0) {
      throw new Error(`ComfyUI provider config not found: ${config.id}`);
    }
  });
}

/**
 * Check if a ComfyUI provider config is in use by any imagination module configs
 */
export async function isComfyUIProviderConfigInUse(id: number): Promise<boolean> {
  return isProviderConfigInUse('comfyui', id);
}

export async function deleteComfyUIProviderConfig(id: number, permanent = false): Promise<void> {
  const db = getDatabase();

  if (!permanent && await isComfyUIProviderConfigInUse(id)) {
    throw new Error(`ComfyUI provider config ${id} is in use and cannot be soft deleted`);
  }

  return withTransaction(db, async (tx) => {
    if (permanent) {
      const [result] = await tx.executeSql('DELETE FROM provider_config_comfyui WHERE id = ?', [id]);
      if (result.rowsAffected === 0) {
        throw new Error(`ComfyUI provider config not found: ${id}`);
      }
    } else {
      const now = new Date().toISOString();
      const [result] = await tx.executeSql(
        'UPDATE provider_config_comfyui SET deleted_at = ? WHERE id = ?',
        [now, id]
      );
      if (result.rowsAffected === 0) {
        throw new Error(`ComfyUI provider config not found: ${id}`);
      }
    }
  });
}

// ============================================================================
// XAI Provider Config Operations
// ============================================================================

export async function createXAIProviderConfig(
  config: Omit<XAIProviderConfig, 'id' | 'deleted_at'>
): Promise<number> {
  const db = getDatabase();
  
  return new Promise<number>((resolve, reject) => {
    db.transaction(
      (tx) => {
        tx.executeSql(
      `INSERT INTO provider_config_xai (
        name, api_key, model, max_tokens, max_completion_tokens, temperature, top_p,
        frequency_penalty, presence_penalty, n, stop_tokens, seed, response_format,
        reasoning_effort, sampling_preset_name, extra_params, image_aspect_ratio, image_resolution
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        config.name,
        config.api_key,
        config.model,
        config.max_tokens,
        config.max_completion_tokens,
        config.temperature,
        config.top_p,
        config.frequency_penalty,
        config.presence_penalty,
        config.n,
        config.stop_tokens,
        config.seed,
        config.response_format,
        config.reasoning_effort,
        config.sampling_preset_name,
        config.extra_params,
        config.image_aspect_ratio,
        config.image_resolution,
      ],
          (_, result) => {
            resolve(result.insertId!);
          },
          (_, error) => {
            reject(error);
            return false;
          }
        );
      },
      (error) => reject(error)
    );
  });
}

export async function getXAIProviderConfig(id: number, includeDeleted = false): Promise<XAIProviderConfig | null> {
  const db = getDatabase();
  
  const query = includeDeleted
    ? `SELECT id, name, api_key, model, max_tokens, max_completion_tokens, temperature, top_p,
            frequency_penalty, presence_penalty, n, stop_tokens, seed, response_format,
            reasoning_effort, sampling_preset_name, extra_params, image_aspect_ratio, image_resolution, deleted_at
     FROM provider_config_xai WHERE id = ?`
    : `SELECT id, name, api_key, model, max_tokens, max_completion_tokens, temperature, top_p,
            frequency_penalty, presence_penalty, n, stop_tokens, seed, response_format,
            reasoning_effort, sampling_preset_name, extra_params, image_aspect_ratio, image_resolution, deleted_at
     FROM provider_config_xai WHERE id = ? AND deleted_at IS NULL`;

  const [results] = await db.executeSql(query, [id]);
  
  if (results.rows.length === 0) {
    return null;
  }
  
  const row = results.rows.item(0);
  return {
    id: row.id,
    name: row.name,
    api_key: row.api_key,
    model: row.model,
    max_tokens: row.max_tokens,
    max_completion_tokens: row.max_completion_tokens,
    temperature: row.temperature,
    top_p: row.top_p,
    frequency_penalty: row.frequency_penalty,
    presence_penalty: row.presence_penalty,
    n: row.n,
    stop_tokens: row.stop_tokens,
    seed: row.seed,
    response_format: row.response_format,
    reasoning_effort: row.reasoning_effort,
    sampling_preset_name: row.sampling_preset_name,
    extra_params: row.extra_params,
    image_aspect_ratio: row.image_aspect_ratio,
    image_resolution: row.image_resolution,
    deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
  };
}

export async function getXAIProviderConfigByName(name: string, includeDeleted = false): Promise<XAIProviderConfig | null> {
  const db = getDatabase();
  
  const query = includeDeleted
    ? `SELECT id, name, api_key, model, max_tokens, max_completion_tokens, temperature, top_p,
            frequency_penalty, presence_penalty, n, stop_tokens, seed, response_format,
            reasoning_effort, sampling_preset_name, extra_params, image_aspect_ratio, image_resolution, deleted_at
     FROM provider_config_xai WHERE name = ?`
    : `SELECT id, name, api_key, model, max_tokens, max_completion_tokens, temperature, top_p,
            frequency_penalty, presence_penalty, n, stop_tokens, seed, response_format,
            reasoning_effort, sampling_preset_name, extra_params, image_aspect_ratio, image_resolution, deleted_at
     FROM provider_config_xai WHERE name = ? AND deleted_at IS NULL`;

  const [results] = await db.executeSql(query, [name]);
  
  if (results.rows.length === 0) {
    return null;
  }
  
  const row = results.rows.item(0);
  return {
    id: row.id,
    name: row.name,
    api_key: row.api_key,
    model: row.model,
    max_tokens: row.max_tokens,
    max_completion_tokens: row.max_completion_tokens,
    temperature: row.temperature,
    top_p: row.top_p,
    frequency_penalty: row.frequency_penalty,
    presence_penalty: row.presence_penalty,
    n: row.n,
    stop_tokens: row.stop_tokens,
    seed: row.seed,
    response_format: row.response_format,
    reasoning_effort: row.reasoning_effort,
    sampling_preset_name: row.sampling_preset_name,
    extra_params: row.extra_params,
    image_aspect_ratio: row.image_aspect_ratio,
    image_resolution: row.image_resolution,
    deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
  };
}

export async function getAllXAIProviderConfigs(includeDeleted = false): Promise<XAIProviderConfig[]> {
  const db = getDatabase();
  
  const query = includeDeleted
    ? `SELECT id, name, api_key, model, max_tokens, max_completion_tokens, temperature, top_p,
            frequency_penalty, presence_penalty, n, stop_tokens, seed, response_format,
            reasoning_effort, sampling_preset_name, extra_params, image_aspect_ratio, image_resolution, deleted_at
     FROM provider_config_xai ORDER BY name`
    : `SELECT id, name, api_key, model, max_tokens, max_completion_tokens, temperature, top_p,
            frequency_penalty, presence_penalty, n, stop_tokens, seed, response_format,
            reasoning_effort, sampling_preset_name, extra_params, image_aspect_ratio, image_resolution, deleted_at
     FROM provider_config_xai WHERE deleted_at IS NULL ORDER BY name`;

  const [results] = await db.executeSql(query);
  
  const configs: XAIProviderConfig[] = [];
  for (let i = 0; i < results.rows.length; i++) {
    const row = results.rows.item(i);
    configs.push({
      id: row.id,
      name: row.name,
      api_key: row.api_key,
      model: row.model,
      max_tokens: row.max_tokens,
      max_completion_tokens: row.max_completion_tokens,
      temperature: row.temperature,
      top_p: row.top_p,
      frequency_penalty: row.frequency_penalty,
      presence_penalty: row.presence_penalty,
      n: row.n,
      stop_tokens: row.stop_tokens,
      seed: row.seed,
      response_format: row.response_format,
      reasoning_effort: row.reasoning_effort,
      sampling_preset_name: row.sampling_preset_name,
      extra_params: row.extra_params,
      image_aspect_ratio: row.image_aspect_ratio,
      image_resolution: row.image_resolution,
      deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
    });
  }
  
  return configs;
}

export async function updateXAIProviderConfig(config: XAIProviderConfig): Promise<void> {
  const db = getDatabase();
  
  return withTransaction(db, async (tx) => {
    const [result] = await tx.executeSql(
      `UPDATE provider_config_xai
       SET name = ?, api_key = ?, model = ?, max_tokens = ?, max_completion_tokens = ?,
           temperature = ?, top_p = ?,
           frequency_penalty = ?, presence_penalty = ?, n = ?, stop_tokens = ?,
           seed = ?, response_format = ?, reasoning_effort = ?,
           sampling_preset_name = ?, extra_params = ?, image_aspect_ratio = ?, image_resolution = ?
       WHERE id = ?`,
      [
        config.name,
        config.api_key,
        config.model,
        config.max_tokens,
        config.max_completion_tokens,
        config.temperature,
        config.top_p,
        config.frequency_penalty,
        config.presence_penalty,
        config.n,
        config.stop_tokens,
        config.seed,
        config.response_format,
        config.reasoning_effort,
        config.sampling_preset_name,
        config.extra_params,
        config.image_aspect_ratio,
        config.image_resolution,
        config.id,
      ]
    );
    
    if (result.rowsAffected === 0) {
      throw new Error(`XAI provider config not found: ${config.id}`);
    }
  });
}

/**
 * Check if an XAI provider config is in use by any modules
 */
export async function isXAIProviderConfigInUse(id: number): Promise<boolean> {
  return isProviderConfigInUse('xai', id);
}

export async function deleteXAIProviderConfig(id: number, permanent = false): Promise<void> {
  const db = getDatabase();
  
  if (!permanent && await isXAIProviderConfigInUse(id)) {
    throw new Error(`XAI provider config ${id} is in use and cannot be soft deleted`);
  }

  return withTransaction(db, async (tx) => {
    if (permanent) {
      const [result] = await tx.executeSql('DELETE FROM provider_config_xai WHERE id = ?', [id]);
      if (result.rowsAffected === 0) {
        throw new Error(`XAI provider config not found: ${id}`);
      }
    } else {
      const now = new Date().toISOString();
      const [result] = await tx.executeSql(
        'UPDATE provider_config_xai SET deleted_at = ? WHERE id = ?',
        [now, id]
      );
      if (result.rowsAffected === 0) {
        throw new Error(`XAI provider config not found: ${id}`);
      }
    }
  });
}

// ============================================================================
// Google Provider Config Operations
// ============================================================================

export async function createGoogleProviderConfig(
  config: Omit<GoogleProviderConfig, 'id' | 'deleted_at'>
): Promise<number> {
  const db = getDatabase();
  
  return new Promise<number>((resolve, reject) => {
    db.transaction(
      (tx) => {
        tx.executeSql(
      `INSERT INTO provider_config_google (
        name, api_key, model, max_output_tokens, temperature, top_p, top_k,
        stop_tokens, seed, response_mime_type,
        sampling_preset_name, extra_params, number_of_images, aspect_ratio
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        config.name,
        config.api_key,
        config.model,
        config.max_output_tokens,
        config.temperature,
        config.top_p,
        config.top_k,
        config.stop_tokens,
        config.seed,
        config.response_mime_type,
        config.sampling_preset_name,
        config.extra_params,
        config.number_of_images,
        config.aspect_ratio,
      ],
          (_, result) => {
            resolve(result.insertId!);
          },
          (_, error) => {
            reject(error);
            return false;
          }
        );
      },
      (error) => reject(error)
    );
  });
}

export async function getGoogleProviderConfig(id: number, includeDeleted = false): Promise<GoogleProviderConfig | null> {
  const db = getDatabase();
  
  const query = includeDeleted
    ? `SELECT id, name, api_key, model, max_output_tokens, temperature, top_p, top_k,
            stop_tokens, seed, response_mime_type,
            sampling_preset_name, extra_params, number_of_images, aspect_ratio, deleted_at
     FROM provider_config_google WHERE id = ?`
    : `SELECT id, name, api_key, model, max_output_tokens, temperature, top_p, top_k,
            stop_tokens, seed, response_mime_type,
            sampling_preset_name, extra_params, number_of_images, aspect_ratio, deleted_at
     FROM provider_config_google WHERE id = ? AND deleted_at IS NULL`;

  const [results] = await db.executeSql(query, [id]);
  
  if (results.rows.length === 0) {
    return null;
  }
  
  const row = results.rows.item(0);
  return {
    id: row.id,
    name: row.name,
    api_key: row.api_key,
    model: row.model,
    max_output_tokens: row.max_output_tokens,
    temperature: row.temperature,
    top_p: row.top_p,
    top_k: row.top_k,
    stop_tokens: row.stop_tokens,
    seed: row.seed,
    response_mime_type: row.response_mime_type,
    sampling_preset_name: row.sampling_preset_name,
    extra_params: row.extra_params,
    number_of_images: row.number_of_images,
    aspect_ratio: row.aspect_ratio,
    deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
  };
}

export async function getGoogleProviderConfigByName(name: string, includeDeleted = false): Promise<GoogleProviderConfig | null> {
  const db = getDatabase();
  
  const query = includeDeleted
    ? `SELECT id, name, api_key, model, max_output_tokens, temperature, top_p, top_k,
            stop_tokens, seed, response_mime_type,
            sampling_preset_name, extra_params, number_of_images, aspect_ratio, deleted_at
     FROM provider_config_google WHERE name = ?`
    : `SELECT id, name, api_key, model, max_output_tokens, temperature, top_p, top_k,
            stop_tokens, seed, response_mime_type,
            sampling_preset_name, extra_params, number_of_images, aspect_ratio, deleted_at
     FROM provider_config_google WHERE name = ? AND deleted_at IS NULL`;

  const [results] = await db.executeSql(query, [name]);
  
  if (results.rows.length === 0) {
    return null;
  }
  
  const row = results.rows.item(0);
  return {
    id: row.id,
    name: row.name,
    api_key: row.api_key,
    model: row.model,
    max_output_tokens: row.max_output_tokens,
    temperature: row.temperature,
    top_p: row.top_p,
    top_k: row.top_k,
    stop_tokens: row.stop_tokens,
    seed: row.seed,
    response_mime_type: row.response_mime_type,
    sampling_preset_name: row.sampling_preset_name,
    extra_params: row.extra_params,
    number_of_images: row.number_of_images,
    aspect_ratio: row.aspect_ratio,
    deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
  };
}

export async function getAllGoogleProviderConfigs(includeDeleted = false): Promise<GoogleProviderConfig[]> {
  const db = getDatabase();
  
  const query = includeDeleted
    ? `SELECT id, name, api_key, model, max_output_tokens, temperature, top_p, top_k,
            stop_tokens, seed, response_mime_type,
            sampling_preset_name, extra_params, number_of_images, aspect_ratio, deleted_at
     FROM provider_config_google ORDER BY name`
    : `SELECT id, name, api_key, model, max_output_tokens, temperature, top_p, top_k,
            stop_tokens, seed, response_mime_type,
            sampling_preset_name, extra_params, number_of_images, aspect_ratio, deleted_at
     FROM provider_config_google WHERE deleted_at IS NULL ORDER BY name`;

  const [results] = await db.executeSql(query);
  
  const configs: GoogleProviderConfig[] = [];
  for (let i = 0; i < results.rows.length; i++) {
    const row = results.rows.item(i);
    configs.push({
      id: row.id,
      name: row.name,
      api_key: row.api_key,
      model: row.model,
      max_output_tokens: row.max_output_tokens,
      temperature: row.temperature,
      top_p: row.top_p,
      top_k: row.top_k,
      stop_tokens: row.stop_tokens,
      seed: row.seed,
      response_mime_type: row.response_mime_type,
      sampling_preset_name: row.sampling_preset_name,
      extra_params: row.extra_params,
      number_of_images: row.number_of_images,
      aspect_ratio: row.aspect_ratio,
      deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
    });
  }
  
  return configs;
}

export async function updateGoogleProviderConfig(config: GoogleProviderConfig): Promise<void> {
  const db = getDatabase();
  
  return withTransaction(db, async (tx) => {
    const [result] = await tx.executeSql(
      `UPDATE provider_config_google
       SET name = ?, api_key = ?, model = ?, max_output_tokens = ?, temperature = ?,
           top_p = ?, top_k = ?, stop_tokens = ?, seed = ?, response_mime_type = ?,
           sampling_preset_name = ?, extra_params = ?, number_of_images = ?, aspect_ratio = ?
       WHERE id = ?`,
      [
        config.name,
        config.api_key,
        config.model,
        config.max_output_tokens,
        config.temperature,
        config.top_p,
        config.top_k,
        config.stop_tokens,
        config.seed,
        config.response_mime_type,
        config.sampling_preset_name,
        config.extra_params,
        config.number_of_images,
        config.aspect_ratio,
        config.id,
      ]
    );
    
    if (result.rowsAffected === 0) {
      throw new Error(`Google provider config not found: ${config.id}`);
    }
  });
}

/**
 * Check if a Google provider config is in use by any modules
 */
export async function isGoogleProviderConfigInUse(id: number): Promise<boolean> {
  return isProviderConfigInUse('google', id);
}

export async function deleteGoogleProviderConfig(id: number, permanent = false): Promise<void> {
  const db = getDatabase();
  
  if (!permanent && await isGoogleProviderConfigInUse(id)) {
    throw new Error(`Google provider config ${id} is in use and cannot be soft deleted`);
  }

  return withTransaction(db, async (tx) => {
    if (permanent) {
      const [result] = await tx.executeSql('DELETE FROM provider_config_google WHERE id = ?', [id]);
      if (result.rowsAffected === 0) {
        throw new Error(`Google provider config not found: ${id}`);
      }
    } else {
      const now = new Date().toISOString();
      const [result] = await tx.executeSql(
        'UPDATE provider_config_google SET deleted_at = ? WHERE id = ?',
        [now, id]
      );
      if (result.rowsAffected === 0) {
        throw new Error(`Google provider config not found: ${id}`);
      }
    }
  });
}

// ============================================================================
// Anthropic Provider Config Operations
// ============================================================================

export async function createAnthropicProviderConfig(
  config: Omit<AnthropicProviderConfig, 'id' | 'deleted_at'>
): Promise<number> {
  const db = getDatabase();
  
  return new Promise<number>((resolve, reject) => {
    db.transaction(
      (tx) => {
        tx.executeSql(
      `INSERT INTO provider_config_anthropic (
        name, api_key, model, max_tokens, temperature, top_p, top_k,
        stop_sequences, sampling_preset_name, extra_params
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        config.name,
        config.api_key,
        config.model,
        config.max_tokens,
        config.temperature,
        config.top_p,
        config.top_k,
        config.stop_sequences,
        config.sampling_preset_name,
        config.extra_params,
      ],
          (_, result) => {
            resolve(result.insertId!);
          },
          (_, error) => {
            reject(error);
            return false;
          }
        );
      },
      (error) => reject(error)
    );
  });
}

export async function getAnthropicProviderConfig(id: number, includeDeleted = false): Promise<AnthropicProviderConfig | null> {
  const db = getDatabase();
  
  const query = includeDeleted
    ? `SELECT id, name, api_key, model, max_tokens, temperature, top_p, top_k,
            stop_sequences, sampling_preset_name, extra_params, deleted_at
     FROM provider_config_anthropic WHERE id = ?`
    : `SELECT id, name, api_key, model, max_tokens, temperature, top_p, top_k,
            stop_sequences, sampling_preset_name, extra_params, deleted_at
     FROM provider_config_anthropic WHERE id = ? AND deleted_at IS NULL`;

  const [results] = await db.executeSql(query, [id]);
  
  if (results.rows.length === 0) {
    return null;
  }
  
  const row = results.rows.item(0);
  return {
    id: row.id,
    name: row.name,
    api_key: row.api_key,
    model: row.model,
    max_tokens: row.max_tokens,
    temperature: row.temperature,
    top_p: row.top_p,
    top_k: row.top_k,
    stop_sequences: row.stop_sequences,
    sampling_preset_name: row.sampling_preset_name,
    extra_params: row.extra_params,
    deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
  };
}

export async function getAnthropicProviderConfigByName(name: string, includeDeleted = false): Promise<AnthropicProviderConfig | null> {
  const db = getDatabase();
  
  const query = includeDeleted
    ? `SELECT id, name, api_key, model, max_tokens, temperature, top_p, top_k,
            stop_sequences, sampling_preset_name, extra_params, deleted_at
     FROM provider_config_anthropic WHERE name = ?`
    : `SELECT id, name, api_key, model, max_tokens, temperature, top_p, top_k,
            stop_sequences, sampling_preset_name, extra_params, deleted_at
     FROM provider_config_anthropic WHERE name = ? AND deleted_at IS NULL`;

  const [results] = await db.executeSql(query, [name]);
  
  if (results.rows.length === 0) {
    return null;
  }
  
  const row = results.rows.item(0);
  return {
    id: row.id,
    name: row.name,
    api_key: row.api_key,
    model: row.model,
    max_tokens: row.max_tokens,
    temperature: row.temperature,
    top_p: row.top_p,
    top_k: row.top_k,
    stop_sequences: row.stop_sequences,
    sampling_preset_name: row.sampling_preset_name,
    extra_params: row.extra_params,
    deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
  };
}

export async function getAllAnthropicProviderConfigs(includeDeleted = false): Promise<AnthropicProviderConfig[]> {
  const db = getDatabase();
  
  const query = includeDeleted
    ? `SELECT id, name, api_key, model, max_tokens, temperature, top_p, top_k,
            stop_sequences, sampling_preset_name, extra_params, deleted_at
     FROM provider_config_anthropic ORDER BY name`
    : `SELECT id, name, api_key, model, max_tokens, temperature, top_p, top_k,
            stop_sequences, sampling_preset_name, extra_params, deleted_at
     FROM provider_config_anthropic WHERE deleted_at IS NULL ORDER BY name`;

  const [results] = await db.executeSql(query);
  
  const configs: AnthropicProviderConfig[] = [];
  for (let i = 0; i < results.rows.length; i++) {
    const row = results.rows.item(i);
    configs.push({
      id: row.id,
      name: row.name,
      api_key: row.api_key,
      model: row.model,
      max_tokens: row.max_tokens,
      temperature: row.temperature,
      top_p: row.top_p,
      top_k: row.top_k,
      stop_sequences: row.stop_sequences,
      sampling_preset_name: row.sampling_preset_name,
      extra_params: row.extra_params,
      deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
    });
  }
  
  return configs;
}

export async function updateAnthropicProviderConfig(config: AnthropicProviderConfig): Promise<void> {
  const db = getDatabase();
  
  return withTransaction(db, async (tx) => {
    const [result] = await tx.executeSql(
      `UPDATE provider_config_anthropic
       SET name = ?, api_key = ?, model = ?, max_tokens = ?, temperature = ?,
           top_p = ?, top_k = ?, stop_sequences = ?,
           sampling_preset_name = ?, extra_params = ?
       WHERE id = ?`,
      [
        config.name,
        config.api_key,
        config.model,
        config.max_tokens,
        config.temperature,
        config.top_p,
        config.top_k,
        config.stop_sequences,
        config.sampling_preset_name,
        config.extra_params,
        config.id,
      ]
    );
    
    if (result.rowsAffected === 0) {
      throw new Error(`Anthropic provider config not found: ${config.id}`);
    }
  });
}

/**
 * Check if an Anthropic provider config is in use by any modules
 */
export async function isAnthropicProviderConfigInUse(id: number): Promise<boolean> {
  return isProviderConfigInUse('anthropic', id);
}

export async function deleteAnthropicProviderConfig(id: number, permanent = false): Promise<void> {
  const db = getDatabase();
  
  if (!permanent && await isAnthropicProviderConfigInUse(id)) {
    throw new Error(`Anthropic provider config ${id} is in use and cannot be soft deleted`);
  }

  return withTransaction(db, async (tx) => {
    if (permanent) {
      const [result] = await tx.executeSql('DELETE FROM provider_config_anthropic WHERE id = ?', [id]);
      if (result.rowsAffected === 0) {
        throw new Error(`Anthropic provider config not found: ${id}`);
      }
    } else {
      const now = new Date().toISOString();
      const [result] = await tx.executeSql(
        'UPDATE provider_config_anthropic SET deleted_at = ? WHERE id = ?',
        [now, id]
      );
      if (result.rowsAffected === 0) {
        throw new Error(`Anthropic provider config not found: ${id}`);
      }
    }
  });
}
