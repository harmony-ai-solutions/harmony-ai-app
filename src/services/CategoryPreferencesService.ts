/**
 * Category Preferences Service
 *
 * Character categories are SYNCED DATA (engine plan step 5, "path b"):
 * `character_categories` + `character_category_members` ride the changeset sync,
 * so the phone and the desktop share ONE list. This service is the app-facing
 * facade the Characters screen and its modals talk to:
 *
 *  - READS come from the engine's local replica through the management API
 *    (`src/services/engine/repositories/characterCategories`) — there is no
 *    app-side SQL table any more, and tags are NO LONGER the membership source.
 *  - WRITES go through the engine management routes (create / rename / delete /
 *    reorder / members). A write is followed by a re-read of the list (the
 *    engine echoes the current row), and the screen refreshes on focus — the
 *    same re-read mechanism every other engine-authored change uses.
 *
 * ## Legacy migration (app upgrade, one-time)
 *
 * Before this service, category NAMES lived in AsyncStorage
 * (`@soulbits_character_categories`, an array of `{id, name}`) and membership
 * was DERIVED from each profile's `character_profiles.tags` JSON. Both sources
 * still exist on an upgraded phone, so {@link migrateLegacyCategories} folds
 * them into the synced tables once:
 *
 *  - every legacy name becomes a real category (matched case-insensitively
 *    against the engine's list first, so a category another device already
 *    created is reused, never duplicated);
 *  - each category's members are the profiles whose tags contain the name;
 *  - memberships are UNIONED with what the engine already holds — the engine's
 *    `POST /:id/members` replaces the complete set, so posting the tag-derived
 *    set alone could drop memberships learned from another device;
 *  - a `@soulbits_character_categories_migrated_v1` flag guards the run. It is
 *    only written on a fully clean pass: a partial failure retries on the next
 *    launch, and the whole routine is idempotent either way.
 *
 * Profile tags are left EXACTLY as they are — they keep their own meaning (the
 * library tag filter); they simply stop doubling as the category source.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createLogger } from '../utils/logger';
import {
  createCharacterCategory,
  deleteCharacterCategory,
  getAllCharacterProfiles,
  getCategoryIdsForProfile as getCategoryIdsForProfileFromRepo,
  getCharacterCategoryMemberMap as getCharacterCategoryMemberMapFromRepo,
  listCharacterCategories,
  renameCharacterCategory,
  reorderCharacterCategories,
  setCharacterCategoryMembers,
  setProfileCategoryMembership,
} from '../database/repositories';
import type { CharacterCategory, CharacterProfile } from '../database/models';

const log = createLogger('[CategoryPreferencesService]');

/** Legacy AsyncStorage key: the pre-step-5 category list (`{id, name}[]`). */
const LEGACY_CATEGORIES_KEY = '@soulbits_character_categories';

/** One-time guard for {@link migrateLegacyCategories} (`'1'` = done). */
const LEGACY_MIGRATION_FLAG = '@soulbits_character_categories_migrated_v1';

/** Outcome of a {@link migrateLegacyCategories} pass (log-friendly summary). */
export interface CategoryMigrationSummary {
  /** False when the guard flag already stopped the run (or nothing to do). */
  ran: boolean;
  /** Legacy names that had to be CREATED (already-existing ones are reused). */
  categoriesCreated: number;
  /** Membership rows added (union delta, so a re-run adds 0). */
  membershipsAdded: number;
  /** Legacy names that failed; > 0 means the run retries on the next launch. */
  failures: number;
}

// ── Reads (synced tables via the engine replica) ─────────────────────────

/** Every category in the user's drag order, with member counts + ids. */
async function getCategories(): Promise<CharacterCategory[]> {
  return listCharacterCategories();
}

/** The category ids a single profile belongs to (membership ROWS, not tags). */
async function getCategoryIdsForProfile(profileId: string): Promise<string[]> {
  return getCategoryIdsForProfileFromRepo(profileId);
}

/**
 * categoryId → member profile ids. Derived from the same single list read, so
 * the screen can build its filter sets without an extra request per category.
 */
async function getCategoryMemberships(): Promise<Map<string, Set<string>>> {
  return getCharacterCategoryMemberMapFromRepo();
}

// ── Writes (engine management routes) ────────────────────────────────────

/** Create a category. The engine trims/validates and 409s a live name clash. */
async function createCategory(name: string): Promise<CharacterCategory> {
  const category = await createCharacterCategory(name);
  log.info(`Created category ${category.id} → ${category.name}`);
  return category;
}

/** Rename a category in place (membership is id-keyed, so it is preserved). */
async function renameCategory(categoryId: string, name: string): Promise<void> {
  await renameCharacterCategory(categoryId, name);
  log.info(`Renamed category ${categoryId} → ${name}`);
}

/** Delete a category (soft-delete + memberships cleared; characters untouched). */
async function deleteCategory(categoryId: string): Promise<void> {
  await deleteCharacterCategory(categoryId);
  log.info(`Deleted category ${categoryId}`);
}

/** Persist a new chip order and return the re-ordered list. */
async function reorderCategories(
  orderedIds: string[],
): Promise<CharacterCategory[]> {
  return reorderCharacterCategories(orderedIds);
}

/** Add/remove ONE profile from ONE category (a membership ROW, never a tag). */
async function setProfileMembership(
  categoryId: string,
  profileId: string,
  member: boolean,
): Promise<void> {
  await setProfileCategoryMembership(categoryId, profileId, member);
}

