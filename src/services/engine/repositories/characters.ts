/**
 * Characters — management-API-backed repository adapter (task 3-2 reads, task
 * 3-4 relink: profile + image writes).
 *
 * Read surface backed by `/api/character-profiles` (+ `/images`), with the
 * persona-owned exclusion (§9-A3) derived from `GET /api/entities`. Favorites
 * ride the profile row (`is_favorite`) with the dedicated
 * `PUT /api/character-profiles/:id/favorite` toggle.
 *
 * Write surface (task 3-4, owner ruling 1/3):
 *   - profile create → `POST /api/character-profiles` (the ENGINE mints the
 *     id — any client id is ignored; the returned profile carries the real id).
 *   - profile update → `PUT /api/character-profiles/:id`
 *   - profile delete → `DELETE /api/character-profiles/:id` (in-use guard kept
 *     client-side to mirror the SQLite error surface)
 *   - image create → `POST .../images` **multipart** (`FormData`, field `file`);
 *     the engine always stores `is_primary=false`, so a primary image issues a
 *     follow-up `PUT .../images/:image_id/set-primary`.
 *   - image update → `PUT .../images/:image_id` `{description, display_order}`
 *     (+ set-primary when the delta flips the primary flag).
 *   - image delete → `DELETE .../images/:image_id`.
 *
 * Derived reads (`getDistinctTags`, `getSiblingCharacterProfiles`,
 * `getChatPickerRows`) are computed client-side from the profile list.
 */

import type {
  CharacterImage,
  CharacterImageInfo,
  CharacterProfile,
  Entity,
} from '../../../database/models';
import { createDataURL, base64ToUint8Array } from '../../../database/base64';
import { engineApiClient } from '../EngineApiClient';
import { EngineApiError } from '../EngineApiClient';
import { mapCharacterImageInfo, mapCharacterProfile } from '../engineApiMappers';
import { getAllEntities } from './entities';

/** One selectable row of the "Start a new chat" picker. */
export type ChatPickerRow =
  | { kind: 'card'; profile: CharacterProfile }
  | { kind: 'entity'; entity: Entity; profile: CharacterProfile };

/**
 * Resolved display label of a picker row — the shared sort/search/render label.
 *
 *   card rows   → `profile.nickname || profile.name`
 *   entity rows → `entity.alias || profile.nickname || profile.name`
 */
export function resolveChatPickerRowLabel(row: ChatPickerRow): string {
  const nickname = row.profile.nickname ?? '';
  if (row.kind === 'card') {
    return nickname || row.profile.name;
  }
  return row.entity.alias || nickname || row.profile.name;
}

/** Profile ids referenced by any live user-type entity (persona-owned, §9-A3). */
async function personaOwnedProfileIds(): Promise<Set<string>> {
  const owned = new Set<string>();
  try {
    const entities = await engineApiClient.listEntities();
    for (const cfg of Object.values(entities)) {
      if ((cfg.entity_type ?? 'ai') === 'user' && cfg.character_profile_id) {
        owned.add(cfg.character_profile_id);
      }
    }
  } catch {
    // A failed entity read must not break the profile list; the filter simply
    // becomes a no-op (worst case: a persona card is shown).
  }
  return owned;
}

export async function getCharacterProfile(
  id: string,
  _includeDeleted = false,
): Promise<CharacterProfile | null> {
  try {
    const dto = await engineApiClient.getCharacterProfile(id);
    return mapCharacterProfile(dto);
  } catch (e) {
    if (e instanceof EngineApiError && e.isNotFound) return null;
    throw e;
  }
}

