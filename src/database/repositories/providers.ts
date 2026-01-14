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
} from '../models';

// ============================================================================
// OpenAI Provider Config Operations
// ============================================================================

export async function createOpenAIProviderConfig(
  config: Omit<OpenAIProviderConfig, 'id'>
): Promise<number> {
  const db = getDatabase();
  
  return withTransaction(db, async (tx) => {
    const [result] = await tx.executeSql(
      `INSERT INTO provider_config_openai (
        name, api_key, model, max_tokens, temperature, top_p, n,
        stop_tokens, embedding_model, voice, speed, format
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        config.name,
        config.api_key,
        config.model,
        config.max_tokens,
        config.temperature,
        config.top_p,
        config.n,
        config.stop_tokens,
        config.embedding_model,
        config.voice,
        config.speed,
        config.format,
      ]
    );
    
    return result.insertId!;
  });
}

export async function getOpenAIProviderConfig(id: number): Promise<OpenAIProviderConfig | null> {
  const db = getDatabase();
  
  const [results] = await db.executeSql(
    `SELECT id, name, api_key, model, max_tokens, temperature, top_p, n,
            stop_tokens, embedding_model, voice, speed, format
     FROM provider_config_openai WHERE id = ?`,
    [id]
  );
  
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
    embedding_model: row.embedding_model,
    voice: row.voice,
    speed: row.speed,
    format: row.format,
  };
}

export async function getOpenAIProviderConfigByName(name: string): Promise<OpenAIProviderConfig | null> {
  const db = getDatabase();
  
  const [results] = await db.executeSql(
    `SELECT id, name, api_key, model, max_tokens, temperature, top_p, n,
            stop_tokens, embedding_model, voice, speed, format
     FROM provider_config_openai WHERE name = ?`,
    [name]
  );
  
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
    embedding_model: row.embedding_model,
    voice: row.voice,
    speed: row.speed,
    format: row.format,
  };
}

export async function getAllOpenAIProviderConfigs(): Promise<OpenAIProviderConfig[]> {
  const db = getDatabase();
  
  const [results] = await db.executeSql(
    `SELECT id, name, api_key, model, max_tokens, temperature, top_p, n,
            stop_tokens, embedding_model, voice, speed, format
     FROM provider_config_openai ORDER BY name`
  );
  
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
      embedding_model: row.embedding_model,
      voice: row.voice,
      speed: row.speed,
      format: row.format,
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
           top_p = ?, n = ?, stop_tokens = ?, embedding_model = ?,
           voice = ?, speed = ?, format = ?
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
        config.embedding_model,
        config.voice,
        config.speed,
        config.format,
        config.id,
      ]
    );
    
    if (result.rowsAffected === 0) {
      throw new Error(`OpenAI provider config not found: ${config.id}`);
    }
  });
}

export async function deleteOpenAIProviderConfig(id: number): Promise<void> {
  const db = getDatabase();
  
  return withTransaction(db, async (tx) => {
    const [result] = await tx.executeSql(
      'DELETE FROM provider_config_openai WHERE id = ?',
      [id]
    );
    
    if (result.rowsAffected === 0) {
      throw new Error(`OpenAI provider config not found: ${id}`);
    }
  });
}

// ============================================================================
// OpenRouter Provider Config Operations
// ============================================================================

export async function createOpenRouterProviderConfig(
  config: Omit<OpenRouterProviderConfig, 'id'>
): Promise<number> {
  const db = getDatabase();
  
  return withTransaction(db, async (tx) => {
    const [result] = await tx.executeSql(
      `INSERT INTO provider_config_openrouter (
        name, api_key, model, max_tokens, temperature, top_p, n, stop_tokens
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        config.name,
        config.api_key,
        config.model,
        config.max_tokens,
        config.temperature,
        config.top_p,
        config.n,
        config.stop_tokens,
      ]
    );
    
    return result.insertId!;
  });
}

