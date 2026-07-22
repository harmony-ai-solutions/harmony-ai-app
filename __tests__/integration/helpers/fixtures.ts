/**
 * Test data fixtures for sync integration tests.
 *
 * Each factory produces a record ready to insert into the corresponding table.
 * Use `overrides` to customize specific fields for your test scenario.
 */

function randomId(prefix: string = ''): string {
  return `${prefix}${Math.random().toString(36).slice(2, 10)}`;
}

export function sampleCharacter(
  overrides: Partial<Record<string, any>> = {},
): Record<string, any> {
  const now = new Date();
  return {
    id: randomId('char-'),
    name: 'Test Character',
    description: 'A test character for integration tests',
    personality: 'Friendly',
    appearance: '',
    backstory: '',
    voice_characteristics: '',
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
