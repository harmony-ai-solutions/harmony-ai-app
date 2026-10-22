/**
 * User entities (personas) — management-API-backed repository adapter (3-2
 * reads, 3-4 relink: persona writes via create-then-use-response).
 *
 * A persona IS a `character_profiles` row linked from an `entities` row with
 * `entity_type = 'user'`. Reads derive from `GET /api/entities`
 * (filter `entity_type = 'user'`) + the nested `character_profile`, with the
 * avatar from the profile's primary image.
 *
 * Writes (owner ruling 1): the ENGINE mints both the profile id
 * (`POST /api/character-profiles`) and the entity id (`POST /api/entities`), so
 * create is create-then-use-response. `createUserPersonaFromCard` rides the
 * engine's full-card `POST /api/character-profiles/:id/duplicate`.
 */

import type { CharacterProfile } from '../../../database/models';
import { createDataURL } from '../../../database/base64';
import { engineApiClient } from '../EngineApiClient';
import { EngineApiError } from '../EngineApiClient';
import type { EntityConfigDto } from '../EngineApiClient';
import {
  createCharacterImage,
  getPrimaryImage,
  imageToDataURL,
} from './characters';
import {
  createEntity,
  getEntity,
  isProfilePersonaOwned,
} from './entities';
import { mapCharacterProfile } from '../engineApiMappers';

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

/** Minimal V3 character_profiles defaults for a persona (identity fields only). */
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

type PersonaProfileFieldKeys =
  | 'voice_characteristics'
  | 'base_prompt'
  | 'scenario'
  | 'typing_speed_wpm'
  | 'audio_response_chance_percent'
  | 'vision_config_id'
  | 'lifecycle_config'
  | 'first_mes'
  | 'mes_example'
  | 'alternate_greetings'
  | 'post_history_instructions'
  | 'creator_notes'
  | 'creator'
  | 'character_version'
  | 'nickname'
  | 'tags'
  | 'group_only_greetings'
  | 'extensions'
  | 'assets'
  | 'card_provenance'
  | 'character_book';

/** Optional subset of the profile row accepted by persona create/update. */
export type UserPersonaProfileFields = Pick<Partial<CharacterProfile>, PersonaProfileFieldKeys>;

const FULL_PROFILE_KEYS: PersonaProfileFieldKeys[] = [
  'voice_characteristics',
  'base_prompt',
  'scenario',
  'typing_speed_wpm',
  'audio_response_chance_percent',
  'vision_config_id',
  'lifecycle_config',
  'first_mes',
  'mes_example',
  'alternate_greetings',
  'post_history_instructions',
  'creator_notes',
  'creator',
  'character_version',
  'nickname',
  'tags',
  'group_only_greetings',
  'extensions',
  'assets',
  'card_provenance',
  'character_book',
];

function pickProfileFields(input: UserPersonaProfileFields): Partial<CharacterProfile> {
  const picked: Partial<CharacterProfile> = {};
  for (const key of FULL_PROFILE_KEYS) {
    if (input[key] !== undefined) {
      (picked as Record<string, unknown>)[key] = input[key];
    }
  }
  return picked;
}

/** Avatar input for create/update. */
export interface UserPersonaAvatar {
  image_data: string; // base64 (no data: prefix)
  mime_type: string;
}

/** Input for {@link createUserPersona}. */
export interface CreateUserPersonaInput extends UserPersonaProfileFields {
  name: string;
  description?: string;
  personality?: string;
  avatar?: UserPersonaAvatar | null;
}

/** Input for {@link updateUserPersona}. */
export interface UpdateUserPersonaInput extends UserPersonaProfileFields {
  name: string;
  description?: string;
  personality?: string;
  avatar?: UserPersonaAvatar | null;
}

/** Typed error for a persona EDIT whose alias collides with another live one. */
export class PersonaAliasConflictError extends Error {
  constructor(name: string) {
    super(`A persona named "${name}" already exists — choose a different name`);
    this.name = 'PersonaAliasConflictError';
  }
}

async function toPersona(entityId: string, cfg: EntityConfigDto): Promise<Persona> {
  const profile = cfg.character_profile;
  let avatarUri: string | null = null;
  if (profile?.id) {
    const image = await getPrimaryImage(profile.id);
    if (image?.image_data && image.mime_type) {
      avatarUri = createDataURL(image.image_data, image.mime_type);
    }
  }
  return {
    id: entityId,
    name: profile?.name || cfg.alias || entityId,
    description: profile?.description ?? '',
    personality: profile?.personality ?? '',
    avatarUri,
  };
}

/** All user entities (non-deleted) as Persona rows, ordered by name. */
export async function getUserEntities(): Promise<Persona[]> {
  const map = await engineApiClient.listEntities();
  const rows = Object.entries(map).filter(
    ([, cfg]) => (cfg.entity_type ?? 'ai') === 'user',
  );
  const personas = await Promise.all(rows.map(([id, cfg]) => toPersona(id, cfg)));
  return personas.sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
}

