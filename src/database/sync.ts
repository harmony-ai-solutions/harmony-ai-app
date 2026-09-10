import { getDatabase } from './connection';
import { getPkField } from './pkRegistry';
import { createLogger } from '../utils/logger';

const log = createLogger('[DatabaseSync]');

// TEXT table configuration (for large base64 fields)
// interactions is NOT a TEXT table — participant_ids, metadata, summary columns are small enough
const TEXT_TABLES = ['character_image', 'conversation_messages'];

const TEXT_COLUMNS: Record<string, string[]> = {
  'character_image': ['image_data'],
  'conversation_messages': ['image_data', 'audio_data']
};

// Chunking configuration
const CHUNK_SIZE = 1_000_000; // 1MB chunks for reading large TEXT fields
const TEXT_SIZE_THRESHOLD = 2_000_000; // 2MB threshold - chunk if larger

/**
 * Critical: Use CAST(strftime('%s', ...) AS INTEGER) for all timestamp comparisons
 */

/**
 * Parse a timestamp string into epoch milliseconds using the shared 6-1 §2 UTC
 * rules (D21-7, shipped with the 3-2 wipe release per D32).
 *
 * The #1 divergence hazard: V8 parses a bare space-separated string
 * (`new Date("2026-09-05 11:12:44")`) as LOCAL time. Every timestamp that
 * reaches this path must be normalized to a UTC instant BEFORE any LWW
 * comparison, or the comparison skews by the local offset.
 *
 * Rules (identical semantics to the engine migration parser):
 *  1. Format A (SQLite `CURRENT_TIMESTAMP`, `YYYY-MM-DD HH:MM:SS`) is UTC by
 *     definition — parse it explicitly as UTC (`+ 'Z'`).
 *  2. Format B (Go-driver `…HH:MM:SS.nnnnnnnnn±hh:mm`) honors the offset
 *     suffix; a missing offset (legacy local-time writer, e.g.
 *     `emotion/ekman8.go:120`) is treated as UTC with a warning — its true
 *     zone is unrecoverable, and UTC is the deterministic choice both sides
 *     must make identically.
 *  3. Format C (ISO-8601 `T`) parses natively.
 */
function parseTimestampToUtcMs(timestamp: string): number {
  // Format C — native parse honors both `Z` and explicit offsets (rule 3).
  if (timestamp.includes('T')) {
    return Date.parse(timestamp);
  }

  // Space-separated formats (SQLite default / Go-driver strings).
  if (timestamp.includes(' ')) {
    // Format B with an offset suffix — parse natively after the space→'T'
    // swap so the offset is honored (rule 2).
    if (/[+-]\d{2}:\d{2}$/.test(timestamp)) {
      return Date.parse(timestamp.replace(' ', 'T'));
    }
    // No offset suffix. SQLite `CURRENT_TIMESTAMP` (format A) is UTC by
    // definition (rule 1). A fractional component identifies a legacy
    // Go-driver string written in local time (rule 2's absence clause).
    if (/\d{2}:\d{2}:\d{2}\.\d+/.test(timestamp)) {
      log.warn(
        `Timestamp "${timestamp}" has no offset suffix — treating as UTC (legacy local-time writer?)`,
      );
    }
    return Date.parse(timestamp.replace(' ', 'T') + 'Z');
  }

  // Fallback — native parse (e.g. `YYYY-MM-DD` date-only, numeric strings).
  return Date.parse(timestamp);
}

export const toUnixTimestamp = (isoDate: string): number => {
  const ms = parseTimestampToUtcMs(isoDate);
  return Number.isNaN(ms) ? NaN : Math.floor(ms / 1000);
};

/**
 * Normalize timestamp to ISO 8601 format for Harmony Link sync compatibility.
 * SQLite's CURRENT_TIMESTAMP returns "YYYY-MM-DD HH:MM:SS" (space separator),
 * but Harmony Link expects ISO 8601 format with 'T' separator.
 *
 * This function detects and fixes non-standard timestamp formats:
 * - "2026-04-04 22:27:51" → "2026-04-04T22:27:51.000Z"
 * - "2026-04-04 22:27:51.123" → "2026-04-04T22:27:51.123Z"
 * - Already ISO 8601 timestamps are passed through unchanged
 *
 * @param timestamp - The timestamp string to normalize
 * @returns ISO 8601 formatted timestamp string
 */
