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

// ============================================================================
// Character Profile CRUD Operations
// ============================================================================

/**
 * Create a new character profile
 */
export async function createCharacterProfile(
  profile: Omit<CharacterProfile, 'created_at' | 'updated_at'>
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
    };
  });
}

/**
 * Get character profile by ID
 * Returns null if not found
 */
export async function getCharacterProfile(id: string): Promise<CharacterProfile | null> {
  const db = getDatabase();
  
  const [results] = await db.executeSql(
    `SELECT id, name, description, personality, appearance, backstory,
            voice_characteristics, base_prompt, scenario, example_dialogues,
            created_at, updated_at
     FROM character_profiles
     WHERE id = ?`,
    [id]
  );
  
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
  };
}

/**
 * Get all character profiles
 * Returns empty array if none found
 */
export async function getAllCharacterProfiles(): Promise<CharacterProfile[]> {
  const db = getDatabase();
  
  const [results] = await db.executeSql(
    `SELECT id, name, description, personality, appearance, backstory,
            voice_characteristics, base_prompt, scenario, example_dialogues,
            created_at, updated_at
     FROM character_profiles
     ORDER BY name`
  );
  
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
 * Delete character profile
 * Will fail if profile is referenced by any entities (FOREIGN KEY RESTRICT)
 * Throws error if profile not found or if it's in use
 */
export async function deleteCharacterProfile(id: string): Promise<void> {
  const db = getDatabase();
  
  return withTransaction(db, async (tx) => {
    const [result] = await tx.executeSql(
      'DELETE FROM character_profiles WHERE id = ?',
      [id]
    );
    
    if (result.rowsAffected === 0) {
      throw new Error(`Character profile not found: ${id}`);
    }
  });
}

/**
 * Check if a character profile is in use by any entities
 */
export async function isCharacterProfileInUse(id: string): Promise<boolean> {
  const db = getDatabase();
  
  const [results] = await db.executeSql(
    'SELECT COUNT(*) as count FROM entities WHERE character_profile_id = ?',
    [id]
  );
  
  const count = results.rows.item(0).count;
  return count > 0;
}

// ============================================================================
// Character Image CRUD Operations
// ============================================================================

/**
 * Create a new character image
 * Returns the ID of the created image
 */
export async function createCharacterImage(
  image: Omit<CharacterImage, 'id' | 'created_at'>
): Promise<number> {
  const db = getDatabase();
  
  return withTransaction(db, async (tx) => {
    const [result] = await tx.executeSql(
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
      ]
    );
    
    return result.insertId!;
  });
}

/**
 * Get character image by ID
 * Returns null if not found
 */
export async function getCharacterImage(id: number): Promise<CharacterImage | null> {
  const db = getDatabase();
  
  const [results] = await db.executeSql(
    `SELECT id, character_profile_id, image_data, mime_type, description,
            is_primary, display_order, vl_model_interpretation, vl_model,
            vl_model_embedding, created_at
     FROM character_image
     WHERE id = ?`,
    [id]
  );
  
  if (results.rows.length === 0) {
    return null;
  }
  
  const row = results.rows.item(0);
  return {
    id: row.id,
    character_profile_id: row.character_profile_id,
    image_data: new Uint8Array(row.image_data),
    mime_type: row.mime_type,
    description: row.description,
    is_primary: row.is_primary === 1,
    display_order: row.display_order,
    vl_model_interpretation: row.vl_model_interpretation,
    vl_model: row.vl_model,
    vl_model_embedding: row.vl_model_embedding ? new Uint8Array(row.vl_model_embedding) : null,
    created_at: new Date(row.created_at),
  };
}

/**
 * Get all images for a specific character profile
 * Ordered by display_order ASC, then created_at DESC
 */
