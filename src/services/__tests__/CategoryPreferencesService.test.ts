/**
 * CategoryPreferencesService tests (engine step 5, "path b").
 *
 * The service is now a facade over the SYNCED `character_categories` tables
 * (reads = the engine replica through the management API, writes = the engine
 * management routes) plus the ONE-TIME legacy fold of the pre-sync AsyncStorage
 * names + tag-derived membership. The repository module is mocked here; the
 * migration tests drive the real AsyncStorage jest mock so the guard flag's
 * persistence is exercised for real.
 */

jest.mock('../../database/repositories', () => ({
  getAllCharacterProfiles: jest.fn(),
  listCharacterCategories: jest.fn(),
  createCharacterCategory: jest.fn(),
  renameCharacterCategory: jest.fn(),
  deleteCharacterCategory: jest.fn(),
  reorderCharacterCategories: jest.fn(),
  setCharacterCategoryMembers: jest.fn(),
  setProfileCategoryMembership: jest.fn(),
  getCategoryIdsForProfile: jest.fn(),
  getCharacterCategoryMemberMap: jest.fn(),
}));

jest.mock('../../utils/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

import AsyncStorage from '@react-native-async-storage/async-storage';
import CategoryPreferencesService from '../CategoryPreferencesService';
import type { CharacterCategory, CharacterProfile } from '../../database/models';
import {
  createCharacterCategory,
  deleteCharacterCategory,
  getAllCharacterProfiles,
  getCategoryIdsForProfile,
  getCharacterCategoryMemberMap,
  listCharacterCategories,
  renameCharacterCategory,
  reorderCharacterCategories,
  setCharacterCategoryMembers,
  setProfileCategoryMembership,
} from '../../database/repositories';

const LEGACY_CATEGORIES_KEY = '@soulbits_character_categories';
const LEGACY_MIGRATION_FLAG = '@soulbits_character_categories_migrated_v1';

const mockList = listCharacterCategories as jest.Mock;
const mockCreate = createCharacterCategory as jest.Mock;
const mockRename = renameCharacterCategory as jest.Mock;
const mockDelete = deleteCharacterCategory as jest.Mock;
const mockReorder = reorderCharacterCategories as jest.Mock;
const mockSetMembers = setCharacterCategoryMembers as jest.Mock;
const mockSetMembership = setProfileCategoryMembership as jest.Mock;
const mockIdsForProfile = getCategoryIdsForProfile as jest.Mock;
const mockMemberMap = getCharacterCategoryMemberMap as jest.Mock;
const mockProfiles = getAllCharacterProfiles as jest.Mock;

/** One synced category row as the repository returns it. */
function category(over: Partial<CharacterCategory> = {}): CharacterCategory {
  return {
    id: 'cat-1',
    name: 'Heroes',
    sort_order: 0,
    created_at: new Date(0),
    updated_at: new Date(0),
    member_count: 0,
    profile_ids: [],
    ...over,
  };
}

/** A profile whose legacy category membership lives in its tags JSON. */
function profile(id: string, tags: string[]): CharacterProfile {
  return { id, tags: JSON.stringify(tags) } as CharacterProfile;
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  mockList.mockResolvedValue([]);
  mockCreate.mockImplementation(async (name: string) =>
    category({ id: `cat-${name.trim().toLowerCase()}`, name: name.trim() }),
  );
  mockSetMembers.mockImplementation(
    async (categoryId: string, profileIds: string[]) =>
      category({ id: categoryId, profile_ids: profileIds, member_count: profileIds.length }),
  );
  mockProfiles.mockResolvedValue([]);
});

describe('CategoryPreferencesService — synced-table reads', () => {
  it('getCategories returns the synced list (no AsyncStorage, no tags)', async () => {
    mockList.mockResolvedValue([category({ profile_ids: ['p1'], member_count: 1 })]);

    const categories = await CategoryPreferencesService.getCategories();
    expect(categories).toHaveLength(1);
    expect(categories[0].profile_ids).toEqual(['p1']);
    expect(mockList).toHaveBeenCalledTimes(1);
  });

  it('getCategoryIdsForProfile / getCategoryMemberships delegate to the repo', async () => {
    mockIdsForProfile.mockResolvedValue(['cat-1']);
    const map = new Map([['cat-1', new Set(['p1'])]]);
    mockMemberMap.mockResolvedValue(map);

    expect(await CategoryPreferencesService.getCategoryIdsForProfile('p1')).toEqual([
      'cat-1',
    ]);
    expect(await CategoryPreferencesService.getCategoryMemberships()).toBe(map);
  });
});