export const normalizeTimestampForSync = (timestamp: any): string => {
  if (!timestamp) {
    return new Date().toISOString();
  }
  
  // If it's already a valid ISO 8601 with T, return as-is
  if (typeof timestamp === 'string' && timestamp.includes('T')) {
    return timestamp;
  }
  
  // Handle space-separated format (SQLite default): "YYYY-MM-DD HH:MM:SS"
  // (and Go-driver format-B strings). Parse through the shared UTC-aware
  // parser — never bare (V8 would read the space format as LOCAL time; 6-1
  // §2 rule 1, D21-7).
  if (typeof timestamp === 'string' && timestamp.includes(' ')) {
    const ms = parseTimestampToUtcMs(timestamp);
    if (!Number.isNaN(ms)) {
      return new Date(ms).toISOString();
    }
  }
  
  // Try parsing as-is
  const date = new Date(timestamp);
  if (!isNaN(date.getTime())) {
    return date.toISOString();
  }
  
  // Fallback: return current time
  const fallback = new Date().toISOString();
  log.warn(`Failed to normalize timestamp "${timestamp}", using fallback: ${fallback}`);
  return fallback;
};

/**
 * Normalize all timestamp fields in a sync record.
 * This is a failsafe to ensure all records sent to Harmony Link have proper ISO 8601 timestamps.
 *
 * @param record - The record object to normalize
 * @param table - The table name (to identify timestamp fields)
 * @returns The record with normalized timestamp fields
 */
export const normalizeRecordTimestamps = (record: any, table: string): any => {
  const timestampFields = ['created_at', 'updated_at', 'deleted_at'];
  const normalized = { ...record };
  
  for (const field of timestampFields) {
    if (normalized[field] !== undefined && normalized[field] !== null) {
      const originalValue = normalized[field];
      const normalizedValue = normalizeTimestampForSync(originalValue);
      
      if (originalValue !== normalizedValue) {
        log.warn(`Timestamp normalization for ${table}.${field}: "${originalValue}" → "${normalizedValue}"`);
        normalized[field] = normalizedValue;
      }
    }
  }
  
  return normalized;
};

/**
 * Get all column names for a table excluding TEXT columns
 * Uses PRAGMA table_info to introspect table structure
 */
async function getNonTextColumns(table: string): Promise<string[]> {
  const db = getDatabase();
  const [result] = await db.executeSql(`PRAGMA table_info(${table})`);
  
  const textCols = TEXT_COLUMNS[table] || [];
  const columns: string[]= [];
  
  for (let i = 0; i < result.rows.length; i++) {
    const col = result.rows.item(i).name;
    if (!textCols.includes(col)) {
      columns.push(col);
    }
  }
  
  log.debug(`Non-TEXT columns for ${table}:`, columns);
  return columns;
}

/**
 * Load a TEXT column with optional chunking for large fields
 * Uses SQL substr() to read strings in chunks if they exceed threshold
 * 
 * @param table - Table name
 * @param id - Primary key value
 * @param columnName - Column name
 * @returns TEXT data as string or null if column is NULL/empty
 */
export async function loadTextColumn(
  table: string,
  id: string | number,
  columnName: string
): Promise<string | null> {
  const db = getDatabase();
  const pkField = getPkField(table);
  
  // Step 1: Check TEXT size using length()
  const [sizeResult] = await db.executeSql(
    `SELECT length(${columnName}) as size FROM ${table} WHERE ${pkField} = ?`,
    [id]
  );
  
  if (sizeResult.rows.length === 0) {
    return null;
  }
  
  const size = sizeResult.rows.item(0).size;
  
  if (size === null || size === 0) {
    return null;
  }
  
  // Step 2: Load directly if small enough
  if (size <= TEXT_SIZE_THRESHOLD) {
    const [result] = await db.executeSql(
      `SELECT ${columnName} FROM ${table} WHERE ${pkField} = ?`,
      [id]
    );
    return result.rows.item(0)[columnName];
  }
  
  // Step 3: Chunk large TEXT fields
  log.info(`Chunking large TEXT: ${table}.${columnName} (${size} chars, ${Math.ceil(size / CHUNK_SIZE)} chunks)`);
  const chunks: string[] = [];
  
  for (let offset = 0; offset < size; offset += CHUNK_SIZE) {
    const [chunkResult] = await db.executeSql(
      `SELECT substr(${columnName}, ?, ?) as chunk FROM ${table} WHERE ${pkField} = ?`,
      [offset + 1, CHUNK_SIZE, id] // SQL substr is 1-indexed!
    );
    
    const chunk = chunkResult.rows.item(0).chunk;
    if (chunk) {
      chunks.push(chunk);
    }
  }
  
  // Step 4: Simple string concatenation
  const result = chunks.join('');
  
  log.debug(`Successfully loaded ${size} chars from ${table}.${columnName}`);
  return result;
}

