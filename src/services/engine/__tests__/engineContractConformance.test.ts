/**
 * Engine management-API contract conformance (task 5-1 gate 1/2).
 *
 * The replacement for the retired RN↔Go schema-parity gate. Three things are
 * checked:
 *
 *   1. **Version canary** — the vendored shared fixtures advertise the contract
 *      version they were captured against; it MUST equal
 *      {@link ENGINE_CONTRACT_VERSION}. Bumping one side without the other fails
 *      here (the plan's "deliberate-drift canary").
 *   2. **Mapper conformance** — every golden wire fixture round-trips through the
 *      `engineApiMappers` layer to the app domain model with the expected
 *      coercions (RFC3339 → `Date`, `*bool` → boolean, snake → camel projection).
 *   3. **Manifest completeness** — every `REQUIRED_ENGINE_ENDPOINTS` entry names a
 *      fixture that exists (no orphan manifest rows).
 *
 * The fixtures themselves are typed as the wire DTOs, so `tsc --noEmit` already
 * enforces the fixture↔DTO shape half of the contract.
 */

jest.mock('../../../utils/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import {
  ENGINE_CONTRACT_VERSION,
  REQUIRED_ENGINE_ENDPOINTS,
  checkContractVersion,
  checkContractVersionExact,
} from '../engineContract';
import {
  CONTRACT_FIXTURES,
  FIXTURE_CONTRACT_VERSION,
  audioTagCapabilitiesChatterboxTurboFixture,
  audioTagCapabilitiesElevenV3Fixture,
  characterImageInfoFixture,
  characterProfileFixture,
  conversationMessageFixture,
  emojiActionFixture,
  emotionDerivedFixture,
  emotionEmptyFixture,
  emotionStateFixture,
  entityConfigFixture,
  interactionFixture,
  memoryFixture,
  moduleConfigOpenCodeGoFixture,
  openCodeGoAccountFixture,
  providerCapabilitiesAudioTagsFixture,
  providerModelsOpenCodeGoFixture,
  ragCollectionDetailFixture,
  ragCollectionStatsFixture,
  ragCollectionsFixture,
  ragDocumentDetailsFixture,
  ragDocumentsFixture,
  ragGroupsFixture,
  ragQueryResultFixture,
  ragTestQueryFixture,
  ttsSpeechTestFixture,
} from '../__fixtures__/managementContract.fixtures';
import {
  mapCharacterImageInfo,
  mapCharacterProfile,
  mapConversationMessage,
  mapEmojiAction,
  mapEmotionDerived,
  mapEmotionState,
  mapEntityConfig,
  mapInteraction,
  mapMemory,
} from '../engineApiMappers';

describe('engine contract — version gate', () => {
  it('the shared-fixture contract version equals the app requirement (drift canary)', () => {
    const result = checkContractVersionExact(FIXTURE_CONTRACT_VERSION);
    expect(result).toEqual({ ok: true });
    expect(FIXTURE_CONTRACT_VERSION).toBe(ENGINE_CONTRACT_VERSION);
  });

  it('a deliberately mismatched fixture version fails the canary', () => {
    const result = checkContractVersionExact('0.9.0');
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('0.9.0');
  });

  it('accepts an equal or newer engine artifact and rejects an older one', () => {
    expect(checkContractVersion(ENGINE_CONTRACT_VERSION).ok).toBe(true);
    expect(checkContractVersion('2.0.0').ok).toBe(true);
    expect(checkContractVersion('1.7.0').ok).toBe(false);
    expect(checkContractVersion('1.8.0').ok).toBe(false);
    expect(checkContractVersion('1.11.0').ok).toBe(false);
    expect(checkContractVersion('1.12.0').ok).toBe(true);
    expect(checkContractVersion('1.6.0').ok).toBe(false);
    expect(checkContractVersion('1.5.0').ok).toBe(false);
    expect(checkContractVersion('1.4.0').ok).toBe(false);
    expect(checkContractVersion('1.2.0').ok).toBe(false);
    expect(checkContractVersion('1.1.0').ok).toBe(false);
    expect(checkContractVersion('1.0.0').ok).toBe(false);
    expect(checkContractVersion('0.9.9').ok).toBe(false);
  });

  it('rejects an unparseable artifact version rather than assuming compatibility', () => {
    expect(checkContractVersion('').ok).toBe(false);
    expect(checkContractVersion('latest').ok).toBe(false);
  });
});

