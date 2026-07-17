import {getDatabase} from '../../connection';
import {withTransaction} from '../../transaction';
import {OpenAICompatibleProviderConfig} from '../../models';
import {isProviderConfigInUse} from './shared';
import {generateId} from '../../../utils/uuid';

export async function createOpenAICompatibleProviderConfig(
  config: Omit<OpenAICompatibleProviderConfig, 'id' | 'deleted_at'>
): Promise<string> {
  const db = getDatabase();
  const id = generateId();
  
  return new Promise<string>((resolve, reject) => {
    db.transaction(
      (tx) => {
        tx.executeSql(
          `INSERT INTO provider_config_openaicompatible (
            id, name, base_url, api_key, model, max_tokens, temperature, top_p, n, stop_tokens,
            frequency_penalty, presence_penalty, max_completion_tokens, seed, response_format,
            top_k, top_a, min_p, repetition_penalty, sampling_preset_name, extra_params
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
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
          () => {
            resolve(id);
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

export async function getOpenAICompatibleProviderConfig(id: string, includeDeleted = false): Promise<OpenAICompatibleProviderConfig | null> {
  const db = getDatabase();
  
  const query = includeDeleted
    ? `SELECT id, name, base_url, api_key, model, max_tokens, temperature, top_p, n, stop_tokens,
            frequency_penalty, presence_penalty, max_completion_tokens, seed, response_format,
            top_k, top_a, min_p, repetition_penalty, sampling_preset_name, extra_params, deleted_at
     FROM provider_config_openaicompatible WHERE id = ?`
    : `SELECT id, name, base_url, api_key, model, max_tokens, temperature, top_p, n, stop_tokens,
            frequency_penalty, presence_penalty, max_completion_tokens, seed, response_format,
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
    ? `SELECT id, name, base_url, api_key, model, max_tokens, temperature, top_p, n, stop_tokens,
            frequency_penalty, presence_penalty, max_completion_tokens, seed, response_format,
            top_k, top_a, min_p, repetition_penalty, sampling_preset_name, extra_params, deleted_at
     FROM provider_config_openaicompatible WHERE name = ?`
    : `SELECT id, name, base_url, api_key, model, max_tokens, temperature, top_p, n, stop_tokens,
            frequency_penalty, presence_penalty, max_completion_tokens, seed, response_format,
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
    ? `SELECT id, name, base_url, api_key, model, max_tokens, temperature, top_p, n, stop_tokens,
            frequency_penalty, presence_penalty, max_completion_tokens, seed, response_format,
            top_k, top_a, min_p, repetition_penalty, sampling_preset_name, extra_params, deleted_at
     FROM provider_config_openaicompatible ORDER BY name`
    : `SELECT id, name, base_url, api_key, model, max_tokens, temperature, top_p, n, stop_tokens,
            frequency_penalty, presence_penalty, max_completion_tokens, seed, response_format,
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
       SET name = ?, base_url = ?, api_key = ?, model = ?, max_tokens = ?, temperature = ?, top_p = ?, n = ?, stop_tokens = ?,
           frequency_penalty = ?, presence_penalty = ?, max_completion_tokens = ?, seed = ?, response_format = ?,
           top_k = ?, top_a = ?, min_p = ?, repetition_penalty = ?, sampling_preset_name = ?, extra_params = ?
       WHERE id = ?`,
      [
        config.name, config.base_url, config.api_key, config.model, config.max_tokens, config.temperature, config.top_p, config.n, config.stop_tokens,
        config.frequency_penalty, config.presence_penalty, config.max_completion_tokens, config.seed, config.response_format,
        config.top_k, config.top_a, config.min_p, config.repetition_penalty, config.sampling_preset_name, config.extra_params,
        config.id,
      ]
    );
    
    if (result.rowsAffected === 0) {
      throw new Error(`OpenAICompatible provider config not found: ${config.id}`);
    }
  });
}

/**
 * Check if an OpenAI Compatible provider config is in use by any modules
 */
export async function isOpenAICompatibleProviderConfigInUse(id: string): Promise<boolean> {
  return isProviderConfigInUse('openaicompatible', id);
}

export async function deleteOpenAICompatibleProviderConfig(id: string, permanent = false): Promise<void> {
  const db = getDatabase();
  
  if (!permanent && await isOpenAICompatibleProviderConfigInUse(id)) {
    throw new Error(`OpenAICompatible provider config ${id} is in use and cannot be soft deleted`);
  }

  return withTransaction(db, async (tx) => {
    if (permanent) {
      const [result] = await tx.executeSql('DELETE FROM provider_config_openaicompatible WHERE id = ?', [id]);
      if (result.rowsAffected === 0) {
        throw new Error(`OpenAICompatible provider config not found: ${id}`);
      }
    } else {
      const now = new Date().toISOString();
      const [result] = await tx.executeSql(
        'UPDATE provider_config_openaicompatible SET deleted_at = ? WHERE id = ?',
        [now, id]
      );
      if (result.rowsAffected === 0) {
        throw new Error(`OpenAICompatible provider config not found: ${id}`);
      }
    }
  });
}
