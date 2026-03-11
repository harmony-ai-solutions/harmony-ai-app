/**
 * Module Configuration Repositories
 * 
 * Provides CRUD operations for all module configuration types:
 * - Backend, Cognition, Movement, RAG, STT, TTS
 * 
 * Mirrors the Go implementation in harmony-link-private/database/repository/modules/
 */

import {getDatabase} from '../connection';
import {withTransaction} from '../transaction';
import {
  BackendConfig,
  CognitionConfig,
  MovementConfig,
  RAGConfig,
  STTConfig,
  TTSConfig,
  VisionConfig,
} from '../models';

// ============================================================================
// Backend Config Operations
// ============================================================================

export async function createBackendConfig(
  config: Omit<BackendConfig, 'id' | 'deleted_at'>
): Promise<number> {
  const db = getDatabase();
  
  return new Promise<number>((resolve, reject) => {
    db.transaction(
      (tx) => {
        tx.executeSql(
          `INSERT INTO backend_configs (name, provider, provider_config_id)
           VALUES (?, ?, ?)`,
          [config.name, config.provider, config.provider_config_id],
          (_, result) => {
            resolve(result.insertId!);
          },
          (_, error) => {
            reject(error);
            return false;
          }
        );
      },
      (error) => reject(error)
    );
  });
}

export async function getBackendConfig(id: number, includeDeleted = false): Promise<BackendConfig | null> {
  const db = getDatabase();
  
  const query = includeDeleted
    ? 'SELECT id, name, provider, provider_config_id, deleted_at FROM backend_configs WHERE id = ?'
    : 'SELECT id, name, provider, provider_config_id, deleted_at FROM backend_configs WHERE id = ? AND deleted_at IS NULL';

  const [results] = await db.executeSql(query, [id]);
  
  if (results.rows.length === 0) {
    return null;
  }
  
  const row = results.rows.item(0);
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    provider_config_id: row.provider_config_id,
    deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
  };
}

export async function getBackendConfigByName(name: string, includeDeleted = false): Promise<BackendConfig | null> {
  const db = getDatabase();
  
  const query = includeDeleted
    ? 'SELECT id, name, provider, provider_config_id, deleted_at FROM backend_configs WHERE name = ?'
    : 'SELECT id, name, provider, provider_config_id, deleted_at FROM backend_configs WHERE name = ? AND deleted_at IS NULL';

  const [results] = await db.executeSql(query, [name]);
  
  if (results.rows.length === 0) {
    return null;
  }
  
  const row = results.rows.item(0);
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    provider_config_id: row.provider_config_id,
    deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
  };
}

export async function getAllBackendConfigs(includeDeleted = false): Promise<BackendConfig[]> {
  const db = getDatabase();
  
  const query = includeDeleted
    ? 'SELECT id, name, provider, provider_config_id, deleted_at FROM backend_configs ORDER BY name'
    : 'SELECT id, name, provider, provider_config_id, deleted_at FROM backend_configs WHERE deleted_at IS NULL ORDER BY name';

  const [results] = await db.executeSql(query);
  
  const configs: BackendConfig[] = [];
  for (let i = 0; i < results.rows.length; i++) {
    const row = results.rows.item(i);
    configs.push({
      id: row.id,
      name: row.name,
      provider: row.provider,
      provider_config_id: row.provider_config_id,
      deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
    });
  }
  
  return configs;
}

export async function updateBackendConfig(config: BackendConfig): Promise<void> {
  const db = getDatabase();
  
  return withTransaction(db, async (tx) => {
    const [result] = await tx.executeSql(
      `UPDATE backend_configs
       SET name = ?, provider = ?, provider_config_id = ?
       WHERE id = ?`,
      [config.name, config.provider, config.provider_config_id, config.id]
    );
    
    if (result.rowsAffected === 0) {
      throw new Error(`Backend config not found: ${config.id}`);
    }
  });
}

/**
 * Check if a backend config is in use by any entities
 */
export async function isBackendConfigInUse(id: number): Promise<boolean> {
  const db = getDatabase();
  const [results] = await db.executeSql(
    'SELECT COUNT(*) as count FROM entity_module_mappings WHERE backend_config_id = ? AND deleted_at IS NULL',
    [id]
  );
  return results.rows.item(0).count > 0;
}

export async function deleteBackendConfig(id: number, permanent = false): Promise<void> {
  const db = getDatabase();
  
  if (!permanent && await isBackendConfigInUse(id)) {
    throw new Error(`Backend config ${id} is in use and cannot be soft deleted`);
  }

  return withTransaction(db, async (tx) => {
    if (permanent) {
      const [result] = await tx.executeSql('DELETE FROM backend_configs WHERE id = ?', [id]);
      if (result.rowsAffected === 0) {
        throw new Error(`Backend config not found: ${id}`);
      }
    } else {
      const now = new Date().toISOString();
      const [result] = await tx.executeSql(
        'UPDATE backend_configs SET deleted_at = ? WHERE id = ?',
        [now, id]
      );
      if (result.rowsAffected === 0) {
        throw new Error(`Backend config not found: ${id}`);
      }
    }
  });
}

