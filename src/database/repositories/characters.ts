/**
 * Character Repository
 * 
 * Provides CRUD operations for character profiles and character images.
 * Includes BLOB handling for image data and Base64 conversion utilities.
 * Mirrors the Go implementation in harmony-link-private/database/repository/characters/
 */

import {getDatabase} from '../connection';
import {withTransaction} from '../transaction';
import {CharacterProfile, CharacterImage, CharacterImageInfo} from '../models';
import {uint8ArrayToBase64, createDataURL} from '../base64';
import {loadTextColumn} from '../sync';
import {generateId} from '../../utils/uuid';
import {stripCopySuffix} from './entities';

// ============================================================================
// Character Profile CRUD Operations
// ============================================================================

/**
 * Create a new character profile
 */
export async function createCharacterProfile(
  profile: Omit<CharacterProfile, 'created_at' | 'updated_at' | 'deleted_at'>
): Promise<CharacterProfile> {
  const db = getDatabase();
  
  return withTransaction(db, async (tx) => {
    const now = new Date().toISOString();
    
    await tx.executeSql(
      `INSERT INTO character_profiles (
        id, name, description, personality,
        voice_characteristics, base_prompt, scenario,
        typing_speed_wpm, audio_response_chance_percent, vision_config_id,
        lifecycle_config,
        first_mes, mes_example, alternate_greetings, post_history_instructions,
        creator_notes, creator, character_version, nickname,
        tags, group_only_greetings, extensions, assets,
        card_provenance, character_book,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        profile.id,
        profile.name,
        profile.description,
        profile.personality,
        profile.voice_characteristics,
        profile.base_prompt,
        profile.scenario,
        profile.typing_speed_wpm,
        profile.audio_response_chance_percent,
        profile.vision_config_id ?? null,
        profile.lifecycle_config ?? null,
        profile.first_mes ?? '',
        profile.mes_example ?? '',
        profile.alternate_greetings ?? '',
        profile.post_history_instructions ?? '',
        profile.creator_notes ?? '',
        profile.creator ?? '',
        profile.character_version ?? '',
        profile.nickname ?? '',
        profile.tags ?? '',
        profile.group_only_greetings ?? '',
        profile.extensions ?? '',
        profile.assets ?? '',
        profile.card_provenance ?? '',
        profile.character_book ?? '',
        now,
        now,
      ]
    );
    
    return {
      ...profile,
      created_at: new Date(now),
      updated_at: new Date(now),
      deleted_at: null,
    };
  });
}

/**
 * Get character profile by ID
 * Returns null if not found or soft deleted (unless includeDeleted is true)
 */
export async function getCharacterProfile(id: string, includeDeleted = false): Promise<CharacterProfile | null> {
  const db = getDatabase();
  
  const query = includeDeleted
    ? `SELECT id, name, description, personality,
              voice_characteristics, base_prompt, scenario,
              typing_speed_wpm, audio_response_chance_percent, vision_config_id,
              lifecycle_config,
              first_mes, mes_example, alternate_greetings, post_history_instructions,
              creator_notes, creator, character_version, nickname,
              tags, group_only_greetings, extensions, assets,
              card_provenance, character_book,
              created_at, updated_at, deleted_at
       FROM character_profiles
       WHERE id = ?`
    : `SELECT id, name, description, personality,
              voice_characteristics, base_prompt, scenario,
              typing_speed_wpm, audio_response_chance_percent, vision_config_id,
              lifecycle_config,
              first_mes, mes_example, alternate_greetings, post_history_instructions,
              creator_notes, creator, character_version, nickname,
              tags, group_only_greetings, extensions, assets,
              card_provenance, character_book,
              created_at, updated_at, deleted_at
       FROM character_profiles
       WHERE id = ? AND deleted_at IS NULL`;

  const [results] = await db.executeSql(query, [id]);
  
  if (results.rows.length === 0) {
    return null;
  }
  
  const row = results.rows.item(0);
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    personality: row.personality,
    voice_characteristics: row.voice_characteristics,
    base_prompt: row.base_prompt,
    scenario: row.scenario,
    typing_speed_wpm: row.typing_speed_wpm,
    audio_response_chance_percent: row.audio_response_chance_percent,
    vision_config_id: row.vision_config_id ?? null,
    lifecycle_config: row.lifecycle_config ?? null,
    first_mes: row.first_mes ?? '',
    mes_example: row.mes_example ?? '',
    alternate_greetings: row.alternate_greetings ?? '',
    post_history_instructions: row.post_history_instructions ?? '',
    creator_notes: row.creator_notes ?? '',
    creator: row.creator ?? '',
    character_version: row.character_version ?? '',
    nickname: row.nickname ?? '',
    tags: row.tags ?? '',
    group_only_greetings: row.group_only_greetings ?? '',
    extensions: row.extensions ?? '',
    assets: row.assets ?? '',
    card_provenance: row.card_provenance ?? '',
    character_book: row.character_book ?? '',
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at),
    deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
  };
}

/**
 * Get all distinct tags across the character library (4-3).
 *
 * v1 uses SQLite JSON1 (`json_each(tags)`) over the `tags` JSON column
 * (concept §4.2). If the query helper doesn't expose JSON1 cleanly (e.g. a
 * legacy SQLite build, or a malformed column), we fall back to computing the
 * distinct set client-side from the loaded profiles.
 *
 * Returns tags deduplicated case-insensitively and sorted case-insensitively,
 * so the filter chip row is stable and free of `"Fantasy"`/`"fantasy"` dupes.
 *
 * > P4+ option (concept §4.2): if list performance ever degrades, upgrade to a
 * > `character_tags(profile_id, tag)` join table and backfill from the JSON
 * > column — trivial, since all tags live in `character_profiles.tags`.
 */
export async function getDistinctTags(): Promise<string[]> {
  const db = getDatabase();

  const collect = (rows: { tag: string | null }[]): string[] => {
    const unique = new Map<string, string>();
    for (const row of rows) {
      const tag = (row.tag ?? '').trim();
      if (!tag) continue;
      const key = tag.toLowerCase();
      if (!unique.has(key)) unique.set(key, tag);
    }
    return [...unique.values()].sort((a, b) =>
      a.toLowerCase().localeCompare(b.toLowerCase()),
    );
  };

  try {
    const [results] = await db.executeSql(
      `SELECT DISTINCT json_each.value AS tag
       FROM character_profiles, json_each(character_profiles.tags)
       WHERE character_profiles.deleted_at IS NULL
         AND json_each.value IS NOT NULL
         AND json_each.value != ''
       ORDER BY tag COLLATE NOCASE`,
    );
    const rows: { tag: string | null }[] = [];
    for (let i = 0; i < results.rows.length; i++) {
      rows.push({ tag: results.rows.item(i).tag as string | null });
    }
    return collect(rows);
  } catch {
    // JSON1 unavailable or a malformed column — compute client-side from the
    // loaded profiles (defensive; the join table upgrade remains the P4+ path).
    const profiles = await getAllCharacterProfiles();
    const rows: { tag: string | null }[] = [];
    for (const p of profiles) {
      const parsed = parseTagsColumn(p.tags);
      for (const tag of parsed) rows.push({ tag });
    }
    return collect(rows);
  }
}

/** Defensive parse of the `tags` JSON-string column (engine may sync 'null'/''). */
function parseTagsColumn(col: string | null | undefined): string[] {
  if (!col || col === '' || col === 'null') return [];
  try {
    const parsed = JSON.parse(col);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string');
  } catch {
    return [];
  }
}

/**
 * Get all character profiles
 * Returns empty array if none found. Filters out soft deleted by default.
 */
export async function getAllCharacterProfiles(includeDeleted = false): Promise<CharacterProfile[]> {
  const db = getDatabase();
  
  const query = includeDeleted
    ? `SELECT id, name, description, personality,
              voice_characteristics, base_prompt, scenario,
              typing_speed_wpm, audio_response_chance_percent, vision_config_id,
              lifecycle_config,
              first_mes, mes_example, alternate_greetings, post_history_instructions,
              creator_notes, creator, character_version, nickname,
              tags, group_only_greetings, extensions, assets,
              card_provenance, character_book,
              created_at, updated_at, deleted_at
       FROM character_profiles
       ORDER BY name`
    : `SELECT id, name, description, personality,
              voice_characteristics, base_prompt, scenario,
              typing_speed_wpm, audio_response_chance_percent, vision_config_id,
              lifecycle_config,
              first_mes, mes_example, alternate_greetings, post_history_instructions,
              creator_notes, creator, character_version, nickname,
              tags, group_only_greetings, extensions, assets,
              card_provenance, character_book,
              created_at, updated_at, deleted_at
       FROM character_profiles
       WHERE deleted_at IS NULL
       ORDER BY name`;

  const [results] = await db.executeSql(query);

  const profiles: CharacterProfile[] = [];
  for (let i = 0; i < results.rows.length; i++) {
    const row = results.rows.item(i);
    profiles.push({
      id: row.id,
      name: row.name,
      description: row.description,
      personality: row.personality,
      voice_characteristics: row.voice_characteristics,
      base_prompt: row.base_prompt,
      scenario: row.scenario,
      typing_speed_wpm: row.typing_speed_wpm,
      audio_response_chance_percent: row.audio_response_chance_percent,
      vision_config_id: row.vision_config_id ?? null,
      lifecycle_config: row.lifecycle_config ?? null,
      first_mes: row.first_mes ?? '',
      mes_example: row.mes_example ?? '',
      alternate_greetings: row.alternate_greetings ?? '',
      post_history_instructions: row.post_history_instructions ?? '',
      creator_notes: row.creator_notes ?? '',
      creator: row.creator ?? '',
      character_version: row.character_version ?? '',
      nickname: row.nickname ?? '',
      tags: row.tags ?? '',
      group_only_greetings: row.group_only_greetings ?? '',
      extensions: row.extensions ?? '',
      assets: row.assets ?? '',
      card_provenance: row.card_provenance ?? '',
      character_book: row.character_book ?? '',
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
      deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
    });
  }

  return profiles;
}

/**
 * Get all character profiles whose source is 'user' (created by the app user
 * via Create AI / profile editing / character-card import). Used by the My
 * Profile "AI Characters" tab. Filters out soft-deleted by default — identical
 * semantics to getAllCharacterProfiles / getCommunityCharacterProfiles.
 */
export async function getUserCharacterProfiles(
  includeDeleted = false,
): Promise<CharacterProfile[]> {
  const db = getDatabase();
  const query = includeDeleted
    ? `SELECT cp.id, cp.name, cp.description, cp.personality, cp.appearance, cp.backstory,
              cp.voice_characteristics, cp.base_prompt, cp.scenario, cp.example_dialogues,
              cp.typing_speed_wpm, cp.audio_response_chance_percent, cp.vision_config_id,
              cp.lifecycle_config, cp.created_at, cp.updated_at, cp.deleted_at
       FROM character_profiles cp
       INNER JOIN character_profile_sources cps ON cps.profile_id = cp.id
       WHERE cps.source = 'user'
       ORDER BY cp.name`
    : `SELECT cp.id, cp.name, cp.description, cp.personality, cp.appearance, cp.backstory,
              cp.voice_characteristics, cp.base_prompt, cp.scenario, cp.example_dialogues,
              cp.typing_speed_wpm, cp.audio_response_chance_percent, cp.vision_config_id,
              cp.lifecycle_config, cp.created_at, cp.updated_at, cp.deleted_at
       FROM character_profiles cp
       INNER JOIN character_profile_sources cps ON cps.profile_id = cp.id
       WHERE cp.deleted_at IS NULL
         AND cps.source = 'user'
       ORDER BY cp.name`;

  const [results] = await db.executeSql(query);

  const profiles: CharacterProfile[] = [];
  for (let i = 0; i < results.rows.length; i++) {
    const row = results.rows.item(i);
    profiles.push({
      id: row.id,
      name: row.name,
      description: row.description,
      personality: row.personality,
      appearance: row.appearance,
      backstory: row.backstory,
      voice_characteristics: row.voice_characteristics,
      base_prompt: row.base_prompt,
      scenario: row.scenario,
      example_dialogues: row.example_dialogues,
      typing_speed_wpm: row.typing_speed_wpm,
      audio_response_chance_percent: row.audio_response_chance_percent,
      vision_config_id: row.vision_config_id ?? null,
      lifecycle_config: row.lifecycle_config ?? null,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
      deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
    });
  }

  return profiles;
}

/**
 * Update an existing character profile
 * Throws error if profile not found
 */
export async function updateCharacterProfile(profile: CharacterProfile): Promise<CharacterProfile> {
  const db = getDatabase();
  
  return withTransaction(db, async (tx) => {
    const now = new Date().toISOString();
    
    const [result] = await tx.executeSql(
      `UPDATE character_profiles
       SET name = ?, description = ?, personality = ?,
           voice_characteristics = ?, base_prompt = ?,
           scenario = ?,
           typing_speed_wpm = ?, audio_response_chance_percent = ?,
           vision_config_id = ?, lifecycle_config = ?,
           first_mes = ?, mes_example = ?, alternate_greetings = ?,
           post_history_instructions = ?, creator_notes = ?, creator = ?,
           character_version = ?, nickname = ?, tags = ?,
           group_only_greetings = ?, extensions = ?, assets = ?,
           card_provenance = ?, character_book = ?,
           updated_at = ?
       WHERE id = ?`,
      [
        profile.name,
        profile.description,
        profile.personality,
        profile.voice_characteristics,
        profile.base_prompt,
        profile.scenario,
        profile.typing_speed_wpm,
        profile.audio_response_chance_percent,
        profile.vision_config_id ?? null,
        profile.lifecycle_config ?? null,
        profile.first_mes ?? '',
        profile.mes_example ?? '',
        profile.alternate_greetings ?? '',
        profile.post_history_instructions ?? '',
        profile.creator_notes ?? '',
        profile.creator ?? '',
        profile.character_version ?? '',
        profile.nickname ?? '',
        profile.tags ?? '',
        profile.group_only_greetings ?? '',
        profile.extensions ?? '',
        profile.assets ?? '',
        profile.card_provenance ?? '',
        profile.character_book ?? '',
        now,
        profile.id,
      ]
    );
    
    if (result.rowsAffected === 0) {
      throw new Error(`Character profile not found: ${profile.id}`);
    }
    
    return {
      ...profile,
      updated_at: new Date(now),
    };
  });
}

/**
 * Check if a character profile is in use by any entities
 */
export async function isCharacterProfileInUse(id: string): Promise<boolean> {
  const db = getDatabase();
  
  const [results] = await db.executeSql(
    'SELECT COUNT(*) as count FROM entities WHERE character_profile_id = ? AND deleted_at IS NULL',
    [id]
  );
  
  const count = results.rows.item(0).count;
  return count > 0;
}

/**
 * Soft delete character profile
 * Throws error if profile not found
 */
export async function deleteCharacterProfile(id: string, permanent = false): Promise<void> {
  const db = getDatabase();
  
  if (!permanent && await isCharacterProfileInUse(id)) {
    throw new Error(`Character profile ${id} is in use and cannot be soft deleted`);
  }

  return withTransaction(db, async (tx) => {
    if (permanent) {
      const [result] = await tx.executeSql('DELETE FROM character_profiles WHERE id = ?', [id]);
      if (result.rowsAffected === 0) {
        throw new Error(`Character profile not found: ${id}`);
      }
    } else {
      const now = new Date().toISOString();
      const [result] = await tx.executeSql(
        'UPDATE character_profiles SET deleted_at = ?, updated_at = ? WHERE id = ?',
        [now, now, id]
      );
      if (result.rowsAffected === 0) {
        throw new Error(`Character profile not found: ${id}`);
      }
    }
  });
}

// ============================================================================
// Character Image CRUD Operations
// ============================================================================

/**
 * Create a new character image
 * Returns the ID of the created image
 */
export async function createCharacterImage(
  image: Omit<CharacterImage, 'id' | 'created_at' | 'deleted_at'>
): Promise<string> {
  const db = getDatabase();
  const id = generateId();
  
  return new Promise<string>((resolve, reject) => {
    db.transaction(
      (tx) => {
        tx.executeSql(
          `INSERT INTO character_image (
            id, character_profile_id, image_data, mime_type, description,
            is_primary, display_order, vl_model_interpretation, vl_model
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            image.character_profile_id,
            image.image_data,
            image.mime_type,
            image.description,
            image.is_primary ? 1 : 0,
            image.display_order,
            image.vl_model_interpretation,
            image.vl_model,
          ],
          () => {
            resolve(id);
          },
          (_, error) => {
            reject(error);
            return false;
          }
        );
      },
      (error) => reject(error)
    );
  });
}

