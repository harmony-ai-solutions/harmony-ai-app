import { getDatabase } from './connection';
import { createLogger } from '../utils/logger';
import { Transaction } from 'react-native-sqlite-storage';

const log = createLogger('[DatabaseSync]');

// BLOB table configuration
const BLOB_TABLES = ['character_image', 'chat_messages'];

const BLOB_COLUMNS: Record<string, string[]> = {
  'character_image': ['image_data', 'vl_model_embedding'],
  'chat_messages': ['image_data', 'audio_data', 'vl_model_embedding']
};

// Chunking configuration
const CHUNK_SIZE = 1_000_000; // 1MB chunks for reading large BLOBs
const BLOB_SIZE_THRESHOLD = 2_000_000; // 2MB threshold - chunk if larger

/**
 * Critical: Use CAST(strftime('%s', ...) AS INTEGER) for all timestamp comparisons
 */
export const toUnixTimestamp = (isoDate: string): number => {
  return Math.floor(new Date(isoDate).getTime() / 1000);
};

/**
 * Get all column names for a table excluding BLOB columns
 * Uses PRAGMA table_info to introspect table structure
 */
async function getNonBlobColumns(table: string): Promise<string[]> {
  const db = getDatabase();
  const [result] = await db.executeSql(`PRAGMA table_info(${table})`);
  
  const blobCols = BLOB_COLUMNS[table] || [];
  const columns: string[]= [];
  
  for (let i = 0; i < result.rows.length; i++) {
    const col = result.rows.item(i).name;
    if (!blobCols.includes(col)) {
      columns.push(col);
    }
  }
  
  log.debug(`Non-BLOB columns for ${table}:`, columns);
  return columns;
}

/**
 * Load a BLOB column with optional chunking for large BLOBs
 * Uses SQL substr() to read BLOBs in chunks if they exceed threshold
 * 
 * @param table - Table name
 * @param id - Primary key value
 * @param columnName - BLOB column name
 * @returns BLOB data as Uint8Array or null if column is NULL/empty
 */
export async function loadBlobColumn(
  table: string,
  id: string | number,
  columnName: string
): Promise<Uint8Array | null> {
  const db = getDatabase();
  const pkField = table === 'entity_module_mappings' ? 'entity_id' : 'id';
  
  // Step 1: Check BLOB size using length()
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
  if (size <= BLOB_SIZE_THRESHOLD) {
    const [result] = await db.executeSql(
      `SELECT ${columnName} FROM ${table} WHERE ${pkField} = ?`,
      [id]
    );
    return result.rows.item(0)[columnName];
  }
  
  // Step 3: Chunk large BLOBs
  log.info(`Chunking large BLOB: ${table}.${columnName} (${size} bytes, ${Math.ceil(size / CHUNK_SIZE)} chunks)`);
  const chunks: Uint8Array[] = [];
  
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
  
  // Step 4: Concatenate chunks
  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(totalLength);
  let writeOffset = 0;
  for (const chunk of chunks) {
    result.set(chunk, writeOffset);
    writeOffset += chunk.length;
  }
  
  log.debug(`Successfully loaded ${size} bytes from ${table}.${columnName}`);
  return result;
}

/**
 * Get changed records for BLOB tables using two-phase query
 * Phase 1: Fetch metadata without BLOBs
 * Phase 2: Load each record's BLOBs individually with chunking
 */