describe('engine contract — mapper conformance against shared fixtures', () => {
  it('conversation message: snake wire → domain, RFC3339 → Date, nullables preserved', () => {
    const mapped = mapConversationMessage(conversationMessageFixture);
    expect(mapped.id).toBe('msg-1');
    expect(mapped.interaction_id).toBe('int-1');
    expect(mapped.is_recon_followup).toBe(false);
    expect(mapped.is_read).toBe(true);
    expect(mapped.created_at).toBeInstanceOf(Date);
    expect(mapped.created_at.toISOString()).toBe('2026-10-12T09:00:00.000Z');
    expect(mapped.deleted_at).toBeNull();
  });

  it('interaction maps every field', () => {
    const mapped = mapInteraction(interactionFixture);
    expect(mapped.participant_key).toBe('ent-1+ent-2');
    expect(mapped.presence_type).toBe('phone');
    expect(mapped.ended_at).toBeNull();
  });

  it('emoji action projects to camelCase and parses JSON columns', () => {
    const mapped = mapEmojiAction(emojiActionFixture);
    expect(mapped.entityId).toBe('ent-1');
    expect(mapped.emojiNative).toBe('😀');
    expect(mapped.isDefault).toBe(true);
    expect(mapped.emotionEffect).toBeNull();
    expect(mapped.createdAt).toBeInstanceOf(Date);
  });

  it('emotion state maps the full Ekman-8 vector + crystallization timestamps', () => {
    const mapped = mapEmotionState(emotionStateFixture);
    expect(mapped.joy_intensity).toBe(0.5);
    expect(mapped.anticipation_baseline).toBe(0.3);
    expect(mapped.joy_crystallize_start).toBeNull();
    expect(mapped.last_update).toBeInstanceOf(Date);
  });

  it('emotion derived maps the >= 9.0 label, dyads and top-3 emotions', () => {
    const mapped = mapEmotionDerived(emotionDerivedFixture)!;
    expect(mapped.dominantEmotion).toBe('joy');
    expect(mapped.dominantIntensity).toBe(9.4);
    // The engine's new "overwhelming" bucket must survive the mapping untouched.
    expect(mapped.intensityLabel).toBe('overwhelming');
    expect(mapped.intensityLabels.joy).toBe('overwhelming');
    expect(Object.keys(mapped.intensityLabels)).toHaveLength(8);
    expect(mapped.activeDyads[0]).toMatchObject({
      keyword: 'affection',
      type: 'primary',
      sourceEmotions: ['joy', 'trust'],
      sourceIntensities: [9.4, 6.2],
      combinedIntensity: 15.6,
    });
    expect(mapped.activeDyads[0].description).toContain('affection');
    expect(mapped.topEmotions).toHaveLength(3);
    expect(mapped.topEmotions[0]).toEqual({
      emotion: 'joy',
      intensity: 9.4,
      label: 'overwhelming',
    });
  });

  it('the no-state envelope keeps emotion_derived null', () => {
    expect(emotionEmptyFixture.emotion_state).toBeNull();
    expect(emotionEmptyFixture.emotion_derived).toBeNull();
  });

  it('memory maps compaction level + dates', () => {
    const mapped = mapMemory(memoryFixture);
    expect(mapped.compaction_level).toBe(0);
    expect(mapped.content).toBe('A remembered detail');
    expect(mapped.start_date).toBeNull();
  });

  it('entity config maps the profile FK, mute/disable bits and timestamps', () => {
    const mapped = mapEntityConfig('ent-1', entityConfigFixture);
    expect(mapped.id).toBe('ent-1');
    expect(mapped.character_profile_id).toBe('prof-1');
    expect(mapped.is_muted).toBe(0);
    expect(mapped.is_disabled).toBe(0);
    expect(mapped.rag_reindex_required).toBe(0);
    expect(mapped.created_at).toBeInstanceOf(Date);
  });

  it('character profile maps additive 3-1b fields (is_favorite + timestamps)', () => {
    const mapped = mapCharacterProfile(characterProfileFixture);
    expect(mapped.name).toBe('Aria');
    expect(mapped.is_favorite).toBe(1);
    expect(mapped.updated_at).toBeInstanceOf(Date);
    // tts-voice-ux Phase 5 input: the engine-derived level survives the mapping.
    expect(mapped.vocal_expressiveness).toBe('expressive');
  });

  it('character image info maps metadata with an empty byte payload', () => {
    const mapped = mapCharacterImageInfo(characterImageInfoFixture);
    expect(mapped.id).toBe('img-1');
    expect(mapped.is_primary).toBe(true);
    expect(mapped.image_data).toBe('');
    // Contract 1.8.0: the list advertises a derived thumbnail, never a data_url.
    expect(characterImageInfoFixture.thumbnail_state).toBe('ready');
    expect(characterImageInfoFixture.has_thumbnail).toBe(true);
    expect(mapped.thumbnail_state).toBe('ready');
    expect(mapped.has_thumbnail).toBe(true);
  });

  it('character image info uses the RESPONSE mime for thumbnail bytes', () => {
    // A GIF original's derived preview is a JPEG — the data URL must not claim
    // `image/gif`.
    const mapped = mapCharacterImageInfo(
      { ...characterImageInfoFixture, mime_type: 'image/gif' },
      'AQID',
      'image/jpeg',
    );
    expect(mapped.mime_type).toBe('image/jpeg');
    expect(mapped.image_data).toBe('AQID');
  });
});

