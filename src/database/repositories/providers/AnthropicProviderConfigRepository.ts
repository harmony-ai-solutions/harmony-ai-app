import {getDatabase} from '../../connection';
import {withTransaction} from '../../transaction';
import {AnthropicProviderConfig} from '../../models';
import {isProviderConfigInUse} from './shared';
import {generateId} from '../../../utils/uuid';

export async function createAnthropicProviderConfig(
  config: Omit<AnthropicProviderConfig, 'id' | 'deleted_at'>
): Promise<string> {
  const db = getDatabase();
  const id = generateId();
  
  return new Promise<string>((resolve, reject) => {
    db.transaction(
      (tx) => {
        tx.executeSql(
          `INSERT INTO provider_config_anthropic (
            id, name, api_key, model, max_tokens, temperature, top_p, top_k,
            stop_sequences, sampling_preset_name, extra_params
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id, config.name, config.api_key, config.model, config.max_tokens,
            config.temperature, config.top_p, config.top_k, config.stop_sequences,
            config.sampling_preset_name, config.extra_params,
          ],
          () => { resolve(id); },
          (_, error) => { reject(error); return false; }
        );
      },
      (error) => reject(error)
    );
  });
}

export async function getAnthropicProviderConfig(id: string, includeDeleted = false): Promise<AnthropicProviderConfig | null> {
  const db = getDatabase();
  const query = includeDeleted
    ? `SELECT id, name, api_key, model, max_tokens, temperature, top_p, top_k,
            stop_sequences, sampling_preset_name, extra_params, deleted_at FROM provider_config_anthropic WHERE id = ?`
    : `SELECT id, name, api_key, model, max_tokens, temperature, top_p, top_k,
            stop_sequences, sampling_preset_name, extra_params, deleted_at FROM provider_config_anthropic WHERE id = ? AND deleted_at IS NULL`;
  const [results] = await db.executeSql(query, [id]);
  if (results.rows.length === 0) return null;
  const row = results.rows.item(0);
  return {
    id: row.id, name: row.name, api_key: row.api_key, model: row.model,
    max_tokens: row.max_tokens, temperature: row.temperature, top_p: row.top_p, top_k: row.top_k,
    stop_sequences: row.stop_sequences, sampling_preset_name: row.sampling_preset_name, extra_params: row.extra_params,
    deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
  };
}

export async function getAnthropicProviderConfigByName(name: string, includeDeleted = false): Promise<AnthropicProviderConfig | null> {
  const db = getDatabase();
  const query = includeDeleted
    ? `SELECT id, name, api_key, model, max_tokens, temperature, top_p, top_k,
            stop_sequences, sampling_preset_name, extra_params, deleted_at FROM provider_config_anthropic WHERE name = ?`
    : `SELECT id, name, api_key, model, max_tokens, temperature, top_p, top_k,
            stop_sequences, sampling_preset_name, extra_params, deleted_at FROM provider_config_anthropic WHERE name = ? AND deleted_at IS NULL`;
  const [results] = await db.executeSql(query, [name]);
  if (results.rows.length === 0) return null;
  const row = results.rows.item(0);
  return {
    id: row.id, name: row.name, api_key: row.api_key, model: row.model,
    max_tokens: row.max_tokens, temperature: row.temperature, top_p: row.top_p, top_k: row.top_k,
    stop_sequences: row.stop_sequences, sampling_preset_name: row.sampling_preset_name, extra_params: row.extra_params,
    deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
  };
}

export async function getAllAnthropicProviderConfigs(includeDeleted = false): Promise<AnthropicProviderConfig[]> {
  const db = getDatabase();
  const query = includeDeleted
    ? `SELECT id, name, api_key, model, max_tokens, temperature, top_p, top_k,
            stop_sequences, sampling_preset_name, extra_params, deleted_at FROM provider_config_anthropic ORDER BY name`
    : `SELECT id, name, api_key, model, max_tokens, temperature, top_p, top_k,
            stop_sequences, sampling_preset_name, extra_params, deleted_at FROM provider_config_anthropic WHERE deleted_at IS NULL ORDER BY name`;
  const [results] = await db.executeSql(query);
  const configs: AnthropicProviderConfig[] = [];
  for (let i = 0; i < results.rows.length; i++) {
    const row = results.rows.item(i);
    configs.push({
      id: row.id, name: row.name, api_key: row.api_key, model: row.model,
      max_tokens: row.max_tokens, temperature: row.temperature, top_p: row.top_p, top_k: row.top_k,
      stop_sequences: row.stop_sequences, sampling_preset_name: row.sampling_preset_name, extra_params: row.extra_params,
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
       SET name = ?, api_key = ?, model = ?, max_tokens = ?, temperature = ?, top_p = ?, top_k = ?,
           stop_sequences = ?, sampling_preset_name = ?, extra_params = ?
       WHERE id = ?`,
      [
        config.name, config.api_key, config.model, config.max_tokens, config.temperature,
        config.top_p, config.top_k, config.stop_sequences, config.sampling_preset_name, config.extra_params,
        config.id,
      ]
    );
    if (result.rowsAffected === 0) throw new Error(`Anthropic provider config not found: ${config.id}`);
  });
}

export async function isAnthropicProviderConfigInUse(id: string): Promise<boolean> {
  return isProviderConfigInUse('anthropic', id);
}

export async function deleteAnthropicProviderConfig(id: string, permanent = false): Promise<void> {
  const db = getDatabase();
  if (!permanent && await isAnthropicProviderConfigInUse(id)) throw new Error(`Anthropic provider config ${id} is in use and cannot be soft deleted`);
  return withTransaction(db, async (tx) => {
    if (permanent) {
      const [result] = await tx.executeSql('DELETE FROM provider_config_anthropic WHERE id = ?', [id]);
      if (result.rowsAffected === 0) throw new Error(`Anthropic provider config not found: ${id}`);
    } else {
      const now = new Date().toISOString();
      const [result] = await tx.executeSql('UPDATE provider_config_anthropic SET deleted_at = ? WHERE id = ?', [now, id]);
      if (result.rowsAffected === 0) throw new Error(`Anthropic provider config not found: ${id}`);
    }
  });
}
