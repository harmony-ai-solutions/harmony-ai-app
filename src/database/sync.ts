import { getDatabase } from './connection';
import { createLogger } from '../utils/logger';

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
 * Apply sync record using Last-Write-Wins (LWW) conflict resolution
 */
export const applySyncRecord = async (
  table: string,
  operation: 'insert' | 'update' | 'delete',
  record: any
) => {
  const db = getDatabase();

  if (operation === 'delete') {
    // Soft delete
    await db.executeSql(
      `UPDATE ${table} SET deleted_at = ?, updated_at = ? WHERE id = ?`,
      [record.deleted_at, record.updated_at, record.id]
    );
    return;
  }
  
  // Check if record exists
  const [existing] = await db.executeSql(
    `SELECT updated_at FROM ${table} WHERE id = ?`,
    [record.id]
  );
  
  if (existing.rows.length === 0) {
    // Insert new record
    const columns = Object.keys(record).join(', ');
    const placeholders = Object.keys(record).map(() => '?').join(', ');
    const values = Object.values(record);
    
    await db.executeSql(`INSERT INTO ${table} (${columns}) VALUES (${placeholders})`, values);
  } else {
    // Last-Write-Wins: Compare timestamps
    // SQLites updated_at is stored as ISO string in the app
    const existingUpdated = toUnixTimestamp(existing.rows.item(0).updated_at);
    const incomingUpdated = toUnixTimestamp(record.updated_at);
    
    if (incomingUpdated >= existingUpdated) {
      // Incoming wins - update
      const updates = Object.keys(record)
        .filter(k => k !== 'id')
        .map(k => `${k} = ?`)
        .join(', ');
      const values = Object.keys(record)
        .filter(k => k !== 'id')
        .map(k => record[k]);
      values.push(record.id);
      
      await db.executeSql(`UPDATE ${table} SET ${updates} WHERE id = ?`, values);
    }
    // Else: Existing wins - do nothing
  }
};
