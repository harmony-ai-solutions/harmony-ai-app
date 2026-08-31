/**
 * Centralized Primary Key Registry (4-1, Q5).
 *
 * The sync layer queried each table's PK with a growing set of inline ternaries
 * (`item.table === 'entity_module_mappings' ? 'entity_id' : 'id'`, etc.). That
 * scattered approach was bug-prone (A7: the send-path ternary keyed
 * `lifecycle_state` by `id` while the apply path used `entity_id`) and could
 * not carry the newly-registered `chat_conversation_settings` (PK
 * `participant_key`) — which has no `id` column. (The favorites table used to
 * be registered here with PK `profile_id`; it was replaced by the
 * `is_favorite` column on `character_profiles` in migration 000044.)
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
  chat_conversation_settings: 'participant_key',
};

/**
 * Resolve the primary-key column name for a table.
 *
 * @param table - Table name (e.g. `'chat_conversation_settings'`)
 * @returns The PK column name, falling back to `'id'` for unregistered tables.
 */
export const getPkField = (table: string): string => PK_FIELDS[table] ?? 'id';
