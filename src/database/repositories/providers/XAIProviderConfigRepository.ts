import {getDatabase} from '../../connection';
import {withTransaction} from '../../transaction';
import {XAIProviderConfig} from '../../models';
import {isProviderConfigInUse} from './shared';
import {generateId} from '../../../utils/uuid';

export async function createXAIProviderConfig(
  config: Omit<XAIProviderConfig, 'id' | 'deleted_at'>
): Promise<string> {
  const db = getDatabase();
  const id = generateId();
  
  return new Promise<string>((resolve, reject) => {
    db.transaction(
      (tx) => {
        tx.executeSql(
          `INSERT INTO provider_config_xai (
            id, name, api_key, model, max_tokens, max_completion_tokens, temperature, top_p,
            frequency_penalty, presence_penalty, n, stop_tokens, seed, response_format,
            reasoning_effort, sampling_preset_name, extra_params, image_aspect_ratio, image_resolution
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id, config.name, config.api_key, config.model, config.max_tokens, config.max_completion_tokens,
            config.temperature, config.top_p, config.frequency_penalty, config.presence_penalty, config.n,
            config.stop_tokens, config.seed, config.response_format, config.reasoning_effort,
            config.sampling_preset_name, config.extra_params, config.image_aspect_ratio, config.image_resolution,
          ],
          () => { resolve(id); },
          (_, error) => { reject(error); return false; }
        );
      },
      (error) => reject(error)
    );
  });
}

export async function getXAIProviderConfig(id: string, includeDeleted = false): Promise<XAIProviderConfig | null> {
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
  if (results.rows.length === 0) return null;
  const row = results.rows.item(0);
  return {
    id: row.id, name: row.name, api_key: row.api_key, model: row.model,
    max_tokens: row.max_tokens, max_completion_tokens: row.max_completion_tokens, temperature: row.temperature, top_p: row.top_p,
    frequency_penalty: row.frequency_penalty, presence_penalty: row.presence_penalty, n: row.n, stop_tokens: row.stop_tokens,
    seed: row.seed, response_format: row.response_format, reasoning_effort: row.reasoning_effort,
    sampling_preset_name: row.sampling_preset_name, extra_params: row.extra_params,
    image_aspect_ratio: row.image_aspect_ratio, image_resolution: row.image_resolution,
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
  if (results.rows.length === 0) return null;
  const row = results.rows.item(0);
  return {
    id: row.id, name: row.name, api_key: row.api_key, model: row.model,
    max_tokens: row.max_tokens, max_completion_tokens: row.max_completion_tokens, temperature: row.temperature, top_p: row.top_p,
    frequency_penalty: row.frequency_penalty, presence_penalty: row.presence_penalty, n: row.n, stop_tokens: row.stop_tokens,
    seed: row.seed, response_format: row.response_format, reasoning_effort: row.reasoning_effort,
    sampling_preset_name: row.sampling_preset_name, extra_params: row.extra_params,
    image_aspect_ratio: row.image_aspect_ratio, image_resolution: row.image_resolution,
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
      id: row.id, name: row.name, api_key: row.api_key, model: row.model,
      max_tokens: row.max_tokens, max_completion_tokens: row.max_completion_tokens, temperature: row.temperature, top_p: row.top_p,
      frequency_penalty: row.frequency_penalty, presence_penalty: row.presence_penalty, n: row.n, stop_tokens: row.stop_tokens,
      seed: row.seed, response_format: row.response_format, reasoning_effort: row.reasoning_effort,
      sampling_preset_name: row.sampling_preset_name, extra_params: row.extra_params,
      image_aspect_ratio: row.image_aspect_ratio, image_resolution: row.image_resolution,
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
        config.name, config.api_key, config.model, config.max_tokens, config.max_completion_tokens,
        config.temperature, config.top_p, config.frequency_penalty, config.presence_penalty, config.n,
        config.stop_tokens, config.seed, config.response_format, config.reasoning_effort,
        config.sampling_preset_name, config.extra_params, config.image_aspect_ratio, config.image_resolution,
        config.id,
      ]
    );
    if (result.rowsAffected === 0) throw new Error(`XAI provider config not found: ${config.id}`);
  });
}

export async function isXAIProviderConfigInUse(id: string): Promise<boolean> {
  return isProviderConfigInUse('xai', id);
}

export async function deleteXAIProviderConfig(id: string, permanent = false): Promise<void> {
  const db = getDatabase();
  if (!permanent && await isXAIProviderConfigInUse(id)) throw new Error(`XAI provider config ${id} is in use and cannot be soft deleted`);
  return withTransaction(db, async (tx) => {
    if (permanent) {
      const [result] = await tx.executeSql('DELETE FROM provider_config_xai WHERE id = ?', [id]);
      if (result.rowsAffected === 0) throw new Error(`XAI provider config not found: ${id}`);
    } else {
      const now = new Date().toISOString();
      const [result] = await tx.executeSql('UPDATE provider_config_xai SET deleted_at = ? WHERE id = ?', [now, id]);
      if (result.rowsAffected === 0) throw new Error(`XAI provider config not found: ${id}`);
    }
  });
}
