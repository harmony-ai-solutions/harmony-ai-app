/**
 * User Entities Repository — the entities-backed identity layer (Q10, §9-A10).
 *
 * A "persona" is the identity the user chats AS. Since the `personas` table is
 * gone (Q10), a persona IS a `character_profiles` row linked from an
 * `entities` row with `entity_type = 'user'` (migration 000042). Identity lives
 * on the profile (name/description/personality); the avatar is a
 * `character_image` row (A5). Personas deliberately have NO AI module configs
 * and NO provider bindings — that is the domain of AI characters (the entities
 * the user chats WITH).
 *
 * The entity id is the persona id (alias = profile name; id is FROZEN after
 * create). The built-in `user` entity has NO linked profile until Phase 5's
 * engine seeder lands, so the persona switcher's default row shows the raw
 * `'user'` id until then (documented interim note).
 */

import { getDatabase } from '../connection';
import { createDataURL } from '../base64';
import { generateId } from '../../utils/uuid';
import { getEntity, createEntity, getNextEntityAliasCopy, deleteEntity } from './entities';
import {
  createCharacterProfile,
  updateCharacterProfile,
  createCharacterImage,
  getPrimaryImage,
  getCharacterProfile,
  deleteCharacterProfile,
  imageToDataURL,
} from './characters';

/** Display-ready persona. */
export interface Persona {
  id: string;
  name: string;
  description: string;
  personality: string;
  /** Base64 data URL of the avatar, or null */
  avatarUri: string | null;
  /** True when this persona is the globally selected "Chatting as" identity */
  isActive?: boolean;
}

/** Shape persisted per persona (profile + entity + avatar). Re-exported by the shim. */
export interface PersonaRecord {
  id: string;
  entity_id: string;
  profile_id: string | null;
  name: string;
  description: string;
  personality: string;
  avatar_image_data: string | null;
  avatar_mime_type: string | null;
  avatar_uri: string | null;
  entity_type: string;
  created_at: Date;
  updated_at: Date;
}

function mapEntityToPersona(
  entityId: string,
  profileName: string,
  description: string,
  personality: string,
  avatarUri: string | null,
): Persona {
  return {
    id: entityId,
    name: profileName,
    description: description ?? '',
    personality: personality ?? '',
    avatarUri,
  };
}

function makeDataUrl(image_data: string | null, mime_type: string | null): string | null {
  return image_data && mime_type ? createDataURL(image_data, mime_type) : null;
}

/**
 * All user entities (non-deleted) as Persona rows, ordered by name. Includes
 * the built-in `user` entity (which has no linked profile until Phase 5 — its
 * name falls back to the raw `'user'` id).
 */
export async function getUserEntities(): Promise<Persona[]> {
  const db = getDatabase();
  const [results] = await db.executeSql(
    `SELECT e.id AS entity_id, e.alias,
            cp.name AS profile_name, cp.description, cp.personality,
            cp.id AS profile_id
     FROM entities e
     LEFT JOIN character_profiles cp ON cp.id = e.character_profile_id
     WHERE e.entity_type = 'user' AND e.deleted_at IS NULL
     ORDER BY COALESCE(cp.name, e.alias, e.id)`,
  );

  const personas: Persona[] = [];
  for (let i = 0; i < results.rows.length; i++) {
    const row = results.rows.item(i);
    let avatarUri: string | null = null;
    if (row.profile_id) {
      const image = await getPrimaryImage(row.profile_id);
      if (image) avatarUri = imageToDataURL(image);
    }
    personas.push(
      mapEntityToPersona(
        row.entity_id,
        row.profile_name || row.alias || row.entity_id,
        row.description,
        row.personality,
        avatarUri,
      ),
    );
  }
  return personas;
}

