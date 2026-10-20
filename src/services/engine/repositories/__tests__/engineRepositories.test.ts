/**
 * Management-API repository adapters — unit tests (task 3-2).
 */

jest.mock('../../../../utils/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import { engineApiClient, EngineApiUnsupportedError } from '../../EngineApiClient';
import { resetEngineServiceForTests, setEngineConnection } from '../../EngineService';
import { createMockManagementServer } from '../../__tests__/mockManagementServer';
import * as interactionsRepo from '../interactions';
import * as messagesRepo from '../conversation_messages';
import * as emojiRepo from '../emoji_actions';
import * as emotionRepo from '../emotion_state';
import * as memoriesRepo from '../memories';
import * as chatSettingsRepo from '../chatConversationSettings';
import * as charactersRepo from '../characters';
import * as entitiesRepo from '../entities';
import * as providersRepo from '../providers';
import * as modulesRepo from '../modules';
import * as userEntitiesRepo from '../userEntities';

const CONN = {
  wsPort: 1,
  wssPort: 0,
  adminPort: 2,
  bind: '127.0.0.1',
  pid: 1,
  dataDir: '',
  token: 'tok',
};

const chatListRow = (over: Record<string, unknown> = {}) => ({
  interaction_id: 'i1',
  participant_key: 'e1+e2',
  interaction_scope: 'private',
  participant_ids: '["e1","e2"]',
  last_message: null,
  last_message_at: null,
  unread_count: 0,
  pinned: false,
  archived: false,
  reply_mode: 'realistic',
  ...over,
});

function install(server: ReturnType<typeof createMockManagementServer>) {
  engineApiClient.setFetchImpl(server.fetch);
}

beforeEach(() => {
  resetEngineServiceForTests();
  setEngineConnection(CONN);
});

afterAll(() => {
  resetEngineServiceForTests();
});

describe('interactions adapter', () => {
  it('maps the chat-list page to PhoneConversationPageRow[]', async () => {
    const server = createMockManagementServer([
      {
        method: 'GET',
        path: /chat-list/,
        json: { conversations: [chatListRow()], has_more: false, next_offset: null },
      },
    ]);
    install(server);
    const rows = await interactionsRepo.getPhoneConversationsPage('e1', { limit: 50, offset: 0 });
    expect(rows).toEqual([
      {
        interactionId: 'i1',
        interactionScope: 'private',
        participantKey: 'e1+e2',
        participantIds: '["e1","e2"]',
      },
    ]);
  });

  it('derives the sorted pair key for entityHasPhoneInteraction', async () => {
    const server = createMockManagementServer([
      {
        method: 'GET',
        path: /interactions/,
        json: { interactions: [{ id: 'i1' }], has_more: false, next_offset: null },
      },
    ]);
    install(server);
    await expect(interactionsRepo.entityHasPhoneInteraction('e2', 'e1')).resolves.toBe(true);
    expect(server.lastCall('GET', /interactions/)!.query.participant_key).toBe('e1+e2');
  });

  it('returns the newest message as the last message', async () => {
    const server = createMockManagementServer([
      {
        method: 'GET',
        path: /messages/,
        json: {
          messages: [
            {
              id: 'm2',
              entity_id: 'e1',
              sender_entity_id: 'e2',
              content: 'newest',
              message_type: 'text',
              emotional_state_bits: 0,
              is_recon_followup: false,
              is_edited: false,
              created_at: '2026-10-11T10:00:00Z',
              updated_at: '2026-10-11T10:00:00Z',
              deleted_at: null,
            },
          ],
          has_more: false,
          next_cursor: null,
        },
      },
    ]);
    install(server);
    const last = await interactionsRepo.getLastInteractionMessage('e1', 'e1+e2');
    expect(last?.id).toBe('m2');
  });

  it('write paths throw EngineApiUnsupportedError', async () => {
    await expect(
      interactionsRepo.createInteraction({} as never),
    ).rejects.toBeInstanceOf(EngineApiUnsupportedError);
  });
});

describe('conversation_messages adapter', () => {
  it('maps a message page', async () => {
    const server = createMockManagementServer([
      {
        method: 'GET',
        path: /messages/,
        json: {
          messages: [
            {
              id: 'm1',
              entity_id: 'e1',
              sender_entity_id: 'e2',
              content: 'hi',
              message_type: 'text',
              emotional_state_bits: 0,
              is_recon_followup: false,
              is_edited: false,
              created_at: '2026-10-11T10:00:00Z',
              updated_at: '2026-10-11T10:00:00Z',
              deleted_at: null,
            },
          ],
          has_more: true,
          next_cursor: 'opaque-cursor',
        },
      },
    ]);
    install(server);
    const msgs = await messagesRepo.getConversationMessagesByParticipantKey('e1', 'e1+e2', 20);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].id).toBe('m1');
  });

  it('builds unread counts from the chat-list pages', async () => {
    const server = createMockManagementServer([
      {
        method: 'GET',
        path: /chat-list/,
        json: {
          conversations: [chatListRow({ participant_key: 'e1+e2', unread_count: 3 })],
          has_more: false,
          next_offset: null,
        },
      },
    ]);
    install(server);
    const map = await messagesRepo.getUnreadCountByParticipantKeys(['e1+e2', 'e1+e3'], 'e1');
    expect(map.get('e1+e2')).toBe(3);
    expect(map.has('e1+e3')).toBe(false);
  });

  it('write paths throw EngineApiUnsupportedError', async () => {
    await expect(
      messagesRepo.createConversationMessage({} as never),
    ).rejects.toBeInstanceOf(EngineApiUnsupportedError);
  });
});