describe('engine contract — OpenCode Go provider shapes (1.12.0)', () => {
  it('lists an account-shaped opencodego row with a required key + optional base_url', () => {
    expect(openCodeGoAccountFixture).toMatchObject({
      type: 'opencodego',
      name: 'Go',
      base_url: '',
    });
    expect(openCodeGoAccountFixture.api_key).toBeTruthy();
    expect(CONTRACT_FIXTURES.providerList).toMatchObject({
      providers: { opencodego: [openCodeGoAccountFixture] },
    });
  });

  it('a module read merges the account half with the capability overlay', () => {
    expect(moduleConfigOpenCodeGoFixture).toMatchObject({
      provider: 'opencodego',
      provider_account_id: 'prov-og',
    });
    const merged = moduleConfigOpenCodeGoFixture.opencodego as Record<string, unknown>;
    // Account half.
    expect(merged).toMatchObject({ id: 'prov-og', name: 'Go', api_key: 'redacted' });
    // Capability half.
    expect(merged).toMatchObject({
      model: 'deepseek-v4.1-flash',
      temperature: 0.7,
      max_completion_tokens: 0,
    });
    // No auth-style / fingerprint capability fields (engine-owned headers).
    expect(merged).not.toHaveProperty('auth');
    expect(merged).not.toHaveProperty('fingerprint');
    expect(CONTRACT_FIXTURES.moduleConfigOpenCodeGo).toBe(moduleConfigOpenCodeGoFixture);
  });

  it('the models probe lists live chat models with no listing error', () => {
    expect(providerModelsOpenCodeGoFixture.models.map(model => model.id)).toContain(
      'deepseek-v4.1-flash',
    );
    expect(providerModelsOpenCodeGoFixture.error).toBeUndefined();
    expect(CONTRACT_FIXTURES.providerModelsOpenCodeGo).toBe(providerModelsOpenCodeGoFixture);
  });
});