/**
 * Normalize boolean fields that SQLite stores as integers (0/1)
 * Convert to proper JSON booleans (true/false) for Go unmarshalling
 */
function normalizeBooleanFields(table: string, record: any): any {
  // Define tables and their boolean fields
  const booleanFields: Record<string, string[]> = {
    'character_image': ['is_primary'],
    'conversation_messages': ['is_recon_followup', 'is_edited', 'is_pinned', 'is_read'],
    'entity_emoji_actions': ['auto_generated', 'is_default'],
    'lifecycle_state': ['sleeping'],
  };

  const fields = booleanFields[table];
  if (!fields) {
    return record; // No boolean fields to normalize
  }

  const normalized = { ...record };
  for (const field of fields) {
    if (field in normalized && typeof normalized[field] === 'number') {
      normalized[field] = normalized[field] === 1;
    }
  }
  
  return normalized;
}

/**
 * Get changed records for TEXT tables using two-phase query
 * Phase 1: Fetch metadata without TEXT columns
 * Phase 2: Load each record's TEXT columns individually with chunking
 */
async function getChangedRecordsWithText(
  table: string,
  lastSyncTimestamp: number
): Promise<any[]> {
  const db = getDatabase();
  const textColumns = TEXT_COLUMNS[table] || [];
  const nonTextColumns = await getNonTextColumns(table);
  const pkField = getPkField(table);
  
  // Phase 1: Get IDs and metadata without TEXT columns
  let metadataQuery: string;
  let params: any[];
  
  if (lastSyncTimestamp === 0) {
    // First sync - include all records
    metadataQuery = `
      SELECT ${nonTextColumns.join(', ')}
      FROM ${table}
      WHERE deleted_at IS NULL OR CAST(strftime('%s', deleted_at) AS INTEGER) > ?
    `;
    params = [lastSyncTimestamp];
  } else {
    // Subsequent syncs - only changed records
    metadataQuery = `
      SELECT ${nonTextColumns.join(', ')}
      FROM ${table}
      WHERE CAST(strftime('%s', created_at) AS INTEGER) > ?
         OR CAST(strftime('%s', updated_at) AS INTEGER) > ?
         OR (deleted_at IS NOT NULL AND CAST(strftime('%s', deleted_at) AS INTEGER) > ?)
    `;
    params = [lastSyncTimestamp, lastSyncTimestamp, lastSyncTimestamp];
  }
  
  log.info(`Phase 1: Fetching metadata for ${table} (excluding TEXT columns)`);
  const [metadataResult] = await db.executeSql(metadataQuery, params);
  
  if (metadataResult.rows.length === 0) {
    log.info(`No changed records found in ${table}`);
    return [];
  }
  
  log.info(`Phase 1 complete: Found ${metadataResult.rows.length} record(s) in ${table}`);
  
  // Phase 2: Load each record with TEXT columns individually
  log.info(`Phase 2: Loading TEXT columns for ${metadataResult.rows.length} record(s)`);
  const records: any[] = [];
  
  for (let i = 0; i < metadataResult.rows.length; i++) {
    const metadata = metadataResult.rows.item(i);
    const id = metadata[pkField];
    
    log.debug(`Loading TEXT record ${table}:${id} (${i + 1}/${metadataResult.rows.length})`);
    
    // Start with metadata
    let record: any = { ...metadata };
    
    // Load each TEXT column with chunking if needed
    for (const textCol of textColumns) {
      try {
        const textData = await loadTextColumn(table, id, textCol);
        record[textCol] = textData;
      } catch (error) {
        log.error(`Failed to load ${table}.${textCol} for id ${id}:`, error);
        // Set to null on error to allow sync to continue
        record[textCol] = null;
      }
    }
    
    // Normalize boolean fields (SQLite stores as 0/1, JSON needs true/false)
    record = normalizeBooleanFields(table, record);
    
    records.push(record);
  }
  
  log.info(`Phase 2 complete: Loaded ${records.length} TEXT record(s) from ${table}`);
  return records;
}

/**
 * Get changed records for sync
 * Automatically routes TEXT tables to two-phase query
 */
// Tables that do not have a deleted_at column — deletions cascade from parent entity deletes
const NO_DELETED_AT_TABLES: string[] = [];