/**
 * Get character image by ID
 * Returns null if not found or soft deleted (unless includeDeleted is true)
 */
export async function getCharacterImage(id: string, includeDeleted = false): Promise<CharacterImage | null> {
  const db = getDatabase();
  
  const query = includeDeleted
    ? `SELECT id, character_profile_id, image_data, mime_type, description,
              is_primary, display_order, vl_model_interpretation, vl_model,
              created_at, deleted_at
       FROM character_image
       WHERE id = ?`
    : `SELECT id, character_profile_id, image_data, mime_type, description,
              is_primary, display_order, vl_model_interpretation, vl_model,
              created_at, deleted_at
       FROM character_image
       WHERE id = ? AND deleted_at IS NULL`;

  const [results] = await db.executeSql(query, [id]);
  
  if (results.rows.length === 0) {
    return null;
  }
  
  const row = results.rows.item(0);
  
  // Load TEXT fields with chunking if needed
  const imageData = await loadTextColumn('character_image', id, 'image_data');
  
  return {
    id: row.id,
    character_profile_id: row.character_profile_id,
    image_data: imageData || '', // Base64 string
    mime_type: row.mime_type,
    description: row.description,
    is_primary: row.is_primary === 1,
    display_order: row.display_order,
    vl_model_interpretation: row.vl_model_interpretation,
    vl_model: row.vl_model,
    created_at: new Date(row.created_at),
    updated_at: new Date(row.created_at),
    deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
  };
}