async function getChangedRecordsWithBlobs(
  table: string,
  lastSyncTimestamp: number
): Promise<any[]> {
  const db = getDatabase();
  const blobColumns = BLOB_COLUMNS[table] || [];
  const nonBlobColumns = await getNonBlobColumns(table);
  const pkField = table === 'entity_module_mappings' ? 'entity_id' : 'id';
  
  // Phase 1: Get IDs and metadata without BLOBs
  let metadataQuery: string;
  let params: any[];
  
  if (lastSyncTimestamp === 0) {
    // First sync - include all records
    metadataQuery = `
      SELECT ${nonBlobColumns.join(', ')}
      FROM ${table}
      WHERE deleted_at IS NULL OR CAST(strftime('%s', deleted_at) AS INTEGER) > ?
    `;
    params = [lastSyncTimestamp];
  } else {
    // Subsequent syncs - only changed records
    metadataQuery = `
      SELECT ${nonBlobColumns.join(', ')}
      FROM ${table}
      WHERE CAST(strftime('%s', created_at) AS INTEGER) > ?
         OR CAST(strftime('%s', updated_at) AS INTEGER) > ?
         OR (deleted_at IS NOT NULL AND CAST(strftime('%s', deleted_at) AS INTEGER) > ?)
    `;
    params = [lastSyncTimestamp, lastSyncTimestamp, lastSyncTimestamp];
  }
  
  log.info(`Phase 1: Fetching metadata for ${table} (excluding BLOBs)`);
  const [metadataResult] = await db.executeSql(metadataQuery, params);
  
  if (metadataResult.rows.length === 0) {
    log.info(`No changed records found in ${table}`);
    return [];
  }
  
  log.info(`Phase 1 complete: Found ${metadataResult.rows.length} record(s) in ${table}`);
  
  // Phase 2: Load each record with BLOBs individually
  log.info(`Phase 2: Loading BLOBs for ${metadataResult.rows.length} record(s)`);
  const records: any[] = [];
  
  for (let i = 0; i < metadataResult.rows.length; i++) {
    const metadata = metadataResult.rows.item(i);
    const id = metadata[pkField];
    
    log.debug(`Loading BLOB record ${table}:${id} (${i + 1}/${metadataResult.rows.length})`);
    
    // Start with metadata
    const record: any = { ...metadata };
    
    // Load each BLOB column with chunking if needed
    for (const blobCol of blobColumns) {
      try {
        const blobData = await loadBlobColumn(table, id, blobCol);
        record[blobCol] = blobData;
      } catch (error) {
        log.error(`Failed to load ${table}.${blobCol} for id ${id}:`, error);
        // Set to null on error to allow sync to continue
        record[blobCol] = null;
      }
    }
    
    records.push(record);
  }
  
  log.info(`Phase 2 complete: Loaded ${records.length} BLOB record(s) from ${table}`);
  return records;
}

/**
 * Get changed records for sync
 * Automatically routes BLOB tables to two-phase query
 */
export const getChangedRecords = async (
  table: string,
  lastSyncTimestamp: number
) => {
  // Route BLOB tables to two-phase query
  if (BLOB_TABLES.includes(table)) {
    log.info(`Using BLOB-safe query for table: ${table}`);
    return await getChangedRecordsWithBlobs(table, lastSyncTimestamp);
  }
  
  // Original logic for non-BLOB tables
  log.debug(`Using standard query for table: ${table}`);
  const db = getDatabase();
  let query: string;
  let params: any[];
  
  if (lastSyncTimestamp === 0) {
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
    records.push(result.rows.item(i));
  }
  
  log.debug(`Found ${records.length} record(s) in ${table}`);
  return records;
};

/**
 * Get the primary key field name for a table
 */
const getPrimaryKeyField = (table: string): string => {
  // entity_module_mappings uses entity_id as primary key
  if (table === 'entity_module_mappings') {
    return 'entity_id';
  }
  // All other tables use id
  return 'id';
};

/**
 * Apply sync record using Last-Write-Wins (LWW) conflict resolution
 * 
 * @param table - The table to apply the record to
 * @param operation - The operation type (insert, update, delete)
 * @param record - The record data
 * @param tx - Transaction to execute within (required for atomic sync)
 */
export const applySyncRecord = async (
  table: string,
  operation: 'insert' | 'update' | 'delete',
  record: any,
  tx: Transaction
) => {
  const pkField = getPrimaryKeyField(table);
  const pkValue = record[pkField];

  if (operation === 'delete') {
    // Soft delete
    await tx.executeSql(
      `UPDATE ${table} SET deleted_at = ?, updated_at = ? WHERE ${pkField} = ?`,
      [record.deleted_at, record.updated_at, pkValue]
    );
    return;
  }
  
  // Check if record exists
  const [existing] = await tx.executeSql(
    `SELECT updated_at FROM ${table} WHERE ${pkField} = ?`,
    [pkValue]
  );
  
  if (existing.rows.length === 0) {
    // Insert new record
    const columns = Object.keys(record).join(', ');
    const placeholders = Object.keys(record).map(() => '?').join(', ');
    const values = Object.values(record);
    
    await tx.executeSql(`INSERT INTO ${table} (${columns}) VALUES (${placeholders})`, values);
  } else {
    // Last-Write-Wins: Compare timestamps
    // SQLites updated_at is stored as ISO string in the app
    const existingUpdated = toUnixTimestamp(existing.rows.item(0).updated_at);
    const incomingUpdated = toUnixTimestamp(record.updated_at);
    
    if (incomingUpdated >= existingUpdated) {
      // Incoming wins - update
      const updates = Object.keys(record)
        .filter(k => k !== pkField)
        .map(k => `${k} = ?`)
        .join(', ');
      const values = Object.keys(record)
        .filter(k => k !== pkField)
        .map(k => record[k]);
      values.push(pkValue);
      
      await tx.executeSql(`UPDATE ${table} SET ${updates} WHERE ${pkField} = ?`, values);
    }
    // Else: Existing wins - do nothing
  }
};
