/**
 * Entity Repository
 * 
 * Provides CRUD operations for entities and entity module mappings.
 * Mirrors the Go implementation in harmony-link-private/database/repository/entities/
 */

import {getDatabase} from '../connection';
import {withTransaction} from '../transaction';
import {Entity, EntityModuleMapping} from '../models';

// ============================================================================
// Entity CRUD Operations
// ============================================================================

/**
 * Create a new entity
 */
export async function createEntity(entity: Omit<Entity, 'created_at' | 'updated_at' | 'deleted_at'>): Promise<Entity> {
  const db = getDatabase();
  
  return withTransaction(db, async (tx) => {
    const now = new Date().toISOString();
    
    await tx.executeSql(
      `INSERT INTO entities (id, character_profile_id, created_at, updated_at) 
       VALUES (?, ?, ?, ?)`,
      [entity.id, entity.character_profile_id, now, now]
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
export async function getEntity(id: string, includeDeleted = false): Promise<Entity | null> {
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
    character_profile_id: row.character_profile_id,
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at),
    deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
  };
}

/**
 * Get all entities
 * Returns empty array if none found. Filters out soft deleted by default.
 */
export async function getAllEntities(includeDeleted = false): Promise<Entity[]> {
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
      character_profile_id: row.character_profile_id,
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
  
  return withTransaction(db, async (tx) => {
    const now = new Date().toISOString();
    
    await tx.executeSql(
      `UPDATE entities 
       SET character_profile_id = ?, updated_at = ? 
       WHERE id = ?`,
      [entity.character_profile_id, now, entity.id]
    );
    
    return {
      ...entity,
      updated_at: new Date(now),
    };
  });
}

/**
 * Soft delete entity by ID
 * Throws error if entity not found
 */
export async function deleteEntity(id: string, permanent = false): Promise<void> {
  const db = getDatabase();
  
  // First check if entity exists
  const existing = await getEntity(id, true);
  if (!existing) {
    throw new Error(`Entity not found: ${id}`);
  }
  
  return withTransaction(db, async (tx) => {
    if (permanent) {
      await tx.executeSql('DELETE FROM entities WHERE id = ?', [id]);
    } else {
      const now = new Date().toISOString();
      await tx.executeSql(
        'UPDATE entities SET deleted_at = ?, updated_at = ? WHERE id = ?',
        [now, now, id]
      );
    }
  });
}

// ============================================================================
// EntityModuleMapping CRUD Operations
// ============================================================================

/**
 * Create entity module mapping
 */
export async function createEntityModuleMapping(
  mapping: EntityModuleMapping
): Promise<void> {
  const db = getDatabase();
  
  return withTransaction(db, async (tx) => {
    await tx.executeSql(
      `INSERT INTO entity_module_mappings 
       (entity_id, backend_config_id, cognition_config_id, movement_config_id, 
        rag_config_id, stt_config_id, tts_config_id) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        mapping.entity_id,
        mapping.backend_config_id,
        mapping.cognition_config_id,
        mapping.movement_config_id,
        mapping.rag_config_id,
        mapping.stt_config_id,
        mapping.tts_config_id,
      ]
    );
  });
}

/**
 * Get entity module mapping by entity ID
 * Returns null if not found
 */
export async function getEntityModuleMapping(
  entityId: string,
  includeDeleted = false
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
    movement_config_id: row.movement_config_id,
    rag_config_id: row.rag_config_id,
    stt_config_id: row.stt_config_id,
    tts_config_id: row.tts_config_id,
    deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
  };
}

/**
 * Update entity module mapping
 * Throws error if mapping not found
 */
export async function updateEntityModuleMapping(
  mapping: EntityModuleMapping
): Promise<void> {
  const db = getDatabase();
  
  return withTransaction(db, async (tx) => {
    const [result] = await tx.executeSql(
      `UPDATE entity_module_mappings 
       SET backend_config_id = ?, cognition_config_id = ?, 
           movement_config_id = ?, rag_config_id = ?, 
           stt_config_id = ?, tts_config_id = ? 
       WHERE entity_id = ?`,
      [
        mapping.backend_config_id,
        mapping.cognition_config_id,
        mapping.movement_config_id,
        mapping.rag_config_id,
        mapping.stt_config_id,
        mapping.tts_config_id,
        mapping.entity_id,
      ]
    );
    
    if (result.rowsAffected === 0) {
      throw new Error(`Entity module mapping not found: ${mapping.entity_id}`);
    }
  });
}

/**
 * Soft delete entity module mapping
 * Note: This is normally handled by CASCADE delete when entity is deleted,
 * but with soft delete we should manually mark it if needed.
 */
export async function deleteEntityModuleMapping(entityId: string, permanent = false): Promise<void> {
  const db = getDatabase();
  
  return withTransaction(db, async (tx) => {
    if (permanent) {
      await tx.executeSql('DELETE FROM entity_module_mappings WHERE entity_id = ?', [entityId]);
    } else {
      const now = new Date().toISOString();
      await tx.executeSql(
        'UPDATE entity_module_mappings SET deleted_at = ? WHERE entity_id = ?',
        [now, entityId]
      );
    }
  });
}
