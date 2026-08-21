/**
 * librarySync — hydrate the local marketplace cache from the user's cloud
 * account library (purchases + free grabs + own), so acquired content follows
 * the account across devices. Non-blocking; failures are swallowed (offline /
 * not-yet-implemented backend degrade to cache-only).
 */

import marketplaceApiService from './MarketplaceApiService';
import { ownedAssetDtoToCache } from './marketplaceTypes';
import {
  saveOwnedAsset,
  hasOwnedAsset,
  getOwnedAssets,
  clearMarketplaceCache,
} from '../../database/repositories/marketplace';
import {
  addContentEntry,
  deleteContentEntry,
} from '../../database/repositories/contentLibrary';
import { instantiateCharacter, instantiateText } from './acquireItem';
import type { CharacterSnapshot } from './itemSnapshots';
import { createLogger } from '../../utils/logger';

const log = createLogger('[LibrarySync]');

/**
 * Fetch the account library and materialize it locally:
 *   - character assets not yet on this device → instantiate a local clone
 *   - text assets → content_library rows
 *   - theme/structured assets → content_library payload rows
 *
 * If the backend isn't live yet, this is a no-op that keeps the cache.
 */
export async function syncLibraryToLocal(_ownerUserId: string): Promise<void> {
  let dto;
  try {
    dto = await marketplaceApiService.getLibrary();
  } catch (err) {
    log.warn('Library sync unavailable (offline or backend not live):', err);
    return;
  }

  for (const item of dto) {
    try {
      // Convert to the cache shape.
      const cached = ownedAssetDtoToCache(item);

      // Character assets — instantiate a local clone if the payload has a
      // character snapshot and no local ownership row exists yet.
      if (item.item_type === 'character') {
        const snapshot = (item.asset_json ?? {}) as CharacterSnapshot;
        if (!(await hasOwnedAsset(cached.listingId)) && snapshot?.name) {
          await instantiateCharacter(snapshot, { listingId: item.listing_id });
        }
        await saveOwnedAsset({
          id: cached.id,
          listingId: cached.listingId,
          itemType: cached.itemType,
          title: cached.title,
          assetJson: cached.assetJson,
          kind: cached.kind,
          imageData: cached.imageData,
          imageMime: cached.imageMime,
        });
        continue;
      }

      // Text assets — content_library rows.
      if (
        item.item_type === 'backstory' ||
        item.item_type === 'description' ||
        item.item_type === 'personality' ||
        item.item_type === 'prompt' ||
        item.item_type === 'dialogue'
      ) {
        const { text } = (item.asset_json ?? {}) as { text?: string };
        if (text) {
          await instantiateText(item.item_type, item.title, item.asset_json, {
            listingId: item.listing_id,
          });
        }
      } else {
        // theme / structured — payload row.
        await addContentEntry({
          itemType: item.item_type,
          title: item.title,
          payloadJson: item.asset_json,
          sourceListingId: item.listing_id,
        });
      }
    } catch (err) {
      log.warn('Failed to materialize library item:', err);
    }
  }

    // Best-effort cleanup of entries whose listing is no longer in the account
    // (e.g. delisted-then-removed). Keep local rows otherwise.
    try {
      const cloudIds = new Set(dto.map(d => d.id));
      const local = await getOwnedAssets();
      for (const row of local) {
        if (!cloudIds.has(row.listingId)) {
          await deleteContentEntry(row.id).catch(() => {});
        }
      }
    } catch {
      // ignore cleanup errors
    }
  }

  export default { syncLibraryToLocal, clearMarketplaceCache };