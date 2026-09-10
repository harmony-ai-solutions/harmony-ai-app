/**
 * WalletService + walletStubBackend tests.
 *
 * Covers:
 *   - status transitions: idle → syncing → ready (and EventEmitter delivery)
 *   - seeded balance (50 souls) + getSubscription tier shape
 *   - debit: success, InsufficientCreditsError (402 quota_exceeded with
 *     soulCreditsAvailable), invalid amounts
 *   - EventEmitter subscription + cleanup (listenerCount / off)
 *
 * Mocks `src/services/stub/stubBackendUtils` so latency is instant and
 * controllable (deviceAuth.test.ts pattern). The wallet backend is a
 * module-level singleton — `__resetForTests()` runs in beforeEach for order
 * independence.
 */

// Mock the logger so it doesn't emit after tests finish.
jest.mock('../../../utils/logger', () => ({
  createLogger: () => ({
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

// Mock the stub backend utils: instant latency by default, with a
// controllable one-shot for the status-transition test.
jest.mock('../../stub/stubBackendUtils', () => {
  const simulateLatency = jest.fn(async () => {});
  const simulateTransientFailure = jest.fn(() => false);
  return {
    simulateLatency,
    simulateTransientFailure,
    __simulateLatency: simulateLatency,
    __simulateTransientFailure: simulateTransientFailure,
  };
});

import * as StubBackendUtils from '../../stub/stubBackendUtils';
import { walletService } from '../WalletService';
import * as WalletBackend from '../walletStubBackend';
import { InsufficientCreditsError, WalletError } from '../../stub/StubServiceError';

const mockSimulateLatency = (StubBackendUtils as any).__simulateLatency as jest.Mock;
const mockSimulateTransientFailure = (StubBackendUtils as any)
  .__simulateTransientFailure as jest.Mock;

beforeEach(() => {
  WalletBackend.__resetForTests();
  mockSimulateLatency.mockReset();
  mockSimulateLatency.mockImplementation(async () => {});
  mockSimulateTransientFailure.mockReset();
  mockSimulateTransientFailure.mockReturnValue(false);
});

describe('WalletService — status transitions', () => {
  it('starts idle', () => {
    expect(walletService.getStatus()).toBe('idle');
  });

  it('transitions idle → syncing → ready during getBalance', async () => {
    let release: () => void = () => {};
    mockSimulateLatency.mockImplementationOnce(
      () =>
        new Promise<void>(resolve => {
          release = resolve;
        }),
    );

    const statuses: string[] = [];
    const onStatus = (s: string) => statuses.push(s);
    walletService.on('status', onStatus);

    const pending = walletService.getBalance();
    expect(walletService.getStatus()).toBe('syncing');

    release();
    await pending;

    expect(walletService.getStatus()).toBe('ready');
    expect(statuses).toEqual(['syncing', 'ready']);
    walletService.off('status', onStatus);
  });
});

describe('WalletService — balance & subscription', () => {
  it('seeded balance is 50 souls', async () => {
    expect(await walletService.getBalance()).toBe(50);
  });

  it('getSubscription mirrors the wallet balance and tier (wire shape)', async () => {
    const subscription = await walletService.getSubscription();
    expect(subscription).toMatchObject({
      tier: 'free',
      soulCreditsAvailable: 50,
      currentTier: 'free',
    });
  });
});

describe('WalletService — debit (internal, used by MarketplaceService.acquire)', () => {
  it('debits the balance on success', async () => {
    await walletService.debit(30);
    expect(await walletService.getBalance()).toBe(20);
  });

  it('a zero-amount debit is a no-op (free acquisitions)', async () => {
    await walletService.debit(0);
    expect(await walletService.getBalance()).toBe(50);
  });

  it('throws InsufficientCreditsError when the balance is short, leaving it untouched', async () => {
    let err: unknown;
    try {
      await walletService.debit(100);
    } catch (e) {
      err = e;
    }

    expect(err).toBeInstanceOf(InsufficientCreditsError);
    const quotaErr = err as InsufficientCreditsError;
    expect(quotaErr.status).toBe(402);
    expect(quotaErr.code).toBe('quota_exceeded');
    expect(quotaErr.soulCreditsAvailable).toBe(50);
    expect(quotaErr.isQuotaError).toBe(true);

    // Balance unchanged — the error is a business error, not a wallet failure.
    expect(await walletService.getBalance()).toBe(50);
    expect(walletService.getStatus()).toBe('ready');
  });

  it('rejects negative / non-finite amounts with WalletError 400', async () => {
    await expect(walletService.debit(-5)).rejects.toBeInstanceOf(WalletError);
    await expect(walletService.debit(-5)).rejects.toMatchObject({ status: 400 });
    await expect(walletService.debit(Number.NaN)).rejects.toMatchObject({ status: 400 });
    expect(await walletService.getBalance()).toBe(50);
  });
});

describe('WalletService — EventEmitter subscription & cleanup', () => {
  it('delivers status events to subscribers and stops after off()', async () => {
    const cb = jest.fn();
    walletService.on('status', cb);
    expect(walletService.listenerCount('status')).toBe(1);

    await walletService.getBalance();
    expect(cb).toHaveBeenCalledWith('syncing');
    expect(cb).toHaveBeenCalledWith('ready');

    walletService.off('status', cb);
    expect(walletService.listenerCount('status')).toBe(0);

    const callsAfterOff = cb.mock.calls.length;
    await walletService.getBalance();
    expect(cb.mock.calls.length).toBe(callsAfterOff);
  });

  it('supports removeListener as the cleanup alias', () => {
    const cb = jest.fn();
    walletService.on('status', cb);
    expect(walletService.listenerCount('status')).toBe(1);
    walletService.removeListener('status', cb);
    expect(walletService.listenerCount('status')).toBe(0);
  });
});