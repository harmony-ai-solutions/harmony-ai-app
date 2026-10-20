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
  characterImageInfoFixture,
  characterProfileFixture,
  conversationMessageFixture,
  emojiActionFixture,
  emotionStateFixture,
  entityConfigFixture,
  interactionFixture,
  memoryFixture,
} from '../__fixtures__/managementContract.fixtures';
import {
  mapCharacterImageInfo,
  mapCharacterProfile,
  mapConversationMessage,
  mapEmojiAction,
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
    expect(checkContractVersion('1.8.0').ok).toBe(true);
    expect(checkContractVersion('2.0.0').ok).toBe(true);
    expect(checkContractVersion('1.7.0').ok).toBe(false);
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