// ============================================================================
// Cognition Config Operations
// ============================================================================

export async function createCognitionConfig(
  config: Omit<CognitionConfig, 'id' | 'deleted_at'>
): Promise<number> {
  const db = getDatabase();
  
  return new Promise<number>((resolve, reject) => {
    db.transaction(
      (tx) => {
        tx.executeSql(
          `INSERT INTO cognition_configs (name, provider, provider_config_id, max_cognition_events, generate_expressions)
           VALUES (?, ?, ?, ?, ?)`,
          [
            config.name,
            config.provider,
            config.provider_config_id,
            config.max_cognition_events,
            config.generate_expressions,
          ],
          (_, result) => {
            resolve(result.insertId!);
          },
          (_, error) => {
            reject(error);
            return false;
          }
        );
      },
      (error) => reject(error)
    );
  });
}

export async function getCognitionConfig(id: number, includeDeleted = false): Promise<CognitionConfig | null> {
  const db = getDatabase();
  
  const query = includeDeleted
    ? `SELECT id, name, provider, provider_config_id, max_cognition_events, generate_expressions, deleted_at
     FROM cognition_configs WHERE id = ?`
    : `SELECT id, name, provider, provider_config_id, max_cognition_events, generate_expressions, deleted_at
     FROM cognition_configs WHERE id = ? AND deleted_at IS NULL`;

  const [results] = await db.executeSql(query, [id]);
  
  if (results.rows.length === 0) {
    return null;
  }
  
  const row = results.rows.item(0);
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    provider_config_id: row.provider_config_id,
    max_cognition_events: row.max_cognition_events,
    generate_expressions: row.generate_expressions,
    deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
  };
}

export async function getCognitionConfigByName(name: string, includeDeleted = false): Promise<CognitionConfig | null> {
  const db = getDatabase();
  
  const query = includeDeleted
    ? `SELECT id, name, provider, provider_config_id, max_cognition_events, generate_expressions, deleted_at
     FROM cognition_configs WHERE name = ?`
    : `SELECT id, name, provider, provider_config_id, max_cognition_events, generate_expressions, deleted_at
     FROM cognition_configs WHERE name = ? AND deleted_at IS NULL`;

  const [results] = await db.executeSql(query, [name]);
  
  if (results.rows.length === 0) {
    return null;
  }
  
  const row = results.rows.item(0);
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    provider_config_id: row.provider_config_id,
    max_cognition_events: row.max_cognition_events,
    generate_expressions: row.generate_expressions,
    deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
  };
}

export async function getAllCognitionConfigs(includeDeleted = false): Promise<CognitionConfig[]> {
  const db = getDatabase();
  
  const query = includeDeleted
    ? `SELECT id, name, provider, provider_config_id, max_cognition_events, generate_expressions, deleted_at
     FROM cognition_configs ORDER BY name`
    : `SELECT id, name, provider, provider_config_id, max_cognition_events, generate_expressions, deleted_at
     FROM cognition_configs WHERE deleted_at IS NULL ORDER BY name`;

  const [results] = await db.executeSql(query);
  
  const configs: CognitionConfig[] = [];
  for (let i = 0; i < results.rows.length; i++) {
    const row = results.rows.item(i);
    configs.push({
      id: row.id,
      name: row.name,
      provider: row.provider,
      provider_config_id: row.provider_config_id,
      max_cognition_events: row.max_cognition_events,
      generate_expressions: row.generate_expressions,
      deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
    });
  }
  
  return configs;
}

export async function updateCognitionConfig(config: CognitionConfig): Promise<void> {
  const db = getDatabase();
  
  return withTransaction(db, async (tx) => {
    const [result] = await tx.executeSql(
      `UPDATE cognition_configs
       SET name = ?, provider = ?, provider_config_id = ?, max_cognition_events = ?, generate_expressions = ?
       WHERE id = ?`,
      [
        config.name,
        config.provider,
        config.provider_config_id,
        config.max_cognition_events,
        config.generate_expressions,
        config.id,
      ]
    );
    
    if (result.rowsAffected === 0) {
      throw new Error(`Cognition config not found: ${config.id}`);
    }
  });
}

/**
 * Check if a cognition config is in use by any entities
 */
export async function isCognitionConfigInUse(id: number): Promise<boolean> {
  const db = getDatabase();
  const [results] = await db.executeSql(
    'SELECT COUNT(*) as count FROM entity_module_mappings WHERE cognition_config_id = ? AND deleted_at IS NULL',
    [id]
  );
  return results.rows.item(0).count > 0;
}

