/**
 * purchaseAccess — variant-aware purchase availability (plan 7-14 V4).
 *
 * Ruling 6 (2026-10-14): purchases are DISABLED in store builds at launch.
 * Every PAID purchase action is hidden — wallet top-up ("Buy Souls"), the
 * marketplace buy/checkout button, and the billing/subscription entry — while
 * the wallet BALANCE stays visible and the marketplace stays browsable. Free
 * actions (e.g. claiming a free marketplace item) are NOT purchases and stay.
 * A real in-app purchase flow (IAP) is a separate future plan.
 *
 *   - `full`  — purchases enabled (today's behavior, byte-for-byte).
 *   - `store` — purchases disabled: {@link purchasesEnabled} returns `false`,
 *               so the UI renders no purchase action anywhere.
 *
 * Store gating is runtime-only and variant-scoped (design rule 2) — this
 * predicate NEVER touches the engine or the synced data layer, and never
 * writes the synced `is_disabled` flag. It is the single source the purchase
 * surfaces read (mirrors `providerAvailability` / `entityAccess` from V3).
 */

import { isStoreVariant } from '../../config/appVariant';

/**
 * True when PAID purchase actions (wallet top-up, marketplace buy/checkout,
 * billing/subscription management) are available in this build.
 *
 * Store builds: `false` (purchases disabled at launch). Full builds: `true`
 * (unchanged). Free actions are unaffected by this predicate.
 */
export function purchasesEnabled(): boolean {
  return !isStoreVariant();
}
