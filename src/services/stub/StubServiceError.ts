/**
 * StubServiceError — shared app-local error base for the in-memory stub
 * service layer (marketplace / wallet / social / notifications).
 *
 * Generalizes the observable surface of `APIError` from
 * `@harmony-ai-solutions/soulbits-api-client` (verified against its
 * `dist/index.d.ts`, lines 5372–5389) so UI code can branch on the same
 * `status` / `code` / quota getters whether the backing implementation is
 * this stub or the future real backend. The UI never imports the client's
 * `APIError` directly — it catches these app-local errors instead (the swap
 * seam stays app-owned).
 *
 * Wire-shape parity (binding, A1 directive):
 *   - 402 `quota_exceeded`  → `upgradeUrl` + `soulCreditsAvailable` present
 *   - 504 `gateway_timeout` → `taskId` present
 *   - `isAuthError`   → status 401 | 403
 *   - `isQuotaError`  → status 402
 *   - `isRateLimited` → status 429
 *   - `isServerError` → status >= 500
 *
 * Domain subclasses (`MarketplaceError`, `WalletError`, `SocialError`,
 * `NotificationError`) give the UI a typed catch surface per domain while
 * sharing the single status/code taxonomy.
 */

/** Optional structured fields carried on a stub error (mirrors APIError). */
export interface StubServiceErrorOptions {
  /** Machine-readable backend error code (e.g. 'not_found', 'quota_exceeded'). */
  code?: string;
  /** Present on 402 quota_exceeded — where the user can buy more credits. */
  upgradeUrl?: string;
  currentTier?: string;
  requiredTier?: string;
  /** Present on 402 quota_exceeded — remaining wallet balance. */
  soulCreditsAvailable?: number;
  /** Present on 504 gateway_timeout — id of the async gateway task. */
  taskId?: string;
}

/**
 * Placeholder upgrade destination for 402 quota_exceeded errors. The future
 * backend owns the canonical "buy soul credits" URL (Phase 9); until then the
 * UI's existing "Buy/Sell Souls" coming-soon placeholder remains the honest
 * surface — this constant only pre-matches the wire shape.
 */
const CREDITS_UPGRADE_URL = 'https://harmony.ai/souls';

export class StubServiceError extends Error {
  /** HTTP-like status of the stub operation. */
  readonly status: number;
  /** Machine-readable error code, when present (e.g. 'quota_exceeded'). */
  readonly code?: string;
  /** Present on 402 quota_exceeded — upgrade destination. */
  readonly upgradeUrl?: string;
  readonly currentTier?: string;
  readonly requiredTier?: string;
  /** Present on 402 quota_exceeded — remaining wallet balance. */
  readonly soulCreditsAvailable?: number;
  /** Present on 504 gateway_timeout — async gateway task id. */
  readonly taskId?: string;

  constructor(status: number, message: string, opts: StubServiceErrorOptions = {}) {
    super(message);
    this.name = 'StubServiceError';
    this.status = status;
    this.code = opts.code;
    this.upgradeUrl = opts.upgradeUrl;
    this.currentTier = opts.currentTier;
    this.requiredTier = opts.requiredTier;
    this.soulCreditsAvailable = opts.soulCreditsAvailable;
    this.taskId = opts.taskId;
  }

  /** True for 401 Unauthorized / 403 Forbidden responses. */
  get isAuthError(): boolean {
    return this.status === 401 || this.status === 403;
  }

  /** True for 402 Payment Required (quota exhausted / insufficient credits). */
  get isQuotaError(): boolean {
    return this.status === 402;
  }

  /** True for 429 Too Many Requests. */
  get isRateLimited(): boolean {
    return this.status === 429;
  }

  /** True for any 5xx server error. */
  get isServerError(): boolean {
    return this.status >= 500;
  }
}

/** Marketplace-domain errors (listing lookup, publish, delist, acquire). */
export class MarketplaceError extends StubServiceError {
  constructor(status: number, message: string, opts: StubServiceErrorOptions = {}) {
    super(status, message, opts);
    this.name = 'MarketplaceError';
  }
}

/** Wallet-domain errors (debit validation). */
export class WalletError extends StubServiceError {
  constructor(status: number, message: string, opts: StubServiceErrorOptions = {}) {
    super(status, message, opts);
    this.name = 'WalletError';
  }
}

/** Social-domain errors (profiles, posts, follows, blocks). */
export class SocialError extends StubServiceError {
  constructor(status: number, message: string, opts: StubServiceErrorOptions = {}) {
    super(status, message, opts);
    this.name = 'SocialError';
  }
}

/** Notification-domain errors. */
export class NotificationError extends StubServiceError {
  constructor(status: number, message: string, opts: StubServiceErrorOptions = {}) {
    super(status, message, opts);
    this.name = 'NotificationError';
  }
}

/**
 * Thrown when a wallet debit would take the balance negative — i.e.
 * `MarketplaceService.acquire` on a listing priced above the current balance.
 *
 * Per the phase-1 wire contract this is a MarketplaceError (status 402, code
 * `'quota_exceeded'`, with the remaining `soulCreditsAvailable`) so the UI
 * can present the buy-souls upgrade path using the shared quota getters.
 */
export class InsufficientCreditsError extends MarketplaceError {
  constructor(soulCreditsAvailable: number, message?: string) {
    super(
      402,
      message ?? `insufficient soul credits (${soulCreditsAvailable} available)`,
      {
        code: 'quota_exceeded',
        soulCreditsAvailable,
        upgradeUrl: CREDITS_UPGRADE_URL,
      },
    );
    this.name = 'InsufficientCreditsError';
  }
}