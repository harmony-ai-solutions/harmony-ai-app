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
import {blobToUint8Array, uint8ArrayToBase64} from '../blob';

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
        id, name, description, personality, appearance, backstory,
        voice_characteristics, base_prompt, scenario, example_dialogues,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        profile.id,
        profile.name,
        profile.description,
        profile.personality,
        profile.appearance,
        profile.backstory,
        profile.voice_characteristics,
        profile.base_prompt,
        profile.scenario,
        profile.example_dialogues,
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
    ? `SELECT id, name, description, personality, appearance, backstory,
              voice_characteristics, base_prompt, scenario, example_dialogues,
              created_at, updated_at, deleted_at
       FROM character_profiles
       WHERE id = ?`
    : `SELECT id, name, description, personality, appearance, backstory,
              voice_characteristics, base_prompt, scenario, example_dialogues,
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
    appearance: row.appearance,
    backstory: row.backstory,
    voice_characteristics: row.voice_characteristics,
    base_prompt: row.base_prompt,
    scenario: row.scenario,
    example_dialogues: row.example_dialogues,
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at),
    deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
  };
}

/**
 * Get all character profiles
 * Returns empty array if none found. Filters out soft deleted by default.
 */
export async function getAllCharacterProfiles(includeDeleted = false): Promise<CharacterProfile[]> {
  const db = getDatabase();
  
  const query = includeDeleted
    ? `SELECT id, name, description, personality, appearance, backstory,
              voice_characteristics, base_prompt, scenario, example_dialogues,
              created_at, updated_at, deleted_at
       FROM character_profiles
       ORDER BY name`
    : `SELECT id, name, description, personality, appearance, backstory,
              voice_characteristics, base_prompt, scenario, example_dialogues,
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
      appearance: row.appearance,
      backstory: row.backstory,
      voice_characteristics: row.voice_characteristics,
      base_prompt: row.base_prompt,
      scenario: row.scenario,
      example_dialogues: row.example_dialogues,
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
       SET name = ?, description = ?, personality = ?, appearance = ?,
           backstory = ?, voice_characteristics = ?, base_prompt = ?,
           scenario = ?, example_dialogues = ?, updated_at = ?
       WHERE id = ?`,
      [
        profile.name,
        profile.description,
        profile.personality,
        profile.appearance,
        profile.backstory,
        profile.voice_characteristics,
        profile.base_prompt,
        profile.scenario,
        profile.example_dialogues,
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
): Promise<number> {
  const db = getDatabase();
  
  return new Promise<number>((resolve, reject) => {
    db.transaction(
      (tx) => {
        tx.executeSql(
          `INSERT INTO character_image (
            character_profile_id, image_data, mime_type, description,
            is_primary, display_order, vl_model_interpretation, vl_model, vl_model_embedding
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            image.character_profile_id,
            image.image_data,
            image.mime_type,
            image.description,
            image.is_primary ? 1 : 0,
            image.display_order,
            image.vl_model_interpretation,
            image.vl_model,
            image.vl_model_embedding,
          ],
          (_, result) => {
            resolve(result.insertId!);
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
export async function getCharacterImage(id: number, includeDeleted = false): Promise<CharacterImage | null> {
  const db = getDatabase();
  
  const query = includeDeleted
    ? `SELECT id, character_profile_id, image_data, mime_type, description,
              is_primary, display_order, vl_model_interpretation, vl_model,
              vl_model_embedding, created_at, deleted_at
       FROM character_image
       WHERE id = ?`
    : `SELECT id, character_profile_id, image_data, mime_type, description,
              is_primary, display_order, vl_model_interpretation, vl_model,
              vl_model_embedding, created_at, deleted_at
       FROM character_image
       WHERE id = ? AND deleted_at IS NULL`;

  const [results] = await db.executeSql(query, [id]);
  
  if (results.rows.length === 0) {
    return null;
  }
  
  const row = results.rows.item(0);
  const imageData = blobToUint8Array(row.image_data);
  const embeddingData = row.vl_model_embedding ? blobToUint8Array(row.vl_model_embedding) : null;
  
  return {
    id: row.id,
    character_profile_id: row.character_profile_id,
    image_data: imageData || new Uint8Array(),
    mime_type: row.mime_type,
    description: row.description,
    is_primary: row.is_primary === 1,
    display_order: row.display_order,
    vl_model_interpretation: row.vl_model_interpretation,
    vl_model: row.vl_model,
    vl_model_embedding: embeddingData,
    created_at: new Date(row.created_at),
    deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
  };
}

/**
 * Get all images for a specific character profile. Filters out soft deleted by default.
 * Ordered by display_order ASC, then created_at DESC
 */
export async function getCharacterImages(profileId: string, includeDeleted = false): Promise<CharacterImage[]> {
  const db = getDatabase();
  
  const query = includeDeleted
    ? `SELECT id, character_profile_id, image_data, mime_type, description,
              is_primary, display_order, vl_model_interpretation, vl_model,
              vl_model_embedding, created_at, deleted_at
       FROM character_image
       WHERE character_profile_id = ?
       ORDER BY display_order ASC, created_at DESC`
    : `SELECT id, character_profile_id, image_data, mime_type, description,
              is_primary, display_order, vl_model_interpretation, vl_model,
              vl_model_embedding, created_at, deleted_at
       FROM character_image
       WHERE character_profile_id = ? AND deleted_at IS NULL
       ORDER BY display_order ASC, created_at DESC`;

  const [results] = await db.executeSql(query, [profileId]);
  
  const images: CharacterImage[] = [];
  for (let i = 0; i < results.rows.length; i++) {
    const row = results.rows.item(i);
    const imageData = blobToUint8Array(row.image_data);
    const embeddingData = row.vl_model_embedding ? blobToUint8Array(row.vl_model_embedding) : null;
    
    images.push({
      id: row.id,
      character_profile_id: row.character_profile_id,
      image_data: imageData || new Uint8Array(),
      mime_type: row.mime_type,
      description: row.description,
      is_primary: row.is_primary === 1,
      display_order: row.display_order,
      vl_model_interpretation: row.vl_model_interpretation,
      vl_model: row.vl_model,
      vl_model_embedding: embeddingData,
      created_at: new Date(row.created_at),
      deleted_at: row.deleted_at ? new Date(row.deleted_at) : null,
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
export async function deleteCharacterImage(id: number, permanent = false): Promise<void> {
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
export async function setPrimaryImage(profileId: string, imageId: number): Promise<void> {
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
  
  const [results] = await db.executeSql(
    `SELECT id, character_profile_id, image_data, mime_type, description,
            is_primary, display_order, vl_model_interpretation, vl_model,
            vl_model_embedding, created_at, deleted_at
     FROM character_image
     WHERE character_profile_id = ? AND is_primary = 1 AND deleted_at IS NULL
     LIMIT 1`,
    [profileId]
  );
  
  if (results.rows.length === 0) {
    return null;
  }
  
  const row = results.rows.item(0);
  const imageData = blobToUint8Array(row.image_data);
  const embeddingData = row.vl_model_embedding ? blobToUint8Array(row.vl_model_embedding) : null;
  
  return {
    id: row.id,
    character_profile_id: row.character_profile_id,
    image_data: imageData || new Uint8Array(),
    mime_type: row.mime_type,
    description: row.description,
    is_primary: row.is_primary === 1,
    display_order: row.display_order,
    vl_model_interpretation: row.vl_model_interpretation,
    vl_model: row.vl_model,
    vl_model_embedding: embeddingData,
    created_at: new Date(row.created_at),
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
  // Convert Uint8Array to base64
  const base64 = uint8ArrayToBase64(image.image_data);
  return `data:${image.mime_type};base64,${base64}`;
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
