import {getDatabase} from '../connection';
import {withTransaction} from '../transaction';
import { SyncDevice, SyncHistory, ChatMessage } from '../models';

// ============================================================================
// Sync Device Operations
// ============================================================================

export async function createSyncDevice(device: Omit<SyncDevice, 'created_at' | 'updated_at' | 'deleted_at'>): Promise<void> {
  const db = getDatabase();
  const now = new Date().toISOString();
  
  await db.executeSql(
    `INSERT INTO sync_devices (
      device_id, device_name, device_type, device_platform, is_approved,
      approval_requested_at, approved_by_user_at, last_sync_timestamp,
      last_sync_initiated_by, jwt_token, jwt_expires_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      device.device_id,
      device.device_name,
      device.device_type,
      device.device_platform,
      device.is_approved,
      device.approval_requested_at?.toISOString() || null,
      device.approved_by_user_at?.toISOString() || null,
      device.last_sync_timestamp,
      device.last_sync_initiated_by,
      device.jwt_token,
      device.jwt_expires_at,
      now,
      now
    ]
  );
}

export async function getSyncDevice(deviceId: string, includeDeleted = false): Promise<SyncDevice | null> {
  const db = getDatabase();
  const query = includeDeleted
    ? 'SELECT * FROM sync_devices WHERE device_id = ?'
    : 'SELECT * FROM sync_devices WHERE device_id = ? AND deleted_at IS NULL';
    
  const [results] = await db.executeSql(query, [deviceId]);
  
  if (results.rows.length === 0) return null;
  
  const row = results.rows.item(0);
  return {
    ...row,
    approval_requested_at: row.approval_requested_at ? new Date(row.approval_requested_at) : null,
    approved_by_user_at: row.approved_by_user_at ? new Date(row.approved_by_user_at) : null,
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at),
    deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
  };
}

export async function updateSyncDevice(device: SyncDevice): Promise<void> {
  const db = getDatabase();
  const now = new Date().toISOString();
  
  await db.executeSql(
    `UPDATE sync_devices SET
      device_name = ?, device_type = ?, device_platform = ?, is_approved = ?,
      approval_requested_at = ?, approved_by_user_at = ?, last_sync_timestamp = ?,
      last_sync_initiated_by = ?, jwt_token = ?, jwt_expires_at = ?, updated_at = ?
    WHERE device_id = ?`,
    [
      device.device_name,
      device.device_type,
      device.device_platform,
      device.is_approved,
      device.approval_requested_at?.toISOString() || null,
      device.approved_by_user_at?.toISOString() || null,
      device.last_sync_timestamp,
      device.last_sync_initiated_by,
      device.jwt_token,
      device.jwt_expires_at,
      now,
      device.device_id
    ]
  );
}

// ============================================================================
// Sync History Operations
// ============================================================================

export async function createSyncHistory(history: Omit<SyncHistory, 'id' | 'created_at' | 'deleted_at'>): Promise<number> {
  const db = getDatabase();
  const now = new Date().toISOString();
  
  const [result] = await db.executeSql(
    `INSERT INTO sync_history (
      device_id, sync_started_at, sync_completed_at, records_sent,
      records_received, sync_status, error_message, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      history.device_id,
      history.sync_started_at.toISOString(),
      history.sync_completed_at?.toISOString() || null,
      history.records_sent,
      history.records_received,
      history.sync_status,
      history.error_message,
      now
    ]
  );
  
  return result.insertId!;
}

export async function getSyncHistory(id: number): Promise<SyncHistory | null> {
  const db = getDatabase();
  const [results] = await db.executeSql('SELECT * FROM sync_history WHERE id = ?', [id]);
  
  if (results.rows.length === 0) return null;
  
  const row = results.rows.item(0);
  return {
    ...row,
    sync_started_at: new Date(row.sync_started_at),
    sync_completed_at: row.sync_completed_at ? new Date(row.sync_completed_at) : null,
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at),
    deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
  };
}

export async function getSyncHistoryList(limit = 50): Promise<SyncHistory[]> {
  const db = getDatabase();
  const [results] = await db.executeSql(
    'SELECT * FROM sync_history WHERE deleted_at IS NULL ORDER BY sync_started_at DESC LIMIT ?',
    [limit]
  );
  
  const history: SyncHistory[] = [];
  for (let i = 0; i < results.rows.length; i++) {
    const row = results.rows.item(i);
    history.push({
      ...row,
      sync_started_at: new Date(row.sync_started_at),
      sync_completed_at: row.sync_completed_at ? new Date(row.sync_completed_at) : null,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
      deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
    });
  }
  return history;
}
