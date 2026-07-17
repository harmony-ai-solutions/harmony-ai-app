import {getDatabase} from '../../connection';
import {withTransaction} from '../../transaction';
import {OllamaProviderConfig} from '../../models';
import {isProviderConfigInUse} from './shared';
import {generateId} from '../../../utils/uuid';

export async function createOllamaProviderConfig(
  config: Omit<OllamaProviderConfig, 'id' | 'deleted_at'>
): Promise<string> {
  const db = getDatabase();
  const id = generateId();
  
  return new Promise<string>((resolve, reject) => {
    db.transaction(
      (tx) => {
        tx.executeSql(
          `INSERT INTO provider_config_ollama (id, name, base_url, model) VALUES (?, ?, ?, ?)`,
          [id, config.name, config.base_url, config.model],
          () => { resolve(id); },
          (_, error) => { reject(error); return false; }
        );
      },
      (error) => reject(error)
    );
  });
}

export async function getOllamaProviderConfig(id: string, includeDeleted = false): Promise<OllamaProviderConfig | null> {
  const db = getDatabase();
  const query = includeDeleted
    ? 'SELECT id, name, base_url, model, deleted_at FROM provider_config_ollama WHERE id = ?'
    : 'SELECT id, name, base_url, model, deleted_at FROM provider_config_ollama WHERE id = ? AND deleted_at IS NULL';
  const [results] = await db.executeSql(query, [id]);
  if (results.rows.length === 0) return null;
  const row = results.rows.item(0);
  return { id: row.id, name: row.name, base_url: row.base_url, model: row.model, deleted_at: row.deleted_at ? new Date(row.deleted_at) : null };
}

export async function getOllamaProviderConfigByName(name: string, includeDeleted = false): Promise<OllamaProviderConfig | null> {
  const db = getDatabase();
  const query = includeDeleted
    ? 'SELECT id, name, base_url, model, deleted_at FROM provider_config_ollama WHERE name = ?'
    : 'SELECT id, name, base_url, model, deleted_at FROM provider_config_ollama WHERE name = ? AND deleted_at IS NULL';
  const [results] = await db.executeSql(query, [name]);
  if (results.rows.length === 0) return null;
  const row = results.rows.item(0);
  return { id: row.id, name: row.name, base_url: row.base_url, model: row.model, deleted_at: row.deleted_at ? new Date(row.deleted_at) : null };
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
    configs.push({ id: row.id, name: row.name, base_url: row.base_url, model: row.model, deleted_at: row.deleted_at ? new Date(row.deleted_at) : null });
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
    if (result.rowsAffected === 0) throw new Error(`Ollama provider config not found: ${config.id}`);
  });
}

export async function isOllamaProviderConfigInUse(id: string): Promise<boolean> {
  return isProviderConfigInUse('ollama', id);
}

export async function deleteOllamaProviderConfig(id: string, permanent = false): Promise<void> {
  const db = getDatabase();
  if (!permanent && await isOllamaProviderConfigInUse(id)) throw new Error(`Ollama provider config ${id} is in use and cannot be soft deleted`);
  return withTransaction(db, async (tx) => {
    if (permanent) {
      const [result] = await tx.executeSql('DELETE FROM provider_config_ollama WHERE id = ?', [id]);
      if (result.rowsAffected === 0) throw new Error(`Ollama provider config not found: ${id}`);
    } else {
      const now = new Date().toISOString();
      const [result] = await tx.executeSql('UPDATE provider_config_ollama SET deleted_at = ? WHERE id = ?', [now, id]);
      if (result.rowsAffected === 0) throw new Error(`Ollama provider config not found: ${id}`);
    }
  });
}
