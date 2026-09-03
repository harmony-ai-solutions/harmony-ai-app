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
import {
  getEntity,
  createEntity,
  getNextEntityAliasCopy,
  deleteEntity,
  isProfilePersonaOwned,
  ERR_PROFILE_OWNED_BY_PERSONA,
} from './entities';
import {
  createCharacterProfile,
  updateCharacterProfile,
  createCharacterImage,
  getCharacterImages,
  deleteCharacterImage,
  getPrimaryImage,
  getCharacterProfile,
  deleteCharacterProfile,
  imageToDataURL,
} from './characters';
import type { CharacterProfile } from '../models';

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

/**
 * The full Character Card V3 + Soulbits profile field set a persona write can
 * carry (3-2-A). Everything except `name`/`description`/`personality` is
 * optional — omitted fields fall back to the minimal defaults on create and
 * round-trip untouched on update.
 */
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

/** The runtime keys of {@link UserPersonaProfileFields} (single source for the pick helper). */
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

/**
 * Pick the explicitly-provided full-profile fields from a persona input.
 * Fields whose value is `undefined` are omitted so callers can distinguish
 * "not provided" (keep the default / round-trip) from "explicitly cleared"
 * (e.g. `vision_config_id: null`).
 */
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

/** Input for {@link createUserPersona}: identity + avatar + optional full profile fields. */
export interface CreateUserPersonaInput extends UserPersonaProfileFields {
  name: string;
  description?: string;
  personality?: string;
  avatar?: UserPersonaAvatar | null;
}

/** Input for {@link updateUserPersona}: name required (rename), everything else optional. */
export interface UpdateUserPersonaInput extends UserPersonaProfileFields {
  name: string;
  description?: string;
  personality?: string;
  avatar?: UserPersonaAvatar | null;
}

/**
 * Create a persona: a character_profiles row (minimal defaults, overlaid with
 * any full V3 + Soulbits fields the caller provides) + primary avatar image row
 * (if any) + a `user` entity (id = name, unique-checked via
 * getNextEntityAliasCopy; alias = name, entity id FROZEN after create).
 *
 * The caller (screen) is responsible for the fire-and-forget `syncAndWait`
 * (PersonaEdit pattern) — this repo stays layering-clean.
 */
