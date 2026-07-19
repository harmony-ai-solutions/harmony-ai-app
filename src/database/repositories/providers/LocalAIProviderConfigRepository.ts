import {getDatabase} from '../../connection';
import {withTransaction} from '../../transaction';
import {LocalAIProviderConfig} from '../../models';
import {isProviderConfigInUse} from './shared';
import {generateId} from '../../../utils/uuid';

export async function createLocalAIProviderConfig(
  config: Omit<LocalAIProviderConfig, 'id' | 'deleted_at'>
): Promise<string> {
  const db = getDatabase();
  const id = generateId();
  
  return new Promise<string>((resolve, reject) => {
    db.transaction(
      (tx) => {
        tx.executeSql(
          `INSERT INTO provider_config_localai (id, name, model) VALUES (?, ?, ?)`,
          [id, config.name, config.model],
          () => { resolve(id); },
          (_, error) => { reject(error); return false; }
        );
      },
      (error) => reject(error)
    );
  });
}

export async function getLocalAIProviderConfig(id: string, includeDeleted = false): Promise<LocalAIProviderConfig | null> {
  const db = getDatabase();
  const query = includeDeleted
    ? 'SELECT id, name, model, deleted_at FROM provider_config_localai WHERE id = ?'
    : 'SELECT id, name, model, deleted_at FROM provider_config_localai WHERE id = ? AND deleted_at IS NULL';
  const [results] = await db.executeSql(query, [id]);
  if (results.rows.length === 0) return null;
  const row = results.rows.item(0);
  return { id: row.id, name: row.name, model: row.model, deleted_at: row.deleted_at ? new Date(row.deleted_at) : null };
}

export async function getLocalAIProviderConfigByName(name: string, includeDeleted = false): Promise<LocalAIProviderConfig | null> {
  const db = getDatabase();
  const query = includeDeleted
    ? 'SELECT id, name, model, deleted_at FROM provider_config_localai WHERE name = ?'
    : 'SELECT id, name, model, deleted_at FROM provider_config_localai WHERE name = ? AND deleted_at IS NULL';
  const [results] = await db.executeSql(query, [name]);
  if (results.rows.length === 0) return null;
  const row = results.rows.item(0);
  return { id: row.id, name: row.name, model: row.model, deleted_at: row.deleted_at ? new Date(row.deleted_at) : null };
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
    configs.push({ id: row.id, name: row.name, model: row.model, deleted_at: row.deleted_at ? new Date(row.deleted_at) : null });
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
    if (result.rowsAffected === 0) throw new Error(`LocalAI provider config not found: ${config.id}`);
  });
}

export async function isLocalAIProviderConfigInUse(id: string): Promise<boolean> {
  return isProviderConfigInUse('localai', id);
}

export async function deleteLocalAIProviderConfig(id: string, permanent = false): Promise<void> {
  const db = getDatabase();
  if (!permanent && await isLocalAIProviderConfigInUse(id)) throw new Error(`LocalAI provider config ${id} is in use and cannot be soft deleted`);
  return withTransaction(db, async (tx) => {
    if (permanent) {
      const [result] = await tx.executeSql('DELETE FROM provider_config_localai WHERE id = ?', [id]);
      if (result.rowsAffected === 0) throw new Error(`LocalAI provider config not found: ${id}`);
    } else {
      const now = new Date().toISOString();
      const [result] = await tx.executeSql('UPDATE provider_config_localai SET deleted_at = ? WHERE id = ?', [now, id]);
      if (result.rowsAffected === 0) throw new Error(`LocalAI provider config not found: ${id}`);
    }
  });
}
