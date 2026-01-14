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
} from '../models';

// ============================================================================
// Backend Config Operations
// ============================================================================

export async function createBackendConfig(
  config: Omit<BackendConfig, 'id'>
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

export async function getBackendConfig(id: number): Promise<BackendConfig | null> {
  const db = getDatabase();
  
  const [results] = await db.executeSql(
    'SELECT id, name, provider, provider_config_id FROM backend_configs WHERE id = ?',
    [id]
  );
  
  if (results.rows.length === 0) {
    return null;
  }
  
  const row = results.rows.item(0);
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    provider_config_id: row.provider_config_id,
  };
}

export async function getBackendConfigByName(name: string): Promise<BackendConfig | null> {
  const db = getDatabase();
  
  const [results] = await db.executeSql(
    'SELECT id, name, provider, provider_config_id FROM backend_configs WHERE name = ?',
    [name]
  );
  
  if (results.rows.length === 0) {
    return null;
  }
  
  const row = results.rows.item(0);
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    provider_config_id: row.provider_config_id,
  };
}

export async function getAllBackendConfigs(): Promise<BackendConfig[]> {
  const db = getDatabase();
  
  const [results] = await db.executeSql(
    'SELECT id, name, provider, provider_config_id FROM backend_configs ORDER BY name'
  );
  
  const configs: BackendConfig[] = [];
  for (let i = 0; i < results.rows.length; i++) {
    const row = results.rows.item(i);
    configs.push({
      id: row.id,
      name: row.name,
      provider: row.provider,
      provider_config_id: row.provider_config_id,
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

export async function deleteBackendConfig(id: number): Promise<void> {
  const db = getDatabase();
  
  return withTransaction(db, async (tx) => {
    const [result] = await tx.executeSql(
      'DELETE FROM backend_configs WHERE id = ?',
      [id]
    );
    
    if (result.rowsAffected === 0) {
      throw new Error(`Backend config not found: ${id}`);
    }
  });
}

// ============================================================================
// Cognition Config Operations
// ============================================================================

export async function createCognitionConfig(
  config: Omit<CognitionConfig, 'id'>
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

export async function getCognitionConfig(id: number): Promise<CognitionConfig | null> {
  const db = getDatabase();
  
  const [results] = await db.executeSql(
    `SELECT id, name, provider, provider_config_id, max_cognition_events, generate_expressions
     FROM cognition_configs WHERE id = ?`,
    [id]
  );
  
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
  };
}

export async function getCognitionConfigByName(name: string): Promise<CognitionConfig | null> {
  const db = getDatabase();
  
  const [results] = await db.executeSql(
    `SELECT id, name, provider, provider_config_id, max_cognition_events, generate_expressions
     FROM cognition_configs WHERE name = ?`,
    [name]
  );
  
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
  };
}

export async function getAllCognitionConfigs(): Promise<CognitionConfig[]> {
  const db = getDatabase();
  
  const [results] = await db.executeSql(
    `SELECT id, name, provider, provider_config_id, max_cognition_events, generate_expressions
     FROM cognition_configs ORDER BY name`
  );
  
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

export async function deleteCognitionConfig(id: number): Promise<void> {
  const db = getDatabase();
  
  return withTransaction(db, async (tx) => {
    const [result] = await tx.executeSql(
      'DELETE FROM cognition_configs WHERE id = ?',
      [id]
    );
    
    if (result.rowsAffected === 0) {
      throw new Error(`Cognition config not found: ${id}`);
    }
  });
}

// ============================================================================
// Movement Config Operations
// ============================================================================

export async function createMovementConfig(
  config: Omit<MovementConfig, 'id'>
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

export async function getMovementConfig(id: number): Promise<MovementConfig | null> {
  const db = getDatabase();
  
  const [results] = await db.executeSql(
    `SELECT id, name, provider, provider_config_id, startup_sync_timeout, execution_threshold
     FROM movement_configs WHERE id = ?`,
    [id]
  );
  
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
  };
}

export async function getMovementConfigByName(name: string): Promise<MovementConfig | null> {
  const db = getDatabase();
  
  const [results] = await db.executeSql(
    `SELECT id, name, provider, provider_config_id, startup_sync_timeout, execution_threshold
     FROM movement_configs WHERE name = ?`,
    [name]
  );
  
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
  };
}

export async function getAllMovementConfigs(): Promise<MovementConfig[]> {
  const db = getDatabase();
  
  const [results] = await db.executeSql(
    `SELECT id, name, provider, provider_config_id, startup_sync_timeout, execution_threshold
     FROM movement_configs ORDER BY name`
  );
  
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

export async function deleteMovementConfig(id: number): Promise<void> {
  const db = getDatabase();
  
  return withTransaction(db, async (tx) => {
    const [result] = await tx.executeSql(
      'DELETE FROM movement_configs WHERE id = ?',
      [id]
    );
    
    if (result.rowsAffected === 0) {
      throw new Error(`Movement config not found: ${id}`);
    }
  });
}

// ============================================================================
// RAG Config Operations
// ============================================================================

export async function createRAGConfig(
  config: Omit<RAGConfig, 'id'>
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

export async function getRAGConfig(id: number): Promise<RAGConfig | null> {
  const db = getDatabase();
  
  const [results] = await db.executeSql(
    `SELECT id, name, provider, provider_config_id, embedding_concurrency
     FROM rag_configs WHERE id = ?`,
    [id]
  );
  
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
  };
}

export async function getRAGConfigByName(name: string): Promise<RAGConfig | null> {
  const db = getDatabase();
  
  const [results] = await db.executeSql(
    `SELECT id, name, provider, provider_config_id, embedding_concurrency
     FROM rag_configs WHERE name = ?`,
    [name]
  );
  
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
  };
}

export async function getAllRAGConfigs(): Promise<RAGConfig[]> {
  const db = getDatabase();
  
  const [results] = await db.executeSql(
    `SELECT id, name, provider, provider_config_id, embedding_concurrency
     FROM rag_configs ORDER BY name`
  );
  
  const configs: RAGConfig[] = [];
  for (let i = 0; i < results.rows.length; i++) {
    const row = results.rows.item(i);
    configs.push({
      id: row.id,
      name: row.name,
      provider: row.provider,
      provider_config_id: row.provider_config_id,
      embedding_concurrency: row.embedding_concurrency,
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

export async function deleteRAGConfig(id: number): Promise<void> {
  const db = getDatabase();
  
  return withTransaction(db, async (tx) => {
    const [result] = await tx.executeSql(
      'DELETE FROM rag_configs WHERE id = ?',
      [id]
    );
    
    if (result.rowsAffected === 0) {
      throw new Error(`RAG config not found: ${id}`);
    }
  });
}

// ============================================================================
// STT Config Operations
// ============================================================================

export async function createSTTConfig(
  config: Omit<STTConfig, 'id'>
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

export async function getSTTConfig(id: number): Promise<STTConfig | null> {
  const db = getDatabase();
  
  const [results] = await db.executeSql(
    `SELECT id, name, main_stream_time_millis, transition_stream_time_millis, max_buffer_count,
            transcription_provider, transcription_provider_config_id,
            vad_provider, vad_provider_config_id
     FROM stt_configs WHERE id = ?`,
    [id]
  );
  
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
  };
}

export async function getSTTConfigByName(name: string): Promise<STTConfig | null> {
  const db = getDatabase();
  
  const [results] = await db.executeSql(
    `SELECT id, name, main_stream_time_millis, transition_stream_time_millis, max_buffer_count,
            transcription_provider, transcription_provider_config_id,
            vad_provider, vad_provider_config_id
     FROM stt_configs WHERE name = ?`,
    [name]
  );
  
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
  };
}

export async function getAllSTTConfigs(): Promise<STTConfig[]> {
  const db = getDatabase();
  
  const [results] = await db.executeSql(
    `SELECT id, name, main_stream_time_millis, transition_stream_time_millis, max_buffer_count,
            transcription_provider, transcription_provider_config_id,
            vad_provider, vad_provider_config_id
     FROM stt_configs ORDER BY name`
  );
  
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

export async function deleteSTTConfig(id: number): Promise<void> {
  const db = getDatabase();
  
  return withTransaction(db, async (tx) => {
    const [result] = await tx.executeSql(
      'DELETE FROM stt_configs WHERE id = ?',
      [id]
    );
    
    if (result.rowsAffected === 0) {
      throw new Error(`STT config not found: ${id}`);
    }
  });
}

// ============================================================================
// TTS Config Operations
// ============================================================================

export async function createTTSConfig(
  config: Omit<TTSConfig, 'id'>
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

export async function getTTSConfig(id: number): Promise<TTSConfig | null> {
  const db = getDatabase();
  
  const [results] = await db.executeSql(
    `SELECT id, name, provider, provider_config_id, output_type, words_to_replace, vocalize_nonverbal
     FROM tts_configs WHERE id = ?`,
    [id]
  );
  
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
  };
}

export async function getTTSConfigByName(name: string): Promise<TTSConfig | null> {
  const db = getDatabase();
  
  const [results] = await db.executeSql(
    `SELECT id, name, provider, provider_config_id, output_type, words_to_replace, vocalize_nonverbal
     FROM tts_configs WHERE name = ?`,
    [name]
  );
  
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
  };
}

export async function getAllTTSConfigs(): Promise<TTSConfig[]> {
  const db = getDatabase();
  
  const [results] = await db.executeSql(
    `SELECT id, name, provider, provider_config_id, output_type, words_to_replace, vocalize_nonverbal
     FROM tts_configs ORDER BY name`
  );
  
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

export async function deleteTTSConfig(id: number): Promise<void> {
  const db = getDatabase();
  
  return withTransaction(db, async (tx) => {
    const [result] = await tx.executeSql(
      'DELETE FROM tts_configs WHERE id = ?',
      [id]
    );
    
    if (result.rowsAffected === 0) {
      throw new Error(`TTS config not found: ${id}`);
    }
  });
}