export async function createUserPersona(input: CreateUserPersonaInput): Promise<Persona> {
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
    ...pickProfileFields(input),
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
 * Full V3 + Soulbits fields are accepted; fields NOT provided round-trip
 * untouched (the existing row is spread first, then the provided fields are
 * overlaid). Avatars reconcile diff-based: a new/different primary image
 * replaces the old (which is soft-deleted); no avatar passed leaves images
 * untouched.
 *
 * @param id persona entity id
 * @param input name (required — rename), description/personality/avatar + any
 *   full-profile field from {@link UserPersonaProfileFields}
 */
export async function updateUserPersona(
  id: string,
  input: UpdateUserPersonaInput,
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
    ...pickProfileFields(input),
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
 * Create a persona by FULL-copying an existing character card — the RN
 * equivalent of the engine 1-3 duplicate endpoint, persona-targeted (decisions
 * 4/6/7/9). The source card is untouched.
 *
 * Copy semantics (mirrors the engine's field matrix):
 *   - ALL Character Card V3 spec + Soulbits fields copied verbatim, including
 *     `card_provenance` AS-IS (decision 6).
 *   - Fresh ids everywhere (profile + entity + images) — never reuses a row.
 *   - `name` deduped via the entity copy-suffix convention
 *     (`getNextEntityAliasCopy`, "Max" → "Max 2").
 *   - `is_favorite` reset to 0 (a persona copy is never auto-favorited).
 *   - `lifecycle_config` reset to `{}` (a persona has no AI lifecycle).
 *   - ALL `character_image` rows copied with the primary flag preserved
 *     (decision 9).
 *   - A `user` entity is created linking the fresh profile (id = name,
 *     alias = id, frozen after create).
 *
 * @param sourceProfileId the character card profile to copy
 * @param options.name optional copy base name (defaults to the source name)
 * @returns the new Persona (entity id, name, description, personality, avatar)
 */
export async function createUserPersonaFromCard(
  sourceProfileId: string,
  options: { name?: string } = {},
): Promise<Persona> {
  const source = await getCharacterProfile(sourceProfileId);
  if (!source) {
    throw new Error(`Character profile not found: ${sourceProfileId}`);
  }

  // 1:1 ownership guard (3-3 / decisions 1/10): the from-card flow copies an
  // AI card into a persona. A persona-owned source is never copyable — it would
  // mint a second persona from a persona's card (dual-reference state, which
  // decisions 1/10 make impossible going forward). AI-only surfaces already
  // hide persona cards, so this is defense-in-depth for stale/deep-link ids.
  if (await isProfilePersonaOwned(sourceProfileId)) {
    throw new Error(
      `${ERR_PROFILE_OWNED_BY_PERSONA} — cannot create a persona from a persona-owned card`,
    );
  }

  const baseName = (options.name ?? source.name).trim();
  const existing = await getEntity(baseName);
  const entityId = existing ? await getNextEntityAliasCopy(baseName) : baseName;
  const personaName = entityId; // id = name convention for personas

  const profileId = generateId();

  // Full-field copy: every V3 + Soulbits column copied verbatim from the
  // source (getCharacterProfile already normalizes nulls → ''), `is_favorite`
  // + `lifecycle_config` reset per the engine field matrix, `card_provenance`
  // copied AS-IS (decision 6).
  await createCharacterProfile({
    id: profileId,
    name: personaName,
    description: source.description ?? '',
    personality: source.personality ?? '',
    voice_characteristics: source.voice_characteristics ?? '',
    base_prompt: source.base_prompt ?? '',
    scenario: source.scenario ?? '',
    typing_speed_wpm: source.typing_speed_wpm ?? 60,
    audio_response_chance_percent: source.audio_response_chance_percent ?? 50,
    vision_config_id: source.vision_config_id ?? null,
    lifecycle_config: '{}', // reset
    first_mes: source.first_mes ?? '',
    mes_example: source.mes_example ?? '',
    alternate_greetings: source.alternate_greetings ?? '[]',
    post_history_instructions: source.post_history_instructions ?? '',
    creator_notes: source.creator_notes ?? '',
    creator: source.creator ?? '',
    character_version: source.character_version ?? '',
    nickname: source.nickname ?? '',
    tags: source.tags ?? '[]',
    group_only_greetings: source.group_only_greetings ?? '[]',
    extensions: source.extensions ?? '{}',
    assets: source.assets ?? '[]',
    card_provenance: source.card_provenance ?? '{}', // AS-IS
    character_book: source.character_book ?? '{}',
    is_favorite: 0, // reset
  });

  // Copy ALL images with the primary flag preserved (fresh image ids).
  const images = await getCharacterImages(sourceProfileId);
  for (const image of images) {
    await createCharacterImage({
      character_profile_id: profileId,
      image_data: image.image_data,
      mime_type: image.mime_type,
      description: image.description,
      is_primary: image.is_primary,
      display_order: image.display_order,
      vl_model_interpretation: image.vl_model_interpretation,
      vl_model: image.vl_model,
      updated_at: new Date(),
    });
  }

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

  const primary = await getPrimaryImage(profileId);
  return {
    id: entityId,
    name: personaName,
    description: source.description ?? '',
    personality: source.personality ?? '',
    avatarUri: primary ? imageToDataURL(primary) : null,
  };
}

/**
 * Fire a NON-BLOCKING sync after a persona delete (decision 15). The sync
 * stack is lazy-required so its module graph (ConnectionManager + timers +
 * real logger transport) never loads for callers that only read/write
 * personas. Best-effort: `initiateSync` self-guards when the connection is
 * unavailable or a sync is already in flight, and any failure is swallowed —
 * the next opportunistic sync picks the tombstones up.
 */
function firePersonaDeleteSync(): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { SyncService } = require('../../services/SyncService') as typeof import('../../services/SyncService');
    SyncService.getInstance()
      .initiateSync()
      .catch(() => {
        // Best-effort — swallow.
      });
  } catch {
    // SyncService unavailable (e.g. a unit-test environment) — nothing to do.
  }
}

/**
 * Delete a persona: soft-delete the entity (cascades its child rows), the
 * persona's `character_image` rows, and the linked profile. `'user'` is
 * protected (A1 — the built-in identity is load-bearing and never deletable).
 *
 * Mirroring the engine 1-2 cascade locally (tombstoning the images too) means
 * no live avatar rows linger between the local delete and the engine's
 * round-tripped tombstones. After the local delete, a NON-BLOCKING
 * `syncService.initiateSync()` fires (decision 15) so the tombstones reach the
 * engine ASAP — every caller benefits because the trigger lives in the repo
 * layer.
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

  if (entity.character_profile_id) {
    const images = await getCharacterImages(entity.character_profile_id);
    for (const image of images) {
      await deleteCharacterImage(image.id);
    }
  }

  await deleteEntity(id);
  if (entity.character_profile_id) {
    await deleteCharacterProfile(entity.character_profile_id);
  }

  firePersonaDeleteSync();
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
