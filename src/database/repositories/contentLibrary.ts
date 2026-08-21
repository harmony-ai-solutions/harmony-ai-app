/**
 * Content Library Repository — client-only storage for collected marketplace
 * assets (backstories, descriptions, personalities, prompts, dialogues,
 * themes). Every entry is a "copy" delivered to the user's account; it
 * follows them across devices via the cloud library sync.
 */

import { getDatabase } from '../connection';
import { generateId } from '../../utils/uuid';
import { getCharacterProfile, updateCharacterProfile } from './characters';
import type { CharacterProfile } from '../models';
import type { MarketplaceItemType } from './marketplace';

export interface ContentEntry {
  id: string;
  itemType: MarketplaceItemType;
  title: string;
  body: string | null;
  payloadJson: unknown;
  imageData: string | null;
  imageMime: string | null;
  sourceListingId: string | null;
  createdAt: Date;
}

export interface NewContentEntry {
  itemType: MarketplaceItemType;
  title: string;
  body?: string | null;
  payloadJson?: unknown;
  imageData?: string | null;
  imageMime?: string | null;
  sourceListingId?: string | null;
}

/**
 * Add a content entry to the library. Generates the id; returns the entry.
 */
export async function addContentEntry(input: NewContentEntry): Promise<ContentEntry> {
  const db = getDatabase();
  const id = generateId();
  const now = new Date().toISOString();
  await db.executeSql(
    `INSERT INTO content_library
       (id, item_type, title, body, payload_json, image_data, image_mime,
        source_listing_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.itemType,
      input.title,
      input.body ?? null,
      input.payloadJson !== undefined ? JSON.stringify(input.payloadJson) : null,
      input.imageData ?? null,
      input.imageMime ?? null,
      input.sourceListingId ?? null,
      now,
    ],
  );
  return {
    id,
    itemType: input.itemType,
    title: input.title,
    body: input.body ?? null,
    payloadJson: input.payloadJson ?? null,
    imageData: input.imageData ?? null,
    imageMime: input.imageMime ?? null,
    sourceListingId: input.sourceListingId ?? null,
    createdAt: new Date(now),
  };
}

function rowToEntry(row: any): ContentEntry {
  return {
    id: row.id,
    itemType: row.item_type as MarketplaceItemType,
    title: row.title,
    body: row.body ?? null,
    payloadJson: (() => {
      try {
        return JSON.parse(row.payload_json || 'null');
      } catch {
        return null;
      }
    })(),
    imageData: row.image_data ?? null,
    imageMime: row.image_mime ?? null,
    sourceListingId: row.source_listing_id ?? null,
    createdAt: new Date(row.created_at),
  };
}

/**
 * All content entries, most-recent first. Optional type filter.
 */
export async function getContentEntries(opts?: {
  itemType?: MarketplaceItemType;
}): Promise<ContentEntry[]> {
  const db = getDatabase();
  const clauses: string[] = [];
  const params: string[] = [];
  if (opts?.itemType) {
    clauses.push('item_type = ?');
    params.push(opts.itemType);
  }
  const [results] = await db.executeSql(
    `SELECT * FROM content_library
     ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
     ORDER BY created_at DESC`,
    params,
  );
  const out: ContentEntry[] = [];
  for (let i = 0; i < results.rows.length; i++) {
    out.push(rowToEntry(results.rows.item(i)));
  }
  return out;
}

/**
 * Get a single content entry by id.
 */
export async function getContentEntry(id: string): Promise<ContentEntry | null> {
  const db = getDatabase();
  const [results] = await db.executeSql(
    'SELECT * FROM content_library WHERE id = ?',
    [id],
  );
  if (results.rows.length === 0) return null;
  return rowToEntry(results.rows.item(0));
}

/**
 * Delete a content entry from the local library (the account copy stays on
 * the cloud; this only removes the offline cache entry).
 */
export async function deleteContentEntry(id: string): Promise<void> {
  const db = getDatabase();
  await db.executeSql('DELETE FROM content_library WHERE id = ?', [id]);
}

/**
 * Apply a text-based content entry's fields onto an existing character
 * profile. Maps by item type:
 *   - backstory   → backstory
 *   - description → description
 *   - personality → personality
 *   - prompt      → base_prompt + scenario
 *   - dialogue    → example_dialogues
 *
 * Returns the updated profile.
 *
 * @throws when the entry has no usable text or the profile is missing.
 */
export async function applyTextToCharacter(
  contentEntryId: string,
  characterProfileId: string,
): Promise<CharacterProfile> {
  const entry = await getContentEntry(contentEntryId);
  if (!entry) {
    throw new Error('content_entry_not_found');
  }
  const profile = await getCharacterProfile(characterProfileId);
  if (!profile) {
    throw new Error('character_profile_not_found');
  }

  const patch: Partial<CharacterProfile> = {};
  switch (entry.itemType) {
    case 'backstory':
      patch.backstory = entry.body ?? null;
      break;
    case 'description':
      patch.description = entry.body ?? null;
      break;
    case 'personality':
      patch.personality = entry.body ?? null;
      break;
    case 'prompt': {
      const parsed = (entry.payloadJson ?? {}) as {
        base_prompt?: string;
        scenario?: string;
      };
      patch.base_prompt = entry.body ?? parsed.base_prompt ?? null;
      patch.scenario = parsed.scenario ?? null;
      break;
    }
    case 'dialogue':
      patch.example_dialogues = entry.body ?? null;
      break;
    default:
      throw new Error('not_a_text_asset');
  }

  const updated: CharacterProfile = { ...profile, ...patch };
  return updateCharacterProfile(updated);
}

export default {
  addContentEntry,
  getContentEntries,
  getContentEntry,
  deleteContentEntry,
  applyTextToCharacter,
};