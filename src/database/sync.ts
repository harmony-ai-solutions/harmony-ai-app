import { getDatabase } from './connection';
import { createLogger } from '../utils/logger';
import { Transaction } from 'react-native-sqlite-storage';

const log = createLogger('[DatabaseSync]');

/**
 * Critical: Use CAST(strftime('%s', ...) AS INTEGER) for all timestamp comparisons
 */
export const toUnixTimestamp = (isoDate: string): number => {
  return Math.floor(new Date(isoDate).getTime() / 1000);
};

export const getChangedRecords = async (table: string, lastSyncTimestamp: number) => {
  const db = getDatabase();
  
  // For first sync (lastSyncTimestamp = 0), we want to include ALL records regardless of timestamp
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
