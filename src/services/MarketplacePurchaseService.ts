/**
 * MarketplacePurchaseService — shared helper for the marketplace pay-gate.
 *
 * A "marketplace" AI character can be VIEWED for free (profile, gallery) but
 * its Chat action requires the user to have purchased it. This service wraps
 * the marketplace repository so every chat entry point behaves identically.
 *
 * Public API:
 *   canChatWithProfile(profileId, userId?)   — quick access check
 *   isChatLocked(profileId, userId?)         — hard gate: true when the user
 *     must NOT be able to open a chat (marketplace + not purchased + not the
 *     owner). Screens call this BEFORE opening ChatDetail and silently ignore
 *     the tap when it returns true (payment is not implemented yet).
 *   confirmPurchaseIfNeeded({...})           — future pay-gate: when payment
 *     lands, this shows the branded purchase dialog instead of ignoring.
 */

import {
  getMarketplaceListing,
  hasPurchased,
  purchaseCharacter,
  canChatWithCharacter,
  getSoulBalance,
  type MarketplaceListing,
} from '../database/repositories/marketplace';
import { isCharacterCreator } from '../database/repositories/characterSocial';

/**
 * Resolve the marketplace listing for a profile (null when not listed).
 */
export async function getListing(
  profileId: string,
): Promise<MarketplaceListing | null> {
  return getMarketplaceListing(profileId);
}

/**
 * Whether this profile has a marketplace listing (paid item).
 */
export async function isPaidProfile(profileId: string): Promise<boolean> {
  return (await getMarketplaceListing(profileId)) !== null;
}

/**
 * Whether the current local user can chat with a profile (owner, purchased,
 * or not paywalled).
 */
export async function canChatWithProfile(
  profileId: string,
  currentUserId?: string | null,
): Promise<boolean> {
  return canChatWithCharacter(profileId, currentUserId);
}

/**
 * Hard gate: returns TRUE when the user must NOT be able to open a chat with
 * this character — i.e. it is a marketplace-listed item that the user has not
 * purchased and does not own. Screens call this BEFORE opening ChatDetail and
 * SILENTLY IGNORE the tap when it returns true (payment is not implemented
 * yet, so the chat is simply locked until purchase support lands).
 */
export async function isChatLocked(
  profileId: string,
  currentUserId?: string | null,
): Promise<boolean> {
  return !(await canChatWithCharacter(profileId, currentUserId));
}

/**
 * Whether the local user is the recorded creator of a profile (owner bypass).
 */
export async function isListingOwner(
  profileId: string,
  currentUserId?: string | null,
): Promise<boolean> {
  if (!currentUserId) return false;
  try {
    return await isCharacterCreator(profileId, currentUserId);
  } catch {
    return false;
  }
}

/**
 * Format a SOUL price for badges/labels.
 */
export function formatSoulPrice(price: number): string {
  const n = Number(price) || 0;
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

export interface PurchaseGateOptions {
  /** The character profile id being opened */
  profileId: string;
  /** Character name for the dialog copy */
  characterName: string;
  /** Current cloud user id (for the owner bypass). Nullable. */
  currentUserId?: string | null;
  /** Themed confirm-action callback — e.g. showAlert(title, msg, buttons). */
  showAlert: (
    title: string,
    message?: string,
    buttons?: Array<{
      text: string;
      onPress?: () => void;
      style?: 'default' | 'cancel' | 'destructive';
    }>,
    options?: { icon?: string; blockBackdropDismiss?: boolean },
  ) => void;
  /** Themed toast callback. */
  showToast: (message: string) => void;
  /** i18n keys resolved by the caller (market namespace). */
  i18n: {
    buyTitle: string;
    buyMessage: string;
    buyConfirm: string;
    buyCancel: string;
    buySuccess: string;
    buyInsufficient: string;
    buyFailed: string;
  };
  /** Called when the user is allowed to chat (already owned or just bought). */
  onChatAllowed: () => void | Promise<void>;
}

/**
 * Pay-gate callback for opening a chat with a character.
 *
 * Behavior:
 *   - Not marketplace / owner / already purchased → run onChatAllowed().
 *   - Marketplace + not purchased → show branded confirm dialog. On confirm:
 *       * balance < price → insufficient-balance toast (stay on profile).
 *       * purchase succeeds → success toast + run onChatAllowed().
 *       * purchase fails → failure toast.
 *   - Already purchased → skip dialog, run onChatAllowed().
 */
export async function confirmPurchaseIfNeeded(
  opts: PurchaseGateOptions,
): Promise<void> {
  const {
    profileId,
    characterName,
    currentUserId,
    showAlert,
    showToast,
    i18n,
    onChatAllowed,
  } = opts;

  // 1. Owner bypass — the creator never pays.
  if (currentUserId) {
    try {
      if (await isListingOwner(profileId, currentUserId)) {
        await onChatAllowed();
        return;
      }
    } catch {
      // fall through to the purchase gate
    }
  }

  // 2. Already purchased — straight in.
  if (await hasPurchased(profileId)) {
    await onChatAllowed();
    return;
  }

  // 3. Not listed → not paywalled.
  const listing = await getMarketplaceListing(profileId);
  if (!listing) {
    await onChatAllowed();
    return;
  }

  // 4. Paid + not purchased → confirm dialog.
  const price = listing.priceSouls;
  const balance = await getSoulBalance();

  showAlert(
    i18n.buyTitle,
    i18n.buyMessage.replace('{{name}}', characterName).replace('{{price}}', formatSoulPrice(price)),
    [
      { text: i18n.buyCancel, style: 'cancel' },
      {
        text: i18n.buyConfirm,
        onPress: async () => {
          if (balance < price) {
            showToast(i18n.buyInsufficient);
            return;
          }
          try {
            const result = await purchaseCharacter(profileId);
            if (result.ok) {
              showToast(i18n.buySuccess.replace('{{name}}', characterName));
              await onChatAllowed();
            } else if (result.reason === 'already_purchased') {
              await onChatAllowed();
            } else {
              showToast(i18n.buyInsufficient);
            }
          } catch (err) {
            showToast(i18n.buyFailed);
          }
        },
      },
    ],
    { icon: 'storefront-outline', blockBackdropDismiss: true },
  );
}

export default {
  getListing,
  isPaidProfile,
  canChatWithProfile,
  isChatLocked,
  isListingOwner,
  formatSoulPrice,
  confirmPurchaseIfNeeded,
};