/**
 * Entity Repository
 *
 * Provides CRUD operations for entities and entity module mappings.
 * Mirrors the Go implementation in harmony-link-private/database/repository/entities/
 */

import { getDatabase } from '../connection';
import {
  withTransaction,
  runStatementsInTransaction,
} from '../transaction';
import { Entity, EntityModuleMapping } from '../models';

// ============================================================================
// Entity CRUD Operations
// ============================================================================

/**
 * Create a new entity
 */
export async function createEntity(
  entity: Omit<Entity, 'created_at' | 'updated_at' | 'deleted_at'>,
): Promise<Entity> {
  const db = getDatabase();

  return withTransaction(db, async tx => {
    const now = new Date().toISOString();

    await tx.executeSql(
      `INSERT INTO entities (id, alias, character_profile_id, lifecycle_config, rag_reindex_required, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        entity.id,
        entity.alias || '',
        entity.character_profile_id,
        entity.lifecycle_config ?? null,
        entity.rag_reindex_required ?? 1,
        now,
        now,
      ],
    );

    return {
      ...entity,
      created_at: new Date(now),
      updated_at: new Date(now),
      deleted_at: null,
    };
  });
}

/**
 * Get entity by ID
 * Returns null if not found or if soft deleted (unless includeDeleted is true)
 */
export async function getEntity(
  id: string,
  includeDeleted = false,
): Promise<Entity | null> {
  const db = getDatabase();

  const query = includeDeleted
    ? 'SELECT * FROM entities WHERE id = ?'
    : 'SELECT * FROM entities WHERE id = ? AND deleted_at IS NULL';

  const [results] = await db.executeSql(query, [id]);

  if (results.rows.length === 0) {
    return null;
  }

  const row = results.rows.item(0);
  return {
    id: row.id,
    alias: row.alias,
    character_profile_id: row.character_profile_id,
    lifecycle_config: row.lifecycle_config ?? null,
    rag_reindex_required: row.rag_reindex_required ?? 1,
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at),
    deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
  };
}

/**
 * Get all entities
 * Returns empty array if none found. Filters out soft deleted by default.
 */
export async function getAllEntities(
  includeDeleted = false,
): Promise<Entity[]> {
  const db = getDatabase();

  const query = includeDeleted
    ? 'SELECT * FROM entities ORDER BY id'
    : 'SELECT * FROM entities WHERE deleted_at IS NULL ORDER BY id';

  const [results] = await db.executeSql(query);

  const entities: Entity[] = [];
  for (let i = 0; i < results.rows.length; i++) {
    const row = results.rows.item(i);
    entities.push({
      id: row.id,
      alias: row.alias,
      character_profile_id: row.character_profile_id,
      lifecycle_config: row.lifecycle_config ?? null,
      rag_reindex_required: row.rag_reindex_required ?? 1,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
      deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
    });
  }

  return entities;
}

/**
 * Update an existing entity
 * Throws error if entity not found
 */
export async function updateEntity(entity: Entity): Promise<Entity> {
  const db = getDatabase();

  // First check if entity exists
  const existing = await getEntity(entity.id);
  if (!existing) {
    throw new Error(`Entity not found: ${entity.id}`);
  }

  return withTransaction(db, async tx => {
    const now = new Date().toISOString();

    await tx.executeSql(
      `UPDATE entities
       SET alias = ?, character_profile_id = ?, lifecycle_config = ?, rag_reindex_required = ?, updated_at = ?
       WHERE id = ?`,
      [
        entity.alias || '',
        entity.character_profile_id,
        entity.lifecycle_config ?? null,
        entity.rag_reindex_required ?? 1,
        now,
        entity.id,
      ],
    );

    return {
      ...entity,
      updated_at: new Date(now),
    };
  });
}

/**
 * Update specific fields on an entity (partial update)
 * Supports updating character_profile_id, alias, and lifecycle_config fields.
 * Throws error if entity not found.
 */
export async function updateEntityFields(
  id: string,
  fields: Partial<
    Pick<Entity, 'character_profile_id' | 'alias' | 'lifecycle_config' | 'rag_reindex_required'>
  >,
): Promise<void> {
  const db = getDatabase();

  const now = new Date().toISOString();
  const setClauses: string[] = ['updated_at = ?'];
  const values: any[] = [now];

  if ('character_profile_id' in fields) {
    setClauses.push('character_profile_id = ?');
    values.push(fields.character_profile_id ?? null);
  }
  if ('alias' in fields) {
    setClauses.push('alias = ?');
    values.push(fields.alias ?? '');
  }
  if ('lifecycle_config' in fields) {
    setClauses.push('lifecycle_config = ?');
    values.push(fields.lifecycle_config ?? null);
  }
  if ('rag_reindex_required' in fields) {
    setClauses.push('rag_reindex_required = ?');
    values.push(fields.rag_reindex_required ?? 1);
  }

  values.push(id);

  const [result] = await db.executeSql(
    `UPDATE entities SET ${setClauses.join(', ')} WHERE id = ? AND deleted_at IS NULL`,
    values,
  );

  if (result.rowsAffected === 0) {
    throw new Error(`Entity not found: ${id}`);
  }
}

/**
 * Soft delete entity by ID
 * Throws error if entity not found
 */
export async function deleteEntity(
  id: string,
  permanent = false,
): Promise<void> {
  const db = getDatabase();

  // First check if entity exists
  const existing = await getEntity(id, true);
  if (!existing) {
    throw new Error(`Entity not found: ${id}`);
  }

  if (permanent) {
    // Hard delete.
    //
    // ⚠️ CRITICAL: this is a MULTI-statement transaction. Do NOT convert it to
    // withTransaction + sequential `await tx.executeSql()` calls. react-native-
    // sqlite-storage transactions follow run-to-completion semantics: the tx is
    // finalized immediately after the callback's synchronous portion returns, so
    // a second `await tx.executeSql()` throws
    //   "InvalidStateError: DOM Exception 11: This transaction is already finalized."
    // (see src/database/README.md — "Multiple sequential statements | ❌ NO").
    // Use nested callbacks in a single transaction instead.
    //
    // Delete order matters: children first, entity last. interactions and
    // conversation_messages have NO ON DELETE CASCADE (interactions has no FK;
    // conversation_messages FK is plain REFERENCES), and entity_emoji_actions
    // FK has no ON DELETE CASCADE either. emotion_state / memories /
    // entity_module_mappings cascade via their ON DELETE CASCADE FKs.
    return runStatementsInTransaction(db, [
      { sql: 'DELETE FROM entity_emoji_actions WHERE entity_id = ?', params: [id] },
      { sql: 'DELETE FROM interactions WHERE entity_id = ?', params: [id] },
      { sql: 'DELETE FROM conversation_messages WHERE entity_id = ?', params: [id] },
      { sql: 'DELETE FROM entities WHERE id = ?', params: [id] },
    ]);
  }

  // Soft delete — cascade to child rows rooted at this entity ONLY.
  //
  // ⚠️ CRITICAL: this is a MULTI-statement transaction. Do NOT convert it to
  // withTransaction + sequential `await tx.executeSql()` calls. react-native-
  // sqlite-storage transactions follow run-to-completion semantics: the tx is
  // finalized immediately after the callback's synchronous portion returns, so
  // a second `await tx.executeSql()` throws
  //   "InvalidStateError: DOM Exception 11: This transaction is already finalized."
  // (see src/database/README.md — "Multiple sequential statements | ❌ NO").
  // Use nested callbacks in a single transaction instead.
  //
  // ⚠️ BUSINESS RULE: every cascade predicate is `WHERE entity_id = ?` —
  // NEVER match by participant_ids, participant_key, sender_entity_id, or via
  // interaction joins. Conversations rooted at another entity that merely
  // mention the deleted entity must remain untouched.
  const now = new Date().toISOString();
  return runStatementsInTransaction(db, [
    { sql: 'UPDATE entities SET deleted_at = ?, updated_at = ? WHERE id = ?', params: [now, now, id] },
    { sql: 'UPDATE entity_module_mappings SET deleted_at = ?, updated_at = ? WHERE entity_id = ?', params: [now, now, id] },
    { sql: 'UPDATE memories SET deleted_at = ?, updated_at = ? WHERE entity_id = ?', params: [now, now, id] },
    { sql: 'UPDATE emotion_state SET deleted_at = ?, updated_at = ? WHERE entity_id = ?', params: [now, now, id] },
    { sql: 'UPDATE entity_emoji_actions SET deleted_at = ?, updated_at = ? WHERE entity_id = ?', params: [now, now, id] },
    { sql: 'UPDATE interactions SET deleted_at = ?, updated_at = ? WHERE entity_id = ?', params: [now, now, id] },
    { sql: 'UPDATE conversation_messages SET deleted_at = ?, updated_at = ? WHERE entity_id = ?', params: [now, now, id] },
  ]);
}

// ============================================================================
// EntityModuleMapping CRUD Operations
// ============================================================================

/**
 * Normalize a module config ID for FK columns.
 *
 * Callers (CreateAIScreen / EntityConfigEditScreen) default their config
 * selectors to '' ("Disabled") and pass `id ?? null`, which still yields ''
 * because '' is not nullish. Inserting '' into a column with a FOREIGN KEY to
 * a config table fails with SQLITE_CONSTRAINT_FOREIGNKEY (787). Coerce any
 * falsy/whitespace value to null so the FK columns stay valid and sync doesn't
 * propagate garbage.
 */
function normalizeConfigId(
  id: string | null | undefined,
): string | null {
  if (id == null) return null;
  const trimmed = String(id).trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Create entity module mapping
 */
export async function createEntityModuleMapping(
  mapping: EntityModuleMapping,
): Promise<void> {
  const db = getDatabase();

  return withTransaction(db, async tx => {
    await tx.executeSql(
      `INSERT INTO entity_module_mappings
       (entity_id, backend_config_id, cognition_config_id, imagination_config_id,
        movement_config_id, rag_config_id, stt_config_id, tts_config_id, vision_config_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        mapping.entity_id,
        normalizeConfigId(mapping.backend_config_id),
        normalizeConfigId(mapping.cognition_config_id),
        normalizeConfigId(mapping.imagination_config_id),
        normalizeConfigId(mapping.movement_config_id),
        normalizeConfigId(mapping.rag_config_id),
        normalizeConfigId(mapping.stt_config_id),
        normalizeConfigId(mapping.tts_config_id),
        normalizeConfigId(mapping.vision_config_id),
      ],
    );
  });
}