/**
 * Get all images for a specific character profile. Filters out soft deleted by default.
 * Ordered by display_order ASC, then created_at DESC
 * 
 * Uses two-phase query to avoid CursorWindow overflow.
 */
export async function getCharacterImages(profileId: string, includeDeleted = false): Promise<CharacterImage[]> {
  const db = getDatabase();
  
  // Phase 1: Get metadata without large TEXT columns
  const metadataQuery = includeDeleted
    ? `SELECT id, character_profile_id, mime_type, description,
              is_primary, display_order, vl_model_interpretation, vl_model,
              created_at, deleted_at
       FROM character_image
       WHERE character_profile_id = ?
       ORDER BY display_order ASC, created_at DESC`
    : `SELECT id, character_profile_id, mime_type, description,
              is_primary, display_order, vl_model_interpretation, vl_model,
              created_at, deleted_at
       FROM character_image
       WHERE character_profile_id = ? AND deleted_at IS NULL
       ORDER BY display_order ASC, created_at DESC`;

  const [metadataResults] = await db.executeSql(metadataQuery, [profileId]);
  
  // Phase 2: Load each image's TEXT columns individually with chunking
  const images: CharacterImage[] = [];
  
  for (let i = 0; i < metadataResults.rows.length; i++) {
    const metadata = metadataResults.rows.item(i);
    
    // Load TEXT columns individually with chunking
    const imageData = await loadTextColumn('character_image', metadata.id, 'image_data');
    
    images.push({
      id: metadata.id,
      character_profile_id: metadata.character_profile_id,
      image_data: imageData || '', // Base64 string
      mime_type: metadata.mime_type,
      description: metadata.description,
      is_primary: metadata.is_primary === 1,
      display_order: metadata.display_order,
      vl_model_interpretation: metadata.vl_model_interpretation,
      vl_model: metadata.vl_model,
      created_at: new Date(metadata.created_at),
      updated_at: new Date(metadata.created_at),
      deleted_at: metadata.deleted_at ? new Date(metadata.deleted_at) : null,
    });
  }
  
  return images;
}