export async function deleteCognitionConfig(id: number, permanent = false): Promise<void> {
  const db = getDatabase();
  
  if (!permanent && await isCognitionConfigInUse(id)) {
    throw new Error(`Cognition config ${id} is in use and cannot be soft deleted`);
  }

  return withTransaction(db, async (tx) => {
    if (permanent) {
      const [result] = await tx.executeSql('DELETE FROM cognition_configs WHERE id = ?', [id]);
      if (result.rowsAffected === 0) {
        throw new Error(`Cognition config not found: ${id}`);
      }
    } else {
      const now = new Date().toISOString();
      const [result] = await tx.executeSql(
        'UPDATE cognition_configs SET deleted_at = ? WHERE id = ?',
        [now, id]
      );
      if (result.rowsAffected === 0) {
        throw new Error(`Cognition config not found: ${id}`);
      }
    }
  });
}

// ============================================================================
// Movement Config Operations
// ============================================================================

export async function createMovementConfig(
  config: Omit<MovementConfig, 'id' | 'deleted_at'>
): Promise<number> {
  const db = getDatabase();
  
  return new Promise<number>((resolve, reject) => {
    db.transaction(
      (tx) => {
        tx.executeSql(
          `INSERT INTO movement_configs (name, provider, provider_config_id, startup_sync_timeout, execution_threshold)
           VALUES (?, ?, ?, ?, ?)`,
          [
            config.name,
            config.provider,
            config.provider_config_id,
            config.startup_sync_timeout,
            config.execution_threshold,
          ],
          (_, result) => {
            resolve(result.insertId!);
          },
          (_, error) => {
            reject(error);
            return false;
          }
        );
      },
      (error) => reject(error)
    );
  });
}

export async function getMovementConfig(id: number, includeDeleted = false): Promise<MovementConfig | null> {
  const db = getDatabase();
  
  const query = includeDeleted
    ? `SELECT id, name, provider, provider_config_id, startup_sync_timeout, execution_threshold, deleted_at
     FROM movement_configs WHERE id = ?`
    : `SELECT id, name, provider, provider_config_id, startup_sync_timeout, execution_threshold, deleted_at
     FROM movement_configs WHERE id = ? AND deleted_at IS NULL`;

  const [results] = await db.executeSql(query, [id]);
  
  if (results.rows.length === 0) {
    return null;
  }
  
  const row = results.rows.item(0);
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    provider_config_id: row.provider_config_id,
    startup_sync_timeout: row.startup_sync_timeout,
    execution_threshold: row.execution_threshold,
    deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
  };
}

export async function getMovementConfigByName(name: string, includeDeleted = false): Promise<MovementConfig | null> {
  const db = getDatabase();
  
  const query = includeDeleted
    ? `SELECT id, name, provider, provider_config_id, startup_sync_timeout, execution_threshold, deleted_at
     FROM movement_configs WHERE name = ?`
    : `SELECT id, name, provider, provider_config_id, startup_sync_timeout, execution_threshold, deleted_at
     FROM movement_configs WHERE name = ? AND deleted_at IS NULL`;

  const [results] = await db.executeSql(query, [name]);
  
  if (results.rows.length === 0) {
    return null;
  }
  
  const row = results.rows.item(0);
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    provider_config_id: row.provider_config_id,
    startup_sync_timeout: row.startup_sync_timeout,
    execution_threshold: row.execution_threshold,
    deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
  };
}

export async function getAllMovementConfigs(includeDeleted = false): Promise<MovementConfig[]> {
  const db = getDatabase();
  
  const query = includeDeleted
    ? `SELECT id, name, provider, provider_config_id, startup_sync_timeout, execution_threshold, deleted_at
     FROM movement_configs ORDER BY name`
    : `SELECT id, name, provider, provider_config_id, startup_sync_timeout, execution_threshold, deleted_at
     FROM movement_configs WHERE deleted_at IS NULL ORDER BY name`;

  const [results] = await db.executeSql(query);
  
  const configs: MovementConfig[] = [];
  for (let i = 0; i < results.rows.length; i++) {
    const row = results.rows.item(i);
    configs.push({
      id: row.id,
      name: row.name,
      provider: row.provider,
      provider_config_id: row.provider_config_id,
      startup_sync_timeout: row.startup_sync_timeout,
      execution_threshold: row.execution_threshold,
      deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
    });
  }
  
  return configs;
}

export async function updateMovementConfig(config: MovementConfig): Promise<void> {
  const db = getDatabase();
  
  return withTransaction(db, async (tx) => {
    const [result] = await tx.executeSql(
      `UPDATE movement_configs
       SET name = ?, provider = ?, provider_config_id = ?, startup_sync_timeout = ?, execution_threshold = ?
       WHERE id = ?`,
      [
        config.name,
        config.provider,
        config.provider_config_id,
        config.startup_sync_timeout,
        config.execution_threshold,
        config.id,
      ]
    );
    
    if (result.rowsAffected === 0) {
      throw new Error(`Movement config not found: ${config.id}`);
    }
  });
}

