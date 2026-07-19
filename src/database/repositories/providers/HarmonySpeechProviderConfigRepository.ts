import {getDatabase} from '../../connection';
import {withTransaction} from '../../transaction';
import {HarmonySpeechProviderConfig} from '../../models';
import {isProviderConfigInUse} from './shared';
import {generateId} from '../../../utils/uuid';

export async function createHarmonySpeechProviderConfig(
  config: Omit<HarmonySpeechProviderConfig, 'id' | 'deleted_at'>
): Promise<string> {
  const db = getDatabase();
  const id = generateId();
  
  return new Promise<string>((resolve, reject) => {
    db.transaction(
      (tx) => {
        tx.executeSql(
          `INSERT INTO provider_config_harmonyspeech (id, name, endpoint, model, voice_config_file, format, sample_rate, stream)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, config.name, config.endpoint, config.model, config.voice_config_file, config.format, config.sample_rate, config.stream],
          () => { resolve(id); },
          (_, error) => { reject(error); return false; }
        );
      },
      (error) => reject(error)
    );
  });
}

export async function getHarmonySpeechProviderConfig(id: string, includeDeleted = false): Promise<HarmonySpeechProviderConfig | null> {
  const db = getDatabase();
  const query = includeDeleted
    ? 'SELECT id, name, endpoint, model, voice_config_file, format, sample_rate, stream, deleted_at FROM provider_config_harmonyspeech WHERE id = ?'
    : 'SELECT id, name, endpoint, model, voice_config_file, format, sample_rate, stream, deleted_at FROM provider_config_harmonyspeech WHERE id = ? AND deleted_at IS NULL';
  const [results] = await db.executeSql(query, [id]);
  if (results.rows.length === 0) return null;
  const row = results.rows.item(0);
  return { id: row.id, name: row.name, endpoint: row.endpoint, model: row.model, voice_config_file: row.voice_config_file, format: row.format, sample_rate: row.sample_rate, stream: row.stream, deleted_at: row.deleted_at ? new Date(row.deleted_at) : null };
}

export async function getHarmonySpeechProviderConfigByName(name: string, includeDeleted = false): Promise<HarmonySpeechProviderConfig | null> {
  const db = getDatabase();
  const query = includeDeleted
    ? 'SELECT id, name, endpoint, model, voice_config_file, format, sample_rate, stream, deleted_at FROM provider_config_harmonyspeech WHERE name = ?'
    : 'SELECT id, name, endpoint, model, voice_config_file, format, sample_rate, stream, deleted_at FROM provider_config_harmonyspeech WHERE name = ? AND deleted_at IS NULL';
  const [results] = await db.executeSql(query, [name]);
  if (results.rows.length === 0) return null;
  const row = results.rows.item(0);
  return { id: row.id, name: row.name, endpoint: row.endpoint, model: row.model, voice_config_file: row.voice_config_file, format: row.format, sample_rate: row.sample_rate, stream: row.stream, deleted_at: row.deleted_at ? new Date(row.deleted_at) : null };
}

export async function getAllHarmonySpeechProviderConfigs(includeDeleted = false): Promise<HarmonySpeechProviderConfig[]> {
  const db = getDatabase();
  const query = includeDeleted
    ? 'SELECT id, name, endpoint, model, voice_config_file, format, sample_rate, stream, deleted_at FROM provider_config_harmonyspeech ORDER BY name'
    : 'SELECT id, name, endpoint, model, voice_config_file, format, sample_rate, stream, deleted_at FROM provider_config_harmonyspeech WHERE deleted_at IS NULL ORDER BY name';
  const [results] = await db.executeSql(query);
  const configs: HarmonySpeechProviderConfig[] = [];
  for (let i = 0; i < results.rows.length; i++) {
    const row = results.rows.item(i);
    configs.push({ id: row.id, name: row.name, endpoint: row.endpoint, model: row.model, voice_config_file: row.voice_config_file, format: row.format, sample_rate: row.sample_rate, stream: row.stream, deleted_at: row.deleted_at ? new Date(row.deleted_at) : null });
  }
  return configs;
}

export async function updateHarmonySpeechProviderConfig(config: HarmonySpeechProviderConfig): Promise<void> {
  const db = getDatabase();
  return withTransaction(db, async (tx) => {
    const [result] = await tx.executeSql(
      'UPDATE provider_config_harmonyspeech SET name = ?, endpoint = ?, model = ?, voice_config_file = ?, format = ?, sample_rate = ?, stream = ? WHERE id = ?',
      [config.name, config.endpoint, config.model, config.voice_config_file, config.format, config.sample_rate, config.stream, config.id]
    );
    if (result.rowsAffected === 0) throw new Error(`HarmonySpeech provider config not found: ${config.id}`);
  });
}

export async function isHarmonySpeechProviderConfigInUse(id: string): Promise<boolean> {
  return isProviderConfigInUse('harmonyspeech', id);
}

export async function deleteHarmonySpeechProviderConfig(id: string, permanent = false): Promise<void> {
  const db = getDatabase();
  if (!permanent && await isHarmonySpeechProviderConfigInUse(id)) throw new Error(`HarmonySpeech provider config ${id} is in use and cannot be soft deleted`);
  return withTransaction(db, async (tx) => {
    if (permanent) {
      const [result] = await tx.executeSql('DELETE FROM provider_config_harmonyspeech WHERE id = ?', [id]);
      if (result.rowsAffected === 0) throw new Error(`HarmonySpeech provider config not found: ${id}`);
    } else {
      const now = new Date().toISOString();
      const [result] = await tx.executeSql('UPDATE provider_config_harmonyspeech SET deleted_at = ? WHERE id = ?', [now, id]);
      if (result.rowsAffected === 0) throw new Error(`HarmonySpeech provider config not found: ${id}`);
    }
  });
}
