/**
 * WalletService — soul-credits wallet status + balance (in-memory stub backend).
 *
 * An EventEmitter status singleton (`idle | syncing | ready | failed`) in the
 * style of `CloudSessionService` — the UI subscribes to `'status'` transitions
 * and reads the balance via the typed API. NO persistence: every launch starts
 * at the seeded 50-soul balance.
 *
 * Key design decisions:
 *   - `debit(amount)` is INTERNAL — only `MarketplaceService.acquire` uses it.
 *     UI screens should call `MarketplaceService.acquire` (which checks the
 *     balance and throws `InsufficientCreditsError` when short) instead.
 *   - An `InsufficientCreditsError` from `debit` is a business error, NOT a
 *     wallet failure — the status returns to `ready` (the wallet is healthy,
 *     the user is just short). Unexpected errors flip the status to `failed`.
 *   - "Buy/Sell Souls" remains the existing "Coming soon" placeholder (already
 *     honest) — this service only reports the balance/tier.
 *
 * Singleton — use `walletService` (the exported instance).
 */

import EventEmitter from 'eventemitter3';
import { createLogger } from '../../utils/logger';
import * as walletBackend from './walletStubBackend';
import { InsufficientCreditsError } from '../stub/StubServiceError';

const log = createLogger('[Wallet]');

// ── Types ─────────────────────────────────────────────────────────────────

export type WalletStatus = 'idle' | 'syncing' | 'ready' | 'failed';

/**
 * Subscription/tier status — mirrors the `soulbits-api-client`
 * GET /v1/subscription/me wire shape (pre-matched, binding A1 directive):
 * `tier` ('free' | future paid tiers) + the wallet balance as
 * `soulCreditsAvailable`.
 */
export interface SubscriptionStatus {
  tier: string;
  soulCreditsAvailable: number;
  currentTier?: string;
  upgradeUrl?: string;
}

interface WalletEvents {
  status: (status: WalletStatus) => void;
}

// ── Service ───────────────────────────────────────────────────────────────

export class WalletServiceClass extends EventEmitter<WalletEvents> {
  private static instance: WalletServiceClass | null = null;

  private status: WalletStatus = 'idle';

  private constructor() {
    super();
  }

  static getInstance(): WalletServiceClass {
    if (!WalletServiceClass.instance) {
      WalletServiceClass.instance = new WalletServiceClass();
    }
    return WalletServiceClass.instance;
  }

  // ── Accessors ───────────────────────────────────────────────────────────

  getStatus(): WalletStatus {
    return this.status;
  }

  // ── Balance / subscription ──────────────────────────────────────────────

  /**
   * Current wallet balance (souls). Transitions the status
   * `idle → syncing → ready` (or `failed` on an unexpected backend error).
   */
  async getBalance(): Promise<number> {
    this.setStatus('syncing');
    try {
      const balance = await walletBackend.getBalance();
      this.setStatus('ready');
      return balance;
    } catch (e) {
      this.setStatus('failed');
      throw e;
    }
  }

  /**
   * Subscription/tier status for the current user (stub: tier `free`, balance
   * as `soulCreditsAvailable`). Same status transitions as `getBalance`.
   */
  async getSubscription(): Promise<SubscriptionStatus> {
    this.setStatus('syncing');
    try {
      const subscription = await walletBackend.getSubscription();
      this.setStatus('ready');
      return subscription;
    } catch (e) {
      this.setStatus('failed');
      throw e;
    }
  }

  // ── Internal debit (used by MarketplaceService.acquire) ─────────────────

  /**
   * Debit the wallet. INTERNAL — used by `MarketplaceService.acquire`; UI
   * should call `acquire` instead (it validates balance + throws the typed
   * `InsufficientCreditsError` when short).
   *
   * @throws {InsufficientCreditsError} 402 `quota_exceeded` when the balance
   *   is short. The wallet status returns to `ready` (business error, not a
   *   wallet failure).
   */
  async debit(amount: number): Promise<void> {
    this.setStatus('syncing');
    try {
      await walletBackend.debit(amount);
      this.setStatus('ready');
    } catch (e) {
      if (e instanceof InsufficientCreditsError) {
        // Business error — the wallet itself is healthy; stay usable.
        this.setStatus('ready');
        throw e;
      }
      this.setStatus('failed');
      throw e;
    }
  }

  // ── Internals ───────────────────────────────────────────────────────────

  private setStatus(status: WalletStatus): void {
    this.status = status;
    this.emit('status', status);
  }
}

// ── Singleton export ──────────────────────────────────────────────────────

export const walletService = WalletServiceClass.getInstance();
export default walletService;