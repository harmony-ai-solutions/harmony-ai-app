/**
 * CharacterChatService tests — on-the-fly entity creation (D2/D68/D56).
 *
 * When a chat is opened for a profile with no live entity, the service creates
 * an entity on the fly. The id is DERIVED from the card name (D2: timestamped,
 * spaces never survive) through the one mint seam; the card alias is deduped
 * (D56). The id must stay ghost-aware: a soft-deleted row with the same
 * derived id still reserves the TEXT PRIMARY KEY, so a same-second collision
 * resolves to "-N" on the FULL derived id instead of throwing.
 */

import {useFreshDatabase} from '../../database/__tests__/repositoryFixtures';
import {openCharacterChat} from '../CharacterChatService';
import {createCharacterProfile, getCharacterProfile} from '../../database/repositories/characters';
import {createEntity, deleteEntity, getEntityByCharacterProfileId} from '../../database/repositories/entities';
import {Alert} from 'react-native';

jest.mock('../ChatPreferencesService', () => ({
  getGlobalImpersonatedEntity: jest.fn(() => Promise.resolve(null)),
  default: {},
}));

jest.mock('../marketplace/MarketplaceService', () => ({
  isChatLocked: jest.fn(() => Promise.resolve(false)),
  default: {},
}));

// 4-2 / D55: the chat-open critical wait reads the sync watermark via
// `getLastSyncTimestamp` and advances it when a sync round completes. The
// default mock simulates a successful full round: the watermark jumps past the
// freshly-created entity, so the predicate re-check is clean.
let mockWatermark = 0;

jest.mock('../SyncService', () => ({
  __esModule: true,
  default: {
    syncAndWait: jest.fn(() => {
      mockWatermark = Math.floor(Date.now() / 1000) + 100;
      return Promise.resolve();
    }),
    getLastSyncTimestamp: jest.fn(() => Promise.resolve(mockWatermark)),
  },
}));

jest.mock('i18next', () => ({
  __esModule: true,
  default: {t: jest.fn((key: string) => key), language: 'en'},
}));

