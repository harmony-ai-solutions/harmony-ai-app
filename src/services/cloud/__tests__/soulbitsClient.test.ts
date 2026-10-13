/**
 * soulbitsClient — subscription / tier-policy additions (task 2-5).
 */

import { createClient } from '@harmony-ai-solutions/soulbits-api-client';
import { buildSoulbitsClient, fetchAutonomyBeatsPerDay, fetchMySubscription } from '../soulbitsClient';

jest.mock('@harmony-ai-solutions/soulbits-api-client', () => ({
  createClient: jest.fn(),
}));

const mockedCreateClient = createClient as jest.Mock;

function clientWithSubscription(sub: unknown) {
  return {
    subscription: { getMySubscriptionOrThrow: jest.fn().mockResolvedValue(sub) },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('buildSoulbitsClient', () => {
  it('constructs a PASETO-only client (no refreshToken)', () => {
    mockedCreateClient.mockReturnValue({});
    buildSoulbitsClient({ paseto: 'v4.local.x' });
    const opts = mockedCreateClient.mock.calls[0][0];
    expect(opts.paseto).toBe('v4.local.x');
    expect(opts.refreshToken).toBeUndefined();
    expect(opts.cloudURL).toBeTruthy();
  });
});

describe('fetchMySubscription', () => {
  it('maps the response into a snapshot', async () => {
    mockedCreateClient.mockReturnValue(
      clientWithSubscription({
        tier_id: 'core',
        display_name: 'Core',
        status: 'active',
        expires_at: null,
        limits: { autonomy_beats_per_day: 40, chat_requests_per_day: 1000 },
        features: { foo: true },
      }),
    );

    const snap = await fetchMySubscription('v4.local.x');
    expect(snap.tierId).toBe('core');
    expect(snap.displayName).toBe('Core');
    expect(snap.status).toBe('active');
    expect(snap.expiresAt).toBeNull();
    expect(snap.limits.autonomy_beats_per_day).toBe(40);
    expect(snap.features).toEqual({ foo: true });
  });
});

describe('fetchAutonomyBeatsPerDay', () => {
  it('returns the numeric beat budget', async () => {
    mockedCreateClient.mockReturnValue(
      clientWithSubscription({ tier_id: 'free', display_name: 'Free', status: 'active', expires_at: null, limits: { autonomy_beats_per_day: 5 }, features: {} }),
    );
    await expect(fetchAutonomyBeatsPerDay('v4.local.x')).resolves.toBe(5);
  });

  it('returns null when the tier does not define one', async () => {
    mockedCreateClient.mockReturnValue(
      clientWithSubscription({ tier_id: 'free', display_name: 'Free', status: 'active', expires_at: null, limits: {}, features: {} }),
    );
    await expect(fetchAutonomyBeatsPerDay('v4.local.x')).resolves.toBeNull();
  });

  it('returns null for a non-numeric value', async () => {
    mockedCreateClient.mockReturnValue(
      clientWithSubscription({ tier_id: 'free', display_name: 'Free', status: 'active', expires_at: null, limits: { autonomy_beats_per_day: 'unlimited' }, features: {} }),
    );
    await expect(fetchAutonomyBeatsPerDay('v4.local.x')).resolves.toBeNull();
  });
});
