import {getDatabase} from '../../connection';
import {withTransaction} from '../../transaction';
import {GoogleProviderConfig} from '../../models';
import {isProviderConfigInUse} from './shared';
import {generateId} from '../../../utils/uuid';

export async function createGoogleProviderConfig(
  config: Omit<GoogleProviderConfig, 'id' | 'deleted_at'>
): Promise<string> {
  const db = getDatabase();
  const id = generateId();
  
  return new Promise<string>((resolve, reject) => {
    db.transaction(
      (tx) => {
        tx.executeSql(
          `INSERT INTO provider_config_google (
            id, name, api_key, model, max_output_tokens, temperature, top_p, top_k,
            stop_tokens, seed, response_mime_type, sampling_preset_name, extra_params,
            number_of_images, aspect_ratio
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id, config.name, config.api_key, config.model, config.max_output_tokens,
            config.temperature, config.top_p, config.top_k, config.stop_tokens, config.seed,
            config.response_mime_type, config.sampling_preset_name, config.extra_params,
            config.number_of_images, config.aspect_ratio,
          ],
          () => { resolve(id); },
          (_, error) => { reject(error); return false; }
        );
      },
      (error) => reject(error)
    );
  });
}

export async function getGoogleProviderConfig(id: string, includeDeleted = false): Promise<GoogleProviderConfig | null> {
  const db = getDatabase();
  const query = includeDeleted
    ? `SELECT id, name, api_key, model, max_output_tokens, temperature, top_p, top_k,
            stop_tokens, seed, response_mime_type, sampling_preset_name, extra_params,
            number_of_images, aspect_ratio, deleted_at FROM provider_config_google WHERE id = ?`
    : `SELECT id, name, api_key, model, max_output_tokens, temperature, top_p, top_k,
            stop_tokens, seed, response_mime_type, sampling_preset_name, extra_params,
            number_of_images, aspect_ratio, deleted_at FROM provider_config_google WHERE id = ? AND deleted_at IS NULL`;
  const [results] = await db.executeSql(query, [id]);
  if (results.rows.length === 0) return null;
  const row = results.rows.item(0);
  return {
    id: row.id, name: row.name, api_key: row.api_key, model: row.model,
    max_output_tokens: row.max_output_tokens, temperature: row.temperature, top_p: row.top_p, top_k: row.top_k,
    stop_tokens: row.stop_tokens, seed: row.seed, response_mime_type: row.response_mime_type,
    sampling_preset_name: row.sampling_preset_name, extra_params: row.extra_params,
    number_of_images: row.number_of_images, aspect_ratio: row.aspect_ratio,
    deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
  };
}

export async function getGoogleProviderConfigByName(name: string, includeDeleted = false): Promise<GoogleProviderConfig | null> {
  const db = getDatabase();
  const query = includeDeleted
    ? `SELECT id, name, api_key, model, max_output_tokens, temperature, top_p, top_k,
            stop_tokens, seed, response_mime_type, sampling_preset_name, extra_params,
            number_of_images, aspect_ratio, deleted_at FROM provider_config_google WHERE name = ?`
    : `SELECT id, name, api_key, model, max_output_tokens, temperature, top_p, top_k,
            stop_tokens, seed, response_mime_type, sampling_preset_name, extra_params,
            number_of_images, aspect_ratio, deleted_at FROM provider_config_google WHERE name = ? AND deleted_at IS NULL`;
  const [results] = await db.executeSql(query, [name]);
  if (results.rows.length === 0) return null;
  const row = results.rows.item(0);
  return {
    id: row.id, name: row.name, api_key: row.api_key, model: row.model,
    max_output_tokens: row.max_output_tokens, temperature: row.temperature, top_p: row.top_p, top_k: row.top_k,
    stop_tokens: row.stop_tokens, seed: row.seed, response_mime_type: row.response_mime_type,
    sampling_preset_name: row.sampling_preset_name, extra_params: row.extra_params,
    number_of_images: row.number_of_images, aspect_ratio: row.aspect_ratio,
    deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
  };
}

export async function getAllGoogleProviderConfigs(includeDeleted = false): Promise<GoogleProviderConfig[]> {
  const db = getDatabase();
  const query = includeDeleted
    ? `SELECT id, name, api_key, model, max_output_tokens, temperature, top_p, top_k,
            stop_tokens, seed, response_mime_type, sampling_preset_name, extra_params,
            number_of_images, aspect_ratio, deleted_at FROM provider_config_google ORDER BY name`
    : `SELECT id, name, api_key, model, max_output_tokens, temperature, top_p, top_k,
            stop_tokens, seed, response_mime_type, sampling_preset_name, extra_params,
            number_of_images, aspect_ratio, deleted_at FROM provider_config_google WHERE deleted_at IS NULL ORDER BY name`;
  const [results] = await db.executeSql(query);
  const configs: GoogleProviderConfig[] = [];
  for (let i = 0; i < results.rows.length; i++) {
    const row = results.rows.item(i);
    configs.push({
      id: row.id, name: row.name, api_key: row.api_key, model: row.model,
      max_output_tokens: row.max_output_tokens, temperature: row.temperature, top_p: row.top_p, top_k: row.top_k,
      stop_tokens: row.stop_tokens, seed: row.seed, response_mime_type: row.response_mime_type,
      sampling_preset_name: row.sampling_preset_name, extra_params: row.extra_params,
      number_of_images: row.number_of_images, aspect_ratio: row.aspect_ratio,
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
       SET name = ?, api_key = ?, model = ?, max_output_tokens = ?, temperature = ?, top_p = ?, top_k = ?,
           stop_tokens = ?, seed = ?, response_mime_type = ?, sampling_preset_name = ?, extra_params = ?,
           number_of_images = ?, aspect_ratio = ?
       WHERE id = ?`,
      [
        config.name, config.api_key, config.model, config.max_output_tokens, config.temperature, config.top_p, config.top_k,
        config.stop_tokens, config.seed, config.response_mime_type, config.sampling_preset_name, config.extra_params,
        config.number_of_images, config.aspect_ratio, config.id,
      ]
    );
    if (result.rowsAffected === 0) throw new Error(`Google provider config not found: ${config.id}`);
  });
}

export async function isGoogleProviderConfigInUse(id: string): Promise<boolean> {
  return isProviderConfigInUse('google', id);
}

export async function deleteGoogleProviderConfig(id: string, permanent = false): Promise<void> {
  const db = getDatabase();
  if (!permanent && await isGoogleProviderConfigInUse(id)) throw new Error(`Google provider config ${id} is in use and cannot be soft deleted`);
  return withTransaction(db, async (tx) => {
    if (permanent) {
      const [result] = await tx.executeSql('DELETE FROM provider_config_google WHERE id = ?', [id]);
      if (result.rowsAffected === 0) throw new Error(`Google provider config not found: ${id}`);
    } else {
      const now = new Date().toISOString();
      const [result] = await tx.executeSql('UPDATE provider_config_google SET deleted_at = ? WHERE id = ?', [now, id]);
      if (result.rowsAffected === 0) throw new Error(`Google provider config not found: ${id}`);
    }
  });
}
