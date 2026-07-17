import {getDatabase} from '../../connection';
import {withTransaction} from '../../transaction';
import {SoulbitsCloudProviderConfig} from '../../models';
import {isProviderConfigInUse} from './shared';
import {generateId} from '../../../utils/uuid';

export async function createSoulbitsCloudProviderConfig(
  config: Omit<SoulbitsCloudProviderConfig, 'id' | 'deleted_at'>
): Promise<string> {
  const db = getDatabase();
  const id = generateId();

  return new Promise<string>((resolve, reject) => {
    db.transaction(
      (tx) => {
        tx.executeSql(
          `INSERT INTO provider_config_soulbitscloud (
            id, name, base_url, api_key, model, max_tokens, max_completion_tokens,
            temperature, top_p, frequency_penalty, presence_penalty, n,
            stop_tokens, seed, response_format, sampling_preset_name, extra_params,
            voice, speed, format, image_aspect_ratio, image_size
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            config.name,
            config.base_url,
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
            config.sampling_preset_name,
            config.extra_params,
            config.voice,
            config.speed,
            config.format,
            config.image_aspect_ratio,
            config.image_size,
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

export async function getSoulbitsCloudProviderConfig(id: string, includeDeleted = false): Promise<SoulbitsCloudProviderConfig | null> {
  const db = getDatabase();

  const query = includeDeleted
    ? `SELECT id, name, base_url, api_key, model, max_tokens, max_completion_tokens,
            temperature, top_p, frequency_penalty, presence_penalty, n,
            stop_tokens, seed, response_format, sampling_preset_name, extra_params,
            voice, speed, format, image_aspect_ratio, image_size, deleted_at
     FROM provider_config_soulbitscloud WHERE id = ?`
    : `SELECT id, name, base_url, api_key, model, max_tokens, max_completion_tokens,
            temperature, top_p, frequency_penalty, presence_penalty, n,
            stop_tokens, seed, response_format, sampling_preset_name, extra_params,
            voice, speed, format, image_aspect_ratio, image_size, deleted_at
     FROM provider_config_soulbitscloud WHERE id = ? AND deleted_at IS NULL`;

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
    max_completion_tokens: row.max_completion_tokens,
    temperature: row.temperature,
    top_p: row.top_p,
    frequency_penalty: row.frequency_penalty,
    presence_penalty: row.presence_penalty,
    n: row.n,
    stop_tokens: row.stop_tokens,
    seed: row.seed,
    response_format: row.response_format,
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

export async function getSoulbitsCloudProviderConfigByName(name: string, includeDeleted = false): Promise<SoulbitsCloudProviderConfig | null> {
  const db = getDatabase();

  const query = includeDeleted
    ? `SELECT id, name, base_url, api_key, model, max_tokens, max_completion_tokens,
            temperature, top_p, frequency_penalty, presence_penalty, n,
            stop_tokens, seed, response_format, sampling_preset_name, extra_params,
            voice, speed, format, image_aspect_ratio, image_size, deleted_at
     FROM provider_config_soulbitscloud WHERE name = ?`
    : `SELECT id, name, base_url, api_key, model, max_tokens, max_completion_tokens,
            temperature, top_p, frequency_penalty, presence_penalty, n,
            stop_tokens, seed, response_format, sampling_preset_name, extra_params,
            voice, speed, format, image_aspect_ratio, image_size, deleted_at
     FROM provider_config_soulbitscloud WHERE name = ? AND deleted_at IS NULL`;

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
    max_completion_tokens: row.max_completion_tokens,
    temperature: row.temperature,
    top_p: row.top_p,
    frequency_penalty: row.frequency_penalty,
    presence_penalty: row.presence_penalty,
    n: row.n,
    stop_tokens: row.stop_tokens,
    seed: row.seed,
    response_format: row.response_format,
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

export async function getAllSoulbitsCloudProviderConfigs(includeDeleted = false): Promise<SoulbitsCloudProviderConfig[]> {
  const db = getDatabase();

  const query = includeDeleted
    ? `SELECT id, name, base_url, api_key, model, max_tokens, max_completion_tokens,
            temperature, top_p, frequency_penalty, presence_penalty, n,
            stop_tokens, seed, response_format, sampling_preset_name, extra_params,
            voice, speed, format, image_aspect_ratio, image_size, deleted_at
     FROM provider_config_soulbitscloud ORDER BY name`
    : `SELECT id, name, base_url, api_key, model, max_tokens, max_completion_tokens,
            temperature, top_p, frequency_penalty, presence_penalty, n,
            stop_tokens, seed, response_format, sampling_preset_name, extra_params,
            voice, speed, format, image_aspect_ratio, image_size, deleted_at
     FROM provider_config_soulbitscloud WHERE deleted_at IS NULL ORDER BY name`;

  const [results] = await db.executeSql(query);

  const configs: SoulbitsCloudProviderConfig[] = [];
  for (let i = 0; i < results.rows.length; i++) {
    const row = results.rows.item(i);
    configs.push({
      id: row.id,
      name: row.name,
      base_url: row.base_url,
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

export async function updateSoulbitsCloudProviderConfig(config: SoulbitsCloudProviderConfig): Promise<void> {
  const db = getDatabase();

  return withTransaction(db, async (tx) => {
    const [result] = await tx.executeSql(
      `UPDATE provider_config_soulbitscloud
       SET name = ?, base_url = ?, api_key = ?, model = ?,
           max_tokens = ?, max_completion_tokens = ?,
           temperature = ?, top_p = ?, frequency_penalty = ?, presence_penalty = ?, n = ?,
           stop_tokens = ?, seed = ?, response_format = ?, sampling_preset_name = ?, extra_params = ?,
           voice = ?, speed = ?, format = ?, image_aspect_ratio = ?, image_size = ?
       WHERE id = ?`,
      [
        config.name,
        config.base_url,
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
      throw new Error(`SoulbitsCloud provider config not found: ${config.id}`);
    }
  });
}

/**
 * Check if a SoulbitsCloud provider config is in use by any modules
 */
export async function isSoulbitsCloudProviderConfigInUse(id: string): Promise<boolean> {
  return isProviderConfigInUse('soulbitscloud', id);
}

export async function deleteSoulbitsCloudProviderConfig(id: string, permanent = false): Promise<void> {
  const db = getDatabase();

  if (!permanent && await isSoulbitsCloudProviderConfigInUse(id)) {
    throw new Error(`SoulbitsCloud provider config ${id} is in use and cannot be soft deleted`);
  }

  return withTransaction(db, async (tx) => {
    if (permanent) {
      const [result] = await tx.executeSql('DELETE FROM provider_config_soulbitscloud WHERE id = ?', [id]);
      if (result.rowsAffected === 0) {
        throw new Error(`SoulbitsCloud provider config not found: ${id}`);
      }
    } else {
      const now = new Date().toISOString();
      const [result] = await tx.executeSql(
        'UPDATE provider_config_soulbitscloud SET deleted_at = ? WHERE id = ?',
        [now, id]
      );
      if (result.rowsAffected === 0) {
        throw new Error(`SoulbitsCloud provider config not found: ${id}`);
      }
    }
  });
}