describe('engine contract — kinded audio_tags + TTS test echo (tts-voice-ux)', () => {
  it('ElevenLabs v3 seeds OPEN cues/tones/breaks with the cataloggen counts', () => {
    expect(audioTagCapabilitiesElevenV3Fixture.syntax).toBe('[{}]');
    expect(audioTagCapabilitiesElevenV3Fixture.cues).toEqual({
      mode: 'open',
      vocabulary: expect.arrayContaining(['laughs', 'sighs', 'clears throat', 'wheezing']),
    });
    expect(audioTagCapabilitiesElevenV3Fixture.cues?.vocabulary).toHaveLength(12);
    expect(audioTagCapabilitiesElevenV3Fixture.tones?.vocabulary).toHaveLength(48);
    expect(audioTagCapabilitiesElevenV3Fixture.breaks).toEqual({
      mode: 'open',
      vocabulary: ['pause', 'long pause', 'short pause'],
    });
  });

  it('Chatterbox Turbo seeds CLOSED cue/tonal vocabularies and NO breaks kind', () => {
    expect(audioTagCapabilitiesChatterboxTurboFixture.cues?.mode).toBe('closed');
    expect(audioTagCapabilitiesChatterboxTurboFixture.cues?.vocabulary).toHaveLength(9);
    expect(audioTagCapabilitiesChatterboxTurboFixture.tones?.mode).toBe('closed');
    expect(audioTagCapabilitiesChatterboxTurboFixture.tones?.vocabulary).toHaveLength(10);
    // Absent kind ⇒ `none` on the app side; the fixture must not grow one.
    expect(audioTagCapabilitiesChatterboxTurboFixture).not.toHaveProperty('breaks');
  });

  it('the catalog row carries audio_tags for tagged models and none for the v2 family', () => {
    const elevenlabs = providerCapabilitiesAudioTagsFixture.providers?.elevenlabs?.models;
    expect(elevenlabs?.eleven_v3?.audio_tags).toBe(audioTagCapabilitiesElevenV3Fixture);
    expect(elevenlabs?.eleven_multilingual_v2).not.toHaveProperty('audio_tags');
    expect(
      providerCapabilitiesAudioTagsFixture.providers?.soulbitscloud?.models?.chatterbox_turbo
        ?.audio_tags,
    ).toBe(audioTagCapabilitiesChatterboxTurboFixture);
    expect(CONTRACT_FIXTURES.providerCapabilitiesAudioTags).toBe(
      providerCapabilitiesAudioTagsFixture,
    );
  });

  it('the TTS test response fixture carries input_text + the provider-bound text', () => {
    expect(ttsSpeechTestFixture.input_text).toBe(
      '*sighs* Well… *pause* I did not expect that.',
    );
    expect(ttsSpeechTestFixture.text).toBe(
      '[sighs] Well… [short pause] I did not expect that.',
    );
    // Boundary syntax only: the INPUT echo is asterisk dialect, never brackets.
    expect(ttsSpeechTestFixture.input_text).not.toMatch(/\[[^\]]+\]/);
    expect(CONTRACT_FIXTURES.ttsSpeechTest).toBe(ttsSpeechTestFixture);
  });
});