export async function getAllCharacterProfiles(
  _includeDeleted = false,
): Promise<CharacterProfile[]> {
  const [dtos, owned] = await Promise.all([
    engineApiClient.listCharacterProfiles(),
    personaOwnedProfileIds(),
  ]);
  return dtos
    .map(mapCharacterProfile)
    .filter(p => !owned.has(p.id))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function getUserCharacterProfiles(
  includeDeleted = false,
): Promise<CharacterProfile[]> {
  return getAllCharacterProfiles(includeDeleted);
}

export async function getAICharacterProfile(id: string): Promise<CharacterProfile | null> {
  const profile = await getCharacterProfile(id);
  if (!profile) return null;
  const owned = await personaOwnedProfileIds();
  return owned.has(id) ? null : profile;
}

/** Defensive parse of the `tags` JSON-string column. */
function parseTags(col: string | null | undefined): string[] {
  if (!col || col === '' || col === 'null') return [];
  try {
    const parsed = JSON.parse(col);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Strip a trailing copy-suffix (mirrors entities.stripCopySuffix, kept local). */
function stripCopySuffix(name: string): string {
  const trimmed = name.trim();
  const match = trimmed.match(/^(.*?)[\s-_]+(\d+)$/);
  return match ? match[1].trim() : trimmed;
}

export async function getDistinctTags(): Promise<string[]> {
  const profiles = await getAllCharacterProfiles();
  const unique = new Map<string, string>();
  for (const p of profiles) {
    for (const tag of parseTags(p.tags)) {
      const t = tag.trim();
      if (!t) continue;
      const key = t.toLowerCase();
      if (!unique.has(key)) unique.set(key, t);
    }
  }
  return [...unique.values()].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
}

export async function getSiblingCharacterProfiles(
  profileName: string,
): Promise<CharacterProfile[]> {
  const base = stripCopySuffix(profileName).toLowerCase();
  const all = await getAllCharacterProfiles();
  return all.filter(p => stripCopySuffix(p.name).toLowerCase() === base);
}

// ── Favorites ────────────────────────────────────────────────────────────

export async function isCharacterFavorite(profileId: string): Promise<boolean> {
  const profile = await getCharacterProfile(profileId);
  return profile?.is_favorite === 1;
}

export async function getFavoriteCharacterProfileIds(): Promise<string[]> {
  const profiles = await getAllCharacterProfiles();
  return profiles.filter(p => p.is_favorite === 1).map(p => p.id);
}

export async function addCharacterFavorite(profileId: string): Promise<void> {
  await engineApiClient.setCharacterProfileFavorite(profileId, true);
}

export async function removeCharacterFavorite(profileId: string): Promise<void> {
  await engineApiClient.setCharacterProfileFavorite(profileId, false);
}

export async function toggleCharacterFavorite(profileId: string): Promise<boolean> {
  const next = !(await isCharacterFavorite(profileId));
  await engineApiClient.setCharacterProfileFavorite(profileId, next);
  return next;
}

// ── Profile writes (task 3-4, owner ruling 1) ─────────────────────────────

/** Wire body for a profile write: the domain row minus client-side id/deleted_at. */
function toProfileWire(
  profile: Partial<CharacterProfile> & { name: string },
): Record<string, unknown> {
  const wire: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(profile)) {
    if (k === 'id' || k === 'deleted_at' || k === 'is_favorite') continue;
    if (k === 'created_at' || k === 'updated_at') continue;
    if (v === undefined) continue;
    // The engine serializes dates as RFC3339; the profile body has no dates.
    wire[k] = v;
  }
  return wire;
}

/**
 * Create a character profile. The ENGINE mints the id — any `id` on the input
 * is dropped. Returns the created profile (with the engine id) so callers can
 * reuse it for entity linkage + image uploads.
 */
export async function createCharacterProfile(
  profile: Omit<CharacterProfile, 'created_at' | 'updated_at' | 'deleted_at'>,
): Promise<CharacterProfile> {
  const dto = await engineApiClient.createCharacterProfile(
    toProfileWire(profile) as never,
  );
  return mapCharacterProfile(dto);
}

/** Update a character profile in place (id is preserved from the URL). */
export async function updateCharacterProfile(
  profile: CharacterProfile,
): Promise<CharacterProfile> {
  const dto = await engineApiClient.updateCharacterProfile(
    profile.id,
    toProfileWire(profile) as never,
  );
  return mapCharacterProfile(dto);
}

/** True when a live entity references the profile. */
export async function isCharacterProfileInUse(id: string): Promise<boolean> {
  const map = await engineApiClient.listEntities();
  return Object.values(map).some(cfg => cfg.character_profile_id === id);
}

/** Soft-delete a profile; throws when a live entity still references it. */
export async function deleteCharacterProfile(id: string): Promise<void> {
  if (await isCharacterProfileInUse(id)) {
    throw new Error(`Character profile ${id} is in use and cannot be soft deleted`);
  }
  await engineApiClient.deleteCharacterProfile(id);
}

/**
 * Delete a profile AND every entity linked to it (mirrors the SQLite cascade):
 * soft-delete each referencing entity first, then the now-unreferenced profile.
 */
export async function deleteCharacterProfileCascade(profileId: string): Promise<void> {
  const map = await engineApiClient.listEntities();
  const entityIds = Object.entries(map)
    .filter(([, cfg]) => cfg.character_profile_id === profileId)
    .map(([id]) => id);
  for (const entityId of entityIds) {
    await engineApiClient.deleteEntity(entityId);
  }
  await engineApiClient.deleteCharacterProfile(profileId);
}

// ── Images ───────────────────────────────────────────────────────────────

async function loadImageBytes(profileId: string, imageId: string): Promise<string> {
  try {
    return await engineApiClient.fetchCharacterImageBase64(profileId, imageId);
  } catch {
    // A missing blob must not fail the metadata list (empty data URL).
    return '';
  }
}

export async function getCharacterImages(
  profileId: string,
  _includeDeleted = false,
): Promise<CharacterImage[]> {
  const infos = await engineApiClient.listCharacterImages(profileId);
  const images: CharacterImage[] = [];
  for (const info of infos) {
    const data = await loadImageBytes(profileId, info.id);
    images.push(mapCharacterImageInfo(info, data));
  }
  return images;
}

export async function getCharacterImage(
  id: string,
  _includeDeleted = false,
): Promise<CharacterImage | null> {
  const profiles = await engineApiClient.listCharacterProfiles();
  for (const profile of profiles) {
    const infos = await engineApiClient.listCharacterImages(profile.id);
    const info = infos.find(i => i.id === id);
    if (info) {
      const data = await loadImageBytes(profile.id, info.id);
      return mapCharacterImageInfo(info, data);
    }
  }
  return null;
}

export async function getPrimaryImage(profileId: string): Promise<CharacterImage | null> {
  const infos = await engineApiClient.listCharacterImages(profileId);
  const primary = infos.find(i => i.is_primary);
  if (!primary) return null;
  const data = await loadImageBytes(profileId, primary.id);
  return mapCharacterImageInfo(primary, data);
}

/**
 * Upload a character image as multipart. Returns the new image id. When
 * `is_primary` is set, a follow-up set-primary call promotes it (the engine
 * always creates images non-primary).
 */
export async function createCharacterImage(
  image: Omit<CharacterImage, 'id' | 'created_at' | 'deleted_at'>,
): Promise<string> {
  const bytes = base64ToUint8Array(image.image_data);
  const res = await engineApiClient.uploadCharacterImage(image.character_profile_id, {
    bytes,
    mimeType: image.mime_type,
    description: image.description,
  });
  const id = res.id;
  if (image.is_primary && id) {
    await engineApiClient.setCharacterImagePrimary(image.character_profile_id, id);
  }
  return id;
}

/** Update image metadata; a primary flip issues the set-primary follow-up. */
export async function updateCharacterImage(
  image: Pick<CharacterImage, 'id' | 'description' | 'display_order' | 'is_primary'>,
  profileId?: string,
): Promise<void> {
  let pid = profileId;
  if (!pid) {
    // The engine route is nested; resolve the owning profile when not supplied.
    const profiles = await engineApiClient.listCharacterProfiles();
    for (const profile of profiles) {
      const infos = await engineApiClient.listCharacterImages(profile.id);
      if (infos.some(i => i.id === image.id)) {
        pid = profile.id;
        break;
      }
    }
  }
  if (!pid) throw new Error(`Character image not found: ${image.id}`);
  await engineApiClient.updateCharacterImageMetadata(pid, image.id, {
    description: image.description,
    display_order: image.display_order,
  });
  if (image.is_primary) {
    await engineApiClient.setCharacterImagePrimary(pid, image.id);
  }
}

export async function deleteCharacterImage(id: string, profileId?: string): Promise<void> {
  let pid = profileId;
  if (!pid) {
    const profiles = await engineApiClient.listCharacterProfiles();
    for (const profile of profiles) {
      const infos = await engineApiClient.listCharacterImages(profile.id);
      if (infos.some(i => i.id === id)) {
        pid = profile.id;
        break;
      }
    }
  }
  if (!pid) throw new Error(`Character image not found: ${id}`);
  await engineApiClient.deleteCharacterImage(pid, id);
}

export async function setPrimaryImage(profileId: string, imageId: string): Promise<void> {
  await engineApiClient.setCharacterImagePrimary(profileId, imageId);
}

/**
 * Images with data URLs — a client-side composition over the engine image read.
 */
export async function getCharacterImagesWithDataURLs(
  profileId: string,
  includeDeleted = false,
): Promise<CharacterImageInfo[]> {
  const images = await getCharacterImages(profileId, includeDeleted);
  return images.map(image => ({
    id: image.id,
    character_profile_id: image.character_profile_id,
    mime_type: image.mime_type,
    description: image.description,
    is_primary: image.is_primary,
    display_order: image.display_order,
    data_url: createDataURL(image.image_data, image.mime_type),
    created_at: image.created_at,
  }));
}

/** Convert a character image to a Base64 data URL for UI display. */
export function imageToDataURL(image: CharacterImage): string {
  return createDataURL(image.image_data, image.mime_type);
}

// ── Chat-picker aggregation (task 3-4, step 1c) ──────────────────────────
//
// The picker needs a cross-table join (profiles ⨯ entities ⨯ the persona's POV
// phone interactions) that the engine does not expose as one endpoint. It is
// composed client-side from three engine reads.

/** Resolved display label for a picker row. */
function pickerLabel(row: ChatPickerRow): string {
  return resolveChatPickerRowLabel(row);
}

export async function getChatPickerRows(
  impersonatedPersonaId: string,
): Promise<ChatPickerRow[]> {
  const [profiles, entities] = await Promise.all([
    getAllCharacterProfiles(),
    getAllEntities(),
  ]);

  const referencedProfileIds = new Set(
    entities
      .map(e => e.character_profile_id)
      .filter((id): id is string => !!id),
  );
  const profileById = new Map(profiles.map(p => [p.id, p]));

  const rows: ChatPickerRow[] = [];
  for (const profile of profiles) {
    if (!referencedProfileIds.has(profile.id)) {
      rows.push({ kind: 'card', profile });
    }
  }

  const hidden = new Set<string>();
  try {
    const res = await engineApiClient.entityInteractions(impersonatedPersonaId, {
      presence_type: 'phone',
    });
    for (const interaction of res.interactions) {
      try {
        const ids: unknown = JSON.parse(interaction.participant_ids ?? '[]');
        if (Array.isArray(ids)) {
          for (const id of ids) if (typeof id === 'string') hidden.add(id);
        }
      } catch {
        // Malformed participant_ids hides nothing (mirrors the SQLite fallback).
      }
    }
  } catch {
    // A failed POV read must not break the picker — treat as "nothing hidden".
  }

  for (const entity of entities) {
    if ((entity.entity_type ?? 'ai') !== 'ai') continue;
    const profileId = entity.character_profile_id;
    if (!profileId) continue;
    const profile = profileById.get(profileId);
    if (!profile) continue; // linked card not live
    if (hidden.has(entity.id)) continue;
    rows.push({ kind: 'entity', entity, profile });
  }

  return rows.sort((a, b) => {
    const la = pickerLabel(a).toLowerCase();
    const lb = pickerLabel(b).toLowerCase();
    return la < lb ? -1 : la > lb ? 1 : 0;
  });
}

/** True when the library has at least one picker-eligible card. */
export async function hasChatPickerLibrary(): Promise<boolean> {
  return (await getAllCharacterProfiles()).length > 0;
}

// ── Stats (task 3-4, engine follow-up) ───────────────────────────────────

/** Aggregated social stats for an AI character (mirrors the SQLite type). */
export interface CharacterStats {
  /** Total emoji reaction chips on messages sent by this character. */
  likes: number;
  /** Distinct users who have opened a chat with this character. */
  chats: number;
}

/**
 * Per-entity `{likes, chats}` from the engine's cross-entity aggregate
 * (`GET /api/stats/characters`).
 */
export async function getCharacterStats(entityId: string): Promise<CharacterStats> {
  const res = await engineApiClient.characterStats();
  const stat = res.stats?.[entityId];
  return { likes: stat?.likes ?? 0, chats: stat?.chats ?? 0 };
}