/** Get a single user persona by entity id, or null (non-existent or AI entity). */
export async function getUserPersona(id: string): Promise<Persona | null> {
  const db = getDatabase();
  const [results] = await db.executeSql(
    `SELECT e.id AS entity_id, e.alias,
            cp.name AS profile_name, cp.description, cp.personality,
            cp.id AS profile_id
     FROM entities e
     LEFT JOIN character_profiles cp ON cp.id = e.character_profile_id
     WHERE e.id = ? AND e.entity_type = 'user' AND e.deleted_at IS NULL`,
    [id],
  );
  if (results.rows.length === 0) return null;
  const row = results.rows.item(0);
  let avatarUri: string | null = null;
  if (row.profile_id) {
    const image = await getPrimaryImage(row.profile_id);
    if (image) avatarUri = imageToDataURL(image);
  }
  return mapEntityToPersona(
    row.entity_id,
    row.profile_name || row.alias || row.entity_id,
    row.description,
    row.personality,
    avatarUri,
  );
}

/** Minimal V3 character_profiles row for a persona (identity fields only). */
function minimalProfileColumns() {
  return {
    voice_characteristics: '',
    base_prompt: '',
    scenario: '',
    typing_speed_wpm: 60,
    audio_response_chance_percent: 50,
    vision_config_id: null,
    lifecycle_config: '{}',
    first_mes: '',
    mes_example: '',
    alternate_greetings: '[]',
    post_history_instructions: '',
    creator_notes: '',
    creator: '',
    character_version: '',
    nickname: '',
    tags: '[]',
    group_only_greetings: '[]',
    extensions: '{}',
    assets: '[]',
    card_provenance: '{}',
    character_book: '{}',
  };
}

/** Avatar input for create/update. */
export interface UserPersonaAvatar {
  image_data: string; // base64 (no data: prefix)
  mime_type: string;
}

/**
 * Create a persona: minimal character_profiles row + primary avatar image row
 * (if any) + a `user` entity (id = name, unique-checked via
 * getNextEntityAliasCopy; alias = name, entity id FROZEN after create).
 *
 * The caller (screen) is responsible for the fire-and-forget `syncAndWait`
 * (PersonaEdit pattern) — this repo stays layering-clean.
 */
export async function createUserPersona(input: {
  name: string;
  description?: string;
  personality?: string;
  avatar?: UserPersonaAvatar | null;
}): Promise<Persona> {
  const name = input.name.trim();
  const description = input.description?.trim() ?? '';
  const personality = input.personality?.trim() ?? '';
  const profileId = generateId();

  // Unique-check the entity id (name convention): if the name is taken, use a
  // copy-suffixed id (same convention as AI entities). The alias MUST be unique
  // too (idx_entities_alias_unique is a partial UNIQUE index) — so when the id
  // is copy-suffixed, the alias matches the id, not the raw (duplicate) name.
  const existing = await getEntity(name);
  const entityId = existing ? await getNextEntityAliasCopy(name) : name;

  await createCharacterProfile({
    id: profileId,
    name,
    description,
    personality,
    ...minimalProfileColumns(),
  });

  await createEntity(
    {
      id: entityId,
      character_profile_id: profileId,
      alias: entityId,
      lifecycle_config: '{}',
      rag_reindex_required: 1,
    },
    { entity_type: 'user' },
  );

  if (input.avatar) {
    await createCharacterImage({
      character_profile_id: profileId,
      image_data: input.avatar.image_data,
      mime_type: input.avatar.mime_type,
      description: 'Persona avatar',
      is_primary: true,
      display_order: 0,
      vl_model_interpretation: '',
      vl_model: '',
      updated_at: new Date(),
    });
  }

  return {
    id: entityId,
    name,
    description,
    personality,
    avatarUri: makeDataUrl(input.avatar?.image_data ?? null, input.avatar?.mime_type ?? null),
  };
}

/**
 * Update a persona's profile fields (and optionally avatar).
 * Rename = profile name + entity alias sync; the entity id is FROZEN.
 * Avatars reconcile diff-based: a new/different primary image replaces the old
 * (which is soft-deleted); no avatar passed leaves images untouched.
 *
 * @param id persona entity id
 * @param fields name/description/personality/avatar
 */
