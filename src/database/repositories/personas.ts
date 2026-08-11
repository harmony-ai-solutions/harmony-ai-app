/**
 * Persona Repository
 *
 * A "persona" is the identity the user chats AS. Personas are created via the
 * My Profile screen and store ONLY identity fields (name, description,
 * personality, avatar) — they deliberately have NO character profile, NO AI
 * module configs and NO provider bindings (that is the domain of AI
 * characters — the entities the user chats WITH).
 *
 * The persona id doubles as an Entity id (alias = name, no linked profile)
 * so chat INIT_ENTITY resolves the persona as the "chatting as" identity —
 * the same way the built-in 'user' identity works.
 */

import { getDatabase } from '../connection';
import { createDataURL } from '../base64';
import { runStatementsInTransaction } from '../transaction';
import { generateId } from '../../utils/uuid';

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

/** Row shape persisted in the client-only `personas` table. */
export interface PersonaRecord {
  id: string;
  name: string;
  description: string;
  personality: string;
  avatar_image_data: string | null;
  avatar_mime_type: string | null;
  created_at: Date;
  updated_at: Date;
}

function mapRowToPersona(row: any): Persona {
  const avatarUri =
    row.avatar_image_data && row.avatar_mime_type
      ? createDataURL(row.avatar_image_data, row.avatar_mime_type)
      : null;
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    personality: row.personality ?? '',
    avatarUri,
  };
}

/** Create a new persona (with its backing identity entity for chat). */
export async function createPersona(input: {
  name: string;
  description?: string;
  personality?: string;
  avatar_image_data?: string | null;
  avatar_mime_type?: string | null;
}): Promise<Persona> {
  const db = getDatabase();
  const id = generateId();
  const now = new Date();

  const avatarImageData = input.avatar_image_data ?? null;
  const avatarMimeType = input.avatar_mime_type ?? null;

  await runStatementsInTransaction(db, [
    {
      sql: `INSERT INTO personas
         (id, name, description, personality, avatar_image_data, avatar_mime_type, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        id,
        input.name.trim(),
        input.description?.trim() ?? '',
        input.personality?.trim() ?? '',
        avatarImageData,
        avatarMimeType,
        now.toISOString(),
        now.toISOString(),
      ],
    },
    {
      // Backing identity entity so chat INIT_ENTITY can resolve this persona
      // as the "chatting as" identity — mirrors the built-in 'user' identity.
      sql: `INSERT INTO entities (id, alias, character_profile_id, lifecycle_config, rag_reindex_required, created_at, updated_at)
       VALUES (?, ?, NULL, '{}', 1, ?, ?)`,
      params: [id, input.name.trim(), now.toISOString(), now.toISOString()],
    },
  ]);

  return {
    id,
    name: input.name.trim(),
    description: input.description?.trim() ?? '',
    personality: input.personality?.trim() ?? '',
    avatarUri:
      avatarImageData && avatarMimeType
        ? createDataURL(avatarImageData, avatarMimeType)
        : null,
  };
}

// ── Defense-in-depth ────────────────────────────────────────────────────
//
// A persona is ONLY a row in the `personas` table whose backing entity does
// NOT link a character profile (personas are identity-only; AI characters
// always link a character profile). All persona queries JOIN entities and
// exclude any row whose backing entity still has character_profile_id set —
// so an AI character can NEVER surface as a persona, even if a leaked row
// ever existed in the table.

const PERSONA_SELECT = `SELECT p.id, p.name, p.description, p.personality,
                               p.avatar_image_data, p.avatar_mime_type
        FROM personas p
        INNER JOIN entities e ON e.id = p.id
        WHERE e.character_profile_id IS NULL`;

/** Get a single persona by id, or null. */
export async function getPersona(id: string): Promise<Persona | null> {
  const db = getDatabase();
  const [results] = await db.executeSql(
    `${PERSONA_SELECT} AND p.id = ?`,
    [id],
  );
  if (results.rows.length === 0) return null;
  return mapRowToPersona(results.rows.item(0));
}

/** Load all personas ordered by name. */
export async function getAllPersonas(): Promise<Persona[]> {
  const db = getDatabase();
  const [results] = await db.executeSql(
    `${PERSONA_SELECT} ORDER BY p.name`,
  );
  const personas: Persona[] = [];
  for (let i = 0; i < results.rows.length; i++) {
    personas.push(mapRowToPersona(results.rows.item(i)));
  }
  return personas;
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
  const db = getDatabase();
  const now = new Date();

  await db.executeSql(
    `UPDATE personas
     SET name = ?, description = ?, personality = ?,
         avatar_image_data = ?, avatar_mime_type = ?, updated_at = ?
     WHERE id = ?`,
    [
      input.name.trim(),
      input.description?.trim() ?? '',
      input.personality?.trim() ?? '',
      input.avatar_image_data ?? null,
      input.avatar_mime_type ?? null,
      now.toISOString(),
      id,
    ],
  );

  // Keep the backing entity alias in sync with the persona name.
  await db.executeSql(
    `UPDATE entities SET alias = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
    [input.name.trim(), now.toISOString(), id],
  );
}

/** Delete a persona and its backing identity entity. */
export async function deletePersona(id: string): Promise<void> {
  const db = getDatabase();
  return runStatementsInTransaction(db, [
    { sql: 'DELETE FROM personas WHERE id = ?', params: [id] },
    { sql: 'DELETE FROM entities WHERE id = ?', params: [id] },
  ]);
}

/**
 * Resolve the persona the user should "chat as".
 *
 * Personas are the ONLY identities the user can chat as. The stored global
 * impersonated preference is honored only when it points at an existing
 * persona; otherwise the built-in 'user' identity is used. AI character
 * entities are NEVER resolved here — they are chat partners, not identities.
 *
 * @param storedId The stored global impersonated entity id (or null).
 * @returns The persona id to impersonate ('user' when no persona is set).
 */
export async function resolvePersonaId(storedId: string | null): Promise<string> {
  if (storedId) {
    const persona = await getPersona(storedId);
    if (persona) return persona.id;
  }
  return 'user';
}
