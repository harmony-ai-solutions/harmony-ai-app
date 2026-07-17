import {getDatabase} from '../../connection';

/**
 * Check if a provider config is referenced by any active module config.
 * Checks ALL module tables so it's future-proof — if a provider gains
 * new module support later, it's automatically covered.
 * 
 * stt_configs uses a dual-FK schema (transcription_provider_config_id +
 * vad_provider_config_id) instead of the standard provider_config_id.
 */
export async function isProviderConfigInUse(providerName: string, id: string): Promise<boolean> {
  const db = getDatabase();
  const checkQuery = `
    SELECT COUNT(*) as count FROM (
      SELECT 1 FROM backend_configs WHERE provider = ? AND provider_config_id = ? AND deleted_at IS NULL
      UNION ALL
      SELECT 1 FROM cognition_configs WHERE provider = ? AND provider_config_id = ? AND deleted_at IS NULL
      UNION ALL
      SELECT 1 FROM movement_configs WHERE provider = ? AND provider_config_id = ? AND deleted_at IS NULL
      UNION ALL
      SELECT 1 FROM vision_configs WHERE provider = ? AND provider_config_id = ? AND deleted_at IS NULL
      UNION ALL
      SELECT 1 FROM tts_configs WHERE provider = ? AND provider_config_id = ? AND deleted_at IS NULL
      UNION ALL
      SELECT 1 FROM imagination_configs WHERE provider = ? AND provider_config_id = ? AND deleted_at IS NULL
      UNION ALL
      SELECT 1 FROM rag_configs WHERE provider = ? AND provider_config_id = ? AND deleted_at IS NULL
      UNION ALL
      SELECT 1 FROM stt_configs WHERE transcription_provider = ? AND transcription_provider_config_id = ? AND deleted_at IS NULL
      UNION ALL
      SELECT 1 FROM stt_configs WHERE vad_provider = ? AND vad_provider_config_id = ? AND deleted_at IS NULL
    )
  `;
  // 9 arms, each with 2 params = 18 total
  const params = [providerName, id, providerName, id, providerName, id, providerName, id,
                  providerName, id, providerName, id, providerName, id, providerName, id,
                  providerName, id];
  const [results] = await db.executeSql(checkQuery, params);
  return results.rows.item(0).count > 0;
}