describe('CategoryPreferencesService — engine-route writes', () => {
  it('createCategory delegates with the raw name and returns the created row', async () => {
    const created = await CategoryPreferencesService.createCategory('  Heroes  ');

    expect(mockCreate).toHaveBeenCalledWith('  Heroes  ');
    expect(created.name).toBe('Heroes');
  });

  it('renameCategory / deleteCategory delegate by id', async () => {
    await CategoryPreferencesService.renameCategory('cat-1', 'Protagonists');
    await CategoryPreferencesService.deleteCategory('cat-1');

    expect(mockRename).toHaveBeenCalledWith('cat-1', 'Protagonists');
    expect(mockDelete).toHaveBeenCalledWith('cat-1');
  });

  it('reorderCategories returns the re-ordered list', async () => {
    mockReorder.mockResolvedValue([category({ id: 'cat-2' }), category({ id: 'cat-1' })]);

    const reordered = await CategoryPreferencesService.reorderCategories(['cat-2', 'cat-1']);
    expect(mockReorder).toHaveBeenCalledWith(['cat-2', 'cat-1']);
    expect(reordered.map(c => c.id)).toEqual(['cat-2', 'cat-1']);
  });

  it('setProfileMembership writes a junction row (never a profile tag)', async () => {
    await CategoryPreferencesService.setProfileMembership('cat-1', 'p1', true);
    await CategoryPreferencesService.setProfileMembership('cat-1', 'p1', false);

    expect(mockSetMembership).toHaveBeenNthCalledWith(1, 'cat-1', 'p1', true);
    expect(mockSetMembership).toHaveBeenNthCalledWith(2, 'cat-1', 'p1', false);
    // No profile write exists in this service at all any more — tags stay put.
    expect(mockProfiles).not.toHaveBeenCalled();
  });

  it('setCategoryMembers replaces the complete membership', async () => {
    const updated = await CategoryPreferencesService.setCategoryMembers('cat-1', ['p1', 'p2']);

    expect(mockSetMembers).toHaveBeenCalledWith('cat-1', ['p1', 'p2']);
    expect(updated.member_count).toBe(2);
  });
});