/**
 * Check if a movement config is in use by any entities
 */
export async function isMovementConfigInUse(id: number): Promise<boolean> {
  const db = getDatabase();
  const [results] = await db.executeSql(
    'SELECT COUNT(*) as count FROM entity_module_mappings WHERE movement_config_id = ? AND deleted_at IS NULL',
    [id]
  );
  return results.rows.item(0).count > 0;
}

export async function deleteMovementConfig(id: number, permanent = false): Promise<void> {
  const db = getDatabase();
  
  if (!permanent && await isMovementConfigInUse(id)) {
    throw new Error(`Movement config ${id} is in use and cannot be soft deleted`);
  }

  return withTransaction(db, async (tx) => {
    if (permanent) {
      const [result] = await tx.executeSql('DELETE FROM movement_configs WHERE id = ?', [id]);
      if (result.rowsAffected === 0) {
        throw new Error(`Movement config not found: ${id}`);
      }
    } else {
      const now = new Date().toISOString();
      const [result] = await tx.executeSql(
        'UPDATE movement_configs SET deleted_at = ? WHERE id = ?',
        [now, id]
      );
      if (result.rowsAffected === 0) {
        throw new Error(`Movement config not found: ${id}`);
      }
    }
  });
}

// ============================================================================
// RAG Config Operations
// ============================================================================

export async function createRAGConfig(
  config: Omit<RAGConfig, 'id' | 'deleted_at'>
): Promise<number> {
  const db = getDatabase();
  
  return new Promise<number>((resolve, reject) => {
    db.transaction(
      (tx) => {
        tx.executeSql(
          `INSERT INTO rag_configs (name, provider, provider_config_id, embedding_concurrency)
           VALUES (?, ?, ?, ?)`,
          [
            config.name,
            config.provider,
            config.provider_config_id,
            config.embedding_concurrency,
          ],
          (_, result) => {
            resolve(result.insertId!);
          },
          (_, error) => {
            reject(error);
            return false;
          }
        );
      },
      (error) => reject(error)
    );
  });
}

export async function getRAGConfig(id: number, includeDeleted = false): Promise<RAGConfig | null> {
  const db = getDatabase();
  
  const query = includeDeleted
    ? `SELECT id, name, provider, provider_config_id, embedding_concurrency, deleted_at
     FROM rag_configs WHERE id = ?`
    : `SELECT id, name, provider, provider_config_id, embedding_concurrency, deleted_at
     FROM rag_configs WHERE id = ? AND deleted_at IS NULL`;

  const [results] = await db.executeSql(query, [id]);
  
  if (results.rows.length === 0) {
    return null;
  }
  
  const row = results.rows.item(0);
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    provider_config_id: row.provider_config_id,
    embedding_concurrency: row.embedding_concurrency,
    deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
  };
}

export async function getRAGConfigByName(name: string, includeDeleted = false): Promise<RAGConfig | null> {
  const db = getDatabase();
  
  const query = includeDeleted
    ? `SELECT id, name, provider, provider_config_id, embedding_concurrency, deleted_at
     FROM rag_configs WHERE name = ?`
    : `SELECT id, name, provider, provider_config_id, embedding_concurrency, deleted_at
     FROM rag_configs WHERE name = ? AND deleted_at IS NULL`;

  const [results] = await db.executeSql(query, [name]);
  
  if (results.rows.length === 0) {
    return null;
  }
  
  const row = results.rows.item(0);
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    provider_config_id: row.provider_config_id,
    embedding_concurrency: row.embedding_concurrency,
    deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
  };
}

export async function getAllRAGConfigs(includeDeleted = false): Promise<RAGConfig[]> {
  const db = getDatabase();
  
  const query = includeDeleted
    ? `SELECT id, name, provider, provider_config_id, embedding_concurrency, deleted_at
     FROM rag_configs ORDER BY name`
    : `SELECT id, name, provider, provider_config_id, embedding_concurrency, deleted_at
     FROM rag_configs WHERE deleted_at IS NULL ORDER BY name`;

  const [results] = await db.executeSql(query);
  
  const configs: RAGConfig[] = [];
  for (let i = 0; i < results.rows.length; i++) {
    const row = results.rows.item(i);
    configs.push({
      id: row.id,
      name: row.name,
      provider: row.provider,
      provider_config_id: row.provider_config_id,
      embedding_concurrency: row.embedding_concurrency,
      deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
    });
  }
  
  return configs;
}

export async function updateRAGConfig(config: RAGConfig): Promise<void> {
  const db = getDatabase();
  
  return withTransaction(db, async (tx) => {
    const [result] = await tx.executeSql(
      `UPDATE rag_configs
       SET name = ?, provider = ?, provider_config_id = ?, embedding_concurrency = ?
       WHERE id = ?`,
      [
        config.name,
        config.provider,
        config.provider_config_id,
        config.embedding_concurrency,
        config.id,
      ]
    );
    
    if (result.rowsAffected === 0) {
      throw new Error(`RAG config not found: ${config.id}`);
    }
  });
}

