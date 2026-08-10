/**
 * Persona Repository
 *
 * A "persona" is the identity the user chats AS. In the app's data model a
 * persona is an Entity whose linked CharacterProfile is tagged source='user'
 * (i.e. created by the app user via Create AI / persona editing) — the
 * profile provides the name / description / personality and the primary
 * character image is its picture. This mirrors how "Chatting as" resolves
 * identities for chat (ChatListScreen / CreateAIScreen impersonation).
 */

import { getDatabase } from '../connection';
import { getPrimaryImage, imageToDataURL } from './characters';

/** Display-ready persona combining the entity + its linked user profile. */
export interface Persona {
  entityId: string;
  /** Entity alias (fallback: profile name / entity id) */
  name: string;
  /** CharacterProfile.description */
  description: string | null;
  /** CharacterProfile.personality */
  personality: string | null;
  /** Base64 data URL of the primary image, or null */
  avatarUri: string | null;
  /** True when this persona is the globally selected "Chatting as" identity */
  isActive?: boolean;
}

/**
 * Load all personas: entities linked to a CharacterProfile whose sidecar
 * source is 'user'. Soft-deleted entities and profiles are excluded.
 */
export async function getUserPersonas(): Promise<Persona[]> {
  const db = getDatabase();

  // Entities JOIN character_profiles JOIN the client-only source sidecar.
  // Only entities whose profile is tagged 'user' count as personas; profiles
  // created by other users (community) are chat partners, not personas.
  const [results] = await db.executeSql(
    `SELECT e.id AS entity_id, e.alias AS alias,
            cp.id AS profile_id, cp.name AS profile_name,
            cp.description AS description, cp.personality AS personality
     FROM entities e
     INNER JOIN character_profiles cp ON cp.id = e.character_profile_id
     INNER JOIN character_profile_sources cps ON cps.profile_id = cp.id
     WHERE e.deleted_at IS NULL
       AND cp.deleted_at IS NULL
       AND cps.source = 'user'
     ORDER BY cp.name`,
  );

  const personas: Persona[] = [];
  for (let i = 0; i < results.rows.length; i++) {
    const row = results.rows.item(i);

    // Avatar — best-effort primary image fetch
    let avatarUri: string | null = null;
    try {
      const image = await getPrimaryImage(row.profile_id);
      if (image) avatarUri = imageToDataURL(image);
    } catch {
      avatarUri = null;
    }

    personas.push({
      entityId: row.entity_id,
      name: row.alias || row.profile_name || row.entity_id,
      description: row.description ?? null,
      personality: row.personality ?? null,
      avatarUri,
    });
  }

  return personas;
}

/**
 * Find a single persona by entity id, or null.
 * Convenience for the persona edit screen's load path.
 */
export async function getPersonaByEntityId(entityId: string): Promise<Persona | null> {
  const personas = await getUserPersonas();
  return personas.find(p => p.entityId === entityId) ?? null;
}