describe('CategoryPreferencesService — one-time legacy migration', () => {
  it('does nothing when the guard flag is already set', async () => {
    await AsyncStorage.setItem(LEGACY_MIGRATION_FLAG, '1');
    await AsyncStorage.setItem(LEGACY_CATEGORIES_KEY, JSON.stringify([{ id: 'x', name: 'Heroes' }]));

    const summary = await CategoryPreferencesService.migrateLegacyCategories();

    expect(summary).toEqual({
      ran: false,
      categoriesCreated: 0,
      membershipsAdded: 0,
      failures: 0,
    });
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockProfiles).not.toHaveBeenCalled();
  });

  it('marks the flag when there is no legacy list at all', async () => {
    const summary = await CategoryPreferencesService.migrateLegacyCategories();

    expect(summary.ran).toBe(false);
    expect(await AsyncStorage.getItem(LEGACY_MIGRATION_FLAG)).toBe('1');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('creates legacy categories and derives their members from profile tags', async () => {
    await AsyncStorage.setItem(
      LEGACY_CATEGORIES_KEY,
      JSON.stringify([
        { id: 'legacy-1', name: 'Heroes' },
        { id: 'legacy-2', name: 'Mages' },
      ]),
    );
    mockProfiles.mockResolvedValue([
      profile('p1', ['heroes']),
      profile('p2', ['Mages', 'rogue']),
      profile('p3', ['music']),
    ]);

    const summary = await CategoryPreferencesService.migrateLegacyCategories();

    expect(summary).toMatchObject({ ran: true, categoriesCreated: 2, membershipsAdded: 2, failures: 0 });
    expect(mockCreate).toHaveBeenCalledWith('Heroes');
    expect(mockCreate).toHaveBeenCalledWith('Mages');
    expect(mockSetMembers).toHaveBeenCalledWith('cat-heroes', ['p1']);
    expect(mockSetMembers).toHaveBeenCalledWith('cat-mages', ['p2']);
    expect(await AsyncStorage.getItem(LEGACY_MIGRATION_FLAG)).toBe('1');
  });

  it('reuses an existing engine category (case-insensitive) and unions memberships', async () => {
    await AsyncStorage.setItem(
      LEGACY_CATEGORIES_KEY,
      JSON.stringify([{ id: 'legacy-1', name: 'heroes' }]),
    );
    mockList.mockResolvedValue([
      category({ id: 'cat-1', name: 'Heroes', profile_ids: ['p9'], member_count: 1 }),
    ]);
    mockProfiles.mockResolvedValue([profile('p1', ['HEROES'])]);

    const summary = await CategoryPreferencesService.migrateLegacyCategories();

    expect(mockCreate).not.toHaveBeenCalled();
    expect(summary.categoriesCreated).toBe(0);
    // Union: the engine's p9 is kept, the tag-derived p1 is added.
    expect(mockSetMembers).toHaveBeenCalledWith('cat-1', ['p9', 'p1']);
    expect(summary.membershipsAdded).toBe(1);
  });

  it('leaves the flag unset after a partial failure so the next launch retries', async () => {
    await AsyncStorage.setItem(
      LEGACY_CATEGORIES_KEY,
      JSON.stringify([
        { id: 'legacy-1', name: 'Heroes' },
        { id: 'legacy-2', name: 'Broken' },
      ]),
    );
    mockCreate.mockImplementation(async (name: string) => {
      if (name === 'Broken') throw new Error('engine offline');
      return category({ id: `cat-${name.toLowerCase()}`, name });
    });
    mockProfiles.mockResolvedValue([profile('p1', ['heroes', 'Broken'])]);

    const first = await CategoryPreferencesService.migrateLegacyCategories();
    expect(first.failures).toBe(1);
    expect(await AsyncStorage.getItem(LEGACY_MIGRATION_FLAG)).toBeNull();
    const heroCreationsAfterFirst = mockCreate.mock.calls.filter(
      call => call[0] === 'Heroes',
    ).length;

    // Second launch: the engine is healthy again → the whole pass completes.
    mockCreate.mockImplementation(async (name: string) =>
      category({ id: `cat-${name.toLowerCase()}`, name }),
    );
    const second = await CategoryPreferencesService.migrateLegacyCategories();

    expect(second.failures).toBe(0);
    // "Heroes" succeeds again (the run is a fresh pass, not a resume)…
    expect(
      mockCreate.mock.calls.filter(call => call[0] === 'Heroes').length,
    ).toBe(heroCreationsAfterFirst + 1);
    expect(await AsyncStorage.getItem(LEGACY_MIGRATION_FLAG)).toBe('1');
  });

  it('is idempotent: a re-run against already-migrated data adds nothing', async () => {
    await AsyncStorage.setItem(
      LEGACY_CATEGORIES_KEY,
      JSON.stringify([{ id: 'legacy-1', name: 'Heroes' }]),
    );
    mockProfiles.mockResolvedValue([profile('p1', ['heroes'])]);
    await CategoryPreferencesService.migrateLegacyCategories(); // sets the flag

    // Simulate a cleared flag (e.g. an OS storage restore) — the data is the
    // guard of last resort: the name matches and the membership already exists.
    await AsyncStorage.removeItem(LEGACY_MIGRATION_FLAG);
    mockList.mockResolvedValue([
      category({ id: 'cat-heroes', name: 'Heroes', profile_ids: ['p1'], member_count: 1 }),
    ]);
    mockCreate.mockClear();
    mockSetMembers.mockClear();

    const summary = await CategoryPreferencesService.migrateLegacyCategories();

    expect(summary).toMatchObject({ ran: true, categoriesCreated: 0, membershipsAdded: 0 });
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockSetMembers).not.toHaveBeenCalled();
  });

  it('tolerates malformed legacy storage (defensive read) and still guards', async () => {
    await AsyncStorage.setItem(LEGACY_CATEGORIES_KEY, 'not-json{');

    const summary = await CategoryPreferencesService.migrateLegacyCategories();

    expect(summary.ran).toBe(false);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem(LEGACY_MIGRATION_FLAG)).toBe('1');
  });

  it('never runs when the storage read itself fails (retries next launch)', async () => {
    (AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(new Error('storage down'));

    const summary = await CategoryPreferencesService.migrateLegacyCategories();

    expect(summary.failures).toBe(1);
    expect(await AsyncStorage.getItem(LEGACY_MIGRATION_FLAG)).toBeNull();
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