describe('conversation_messages writes', () => {
  it('PATCHes only the engine-patchable fields', async () => {
    const server = createMockManagementServer([
      { method: 'PATCH', path: '/api/messages/m1', json: { status: 'message updated' } },
    ]);
    install(server);
    await messagesRepo.updateConversationMessage('m1', {
      content: 'edited',
      is_edited: true,
      // engine-unpatchable fields must NOT be sent
      message_type: 'combined' as never,
    });
    const call = server.lastCall('PATCH', '/api/messages/m1')!;
    expect(call.body).toEqual({ content: 'edited', is_edited: true });
  });

  it('rejects a patch with only engine-unpatchable fields', async () => {
    const server = createMockManagementServer([]);
    install(server);
    await expect(
      messagesRepo.updateConversationMessage('m1', { message_type: 'combined' } as never),
    ).rejects.toBeInstanceOf(EngineApiUnsupportedError);
  });

  it('soft-deletes via DELETE /api/messages/:id', async () => {
    const server = createMockManagementServer([
      { method: 'DELETE', path: '/api/messages/m1', json: { status: 'message deleted' } },
    ]);
    install(server);
    await messagesRepo.deleteConversationMessage('m1');
    expect(server.lastCall('DELETE', '/api/messages/m1')).toBeDefined();
  });

  it('clears a conversation via the entity-scoped DELETE', async () => {
    const server = createMockManagementServer([
      {
        method: 'DELETE',
        path: /\/api\/entities\/e1\/conversations\/.*\/messages/,
        json: { status: 'conversation cleared', interactions: 1, messages: 3 },
      },
    ]);
    install(server);
    await messagesRepo.deleteConversationByParticipantKey('e1', 'e1+e2');
    const call = server.lastCall('DELETE', /conversations/)!;
    expect(call.path).toBe('/api/entities/e1/conversations/e1%2Be2/messages');
  });

  it('marks a conversation read and returns the updated count', async () => {
    const server = createMockManagementServer([
      {
        method: 'POST',
        path: /\/api\/entities\/e1\/conversations\/.*\/read/,
        json: { status: 'ok', updated: 4 },
      },
    ]);
    install(server);
    const updated = await messagesRepo.markConversationMessagesRead('e1+e2', 'e1', 'm9');
    expect(updated).toBe(4);
    const call = server.lastCall('POST', /\/read/)!;
    expect(call.body).toEqual({ read: true, up_to_message_id: 'm9' });
  });

  it('marks unread with read:false', async () => {
    const server = createMockManagementServer([
      {
        method: 'POST',
        path: /\/api\/entities\/e1\/conversations\/.*\/read/,
        json: { status: 'ok', updated: 1 },
      },
    ]);
    install(server);
    await messagesRepo.markConversationMessagesUnread('e1+e2', 'e1');
    expect(server.lastCall('POST', /\/read/)!.body).toEqual({ read: false });
  });
});

describe('chatConversationSettings adapter', () => {
  it('pins via PUT chat-settings', async () => {
    const server = createMockManagementServer([
      { method: 'PUT', path: /\/api\/entities\/e1\/chat-settings\/.*/, json: { pinned: 1 } },
    ]);
    install(server);
    await chatSettingsRepo.setConversationPinned('e1+e2', 'e1', true);
    const call = server.lastCall('PUT', /chat-settings/)!;
    expect(call.path).toBe('/api/entities/e1/chat-settings/e1%2Be2');
    expect(call.body).toEqual({ pinned: true });
  });

  it('archives via PUT chat-settings', async () => {
    const server = createMockManagementServer([
      { method: 'PUT', path: /chat-settings/, json: { archived: 1 } },
    ]);
    install(server);
    await chatSettingsRepo.setConversationArchived('e1+e2', 'e1', true);
    expect(server.lastCall('PUT', /chat-settings/)!.body).toEqual({ archived: true });
  });

  it('throws when the POV entity id is missing', async () => {
    const server = createMockManagementServer([]);
    install(server);
    await expect(
      chatSettingsRepo.setConversationPinned('e1+e2', null, true),
    ).rejects.toThrow(/needs the POV entity id/);
  });
});

