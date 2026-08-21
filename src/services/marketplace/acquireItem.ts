/**
 * acquireItem — shared acquire + instantiate flow for marketplace items.
 *
 * Handles the "Buy for N SOULs" / "Get Free" path AND materializes the
 * delivered asset into the user's local content (character clone, library
 * entry, theme). Dispatches to type-appropriate callbacks.
 *
 * This is the core of "buying = getting your own permanent copy".
 */

import marketplaceApiService from './MarketplaceApiService';
import {
  createCharacterProfile,
  createCharacterImage,
  setCharacterProfileSource,
} from '../../database/repositories/characters';
import {
  saveOwnedAsset,
  hasOwnedAsset,
  getCachedListing,
} from '../../database/repositories/marketplace';
import { addContentEntry } from '../../database/repositories/contentLibrary';
import { createDataURL } from '../../database/base64';
import { CHARACTER_PROFILE_SOURCE_USER } from '../../database/repositories/characters';
import { generateId } from '../../utils/uuid';
import type { CharacterSnapshot } from './itemSnapshots';
import type { MarketplaceItemType } from './marketplaceTypes';

export type AcquireStatus = 'own' | 'purchase' | 'free';

export interface AcquireOptions {
  currentUserId?: string | null;
  /** Called with the DTO post-acquire for screens to react. */
  onAcquired?: (result: {
    status: AcquireStatus;
    assetJson: unknown;
    dest?: 'character' | 'content' | 'theme';
    profileId?: string;
    contentEntryId?: string;
  }) => void | Promise<void>;
  /** Called when the buyer lacks SOULs (paid item, insufficient balance). */
  onInsufficient?: () => void | Promise<void>;
}

export interface AcquireOutcome {
  status: AcquireStatus;
  dest: 'character' | 'content' | 'theme';
  profileId?: string;
  contentEntryId?: string;
}

/**
 * Instantiate a character asset from a serialized snapshot into a local
 * profile (the buyer's own copy, tagged 'user').
 */
export async function instantiateCharacter(
  snapshot: CharacterSnapshot,
  _opts?: { listingId?: string },
): Promise<{ profileId: string; name: string }> {
  const id = generateId();
  const now = new Date();

  const profile = {
    id,
    name: snapshot.name || 'Imported Character',
    description: snapshot.description ?? null,
    personality: snapshot.personality ?? null,
    appearance: snapshot.appearance ?? null,
    backstory: snapshot.backstory ?? null,
    base_prompt: snapshot.base_prompt ?? null,
    scenario: snapshot.scenario ?? null,
    example_dialogues: snapshot.example_dialogues ?? null,
    voice_characteristics: snapshot.voice_characteristics ?? null,
    typing_speed_wpm: snapshot.typing_speed_wpm ?? 150,
    audio_response_chance_percent: snapshot.audio_response_chance_percent ?? 10,
    vision_config_id: null,
    lifecycle_config: null,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  };

  await createCharacterProfile(profile);
  // The clone is the buyer's OWN character — source 'user' so it doesn't
  // appear on their Discover grid and they can chat freely (owner bypass).
  await setCharacterProfileSource(id, CHARACTER_PROFILE_SOURCE_USER);

  if (snapshot.image_data && snapshot.image_mime) {
    try {
      await createCharacterImage({
        character_profile_id: id,
        image_data: snapshot.image_data,
        mime_type: snapshot.image_mime,
        description: 'Primary',
        display_order: 0,
        is_primary: true,
        vl_model_interpretation: '',
        vl_model: '',
        updated_at: new Date(),
      });
    } catch {
      // image is optional
    }
  }

  return { profileId: id, name: profile.name };
}

/** Instantiate a text asset into the content library. */
export async function instantiateText(
  itemType: 'backstory' | 'description' | 'personality' | 'prompt' | 'dialogue',
  title: string,
  payload: { text?: string } | unknown,
  opts?: { listingId?: string },
): Promise<{ contentEntryId: string }> {
  const obj = (payload ?? {}) as { text?: string };
  const entry = await addContentEntry({
    itemType,
    title,
    body: obj.text ?? null,
    payloadJson: payload ?? null,
    sourceListingId: opts?.listingId,
  });
  return { contentEntryId: entry.id };
}

/**
 * Acquire an item (purchase or free) and materialize the delivered copy.
 * Returns an outcome describing what was created locally.
 */
export async function acquireItem(
  listingId: string,
  currentUserId?: string | null,
  opts?: AcquireOptions,
): Promise<AcquireOutcome> {
  // Already owned locally? Return its destination without a network call.
  if (await hasOwnedAsset(listingId)) {
    const listing = await getCachedListing(listingId);
    const dest = itemTypeToDest(listing?.itemType ?? 'character');
    const outcome: AcquireOutcome = { status: 'purchase', dest };
    await opts?.onAcquired?.({
      status: 'purchase',
      assetJson: null,
      dest,
    });
    return outcome;
  }

  // Acquire from the backend (buy or free grab / own).
  let dto;
  try {
    dto = await marketplaceApiService.acquire(listingId);
  } catch (err) {
    const status =
      (err as { status?: number })?.status;
    if (status === 409) {
      await opts?.onInsufficient?.();
      throw new MarketInsufficientError();
    }
    throw err;
  }

  const status: AcquireStatus = dto.kind;
  const assetJson: unknown = dto.asset_json;

  let dest: AcquireOutcome['dest'];
  let profileId: string | undefined;
  let contentEntryId: string | undefined;

  // Cached listing for metadata (title, item type, preview image).
  const cached = await getCachedListing(listingId);
  const itemType: MarketplaceItemType = cached?.itemType ?? 'character';

  // Save the owned asset row (local cache of the account copy).
  await saveOwnedAsset({
    id: generateId(),
    listingId,
    itemType,
    title: cached?.title ?? 'Item',
    assetJson,
    kind: status,
    imageData: cached?.previewImageData ?? null,
    imageMime: cached?.previewMimeType ?? null,
  });

  // Materialize the delivered copy.
  if (itemType === 'character') {
    const snapshot = assetJson as CharacterSnapshot;
    const inst = await instantiateCharacter(snapshot, { listingId });
    profileId = inst.profileId;
    dest = 'character';
  } else if (
    itemType === 'backstory' ||
    itemType === 'description' ||
    itemType === 'personality' ||
    itemType === 'prompt' ||
    itemType === 'dialogue'
  ) {
    const inst = await instantiateText(itemType, cached?.title ?? 'Item', assetJson, {
      listingId,
    });
    contentEntryId = inst.contentEntryId;
    dest = 'content';
  } else {
    // theme & other structured assets
    const entry = await addContentEntry({
      itemType,
      title: cached?.title ?? 'Item',
      payloadJson: assetJson,
      sourceListingId: listingId,
    });
    contentEntryId = entry.id;
    dest = 'theme';
  }

  const outcome: AcquireOutcome = { status, dest, profileId, contentEntryId };
  await opts?.onAcquired?.({
    status,
    assetJson,
    dest,
    profileId,
    contentEntryId,
  });
  return outcome;
}

export class MarketInsufficientError extends Error {
  constructor() {
    super('insufficient_soul_balance');
    this.name = 'MarketInsufficientError';
  }
}

function itemTypeToDest(type: MarketplaceItemType): AcquireOutcome['dest'] {
  if (type === 'character') return 'character';
  if (type === 'theme') return 'theme';
  return 'content';
}

export { createDataURL as _createDataURL };