/**
 * Check if a RAG config is in use by any entities
 */
export async function isRAGConfigInUse(id: number): Promise<boolean> {
  const db = getDatabase();
  const [results] = await db.executeSql(
    'SELECT COUNT(*) as count FROM entity_module_mappings WHERE rag_config_id = ? AND deleted_at IS NULL',
    [id]
  );
  return results.rows.item(0).count > 0;
}

export async function deleteRAGConfig(id: number, permanent = false): Promise<void> {
  const db = getDatabase();
  
  if (!permanent && await isRAGConfigInUse(id)) {
    throw new Error(`RAG config ${id} is in use and cannot be soft deleted`);
  }

  return withTransaction(db, async (tx) => {
    if (permanent) {
      const [result] = await tx.executeSql('DELETE FROM rag_configs WHERE id = ?', [id]);
      if (result.rowsAffected === 0) {
        throw new Error(`RAG config not found: ${id}`);
      }
    } else {
      const now = new Date().toISOString();
      const [result] = await tx.executeSql(
        'UPDATE rag_configs SET deleted_at = ? WHERE id = ?',
        [now, id]
      );
      if (result.rowsAffected === 0) {
        throw new Error(`RAG config not found: ${id}`);
      }
    }
  });
}

// ============================================================================
// STT Config Operations
// ============================================================================

