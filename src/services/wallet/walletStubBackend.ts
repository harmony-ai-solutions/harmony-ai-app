/**
 * walletStubBackend — in-memory soul-credits wallet behind WalletService.
 *
 * The stub holds a fixed seeded balance (50 souls — matches the signup-bonus
 * UX expectation; the bonus flow itself is REMOVED, A2). NO persistence:
 * every app launch starts at the seeded balance.
 *
 * `debit` is the mutation used by MarketplaceService.acquire — it validates
 * the amount and throws `InsufficientCreditsError` (402 quota_exceeded with
 * `soulCreditsAvailable` = remaining balance) when the balance is short.
 * Honest errors only — never fake success.
 *
 * `__resetForTests()` restores the seeded balance so test suites are
 * order-independent.
 */

import { simulateLatency } from '../stub/stubBackendUtils';
import { InsufficientCreditsError, WalletError } from '../stub/StubServiceError';
import type { SubscriptionStatus } from './WalletService';

/** Seeded starting balance (souls). */
const SEED_BALANCE = 50;
/** The wallet tier the stub reports (mirrors GET /v1/subscription/me). */
const TIER = 'free';

let balance = SEED_BALANCE;

/** Test-only reset — restores the seeded balance. */
export function __resetForTests(): void {
  balance = SEED_BALANCE;
}

/** Current wallet balance (souls). */
export async function getBalance(): Promise<number> {
  await simulateLatency();
  return balance;
}

/**
 * Subscription/tier status — mirrors the `soulbits-api-client`
 * GET /v1/subscription/me wire shape (pre-matched, binding A1 directive).
 */
export async function getSubscription(): Promise<SubscriptionStatus> {
  await simulateLatency();
  return {
    tier: TIER,
    soulCreditsAvailable: balance,
    currentTier: TIER,
  };
}

/**
 * Debit the wallet (used by MarketplaceService.acquire).
 * @throws {WalletError} 400 `invalid_amount` for a negative/non-finite amount.
 * @throws {InsufficientCreditsError} 402 `quota_exceeded` when the balance is
 *   short (carries `soulCreditsAvailable` = remaining balance; balance is NOT
 *   modified on failure).
 */
export async function debit(amount: number): Promise<void> {
  await simulateLatency();
  if (!Number.isFinite(amount) || amount < 0) {
    throw new WalletError(400, `invalid debit amount: ${amount}`, { code: 'invalid_amount' });
  }
  if (balance < amount) {
    throw new InsufficientCreditsError(balance);
  }
  balance -= amount;
}