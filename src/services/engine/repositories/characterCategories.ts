/**
 * Character categories — management-API-backed repository adapter (engine plan
 * step 5, "path b").
 *
 * Until step 5 the app owned category NAMES in AsyncStorage and derived
 * membership from each profile's `character_profiles.tags`. The engine now syncs
 * `character_categories` (id, name, sort_order, timestamps, soft-delete) and
 * `character_category_members` (category_id + profile_id) through the existing
 * changeset sync, so those tables are THE source of truth on the phone too.
 *
 * Read/write split (the app's standing rule — see `chatConversationSettings`):
 *  - READS come from the engine's local replica through the management API
 *    (`GET /api/character-categories`) — the app has no local SQL replica, and
 *    the engine applies incoming changesets to its own tables.
 *  - WRITES go through the engine management routes only. The app never writes
 *    engine tables directly.
 *
 * Interface notes:
 *  - The list carries the `member_count` / `profile_ids` projections, so the
 *    chip counts and the "Add to category" checkbox list need one request.
 *  - `setProfileCategoryMembership` is the single-checkbox path. The engine's
 *    `POST /:id/members` replaces the COMPLETE membership, so the addition is
 *    computed as current ∪ {profileId} from a fresh read — never as the screen's
 *    possibly stale set (that would silently drop members added elsewhere).
 *  - Deleting a category NEVER deletes characters; the engine soft-deletes the
 *    row and clears the junction.
 */

import type { CharacterCategory } from '../../../database/models';
import { EngineApiError, engineApiClient } from '../EngineApiClient';
import { mapCharacterCategory } from '../engineApiMappers';

// ── Reads ────────────────────────────────────────────────────────────────

/** Every live category, in the engine's drag order (sort_order). */
export async function listCharacterCategories(): Promise<CharacterCategory[]> {
  const dtos = await engineApiClient.listCharacterCategories();
  return dtos
    .map(mapCharacterCategory)
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
}

/** categoryId → the member profile ids as a Set (chip/card lookups). */
export async function getCharacterCategoryMemberMap(): Promise<
  Map<string, Set<string>>
> {
  const map = new Map<string, Set<string>>();
  for (const category of await listCharacterCategories()) {
    map.set(category.id, new Set(category.profile_ids));
  }
  return map;
}

/** The category ids a single profile belongs to (engine order). */
export async function getCategoryIdsForProfile(
  profileId: string,
): Promise<string[]> {
  return (await listCharacterCategories())
    .filter(category => category.profile_ids.includes(profileId))
    .map(category => category.id);
}

// ── Writes ───────────────────────────────────────────────────────────────

/** Create a category. Throws {@link EngineApiError} 409 on a live name clash. */
export async function createCharacterCategory(
  name: string,
): Promise<CharacterCategory> {
  return mapCharacterCategory(
    await engineApiClient.createCharacterCategory(name.trim()),
  );
}

/** Rename a category in place (membership is id-keyed, so it is preserved). */
export async function renameCharacterCategory(
  categoryId: string,
  name: string,
): Promise<CharacterCategory> {
  return mapCharacterCategory(
    await engineApiClient.renameCharacterCategory(categoryId, name.trim()),
  );
}

/** Soft-delete a category (idempotent-ish: the engine 404s an absent id). */
export async function deleteCharacterCategory(categoryId: string): Promise<void> {
  await engineApiClient.deleteCharacterCategory(categoryId);
}

/** Persist a new drag order; returns the re-ordered list. */
export async function reorderCharacterCategories(
  orderedIds: string[],
): Promise<CharacterCategory[]> {
  const dtos = await engineApiClient.reorderCharacterCategories(orderedIds);
  return dtos.map(mapCharacterCategory);
}

/**
 * Replace a category's COMPLETE membership. Used by the migration (which
 * unions the legacy tag-derived members with what the engine already holds) —
 * the single-checkbox path should call {@link setProfileCategoryMembership}.
 */
export async function setCharacterCategoryMembers(
  categoryId: string,
  profileIds: string[],
): Promise<CharacterCategory> {
  return mapCharacterCategory(
    await engineApiClient.setCharacterCategoryMembers(categoryId, profileIds),
  );
}

/**
 * Add or remove ONE profile from ONE category.
 *
 * Removal is a single idempotent DELETE. Addition reads the current membership
 * first and posts the union, so it can never overwrite a membership the engine
 * learned from another device.
 */
export async function setProfileCategoryMembership(
  categoryId: string,
  profileId: string,
  member: boolean,
): Promise<void> {
  if (!member) {
    await engineApiClient.removeCharacterCategoryMember(categoryId, profileId);
    return;
  }
  const categories = await listCharacterCategories();
  const category = categories.find(c => c.id === categoryId);
  if (!category) {
    throw new EngineApiError(
      'category not found',
      404,
      `/api/character-categories/${categoryId}/members`,
    );
  }
  if (category.profile_ids.includes(profileId)) return;
  await engineApiClient.setCharacterCategoryMembers(categoryId, [
    ...category.profile_ids,
    profileId,
  ]);
}

/**
 * True when the error is the engine's live-name-conflict (409) — the UI can say
 * "that name is already in use" instead of a generic failure.
 */
export function isCategoryNameTakenError(error: unknown): boolean {
  return error instanceof EngineApiError && error.status === 409;
}
