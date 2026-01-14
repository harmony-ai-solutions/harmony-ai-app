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
export async function createEntity(entity: Omit<Entity, 'created_at' | 'updated_at'>): Promise<Entity> {
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
    };
  });
}

/**
 * Get entity by ID
 * Returns null if not found
 */
export async function getEntity(id: string): Promise<Entity | null> {
  const db = getDatabase();
  
  const [results] = await db.executeSql(
    'SELECT * FROM entities WHERE id = ?',
    [id]
  );
  
  if (results.rows.length === 0) {
    return null;
  }
  
  const row = results.rows.item(0);
  return {
    id: row.id,
    character_profile_id: row.character_profile_id,
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at),
  };
}

/**
 * Get all entities
 * Returns empty array if none found
 */
export async function getAllEntities(): Promise<Entity[]> {
  const db = getDatabase();
  
  const [results] = await db.executeSql(
    'SELECT * FROM entities ORDER BY id'
  );
  
  const entities: Entity[] = [];
  for (let i = 0; i < results.rows.length; i++) {
    const row = results.rows.item(i);
    entities.push({
      id: row.id,
      character_profile_id: row.character_profile_id,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
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
 * Delete entity by ID
 * CASCADE will automatically delete entity_module_mappings
 * Throws error if entity not found
 */
export async function deleteEntity(id: string): Promise<void> {
  const db = getDatabase();
  
  // First check if entity exists
  const existing = await getEntity(id);
  if (!existing) {
    throw new Error(`Entity not found: ${id}`);
  }
  
  return withTransaction(db, async (tx) => {
    await tx.executeSql(
      'DELETE FROM entities WHERE id = ?',
      [id]
    );
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
  entityId: string
): Promise<EntityModuleMapping | null> {
  const db = getDatabase();
  
  const [results] = await db.executeSql(
    'SELECT * FROM entity_module_mappings WHERE entity_id = ?',
    [entityId]
  );
  
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
 * Delete entity module mapping
 * Note: This is normally handled by CASCADE delete when entity is deleted
 */
export async function deleteEntityModuleMapping(entityId: string): Promise<void> {
  const db = getDatabase();
  
  return withTransaction(db, async (tx) => {
    await tx.executeSql(
      'DELETE FROM entity_module_mappings WHERE entity_id = ?',
      [entityId]
    );
  });
}