/**
 * Update character image metadata
 * Does not update image_data (immutable after creation)
 */
export async function updateCharacterImage(
  image: Pick<CharacterImage, 'id' | 'description' | 'display_order' | 'is_primary'>
): Promise<void> {
  const db = getDatabase();
  
  return withTransaction(db, async (tx) => {
    const [result] = await tx.executeSql(
      `UPDATE character_image
       SET description = ?, display_order = ?, is_primary = ?
       WHERE id = ?`,
      [image.description, image.display_order, image.is_primary ? 1 : 0, image.id]
    );
    
    if (result.rowsAffected === 0) {
      throw new Error(`Character image not found: ${image.id}`);
    }
  });
}

/**
 * Soft delete character image
 * Throws error if image not found
 */
export async function deleteCharacterImage(id: string, permanent = false): Promise<void> {
  const db = getDatabase();
  
  return withTransaction(db, async (tx) => {
    if (permanent) {
      const [result] = await tx.executeSql('DELETE FROM character_image WHERE id = ?', [id]);
      if (result.rowsAffected === 0) {
        throw new Error(`Character image not found: ${id}`);
      }
    } else {
      const now = new Date().toISOString();
      const [result] = await tx.executeSql(
        'UPDATE character_image SET deleted_at = ? WHERE id = ?',
        [now, id]
      );
      if (result.rowsAffected === 0) {
        throw new Error(`Character image not found: ${id}`);
      }
    }
  });
}