describe('emoji_actions writes', () => {
  it('creates an action with stringified JSON columns', async () => {
    const server = createMockManagementServer([
      { method: 'POST', path: '/api/entities/e1/emoji-actions', status: 201, json: {} },
    ]);
    install(server);
    await emojiRepo.createEmojiAction({
      id: 'a1',
      entityId: 'e1',
      emojiNative: '❤️',
      emotionEffect: { emotion: 'joy', delta: 2 },
      metabolismVector: null,
      substitutionText: '*hugs*',
      autoGenerated: false,
      isDefault: false,
    } as never);
    const call = server.lastCall('POST', '/api/entities/e1/emoji-actions')!;
    expect(call.body).toMatchObject({
      id: 'a1',
      emoji_native: '❤️',
      emotion_effect: JSON.stringify({ emotion: 'joy', delta: 2 }),
      metabolism_vector: null,
      substitution_text: '*hugs*',
    });
  });

  it('upserts: falls back to create when the action is absent (404)', async () => {
    const server = createMockManagementServer([
      { method: 'PUT', path: '/api/entities/e1/emoji-actions/a1', status: 404, json: { error: 'nf' } },
      { method: 'POST', path: '/api/entities/e1/emoji-actions', status: 201, json: {} },
    ]);
    install(server);
    await emojiRepo.upsertEmojiAction({
      id: 'a1',
      entityId: 'e1',
      emojiNative: '❤️',
      emotionEffect: null,
      metabolismVector: null,
      substitutionText: null,
      autoGenerated: true,
      isDefault: true,
    } as never);
    expect(server.lastCall('POST', '/api/entities/e1/emoji-actions')).toBeDefined();
  });

  it('deletes defaults and returns the count', async () => {
    const server = createMockManagementServer([
      {
        method: 'DELETE',
        path: '/api/entities/e1/emoji-actions',
        respond: () => ({ json: { status: 'ok', deleted: 5 } }),
      },
    ]);
    install(server);
    const deleted = await emojiRepo.deleteDefaultEmojiActions('e1');
    expect(deleted).toBe(5);
    expect(server.lastCall('DELETE', '/api/entities/e1/emoji-actions')!.query.scope).toBe('default');
  });
});

