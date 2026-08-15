/**
 * Test data fixtures for sync integration tests.
 *
 * Each factory produces a record ready to insert into the corresponding table.
 * Use `overrides` to customize specific fields for your test scenario.
 */

import type { ServerRecord } from './HarmonyLinkMockServer';

function randomId(prefix: string = ''): string {
  return `${prefix}${Math.random().toString(36).slice(2, 10)}`;
}

export function sampleCharacter(
  overrides: Partial<Record<string, any>> = {},
): ServerRecord {
  const now = new Date();
  return {
    id: randomId('char-'),
    name: 'Test Character',
    description: 'A test character for integration tests',
    personality: 'Friendly',
    voice_characteristics: '',
    // Character Card V3 standard fields (migration 000037 — NOT NULL DEFAULT '')
    first_mes: 'Hello there!',
    mes_example: '<START>\n{{user}}: Hi\n{{char}}: Hello!',
    alternate_greetings: '[]',
    post_history_instructions: '',
    creator_notes: '',
    creator: 'test-suite',
    character_version: '1.0',
    nickname: '',
    tags: '["test"]',
    group_only_greetings: '[]',
    extensions: '{}',
    assets: '[]',
    card_provenance: '{}',
    character_book: '{}',
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    deleted_at: null,
    ...overrides,
  };
}

/**
 * Insert a `sampleCharacter` record into character_profiles, building the
 * INSERT dynamically from the record's keys. The legacy columns
 * (appearance/backstory/example_dialogues) were dropped by migration 000037;
 * seeding through this helper keeps the tests tracking the fixture shape
 * instead of a hand-maintained column list.
 */
export async function insertCharacterProfile(
  db: {executeSql: (sql: string, params?: any[]) => Promise<any>},
  record: Record<string, any>,
): Promise<void> {
  const columns = Object.keys(record);
  const placeholders = columns.map(() => '?').join(', ');
  await db.executeSql(
    `INSERT INTO character_profiles (${columns.join(', ')}) VALUES (${placeholders})`,
    Object.values(record),
  );
}

/**
 * A `lifecycle_state` row (engine migration 000038 + 000040 sync columns).
 * entity_id is the PRIMARY KEY — same entity_id-PK shape as emotion_state.
 */
export function sampleLifecycleState(
  overrides: Partial<Record<string, any>> = {},
): ServerRecord {
  const now = new Date();
  return {
    entity_id: randomId('entity-'),
    exhaustion: 0.25,
    sleeping: false,
    sleep_start_time: null,
    last_beat_at: Math.floor(now.getTime() / 1000) - 600,
    last_outreach_at: Math.floor(now.getTime() / 1000) - 3600,
    inner_monologue: '["thinking about the weather"]',
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    deleted_at: null,
    ...overrides,
  };
}

export function sampleEntity(
  overrides: Partial<Record<string, any>> = {},
): Record<string, any> {
  const now = new Date();
  return {
    id: randomId('entity-'),
    alias: '',
    character_profile_id: null,
    lifecycle_config: null,
    rag_reindex_required: 1,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    deleted_at: null,
    ...overrides,
  };
}

export function sampleProviderConfigOpenAI(
  overrides: Partial<Record<string, any>> = {},
): Record<string, any> {
  const now = new Date();
  return {
    id: randomId('prov-'),
    name: 'Test OpenAI',
    api_key: 'sk-test',
    base_url: 'https://api.openai.com',
    model: 'gpt-4',
    max_tokens: 4096,
    temperature: 0.7,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    deleted_at: null,
    ...overrides,
  };
}

/**
 * A `provider_config_soulbitscloud` row. Provider configs have NO unique-name
 * constraint, so both the app-local row and the server row can coexist under
 * the same name — used to drive the "keep" cascade (the local provider config
 * is merged into the server provider config).
 */