export async function createSTTConfig(
  config: Omit<STTConfig, 'id' | 'deleted_at'>
): Promise<number> {
  const db = getDatabase();
  
  return new Promise<number>((resolve, reject) => {
    db.transaction(
      (tx) => {
        tx.executeSql(
          `INSERT INTO stt_configs (
            name, main_stream_time_millis, transition_stream_time_millis, max_buffer_count,
            transcription_provider, transcription_provider_config_id,
            vad_provider, vad_provider_config_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            config.name,
            config.main_stream_time_millis,
            config.transition_stream_time_millis,
            config.max_buffer_count,
            config.transcription_provider,
            config.transcription_provider_config_id,
            config.vad_provider,
            config.vad_provider_config_id,
          ],
          (_, result) => {
            resolve(result.insertId!);
          },
          (_, error) => {
            reject(error);
            return false;
          }
        );
      },
      (error) => reject(error)
    );
  });
}

export async function getSTTConfig(id: number, includeDeleted = false): Promise<STTConfig | null> {
  const db = getDatabase();
  
  const query = includeDeleted
    ? `SELECT id, name, main_stream_time_millis, transition_stream_time_millis, max_buffer_count,
            transcription_provider, transcription_provider_config_id,
            vad_provider, vad_provider_config_id, deleted_at
     FROM stt_configs WHERE id = ?`
    : `SELECT id, name, main_stream_time_millis, transition_stream_time_millis, max_buffer_count,
            transcription_provider, transcription_provider_config_id,
            vad_provider, vad_provider_config_id, deleted_at
     FROM stt_configs WHERE id = ? AND deleted_at IS NULL`;

  const [results] = await db.executeSql(query, [id]);
  
  if (results.rows.length === 0) {
    return null;
  }
  
  const row = results.rows.item(0);
  return {
    id: row.id,
    name: row.name,
    main_stream_time_millis: row.main_stream_time_millis,
    transition_stream_time_millis: row.transition_stream_time_millis,
    max_buffer_count: row.max_buffer_count,
    transcription_provider: row.transcription_provider,
    transcription_provider_config_id: row.transcription_provider_config_id,
    vad_provider: row.vad_provider,
    vad_provider_config_id: row.vad_provider_config_id,
    deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
  };
}

export async function getSTTConfigByName(name: string, includeDeleted = false): Promise<STTConfig | null> {
  const db = getDatabase();
  
  const query = includeDeleted
    ? `SELECT id, name, main_stream_time_millis, transition_stream_time_millis, max_buffer_count,
            transcription_provider, transcription_provider_config_id,
            vad_provider, vad_provider_config_id, deleted_at
     FROM stt_configs WHERE name = ?`
    : `SELECT id, name, main_stream_time_millis, transition_stream_time_millis, max_buffer_count,
            transcription_provider, transcription_provider_config_id,
            vad_provider, vad_provider_config_id, deleted_at
     FROM stt_configs WHERE name = ? AND deleted_at IS NULL`;

  const [results] = await db.executeSql(query, [name]);
  
  if (results.rows.length === 0) {
    return null;
  }
  
  const row = results.rows.item(0);
  return {
    id: row.id,
    name: row.name,
    main_stream_time_millis: row.main_stream_time_millis,
    transition_stream_time_millis: row.transition_stream_time_millis,
    max_buffer_count: row.max_buffer_count,
    transcription_provider: row.transcription_provider,
    transcription_provider_config_id: row.transcription_provider_config_id,
    vad_provider: row.vad_provider,
    vad_provider_config_id: row.vad_provider_config_id,
    deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
  };
}

export async function getAllSTTConfigs(includeDeleted = false): Promise<STTConfig[]> {
  const db = getDatabase();
  
  const query = includeDeleted
    ? `SELECT id, name, main_stream_time_millis, transition_stream_time_millis, max_buffer_count,
            transcription_provider, transcription_provider_config_id,
            vad_provider, vad_provider_config_id, deleted_at
     FROM stt_configs ORDER BY name`
    : `SELECT id, name, main_stream_time_millis, transition_stream_time_millis, max_buffer_count,
            transcription_provider, transcription_provider_config_id,
            vad_provider, vad_provider_config_id, deleted_at
     FROM stt_configs WHERE deleted_at IS NULL ORDER BY name`;

  const [results] = await db.executeSql(query);
  
  const configs: STTConfig[] = [];
  for (let i = 0; i < results.rows.length; i++) {
    const row = results.rows.item(i);
    configs.push({
      id: row.id,
      name: row.name,
      main_stream_time_millis: row.main_stream_time_millis,
      transition_stream_time_millis: row.transition_stream_time_millis,
      max_buffer_count: row.max_buffer_count,
      transcription_provider: row.transcription_provider,
      transcription_provider_config_id: row.transcription_provider_config_id,
      vad_provider: row.vad_provider,
      vad_provider_config_id: row.vad_provider_config_id,
      deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
    });
  }
  
  return configs;
}

export async function updateSTTConfig(config: STTConfig): Promise<void> {
  const db = getDatabase();
  
  return withTransaction(db, async (tx) => {
    const [result] = await tx.executeSql(
      `UPDATE stt_configs
       SET name = ?, main_stream_time_millis = ?, transition_stream_time_millis = ?, max_buffer_count = ?,
           transcription_provider = ?, transcription_provider_config_id = ?,
           vad_provider = ?, vad_provider_config_id = ?
       WHERE id = ?`,
      [
        config.name,
        config.main_stream_time_millis,
        config.transition_stream_time_millis,
        config.max_buffer_count,
        config.transcription_provider,
        config.transcription_provider_config_id,
        config.vad_provider,
        config.vad_provider_config_id,
        config.id,
      ]
    );
    
    if (result.rowsAffected === 0) {
      throw new Error(`STT config not found: ${config.id}`);
    }
  });
}

/**
 * Check if an STT config is in use by any entities
 */
export async function isSTTConfigInUse(id: number): Promise<boolean> {
  const db = getDatabase();
  const [results] = await db.executeSql(
    'SELECT COUNT(*) as count FROM entity_module_mappings WHERE stt_config_id = ? AND deleted_at IS NULL',
    [id]
  );
  return results.rows.item(0).count > 0;
}

export async function deleteSTTConfig(id: number, permanent = false): Promise<void> {
  const db = getDatabase();
  
  if (!permanent && await isSTTConfigInUse(id)) {
    throw new Error(`STT config ${id} is in use and cannot be soft deleted`);
  }

  return withTransaction(db, async (tx) => {
    if (permanent) {
      const [result] = await tx.executeSql('DELETE FROM stt_configs WHERE id = ?', [id]);
      if (result.rowsAffected === 0) {
        throw new Error(`STT config not found: ${id}`);
      }
    } else {
      const now = new Date().toISOString();
      const [result] = await tx.executeSql(
        'UPDATE stt_configs SET deleted_at = ? WHERE id = ?',
        [now, id]
      );
      if (result.rowsAffected === 0) {
        throw new Error(`STT config not found: ${id}`);
      }
    }
  });
}

// ============================================================================
// TTS Config Operations
// ============================================================================

export async function createTTSConfig(
  config: Omit<TTSConfig, 'id' | 'deleted_at'>
): Promise<number> {
  const db = getDatabase();
  
  return new Promise<number>((resolve, reject) => {
    db.transaction(
      (tx) => {
        tx.executeSql(
          `INSERT INTO tts_configs (name, provider, provider_config_id, output_type, words_to_replace, vocalize_nonverbal)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            config.name,
            config.provider,
            config.provider_config_id,
            config.output_type,
            config.words_to_replace,
            config.vocalize_nonverbal,
          ],
          (_, result) => {
            resolve(result.insertId!);
          },
          (_, error) => {
            reject(error);
            return false;
          }
        );
      },
      (error) => reject(error)
    );
  });
}