describe('engine contract — RAG collection shapes (camelCase wire keys)', () => {
  it('collections carry name/documentCount/lastUpdated/embeddingDim', () => {
    expect(ragCollectionsFixture.collections).toHaveLength(2);
    expect(ragCollectionsFixture.collections[0]).toEqual({
      name: 'lore',
      documentCount: 2,
      lastUpdated: '2026-11-16T09:00:00Z',
      embeddingDim: 1536,
    });
    // camelCase, never snake_case (Go drops unknown keys silently).
    expect(ragCollectionsFixture.collections[0]).not.toHaveProperty('document_count');
    expect(CONTRACT_FIXTURES.ragCollections).toBe(ragCollectionsFixture);
  });

  it('collection details = {info, stats}; stats keep the nested breakdown maps', () => {
    expect(ragCollectionDetailFixture.info).toEqual(ragCollectionsFixture.collections[0]);
    expect(ragCollectionDetailFixture.stats?.archetypeBreakdown).toEqual({
      character: 1,
      place: 1,
    });
    expect(ragCollectionDetailFixture.stats?.categoryBreakdown).toEqual({
      character: { bio: 1 },
      place: { world: 1 },
    });
    expect(ragCollectionStatsFixture.embeddingDimension).toBe(1536);
    expect(CONTRACT_FIXTURES.ragCollectionDetail).toBe(ragCollectionDetailFixture);
  });

  it('documents carry id/content/metadata/archetype/category/name/createdAt', () => {
    const doc = ragDocumentsFixture.documents[0];
    expect(ragDocumentsFixture.total).toBe(ragDocumentsFixture.documents.length);
    expect(Object.keys(doc).sort()).toEqual(
      ['archetype', 'category', 'content', 'createdAt', 'id', 'metadata', 'name'].sort(),
    );
    expect(doc.createdAt).toBe('2026-11-16T09:00:00Z');
    expect(doc.metadata).toEqual({ source: 'manual', entry_id: 'lore-1' });
    // The LIST shape has no embedding vector (details-only field).
    expect(doc).not.toHaveProperty('embedding');
    expect(CONTRACT_FIXTURES.ragDocuments).toBe(ragDocumentsFixture);
  });

  it('document details add the embedding vector (diagnostics only)', () => {
    expect(ragDocumentDetailsFixture.embedding).toEqual([0.012, -0.034, 0.056]);
    expect(ragDocumentDetailsFixture.id).toBe(ragDocumentsFixture.documents[0].id);
    expect(CONTRACT_FIXTURES.ragDocumentDetails).toBe(ragDocumentDetailsFixture);
  });

  it('test-query results use documentId + similarity', () => {
    expect(ragTestQueryFixture.query).toBe('who keeps the lighthouse?');
    expect(ragQueryResultFixture.documentId).toBe('doc-1');
    expect(ragQueryResultFixture.similarity).toBeCloseTo(0.91);
    expect(ragQueryResultFixture).not.toHaveProperty('document_id');
    expect(CONTRACT_FIXTURES.ragTestQuery).toBe(ragTestQueryFixture);
  });

  it('grouped view carries collectionName/groups/totalDocuments/supported', () => {
    expect(ragGroupsFixture.collectionName).toBe('lore');
    expect(ragGroupsFixture.supported).toBe(true);
    expect(ragGroupsFixture.totalDocuments).toBe(2);
    expect(ragGroupsFixture.groups.character[0]).toEqual({
      archetype: 'character',
      name: 'The lighthouse keeper',
      documentCount: 1,
      categories: { bio: 1 },
      lastUpdated: '2026-11-16T09:00:00Z',
    });
    expect(CONTRACT_FIXTURES.ragGroups).toBe(ragGroupsFixture);
  });
});

