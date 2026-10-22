/**
 * CharacterChatService tests — on-the-fly entity creation (relinked, task 3-4).
 *
 * When a chat is opened for a profile with no live entity, the service creates
 * an entity on the fly. After the 3-4 relink the ENGINE mints the id from the
 * card name (create-then-use-response); the app no longer pre-mints. This suite
 * mocks the management-API repository adapters with an in-memory store so the
 * service's create / reuse / gate / sync-wait behavior stays covered.
 */

import {openCharacterChat} from '../CharacterChatService';
import {Alert} from 'react-native';

/** In-memory entity store shared with the mocked adapter (mock-prefixed so the
 * hoisted jest.mock factory may reference it). */
let mockEntities: any[] = [];

jest.mock('../../services/engine/repositories/entities', () => {
  class ReservedEntityNameError extends Error {
    constructor(name: string) {
      super(`"${name}" is a reserved name — rename the card and retry`);
      this.name = 'ReservedEntityNameError';
    }
  }
  const slug = (name: string) => name.trim().replace(/\s+/g, '-');
  const deriveId = (name: string): string => {
    const base = `${slug(name)}-20260905123514`;
    let id = base;
    let n = 2;
    while (mockEntities.some(e => e.id === id)) {
      id = `${base}-${n}`;
      n += 1;
    }
    return id;
  };
  const deriveAlias = (name: string): string => {
    const base = name.trim();
    let alias = base;
    let n = 2;
    while (mockEntities.some(e => e.alias === alias && !e.deleted_at)) {
      alias = `${base} ${n}`;
      n += 1;
    }
    return alias;
  };
  return {
    ReservedEntityNameError,
    createEntity: jest.fn(async (input: any) => {
      const name = String(input?.name ?? '').trim();
      if (name.toLowerCase() === 'user' || name.toLowerCase() === 'deleted') {
        throw new ReservedEntityNameError(name);
      }
      const now = new Date();
      const entity = {
        id: deriveId(name),
        alias: deriveAlias(name),
        character_profile_id: input?.character_profile_id ?? null,
        entity_type: 'ai',
        is_muted: 0,
        is_disabled: 0,
        lifecycle_config: input?.lifecycle_config ?? '{}',
        rag_reindex_required: 1,
        created_at: now,
        updated_at: now,
        deleted_at: null,
      };
      mockEntities.push(entity);
      return entity;
    }),
    createEntityModuleMapping: jest.fn(async () => {}),
    getEntity: jest.fn(async (id: string) =>
      mockEntities.find(e => e.id === id && !e.deleted_at) ?? null,
    ),
    getEntityByCharacterProfileId: jest.fn(async (pid: string) => {
      const live = mockEntities.filter(e => e.character_profile_id === pid && !e.deleted_at);
      live.sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
      return live[0] ?? null;
    }),
  };
});

jest.mock('../../services/engine/repositories/userEntities', () => ({
  resolvePersonaId: jest.fn(async () => 'persona-1'),
}));

jest.mock('../../services/engine/repositories/interactions', () => ({
  deriveScopeFromParticipants: (participantIds: string[]) => {
    if (participantIds.length <= 1) return 'world';
    if (participantIds.length === 2) return 'private';
    return 'group';
  },
  deriveParticipantKey: (participantIds: string[], entityId: string, scope: string) => {
    if (participantIds.length <= 1) return '';
    if (scope === 'private' || participantIds.length === 2) {
      const partner = participantIds.find(id => id !== entityId);
      if (!partner) return '';
      return entityId < partner ? `${entityId}+${partner}` : `${partner}+${entityId}`;
    }
    return [...participantIds].sort().join('+');
  },
}));

jest.mock('../ChatPreferencesService', () => ({
  getGlobalImpersonatedEntity: jest.fn(() => Promise.resolve(null)),
  default: {},
}));

jest.mock('../marketplace/MarketplaceService', () => ({
  isChatLocked: jest.fn(() => Promise.resolve(false)),
  default: {},
}));

// 4-2 / D55: the chat-open critical wait reads the sync watermark via
// `getLastSyncTimestamp` and advances it when a sync round completes.
let mockWatermark = 0;


jest.mock('i18next', () => ({
  __esModule: true,
  default: {t: jest.fn((key: string) => key), language: 'en'},
}));

const TS = '20260905123514';

/** A plain profile object (the service receives it as an argument). */
function makeProfile(id: string, name: string): any {
  return {
    id,
    name,
    description: '',
    personality: '',
    voice_characteristics: '',
    base_prompt: '',
    scenario: '',
    typing_speed_wpm: 60,
    audio_response_chance_percent: 50,
    vision_config_id: null,
    lifecycle_config: '{}',
  };
}

