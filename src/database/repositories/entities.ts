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
 *
 * `entity_type` defaults to 'ai'; `is_muted` / `is_disabled` default 0. The
 * new columns are optional on the input (pre-000042 construction sites stay
 * compiling) but always persisted.
 */
export async function createEntity(
  entity: Omit<
    Entity,
    'created_at' | 'updated_at' | 'deleted_at' | 'entity_type' | 'is_muted' | 'is_disabled'
  >,
  opts: { entity_type?: string; is_muted?: number; is_disabled?: number } = {},
): Promise<Entity> {
  const db = getDatabase();
  const entityType = opts.entity_type ?? 'ai';
  const isMuted = opts.is_muted ?? 0;
  const isDisabled = opts.is_disabled ?? 0;

  return withTransaction(db, async tx => {
    const now = new Date().toISOString();

    await tx.executeSql(
      `INSERT INTO entities (id, alias, character_profile_id, lifecycle_config, rag_reindex_required, entity_type, is_muted, is_disabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entity.id,
        entity.alias || '',
        entity.character_profile_id,
        entity.lifecycle_config ?? null,
        entity.rag_reindex_required ?? 1,
        entityType,
        isMuted,
        isDisabled,
        now,
        now,
      ],
    );

    return {
      ...entity,
      entity_type: entityType,
      is_muted: isMuted,
      is_disabled: isDisabled,
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
    entity_type: row.entity_type ?? 'ai',
    is_muted: row.is_muted ?? 0,
    is_disabled: row.is_disabled ?? 0,
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
      entity_type: row.entity_type ?? 'ai',
      is_muted: row.is_muted ?? 0,
      is_disabled: row.is_disabled ?? 0,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
      deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
    });
  }

  return entities;
}

/**
 * Find an entity linked to the given character profile.
 *
 * A single character profile may be linked to multiple entities (e.g. the
 * user acts as a character in one chat and chats with it in another), so
 * multiple rows can share the same character_profile_id. This returns the
 * most recently created active entity to keep navigation deterministic.
 * Returns null if no active entity references the profile.
 */
export async function getEntityByCharacterProfileId(
  characterProfileId: string,
  includeDeleted = false,
): Promise<Entity | null> {
  const db = getDatabase();

  const query = includeDeleted
    ? `SELECT * FROM entities
       WHERE character_profile_id = ?
       ORDER BY created_at DESC LIMIT 1`
    : `SELECT * FROM entities
       WHERE character_profile_id = ? AND deleted_at IS NULL
       ORDER BY created_at DESC LIMIT 1`;

  const [results] = await db.executeSql(query, [characterProfileId]);

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
    entity_type: row.entity_type ?? 'ai',
    is_muted: row.is_muted ?? 0,
    is_disabled: row.is_disabled ?? 0,
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at),
    deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
  };
}

/**
 * Strip a trailing copy-suffix (e.g. " 02", "-03", "_ 4") from a name to
 * recover the true base name. Only strips when a separator precedes the
 * number — real names without a separator (e.g. "B2") are left untouched.
 *
 *   stripCopySuffix("Aria")     → "Aria"
 *   stripCopySuffix("Aria 02")  → "Aria"
 *   stripCopySuffix("aria-05")  → "aria"
 *   stripCopySuffix("B2")       → "B2"
 */
export function stripCopySuffix(name: string): string {
  const trimmed = name.trim();
  const match = trimmed.match(/^(.*?)[\s-_]+(\d+)$/);
  if (!match) return trimmed;
  return match[1].trim();
}

/**
 * Compute the next available "copy" alias for duplicating an AI partner.
 *
 * The copy number always reflects the count of copies: duplicating "Max"
 * yields "Max 2", duplicating that copy yields "Max 3", and so on. Any
 * copy-suffix on the input name is stripped first so the series continues from
 * the TRUE base name instead of producing "Max 2 2".
 *
 * The original name itself is treated as the "1" slot, so the first copy is
 * always "<name> 2". Numbers are NOT zero-padded — the user-visible copy name
 * reads naturally ("Max 2"), even though older copies may still exist as
 * "Max 02" (they are detected by the trailing-number regex and occupy their
 * slot, so the series continues past them).
 *
 * Examples:
 *   - no copies yet                  → "Max 2"
 *   - "Max 02" exists                → "Max 3"
 *   - duplicating "Max 2"            → "Max 3" (continues the series)
 *   - "Max" + "Max 05" exist         → "Max 2" (holes are not re-used)
 *   - "Max" + "Max 2" exist          → "Max 3"
 */
export async function getNextEntityAliasCopy(baseName: string): Promise<string> {
  const db = getDatabase();

  // Recover the true base when the source is itself a copy ("Max 02" → "Max").
  const base = stripCopySuffix(baseName);
  const lowerBase = base.toLowerCase();

  const [results] = await db.executeSql(
    `SELECT alias FROM entities WHERE deleted_at IS NULL`,
  );

  const takenNumbers = new Set<number>();

  for (let i = 0; i < results.rows.length; i++) {
    const alias = String(results.rows.item(i).alias ?? '').trim();
    const lowerAlias = alias.toLowerCase();

    // Exact match (original) occupies slot 1.
    if (lowerAlias === lowerBase) {
      takenNumbers.add(1);
      continue;
    }

    // "Aria 02" / "aria-02" / "Aria 2" — capture the trailing number
    // (padded or not — both occupy their numeric slot).
    const prefix = lowerAlias.startsWith(lowerBase) ? lowerAlias.slice(lowerBase.length) : '';
    const match = prefix.match(/^[\s-_]+(\d+)$/);
    if (match) {
      const n = parseInt(match[1], 10);
      if (Number.isFinite(n) && n >= 1) {
        takenNumbers.add(n);
      }
    }
  }

  let next = 2;
  while (takenNumbers.has(next)) {
    next += 1;
  }
  return `${base} ${next}`;
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
 * Supports updating character_profile_id, alias, lifecycle_config,
 * rag_reindex_required, is_muted, and is_disabled fields.
 * `entity_type` is intentionally NOT allowlisted — it is immutable by
 * convention (the repo never changes it after create).
 * Throws error if entity not found.
 */
export async function updateEntityFields(
  id: string,
  fields: Partial<
    Pick<Entity, 'character_profile_id' | 'alias' | 'lifecycle_config' | 'rag_reindex_required' | 'is_muted' | 'is_disabled'>
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
  if ('is_muted' in fields) {
    setClauses.push('is_muted = ?');
    values.push(fields.is_muted ? 1 : 0);
  }
  if ('is_disabled' in fields) {
    setClauses.push('is_disabled = ?');
    values.push(fields.is_disabled ? 1 : 0);
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

// ============================================================================
// Entity flags (Q8) — mute / disable live on the entity, not conversation settings
// ============================================================================

/**
 * Throw-safe guard: user entities can NEVER be muted/disabled targets (A3 —
 * they are chat identities, not chat partners). The init/chat guard surfaces
 * `entity_disabled` only for `entity_type='ai'`.
 */
async function assertEntityFlagTarget(entityId: string): Promise<void> {
  const entity = await getEntity(entityId);
  if (!entity) {
    throw new Error(`Entity not found: ${entityId}`);
  }
  if (entity.entity_type === 'user') {
    throw new Error(
      `Cannot mute/disable user entity '${entityId}' — user entities are chat identities, not disable targets (A3)`,
    );
  }
}

/** Set an entity's muted flag (global per entity, Q8). Throws for user entities (A3). */
export async function setEntityMuted(id: string, muted: boolean): Promise<void> {
  await assertEntityFlagTarget(id);
  await updateEntityFields(id, { is_muted: muted ? 1 : 0 });
}

/** Set an entity's disabled flag (global per entity, Q8). Throws for user entities (A3). */
export async function setEntityDisabled(id: string, disabled: boolean): Promise<void> {
  await assertEntityFlagTarget(id);
  await updateEntityFields(id, { is_disabled: disabled ? 1 : 0 });
}

/** IDs of all non-deleted muted entities. */
export async function getMutedEntityIds(): Promise<string[]> {
  const db = getDatabase();
  const [results] = await db.executeSql(
    'SELECT id FROM entities WHERE is_muted = 1 AND deleted_at IS NULL',
  );
  const ids: string[] = [];
  for (let i = 0; i < results.rows.length; i++) {
    ids.push(results.rows.item(i).id);
  }
  return ids;
}

/** IDs of all non-deleted disabled entities. */
export async function getDisabledEntityIds(): Promise<string[]> {
  const db = getDatabase();
  const [results] = await db.executeSql(
    'SELECT id FROM entities WHERE is_disabled = 1 AND deleted_at IS NULL',
  );
  const ids: string[] = [];
  for (let i = 0; i < results.rows.length; i++) {
    ids.push(results.rows.item(i).id);
  }
  return ids;
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
 * Callers (CreateAIScreen — the single create + edit surface) default their config
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
