import {getDatabase} from '../../connection';
import {withTransaction} from '../../transaction';
import {ComfyUIProviderConfig} from '../../models';
import {isProviderConfigInUse} from './shared';
import {generateId} from '../../../utils/uuid';

export async function createComfyUIProviderConfig(
  config: Omit<ComfyUIProviderConfig, 'id' | 'deleted_at'>
): Promise<string> {
  const db = getDatabase();
  const id = generateId();
  
  return new Promise<string>((resolve, reject) => {
    db.transaction(
      (tx) => {
        tx.executeSql(
          `INSERT INTO provider_config_comfyui (id, name, base_url, api_key, workflow_profiles) VALUES (?, ?, ?, ?, ?)`,
          [id, config.name, config.base_url, config.api_key, config.workflow_profiles],
          () => { resolve(id); },
          (_, error) => { reject(error); return false; }
        );
      },
      (error) => reject(error)
    );
  });
}

export async function getComfyUIProviderConfig(id: string, includeDeleted = false): Promise<ComfyUIProviderConfig | null> {
  const db = getDatabase();
  const query = includeDeleted
    ? 'SELECT id, name, base_url, api_key, workflow_profiles, deleted_at FROM provider_config_comfyui WHERE id = ?'
    : 'SELECT id, name, base_url, api_key, workflow_profiles, deleted_at FROM provider_config_comfyui WHERE id = ? AND deleted_at IS NULL';
  const [results] = await db.executeSql(query, [id]);
  if (results.rows.length === 0) return null;
  const row = results.rows.item(0);
  return { id: row.id, name: row.name, base_url: row.base_url, api_key: row.api_key, workflow_profiles: row.workflow_profiles, deleted_at: row.deleted_at ? new Date(row.deleted_at) : null };
}

export async function getComfyUIProviderConfigByName(name: string, includeDeleted = false): Promise<ComfyUIProviderConfig | null> {
  const db = getDatabase();
  const query = includeDeleted
    ? 'SELECT id, name, base_url, api_key, workflow_profiles, deleted_at FROM provider_config_comfyui WHERE name = ?'
    : 'SELECT id, name, base_url, api_key, workflow_profiles, deleted_at FROM provider_config_comfyui WHERE name = ? AND deleted_at IS NULL';
  const [results] = await db.executeSql(query, [name]);
  if (results.rows.length === 0) return null;
  const row = results.rows.item(0);
  return { id: row.id, name: row.name, base_url: row.base_url, api_key: row.api_key, workflow_profiles: row.workflow_profiles, deleted_at: row.deleted_at ? new Date(row.deleted_at) : null };
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
    configs.push({ id: row.id, name: row.name, base_url: row.base_url, api_key: row.api_key, workflow_profiles: row.workflow_profiles, deleted_at: row.deleted_at ? new Date(row.deleted_at) : null });
  }
  return configs;
}

export async function updateComfyUIProviderConfig(config: ComfyUIProviderConfig): Promise<void> {
  const db = getDatabase();
  return withTransaction(db, async (tx) => {
    const [result] = await tx.executeSql(
      'UPDATE provider_config_comfyui SET name = ?, base_url = ?, api_key = ?, workflow_profiles = ? WHERE id = ?',
      [config.name, config.base_url, config.api_key, config.workflow_profiles, config.id]
    );
    if (result.rowsAffected === 0) throw new Error(`ComfyUI provider config not found: ${config.id}`);
  });
}

export async function isComfyUIProviderConfigInUse(id: string): Promise<boolean> {
  return isProviderConfigInUse('comfyui', id);
}

export async function deleteComfyUIProviderConfig(id: string, permanent = false): Promise<void> {
  const db = getDatabase();
  if (!permanent && await isComfyUIProviderConfigInUse(id)) throw new Error(`ComfyUI provider config ${id} is in use and cannot be soft deleted`);
  return withTransaction(db, async (tx) => {
    if (permanent) {
      const [result] = await tx.executeSql('DELETE FROM provider_config_comfyui WHERE id = ?', [id]);
      if (result.rowsAffected === 0) throw new Error(`ComfyUI provider config not found: ${id}`);
    } else {
      const now = new Date().toISOString();
      const [result] = await tx.executeSql('UPDATE provider_config_comfyui SET deleted_at = ? WHERE id = ?', [now, id]);
      if (result.rowsAffected === 0) throw new Error(`ComfyUI provider config not found: ${id}`);
    }
  });
}