/** Replace a category's complete membership (engine `profile_ids` semantics). */
async function setCategoryMembers(
  categoryId: string,
  profileIds: string[],
): Promise<CharacterCategory> {
  return setCharacterCategoryMembers(categoryId, profileIds);
}

// ── Legacy migration ─────────────────────────────────────────────────────

/** Defensive read of the legacy `{id, name}[]` payload (also accepts strings). */
function parseLegacyCategoryNames(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const names: string[] = [];
    for (const entry of parsed) {
      const name =
        typeof entry === 'string'
          ? entry
          : entry && typeof entry === 'object' && typeof (entry as { name?: unknown }).name === 'string'
            ? (entry as { name: string }).name
            : '';
      const trimmed = name.trim();
      if (trimmed) names.push(trimmed);
    }
    return names;
  } catch (error) {
    log.error('Failed to read the legacy category list:', error);
    return [];
  }
}

/** Defensive parse of a profile's `tags` JSON column. */
function tagsOf(profile: CharacterProfile): string[] {
  const raw = profile.tags;
  if (!raw || raw === 'null') return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((tag): tag is string => typeof tag === 'string')
      : [];
  } catch {
    return [];
  }
}

/**
 * One-time fold of the legacy AsyncStorage names + tag-derived membership into
 * the synced category tables. Idempotent and tolerant of partial failure: the
 * guard flag is only written after a fully clean pass, so a failed run retries
 * on the next launch and a re-run against already-migrated data adds nothing.
 */
async function migrateLegacyCategories(): Promise<CategoryMigrationSummary> {
  const summary: CategoryMigrationSummary = {
    ran: false,
    categoriesCreated: 0,
    membershipsAdded: 0,
    failures: 0,
  };

  let alreadyMigrated: string | null = null;
  let legacyRaw: string | null = null;
  try {
    [alreadyMigrated, legacyRaw] = await Promise.all([
      AsyncStorage.getItem(LEGACY_MIGRATION_FLAG),
      AsyncStorage.getItem(LEGACY_CATEGORIES_KEY),
    ]);
  } catch (error) {
    log.warn('Legacy category migration skipped (storage read failed):', error);
    summary.failures += 1;
    return summary;
  }
  if (alreadyMigrated === '1') return summary;

  const legacyNames = parseLegacyCategoryNames(legacyRaw);
  if (legacyNames.length === 0) {
    // Nothing to migrate — guard so the check costs nothing on later launches.
    await markMigrationComplete();
    log.info('Legacy category migration: nothing to migrate');
    return summary;
  }

  summary.ran = true;
  try {
    const [profiles, existing] = await Promise.all([
      getAllCharacterProfiles(),
      listCharacterCategories(),
    ]);
    // Case-insensitive name index — the legacy list keyed by name, and the
    // engine's UNIQUE index is physical (a tombstoned row can be revived).
    const byName = new Map<string, CharacterCategory>(
      existing.map(category => [category.name.trim().toLowerCase(), category]),
    );

    for (const name of legacyNames) {
      const key = name.trim().toLowerCase();
      try {
        let category = byName.get(key);
        if (!category) {
          category = await createCharacterCategory(name);
          byName.set(key, category);
          summary.categoriesCreated += 1;
        }

        const legacyMemberIds = profiles
          .filter(profile =>
            tagsOf(profile).some(tag => tag.trim().toLowerCase() === key),
          )
          .map(profile => profile.id);
        if (legacyMemberIds.length === 0) continue;

        // UNION (never replace): the engine may already know members from
        // another device, and a presence in the tag list may have been cleared
        // there deliberately.
        const current = new Set(category.profile_ids);
        const merged = [...current];
        let added = 0;
        for (const id of legacyMemberIds) {
          if (current.has(id)) continue;
          current.add(id);
          merged.push(id);
          added += 1;
        }
        if (added === 0) continue;

        category = await setCharacterCategoryMembers(category.id, merged);
        byName.set(key, category);
        summary.membershipsAdded += added;
      } catch (error) {
        summary.failures += 1;
        log.warn(`Legacy category migration failed for "${name}":`, error);
      }
    }

    if (summary.failures === 0) {
      await markMigrationComplete();
      log.info(
        `Legacy category migration complete: ${summary.categoriesCreated} created, ` +
          `${summary.membershipsAdded} membership(s) added across ${legacyNames.length} legacy name(s)`,
      );
    } else {
      log.warn(
        `Legacy category migration incomplete (${summary.failures} failure(s)) — retrying next launch`,
      );
    }
    return summary;
  } catch (error) {
    summary.failures += 1;
    log.error('Legacy category migration failed:', error);
    return summary;
  }
}

/** Write the guard flag; a failure only means one extra no-op pass later. */
async function markMigrationComplete(): Promise<void> {
  try {
    await AsyncStorage.setItem(LEGACY_MIGRATION_FLAG, '1');
  } catch (error) {
    log.warn('Failed to persist the legacy category migration flag:', error);
  }
}

export type { CharacterCategory };

export default {
  getCategories,
  getCategoryIdsForProfile,
  getCategoryMemberships,
  createCategory,
  renameCategory,
  deleteCategory,
  reorderCategories,
  setProfileMembership,
  setCategoryMembers,
  migrateLegacyCategories,
};