export async function getCharacterImages(profileId: string): Promise<CharacterImage[]> {
  const db = getDatabase();
  
  const [results] = await db.executeSql(
    `SELECT id, character_profile_id, image_data, mime_type, description,
            is_primary, display_order, vl_model_interpretation, vl_model,
            vl_model_embedding, created_at
     FROM character_image
     WHERE character_profile_id = ?
     ORDER BY display_order ASC, created_at DESC`,
    [profileId]
  );
  
  const images: CharacterImage[] = [];
  for (let i = 0; i < results.rows.length; i++) {
    const row = results.rows.item(i);
    images.push({
      id: row.id,
      character_profile_id: row.character_profile_id,
      image_data: new Uint8Array(row.image_data),
      mime_type: row.mime_type,
      description: row.description,
      is_primary: row.is_primary === 1,
      display_order: row.display_order,
      vl_model_interpretation: row.vl_model_interpretation,
      vl_model: row.vl_model,
      vl_model_embedding: row.vl_model_embedding ? new Uint8Array(row.vl_model_embedding) : null,
      created_at: new Date(row.created_at),
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
 * Delete character image
 * Throws error if image not found
 */
export async function deleteCharacterImage(id: number): Promise<void> {
  const db = getDatabase();
  
  return withTransaction(db, async (tx) => {
    const [result] = await tx.executeSql(
      'DELETE FROM character_image WHERE id = ?',
      [id]
    );
    
    if (result.rowsAffected === 0) {
      throw new Error(`Character image not found: ${id}`);
    }
  });
}

/**
 * Set a specific image as primary and unset any previous primary
 * Ensures only one image is primary per character profile
 */
export async function setPrimaryImage(profileId: string, imageId: number): Promise<void> {
  const db = getDatabase();
  
  return withTransaction(db, async (tx) => {
    // Unset current primary
    await tx.executeSql(
      `UPDATE character_image
       SET is_primary = 0
       WHERE character_profile_id = ? AND is_primary = 1`,
      [profileId]
    );
    
    // Set new primary
    const [result] = await tx.executeSql(
      `UPDATE character_image
       SET is_primary = 1
       WHERE id = ? AND character_profile_id = ?`,
      [imageId, profileId]
    );
    
    if (result.rowsAffected === 0) {
      throw new Error('Image not found or does not belong to character profile');
    }
  });
}

/**
 * Get the primary image for a character profile
 * Returns null if no primary image is set
 */
export async function getPrimaryImage(profileId: string): Promise<CharacterImage | null> {
  const db = getDatabase();
  
  const [results] = await db.executeSql(
    `SELECT id, character_profile_id, image_data, mime_type, description,
            is_primary, display_order, vl_model_interpretation, vl_model,
            vl_model_embedding, created_at
     FROM character_image
     WHERE character_profile_id = ? AND is_primary = 1
     LIMIT 1`,
    [profileId]
  );
  
  if (results.rows.length === 0) {
    return null;
  }
  
  const row = results.rows.item(0);
  return {
    id: row.id,
    character_profile_id: row.character_profile_id,
    image_data: new Uint8Array(row.image_data),
    mime_type: row.mime_type,
    description: row.description,
    is_primary: row.is_primary === 1,
    display_order: row.display_order,
    vl_model_interpretation: row.vl_model_interpretation,
    vl_model: row.vl_model,
    vl_model_embedding: row.vl_model_embedding ? new Uint8Array(row.vl_model_embedding) : null,
    created_at: new Date(row.created_at),
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
 * Convert Uint8Array to Base64 string
 * React Native compatible implementation
 */
function uint8ArrayToBase64(bytes: Uint8Array): string {
  const base64Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = '';
  let i;
  
  for (i = 0; i < bytes.length; i += 3) {
    const byte1 = bytes[i];
    const byte2 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const byte3 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    
    const encoded1 = byte1 >> 2;
    const encoded2 = ((byte1 & 3) << 4) | (byte2 >> 4);
    const encoded3 = ((byte2 & 15) << 2) | (byte3 >> 6);
    const encoded4 = byte3 & 63;
    
    result += base64Chars[encoded1] + base64Chars[encoded2];
    result += i + 1 < bytes.length ? base64Chars[encoded3] : '=';
    result += i + 2 < bytes.length ? base64Chars[encoded4] : '=';
  }
  
  return result;
}

/**
 * Get character images with data URLs for UI convenience
 */
export async function getCharacterImagesWithDataURLs(
  profileId: string
): Promise<CharacterImageInfo[]> {
  const images = await getCharacterImages(profileId);
  
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
