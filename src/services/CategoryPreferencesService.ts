/**
 * Category Preferences Service
 *
 * Manages the user's CUSTOM character-category list using AsyncStorage
 * (key `@harmony_character_categories` — an array of `{id, name}`).
 *
 * This replaced the client-only categories sidecar table (O6):
 * category MEMBERSHIP is no longer stored in the DB at all — a profile
 * "belongs" to a category when its native `character_profiles.tags` JSON
 * contains the category name (tags already sync to the engine). This module
 * only persists the user-defined category NAMES (for the manage modal + filter
 * chips); the Characters screen derives the filterable category list as the
 * union of this list and the distinct profile tags.
 *
 * Follows the ChatPreferencesService pattern: module-level key constant,
 * plain async functions, AsyncStorage-only persistence, default export.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createLogger } from '../utils/logger';
import { generateId } from '../utils/uuid';

const log = createLogger('[CategoryPreferencesService]');
const CATEGORIES_KEY = '@harmony_character_categories';

/** A user-defined character category (persisted in AsyncStorage). */
export interface CharacterCategory {
  id: string;
  name: string;
}

/**
 * All user-defined categories, in creation order.
 * Returns [] when nothing has been stored yet (or the stored value is
 * malformed — defensive).
 */
async function getCategories(): Promise<CharacterCategory[]> {
  try {
    const raw = await AsyncStorage.getItem(CATEGORIES_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (c): c is CharacterCategory =>
          !!c && typeof c === 'object' &&
          typeof (c as any).id === 'string' &&
          typeof (c as any).name === 'string',
      )
      .map(c => ({ id: c.id, name: c.name }));
  } catch (error) {
    log.error('Failed to read categories:', error);
    return [];
  }
}

/**
 * Create a new category and persist it. Returns the created category.
 * @param name The category name (trimmed); also the tag written onto profiles
 *             when characters are added to it.
 */
async function createCategory(name: string): Promise<CharacterCategory> {
  const category: CharacterCategory = { id: generateId(), name: name.trim() };
  const categories = await getCategories();
  await AsyncStorage.setItem(
    CATEGORIES_KEY,
    JSON.stringify([...categories, category]),
  );
  log.info(`Created category ${category.id} → ${category.name}`);
  return category;
}

/**
 * Rename a category (the AsyncStorage entry only — see the screen-level tag
 * rewrite that keeps profile membership coherent).
 */
async function renameCategory(categoryId: string, name: string): Promise<void> {
  const categories = await getCategories();
  const updated = categories.map(c =>
    c.id === categoryId ? { ...c, name: name.trim() } : c,
  );
  await AsyncStorage.setItem(CATEGORIES_KEY, JSON.stringify(updated));
  log.info(`Renamed category ${categoryId} → ${name.trim()}`);
}

/**
 * Delete a category from the persisted list (idempotent — unknown ids are a
 * no-op).
 */
async function deleteCategory(categoryId: string): Promise<void> {
  const categories = await getCategories();
  await AsyncStorage.setItem(
    CATEGORIES_KEY,
    JSON.stringify(categories.filter(c => c.id !== categoryId)),
  );
  log.info(`Deleted category ${categoryId}`);
}

export default {
  getCategories,
  createCategory,
  renameCategory,
  deleteCategory,
};