/** Seed an entity directly into the in-memory store. */
function makeEntity(
  id: string,
  profileId: string | null,
  opts: {entity_type?: string; is_disabled?: number; alias?: string} = {},
): void {
  const now = new Date();
  mockEntities.push({
    id,
    alias: opts.alias ?? id,
    character_profile_id: profileId,
    entity_type: opts.entity_type ?? 'ai',
    is_muted: 0,
    is_disabled: opts.is_disabled ?? 0,
    lifecycle_config: '{}',
    rag_reindex_required: 1,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  });
}

function liveEntityCountForProfile(profileId: string): number {
  return mockEntities.filter(e => e.character_profile_id === profileId && !e.deleted_at).length;
}

function getEntityByCharacterProfileId(profileId: string): any {
  const live = mockEntities.filter(e => e.character_profile_id === profileId && !e.deleted_at);
  live.sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
  return live[0] ?? null;
}

describe('CharacterChatService — on-the-fly entity creation', () => {
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    mockEntities = [];
    mockWatermark = 0;
    jest.useFakeTimers({now: new Date('2026-09-05T12:35:14Z')});
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });
  afterEach(() => {
    jest.useRealTimers();
    alertSpy.mockRestore();
  });

  it('creates the on-the-fly entity via create-then-use-response (engine-derived id, no space)', async () => {
    const navigation = {navigateToChat: jest.fn()};

    await openCharacterChat(makeProfile('p-isabella', 'Isabella 2'), navigation);

    expect(navigation.navigateToChat).toHaveBeenCalledTimes(1);
    const params = navigation.navigateToChat.mock.calls[0][0];
    expect(params.participantIds).toContain(`Isabella-2-${TS}`);
    const entity = getEntityByCharacterProfileId('p-isabella');
    expect(entity?.id).toBe(`Isabella-2-${TS}`);
    expect(entity?.alias).toBe('Isabella 2');
    expect(entity?.id).not.toContain(' ');
  });

  it('a soft-deleted ghost id still reserves the slot → resolved to "-N"', async () => {
    const ghostId = `Ghost-Char-${TS}`;
    mockEntities.push({
      id: ghostId,
      alias: 'Ghost Char',
      character_profile_id: null,
      entity_type: 'ai',
      is_muted: 0,
      is_disabled: 0,
      lifecycle_config: '{}',
      rag_reindex_required: 1,
      created_at: new Date(),
      updated_at: new Date(),
      deleted_at: new Date(),
    });

    const navigation = {navigateToChat: jest.fn()};
    await expect(
      openCharacterChat(makeProfile('p-ghost', 'Ghost Char'), navigation),
    ).resolves.toBeUndefined();

    expect(navigation.navigateToChat).toHaveBeenCalledTimes(1);
    expect(navigation.navigateToChat.mock.calls[0][0].participantIds).toContain(
      `Ghost-Char-${TS}-2`,
    );
    expect(getEntityByCharacterProfileId('p-ghost')?.id).toBe(`Ghost-Char-${TS}-2`);
  });

  it('throws when the profile has no usable name (unchanged guard)', async () => {
    const navigation = {navigateToChat: jest.fn()};
    await expect(
      openCharacterChat(makeProfile('p-noname', '   '), navigation),
    ).rejects.toThrow(/without a name/);
  });

  it('throws a TYPED reserved-name error for a card named "user" or "deleted" (D33)', async () => {
    const {ReservedEntityNameError} = require('../../services/engine/repositories/entities');
    const navigation = {navigateToChat: jest.fn()};
    await expect(
      openCharacterChat(makeProfile('p-reserved', 'user'), navigation),
    ).rejects.toBeInstanceOf(ReservedEntityNameError);
    expect(getEntityByCharacterProfileId('p-reserved')).toBeNull();
  });

  it('dedupes the card alias when a SAME-NAME live card already exists (D56)', async () => {
    const navigation = {navigateToChat: jest.fn()};

    await openCharacterChat(makeProfile('p-card-a', 'Isabella'), navigation);
    const first = getEntityByCharacterProfileId('p-card-a');
    expect(first?.id).toBe(`Isabella-${TS}`);
    expect(first?.alias).toBe('Isabella');

    await openCharacterChat(makeProfile('p-card-b', 'Isabella'), navigation);
    const second = getEntityByCharacterProfileId('p-card-b');
    expect(second?.id).toBe(`Isabella-${TS}-2`);
    expect(second?.alias).toBe('Isabella 2');
    expect(navigation.navigateToChat).toHaveBeenCalledTimes(2);
  });

  // ── Task 3-4: no sync step before INIT_ENTITY (the engine authors the entity
  //    at create time). The legacy D55/4-2/Review-5 sync-wait tests are removed.
});

