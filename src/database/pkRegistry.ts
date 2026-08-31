/**
 * Centralized Primary Key Registry (4-1, Q5).
 *
 * The sync layer queried each table's PK with a growing set of inline ternaries
 * (`item.table === 'entity_module_mappings' ? 'entity_id' : 'id'`, etc.). That
 * scattered approach was bug-prone (A7: the send-path ternary keyed
 * `lifecycle_state` by `id` while the apply path used `entity_id`) and could
 * not carry the two newly-registered tables — `character_favorites` (PK
 * `profile_id`) and `chat_conversation_settings` (PK `participant_key`) —
 * neither of which has an `id` column.
 *
 * This is the single source of truth for table → PK column. Every sync-layer
 * site (apply, send-filter, server-record exclusion, TEXT-column loader) must
 * resolve the PK through `getPkField`.
 *
 * Tables not listed here use the conventional `id` PK.
 */

export const PK_FIELDS: Record<string, string> = {
  entity_module_mappings: 'entity_id',
  emotion_state: 'entity_id',
  lifecycle_state: 'entity_id', // 000040 PK is entity_id (A7 — send-path bugfix)
  character_favorites: 'profile_id',
  chat_conversation_settings: 'participant_key',
};

/**
 * Resolve the primary-key column name for a table.
 *
 * @param table - Table name (e.g. `'character_favorites'`)
 * @returns The PK column name, falling back to `'id'` for unregistered tables.
 */
export const getPkField = (table: string): string => PK_FIELDS[table] ?? 'id';