export function sampleProviderConfigSoulbitsCloud(
  overrides: Partial<Record<string, any>> = {},
): ServerRecord {
  const now = new Date();
  return {
    id: randomId('prov-'),
    name: 'Default SoulbitsCloud',
    base_url: 'https://api.soulbits.app',
    api_key: '',
    model: 'starfallen-24b',
    max_tokens: 4096,
    max_completion_tokens: 0,
    temperature: 0.7,
    top_p: 1,
    frequency_penalty: 0,
    presence_penalty: 0,
    n: 1,
    stop_tokens: '[]',
    seed: 0,
    response_format: 'text',
    sampling_preset_name: '',
    extra_params: '{}',
    voice: '',
    speed: 1,
    format: 'mp3',
    image_aspect_ratio: '1:1',
    image_size: '1024x1024',
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    deleted_at: null,
    ...overrides,
  };
}

/**
 * A `stt_configs` row. `stt_configs.name` IS unique. Unlike the other module
 * config tables, stt_configs references TWO provider configs (transcription +
 * VAD) instead of a single provider_config_id — the keep cascade must handle
 * both columns.
 */
export function sampleSTTConfig(
  overrides: Partial<Record<string, any>> = {},
): ServerRecord {
  const now = new Date();
  return {
    id: randomId('stt-'),
    name: 'Default SoulbitsCloud',
    main_stream_time_millis: 0,
    transition_stream_time_millis: 0,
    max_buffer_count: 0,
    transcription_provider: 'soulbitscloud',
    transcription_provider_config_id: randomId('prov-'),
    vad_provider: 'soulbitscloud',
    vad_provider_config_id: randomId('prov-'),
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    deleted_at: null,
    ...overrides,
  };
}

/**
 * A `backend_configs` row. `backend_configs.name` is UNIQUE — used to drive
 * name-clash scenarios (two instances seeding the same default config name
 * with different UUIDs).
 */
export function sampleBackendConfig(
  overrides: Partial<Record<string, any>> = {},
): ServerRecord {
  const now = new Date();
  return {
    id: randomId('backend-'),
    name: 'Default SoulbitsCloud',
    provider: 'soulbitscloud',
    provider_config_id: randomId('prov-'),
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    deleted_at: null,
    ...overrides,
  };
}

/**
 * A `vision_configs` row. `vision_configs.name` IS unique (migration 000034) —
 * used to drive vision name-clash scenarios (two instances seeding the same
 * config name with different UUIDs).
 */
export function sampleVisionConfig(
  overrides: Partial<Record<string, any>> = {},
): ServerRecord {
  const now = new Date();
  return {
    id: randomId('vision-'),
    name: 'Vision Config',
    provider: 'soulbitscloud',
    provider_config_id: randomId('prov-'),
    resolution_width: 640,
    resolution_height: 480,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    deleted_at: null,
    ...overrides,
  };
}

export function sampleEntityModuleMapping(
  overrides: Partial<Record<string, any>> = {},
): Record<string, any> {
  const now = new Date();
  return {
    entity_id: randomId('entity-'),
    backend_config_id: null,
    cognition_config_id: null,
    imagination_config_id: null,
    movement_config_id: null,
    rag_config_id: null,
    stt_config_id: null,
    tts_config_id: null,
    vision_config_id: null,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    deleted_at: null,
    ...overrides,
  };
}

export function sampleConversationMessage(
  overrides: Partial<Record<string, any>> = {},
): Record<string, any> {
  const now = new Date();
  return {
    id: randomId('msg-'),
    entity_id: randomId('entity-'),
    role: 'user',
    content: 'Hello',
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    deleted_at: null,
    ...overrides,
  };
}

export function sampleMemory(
  overrides: Partial<Record<string, any>> = {},
): Record<string, any> {
  const now = new Date();
  return {
    id: randomId('mem-'),
    entity_id: randomId('entity-'),
    content: 'Test memory content',
    memory_type: 'general',
    emotional_context: 'neutral',
    significance: 0.5,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    deleted_at: null,
    ...overrides,
  };
}
