import {getDatabase} from '../../connection';
import {withTransaction} from '../../transaction';
import {MistralProviderConfig} from '../../models';
import {isProviderConfigInUse} from './shared';
import {generateId} from '../../../utils/uuid';

export async function createMistralProviderConfig(
  config: Omit<MistralProviderConfig, 'id' | 'deleted_at'>
): Promise<string> {
  const db = getDatabase();
  const id = generateId();
  
  return new Promise<string>((resolve, reject) => {
    db.transaction(
      (tx) => {
        tx.executeSql(
          `INSERT INTO provider_config_mistral (id, name, api_key) VALUES (?, ?, ?)`,
          [id, config.name, config.api_key],
          () => { resolve(id); },
          (_, error) => { reject(error); return false; }
        );
      },
      (error) => reject(error)
    );
  });
}

export async function getMistralProviderConfig(id: string, includeDeleted = false): Promise<MistralProviderConfig | null> {
  const db = getDatabase();
  const query = includeDeleted
    ? 'SELECT id, name, api_key, deleted_at FROM provider_config_mistral WHERE id = ?'
    : 'SELECT id, name, api_key, deleted_at FROM provider_config_mistral WHERE id = ? AND deleted_at IS NULL';
  const [results] = await db.executeSql(query, [id]);
  if (results.rows.length === 0) return null;
  const row = results.rows.item(0);
  return { id: row.id, name: row.name, api_key: row.api_key, deleted_at: row.deleted_at ? new Date(row.deleted_at) : null };
}

export async function getMistralProviderConfigByName(name: string, includeDeleted = false): Promise<MistralProviderConfig | null> {
  const db = getDatabase();
  const query = includeDeleted
    ? 'SELECT id, name, api_key, deleted_at FROM provider_config_mistral WHERE name = ?'
    : 'SELECT id, name, api_key, deleted_at FROM provider_config_mistral WHERE name = ? AND deleted_at IS NULL';
  const [results] = await db.executeSql(query, [name]);
  if (results.rows.length === 0) return null;
  const row = results.rows.item(0);
  return { id: row.id, name: row.name, api_key: row.api_key, deleted_at: row.deleted_at ? new Date(row.deleted_at) : null };
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
    configs.push({ id: row.id, name: row.name, api_key: row.api_key, deleted_at: row.deleted_at ? new Date(row.deleted_at) : null });
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
    if (result.rowsAffected === 0) throw new Error(`Mistral provider config not found: ${config.id}`);
  });
}

export async function isMistralProviderConfigInUse(id: string): Promise<boolean> {
  return isProviderConfigInUse('mistral', id);
}

export async function deleteMistralProviderConfig(id: string, permanent = false): Promise<void> {
  const db = getDatabase();
  if (!permanent && await isMistralProviderConfigInUse(id)) throw new Error(`Mistral provider config ${id} is in use and cannot be soft deleted`);
  return withTransaction(db, async (tx) => {
    if (permanent) {
      const [result] = await tx.executeSql('DELETE FROM provider_config_mistral WHERE id = ?', [id]);
      if (result.rowsAffected === 0) throw new Error(`Mistral provider config not found: ${id}`);
    } else {
      const now = new Date().toISOString();
      const [result] = await tx.executeSql('UPDATE provider_config_mistral SET deleted_at = ? WHERE id = ?', [now, id]);
      if (result.rowsAffected === 0) throw new Error(`Mistral provider config not found: ${id}`);
    }
  });
}
