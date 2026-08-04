/**
 * Pure helpers + constants for sync name-clash resolution.
 *
 * During a sync, the engine may push a record whose unique `name` (on the
 * module config tables) collides with a DIFFERENT local row — e.g. two
 * instances seeded the same default config ("Default SoulbitsCloud") with
 * different UUIDs. Without intervention the INSERT violates the UNIQUE(name)
 * constraint and the whole sync transaction rolls back.
 *
 * The UI resolves each clash via SyncService.resolveNameClash():
 *   - overwrite: adopt the server record's id + values, remap local references
 *   - keep:      keep the local values, but still adopt the server id + remap
 *   - rename:    rename the local entry ("X (1234567890)"), then insert server
 *
 * This module keeps the pure, testable parts (constants + rename-name
 * generation) separate from the DB/SQL orchestration in SyncService.
 */

export type NameClashResolution = 'overwrite' | 'keep' | 'rename';

export interface NameClashInfo {
  table: string;
  name: string;
  localId: string;
  incomingId: string;
  localRecord: any;
  incomingRecord: any;
}

/**
 * A single provider-config reference captured from a local module config row
 * BEFORE id adoption. Used by the keep cascade to rename the app-local
 * provider config to the server's provider config id.
 */
export interface KeepProviderRefCapture {
  /** Column holding the provider config id (e.g. 'provider_config_id'). */
  configColumn: string;
  /** Column holding the provider name (e.g. 'provider'). */
  providerColumn: string;
  /** Local provider config id BEFORE adoption (null if the ref is empty). */
  localProviderConfigId: string | null;
  /** Provider of the local row (e.g. 'soulbitscloud'). */
  localProvider: string | null;
}

/**
 * Apply directive for a single clashing incoming record, produced AFTER the
 * user (or an "apply to all" decision) has resolved it.
 *
 * For `keep`, the local provider references are captured at build time (the
 * local row's provider refs BEFORE adoption — see PROVIDER_CONFIG_REFERENCES)
 * so the apply transaction can cascade the id adoption to the local provider
 * configs WITHOUT needing an in-transaction SELECT.
 */
export type NameClashApplyDirective =
  | { kind: 'overwrite'; localId: string }
  | {
      kind: 'keep';
      localId: string;
      /** Local provider references captured before adoption. */
      providerRefs: ReadonlyArray<KeepProviderRefCapture>;
    }
  | { kind: 'rename'; localId: string; newName: string };

/**
 * Tables whose `name` column is UNIQUE — the only tables where a same-name
 * record with a different id can fail on INSERT. Verified against the live app
 * schema (migration 000031 + 000032 + 000034): backend/cognition/movement/rag/
 * stt/tts/vision/imagination configs have `name TEXT NOT NULL UNIQUE`;
 * character_profiles and provider configs do NOT.
 */
export const NAME_UNIQUE_TABLES: readonly string[] = [
  'backend_configs',
  'cognition_configs',
  'movement_configs',
  'rag_configs',
  'stt_configs',
  'tts_configs',
  'vision_configs',
  'imagination_configs',
];

export function isNameUniqueTable(table: string): boolean {
  return NAME_UNIQUE_TABLES.includes(table);
}

/**
 * Per module-config table: the (config-column, provider-column) pairs that
 * reference provider config rows. Every module config references exactly ONE
 * provider config via `provider_config_id`/`provider` — EXCEPT stt_configs,
 * which references TWO (transcription + VAD) via
 * `transcription_provider_config_id`/`transcription_provider` and
 * `vad_provider_config_id`/`vad_provider`. Verified against the live app
 * schema (PRAGMA table_info).
 */
export const PROVIDER_CONFIG_REFERENCES: Record<
  string,
  ReadonlyArray<{configColumn: string; providerColumn: string}>
> = {
  backend_configs: [{configColumn: 'provider_config_id', providerColumn: 'provider'}],
  cognition_configs: [{configColumn: 'provider_config_id', providerColumn: 'provider'}],
  movement_configs: [{configColumn: 'provider_config_id', providerColumn: 'provider'}],
  rag_configs: [{configColumn: 'provider_config_id', providerColumn: 'provider'}],
  stt_configs: [
    {configColumn: 'transcription_provider_config_id', providerColumn: 'transcription_provider'},
    {configColumn: 'vad_provider_config_id', providerColumn: 'vad_provider'},
  ],
  tts_configs: [{configColumn: 'provider_config_id', providerColumn: 'provider'}],
  vision_configs: [{configColumn: 'provider_config_id', providerColumn: 'provider'}],
  imagination_configs: [{configColumn: 'provider_config_id', providerColumn: 'provider'}],
};

/**
 * Reverse FK map: which (table, column) pairs reference each unique-name
 * config table. Used when overwrite/keep adopt the server id — every local
 * reference to the old local id must be re-pointed at the new id so FK
 * constraints (entity_module_mappings → config, ON DELETE SET NULL) hold.
 */
export const CONFIG_ID_REFERENCES: Record<string, ReadonlyArray<{ table: string; column: string }>> = {
  backend_configs: [{ table: 'entity_module_mappings', column: 'backend_config_id' }],
  cognition_configs: [{ table: 'entity_module_mappings', column: 'cognition_config_id' }],
  movement_configs: [{ table: 'entity_module_mappings', column: 'movement_config_id' }],
  rag_configs: [{ table: 'entity_module_mappings', column: 'rag_config_id' }],
  stt_configs: [{ table: 'entity_module_mappings', column: 'stt_config_id' }],
  tts_configs: [{ table: 'entity_module_mappings', column: 'tts_config_id' }],
  vision_configs: [
    { table: 'entity_module_mappings', column: 'vision_config_id' },
    { table: 'character_profiles', column: 'vision_config_id' },
  ],
  imagination_configs: [{ table: 'entity_module_mappings', column: 'imagination_config_id' }],
};

/** Stable key for a clashing incoming record. */
export function nameClashKey(table: string, incomingId: string): string {
  return `${table}:${incomingId}`;
}

/**
 * Generate a clash-free renamed name: "Original (1234567890)".
 *
 * If the generated name is already taken (a row with that exact name exists),
 * numeric suffixes are appended: "Original (1234567890)-1", "-2", ...
 *
 * @param name      The current (clashing) name of the local entry.
 * @param options.takenNames  Names that must not be reused (default []).
 * @param options.nowSeconds  Unix seconds for the suffix (default Date.now()).
 */
export function generateRenamedName(
  name: string,
  options: { takenNames?: readonly string[]; nowSeconds?: number } = {},
): string {
  const taken = new Set(options.takenNames ?? []);
  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const base = `${name} (${now})`;
  if (!taken.has(base)) {
    return base;
  }
  let counter = 1;
  let candidate = `${base}-${counter}`;
  while (taken.has(candidate)) {
    counter++;
    candidate = `${base}-${counter}`;
  }
  return candidate;
}