/**
 * Set a specific image as primary and unset any previous primary
 * Ensures only one image is primary per character profile
 */
export async function setPrimaryImage(profileId: string, imageId: string): Promise<void> {
  const db = getDatabase();
  
  return new Promise<void>((resolve, reject) => {
    db.transaction(
      (tx) => {
        // Unset current primary first
        tx.executeSql(
          `UPDATE character_image
           SET is_primary = 0
           WHERE character_profile_id = ? AND is_primary = 1`,
          [profileId],
          () => {
            // Success callback for first update, now set new primary
            tx.executeSql(
              `UPDATE character_image
               SET is_primary = 1
               WHERE id = ? AND character_profile_id = ?`,
              [imageId, profileId],
              (_, result) => {
                if (result.rowsAffected === 0) {
                  reject(new Error('Image not found or does not belong to character profile'));
                } else {
                  resolve();
                }
              },
              (_, error) => {
                reject(error);
                return false;
              }
            );
          },
          (_, error) => {
            reject(error);
            return false;
          }
        );
      },
      (error) => reject(error)
    );
  });
}

/**
 * Get the primary image for a character profile
 * Returns null if no primary image is set or if primary is soft deleted
 */
export async function getPrimaryImage(profileId: string): Promise<CharacterImage | null> {
  const db = getDatabase();
  
  // First, get just the metadata WITHOUT image_data to avoid CursorWindow issues
  // with large images (>2MB). The image_data is loaded separately via loadTextColumn.
  const [metaResults] = await db.executeSql(
    `SELECT id, character_profile_id, mime_type, description,
            is_primary, display_order, vl_model_interpretation, vl_model,
            created_at, deleted_at
     FROM character_image
     WHERE character_profile_id = ? AND is_primary = 1 AND deleted_at IS NULL
     LIMIT 1`,
    [profileId]
  );
  
  if (metaResults.rows.length === 0) {
    return null;
  }
  
  const row = metaResults.rows.item(0);
  
  // Load image_data separately using chunked loading to avoid CursorWindow limit
  const imageData = await loadTextColumn('character_image', row.id, 'image_data');
  
  return {
    id: row.id,
    character_profile_id: row.character_profile_id,
    image_data: imageData || '', // Base64 string
    mime_type: row.mime_type,
    description: row.description,
    is_primary: row.is_primary === 1,
    display_order: row.display_order,
    vl_model_interpretation: row.vl_model_interpretation,
    vl_model: row.vl_model,
    created_at: new Date(row.created_at),
    updated_at: new Date(row.created_at),
    deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Convert character image to Base64 data URL for UI display
 * Example: "data:image/png;base64,iVBORw0KGgo..."
 */
export function imageToDataURL(image: CharacterImage): string {
  return createDataURL(image.image_data, image.mime_type);
}

/**
 * Get character images with data URLs for UI convenience. Filters out soft deleted by default.
 */
export async function getCharacterImagesWithDataURLs(
  profileId: string,
  includeDeleted = false
): Promise<CharacterImageInfo[]> {
  const images = await getCharacterImages(profileId, includeDeleted);
  
  return images.map(image => ({
    id: image.id,
    character_profile_id: image.character_profile_id,
    mime_type: image.mime_type,
    description: image.description,
    is_primary: image.is_primary,
    display_order: image.display_order,
    data_url: imageToDataURL(image),
    created_at: image.created_at,
  }));
}

// ============================================================================
// Character Profile Source Tagging (client-only)
// ============================================================================
//
// The source sidecar records whether a profile was created by the app user
// ('user') or is a community/default character ('community'). Stored in a
// separate CLIENT-ONLY table that is never synced, so the engine schema
// (strict parity, docs/schema-parity.md) stays untouched. A profile with no
// sidecar row defaults to 'community'.

export type CharacterProfileSource = 'user' | 'community';

export const CHARACTER_PROFILE_SOURCE_USER = 'user' as const;
export const CHARACTER_PROFILE_SOURCE_COMMUNITY = 'community' as const;

/**
 * Mark a character profile as user-created (via the app's Create AI / edit flows).
 * Upserts the sidecar row. Never touches character_profiles itself.
 */
export async function setCharacterProfileSource(
  profileId: string,
  source: CharacterProfileSource,
): Promise<void> {
  const db = getDatabase();
  await db.executeSql(
    `INSERT INTO character_profile_sources (profile_id, source, created_at)
     VALUES (?, ?, ?)
     ON CONFLICT(profile_id) DO UPDATE SET source = excluded.source`,
    [profileId, source, new Date().toISOString()],
  );
}

/**
 * Get the source for a single profile. Returns 'community' when no sidecar
 * row exists (default).
 */
export async function getCharacterProfileSource(
  profileId: string,
): Promise<CharacterProfileSource> {
  const db = getDatabase();
  const [results] = await db.executeSql(
    'SELECT source FROM character_profile_sources WHERE profile_id = ?',
    [profileId],
  );
  if (results.rows.length === 0) {
    return CHARACTER_PROFILE_SOURCE_COMMUNITY;
  }
  const source = results.rows.item(0).source as CharacterProfileSource;
  return source === 'user' ? source : CHARACTER_PROFILE_SOURCE_COMMUNITY;
}

/**
 * Get all character profiles whose source is 'community' (imported cards,
 * synced from the engine, or legacy rows without a sidecar tag). Filters out
 * soft-deleted by default — identical semantics to getAllCharacterProfiles.
 */
export async function getCommunityCharacterProfiles(
  includeDeleted = false,
): Promise<CharacterProfile[]> {
  const db = getDatabase();
  const query = includeDeleted
    ? `SELECT cp.id, cp.name, cp.description, cp.personality, cp.appearance, cp.backstory,
              cp.voice_characteristics, cp.base_prompt, cp.scenario, cp.example_dialogues,
              cp.typing_speed_wpm, cp.audio_response_chance_percent, cp.vision_config_id,
              cp.lifecycle_config, cp.created_at, cp.updated_at, cp.deleted_at
       FROM character_profiles cp
       LEFT JOIN character_profile_sources cps ON cps.profile_id = cp.id
       WHERE cps.profile_id IS NULL OR cps.source = 'community'
       ORDER BY cp.name`
    : `SELECT cp.id, cp.name, cp.description, cp.personality, cp.appearance, cp.backstory,
              cp.voice_characteristics, cp.base_prompt, cp.scenario, cp.example_dialogues,
              cp.typing_speed_wpm, cp.audio_response_chance_percent, cp.vision_config_id,
              cp.lifecycle_config, cp.created_at, cp.updated_at, cp.deleted_at
       FROM character_profiles cp
       LEFT JOIN character_profile_sources cps ON cps.profile_id = cp.id
       WHERE cp.deleted_at IS NULL
         AND (cps.profile_id IS NULL OR cps.source = 'community')
       ORDER BY cp.name`;

  const [results] = await db.executeSql(query);

  const profiles: CharacterProfile[] = [];
  for (let i = 0; i < results.rows.length; i++) {
    const row = results.rows.item(i);
    profiles.push({
      id: row.id,
      name: row.name,
      description: row.description,
      personality: row.personality,
      appearance: row.appearance,
      backstory: row.backstory,
      voice_characteristics: row.voice_characteristics,
      base_prompt: row.base_prompt,
      scenario: row.scenario,
      example_dialogues: row.example_dialogues,
      typing_speed_wpm: row.typing_speed_wpm,
      audio_response_chance_percent: row.audio_response_chance_percent,
      vision_config_id: row.vision_config_id ?? null,
      lifecycle_config: row.lifecycle_config ?? null,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
      deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
    });
  }

  return profiles;
}

// ============================================================================
// Character Favorites + Categories (client-only)
// ============================================================================
//
// Both features are stored in CLIENT-ONLY sidecar tables (never synced to the
// engine — strict schema parity, see docs/schema-parity.md), mirroring the
// `character_profile_sources` and `personas` pattern. A profile with no rows
// is simply "not favorited / in no category".

export interface CharacterCategory {
  id: string;
  name: string;
  displayOrder: number;
}

/**
 * True when a character profile is favorited.
 */
export async function isCharacterFavorite(profileId: string): Promise<boolean> {
  const db = getDatabase();
  const [results] = await db.executeSql(
    'SELECT 1 FROM character_favorites WHERE profile_id = ?',
    [profileId],
  );
  return results.rows.length > 0;
}

/**
 * Favorite a character profile (idempotent).
 */
export async function addCharacterFavorite(profileId: string): Promise<void> {
  const db = getDatabase();
  await db.executeSql(
    `INSERT OR IGNORE INTO character_favorites (profile_id, favorited_at)
     VALUES (?, ?)`,
    [profileId, new Date().toISOString()],
  );
}

/**
 * Remove a character profile from favorites (idempotent).
 */
export async function removeCharacterFavorite(profileId: string): Promise<void> {
  const db = getDatabase();
  await db.executeSql(
    'DELETE FROM character_favorites WHERE profile_id = ?',
    [profileId],
  );
}

/**
 * Toggle favorite state and return the new state.
 */
export async function toggleCharacterFavorite(profileId: string): Promise<boolean> {
  const isFav = await isCharacterFavorite(profileId);
  if (isFav) {
    await removeCharacterFavorite(profileId);
    return false;
  }
  await addCharacterFavorite(profileId);
  return true;
}

/**
 * All favorite profile IDs, most-recently-favorited first.
 */
export async function getFavoriteCharacterProfileIds(): Promise<string[]> {
  const db = getDatabase();
  const [results] = await db.executeSql(
    'SELECT profile_id FROM character_favorites ORDER BY favorited_at DESC',
  );
  const ids: string[] = [];
  for (let i = 0; i < results.rows.length; i++) {
    ids.push(results.rows.item(i).profile_id);
  }
  return ids;
}

/**
 * All user-defined categories ordered by display_order then name.
 */
export async function getCharacterCategories(): Promise<CharacterCategory[]> {
  const db = getDatabase();
  const [results] = await db.executeSql(
    'SELECT id, name, display_order FROM character_categories ORDER BY display_order ASC, name ASC',
  );
  const categories: CharacterCategory[] = [];
  for (let i = 0; i < results.rows.length; i++) {
    const row = results.rows.item(i);
      categories.push({
        id: row.id,
        name: row.name,
        displayOrder: row.display_order,
      });
    }
    return categories;
  }

  // ============================================================================
  // AI Profile helpers (copies + stats)
  // ============================================================================

  /**
   * All character profiles that share the same copy base name as the given
   * profile — i.e. "the other copies of the same AI character". Includes the
   * profile itself (the screen filters it out). Groups "Max", "Max 2",
   * "Max 3" together via stripCopySuffix.
   */
  export async function getSiblingCharacterProfiles(
    profileName: string,
  ): Promise<CharacterProfile[]> {
    const base = stripCopySuffix(profileName).toLowerCase();
    const all = await getAllCharacterProfiles();
    return all.filter(
      p => stripCopySuffix(p.name).toLowerCase() === base,
    );
  }

  /** Aggregated social stats for an AI character. */
  export interface CharacterStats {
    /** Total emoji reactions received on messages sent by this character. */
    likes: number;
    /** Total distinct users who have opened a chat with this character. */
    chats: number;
  }

  /**
   * Compute "Likes" and "Chats" for an AI character entity.
   *
   *   - likes = sum of all reaction chips on messages SENT by this entity
   *   - chats = number of DISTINCT users who have opened a chat with this
   *     character — 1 per user, no matter how many chat sessions (interaction
   *     rows) that user started. The character always appears as a PARTICIPANT
   *     (participant_ids contains its entity id); it is never the interaction
   *     owner (entity_id is the user's impersonated identity). Because every
   *     chat open creates a fresh interaction row, counting rows would inflate
   *     the number when the same user chats again — instead we count distinct
   *     owners (entity_id).
   *
   *   Copies are independent: a duplicated character ("Max 2") is a new entity
   *   whose entity id appears in none of the original's interactions, so its
   *   chat count starts at 0.
   */
  export async function getCharacterStats(
    entityId: string,
  ): Promise<CharacterStats> {
    const db = getDatabase();

    // Count distinct users (interaction owners) this character participates
    // with. participant_ids is a JSON array — parse it and require an EXACT
    // element match so "Max" never counts chats that belong to "Max 2".
    const [interactionResults] = await db.executeSql(
      `SELECT entity_id, participant_ids FROM interactions
       WHERE presence_type = 'phone' AND deleted_at IS NULL`,
    );
    const chatUsers = new Set<string>();
    for (let i = 0; i < interactionResults.rows.length; i++) {
      const row = interactionResults.rows.item(i);
      const raw = row.participant_ids;
      try {
        const ids: unknown = JSON.parse(raw);
        if (Array.isArray(ids) && ids.includes(entityId)) {
          chatUsers.add(row.entity_id);
        }
      } catch {
        // Ignore malformed participant_ids
      }
    }

    const chats = chatUsers.size;

    const [msgResults] = await db.executeSql(
      `SELECT reactions_json FROM conversation_messages
       WHERE sender_entity_id = ? AND deleted_at IS NULL
         AND reactions_json IS NOT NULL AND reactions_json != ''`,
      [entityId],
    );
    let likes = 0;
    for (let i = 0; i < msgResults.rows.length; i++) {
      const raw = msgResults.rows.item(i).reactions_json;
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) likes += parsed.length;
      } catch {
        // Ignore malformed reactions_json
      }
    }

    return { likes, chats };
  }

