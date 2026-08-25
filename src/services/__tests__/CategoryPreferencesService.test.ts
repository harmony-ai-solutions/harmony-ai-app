/**
 * CategoryPreferencesService tests.
 *
 * Follows the repo's AsyncStorage test convention (jest async-storage-mock):
 * an in-memory store is swapped in, so each test asserts against real
 * get/set round-trips through the mock.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import CategoryPreferencesService, {
  CharacterCategory,
} from '../CategoryPreferencesService';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('../../utils/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

jest.mock('../../utils/uuid', () => {
  let counter = 0;
  return {
    generateId: jest.fn(() => `cat-id-${++counter}`),
  };
});

const CATEGORIES_KEY = '@harmony_character_categories';

describe('CategoryPreferencesService', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('returns an empty list when nothing is stored', async () => {
    expect(await CategoryPreferencesService.getCategories()).toEqual([]);
  });

  it('createCategory trims the name and persists it', async () => {
    const cat = await CategoryPreferencesService.createCategory('  My Group  ');
    expect(cat.name).toBe('My Group');
    expect(cat.id).toBe('cat-id-1');

    const categories = await CategoryPreferencesService.getCategories();
    expect(categories).toEqual([{ id: 'cat-id-1', name: 'My Group' }]);
  });

  it('appends new categories in creation order', async () => {
    await CategoryPreferencesService.createCategory('First');
    await CategoryPreferencesService.createCategory('Second');

    const categories = await CategoryPreferencesService.getCategories();
    expect(categories.map(c => c.name)).toEqual(['First', 'Second']);
  });

  it('renameCategory updates the name in place', async () => {
    const cat = await CategoryPreferencesService.createCategory('Old');
    await CategoryPreferencesService.renameCategory(cat.id, 'New Name');

    const categories = await CategoryPreferencesService.getCategories();
    expect(categories).toEqual([{ id: cat.id, name: 'New Name' }]);
  });

  it('deleteCategory removes only the target category', async () => {
    const a = await CategoryPreferencesService.createCategory('Keep');
    const b = await CategoryPreferencesService.createCategory('Remove');

    await CategoryPreferencesService.deleteCategory(b.id);

    const categories = await CategoryPreferencesService.getCategories();
    expect(categories).toEqual([a]);
  });

  it('deleteCategory is idempotent for unknown ids', async () => {
    await CategoryPreferencesService.createCategory('Only');
    await CategoryPreferencesService.deleteCategory('does-not-exist');

    const categories = await CategoryPreferencesService.getCategories();
    expect(categories).toHaveLength(1);
  });

  it('tolerates malformed stored JSON (defensive read)', async () => {
    await AsyncStorage.setItem(CATEGORIES_KEY, 'not-json{');
    expect(await CategoryPreferencesService.getCategories()).toEqual([]);
  });

  it('filters out non-{id,name} entries from a malformed array', async () => {
    await AsyncStorage.setItem(
      CATEGORIES_KEY,
      JSON.stringify([
        { id: 'ok', name: 'Good' },
        { id: 42, name: 'Bad' },
        { id: 'no-name' },
        'string-entry',
      ]),
    );
    const categories: CharacterCategory[] =
      await CategoryPreferencesService.getCategories();
    expect(categories).toEqual([{ id: 'ok', name: 'Good' }]);
  });
});