export async function getOpenRouterProviderConfig(id: number): Promise<OpenRouterProviderConfig | null> {
  const db = getDatabase();
  
  const [results] = await db.executeSql(
    `SELECT id, name, api_key, model, max_tokens, temperature, top_p, n, stop_tokens
     FROM provider_config_openrouter WHERE id = ?`,
    [id]
  );
  
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
  };
}

export async function getOpenRouterProviderConfigByName(name: string): Promise<OpenRouterProviderConfig | null> {
  const db = getDatabase();
  
  const [results] = await db.executeSql(
    `SELECT id, name, api_key, model, max_tokens, temperature, top_p, n, stop_tokens
     FROM provider_config_openrouter WHERE name = ?`,
    [name]
  );
  
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
  };
}

export async function getAllOpenRouterProviderConfigs(): Promise<OpenRouterProviderConfig[]> {
  const db = getDatabase();
  
  const [results] = await db.executeSql(
    `SELECT id, name, api_key, model, max_tokens, temperature, top_p, n, stop_tokens
     FROM provider_config_openrouter ORDER BY name`
  );
  
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
           top_p = ?, n = ?, stop_tokens = ?
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
        config.id,
      ]
    );
    
    if (result.rowsAffected === 0) {
      throw new Error(`OpenRouter provider config not found: ${config.id}`);
    }
  });
}

export async function deleteOpenRouterProviderConfig(id: number): Promise<void> {
  const db = getDatabase();
  
  return withTransaction(db, async (tx) => {
    const [result] = await tx.executeSql(
      'DELETE FROM provider_config_openrouter WHERE id = ?',
      [id]
    );
    
    if (result.rowsAffected === 0) {
      throw new Error(`OpenRouter provider config not found: ${id}`);
    }
  });
}

// ============================================================================
// OpenAI Compatible Provider Config Operations
// ============================================================================