/**
 * Get entity module mapping by entity ID
 * Returns null if not found
 */
export async function getEntityModuleMapping(
  entityId: string,
  includeDeleted = false,
): Promise<EntityModuleMapping | null> {
  const db = getDatabase();

  const query = includeDeleted
    ? 'SELECT * FROM entity_module_mappings WHERE entity_id = ?'
    : 'SELECT * FROM entity_module_mappings WHERE entity_id = ? AND deleted_at IS NULL';

  const [results] = await db.executeSql(query, [entityId]);

  if (results.rows.length === 0) {
    return null;
  }

  const row = results.rows.item(0);
  return {
    entity_id: row.entity_id,
    backend_config_id: row.backend_config_id,
    cognition_config_id: row.cognition_config_id,
    imagination_config_id: row.imagination_config_id,
    movement_config_id: row.movement_config_id,
    rag_config_id: row.rag_config_id,
    stt_config_id: row.stt_config_id,
    tts_config_id: row.tts_config_id,
    vision_config_id: row.vision_config_id,
    deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
  };
}

/**
 * Update entity module mapping
 * Throws error if mapping not found
 */
export async function updateEntityModuleMapping(
  mapping: EntityModuleMapping,
): Promise<void> {
  const db = getDatabase();

  return withTransaction(db, async tx => {
    const [result] = await tx.executeSql(
      `UPDATE entity_module_mappings
       SET backend_config_id = ?, cognition_config_id = ?,
           imagination_config_id = ?, movement_config_id = ?,
           rag_config_id = ?, stt_config_id = ?,
           tts_config_id = ?, vision_config_id = ?
       WHERE entity_id = ?`,
      [
        mapping.backend_config_id,
        mapping.cognition_config_id,
        mapping.imagination_config_id,
        mapping.movement_config_id,
        mapping.rag_config_id,
        mapping.stt_config_id,
        mapping.tts_config_id,
        mapping.vision_config_id,
        mapping.entity_id,
      ],
    );

    if (result.rowsAffected === 0) {
      throw new Error(`Entity module mapping not found: ${mapping.entity_id}`);
    }
  });
}

