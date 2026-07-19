import {getDatabase} from '../../connection';
import {withTransaction} from '../../transaction';
import {ElevenLabsProviderConfig} from '../../models';
import {isProviderConfigInUse} from './shared';
import {generateId} from '../../../utils/uuid';

export async function createElevenLabsProviderConfig(
  config: Omit<ElevenLabsProviderConfig, 'id' | 'deleted_at'>
): Promise<string> {
  const db = getDatabase();
  const id = generateId();
  
  return new Promise<string>((resolve, reject) => {
    db.transaction(
      (tx) => {
        tx.executeSql(
          `INSERT INTO provider_config_elevenlabs (id, name, api_key, voice_id, model_id, stability, similarity_boost, style, speaker_boost)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, config.name, config.api_key, config.voice_id, config.model_id, config.stability, config.similarity_boost, config.style, config.speaker_boost],
          () => { resolve(id); },
          (_, error) => { reject(error); return false; }
        );
      },
      (error) => reject(error)
    );
  });
}

export async function getElevenLabsProviderConfig(id: string, includeDeleted = false): Promise<ElevenLabsProviderConfig | null> {
  const db = getDatabase();
  const query = includeDeleted
    ? 'SELECT id, name, api_key, voice_id, model_id, stability, similarity_boost, style, speaker_boost, deleted_at FROM provider_config_elevenlabs WHERE id = ?'
    : 'SELECT id, name, api_key, voice_id, model_id, stability, similarity_boost, style, speaker_boost, deleted_at FROM provider_config_elevenlabs WHERE id = ? AND deleted_at IS NULL';
  const [results] = await db.executeSql(query, [id]);
  if (results.rows.length === 0) return null;
  const row = results.rows.item(0);
  return { id: row.id, name: row.name, api_key: row.api_key, voice_id: row.voice_id, model_id: row.model_id, stability: row.stability, similarity_boost: row.similarity_boost, style: row.style, speaker_boost: row.speaker_boost, deleted_at: row.deleted_at ? new Date(row.deleted_at) : null };
}

export async function getElevenLabsProviderConfigByName(name: string, includeDeleted = false): Promise<ElevenLabsProviderConfig | null> {
  const db = getDatabase();
  const query = includeDeleted
    ? 'SELECT id, name, api_key, voice_id, model_id, stability, similarity_boost, style, speaker_boost, deleted_at FROM provider_config_elevenlabs WHERE name = ?'
    : 'SELECT id, name, api_key, voice_id, model_id, stability, similarity_boost, style, speaker_boost, deleted_at FROM provider_config_elevenlabs WHERE name = ? AND deleted_at IS NULL';
  const [results] = await db.executeSql(query, [name]);
  if (results.rows.length === 0) return null;
  const row = results.rows.item(0);
  return { id: row.id, name: row.name, api_key: row.api_key, voice_id: row.voice_id, model_id: row.model_id, stability: row.stability, similarity_boost: row.similarity_boost, style: row.style, speaker_boost: row.speaker_boost, deleted_at: row.deleted_at ? new Date(row.deleted_at) : null };
}

export async function getAllElevenLabsProviderConfigs(includeDeleted = false): Promise<ElevenLabsProviderConfig[]> {
  const db = getDatabase();
  const query = includeDeleted
    ? 'SELECT id, name, api_key, voice_id, model_id, stability, similarity_boost, style, speaker_boost, deleted_at FROM provider_config_elevenlabs ORDER BY name'
    : 'SELECT id, name, api_key, voice_id, model_id, stability, similarity_boost, style, speaker_boost, deleted_at FROM provider_config_elevenlabs WHERE deleted_at IS NULL ORDER BY name';
  const [results] = await db.executeSql(query);
  const configs: ElevenLabsProviderConfig[] = [];
  for (let i = 0; i < results.rows.length; i++) {
    const row = results.rows.item(i);
    configs.push({ id: row.id, name: row.name, api_key: row.api_key, voice_id: row.voice_id, model_id: row.model_id, stability: row.stability, similarity_boost: row.similarity_boost, style: row.style, speaker_boost: row.speaker_boost, deleted_at: row.deleted_at ? new Date(row.deleted_at) : null });
  }
  return configs;
}

export async function updateElevenLabsProviderConfig(config: ElevenLabsProviderConfig): Promise<void> {
  const db = getDatabase();
  return withTransaction(db, async (tx) => {
    const [result] = await tx.executeSql(
      'UPDATE provider_config_elevenlabs SET name = ?, api_key = ?, voice_id = ?, model_id = ?, stability = ?, similarity_boost = ?, style = ?, speaker_boost = ? WHERE id = ?',
      [config.name, config.api_key, config.voice_id, config.model_id, config.stability, config.similarity_boost, config.style, config.speaker_boost, config.id]
    );
    if (result.rowsAffected === 0) throw new Error(`ElevenLabs provider config not found: ${config.id}`);
  });
}

export async function isElevenLabsProviderConfigInUse(id: string): Promise<boolean> {
  return isProviderConfigInUse('elevenlabs', id);
}

export async function deleteElevenLabsProviderConfig(id: string, permanent = false): Promise<void> {
  const db = getDatabase();
  if (!permanent && await isElevenLabsProviderConfigInUse(id)) throw new Error(`ElevenLabs provider config ${id} is in use and cannot be soft deleted`);
  return withTransaction(db, async (tx) => {
    if (permanent) {
      const [result] = await tx.executeSql('DELETE FROM provider_config_elevenlabs WHERE id = ?', [id]);
      if (result.rowsAffected === 0) throw new Error(`ElevenLabs provider config not found: ${id}`);
    } else {
      const now = new Date().toISOString();
      const [result] = await tx.executeSql('UPDATE provider_config_elevenlabs SET deleted_at = ? WHERE id = ?', [now, id]);
      if (result.rowsAffected === 0) throw new Error(`ElevenLabs provider config not found: ${id}`);
    }
  });
}
