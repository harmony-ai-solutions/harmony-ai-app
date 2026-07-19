import {getDatabase} from '../../connection';
import {withTransaction} from '../../transaction';
import {CharacterAIProviderConfig} from '../../models';
import {isProviderConfigInUse} from './shared';
import {generateId} from '../../../utils/uuid';

export async function createCharacterAIProviderConfig(
  config: Omit<CharacterAIProviderConfig, 'id' | 'deleted_at'>
): Promise<string> {
  const db = getDatabase();
  const id = generateId();
  
  return new Promise<string>((resolve, reject) => {
    db.transaction(
      (tx) => {
        tx.executeSql(
          `INSERT INTO provider_config_characterai (id, name, api_token, chatroom_url) VALUES (?, ?, ?, ?)`,
          [id, config.name, config.api_token, config.chatroom_url],
          () => { resolve(id); },
          (_, error) => { reject(error); return false; }
        );
      },
      (error) => reject(error)
    );
  });
}

export async function getCharacterAIProviderConfig(id: string, includeDeleted = false): Promise<CharacterAIProviderConfig | null> {
  const db = getDatabase();
  const query = includeDeleted
    ? 'SELECT id, name, api_token, chatroom_url, deleted_at FROM provider_config_characterai WHERE id = ?'
    : 'SELECT id, name, api_token, chatroom_url, deleted_at FROM provider_config_characterai WHERE id = ? AND deleted_at IS NULL';
  const [results] = await db.executeSql(query, [id]);
  if (results.rows.length === 0) return null;
  const row = results.rows.item(0);
  return { id: row.id, name: row.name, api_token: row.api_token, chatroom_url: row.chatroom_url, deleted_at: row.deleted_at ? new Date(row.deleted_at) : null };
}

export async function getCharacterAIProviderConfigByName(name: string, includeDeleted = false): Promise<CharacterAIProviderConfig | null> {
  const db = getDatabase();
  const query = includeDeleted
    ? 'SELECT id, name, api_token, chatroom_url, deleted_at FROM provider_config_characterai WHERE name = ?'
    : 'SELECT id, name, api_token, chatroom_url, deleted_at FROM provider_config_characterai WHERE name = ? AND deleted_at IS NULL';
  const [results] = await db.executeSql(query, [name]);
  if (results.rows.length === 0) return null;
  const row = results.rows.item(0);
  return { id: row.id, name: row.name, api_token: row.api_token, chatroom_url: row.chatroom_url, deleted_at: row.deleted_at ? new Date(row.deleted_at) : null };
}

export async function getAllCharacterAIProviderConfigs(includeDeleted = false): Promise<CharacterAIProviderConfig[]> {
  const db = getDatabase();
  const query = includeDeleted
    ? 'SELECT id, name, api_token, chatroom_url, deleted_at FROM provider_config_characterai ORDER BY name'
    : 'SELECT id, name, api_token, chatroom_url, deleted_at FROM provider_config_characterai WHERE deleted_at IS NULL ORDER BY name';
  const [results] = await db.executeSql(query);
  const configs: CharacterAIProviderConfig[] = [];
  for (let i = 0; i < results.rows.length; i++) {
    const row = results.rows.item(i);
    configs.push({ id: row.id, name: row.name, api_token: row.api_token, chatroom_url: row.chatroom_url, deleted_at: row.deleted_at ? new Date(row.deleted_at) : null });
  }
  return configs;
}

export async function updateCharacterAIProviderConfig(config: CharacterAIProviderConfig): Promise<void> {
  const db = getDatabase();
  return withTransaction(db, async (tx) => {
    const [result] = await tx.executeSql(
      'UPDATE provider_config_characterai SET name = ?, api_token = ?, chatroom_url = ? WHERE id = ?',
      [config.name, config.api_token, config.chatroom_url, config.id]
    );
    if (result.rowsAffected === 0) throw new Error(`CharacterAI provider config not found: ${config.id}`);
  });
}

export async function isCharacterAIProviderConfigInUse(id: string): Promise<boolean> {
  return isProviderConfigInUse('characterai', id);
}

export async function deleteCharacterAIProviderConfig(id: string, permanent = false): Promise<void> {
  const db = getDatabase();
  if (!permanent && await isCharacterAIProviderConfigInUse(id)) throw new Error(`CharacterAI provider config ${id} is in use and cannot be soft deleted`);
  return withTransaction(db, async (tx) => {
    if (permanent) {
      const [result] = await tx.executeSql('DELETE FROM provider_config_characterai WHERE id = ?', [id]);
      if (result.rowsAffected === 0) throw new Error(`CharacterAI provider config not found: ${id}`);
    } else {
      const now = new Date().toISOString();
      const [result] = await tx.executeSql('UPDATE provider_config_characterai SET deleted_at = ? WHERE id = ?', [now, id]);
      if (result.rowsAffected === 0) throw new Error(`CharacterAI provider config not found: ${id}`);
    }
  });
}
