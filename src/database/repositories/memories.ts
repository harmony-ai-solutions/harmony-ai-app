import { getDatabase } from '../connection';
import { Memory } from '../models';

/**
 * Insert a new memory row.
 */
export async function insertMemory(memory: Memory): Promise<void> {
  const db = getDatabase();

  await db.executeSql(
    `INSERT INTO memories (
      id, entity_id, compaction_level, content,
      emotional_state_bits, start_date, end_date,
      created_at, updated_at, deleted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      memory.id,
      memory.entity_id,
      memory.compaction_level,
      memory.content,
      memory.emotional_state_bits,
      memory.start_date ? memory.start_date.toISOString() : null,
      memory.end_date ? memory.end_date.toISOString() : null,
      memory.created_at instanceof Date ? memory.created_at.toISOString() : memory.created_at,
      memory.updated_at instanceof Date ? memory.updated_at.toISOString() : memory.updated_at,
      memory.deleted_at ? memory.deleted_at.toISOString() : null,
    ]
  );
}

/**
 * Upsert a memory row (INSERT OR REPLACE by id).
 * Used when receiving sync updates from Harmony Link.
 */
export async function upsertMemory(memory: Memory): Promise<void> {
  const db = getDatabase();

  await db.executeSql(
    `INSERT OR REPLACE INTO memories (
      id, entity_id, compaction_level, content,
      emotional_state_bits, start_date, end_date,
      created_at, updated_at, deleted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      memory.id,
      memory.entity_id,
      memory.compaction_level,
      memory.content,
      memory.emotional_state_bits,
      memory.start_date ? memory.start_date.toISOString() : null,
      memory.end_date ? memory.end_date.toISOString() : null,
      memory.created_at instanceof Date ? memory.created_at.toISOString() : memory.created_at,
      memory.updated_at instanceof Date ? memory.updated_at.toISOString() : memory.updated_at,
      memory.deleted_at ? memory.deleted_at.toISOString() : null,
    ]
  );
}

/**
 * Get all memories for an entity, ordered by creation time ascending.
 */
export async function getMemoriesForEntity(entityId: string): Promise<Memory[]> {
  const db = getDatabase();
  const [result] = await db.executeSql(
    `SELECT * FROM memories WHERE entity_id = ? ORDER BY created_at ASC`,
    [entityId]
  );

  const memories: Memory[] = [];
  for (let i = 0; i < result.rows.length; i++) {
    memories.push(mapRowToMemory(result.rows.item(i)));
  }
  return memories;
}

function mapRowToMemory(row: any): Memory {
  return {
    id: row.id,
    entity_id: row.entity_id,
    compaction_level: row.compaction_level,
    content: row.content,
    emotional_state_bits: row.emotional_state_bits,
    start_date: row.start_date ? new Date(row.start_date) : null,
    end_date: row.end_date ? new Date(row.end_date) : null,
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at),
    deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
  };
}