/** A single user persona by entity id, or null (missing or AI entity). */
export async function getUserPersona(id: string): Promise<Persona | null> {
  try {
    const cfg = await engineApiClient.getEntityConfig(id);
    if ((cfg.entity_type ?? 'ai') !== 'user') return null;
    return await toPersona(id, cfg);
  } catch (e) {
    if (e instanceof EngineApiError && e.isNotFound) return null;
    throw e;
  }
}

// ── Persona writes (task 3-4, owner ruling 1) ─────────────────────────────

/** Build a full profile create body from minimal defaults + provided fields. */
function buildProfileBody(
  name: string,
  description: string,
  personality: string,
  fields: Partial<CharacterProfile>,
): Record<string, unknown> {
  return {
    ...minimalProfileColumns(),
    name,
    description,
    personality,
    ...pickProfileFields(fields),
  };
}

/**
 * Create a persona: a profile (engine-minted id) + primary avatar + a `user`
 * entity (engine-minted id). Returns the new Persona.
 */
export async function createUserPersona(input: CreateUserPersonaInput): Promise<Persona> {
  const name = input.name.trim();
  const description = input.description?.trim() ?? '';
  const personality = input.personality?.trim() ?? '';

  const created = mapCharacterProfile(
    await engineApiClient.createCharacterProfile(
      buildProfileBody(name, description, personality, input) as never,
    ),
  );

  const entity = await createEntity(
    { name, character_profile_id: created.id },
    { entity_type: 'user' },
  );

  if (input.avatar) {
    await createCharacterImage({
      character_profile_id: created.id,
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
    id: entity.id,
    name,
    description,
    personality,
    avatarUri: input.avatar
      ? createDataURL(input.avatar.image_data, input.avatar.mime_type)
      : null,
  };
}

/** Update a persona's profile fields (+ optional avatar); id is frozen. */
export async function updateUserPersona(
  id: string,
  input: UpdateUserPersonaInput,
): Promise<void> {
  const entity = await getEntity(id);
  if (!entity || entity.entity_type !== 'user') {
    throw new Error(`User persona not found: ${id}`);
  }
  if (!entity.character_profile_id) {
    throw new Error(`User persona ${id} has no linked profile`);
  }

  const current = await engineApiClient.getCharacterProfile(entity.character_profile_id);
  const fields = pickProfileFields(input);
  await engineApiClient.updateCharacterProfile(entity.character_profile_id, {
    ...current,
    name: input.name.trim(),
    description: input.description?.trim() ?? current.description,
    personality: input.personality?.trim() ?? current.personality,
    ...fields,
  } as never);

  // Rename the entity alias too (id frozen). A live-alias collision is a 400.
  try {
    await engineApiClient.updateEntity(id, { alias: input.name.trim() });
  } catch (err) {
    if (err instanceof EngineApiError && err.status === 400) {
      throw new PersonaAliasConflictError(input.name.trim());
    }
    throw err;
  }

  if (input.avatar) {
    const existing = await getPrimaryImage(entity.character_profile_id);
    if (!existing || existing.image_data !== input.avatar.image_data) {
      if (existing) {
        await engineApiClient.deleteCharacterImage(entity.character_profile_id, existing.id);
      }
      await createCharacterImage({
        character_profile_id: entity.character_profile_id,
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

/**
 * Create a persona by full-copying an existing character card — the engine's
 * `POST /api/character-profiles/:id/duplicate` (resets is_favorite +
 * lifecycle_config, copies images with primary flags) + a fresh `user` entity.
 */
export async function createUserPersonaFromCard(
  sourceProfileId: string,
  options: { name?: string } = {},
): Promise<Persona> {
  if (await isProfilePersonaOwned(sourceProfileId)) {
    throw new Error(
      `character profile is owned by a persona — cannot create a persona from a persona-owned card`,
    );
  }

  const created = mapCharacterProfile(
    await engineApiClient.duplicateCharacterProfile(sourceProfileId, options.name),
  );

  const entity = await createEntity(
    { name: created.name, character_profile_id: created.id },
    { entity_type: 'user' },
  );

  const primary = await getPrimaryImage(created.id);
  return {
    id: entity.id,
    name: created.name,
    description: created.description ?? '',
    personality: created.personality ?? '',
    avatarUri: primary ? imageToDataURL(primary) : null,
  };
}

/** Delete a persona: the engine cascade tombstones the entity + profile. */
export async function deleteUserPersona(id: string): Promise<void> {
  if (id === 'user') {
    throw new Error('Cannot delete the built-in "user" persona');
  }
  const entity = await getEntity(id);
  if (!entity) return; // already gone
  if (entity.entity_type !== 'user') {
    throw new Error(`Cannot delete non-user persona: ${id}`);
  }
  await engineApiClient.deleteEntity(id);
}

/**
 * Resolve the persona the user should "chat as": the stored global
 * impersonated preference when it points at a live user entity, else `'user'`.
 */
export async function resolvePersonaId(storedId: string | null): Promise<string> {
  if (storedId) {
    try {
      const cfg = await engineApiClient.getEntityConfig(storedId);
      if ((cfg.entity_type ?? 'ai') === 'user') return storedId;
    } catch {
      // Missing / non-user id — fall through to the built-in identity.
    }
  }
  return 'user';
}