describe('characters adapter', () => {
  const profileDto = (over: Record<string, unknown> = {}) => ({
    id: 'p1',
    name: 'Aria',
    description: '',
    personality: '',
    is_favorite: 1,
    created_at: '2026-10-11T10:00:00Z',
    updated_at: '2026-10-11T10:00:00Z',
    ...over,
  });

  it('reads a profile with the additive favorite/timestamp fields', async () => {
    const server = createMockManagementServer([
      { method: 'GET', path: '/api/character-profiles/p1', json: profileDto() },
    ]);
    install(server);
    const profile = await charactersRepo.getCharacterProfile('p1');
    expect(profile?.is_favorite).toBe(1);
    expect(profile?.created_at.toISOString()).toBe('2026-10-11T10:00:00.000Z');
  });

  it('toggles favorite via PUT .../favorite', async () => {
    const server = createMockManagementServer([
      { method: 'GET', path: '/api/character-profiles/p1', json: profileDto({ is_favorite: 0 }) },
      { method: 'PUT', path: '/api/character-profiles/p1/favorite', json: { id: 'p1', is_favorite: true } },
    ]);
    install(server);
    const next = await charactersRepo.toggleCharacterFavorite('p1');
    expect(next).toBe(true);
    expect(server.lastCall('PUT', '/api/character-profiles/p1/favorite')!.body).toEqual({
      is_favorite: true,
    });
  });

  it('composes images + bytes into data URLs (3-4 step 1c)', async () => {
    const server = createMockManagementServer([
      {
        method: 'GET',
        path: '/api/character-profiles/p1/images',
        json: [
          {
            id: 'i1',
            character_profile_id: 'p1',
            mime_type: 'image/png',
            description: 'avatar',
            is_primary: true,
            display_order: 0,
            created_at: '2026-10-11T10:00:00Z',
          },
        ],
      },
      {
        method: 'GET',
        path: '/api/character-profiles/p1/images/i1',
        bytes: new Uint8Array([1, 2, 3]),
      },
    ]);
    install(server);
    const infos = await charactersRepo.getCharacterImagesWithDataURLs('p1');
    expect(infos).toHaveLength(1);
    expect(infos[0].data_url).toBe('data:image/png;base64,AQID');
    expect(infos[0].is_primary).toBe(true);
  });

  describe('display images — thumbnails + cache (contract 1.8.0)', () => {
    const primaryInfo = (over: Record<string, unknown> = {}) => ({
      id: 'i1',
      character_profile_id: 'p1',
      mime_type: 'image/gif',
      description: 'avatar',
      is_primary: true,
      display_order: 0,
      has_thumbnail: true,
      created_at: '2026-10-11T10:00:00Z',
      ...over,
    });

    const imagePath = '/api/character-profiles/p1/images/i1';

    beforeEach(() => {
      charactersRepo.clearCharacterImageCache();
    });

    it('getPrimaryImage costs 2 requests, asks for the thumb and propagates its mime', async () => {
      const server = createMockManagementServer([
        {
          method: 'GET',
          path: '/api/character-profiles/p1/images',
          json: [primaryInfo()],
        },
        {
          method: 'GET',
          path: imagePath,
          bytes: new Uint8Array([1, 2, 3]),
          headers: { 'content-type': 'image/jpeg' },
        },
      ]);
      install(server);

      const image = await charactersRepo.getPrimaryImage('p1');

      expect(server.calls).toHaveLength(2);
      expect(server.lastCall('GET', imagePath)!.query.variant).toBe('thumb');
      // The original is a GIF, the preview is a JPEG — the data URL must use
      // the RESPONSE mime, not the metadata mime.
      expect(image?.mime_type).toBe('image/jpeg');
      expect(charactersRepo.imageToDataURL(image!)).toBe('data:image/jpeg;base64,AQID');
      expect(image?.character_profile_id).toBe('p1');
      expect(image?.id).toBe('i1');
      expect(image?.is_primary).toBe(true);
    });

    it('falls back to the original when the thumb 404s, keeping the original mime', async () => {
      const server = createMockManagementServer([
        {
          method: 'GET',
          path: '/api/character-profiles/p1/images',
          json: [primaryInfo()],
        },
        {
          method: 'GET',
          path: imagePath,
          respond: req =>
            req.query.variant === 'thumb'
              ? {
                  status: 404,
                  json: {
                    error: 'no thumbnail available for this image',
                    fallback: 'original',
                  },
                }
              : {
                  bytes: new Uint8Array([4, 5, 6]),
                  headers: { 'content-type': 'image/gif' },
                },
        },
      ]);
      install(server);

      const image = await charactersRepo.getPrimaryImage('p1');

      // list + thumb 404 + original fallback
      expect(server.calls).toHaveLength(3);
      expect(server.lastCall('GET', imagePath)!.query.variant).toBeUndefined();
      expect(image?.mime_type).toBe('image/gif');
      expect(charactersRepo.imageToDataURL(image!)).toBe('data:image/gif;base64,BAUG');
    });

    it('fetches the original directly when the engine has no thumbnail', async () => {
      const server = createMockManagementServer([
        {
          method: 'GET',
          path: '/api/character-profiles/p1/images',
          json: [primaryInfo({ has_thumbnail: false })],
        },
        {
          method: 'GET',
          path: imagePath,
          bytes: new Uint8Array([7]),
          headers: { 'content-type': 'image/png' },
        },
      ]);
      install(server);

      const image = await charactersRepo.getPrimaryImage('p1');

      expect(server.calls).toHaveLength(2);
      expect(server.lastCall('GET', imagePath)!.query.variant).toBeUndefined();
      expect(image?.mime_type).toBe('image/png');
    });

    it('serves a repeat getPrimaryImage from cache without a second byte fetch', async () => {
      const server = createMockManagementServer([
        {
          method: 'GET',
          path: '/api/character-profiles/p1/images',
          json: [primaryInfo()],
        },
        {
          method: 'GET',
          path: imagePath,
          bytes: new Uint8Array([1, 2, 3]),
          headers: { 'content-type': 'image/jpeg' },
        },
      ]);
      install(server);

      await charactersRepo.getPrimaryImage('p1');
      await charactersRepo.getPrimaryImage('p1');

      // Two metadata lists (cheap), ONE byte fetch.
      expect(server.calls.filter(c => c.path === imagePath)).toHaveLength(1);
    });

    it('dedupes concurrent byte fetches for the same key', async () => {
      const server = createMockManagementServer([
        {
          method: 'GET',
          path: '/api/character-profiles/p1/images',
          json: [primaryInfo()],
        },
        {
          method: 'GET',
          path: imagePath,
          bytes: new Uint8Array([1, 2, 3]),
          headers: { 'content-type': 'image/jpeg' },
        },
      ]);
      install(server);

      const [a, b] = await Promise.all([
        charactersRepo.getPrimaryImage('p1'),
        charactersRepo.getPrimaryImage('p1'),
      ]);

      expect(a?.image_data).toBe('AQID');
      expect(b?.image_data).toBe('AQID');
      expect(
        server.calls.filter(c => c.path === imagePath && c.query.variant === 'thumb'),
      ).toHaveLength(1);
    });

    it('getCharacterImagesMetadata lists metadata with no blob GET', async () => {
      const server = createMockManagementServer([
        {
          method: 'GET',
          path: '/api/character-profiles/p1/images',
          json: [primaryInfo(), primaryInfo({ id: 'i2', is_primary: false })],
        },
      ]);
      install(server);

      const images = await charactersRepo.getCharacterImagesMetadata('p1');

      expect(server.calls).toHaveLength(1);
      expect(images).toHaveLength(2);
      expect(images[0].image_data).toBe('');
      expect(images[0].has_thumbnail).toBe(true);
      expect(images[1].is_primary).toBe(false);
    });

    it('builds an authenticated URL source for thumbnails and originals', () => {
      expect(charactersRepo.characterImageSource('p1', 'i1', 'thumb')).toEqual({
        uri: 'http://127.0.0.1:2/api/character-profiles/p1/images/i1?variant=thumb',
        headers: { 'X-Loopback-Token': 'tok' },
      });
      expect(charactersRepo.characterImageSource('p1', 'i1')).toEqual({
        uri: 'http://127.0.0.1:2/api/character-profiles/p1/images/i1',
        headers: { 'X-Loopback-Token': 'tok' },
      });
    });
  });

  it('hasChatPickerLibrary is true when a live non-persona profile exists', async () => {
    const server = createMockManagementServer([
      { method: 'GET', path: '/api/character-profiles', json: [profileDto()] },
      { method: 'GET', path: '/api/entities', json: {} },
    ]);
    install(server);
    await expect(charactersRepo.hasChatPickerLibrary()).resolves.toBe(true);
  });

  it('composes chat-picker rows and hides already-chatted entities (3-4 step 1c)', async () => {
    const server = createMockManagementServer([
      {
        method: 'GET',
        path: '/api/character-profiles',
        json: [
          profileDto({ id: 'p1', name: 'Aria' }),
          profileDto({ id: 'p2', name: 'Bella' }),
          profileDto({ id: 'p3', name: 'Cara' }),
          profileDto({ id: 'pu', name: 'You' }),
        ],
      },
      {
        method: 'GET',
        path: '/api/entities',
        json: {
          e1: {
            character_profile: { id: 'p1', name: 'Aria' },
            alias: 'Aria',
            entity_type: 'ai',
            is_muted: false,
            is_disabled: false,
            character_profile_id: 'p1',
          },
          e2: {
            character_profile: { id: 'p3', name: 'Cara' },
            alias: 'Cara',
            entity_type: 'ai',
            is_muted: false,
            is_disabled: false,
            character_profile_id: 'p3',
          },
          user: {
            character_profile: { id: 'pu', name: 'You' },
            alias: 'You',
            entity_type: 'user',
            is_muted: false,
            is_disabled: false,
            character_profile_id: 'pu',
          },
        },
      },
      {
        method: 'GET',
        path: /\/api\/entities\/user\/interactions/,
        json: {
          interactions: [{ id: 'i1', participant_ids: '["user","e2"]' }],
          has_more: false,
          next_offset: null,
        },
      },
    ]);
    install(server);
    const rows = await charactersRepo.getChatPickerRows('user');
    // Bella is an unreferenced card; Aria is an unused entity; Cara is hidden
    // (the persona already chatted with e2); the persona profile "You" is
    // excluded (persona-owned). Sorted by resolved label.
    expect(rows.map(r => (r.kind === 'card' ? r.profile.name : r.entity.alias))).toEqual([
      'Aria',
      'Bella',
    ]);
  });
});

