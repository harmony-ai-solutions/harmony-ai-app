/**
 * CharacterChatService — shared "open a chat with a character" helper.
 *
 * ChatDetail requires an ENTITY linked to the character profile (plus the
 * impersonated "user" entity). If no entity uses this profile yet, one is
 * created on the fly (mirroring the CreateAI flow), synced to the engine so
 * INIT_ENTITY succeeds, and the user is dropped straight into the chat.
 *
 * Used by CharactersScreen (card chat button), ChatListScreen,
 * AIProfileScreen (primary Chat button), DiscoverScreen and MarketScreen so
 * every entry point behaves identically.
 *
 * HARD GATE: marketplace-listed characters that the current user has not
 * purchased (and does not own) are LOCKED — this function silently returns
 * without opening a chat. Payment is not implemented yet, so tapping Chat on
 * a paid AI is simply ignored everywhere.
 */

import { createLogger } from '../utils/logger';
import {
  createEntity,
  createEntityModuleMapping,
  getEntityByCharacterProfileId,
} from '../database/repositories/entities';
import {
  deriveParticipantKey,
  deriveScopeFromParticipants,
} from '../database/repositories/interactions';
import { v7 as uuidv7 } from 'uuid';
import ChatPreferencesService from './ChatPreferencesService';
import { resolvePersonaId } from '../database/repositories/personas';
import syncService from './SyncService';
import { isChatLocked } from './MarketplacePurchaseService';
import type { CharacterProfile } from '../database/models';

const log = createLogger('[CharacterChatService]');

export interface CharacterChatNavigation {
  navigateToChat: (params: {
    interactionId: string;
    participantKey?: string;
    participantIds?: string[];
    entityId: string;
    entityName?: string;
  }) => void;
}

/**
 * Resolve the identity the user chats as, ensure the character has an entity,
 * sync a newly-created entity to the engine, and hand the caller the params
 * needed to open ChatDetail.
 *
 * Returns null when the flow cannot complete (e.g. the profile has no usable
 * name). Throws on DB/sync errors so the caller can surface its own toast.
 *
 * @param currentUserId the signed-in cloud user id (used for the marketplace
 *   owner bypass). When omitted, marketplace locking still applies to
 *   non-purchased items.
 */
export async function openCharacterChat(
  profile: CharacterProfile,
  navigation: CharacterChatNavigation,
  currentUserId?: string | null,
): Promise<void> {
  // 0. HARD GATE (payment not implemented yet): silently ignore the request
  //    when the character is a marketplace listing the user has not purchased
  //    and does not own. This guarantees ChatDetail can never be reached for
  //    a locked AI from ANY entry point.
  if (await isChatLocked(profile.id, currentUserId)) {
    log.warn(`Chat locked for marketplace profile ${profile.id} — ignored.`);
    return;
  }

  // 1. Resolve the persona we chat as (only personas — never AI
  //    characters — are valid identities; falls back to 'user').
  const storedId = await ChatPreferencesService.getGlobalImpersonatedEntity();
  const impersonatedEntityId = await resolvePersonaId(storedId);

  // 2. Reuse an entity linked to this profile, or create one
  let entity = await getEntityByCharacterProfileId(profile.id);
  let createdNewEntity = false;
  if (!entity) {
    createdNewEntity = true;
    const entityId = profile.name.trim();
    if (!entityId) {
      throw new Error('Cannot open chat for a character without a name');
    }
    entity = await createEntity({
      id: entityId,
      alias: profile.name.trim(),
      character_profile_id: profile.id,
      lifecycle_config: '{}',
      rag_reindex_required: 1,
    });
    await createEntityModuleMapping({
      entity_id: entityId,
      backend_config_id: null,
      cognition_config_id: null,
      tts_config_id: null,
      stt_config_id: null,
      vision_config_id: null,
      rag_config_id: null,
      imagination_config_id: null,
      movement_config_id: null,
      deleted_at: null,
    });
  }

  // 3. Push a NEWLY created entity to the engine BEFORE navigating.
  //    ChatDetail sends INIT_ENTITY on mount; if the engine has not yet
  //    ingested the entity it rejects with entity_not_defined and the chat
  //    is stuck on "Connecting..." (same constraint documented in
  //    CreateAIScreen). Existing entities are already known — no wait.
  if (createdNewEntity) {
    await syncService.syncAndWait({ timeoutMs: 15_000 }).catch(syncErr => {
      log.warn('Auto-sync before chat failed (non-critical):', syncErr);
    });
  }

  // 4. Derive chat params and navigate
  const participantIds = [impersonatedEntityId ?? 'user', entity.id];
  const scope = deriveScopeFromParticipants(participantIds);
  const participantKey = deriveParticipantKey(
    participantIds,
    impersonatedEntityId ?? 'user',
    scope,
  );
  const tempInteractionId = uuidv7();
  navigation.navigateToChat({
    interactionId: tempInteractionId,
    participantKey,
    participantIds,
    entityId: impersonatedEntityId ?? 'user',
    entityName: profile.name,
  });
}

export default {
  openCharacterChat,
};