/**
 * Create or update entity module mapping (safe upsert).
 *
 * NOTE: We deliberately avoid INSERT OR REPLACE here because SQLite implements
 * REPLACE as DELETE + INSERT.  The DELETE step fires ON DELETE CASCADE on the
 * entity_module_mappings → entities FK which causes a FOREIGN KEY constraint
 * failure on the subsequent INSERT before the row is considered committed.
 * Instead we use a manual check-then-update-or-insert approach.
 */
export async function createOrUpdateEntityModuleMapping(
  mapping: Omit<EntityModuleMapping, 'deleted_at'>,
): Promise<void> {
  const db = getDatabase();

  // Check whether a row already exists OUTSIDE the transaction so we can use
  // the promise-based db.executeSql() API.  tx.executeSql() inside a
  // withTransaction callback is callback-only and does NOT return a Promise,
  // so awaiting it returns undefined and crashes on `.rows.length`.
  // (See src/database/README.md — transaction run-to-completion semantics.)
  const [existingCheck] = await db.executeSql(
    'SELECT entity_id FROM entity_module_mappings WHERE entity_id = ?',
    [mapping.entity_id],
  );
  const rowExists = existingCheck.rows.length > 0;

  return withTransaction(db, async tx => {
    // Use explicit ISO 8601 timestamps to ensure compatibility with Harmony Link sync
      const now = new Date().toISOString();
    if (rowExists) {
      // Row exists → UPDATE in place, preserving the FK-linked row identity.
      await tx.executeSql(
        `UPDATE entity_module_mappings
         SET backend_config_id      = ?,
             cognition_config_id    = ?,
             imagination_config_id  = ?,
             movement_config_id     = ?,
             rag_config_id          = ?,
             stt_config_id          = ?,
             tts_config_id          = ?,
             vision_config_id       = ?,
             updated_at             = ?
         WHERE entity_id = ?`,
        [
          normalizeConfigId(mapping.backend_config_id),
          normalizeConfigId(mapping.cognition_config_id),
          normalizeConfigId(mapping.imagination_config_id),
          normalizeConfigId(mapping.movement_config_id),
          normalizeConfigId(mapping.rag_config_id),
          normalizeConfigId(mapping.stt_config_id),
          normalizeConfigId(mapping.tts_config_id),
          normalizeConfigId(mapping.vision_config_id),
          now,  // updated_at - ISO 8601 format
          mapping.entity_id,
        ],
      );
    } else {
      // No row yet → safe to INSERT.      
      await tx.executeSql(
        `INSERT INTO entity_module_mappings
         (entity_id, backend_config_id, cognition_config_id, imagination_config_id,
          movement_config_id, rag_config_id, stt_config_id, tts_config_id, vision_config_id,
          created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          mapping.entity_id,
          normalizeConfigId(mapping.backend_config_id),
          normalizeConfigId(mapping.cognition_config_id),
          normalizeConfigId(mapping.imagination_config_id),
          normalizeConfigId(mapping.movement_config_id),
          normalizeConfigId(mapping.rag_config_id),
          normalizeConfigId(mapping.stt_config_id),
          normalizeConfigId(mapping.tts_config_id),
          normalizeConfigId(mapping.vision_config_id),
          now,  // created_at - ISO 8601 format
          now,  // updated_at - ISO 8601 format
        ],
      );
    }
  });
}

/**
 * Soft delete entity module mapping
 * Note: This is normally handled by CASCADE delete when entity is deleted,
 * but with soft delete we should manually mark it if needed.
 */
export async function deleteEntityModuleMapping(
  entityId: string,
  permanent = false,
): Promise<void> {
  const db = getDatabase();

  return withTransaction(db, async tx => {
    if (permanent) {
      await tx.executeSql(
        'DELETE FROM entity_module_mappings WHERE entity_id = ?',
        [entityId],
      );
    } else {
      const now = new Date().toISOString();
      await tx.executeSql(
        'UPDATE entity_module_mappings SET deleted_at = ? WHERE entity_id = ?',
        [now, entityId],
      );
    }
  });
}