export async function createOpenAICompatibleProviderConfig(
  config: Omit<OpenAICompatibleProviderConfig, 'id'>
): Promise<number> {
  const db = getDatabase();
  
  return withTransaction(db, async (tx) => {
    const [result] = await tx.executeSql(
      `INSERT INTO provider_config_openaicompatible (
        name, base_url, api_key, model, max_tokens, temperature, top_p, n,
        stop_tokens, embedding_model
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        config.embedding_model,
      ]
    );
    
    return result.insertId!;
  });
}

export async function getOpenAICompatibleProviderConfig(id: number): Promise<OpenAICompatibleProviderConfig | null> {
  const db = getDatabase();
  
  const [results] = await db.executeSql(
    `SELECT id, name, base_url, api_key, model, max_tokens, temperature, top_p, n,
            stop_tokens, embedding_model
     FROM provider_config_openaicompatible WHERE id = ?`,
    [id]
  );
  
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
    embedding_model: row.embedding_model,
  };
}

export async function getOpenAICompatibleProviderConfigByName(name: string): Promise<OpenAICompatibleProviderConfig | null> {
  const db = getDatabase();
  
  const [results] = await db.executeSql(
    `SELECT id, name, base_url, api_key, model, max_tokens, temperature, top_p, n,
            stop_tokens, embedding_model
     FROM provider_config_openaicompatible WHERE name = ?`,
    [name]
  );
  
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
    embedding_model: row.embedding_model,
  };
}

export async function getAllOpenAICompatibleProviderConfigs(): Promise<OpenAICompatibleProviderConfig[]> {
  const db = getDatabase();
  
  const [results] = await db.executeSql(
    `SELECT id, name, base_url, api_key, model, max_tokens, temperature, top_p, n,
            stop_tokens, embedding_model
     FROM provider_config_openaicompatible ORDER BY name`
  );
  
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
      embedding_model: row.embedding_model,
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
           temperature = ?, top_p = ?, n = ?, stop_tokens = ?, embedding_model = ?
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
        config.embedding_model,
        config.id,
      ]
    );
    
    if (result.rowsAffected === 0) {
      throw new Error(`OpenAI Compatible provider config not found: ${config.id}`);
    }
  });
}

export async function deleteOpenAICompatibleProviderConfig(id: number): Promise<void> {
  const db = getDatabase();
  
  return withTransaction(db, async (tx) => {
    const [result] = await tx.executeSql(
      'DELETE FROM provider_config_openaicompatible WHERE id = ?',
      [id]
    );
    
    if (result.rowsAffected === 0) {
      throw new Error(`OpenAI Compatible provider config not found: ${id}`);
    }
  });
}

// ============================================================================
// HarmonySpeech Provider Config Operations
// ============================================================================

export async function createHarmonySpeechProviderConfig(
  config: Omit<HarmonySpeechProviderConfig, 'id'>
): Promise<number> {
  const db = getDatabase();
  
  return withTransaction(db, async (tx) => {
    const [result] = await tx.executeSql(
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
      ]
    );
    
    return result.insertId!;
  });
}

export async function getHarmonySpeechProviderConfig(id: number): Promise<HarmonySpeechProviderConfig | null> {
  const db = getDatabase();
  
  const [results] = await db.executeSql(
    `SELECT id, name, endpoint, model, voice_config_file, format, sample_rate, stream
     FROM provider_config_harmonyspeech WHERE id = ?`,
    [id]
  );
  
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
  };
}

export async function getHarmonySpeechProviderConfigByName(name: string): Promise<HarmonySpeechProviderConfig | null> {
  const db = getDatabase();
  
  const [results] = await db.executeSql(
    `SELECT id, name, endpoint, model, voice_config_file, format, sample_rate, stream
     FROM provider_config_harmonyspeech WHERE name = ?`,
    [name]
  );
  
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
  };
}

export async function getAllHarmonySpeechProviderConfigs(): Promise<HarmonySpeechProviderConfig[]> {
  const db = getDatabase();
  
  const [results] = await db.executeSql(
    `SELECT id, name, endpoint, model, voice_config_file, format, sample_rate, stream
     FROM provider_config_harmonyspeech ORDER BY name`
  );
  
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

export async function deleteHarmonySpeechProviderConfig(id: number): Promise<void> {
  const db = getDatabase();
  
  return withTransaction(db, async (tx) => {
    const [result] = await tx.executeSql(
      'DELETE FROM provider_config_harmonyspeech WHERE id = ?',
      [id]
    );
    
    if (result.rowsAffected === 0) {
      throw new Error(`HarmonySpeech provider config not found: ${id}`);
    }
  });
}

// ============================================================================
// ElevenLabs Provider Config Operations
// ============================================================================

export async function createElevenLabsProviderConfig(
  config: Omit<ElevenLabsProviderConfig, 'id'>
): Promise<number> {
  const db = getDatabase();
  
  return withTransaction(db, async (tx) => {
    const [result] = await tx.executeSql(
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
      ]
    );
    
    return result.insertId!;
  });
}

export async function getElevenLabsProviderConfig(id: number): Promise<ElevenLabsProviderConfig | null> {
  const db = getDatabase();
  
  const [results] = await db.executeSql(
    `SELECT id, name, api_key, voice_id, model_id, stability, similarity_boost, style, speaker_boost
     FROM provider_config_elevenlabs WHERE id = ?`,
    [id]
  );
  
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
  };
}

export async function getElevenLabsProviderConfigByName(name: string): Promise<ElevenLabsProviderConfig | null> {
  const db = getDatabase();
  
  const [results] = await db.executeSql(
    `SELECT id, name, api_key, voice_id, model_id, stability, similarity_boost, style, speaker_boost
     FROM provider_config_elevenlabs WHERE name = ?`,
    [name]
  );
  
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
  };
}

export async function getAllElevenLabsProviderConfigs(): Promise<ElevenLabsProviderConfig[]> {
  const db = getDatabase();
  
  const [results] = await db.executeSql(
    `SELECT id, name, api_key, voice_id, model_id, stability, similarity_boost, style, speaker_boost
     FROM provider_config_elevenlabs ORDER BY name`
  );
  
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

export async function deleteElevenLabsProviderConfig(id: number): Promise<void> {
  const db = getDatabase();
  
  return withTransaction(db, async (tx) => {
    const [result] = await tx.executeSql(
      'DELETE FROM provider_config_elevenlabs WHERE id = ?',
      [id]
    );
    
    if (result.rowsAffected === 0) {
      throw new Error(`ElevenLabs provider config not found: ${id}`);
    }
  });
}

// ============================================================================
// Kindroid Provider Config Operations
// ============================================================================

export async function createKindroidProviderConfig(
  config: Omit<KindroidProviderConfig, 'id'>
): Promise<number> {
  const db = getDatabase();
  
  return withTransaction(db, async (tx) => {
    const [result] = await tx.executeSql(
      `INSERT INTO provider_config_kindroid (name, api_key, kindroid_id)
       VALUES (?, ?, ?)`,
      [config.name, config.api_key, config.kindroid_id]
    );
    
    return result.insertId!;
  });
}

export async function getKindroidProviderConfig(id: number): Promise<KindroidProviderConfig | null> {
  const db = getDatabase();
  
  const [results] = await db.executeSql(
    'SELECT id, name, api_key, kindroid_id FROM provider_config_kindroid WHERE id = ?',
    [id]
  );
  
  if (results.rows.length === 0) {
    return null;
  }
  
  const row = results.rows.item(0);
  return {
    id: row.id,
    name: row.name,
    api_key: row.api_key,
    kindroid_id: row.kindroid_id,
  };
}

export async function getKindroidProviderConfigByName(name: string): Promise<KindroidProviderConfig | null> {
  const db = getDatabase();
  
  const [results] = await db.executeSql(
    'SELECT id, name, api_key, kindroid_id FROM provider_config_kindroid WHERE name = ?',
    [name]
  );
  
  if (results.rows.length === 0) {
    return null;
  }
  
  const row = results.rows.item(0);
  return {
    id: row.id,
    name: row.name,
    api_key: row.api_key,
    kindroid_id: row.kindroid_id,
  };
}

export async function getAllKindroidProviderConfigs(): Promise<KindroidProviderConfig[]> {
  const db = getDatabase();
  
  const [results] = await db.executeSql(
    'SELECT id, name, api_key, kindroid_id FROM provider_config_kindroid ORDER BY name'
  );
  
  const configs: KindroidProviderConfig[] = [];
  for (let i = 0; i < results.rows.length; i++) {
    const row = results.rows.item(i);
    configs.push({
      id: row.id,
      name: row.name,
      api_key: row.api_key,
      kindroid_id: row.kindroid_id,
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

export async function deleteKindroidProviderConfig(id: number): Promise<void> {
  const db = getDatabase();
  
  return withTransaction(db, async (tx) => {
    const [result] = await tx.executeSql(
      'DELETE FROM provider_config_kindroid WHERE id = ?',
      [id]
    );
    
    if (result.rowsAffected === 0) {
      throw new Error(`Kindroid provider config not found: ${id}`);
    }
  });
}

// ============================================================================
// Kajiwoto Provider Config Operations
// ============================================================================

export async function createKajiwotoProviderConfig(
  config: Omit<KajiwotoProviderConfig, 'id'>
): Promise<number> {
  const db = getDatabase();
  
  return withTransaction(db, async (tx) => {
    const [result] = await tx.executeSql(
      `INSERT INTO provider_config_kajiwoto (name, username, password, room_url)
       VALUES (?, ?, ?, ?)`,
      [config.name, config.username, config.password, config.room_url]
    );
    
    return result.insertId!;
  });
}

export async function getKajiwotoProviderConfig(id: number): Promise<KajiwotoProviderConfig | null> {
  const db = getDatabase();
  
  const [results] = await db.executeSql(
    'SELECT id, name, username, password, room_url FROM provider_config_kajiwoto WHERE id = ?',
    [id]
  );
  
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
  };
}

export async function getKajiwotoProviderConfigByName(name: string): Promise<KajiwotoProviderConfig | null> {
  const db = getDatabase();
  
  const [results] = await db.executeSql(
    'SELECT id, name, username, password, room_url FROM provider_config_kajiwoto WHERE name = ?',
    [name]
  );
  
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
  };
}

export async function getAllKajiwotoProviderConfigs(): Promise<KajiwotoProviderConfig[]> {
  const db = getDatabase();
  
  const [results] = await db.executeSql(
    'SELECT id, name, username, password, room_url FROM provider_config_kajiwoto ORDER BY name'
  );
  
  const configs: KajiwotoProviderConfig[] = [];
  for (let i = 0; i < results.rows.length; i++) {
    const row = results.rows.item(i);
    configs.push({
      id: row.id,
      name: row.name,
      username: row.username,
      password: row.password,
      room_url: row.room_url,
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

export async function deleteKajiwotoProviderConfig(id: number): Promise<void> {
  const db = getDatabase();
  
  return withTransaction(db, async (tx) => {
    const [result] = await tx.executeSql(
      'DELETE FROM provider_config_kajiwoto WHERE id = ?',
      [id]
    );
    
    if (result.rowsAffected === 0) {
      throw new Error(`Kajiwoto provider config not found: ${id}`);
    }
  });
}

// ============================================================================
// CharacterAI Provider Config Operations
// ============================================================================

export async function createCharacterAIProviderConfig(
  config: Omit<CharacterAIProviderConfig, 'id'>
): Promise<number> {
  const db = getDatabase();
  
  return withTransaction(db, async (tx) => {
    const [result] = await tx.executeSql(
      `INSERT INTO provider_config_characterai (name, api_token, chatroom_url)
       VALUES (?, ?, ?)`,
      [config.name, config.api_token, config.chatroom_url]
    );
    
    return result.insertId!;
  });
}

export async function getCharacterAIProviderConfig(id: number): Promise<CharacterAIProviderConfig | null> {
  const db = getDatabase();
  
  const [results] = await db.executeSql(
    'SELECT id, name, api_token, chatroom_url FROM provider_config_characterai WHERE id = ?',
    [id]
  );
  
  if (results.rows.length === 0) {
    return null;
  }
  
  const row = results.rows.item(0);
  return {
    id: row.id,
    name: row.name,
    api_token: row.api_token,
    chatroom_url: row.chatroom_url,
  };
}

export async function getCharacterAIProviderConfigByName(name: string): Promise<CharacterAIProviderConfig | null> {
  const db = getDatabase();
  
  const [results] = await db.executeSql(
    'SELECT id, name, api_token, chatroom_url FROM provider_config_characterai WHERE name = ?',
    [name]
  );
  
  if (results.rows.length === 0) {
    return null;
  }
  
  const row = results.rows.item(0);
  return {
    id: row.id,
    name: row.name,
    api_token: row.api_token,
    chatroom_url: row.chatroom_url,
  };
}

export async function getAllCharacterAIProviderConfigs(): Promise<CharacterAIProviderConfig[]> {
  const db = getDatabase();
  
  const [results] = await db.executeSql(
    'SELECT id, name, api_token, chatroom_url FROM provider_config_characterai ORDER BY name'
  );
  
  const configs: CharacterAIProviderConfig[] = [];
  for (let i = 0; i < results.rows.length; i++) {
    const row = results.rows.item(i);
    configs.push({
      id: row.id,
      name: row.name,
      api_token: row.api_token,
      chatroom_url: row.chatroom_url,
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

export async function deleteCharacterAIProviderConfig(id: number): Promise<void> {
  const db = getDatabase();
  
  return withTransaction(db, async (tx) => {
    const [result] = await tx.executeSql(
      'DELETE FROM provider_config_characterai WHERE id = ?',
      [id]
    );
    
    if (result.rowsAffected === 0) {
      throw new Error(`CharacterAI provider config not found: ${id}`);
    }
  });
}

// ============================================================================
// LocalAI Provider Config Operations
// ============================================================================

export async function createLocalAIProviderConfig(
  config: Omit<LocalAIProviderConfig, 'id'>
): Promise<number> {
  const db = getDatabase();
  
  return withTransaction(db, async (tx) => {
    const [result] = await tx.executeSql(
      'INSERT INTO provider_config_localai (name, embedding_model) VALUES (?, ?)',
      [config.name, config.embedding_model]
    );
    
    return result.insertId!;
  });
}

export async function getLocalAIProviderConfig(id: number): Promise<LocalAIProviderConfig | null> {
  const db = getDatabase();
  
  const [results] = await db.executeSql(
    'SELECT id, name, embedding_model FROM provider_config_localai WHERE id = ?',
    [id]
  );
  
  if (results.rows.length === 0) {
    return null;
  }
  
  const row = results.rows.item(0);
  return {
    id: row.id,
    name: row.name,
    embedding_model: row.embedding_model,
  };
}

export async function getLocalAIProviderConfigByName(name: string): Promise<LocalAIProviderConfig | null> {
  const db = getDatabase();
  
  const [results] = await db.executeSql(
    'SELECT id, name, embedding_model FROM provider_config_localai WHERE name = ?',
    [name]
  );
  
  if (results.rows.length === 0) {
    return null;
  }
  
  const row = results.rows.item(0);
  return {
    id: row.id,
    name: row.name,
    embedding_model: row.embedding_model,
  };
}

export async function getAllLocalAIProviderConfigs(): Promise<LocalAIProviderConfig[]> {
  const db = getDatabase();
  
  const [results] = await db.executeSql(
    'SELECT id, name, embedding_model FROM provider_config_localai ORDER BY name'
  );
  
  const configs: LocalAIProviderConfig[] = [];
  for (let i = 0; i < results.rows.length; i++) {
    const row = results.rows.item(i);
    configs.push({
      id: row.id,
      name: row.name,
      embedding_model: row.embedding_model,
    });
  }
  
  return configs;
}

export async function updateLocalAIProviderConfig(config: LocalAIProviderConfig): Promise<void> {
  const db = getDatabase();
  
  return withTransaction(db, async (tx) => {
    const [result] = await tx.executeSql(
      'UPDATE provider_config_localai SET name = ?, embedding_model = ? WHERE id = ?',
      [config.name, config.embedding_model, config.id]
    );
    
    if (result.rowsAffected === 0) {
      throw new Error(`LocalAI provider config not found: ${config.id}`);
    }
  });
}

export async function deleteLocalAIProviderConfig(id: number): Promise<void> {
  const db = getDatabase();
  
  return withTransaction(db, async (tx) => {
    const [result] = await tx.executeSql(
      'DELETE FROM provider_config_localai WHERE id = ?',
      [id]
    );
    
    if (result.rowsAffected === 0) {
      throw new Error(`LocalAI provider config not found: ${id}`);
    }
  });
}

// ============================================================================
// Mistral Provider Config Operations
// ============================================================================

export async function createMistralProviderConfig(
  config: Omit<MistralProviderConfig, 'id'>
): Promise<number> {
  const db = getDatabase();
  
  return withTransaction(db, async (tx) => {
    const [result] = await tx.executeSql(
      'INSERT INTO provider_config_mistral (name, api_key) VALUES (?, ?)',
      [config.name, config.api_key]
    );
    
    return result.insertId!;
  });
}

export async function getMistralProviderConfig(id: number): Promise<MistralProviderConfig | null> {
  const db = getDatabase();
  
  const [results] = await db.executeSql(
    'SELECT id, name, api_key FROM provider_config_mistral WHERE id = ?',
    [id]
  );
  
  if (results.rows.length === 0) {
    return null;
  }
  
  const row = results.rows.item(0);
  return {
    id: row.id,
    name: row.name,
    api_key: row.api_key,
  };
}

export async function getMistralProviderConfigByName(name: string): Promise<MistralProviderConfig | null> {
  const db = getDatabase();
  
  const [results] = await db.executeSql(
    'SELECT id, name, api_key FROM provider_config_mistral WHERE name = ?',
    [name]
  );
  
  if (results.rows.length === 0) {
    return null;
  }
  
  const row = results.rows.item(0);
  return {
    id: row.id,
    name: row.name,
    api_key: row.api_key,
  };
}

export async function getAllMistralProviderConfigs(): Promise<MistralProviderConfig[]> {
  const db = getDatabase();
  
  const [results] = await db.executeSql(
    'SELECT id, name, api_key FROM provider_config_mistral ORDER BY name'
  );
  
  const configs: MistralProviderConfig[] = [];
  for (let i = 0; i < results.rows.length; i++) {
    const row = results.rows.item(i);
    configs.push({
      id: row.id,
      name: row.name,
      api_key: row.api_key,
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

export async function deleteMistralProviderConfig(id: number): Promise<void> {
  const db = getDatabase();
  
  return withTransaction(db, async (tx) => {
    const [result] = await tx.executeSql(
      'DELETE FROM provider_config_mistral WHERE id = ?',
      [id]
    );
    
    if (result.rowsAffected === 0) {
      throw new Error(`Mistral provider config not found: ${id}`);
    }
  });
}

// ============================================================================
// Ollama Provider Config Operations
// ============================================================================

export async function createOllamaProviderConfig(
  config: Omit<OllamaProviderConfig, 'id'>
): Promise<number> {
  const db = getDatabase();
  
  return withTransaction(db, async (tx) => {
    const [result] = await tx.executeSql(
      'INSERT INTO provider_config_ollama (name, base_url, embedding_model) VALUES (?, ?, ?)',
      [config.name, config.base_url, config.embedding_model]
    );
    
    return result.insertId!;
  });
}

export async function getOllamaProviderConfig(id: number): Promise<OllamaProviderConfig | null> {
  const db = getDatabase();
  
  const [results] = await db.executeSql(
    'SELECT id, name, base_url, embedding_model FROM provider_config_ollama WHERE id = ?',
    [id]
  );
  
  if (results.rows.length === 0) {
    return null;
  }
  
  const row = results.rows.item(0);
  return {
    id: row.id,
    name: row.name,
    base_url: row.base_url,
    embedding_model: row.embedding_model,
  };
}

export async function getOllamaProviderConfigByName(name: string): Promise<OllamaProviderConfig | null> {
  const db = getDatabase();
  
  const [results] = await db.executeSql(
    'SELECT id, name, base_url, embedding_model FROM provider_config_ollama WHERE name = ?',
    [name]
  );
  
  if (results.rows.length === 0) {
    return null;
  }
  
  const row = results.rows.item(0);
  return {
    id: row.id,
    name: row.name,
    base_url: row.base_url,
    embedding_model: row.embedding_model,
  };
}

export async function getAllOllamaProviderConfigs(): Promise<OllamaProviderConfig[]> {
  const db = getDatabase();
  
  const [results] = await db.executeSql(
    'SELECT id, name, base_url, embedding_model FROM provider_config_ollama ORDER BY name'
  );
  
  const configs: OllamaProviderConfig[] = [];
  for (let i = 0; i < results.rows.length; i++) {
    const row = results.rows.item(i);
    configs.push({
      id: row.id,
      name: row.name,
      base_url: row.base_url,
      embedding_model: row.embedding_model,
    });
  }
  
  return configs;
}

export async function updateOllamaProviderConfig(config: OllamaProviderConfig): Promise<void> {
  const db = getDatabase();
  
  return withTransaction(db, async (tx) => {
    const [result] = await tx.executeSql(
      'UPDATE provider_config_ollama SET name = ?, base_url = ?, embedding_model = ? WHERE id = ?',
      [config.name, config.base_url, config.embedding_model, config.id]
    );
    
    if (result.rowsAffected === 0) {
      throw new Error(`Ollama provider config not found: ${config.id}`);
    }
  });
}

export async function deleteOllamaProviderConfig(id: number): Promise<void> {
  const db = getDatabase();
  
  return withTransaction(db, async (tx) => {
    const [result] = await tx.executeSql(
      'DELETE FROM provider_config_ollama WHERE id = ?',
      [id]
    );
    
    if (result.rowsAffected === 0) {
      throw new Error(`Ollama provider config not found: ${id}`);
    }
  });
}
