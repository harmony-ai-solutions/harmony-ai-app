/**
 * CharacterChatService tests — on-the-fly entity creation (ghost-id bug).
 *
 * When a chat is opened for a profile with no live entity, the service creates
 * an entity on the fly whose id is the profile name. The id must be
 * ghost-aware: a soft-deleted row with the same id still reserves the TEXT
 * PRIMARY KEY, so a collision must resolve to a copy id instead of throwing
 * (which previously stranded the profile without an entity).
 */

import {useFreshDatabase} from '../../database/__tests__/repositoryFixtures';
import {openCharacterChat} from '../CharacterChatService';
import {createCharacterProfile, getCharacterProfile} from '../../database/repositories/characters';
import {createEntity, deleteEntity, getEntityByCharacterProfileId} from '../../database/repositories/entities';

jest.mock('../ChatPreferencesService', () => ({
  getGlobalImpersonatedEntity: jest.fn(() => Promise.resolve(null)),
  default: {},
}));

jest.mock('../marketplace/MarketplaceService', () => ({
  isChatLocked: jest.fn(() => Promise.resolve(false)),
  default: {},
}));

jest.mock('../SyncService', () => ({
  __esModule: true,
  default: {
    syncAndWait: jest.fn(() => Promise.resolve()),
  },
}));

describe('CharacterChatService — on-the-fly entity creation', () => {
  const {getDb} = useFreshDatabase();

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

  it('creates the on-the-fly entity with the raw name when the id is free (fast path)', async () => {
    await makeProfile('p-free', 'Free Char');
    const navigation = {navigateToChat: jest.fn()};

    await openCharacterChat((await getCharacterProfile('p-free'))!, navigation);

    expect(navigation.navigateToChat).toHaveBeenCalledTimes(1);
    const params = navigation.navigateToChat.mock.calls[0][0];
    // participantIds = [impersonated persona, character entity]
    expect(params.participantIds).toContain('Free Char');
    const entity = await getEntityByCharacterProfileId('p-free');
    expect(entity?.id).toBe('Free Char');
  });

  it('resolves a ghost-id collision instead of throwing (ghost-id bug)', async () => {
    await makeProfile('p-ghost', 'Ghost Char');
    // Another profile's entity named 'Ghost Char' was soft-deleted → the id is
    // still reserved by the TEXT PRIMARY KEY.
    await createEntity({
      id: 'Ghost Char',
      character_profile_id: null,
      alias: 'Ghost Char',
      lifecycle_config: '{}',
      rag_reindex_required: 1,
    });
    await deleteEntity('Ghost Char');

    const navigation = {navigateToChat: jest.fn()};
    await expect(
      openCharacterChat((await getCharacterProfile('p-ghost'))!, navigation),
    ).resolves.toBeUndefined();

    // The on-the-fly entity landed on the resolved copy id and is LIVE.
    expect(navigation.navigateToChat).toHaveBeenCalledTimes(1);
    const params = navigation.navigateToChat.mock.calls[0][0];
    expect(params.participantIds).toContain('Ghost Char 2');
    const entity = await getEntityByCharacterProfileId('p-ghost');
    expect(entity?.id).toBe('Ghost Char 2');
    expect(entity?.deleted_at).toBeNull();
  });

  it('throws when the profile has no usable name (unchanged guard)', async () => {
    await makeProfile('p-noname', '   ');
    const navigation = {navigateToChat: jest.fn()};
    await expect(
      openCharacterChat((await getCharacterProfile('p-noname'))!, navigation),
    ).rejects.toThrow(/without a name/);
  });
});