describe('character stats adapter (task 3-4)', () => {
  it('reads per-entity stats and zero-defaults an absent id', async () => {
    const server = createMockManagementServer([
      {
        method: 'GET',
        path: '/api/stats/characters',
        json: { stats: { e1: { likes: 2, chats: 3 } } },
      },
    ]);
    install(server);
    await expect(charactersRepo.getCharacterStats('e1')).resolves.toEqual({ likes: 2, chats: 3 });
    await expect(charactersRepo.getCharacterStats('missing')).resolves.toEqual({
      likes: 0,
      chats: 0,
    });
  });
});

describe('entities adapter', () => {
  it('maps the entity map with additive fields', async () => {
    const server = createMockManagementServer([
      {
        method: 'GET',
        path: '/api/entities',
        json: {
          e1: {
            character_profile: { id: 'p1', name: 'Aria', description: '', personality: '' },
            modules: {},
            lifecycle_config: '{}',
            alias: 'Aria',
            entity_type: 'ai',
            is_muted: false,
            is_disabled: false,
            character_profile_id: 'p1',
            rag_reindex_required: false,
            created_at: '2026-10-11T10:00:00Z',
            updated_at: '2026-10-11T10:00:00Z',
            deleted_at: null,
          },
        },
      },
    ]);
    install(server);
    const entities = await entitiesRepo.getAllEntities();
    expect(entities).toHaveLength(1);
    expect(entities[0]).toMatchObject({
      id: 'e1',
      character_profile_id: 'p1',
      rag_reindex_required: 0,
    });
  });

  it('derives the module mapping from the entity config modules (task 3-4)', async () => {
    const server = createMockManagementServer([
      {
        method: 'GET',
        path: '/api/entities/e1',
        json: {
          character_profile: { id: 'p1', name: 'Aria', description: '', personality: '' },
          modules: { backend: { id: 'b1' }, cognition: { id: '' }, vision: { id: 'v1' } },
          lifecycle_config: '{}',
          alias: 'Aria',
          entity_type: 'ai',
          is_muted: false,
          is_disabled: false,
        },
      },
    ]);
    install(server);
    const mapping = await entitiesRepo.getEntityModuleMapping('e1');
    expect(mapping).toMatchObject({
      entity_id: 'e1',
      backend_config_id: 'b1',
      cognition_config_id: null,
      vision_config_id: 'v1',
      tts_config_id: null,
    });
  });

  it('writes the full 8-slot mapping via PUT .../mappings', async () => {
    const server = createMockManagementServer([
      { method: 'PUT', path: '/api/entities/e1/mappings', json: { status: 'entity mappings updated' } },
    ]);
    install(server);
    await entitiesRepo.createOrUpdateEntityModuleMapping({
      entity_id: 'e1',
      backend_config_id: 'b1',
      cognition_config_id: '',
      imagination_config_id: null,
      movement_config_id: null,
      rag_config_id: null,
      stt_config_id: null,
      tts_config_id: null,
      vision_config_id: null,
    });
    expect(server.lastCall('PUT', '/api/entities/e1/mappings')!.body).toEqual({
      backend_config_id: 'b1',
      cognition_config_id: null,
      imagination_config_id: null,
      movement_config_id: null,
      rag_config_id: null,
      stt_config_id: null,
      tts_config_id: null,
      vision_config_id: null,
    });
  });
});