describe('CharacterChatService — on-the-fly entity creation', () => {
  const {getDb} = useFreshDatabase();

  // Pinned to the 6-1 fixed instant so derived ids are fully deterministic.
  const TS = '20260905123514';

  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    mockWatermark = 0;
    jest.useFakeTimers({now: new Date('2026-09-05T12:35:14Z')});
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    // Reset the SyncService mocks to their default per-test state (tests below
    // override syncAndWait with mockRejectedValueOnce / mockImplementation).
    const syncMock = require('../SyncService').default;
    (syncMock.syncAndWait as jest.Mock).mockReset();
    (syncMock.syncAndWait as jest.Mock).mockImplementation(() => {
      mockWatermark = Math.floor(Date.now() / 1000) + 100;
      return Promise.resolve();
    });
    (syncMock.getLastSyncTimestamp as jest.Mock).mockReset();
    (syncMock.getLastSyncTimestamp as jest.Mock).mockImplementation(() => Promise.resolve(mockWatermark));
  });
  afterEach(() => {
    jest.useRealTimers();
    alertSpy.mockRestore();
  });

  const makeProfile = async (id: string, name: string) =>
    createCharacterProfile({
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
    });

  it('creates the on-the-fly entity with the DERIVED id (no raw name, no space — D2/D3)', async () => {
    await makeProfile('p-isabella', 'Isabella 2');
    const navigation = {navigateToChat: jest.fn()};

    await openCharacterChat((await getCharacterProfile('p-isabella'))!, navigation);

    expect(navigation.navigateToChat).toHaveBeenCalledTimes(1);
    const params = navigation.navigateToChat.mock.calls[0][0];
    // participantIds = [impersonated persona, character entity]
    expect(params.participantIds).toContain(`Isabella-2-${TS}`);
    const entity = await getEntityByCharacterProfileId('p-isabella');
    expect(entity?.id).toBe(`Isabella-2-${TS}`);
    // The card alias is deduped but kept verbatim when free (D56).
    expect(entity?.alias).toBe('Isabella 2');
    // Never the raw card name, never a space-containing id.
    expect(entity?.id).not.toBe('Isabella 2');
    expect(entity?.id).not.toContain(' ');
  });

  it('resolves a same-second ghost-id collision to "-N" on the FULL derived id (ghost-id bug)', async () => {
    await makeProfile('p-ghost', 'Ghost Char');
    // A soft-deleted entity holding the DERIVED id still reserves the TEXT
    // PRIMARY KEY (e.g. a previous chat-open in the same second that was
    // deleted).
    const ghostId = `Ghost-Char-${TS}`;
    await createEntity({
      id: ghostId,
      character_profile_id: null,
      alias: 'Ghost Char',
      lifecycle_config: '{}',
      rag_reindex_required: 1,
    });
    await deleteEntity(ghostId);

    const navigation = {navigateToChat: jest.fn()};
    await expect(
      openCharacterChat((await getCharacterProfile('p-ghost'))!, navigation),
    ).resolves.toBeUndefined();

    // The on-the-fly entity landed on the resolved "-2" id and is LIVE.
    expect(navigation.navigateToChat).toHaveBeenCalledTimes(1);
    const params = navigation.navigateToChat.mock.calls[0][0];
    expect(params.participantIds).toContain(`Ghost-Char-${TS}-2`);
    const entity = await getEntityByCharacterProfileId('p-ghost');
    expect(entity?.id).toBe(`Ghost-Char-${TS}-2`);
    expect(entity?.deleted_at).toBeNull();
  });

  it('throws when the profile has no usable name (unchanged guard)', async () => {
    await makeProfile('p-noname', '   ');
    const navigation = {navigateToChat: jest.fn()};
    await expect(
      openCharacterChat((await getCharacterProfile('p-noname'))!, navigation),
    ).rejects.toThrow(/without a name/);
  });

  it('throws a TYPED reserved-name error for a card named "user" or "deleted" (D33)', async () => {
    const {ReservedEntityNameError} = require('../../database/repositories/entities');
    await makeProfile('p-reserved', 'user');
    const navigation = {navigateToChat: jest.fn()};
    await expect(
      openCharacterChat((await getCharacterProfile('p-reserved'))!, navigation),
    ).rejects.toBeInstanceOf(ReservedEntityNameError);
    // No entity was created.
    expect(await getEntityByCharacterProfileId('p-reserved')).toBeNull();
  });

  it('dedupes the card alias when a SAME-NAME live card already exists (D56)', async () => {
    await makeProfile('p-card-a', 'Isabella');
    await makeProfile('p-card-b', 'Isabella');
    const navigation = {navigateToChat: jest.fn()};

    // First card → id "Isabella-<ts>", alias verbatim.
    await openCharacterChat((await getCharacterProfile('p-card-a'))!, navigation);
    const first = await getEntityByCharacterProfileId('p-card-a');
    expect(first?.id).toBe(`Isabella-${TS}`);
    expect(first?.alias).toBe('Isabella');

    // Second (same-name) card → id "-2" (same second), alias deduped "Isabella 2".
    await openCharacterChat((await getCharacterProfile('p-card-b'))!, navigation);
    const second = await getEntityByCharacterProfileId('p-card-b');
    expect(second?.id).toBe(`Isabella-${TS}-2`);
    expect(second?.alias).toBe('Isabella 2');
    expect(navigation.navigateToChat).toHaveBeenCalledTimes(2);
  });

  // ── 4-2 / D55: critical-wait-before-INIT_ENTITY ──────────────────────────

  it('D55: a dirty entity runs a CRITICAL wait before INIT_ENTITY, then navigates', async () => {
    const syncMock = require('../SyncService').default;
    await makeProfile('p-d55', 'D55 Char');
    const navigation = {navigateToChat: jest.fn()};

    await openCharacterChat((await getCharacterProfile('p-d55'))!, navigation);

    // Critical opt-in + the pre-chat timeout budget.
    expect(syncMock.syncAndWait).toHaveBeenCalledWith({timeoutMs: 15_000, critical: true});
    // The wait resolved and the watermark advanced → the entity is ingested
    // before INIT_ENTITY → navigation proceeds.
    expect(navigation.navigateToChat).toHaveBeenCalledTimes(1);
  });

  it('D55: a clean (already-synced) entity SKIPS the critical wait — zero added latency', async () => {
    const syncMock = require('../SyncService').default;
    await makeProfile('p-clean', 'Clean Char');
    // Simulate a pulled / already-synced entity: its updated_at predates the
    // last successful full-sync watermark.
    const entity = await createEntity({
      id: `Clean-Char-${TS}`,
      alias: 'Clean Char',
      character_profile_id: 'p-clean',
      lifecycle_config: '{}',
      rag_reindex_required: 1,
    });
    mockWatermark = Math.floor(entity.updated_at.getTime() / 1000) + 100;

    const navigation = {navigateToChat: jest.fn()};
    await openCharacterChat((await getCharacterProfile('p-clean'))!, navigation);

    expect(syncMock.syncAndWait).not.toHaveBeenCalled();
    expect(navigation.navigateToChat).toHaveBeenCalledTimes(1);
  });

  it('4-2: a sync_conflict on push surfaces the conflict alert and does NOT navigate', async () => {
    const syncMock = require('../SyncService').default;
    const syncErr = Object.assign(
      new Error('UNIQUE constraint failed: entities.id'),
      {table: 'entities', entityId: `Conflict-Char-${TS}`, code: 'sync_conflict'},
    );
    (syncMock.syncAndWait as jest.Mock).mockRejectedValueOnce(syncErr);

    await makeProfile('p-conflict', 'Conflict Char');
    const navigation = {navigateToChat: jest.fn()};
    await openCharacterChat((await getCharacterProfile('p-conflict'))!, navigation);

    expect(Alert.alert).toHaveBeenCalledWith('common:error', 'characters:chatOpenSyncConflict');
    // No navigation into a doomed chat — a retry re-runs creation (fresh id).
    expect(navigation.navigateToChat).not.toHaveBeenCalled();
    // No entity session was created (the flow never reached navigation).
    expect(await getEntityByCharacterProfileId('p-conflict')).not.toBeNull();
  });

  it('4-2: a transient push failure shows the generic retry alert and does NOT navigate', async () => {
    const syncMock = require('../SyncService').default;
    (syncMock.syncAndWait as jest.Mock).mockRejectedValueOnce(new Error('connection reset'));

    await makeProfile('p-transient', 'Transient Char');
    const navigation = {navigateToChat: jest.fn()};
    await openCharacterChat((await getCharacterProfile('p-transient'))!, navigation);

    expect(Alert.alert).toHaveBeenCalledWith('common:error', 'characters:chatOpenSyncFailed');
    expect(navigation.navigateToChat).not.toHaveBeenCalled();
  });

  it('Review-5: an in-flight-round resolve (wrong round) re-checks and runs ONE bounded second round', async () => {
    const syncMock = require('../SyncService').default;
    let calls = 0;
    (syncMock.syncAndWait as jest.Mock).mockImplementation(() => {
      calls += 1;
      if (calls === 1) {
        // Wrong-round resolve: the in-flight session's upload capture already
        // ran, so the watermark did NOT advance past the just-created entity
        // (the predicate re-check stays dirty).
        return Promise.resolve();
      }
      // Round 2 is guaranteed fresh (post-resolve currentSession is null): it
      // pushes the entity and advances the watermark.
      mockWatermark = Math.floor(Date.now() / 1000) + 100;
      return Promise.resolve();
    });

    await makeProfile('p-race', 'Race Char');
    const navigation = {navigateToChat: jest.fn()};
    await openCharacterChat((await getCharacterProfile('p-race'))!, navigation);

    expect(syncMock.syncAndWait).toHaveBeenCalledTimes(2);
    expect(navigation.navigateToChat).toHaveBeenCalledTimes(1);
  });

  it('Review-5: still dirty after the bounded 2 rounds → failure alert, no navigation', async () => {
    const syncMock = require('../SyncService').default;
    // syncAndWait resolves but the watermark NEVER advances (the entity is
    // never pushed) — the ≤2 bound must trip.
    (syncMock.syncAndWait as jest.Mock).mockImplementation(() => Promise.resolve());

    await makeProfile('p-bound', 'Bound Char');
    const navigation = {navigateToChat: jest.fn()};
    await openCharacterChat((await getCharacterProfile('p-bound'))!, navigation);

    expect(syncMock.syncAndWait).toHaveBeenCalledTimes(2);
    expect(Alert.alert).toHaveBeenCalledWith('common:error', 'characters:chatOpenSyncFailed');
    expect(navigation.navigateToChat).not.toHaveBeenCalled();
  });
});

