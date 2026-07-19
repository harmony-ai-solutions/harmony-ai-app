import {getDatabase} from '../../connection';
import {withTransaction} from '../../transaction';
import {KindroidProviderConfig} from '../../models';
import {isProviderConfigInUse} from './shared';
import {generateId} from '../../../utils/uuid';

export async function createKindroidProviderConfig(
  config: Omit<KindroidProviderConfig, 'id' | 'deleted_at'>
): Promise<string> {
  const db = getDatabase();
  const id = generateId();
  
  return new Promise<string>((resolve, reject) => {
    db.transaction(
      (tx) => {
        tx.executeSql(
          `INSERT INTO provider_config_kindroid (id, name, api_key, kindroid_id) VALUES (?, ?, ?, ?)`,
          [id, config.name, config.api_key, config.kindroid_id],
          () => { resolve(id); },
          (_, error) => { reject(error); return false; }
        );
      },
      (error) => reject(error)
    );
  });
}

export async function getKindroidProviderConfig(id: string, includeDeleted = false): Promise<KindroidProviderConfig | null> {
  const db = getDatabase();
  const query = includeDeleted
    ? 'SELECT id, name, api_key, kindroid_id, deleted_at FROM provider_config_kindroid WHERE id = ?'
    : 'SELECT id, name, api_key, kindroid_id, deleted_at FROM provider_config_kindroid WHERE id = ? AND deleted_at IS NULL';
  const [results] = await db.executeSql(query, [id]);
  if (results.rows.length === 0) return null;
  const row = results.rows.item(0);
  return { id: row.id, name: row.name, api_key: row.api_key, kindroid_id: row.kindroid_id, deleted_at: row.deleted_at ? new Date(row.deleted_at) : null };
}

export async function getKindroidProviderConfigByName(name: string, includeDeleted = false): Promise<KindroidProviderConfig | null> {
  const db = getDatabase();
  const query = includeDeleted
    ? 'SELECT id, name, api_key, kindroid_id, deleted_at FROM provider_config_kindroid WHERE name = ?'
    : 'SELECT id, name, api_key, kindroid_id, deleted_at FROM provider_config_kindroid WHERE name = ? AND deleted_at IS NULL';
  const [results] = await db.executeSql(query, [name]);
  if (results.rows.length === 0) return null;
  const row = results.rows.item(0);
  return { id: row.id, name: row.name, api_key: row.api_key, kindroid_id: row.kindroid_id, deleted_at: row.deleted_at ? new Date(row.deleted_at) : null };
}

export async function getAllKindroidProviderConfigs(includeDeleted = false): Promise<KindroidProviderConfig[]> {
  const db = getDatabase();
  const query = includeDeleted
    ? 'SELECT id, name, api_key, kindroid_id, deleted_at FROM provider_config_kindroid ORDER BY name'
    : 'SELECT id, name, api_key, kindroid_id, deleted_at FROM provider_config_kindroid WHERE deleted_at IS NULL ORDER BY name';
  const [results] = await db.executeSql(query);
  const configs: KindroidProviderConfig[] = [];
  for (let i = 0; i < results.rows.length; i++) {
    const row = results.rows.item(i);
    configs.push({ id: row.id, name: row.name, api_key: row.api_key, kindroid_id: row.kindroid_id, deleted_at: row.deleted_at ? new Date(row.deleted_at) : null });
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
    if (result.rowsAffected === 0) throw new Error(`Kindroid provider config not found: ${config.id}`);
  });
}

export async function isKindroidProviderConfigInUse(id: string): Promise<boolean> {
  return isProviderConfigInUse('kindroid', id);
}

export async function deleteKindroidProviderConfig(id: string, permanent = false): Promise<void> {
  const db = getDatabase();
  if (!permanent && await isKindroidProviderConfigInUse(id)) throw new Error(`Kindroid provider config ${id} is in use and cannot be soft deleted`);
  return withTransaction(db, async (tx) => {
    if (permanent) {
      const [result] = await tx.executeSql('DELETE FROM provider_config_kindroid WHERE id = ?', [id]);
      if (result.rowsAffected === 0) throw new Error(`Kindroid provider config not found: ${id}`);
    } else {
      const now = new Date().toISOString();
      const [result] = await tx.executeSql('UPDATE provider_config_kindroid SET deleted_at = ? WHERE id = ?', [now, id]);
      if (result.rowsAffected === 0) throw new Error(`Kindroid provider config not found: ${id}`);
    }
  });
}