export async function getTTSConfig(id: number, includeDeleted = false): Promise<TTSConfig | null> {
  const db = getDatabase();
  
  const query = includeDeleted
    ? `SELECT id, name, provider, provider_config_id, output_type, words_to_replace, vocalize_nonverbal, deleted_at
     FROM tts_configs WHERE id = ?`
    : `SELECT id, name, provider, provider_config_id, output_type, words_to_replace, vocalize_nonverbal, deleted_at
     FROM tts_configs WHERE id = ? AND deleted_at IS NULL`;

  const [results] = await db.executeSql(query, [id]);
  
  if (results.rows.length === 0) {
    return null;
  }
  
  const row = results.rows.item(0);
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    provider_config_id: row.provider_config_id,
    output_type: row.output_type,
    words_to_replace: row.words_to_replace,
    vocalize_nonverbal: row.vocalize_nonverbal,
    deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
  };
}

export async function getTTSConfigByName(name: string, includeDeleted = false): Promise<TTSConfig | null> {
  const db = getDatabase();
  
  const query = includeDeleted
    ? `SELECT id, name, provider, provider_config_id, output_type, words_to_replace, vocalize_nonverbal, deleted_at
     FROM tts_configs WHERE name = ?`
    : `SELECT id, name, provider, provider_config_id, output_type, words_to_replace, vocalize_nonverbal, deleted_at
     FROM tts_configs WHERE name = ? AND deleted_at IS NULL`;

  const [results] = await db.executeSql(query, [name]);
  
  if (results.rows.length === 0) {
    return null;
  }
  
  const row = results.rows.item(0);
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    provider_config_id: row.provider_config_id,
    output_type: row.output_type,
    words_to_replace: row.words_to_replace,
    vocalize_nonverbal: row.vocalize_nonverbal,
    deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
  };
}

export async function getAllTTSConfigs(includeDeleted = false): Promise<TTSConfig[]> {
  const db = getDatabase();
  
  const query = includeDeleted
    ? `SELECT id, name, provider, provider_config_id, output_type, words_to_replace, vocalize_nonverbal, deleted_at
     FROM tts_configs ORDER BY name`
    : `SELECT id, name, provider, provider_config_id, output_type, words_to_replace, vocalize_nonverbal, deleted_at
     FROM tts_configs WHERE deleted_at IS NULL ORDER BY name`;

  const [results] = await db.executeSql(query);
  
  const configs: TTSConfig[] = [];
  for (let i = 0; i < results.rows.length; i++) {
    const row = results.rows.item(i);
    configs.push({
      id: row.id,
      name: row.name,
      provider: row.provider,
      provider_config_id: row.provider_config_id,
      output_type: row.output_type,
      words_to_replace: row.words_to_replace,
      vocalize_nonverbal: row.vocalize_nonverbal,
      deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
    });
  }
  
  return configs;
}

export async function updateTTSConfig(config: TTSConfig): Promise<void> {
  const db = getDatabase();
  
  return withTransaction(db, async (tx) => {
    const [result] = await tx.executeSql(
      `UPDATE tts_configs
       SET name = ?, provider = ?, provider_config_id = ?, output_type = ?, words_to_replace = ?, vocalize_nonverbal = ?
       WHERE id = ?`,
      [
        config.name,
        config.provider,
        config.provider_config_id,
        config.output_type,
        config.words_to_replace,
        config.vocalize_nonverbal,
        config.id,
      ]
    );
    
    if (result.rowsAffected === 0) {
      throw new Error(`TTS config not found: ${config.id}`);
    }
  });
}

/**
 * Check if a TTS config is in use by any entities
 */
export async function isTTSConfigInUse(id: number): Promise<boolean> {
  const db = getDatabase();
  const [results] = await db.executeSql(
    'SELECT COUNT(*) as count FROM entity_module_mappings WHERE tts_config_id = ? AND deleted_at IS NULL',
    [id]
  );
  return results.rows.item(0).count > 0;
}

export async function deleteTTSConfig(id: number, permanent = false): Promise<void> {
  const db = getDatabase();
  
  if (!permanent && await isTTSConfigInUse(id)) {
    throw new Error(`TTS config ${id} is in use and cannot be soft deleted`);
  }

  return withTransaction(db, async (tx) => {
    if (permanent) {
      const [result] = await tx.executeSql('DELETE FROM tts_configs WHERE id = ?', [id]);
      if (result.rowsAffected === 0) {
        throw new Error(`TTS config not found: ${id}`);
      }
    } else {
      const now = new Date().toISOString();
      const [result] = await tx.executeSql(
        'UPDATE tts_configs SET deleted_at = ? WHERE id = ?',
        [now, id]
      );
      if (result.rowsAffected === 0) {
        throw new Error(`TTS config not found: ${id}`);
      }
    }
  });
}

// ============================================================================
// Vision Config Operations
// ============================================================================