describe('providers adapter (accounts API)', () => {
  const accountRow = (over: Record<string, unknown> = {}) => ({
    id: 'acc1',
    type: 'openai',
    name: 'default',
    api_key: 'sk',
    base_url: '',
    extra: '{}',
    created_at: '2026-10-11T10:00:00Z',
    updated_at: '2026-10-11T10:00:00Z',
    deleted_at: null,
    ...over,
  });

  it('lists accounts grouped by type', async () => {
    const server = createMockManagementServer([
      { method: 'GET', path: '/api/providers', json: { providers: { openai: [accountRow()] } } },
    ]);
    install(server);
    const accounts = await providersRepo.listAccounts('openai');
    expect(accounts.map(a => a.id)).toEqual(['acc1']);
    expect(accounts[0].created_at).toBeInstanceOf(Date);
    expect(server.lastCall('GET', '/api/providers')!.query.type).toBe('openai');
  });

  it('getAccount returns null on a 404', async () => {
    const server = createMockManagementServer([
      { method: 'GET', path: /\/api\/providers\//, status: 404, json: { error: 'nf' } },
    ]);
    install(server);
    await expect(providersRepo.getAccount('missing')).resolves.toBeNull();
  });

  it('getAccount recovers the type from the merged-object response', async () => {
    const server = createMockManagementServer([
      {
        method: 'GET',
        path: '/api/providers/acc1',
        json: { provider: 'openai', config: { id: 'acc1', api_key: 'sk', model: 'gpt-4o' } },
      },
    ]);
    install(server);
    const account = await providersRepo.getAccount('acc1');
    expect(account).toMatchObject({ id: 'acc1', type: 'openai', api_key: 'sk' });
  });

  it('creates an account with {type, account} and returns the engine-minted id', async () => {
    const server = createMockManagementServer([
      {
        method: 'POST',
        path: '/api/providers',
        json: { provider: 'openai', config: { id: 'new-acc', name: 'default' } },
      },
    ]);
    install(server);
    const id = await providersRepo.createAccount('openai', { name: 'default', api_key: 'sk' });
    expect(id).toBe('new-acc');
    expect(server.lastCall('POST', '/api/providers')!.body).toEqual({
      type: 'openai',
      account: { name: 'default', api_key: 'sk' },
    });
  });

  it('updates an account with an {account} partial merge', async () => {
    const server = createMockManagementServer([
      {
        method: 'PUT',
        path: '/api/providers/acc1',
        json: { provider: 'openai', config: { id: 'acc1', name: 'renamed' } },
      },
    ]);
    install(server);
    await providersRepo.updateAccount('acc1', { name: 'renamed' });
    expect(server.lastCall('PUT', '/api/providers/acc1')!.body).toEqual({
      account: { name: 'renamed' },
    });
  });

  it('deletes an account', async () => {
    const server = createMockManagementServer([
      { method: 'DELETE', path: '/api/providers/acc1', json: { status: 'provider account deleted' } },
    ]);
    install(server);
    await expect(providersRepo.deleteAccount('acc1')).resolves.toBeUndefined();
    expect(server.lastCall('DELETE', '/api/providers/acc1')).toBeDefined();
  });

  it('surfaces the 409 referencing_configs as a ProviderInUseError', async () => {
    const server = createMockManagementServer([
      {
        method: 'DELETE',
        path: '/api/providers/acc1',
        status: 409,
        json: {
          error: 'provider_in_use',
          referencing_configs: [{ module: 'backend', name: 'b', id: 'mc1' }],
        },
      },
    ]);
    install(server);
    const err = await providersRepo.deleteAccount('acc1').catch(e => e);
    expect(err).toBeInstanceOf(providersRepo.ProviderInUseError);
    expect((err as providersRepo.ProviderInUseError).referencingConfigs).toEqual([
      { module: 'backend', name: 'b', id: 'mc1' },
    ]);
  });
});

describe('modules adapter (flat account FK + capability overlay)', () => {
  it('maps a composite read to the flat row with the account FK + overlay', async () => {
    const server = createMockManagementServer([
      {
        method: 'GET',
        path: '/api/module-configs/backend',
        json: [
          {
            id: 'b1',
            name: 'default',
            provider: 'openai',
            provider_account_id: 'acc1',
            openai: { id: 'acc1', api_key: 'sk', model: 'gpt-4o', temperature: 0.7 },
            deleted_at: null,
          },
        ],
      },
    ]);
    install(server);
    const configs = await modulesRepo.getAllBackendConfigs();
    expect(configs[0]).toMatchObject({
      id: 'b1',
      provider_account_id: 'acc1',
    });
    // The account half (id/api_key) is stripped; the overlay is the remainder.
    expect(JSON.parse(configs[0].capability_json)).toEqual({ model: 'gpt-4o', temperature: 0.7 });
  });

  it('writes the flat provider_account_id + capability_json body straight from the row', async () => {
    const server = createMockManagementServer([
      {
        method: 'POST',
        path: '/api/module-configs/backend',
        status: 201,
        json: { id: 'mc-new', status: 'ok' },
      },
    ]);
    install(server);
    const id = await modulesRepo.createBackendConfig({
      name: 'cfg',
      provider: 'openai',
      provider_account_id: 'acc1',
      capability_json: JSON.stringify({ model: 'gpt-4o' }),
    });
    expect(id).toBe('mc-new');
    expect(server.lastCall('POST', '/api/module-configs/backend')!.body).toEqual({
      name: 'cfg',
      provider: 'openai',
      provider_account_id: 'acc1',
      capability_json: { model: 'gpt-4o' },
    });
  });

  it('does not read the referenced account on write (6-3 removed the stash/fallback)', async () => {
    const server = createMockManagementServer([
      {
        method: 'PUT',
        path: '/api/module-configs/backend/mc1',
        json: { status: 'ok' },
      },
    ]);
    install(server);
    await modulesRepo.updateBackendConfig({
      id: 'mc1',
      name: 'cfg',
      provider: 'openai',
      provider_account_id: 'acc1',
      capability_json: '{}',
      deleted_at: null,
    });
    // No GET /api/providers/:id was issued to resolve the overlay.
    expect(server.lastCall('GET', /\/api\/providers\//)).toBeUndefined();
    expect(server.lastCall('PUT', '/api/module-configs/backend/mc1')!.body).toEqual({
      name: 'cfg',
      provider: 'openai',
      provider_account_id: 'acc1',
    });
  });

  it('maps the STT dual-slot composite read', async () => {
    const server = createMockManagementServer([
      {
        method: 'GET',
        path: '/api/module-configs/stt',
        json: [
          {
            id: 's1',
            name: 'stt',
            transcription: { provider: 'openai', openai: { id: 'tx1', model: 'whisper-1' } },
            vad: { provider: 'soulvoice', soulvoice: { id: 'vad1', model: 'silero-vad' } },
            streamrecording: {
              mainstreamtimemillis: 500,
              transitionstreamtimemillis: 250,
              maxbuffercount: 10,
            },
            deleted_at: null,
          },
        ],
      },
    ]);
    install(server);
    const configs = await modulesRepo.getAllSTTConfigs();
    expect(configs[0]).toMatchObject({
      transcription_provider_account_id: 'tx1',
      vad_provider_account_id: 'vad1',
    });
    expect(JSON.parse(configs[0].transcription_capability_json)).toEqual({ model: 'whisper-1' });
    expect(JSON.parse(configs[0].vad_capability_json)).toEqual({ model: 'silero-vad' });
  });

  it('writes the STT dual-slot flat body (overlay from the row, disabled VAD)', async () => {
    const server = createMockManagementServer([
      {
        method: 'POST',
        path: '/api/module-configs/stt',
        status: 201,
        json: { id: 's-new', status: 'ok' },
      },
    ]);
    install(server);
    await modulesRepo.createSTTConfig({
      name: 'stt',
      transcription_provider: 'openai',
      transcription_provider_account_id: 'tx1',
      transcription_capability_json: JSON.stringify({ model: 'whisper-1' }),
      vad_provider: 'disabled',
      vad_provider_account_id: null,
      vad_capability_json: '{}',
      main_stream_time_millis: 500,
      transition_stream_time_millis: 250,
      max_buffer_count: 10,
    });
    const body = server.lastCall('POST', '/api/module-configs/stt')!.body as Record<string, unknown>;
    expect(body.transcription).toEqual({
      provider: 'openai',
      provider_account_id: 'tx1',
      capability_json: { model: 'whisper-1' },
    });
    expect(body.vad).toEqual({ provider: 'disabled' });
    expect(body.streamrecording).toEqual({
      mainstreamtimemillis: 500,
      transitionstreamtimemillis: 250,
      maxbuffercount: 10,
    });
  });
});

describe('userEntities adapter', () => {
  it('derives personas from user-type entities', async () => {
    const server = createMockManagementServer([
      {
        method: 'GET',
        path: '/api/entities',
        json: {
          user: {
            character_profile: { id: 'p1', name: 'You', description: 'me', personality: 'kind' },
            modules: {},
            lifecycle_config: '{}',
            alias: 'You',
            entity_type: 'user',
            is_muted: false,
            is_disabled: false,
            character_profile_id: 'p1',
          },
          e1: {
            character_profile: { id: 'p2', name: 'Aria', description: '', personality: '' },
            modules: {},
            lifecycle_config: '{}',
            alias: 'Aria',
            entity_type: 'ai',
            is_muted: false,
            is_disabled: false,
            character_profile_id: 'p2',
          },
        },
      },
      { method: 'GET', path: '/api/character-profiles/p1/images', json: [] },
    ]);
    install(server);
    const personas = await userEntitiesRepo.getUserEntities();
    expect(personas.map(p => p.id)).toEqual(['user']);
    expect(personas[0]).toMatchObject({ name: 'You', description: 'me', personality: 'kind' });
  });
});

describe('emoji_actions adapter', () => {
  it('keys actions by emoji native', async () => {
    const server = createMockManagementServer([
      {
        method: 'GET',
        path: /emoji-actions/,
        json: {
          emoji_actions: [
            {
              id: 'a1',
              entity_id: 'e1',
              emoji_native: '❤️',
              auto_generated: false,
              is_default: true,
              deleted_at: null,
              created_at: '2026-10-11T10:00:00Z',
              updated_at: '2026-10-11T10:00:00Z',
            },
          ],
        },
      },
    ]);
    install(server);
    const map = await emojiRepo.getEmojiActionsForEntity('e1');
    expect(map.get('❤️')?.isDefault).toBe(true);
    expect(await emojiRepo.countEmojiActions('e1')).toBe(1);
  });
});

describe('emotion_state adapter', () => {
  it('returns null when the engine has no live state', async () => {
    const server = createMockManagementServer([
      { method: 'GET', path: /emotion/, json: { emotion_state: null } },
    ]);
    install(server);
    await expect(emotionRepo.getEmotionState('e1')).resolves.toBeNull();
  });
});

describe('memories adapter', () => {
  it('walks pages until exhausted', async () => {
    let call = 0;
    const server = createMockManagementServer([
      {
        method: 'GET',
        path: /memories/,
        respond: () => {
          call += 1;
          if (call === 1) {
            return {
              json: {
                memories: [
                  {
                    id: 'mem1',
                    entity_id: 'e1',
                    compaction_level: 1,
                    content: 'a',
                    emotional_state_bits: 0,
                    created_at: '2026-10-11T10:00:00Z',
                    updated_at: '2026-10-11T10:00:00Z',
                    deleted_at: null,
                  },
                ],
                has_more: true,
                next_offset: 200,
              },
            };
          }
          return {
            json: {
              memories: [
                {
                  id: 'mem2',
                  entity_id: 'e1',
                  compaction_level: 1,
                  content: 'b',
                  emotional_state_bits: 0,
                  created_at: '2026-10-11T11:00:00Z',
                  updated_at: '2026-10-11T11:00:00Z',
                  deleted_at: null,
                },
              ],
              has_more: false,
              next_offset: null,
            },
          };
        },
      },
    ]);
    install(server);
    const mems = await memoriesRepo.getMemoriesForEntity('e1');
    expect(mems.map(m => m.id)).toEqual(['mem1', 'mem2']);
  });
});