/**
 * Chat-picker entity rows (rulings 1b/3): openCharacterChat with
 * `targetEntityId` must open the chat with THAT EXACT live AI entity — no
 * minting, no newest-entity reuse — and a DISABLED target still opens the
 * chat (ChatDetail shows the disabled state; the user unblocks in chat
 * settings). The card path (no options) keeps its reuse-or-mint behavior and
 * its disabled gate unchanged.
 */
describe('CharacterChatService — picker entity rows (targetEntityId)', () => {
  const {getDb} = useFreshDatabase();

  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    mockWatermark = 0;
    jest.useFakeTimers({now: new Date('2026-09-05T12:35:14Z')});
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const syncMock = require('../SyncService').default;
    (syncMock.syncAndWait as jest.Mock).mockReset();
    (syncMock.syncAndWait as jest.Mock).mockImplementation(() => {
      mockWatermark = Math.floor(Date.now() / 1000) + 100;
      return Promise.resolve();
    });
    (syncMock.getLastSyncTimestamp as jest.Mock).mockReset();
    (syncMock.getLastSyncTimestamp as jest.Mock).mockImplementation(() => Promise.resolve(mockWatermark));
  });
  afterEach(() => {
    jest.useRealTimers();
    alertSpy.mockRestore();
  });

  const makeProfile = async (id: string, name: string) =>
    createCharacterProfile({
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
    });

  const makeEntity = (
    id: string,
    profileId: string | null,
    opts: {entity_type?: string; is_disabled?: number; alias?: string} = {},
  ) =>
    createEntity(
      {
        id,
        alias: opts.alias ?? id,
        character_profile_id: profileId,
        lifecycle_config: '{}',
        rag_reindex_required: 1,
      },
      {
        entity_type: opts.entity_type ?? 'ai',
        is_disabled: opts.is_disabled ?? 0,
      },
    );

  const liveEntityCountForProfile = async (profileId: string): Promise<number> => {
    const [results] = await getDb().executeSql(
      'SELECT COUNT(*) AS count FROM entities WHERE character_profile_id = ? AND deleted_at IS NULL',
      [profileId],
    );
    return results.rows.item(0).count;
  };

  it('navigates with the TARGET entity id and mints nothing', async () => {
    await makeProfile('p1', 'Aria');
    await makeEntity('e1', 'p1');
    await makeEntity('e2', 'p1', {alias: 'Aria Two'});
    const navigation = {navigateToChat: jest.fn()};

    await openCharacterChat((await getCharacterProfile('p1'))!, navigation, {
      targetEntityId: 'e2',
    });

    expect(navigation.navigateToChat).toHaveBeenCalledTimes(1);
    const params = navigation.navigateToChat.mock.calls[0][0];
    expect(params.participantIds).toContain('e2');
    // NO minting — the card still carries exactly its two pre-existing entities.
    expect(await liveEntityCountForProfile('p1')).toBe(2);
  });

  it('two entities on one card → targeting the OLDER one opens THAT one', async () => {
    await makeProfile('p1', 'Aria');
    await makeEntity('e-older', 'p1', {alias: 'Aria Prime'});
    await makeEntity('e-newer', 'p1');
    const navigation = {navigateToChat: jest.fn()};

    // The old reuse path (getEntityByCharacterProfileId, ORDER BY created_at
    // DESC) would silently route to e-newer — the bug. Targeting must win.
    await openCharacterChat((await getCharacterProfile('p1'))!, navigation, {
      targetEntityId: 'e-older',
    });

    const params = navigation.navigateToChat.mock.calls[0][0];
    expect(params.participantIds).toContain('e-older');
    expect(params.participantIds).not.toContain('e-newer');
  });

  it('a DISABLED target NAVIGATES — no early return (ruling 3)', async () => {
    await makeProfile('p1', 'Aria');
    await makeEntity('e1', 'p1', {is_disabled: 1});
    const navigation = {navigateToChat: jest.fn()};

    await openCharacterChat((await getCharacterProfile('p1'))!, navigation, {
      targetEntityId: 'e1',
    });

    expect(navigation.navigateToChat).toHaveBeenCalledTimes(1);
    expect(navigation.navigateToChat.mock.calls[0][0].participantIds).toContain('e1');
  });

  it('the entity branch uses `entity.alias || profile.name` as entityName', async () => {
    await makeProfile('p1', 'Profile Name');
    await makeEntity('e1', 'p1', {alias: 'Alias Name'});
    await makeEntity('e2', 'p1', {alias: ''});
    const navigation = {navigateToChat: jest.fn()};

    await openCharacterChat((await getCharacterProfile('p1'))!, navigation, {
      targetEntityId: 'e1',
    });
    expect(navigation.navigateToChat.mock.calls[0][0].entityName).toBe('Alias Name');

    // Empty alias falls back to the profile name.
    await openCharacterChat((await getCharacterProfile('p1'))!, navigation, {
      targetEntityId: 'e2',
    });
    expect(navigation.navigateToChat.mock.calls[1][0].entityName).toBe('Profile Name');
  });

  it('throws for a MISSING target entity and does not navigate', async () => {
    await makeProfile('p1', 'Aria');
    await makeEntity('e1', 'p1');
    const navigation = {navigateToChat: jest.fn()};

    await expect(
      openCharacterChat((await getCharacterProfile('p1'))!, navigation, {
        targetEntityId: 'ghost',
      }),
    ).rejects.toThrow(/not found/);
    expect(navigation.navigateToChat).not.toHaveBeenCalled();
  });

  it('throws for a USER-type target entity and does not navigate', async () => {
    await makeProfile('p1', 'Aria');
    await makeEntity('persona-b', null, {entity_type: 'user'});
    const navigation = {navigateToChat: jest.fn()};

    await expect(
      openCharacterChat((await getCharacterProfile('p1'))!, navigation, {
        targetEntityId: 'persona-b',
      }),
    ).rejects.toThrow(/not an AI entity/);
    expect(navigation.navigateToChat).not.toHaveBeenCalled();
  });

  it('throws when the target entity links a DIFFERENT profile and does not navigate', async () => {
    await makeProfile('p1', 'Aria');
    await makeProfile('p2', 'Bela');
    await makeEntity('e1', 'p2');
    const navigation = {navigateToChat: jest.fn()};

    await expect(
      openCharacterChat((await getCharacterProfile('p1'))!, navigation, {
        targetEntityId: 'e1',
      }),
    ).rejects.toThrow(/not linked/);
    expect(navigation.navigateToChat).not.toHaveBeenCalled();
  });

  it('card path UNCHANGED: a disabled card entity is still blocked (gate intact)', async () => {
    await makeProfile('p-card', 'Card Char');
    await makeEntity('e-card', 'p-card', {is_disabled: 1});
    const navigation = {navigateToChat: jest.fn()};

    // No options — the card path keeps its Q8/A3 early return.
    await openCharacterChat((await getCharacterProfile('p-card'))!, navigation);

    expect(navigation.navigateToChat).not.toHaveBeenCalled();
    // And no on-the-fly mint happened either (the reuse path found e-card).
    expect(await liveEntityCountForProfile('p-card')).toBe(1);
  });
});