export const getChangedRecords = async (
  table: string,
  lastSyncTimestamp: number
) => {
  // Route TEXT tables to two-phase query
  if (TEXT_TABLES.includes(table)) {
    log.info(`Using TEXT-safe two-phase query for table: ${table}`);
    return await getChangedRecordsWithText(table, lastSyncTimestamp);
  }

  // Original logic for non-BLOB tables
  log.debug(`Using standard query for table: ${table}`);
  const db = getDatabase();
  let query: string;
  let params: any[];

  if (NO_DELETED_AT_TABLES.includes(table)) {
    // Tables without deleted_at — only filter by created_at / updated_at
    if (lastSyncTimestamp === 0) {
      query = `SELECT * FROM ${table}`;
      params = [];
    } else {
      query = `
        SELECT * FROM ${table}
        WHERE CAST(strftime('%s', created_at) AS INTEGER) > ?
           OR CAST(strftime('%s', updated_at) AS INTEGER) > ?
      `;
      params = [lastSyncTimestamp, lastSyncTimestamp];
    }
  } else if (lastSyncTimestamp === 0) {
    // On first sync, include all non-deleted records (including those with old timestamps)
    query = `
      SELECT * FROM ${table}
      WHERE deleted_at IS NULL OR CAST(strftime('%s', deleted_at) AS INTEGER) > ?
    `;
    params = [lastSyncTimestamp];
  } else {
    // For subsequent syncs, use normal timestamp comparison
    query = `
      SELECT * FROM ${table}
      WHERE CAST(strftime('%s', created_at) AS INTEGER) > ?
         OR CAST(strftime('%s', updated_at) AS INTEGER) > ?
         OR (deleted_at IS NOT NULL AND CAST(strftime('%s', deleted_at) AS INTEGER) > ?)
    `;
    params = [lastSyncTimestamp, lastSyncTimestamp, lastSyncTimestamp];
  }
  
  const [result] = await db.executeSql(query, params);
  
  const records: any[] = [];
  for (let i = 0; i < result.rows.length; i++) {
    records.push(normalizeBooleanFields(table, result.rows.item(i)));
  }
  
  log.debug(`Found ${records.length} record(s) in ${table}`);
  return records;
};

/**
 * Failsafe: Clean up orphan entity_module_mappings records.
 * An orphan is a record where the parent entity is soft-deleted but the mapping is not.
 * This can happen due to bugs or race conditions.
 *
 * This function should be called before sync to ensure data integrity.
 */
export const cleanupOrphanEntityModuleMappings = async (): Promise<number> => {
  const db = getDatabase();
  
  // Find entity_module_mappings where the parent entity is soft-deleted
  const [result] = await db.executeSql(`
    SELECT emm.entity_id, e.deleted_at as entity_deleted_at
    FROM entity_module_mappings emm
    INNER JOIN entities e ON emm.entity_id = e.id
    WHERE e.deleted_at IS NOT NULL
      AND emm.deleted_at IS NULL
  `);
  
  if (result.rows.length === 0) {
    log.debug('No orphan entity_module_mappings found');
    return 0;
  }
  
  log.warn(`Found ${result.rows.length} orphan entity_module_mappings - cleaning up`);
  
  const now = new Date().toISOString();
  let cleanedCount = 0;
  
  for (let i = 0; i < result.rows.length; i++) {
    const row = result.rows.item(i);
    await db.executeSql(
      'UPDATE entity_module_mappings SET deleted_at = ?, updated_at = ? WHERE entity_id = ?',
      [now, now, row.entity_id]
    );
    log.debug(`Soft-deleted orphan entity_module_mappings for entity_id: ${row.entity_id}`);
    cleanedCount++;
  }
  
  log.info(`Cleaned up ${cleanedCount} orphan entity_module_mappings`);
  return cleanedCount;
};

/**
 * Failsafe: Clean up orphaned memories (memories with no referencing conversation_messages).
 * This cleanup is necessary because memory promotion hard-deletes source memories on Harmony Link,
 * which don't propagate through the sync pipeline (no soft-delete to sync).
 * Orphaned memories are identified via LEFT JOIN where conversation_messages.id IS NULL.
 *
 * This function should be called after sync completes to ensure data integrity.
 *
 * @returns Number of deleted orphaned memories
 */
export const cleanupOrphanedMemories = async (): Promise<number> => {
  const db = getDatabase();

  // Memory link now lives on interactions (not conversation_messages) per Phase 5
  // JOIN on interactions.memory_id to find orphaned memories
  const [result] = await db.executeSql(`
    DELETE FROM memories
    WHERE id IN (
      SELECT m.id FROM memories m
      LEFT JOIN interactions i ON m.id = i.memory_id
      WHERE i.id IS NULL
    )
  `);

  const deletedCount = result.rowsAffected || 0;
  if (deletedCount > 0) {
    log.info(`Cleaned up ${deletedCount} orphaned memories`);
  } else {
    log.debug('No orphaned memories found');
  }

  return deletedCount;
};