/**
 * Create a new category. Returns the created category.
 */
export async function createCharacterCategory(name: string): Promise<CharacterCategory> {
  const db = getDatabase();
  const id = generateId();
  const now = new Date().toISOString();
  // Place new categories after existing ones.
  const [countResults] = await db.executeSql(
    'SELECT COUNT(*) as count FROM character_categories',
  );
  const displayOrder = countResults.rows.item(0).count;
  await db.executeSql(
    `INSERT INTO character_categories (id, name, display_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
    [id, name.trim(), displayOrder, now, now],
  );
  return { id, name: name.trim(), displayOrder };
}

/**
 * Rename a category.
 */
export async function renameCharacterCategory(
  categoryId: string,
  name: string,
): Promise<void> {
  const db = getDatabase();
  await db.executeSql(
    `UPDATE character_categories SET name = ?, updated_at = ? WHERE id = ?`,
    [name.trim(), new Date().toISOString(), categoryId],
  );
}

/**
 * Delete a category (and its member rows — FK ON DELETE CASCADE).
 */
export async function deleteCharacterCategory(categoryId: string): Promise<void> {
  const db = getDatabase();
  await db.executeSql('DELETE FROM character_categories WHERE id = ?', [categoryId]);
}

/**
 * Profile IDs that belong to a given category.
 */
export async function getCharacterCategoryMembers(
  categoryId: string,
): Promise<string[]> {
  const db = getDatabase();
  const [results] = await db.executeSql(
    'SELECT profile_id FROM character_category_members WHERE category_id = ? ORDER BY created_at DESC',
    [categoryId],
  );
  const ids: string[] = [];
  for (let i = 0; i < results.rows.length; i++) {
    ids.push(results.rows.item(i).profile_id);
  }
  return ids;
}

/**
 * Add a profile to a category (idempotent).
 */
export async function addCharacterToCategory(
  profileId: string,
  categoryId: string,
): Promise<void> {
  const db = getDatabase();
  await db.executeSql(
    `INSERT OR IGNORE INTO character_category_members (profile_id, category_id, created_at)
     VALUES (?, ?, ?)`,
    [profileId, categoryId, new Date().toISOString()],
  );
}

/**
 * Remove a profile from a category (idempotent).
 */
export async function removeCharacterFromCategory(
  profileId: string,
  categoryId: string,
): Promise<void> {
  const db = getDatabase();
  await db.executeSql(
    'DELETE FROM character_category_members WHERE profile_id = ? AND category_id = ?',
    [profileId, categoryId],
  );
}

/**
 * All categories a given profile belongs to.
 */
export async function getCharacterProfileCategories(
  profileId: string,
): Promise<CharacterCategory[]> {
  const db = getDatabase();
  const [results] = await db.executeSql(
    `SELECT c.id, c.name, c.display_order
     FROM character_categories c
     INNER JOIN character_category_members m ON m.category_id = c.id
     WHERE m.profile_id = ?
     ORDER BY c.display_order ASC, c.name ASC`,
    [profileId],
  );
  const categories: CharacterCategory[] = [];
  for (let i = 0; i < results.rows.length; i++) {
    const row = results.rows.item(i);
    categories.push({
      id: row.id,
      name: row.name,
      displayOrder: row.display_order,
    });
  }
  return categories;
}