describe('CharacterChatService — picker entity rows (targetEntityId)', () => {
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    mockEntities = [];
    mockWatermark = 0;
    jest.useFakeTimers({now: new Date('2026-09-05T12:35:14Z')});
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });
  afterEach(() => {
    jest.useRealTimers();
    alertSpy.mockRestore();
  });

  it('navigates with the TARGET entity id and mints nothing', async () => {
    makeEntity('e1', 'p1');
    makeEntity('e2', 'p1', {alias: 'Aria Two'});
    const navigation = {navigateToChat: jest.fn()};

    await openCharacterChat(makeProfile('p1', 'Aria'), navigation, {targetEntityId: 'e2'});

    expect(navigation.navigateToChat).toHaveBeenCalledTimes(1);
    expect(navigation.navigateToChat.mock.calls[0][0].participantIds).toContain('e2');
    expect(liveEntityCountForProfile('p1')).toBe(2);
  });

  it('two entities on one card → targeting the OLDER one opens THAT one', async () => {
    makeEntity('e-older', 'p1', {alias: 'Aria Prime'});
    makeEntity('e-newer', 'p1');
    const navigation = {navigateToChat: jest.fn()};

    await openCharacterChat(makeProfile('p1', 'Aria'), navigation, {targetEntityId: 'e-older'});

    const params = navigation.navigateToChat.mock.calls[0][0];
    expect(params.participantIds).toContain('e-older');
    expect(params.participantIds).not.toContain('e-newer');
  });

  it('a DISABLED target NAVIGATES — no early return (ruling 3)', async () => {
    makeEntity('e1', 'p1', {is_disabled: 1});
    const navigation = {navigateToChat: jest.fn()};

    await openCharacterChat(makeProfile('p1', 'Aria'), navigation, {targetEntityId: 'e1'});

    expect(navigation.navigateToChat).toHaveBeenCalledTimes(1);
    expect(navigation.navigateToChat.mock.calls[0][0].participantIds).toContain('e1');
  });

  it('the entity branch uses `entity.alias || profile.name` as entityName', async () => {
    makeEntity('e1', 'p1', {alias: 'Alias Name'});
    makeEntity('e2', 'p1', {alias: ''});
    const navigation = {navigateToChat: jest.fn()};

    await openCharacterChat(makeProfile('p1', 'Profile Name'), navigation, {targetEntityId: 'e1'});
    expect(navigation.navigateToChat.mock.calls[0][0].entityName).toBe('Alias Name');

    await openCharacterChat(makeProfile('p1', 'Profile Name'), navigation, {targetEntityId: 'e2'});
    expect(navigation.navigateToChat.mock.calls[1][0].entityName).toBe('Profile Name');
  });

  it('throws for a MISSING target entity and does not navigate', async () => {
    makeEntity('e1', 'p1');
    const navigation = {navigateToChat: jest.fn()};

    await expect(
      openCharacterChat(makeProfile('p1', 'Aria'), navigation, {targetEntityId: 'ghost'}),
    ).rejects.toThrow(/not found/);
    expect(navigation.navigateToChat).not.toHaveBeenCalled();
  });

  it('throws for a USER-type target entity and does not navigate', async () => {
    makeEntity('persona-b', null, {entity_type: 'user'});
    const navigation = {navigateToChat: jest.fn()};

    await expect(
      openCharacterChat(makeProfile('p1', 'Aria'), navigation, {targetEntityId: 'persona-b'}),
    ).rejects.toThrow(/not an AI entity/);
    expect(navigation.navigateToChat).not.toHaveBeenCalled();
  });

  it('throws when the target entity links a DIFFERENT profile and does not navigate', async () => {
    makeEntity('e1', 'p2');
    const navigation = {navigateToChat: jest.fn()};

    await expect(
      openCharacterChat(makeProfile('p1', 'Aria'), navigation, {targetEntityId: 'e1'}),
    ).rejects.toThrow(/not linked/);
    expect(navigation.navigateToChat).not.toHaveBeenCalled();
  });

  it('card path UNCHANGED: a disabled card entity is still blocked (gate intact)', async () => {
    makeEntity('e-card', 'p-card', {is_disabled: 1});
    const navigation = {navigateToChat: jest.fn()};

    await openCharacterChat(makeProfile('p-card', 'Card Char'), navigation);

    expect(navigation.navigateToChat).not.toHaveBeenCalled();
    expect(liveEntityCountForProfile('p-card')).toBe(1);
  });
});