export async function createVisionConfig(
  config: Omit<VisionConfig, 'id' | 'deleted_at'>
): Promise<number> {
  const db = getDatabase();
  
  return new Promise<number>((resolve, reject) => {
    db.transaction(
      (tx) => {
        tx.executeSql(
          `INSERT INTO vision_configs (name, provider, provider_config_id, resolution_width, resolution_height)
           VALUES (?, ?, ?, ?, ?)`,
          [
            config.name,
            config.provider,
            config.provider_config_id,
            config.resolution_width,
            config.resolution_height,
          ],
          (_, result) => {
            resolve(result.insertId!);
          },
          (_, error) => {
            reject(error);
            return false;
          }
        );
      },
      (error) => reject(error)
    );
  });
}

export async function getVisionConfig(id: number, includeDeleted = false): Promise<VisionConfig | null> {
  const db = getDatabase();
  
  const query = includeDeleted
    ? 'SELECT id, name, provider, provider_config_id, resolution_width, resolution_height, deleted_at FROM vision_configs WHERE id = ?'
    : 'SELECT id, name, provider, provider_config_id, resolution_width, resolution_height, deleted_at FROM vision_configs WHERE id = ? AND deleted_at IS NULL';

  const [results] = await db.executeSql(query, [id]);
  
  if (results.rows.length === 0) {
    return null;
  }
  
  const row = results.rows.item(0);
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    provider_config_id: row.provider_config_id,
    resolution_width: row.resolution_width,
    resolution_height: row.resolution_height,
    deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
  };
}

export async function getVisionConfigByName(name: string, includeDeleted = false): Promise<VisionConfig | null> {
  const db = getDatabase();
  
  const query = includeDeleted
    ? 'SELECT id, name, provider, provider_config_id, resolution_width, resolution_height, deleted_at FROM vision_configs WHERE name = ?'
    : 'SELECT id, name, provider, provider_config_id, resolution_width, resolution_height, deleted_at FROM vision_configs WHERE name = ? AND deleted_at IS NULL';

  const [results] = await db.executeSql(query, [name]);
  
  if (results.rows.length === 0) {
    return null;
  }
  
  const row = results.rows.item(0);
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    provider_config_id: row.provider_config_id,
    resolution_width: row.resolution_width,
    resolution_height: row.resolution_height,
    deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
  };
}

export async function getAllVisionConfigs(includeDeleted = false): Promise<VisionConfig[]> {
  const db = getDatabase();
  
  const query = includeDeleted
    ? 'SELECT id, name, provider, provider_config_id, resolution_width, resolution_height, deleted_at FROM vision_configs ORDER BY name'
    : 'SELECT id, name, provider, provider_config_id, resolution_width, resolution_height, deleted_at FROM vision_configs WHERE deleted_at IS NULL ORDER BY name';

  const [results] = await db.executeSql(query);
  
  const configs: VisionConfig[] = [];
  for (let i = 0; i < results.rows.length; i++) {
    const row = results.rows.item(i);
    configs.push({
      id: row.id,
      name: row.name,
      provider: row.provider,
      provider_config_id: row.provider_config_id,
      resolution_width: row.resolution_width,
      resolution_height: row.resolution_height,
      deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
    });
  }
  
  return configs;
}

export async function updateVisionConfig(config: VisionConfig): Promise<void> {
  const db = getDatabase();
  
  return withTransaction(db, async (tx) => {
    const [result] = await tx.executeSql(
      `UPDATE vision_configs
       SET name = ?, provider = ?, provider_config_id = ?, resolution_width = ?, resolution_height = ?
       WHERE id = ?`,
      [config.name, config.provider, config.provider_config_id, config.resolution_width, config.resolution_height, config.id]
    );
    
    if (result.rowsAffected === 0) {
      throw new Error(`Vision config not found: ${config.id}`);
    }
  });
}

/**
 * Check if a vision config is in use by any entities
 */
export async function isVisionConfigInUse(id: number): Promise<boolean> {
  const db = getDatabase();
  const [results] = await db.executeSql(
    'SELECT COUNT(*) as count FROM entity_module_mappings WHERE vision_config_id = ? AND deleted_at IS NULL',
    [id]
  );
  return results.rows.item(0).count > 0;
}

export async function deleteVisionConfig(id: number, permanent = false): Promise<void> {
  const db = getDatabase();
  
  if (!permanent && await isVisionConfigInUse(id)) {
    throw new Error(`Vision config ${id} is in use and cannot be soft deleted`);
  }

  return withTransaction(db, async (tx) => {
    if (permanent) {
      const [result] = await tx.executeSql('DELETE FROM vision_configs WHERE id = ?', [id]);
      if (result.rowsAffected === 0) {
        throw new Error(`Vision config not found: ${id}`);
      }
    } else {
      const now = new Date().toISOString();
      const [result] = await tx.executeSql(
        'UPDATE vision_configs SET deleted_at = ? WHERE id = ?',
        [now, id]
      );
      if (result.rowsAffected === 0) {
        throw new Error(`Vision config not found: ${id}`);
      }
    }
  });
}
