import {getDatabase} from '../../connection';
import {withTransaction} from '../../transaction';
import {KajiwotoProviderConfig} from '../../models';
import {isProviderConfigInUse} from './shared';
import {generateId} from '../../../utils/uuid';

export async function createKajiwotoProviderConfig(
  config: Omit<KajiwotoProviderConfig, 'id' | 'deleted_at'>
): Promise<string> {
  const db = getDatabase();
  const id = generateId();
  
  return new Promise<string>((resolve, reject) => {
    db.transaction(
      (tx) => {
        tx.executeSql(
          `INSERT INTO provider_config_kajiwoto (id, name, username, password, room_url) VALUES (?, ?, ?, ?, ?)`,
          [id, config.name, config.username, config.password, config.room_url],
          () => { resolve(id); },
          (_, error) => { reject(error); return false; }
        );
      },
      (error) => reject(error)
    );
  });
}

export async function getKajiwotoProviderConfig(id: string, includeDeleted = false): Promise<KajiwotoProviderConfig | null> {
  const db = getDatabase();
  const query = includeDeleted
    ? 'SELECT id, name, username, password, room_url, deleted_at FROM provider_config_kajiwoto WHERE id = ?'
    : 'SELECT id, name, username, password, room_url, deleted_at FROM provider_config_kajiwoto WHERE id = ? AND deleted_at IS NULL';
  const [results] = await db.executeSql(query, [id]);
  if (results.rows.length === 0) return null;
  const row = results.rows.item(0);
  return { id: row.id, name: row.name, username: row.username, password: row.password, room_url: row.room_url, deleted_at: row.deleted_at ? new Date(row.deleted_at) : null };
}

export async function getKajiwotoProviderConfigByName(name: string, includeDeleted = false): Promise<KajiwotoProviderConfig | null> {
  const db = getDatabase();
  const query = includeDeleted
    ? 'SELECT id, name, username, password, room_url, deleted_at FROM provider_config_kajiwoto WHERE name = ?'
    : 'SELECT id, name, username, password, room_url, deleted_at FROM provider_config_kajiwoto WHERE name = ? AND deleted_at IS NULL';
  const [results] = await db.executeSql(query, [name]);
  if (results.rows.length === 0) return null;
  const row = results.rows.item(0);
  return { id: row.id, name: row.name, username: row.username, password: row.password, room_url: row.room_url, deleted_at: row.deleted_at ? new Date(row.deleted_at) : null };
}

export async function getAllKajiwotoProviderConfigs(includeDeleted = false): Promise<KajiwotoProviderConfig[]> {
  const db = getDatabase();
  const query = includeDeleted
    ? 'SELECT id, name, username, password, room_url, deleted_at FROM provider_config_kajiwoto ORDER BY name'
    : 'SELECT id, name, username, password, room_url, deleted_at FROM provider_config_kajiwoto WHERE deleted_at IS NULL ORDER BY name';
  const [results] = await db.executeSql(query);
  const configs: KajiwotoProviderConfig[] = [];
  for (let i = 0; i < results.rows.length; i++) {
    const row = results.rows.item(i);
    configs.push({ id: row.id, name: row.name, username: row.username, password: row.password, room_url: row.room_url, deleted_at: row.deleted_at ? new Date(row.deleted_at) : null });
  }
  return configs;
}

export async function updateKajiwotoProviderConfig(config: KajiwotoProviderConfig): Promise<void> {
  const db = getDatabase();
  return withTransaction(db, async (tx) => {
    const [result] = await tx.executeSql(
      'UPDATE provider_config_kajiwoto SET name = ?, username = ?, password = ?, room_url = ? WHERE id = ?',
      [config.name, config.username, config.password, config.room_url, config.id]
    );
    if (result.rowsAffected === 0) throw new Error(`Kajiwoto provider config not found: ${config.id}`);
  });
}

export async function isKajiwotoProviderConfigInUse(id: string): Promise<boolean> {
  return isProviderConfigInUse('kajiwoto', id);
}

export async function deleteKajiwotoProviderConfig(id: string, permanent = false): Promise<void> {
  const db = getDatabase();
  if (!permanent && await isKajiwotoProviderConfigInUse(id)) throw new Error(`Kajiwoto provider config ${id} is in use and cannot be soft deleted`);
  return withTransaction(db, async (tx) => {
    if (permanent) {
      const [result] = await tx.executeSql('DELETE FROM provider_config_kajiwoto WHERE id = ?', [id]);
      if (result.rowsAffected === 0) throw new Error(`Kajiwoto provider config not found: ${id}`);
    } else {
      const now = new Date().toISOString();
      const [result] = await tx.executeSql('UPDATE provider_config_kajiwoto SET deleted_at = ? WHERE id = ?', [now, id]);
      if (result.rowsAffected === 0) throw new Error(`Kajiwoto provider config not found: ${id}`);
    }
  });
}
