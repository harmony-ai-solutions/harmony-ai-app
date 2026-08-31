/**
 * Persona Repository — **RE-EXPORT SHIM** (§9-A16).
 *
 * The `personas` table is GONE (Q10); personas are now user entities
 * (`entity_type='user'`) backed by a linked `character_profiles` row. This
 * module is a thin re-export/adaptation of `userEntities.ts` so every existing
 * consumer (ChatListScreen, CharactersScreen, ArchivedChatsScreen,
 * CharacterChatService, persona screens) keeps compiling AND functional.
 *
 * @deprecated The shim is deleted in Phase 5 (5-4). Until then it is the
 * interim back-compat surface. Interim note: the built-in `user` entity has NO
 * linked profile until the Phase-5 engine seeder lands, so the persona
 * switcher's default row shows the raw `'user'` id until Phase 5.
 */

import {
  Persona,
  PersonaRecord,
  getUserEntities,
  getUserPersona,
  createUserPersona,
  updateUserPersona,
  deleteUserPersona,
  resolvePersonaId,
} from './userEntities';

export type { Persona, PersonaRecord };

/**
 * Create a new persona (with its backing user entity + linked profile).
 * Avatar is supplied as base64 image data + mime (the old personas.api shape).
 */
export async function createPersona(input: {
  name: string;
  description?: string;
  personality?: string;
  avatar_image_data?: string | null;
  avatar_mime_type?: string | null;
}): Promise<Persona> {
  return createUserPersona({
    name: input.name,
    description: input.description,
    personality: input.personality,
    avatar:
      input.avatar_image_data && input.avatar_mime_type
        ? { image_data: input.avatar_image_data, mime_type: input.avatar_mime_type }
        : null,
  });
}

/** Update a persona's identity fields (and optionally its avatar). */
export async function updatePersona(
  id: string,
  input: {
    name: string;
    description?: string;
    personality?: string;
    avatar_image_data?: string | null;
    avatar_mime_type?: string | null;
  },
): Promise<void> {
  return updateUserPersona(id, {
    name: input.name,
    description: input.description,
    personality: input.personality,
    avatar:
      input.avatar_image_data && input.avatar_mime_type
        ? { image_data: input.avatar_image_data, mime_type: input.avatar_mime_type }
        : null,
  });
}

/** Get a single persona by id, or null. */
export async function getPersona(id: string): Promise<Persona | null> {
  return getUserPersona(id);
}

/** Load all personas ordered by name. */
export async function getAllPersonas(): Promise<Persona[]> {
  return getUserEntities();
}

/** Delete a persona and its backing user entity + profile. */
export async function deletePersona(id: string): Promise<void> {
  return deleteUserPersona(id);
}

export { resolvePersonaId };
