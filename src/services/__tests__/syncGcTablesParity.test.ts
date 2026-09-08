/**
 * SyncService — finalize-GC table-list parity (4-1 / D72).
 *
 * `cleanupSoftDeletedRecords` (the kept finalize GC, D73) must purge exactly
 * the same 35-table member set as the registered sync tables `SYNC_TABLES` —
 * the app-local half of D72's "allowlist unified on BOTH sides". Cross-repo
 * parity with the engine's `registeredSyncTables` is locked by phase 6-1, not
 * here.
 *
 * The GC list additionally follows the engine's child-first FK-safe dependency
 * order (D71(a) / engine 1-2 step 1): entity children → `entities` →
 * `character_profiles` → `character_image` → provider configs → module configs.
 */

import {SYNC_TABLES, GC_TABLES} from '../SyncService';
import {EventEmitter} from 'eventemitter3';

// Module-load isolation for SyncService's singletons/imports (same mock set as
// the other SyncService unit tests — syncPkFieldA7.test.ts / syncMessagesApplied.test.ts).
let mockConnectionManager: EventEmitter & {sendEvent: jest.Mock; isConnected: jest.Mock};

jest.mock('../../utils/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

jest.mock('../../database/connection', () => ({
  getDatabase: jest.fn(),
  getSyncDatabase: jest.fn().mockResolvedValue({
    transaction: jest.fn(),
  }),
}));

jest.mock('../../database/sync', () => ({
  toUnixTimestamp: jest.fn((v: any) => (typeof v === 'number' ? v : Date.parse(v))),
  getChangedRecords: jest.fn(() => Promise.resolve([])),
  cleanupOrphanEntityModuleMappings: jest.fn(() => Promise.resolve(0)),
  cleanupOrphanedMemories: jest.fn(() => Promise.resolve(0)),
  normalizeRecordTimestamps: jest.fn((r: any) => r),
}));

jest.mock('../EntityEmojiActionService', () => ({
  __esModule: true,
  default: {invalidateAllCaches: jest.fn()},
}));

jest.mock('../connection/ConnectionManager', () => {
  const {EventEmitter: EE} = require('eventemitter3');
  const cm: EventEmitter & {sendEvent: jest.Mock; isConnected: jest.Mock} = new EE();
  cm.sendEvent = jest.fn().mockResolvedValue(undefined);
  cm.isConnected = jest.fn().mockReturnValue(true);
  mockConnectionManager = cm;
  return {__esModule: true, default: cm};
});

// The pinned 35-table list is copied VERBATIM from the engine's canonical
// `registeredSyncTables` (eventserver/synchronization.go). The engine pins the
// SAME list against `registeredSyncTables` in
// eventserver/synchronization_gc_test.go (TestRegisteredSyncTablesPinnedList) —
// if either repo adds/drops/reorders a sync table, the two hard-coded lists
// drift and BOTH pinned-list tests fail loudly (6-1 §6.7 / D72).
const PINNED_REGISTERED_SYNC_TABLES = [
  // Provider configs
  'provider_config_openai',
  'provider_config_ollama',
  'provider_config_openaicompatible',
  'provider_config_soulbitscloud',
  'provider_config_openrouter',
  'provider_config_harmonyspeech',
  'provider_config_elevenlabs',
  'provider_config_kindroid',
  'provider_config_kajiwoto',
  'provider_config_characterai',
  'provider_config_comfyui',
  'provider_config_localai',
  'provider_config_mistral',
  'provider_config_google',
  'provider_config_xai',
  'provider_config_anthropic',
  // Module configs
  'backend_configs',
  'cognition_configs',
  'movement_configs',
  'rag_configs',
  'stt_configs',
  'tts_configs',
  'vision_configs',
  'imagination_configs',
  // Character data
  'character_profiles',
  'character_image',
  // Entity data
  'entities',
  'entity_module_mappings',
  // Conversation + interaction data
  'interactions',
  'conversation_messages',
  // 4-2: newly-registered table.
  'chat_conversation_settings',
  // Ephemeral / derived state
  'emotion_state',
  'lifecycle_state',
  'entity_emoji_actions',
  'memories',
];

describe('finalize-GC table list parity with SYNC_TABLES (4-1 / D72)', () => {
  beforeEach(() => {
    mockConnectionManager.removeAllListeners();
    jest.clearAllMocks();
  });

  it('GC_TABLES is the SAME 35-member set as SYNC_TABLES', () => {
    expect(SYNC_TABLES).toHaveLength(35);
    expect(GC_TABLES).toHaveLength(SYNC_TABLES.length);
    expect([...GC_TABLES].sort()).toEqual([...SYNC_TABLES].sort());
  });

  it('SYNC_TABLES is the SAME 35-table set as the engine-pinned list (6-1 §6.7 / D72)', () => {
    expect(PINNED_REGISTERED_SYNC_TABLES).toHaveLength(35);
    expect(SYNC_TABLES).toHaveLength(35);
    // Set comparison: the app's intra-provider-group send order differs from
    // the engine's (soulbitscloud/comfyui/google/xai positions), but the MEMBER
    // set must be exactly the engine-pinned 35. Exact-order parity is not
    // required post-D11 (each side sends in its own FK-safe order).
    expect([...SYNC_TABLES].sort()).toEqual(
      [...PINNED_REGISTERED_SYNC_TABLES].sort(),
    );
  });

  it('GC_TABLES includes the two D72 additions: emotion_state + lifecycle_state', () => {
    expect(GC_TABLES).toContain('emotion_state');
    expect(GC_TABLES).toContain('lifecycle_state');
  });

  it('GC_TABLES follows the engine child-first FK-safe dependency order (D71(a))', () => {
    // Exact-order pin: entity children → entities → character_profiles →
    // character_image → provider configs → module configs (within-group order
    // mirrors SYNC_TABLES; cross-repo within-group parity is 6-1's lock).
    expect(GC_TABLES).toEqual([
      'entity_module_mappings',
      'interactions',
      'conversation_messages',
      'memories',
      'emotion_state',
      'lifecycle_state',
      'entity_emoji_actions',
      'chat_conversation_settings',
      'entities',
      'character_profiles',
      'character_image',
      'provider_config_openai',
      'provider_config_ollama',
      'provider_config_openaicompatible',
      'provider_config_openrouter',
      'provider_config_harmonyspeech',
      'provider_config_elevenlabs',
      'provider_config_kindroid',
      'provider_config_kajiwoto',
      'provider_config_characterai',
      'provider_config_localai',
      'provider_config_mistral',
      'provider_config_comfyui',
      'provider_config_xai',
      'provider_config_google',
      'provider_config_anthropic',
      'provider_config_soulbitscloud',
      'backend_configs',
      'cognition_configs',
      'movement_configs',
      'rag_configs',
      'stt_configs',
      'tts_configs',
      'vision_configs',
      'imagination_configs',
    ]);
  });
});