describe('engine contract — endpoint manifest completeness', () => {
  it('every required endpoint names a fixture that exists', () => {
    const missing = REQUIRED_ENGINE_ENDPOINTS.filter(
      endpoint => !(endpoint.fixture in CONTRACT_FIXTURES),
    ).map(endpoint => `${endpoint.id} → ${endpoint.fixture}`);
    expect(missing).toEqual([]);
  });

  it('endpoint ids and method+path pairs are unique', () => {
    const ids = REQUIRED_ENGINE_ENDPOINTS.map(e => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    const routes = REQUIRED_ENGINE_ENDPOINTS.map(e => `${e.method} ${e.path}`);
    expect(new Set(routes).size).toBe(routes.length);
  });

  it('declares the 7-2 sync-group key lifecycle endpoints (1.2.0 contract)', () => {
    const ids = REQUIRED_ENGINE_ENDPOINTS.map(e => e.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'syncClient.status',
        'syncGroup.keyStatus',
        'syncGroup.init',
        'syncGroup.import',
        'syncGroup.rotate',
        'syncGroup.rotationRequired',
      ]),
    );
  });

  it('declares the 7-11 engine-log endpoints (loopback-token scoped)', () => {
    const ids = REQUIRED_ENGINE_ENDPOINTS.map(e => e.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'engineLogs.list',
        'engineLogs.count',
        'engineLogs.components',
        'engineLogs.entities',
        'engineLogs.promptTypes',
        'engineLogs.getLevels',
        'engineLogs.setLevels',
      ]),
    );
    // The log entry fixture is camelCase (engine `logging.LogEntry` JSON tags).
    const entry = CONTRACT_FIXTURES.engineLogEntry as {
      entityId: string;
      isPrompt: boolean;
      message: string;
    };
    expect(entry.entityId).toBe('ent-1');
    expect(entry.isPrompt).toBe(false);
    expect(entry.message).toBe('composed reply');
  });

  it('declares the 2-4 TTS voice-cloning/design endpoints (1.7.0 contract)', () => {
    const ids = REQUIRED_ENGINE_ENDPOINTS.map(e => e.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'moduleConfigs.ttsEmbedSpeaker',
        'moduleConfigs.ttsTestSpeech',
        'providers.elevenlabsCloneVoice',
        'providers.elevenlabsVoiceDesign',
      ]),
    );
    // The loopback mock resolves the first matching route, so the static
    // `tts/…` paths MUST be declared before `/api/module-configs/:module/:id`.
    expect(ids.indexOf('moduleConfigs.ttsEmbedSpeaker')).toBeLessThan(
      ids.indexOf('moduleConfigs.get'),
    );
    expect(ids.indexOf('moduleConfigs.ttsTestSpeech')).toBeLessThan(
      ids.indexOf('moduleConfigs.get'),
    );
    expect(CONTRACT_FIXTURES.speakerEmbedding).toMatchObject({ status: 'success' });
    expect(CONTRACT_FIXTURES.ttsSpeechTest).toMatchObject({ format: 'audio/mpeg' });
    expect(CONTRACT_FIXTURES.elevenLabsVoiceClone).toMatchObject({
      data: { voice_id: '21m00Tcm4TlvDq8ikWAM' },
    });
    expect(CONTRACT_FIXTURES.elevenLabsVoiceDesign).toMatchObject({
      data: { text: 'Hello there' },
    });
  });

  it('the sync-client status fixture carries the 7-2 relay/group + 7-6 quota + 7-8 authority fields', () => {
    const fixture = CONTRACT_FIXTURES.syncClientStatus as {
      sync_group: string;
      rotation_required: boolean;
      cognition_authority: string | null;
      narration_paused: boolean;
      config: { transport: string; group_join_pending: boolean };
      relay: { sync_buffer_mb: number; sync_devices: number; backup_storage_mb: number } | null;
    };
    expect(fixture.sync_group).toBe('member');
    expect(fixture.rotation_required).toBe(false);
    expect(fixture.config.transport).toBe('relay');
    expect(fixture.config.group_join_pending).toBe(false);
    // Plan 7-6: the relay block carries the tier quotas (0 = unlimited).
    expect(fixture.relay?.sync_buffer_mb).toBe(64);
    expect(fixture.relay?.sync_devices).toBe(3);
    expect(fixture.relay?.backup_storage_mb).toBe(1024);
    // Plan 7-8: where cognition runs + whether narration is paused.
    expect(fixture.cognition_authority).toBe('local');
    expect(fixture.narration_paused).toBe(false);
    expect(CONTRACT_FIXTURES.syncGroupKeyStatus).toBeDefined();
  });
});