export async function updateUserPersona(
  id: string,
  input: {
    name: string;
    description?: string;
    personality?: string;
    avatar?: UserPersonaAvatar | null;
  },
): Promise<void> {
  const entity = await getEntity(id);
  if (!entity || entity.entity_type !== 'user') {
    throw new Error(`User persona not found: ${id}`);
  }
  const profile = entity.character_profile_id
    ? await getCharacterProfile(entity.character_profile_id)
    : null;
  if (!profile) {
    throw new Error(`User persona ${id} has no linked profile`);
  }

  await updateCharacterProfile({
    ...profile,
    name: input.name.trim(),
    description: input.description?.trim() ?? profile.description,
    personality: input.personality?.trim() ?? profile.personality,
  });

  // Keep entity alias in sync with the renamed profile; id frozen.
  await getDatabase().executeSql(
    'UPDATE entities SET alias = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL',
    [input.name.trim(), new Date().toISOString(), id],
  );

  // Avatar reconcile (diff-based). If a primary exists and differs, soft-delete
  // it and create a fresh primary; if none exists, just create.
  if (input.avatar) {
    const existing = await getPrimaryImage(entity.character_profile_id!);
    if (!existing || existing.image_data !== input.avatar.image_data) {
      if (existing) {
        await createCharacterImage({
          character_profile_id: entity.character_profile_id!,
          image_data: input.avatar.image_data,
          mime_type: input.avatar.mime_type,
          description: 'Persona avatar',
          is_primary: true,
          display_order: 0,
          vl_model_interpretation: '',
          vl_model: '',
          updated_at: new Date(),
        });
        // Soft-delete the superseded primary.
        await getDatabase().executeSql(
          'UPDATE character_image SET deleted_at = ?, updated_at = ? WHERE id = ?',
          [new Date().toISOString(), new Date().toISOString(), existing.id],
        );
      } else {
        await createCharacterImage({
          character_profile_id: entity.character_profile_id!,
          image_data: input.avatar.image_data,
          mime_type: input.avatar.mime_type,
          description: 'Persona avatar',
          is_primary: true,
          display_order: 0,
          vl_model_interpretation: '',
          vl_model: '',
          updated_at: new Date(),
        });
      }
    }
  }
}

/**
 * Delete a persona: soft-delete the entity (cascades its child rows) and the
 * linked profile. `'user'` is protected (A1 — the built-in identity is
 * load-bearing and never deletable).
 */
export async function deleteUserPersona(id: string): Promise<void> {
  if (id === 'user') {
    throw new Error('Cannot delete the built-in "user" persona');
  }
  const entity = await getEntity(id);
  if (!entity) return; // already gone
  if (entity.entity_type !== 'user') {
    throw new Error(`Cannot delete non-user persona: ${id}`);
  }
  await deleteEntity(id);
  if (entity.character_profile_id) {
    await deleteCharacterProfile(entity.character_profile_id);
  }
}

/**
 * Resolve the persona the user should "chat as".
 *
 * The stored global impersonated preference is honored only when it points at
 * a valid (non-deleted) user entity; otherwise the built-in 'user' identity is
 * used. AI character entities are NEVER resolved here (A7) — they are chat
 * partners, not identities.
 *
 * @param storedId The stored global impersonated entity id (or null).
 * @returns The persona id to impersonate ('user' when no persona is set).
 */
export async function resolvePersonaId(storedId: string | null): Promise<string> {
  if (storedId) {
    const db = getDatabase();
    const [results] = await db.executeSql(
      `SELECT 1 FROM entities WHERE id = ? AND entity_type = 'user' AND deleted_at IS NULL`,
      [storedId],
    );
    if (results.rows.length > 0) return storedId;
  }
  return 'user';
}
