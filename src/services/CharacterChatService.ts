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
 * MARKETPLACE PREVIEW LOCK (user ruling, Wave 1 stub): a character published
 * to the marketplace is VIEWABLE for free, but CHAT is locked until the
 * viewer acquires it. This function is the CENTRAL hard gate:
 * `MarketplaceService.isChatLocked(profileId)` resolves true ⇔ an ACTIVE
 * listing exists published FROM this profile AND the local user is neither
 * the creator nor an owner (library). Characters never published to the
 * marketplace (the user's own library) are NEVER locked; pending/removed
 * listings never lock. When locked, the request is silently ignored (a
 * log.warn) so ChatDetail can never be reached from any entry point — the
 * stub owns ownership state in-memory (no userId parameter needed).
 */

import { createLogger } from '../utils/logger';
import { Alert } from 'react-native';
import i18n from 'i18next';
import {
  createEntity,
  createEntityModuleMapping,
  getEntity,
  getEntityByCharacterProfileId,
} from '../database/repositories';
import {
  deriveParticipantKey,
  deriveScopeFromParticipants,
} from '../database/repositories';
import { v7 as uuidv7 } from 'uuid';
import ChatPreferencesService from './ChatPreferencesService';
import { resolvePersonaId } from '../database/repositories';
import { isChatLocked } from './marketplace/MarketplaceService';
import type { CharacterProfile, Entity } from '../database/models';

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
 * Optional behavior switches for {@link openCharacterChat}.
 *
 * `targetEntityId` — open the chat with THIS exact live AI entity instead of
 * reusing-or-minting one for the card. Used by the "Start a new chat"
 * picker's ENTITY rows (ruling 1b: multiple live entities can share one
 * card; each unused entity is individually chattable — the old
 * newest-entity reuse made duplicates unreachable). Validation is strict:
 * the target must exist (live), be `entity_type='ai'`, and be linked to the
 * SAME character profile — anything else throws so the caller surfaces its
 * generic failure toast. NO minting happens on this branch (the D68 mint
 * seam, D33 typed reserved-name error and D56 alias dedupe stay exclusively
 * on the card create branch), and a DISABLED target still opens the chat
 * (ruling 3 — ChatDetail shows the disabled state; the user unblocks in chat
 * settings).
 */
export interface OpenCharacterChatOptions {
  targetEntityId?: string;
}

// ── 4-2 / D55: critical-wait-before-INIT_ENTITY ────────────────────────────

/**
 * Task 3-4: with the engine as the sole data layer, a created entity is
 * authored directly on the engine at create time — there is no separate sync
 * step to wait for (the legacy sync-watermark "dirty" predicate is gone).
 * Retained as a seam so the caller's flow is unchanged.
 */
async function ensureEntitySyncedBeforeInit(_entity: Entity): Promise<boolean> {
  return true;
}

/**
 * Actionable failure alert (4-2): the conflict copy for a genuine
 * `sync_conflict`, the generic retry copy for transient errors / old engines.
 * The caller does NOT navigate — a retry re-runs the creation flow, which
 * re-derives a fresh timestamped id at a new second (D13: no auto-recovery
 * machinery; genuine conflicts are near-impossible post Phases 1–2).
 */
function showChatSetupFailureAlert(err: unknown): void {
  const code = (err as { code?: string })?.code;
  const message =
    code === 'sync_conflict'
      ? i18n.t('characters:chatOpenSyncConflict')
      : i18n.t('characters:chatOpenSyncFailed');
  Alert.alert(i18n.t('common:error'), message);
}

/**
 * Resolve the identity the user chats as, ensure the character has an entity,
 * sync a newly-created entity to the engine, and hand the caller the params
 * needed to open ChatDetail.
 *
 * Marketplace preview lock (step 0): when the profile is a marketplace listing
 * the local user has not acquired (and does not own), the call is SILENTLY
 * ignored (log.warn) — a listed character is viewable free but chat is locked
 * until acquired; never-published profiles (own library) are never locked.
 *
 * Returns null when the flow cannot complete (e.g. the profile has no usable
 * name). Throws on DB/sync errors so the caller can surface its own toast.
 */
export async function openCharacterChat(
  profile: CharacterProfile,
  navigation: CharacterChatNavigation,
  options?: OpenCharacterChatOptions,
): Promise<void> {
  // 0. HARD GATE — marketplace preview lock (viewable free, chat locked until
  //    acquired; own library never locked). Silently ignore the request so
  //    ChatDetail can never be reached for a locked AI from ANY entry point.
  //    The stub owns ownership state in-memory — no userId is passed here.
  if (await isChatLocked(profile.id)) {
    log.warn(`Chat locked for marketplace profile ${profile.id} — ignored.`);
    return;
  }

  // 1. Resolve the persona we chat as (only personas — never AI
  //    characters — are valid identities; falls back to 'user').
  const storedId = await ChatPreferencesService.getGlobalImpersonatedEntity();
  const impersonatedEntityId = await resolvePersonaId(storedId);

  // 2. Resolve the chat partner entity — two branches:
  //    a) targetEntityId (picker entity rows, ruling 1b): load the EXACT
  //       entity. Strict validation (live + AI + linked to THIS profile),
  //       NO minting, NO newest-entity reuse — two entities on one card are
  //       individually addressable. Errors throw so the caller surfaces its
  //       generic toast.
  //    b) card path (unchanged): reuse the newest live entity for the card or
  //       create one on the fly through the one mint seam (D68) with the
  //       typed reserved-name error (D33) and alias dedupe (D56).
  let entity: Entity;
  if (options?.targetEntityId) {
    const target = await getEntity(options.targetEntityId);
    if (!target) {
      throw new Error(`Target entity not found: ${options.targetEntityId}`);
    }
    if (target.entity_type !== 'ai') {
      throw new Error(`Target entity ${target.id} is not an AI entity`);
    }
    if (target.character_profile_id !== profile.id) {
      throw new Error(
        `Target entity ${target.id} is not linked to profile ${profile.id}`,
      );
    }
    entity = target;
  } else {
    let candidate = await getEntityByCharacterProfileId(profile.id);
    if (!candidate) {
      const rawId = profile.name.trim();
      if (!rawId) {
        throw new Error('Cannot open chat for a character without a name');
      }
      // Create-then-use-response (owner ruling 1): the ENGINE derives the id
      // from the card name (reserved names → 400, deduped alias → "Isabella 2")
      // and returns `{id, alias}`. The returned id drives the module mapping.
      candidate = await createEntity({
        name: rawId,
        character_profile_id: profile.id,
        lifecycle_config: '{}',
      });
      await createEntityModuleMapping({
        entity_id: candidate.id,
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
    entity = candidate;
  }

  // 2b. Client-side defense-in-depth (Q8/A3): a DISABLED AI entity is off —
  //     never drop the user into a chat that the engine will reject with
  //     `entity_disabled`. CARD PATH ONLY: when the caller targets a SPECIFIC
  //     entity (picker entity rows, ruling 3) the chat must OPEN even for a
  //     disabled target — ChatDetailScreen's session:error 'entity_disabled'
  //     branch shows the disabled state and chat settings offers the enable
  //     action (the CharactersScreen / AIProfileScreen card entries keep the
  //     strict refusal UX).
  if (
    !options?.targetEntityId &&
    entity.entity_type === 'ai' &&
    entity.is_disabled === 1
  ) {
    log.warn(`Cannot open chat for disabled AI entity ${entity.id} — blocked client-side (Q8).`);
    return;
  }

  // 3. Task 3-4: the entity is authored directly on the engine at create time,
  //    so there is no sync step to wait for before INIT_ENTITY (the legacy
  //    dirty-watermark + critical syncAndWait gate is gone).
  await ensureEntitySyncedBeforeInit(entity);

  // 4. Derive chat params and navigate. Display name per branch: the card
  //    path keeps the profile name (unchanged); the entity branch prefers the
  //    entity's alias (picker entity rows show the alias, e.g. "Isabella 2").
  const entityName = options?.targetEntityId
    ? entity.alias || profile.name
    : profile.name;
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
    entityName,
  });
}

export default {
  openCharacterChat,
};
