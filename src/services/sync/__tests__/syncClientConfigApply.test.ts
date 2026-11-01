/**
 * SyncClientConfigApply — the 2026-11 desktop-sync engine-log fixes.
 *
 * The engine treats every `PUT /api/sync/client` as a config change and
 * restarts the sync client, so this suite pins the three rules:
 *   1. a refresh with an unchanged active config sends NO PUT;
 *   2. a real diff sends exactly ONE PUT, and the payload matches the engine's
 *      `ValidateConfig` contract (the payloads that used to 400 are either
 *      rejected locally — never sent — or now assembled valid);
 *   3. no authority-flavoured field can ever reach the wire on the phone path.
 */

import { engineApiClient } from '../../engine/EngineApiClient';
import {
  CLIENT_ROLE_FORBIDDEN_FIELDS,
  applySyncClientConfig,
  needsSyncClientRepair,
  reconcileSyncClientConfig,
  sanitizeClientPatch,
  validateMergedClientConfig,
} from '../syncClientConfigApply';
import type { SyncClientStatusDto } from '../../engine/EngineApiClient';

jest.mock('../../engine/EngineApiClient', () => ({
  engineApiClient: { getSyncClientStatus: jest.fn(), updateSyncClientConfig: jest.fn() },
}));

// A STABLE logger (createLogger runs at module load; the instance is read back).
jest.mock('../../../utils/logger', () => {
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  return { createLogger: () => logger, __mockLogger: logger };
});
const mockLog = jest.requireMock('../../../utils/logger').__mockLogger as {
  info: jest.Mock;
  warn: jest.Mock;
  error: jest.Mock;
  debug: jest.Mock;
};

const mockStatus = engineApiClient.getSyncClientStatus as jest.Mock;
const mockUpdate = engineApiClient.updateSyncClientConfig as jest.Mock;

/** The engine's persisted config block (a paired LAN phone by default). */
function status(over: Record<string, unknown> = {}): SyncClientStatusDto {
  return {
    enabled: true,
    state: 'syncing',
    last_error: null,
    local_authoritative: false,
    baseline_path: null,
    dataset_id: 'ds-1',
    pending_writes: 0,
    sync_group: 'uninitialized',
    rotation_required: false,
    cognition_authority: null,
    narration_paused: false,
    relay: null,
    awaiting_group_key: false,
    config: {
      enabled: true,
      transport: 'lan',
      peer_address: '192.168.1.10:28080',
      peer_wss_address: '',
      security_mode: 'secure',
      relay_url: '',
      relay_token: 'PASETO',
      device_id: '',
      dataset_id: '',
      group_join_pending: false,
      device_name: 'Pixel',
      device_type: 'embedded_engine',
      device_platform: 'android',
    },
    ...over,
  } as unknown as SyncClientStatusDto;
}

/** A paired cloud-relay phone. */
function cloudStatus(over: Record<string, unknown> = {}): SyncClientStatusDto {
  return status({
    config: {
      ...status().config,
      transport: 'relay',
      peer_address: '',
      relay_url: 'wss://sync.soulbits.app/v1/sync/ws',
    },
    ...over,
  });
}

/** The exact POST-merge config the engine will validate (its own view). */
function merged(statusArg: SyncClientStatusDto, body: Record<string, unknown>) {
  return { ...statusArg.config, ...body };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStatus.mockResolvedValue(status());
  mockUpdate.mockImplementation(async () => status());
});

// ── Rule 1: no no-op PUTs ───────────────────────────────────────────────

describe('refresh with an unchanged active config', () => {
  it('sends NO PUT for a paired LAN phone', async () => {
    mockStatus.mockResolvedValue(status());
    const result = await reconcileSyncClientConfig({
      enabled: true,
      transport: 'lan',
      peer_address: '192.168.1.10:28080',
      peer_wss_address: '',
      security_mode: 'secure',
      device_name: 'Pixel',
    });
    expect(result.action).toBe('unchanged');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('sends NO PUT for a cloud-relay phone', async () => {
    const active = cloudStatus();
    mockStatus.mockResolvedValue(active);
    const result = await reconcileSyncClientConfig({
      enabled: true,
      transport: 'relay',
      relay_url: 'wss://sync.soulbits.app/v1/sync/ws',
    });
    expect(result.action).toBe('unchanged');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('ignores cosmetic/identity fields on a refresh (no restart churn)', async () => {
    // The screen defaults the device name from DeviceInfo, so it legitimately
    // differs from what the engine stored — a refresh must not PUT for that.
    const active = status();
    mockStatus.mockResolvedValue(active);
    const result = await reconcileSyncClientConfig({
      enabled: true,
      transport: 'lan',
      peer_address: '192.168.1.10:28080',
      device_name: 'Something else entirely',
      device_id: 'device-abc',
      dataset_id: 'ds-1',
    });
    expect(result.action).toBe('unchanged');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('never repairs a stuck-but-enabled client on a refresh', async () => {
    const stuck = status({ state: 'stopped' });
    mockStatus.mockResolvedValue(stuck);
    const result = await reconcileSyncClientConfig({
      enabled: true,
      transport: 'lan',
      peer_address: '192.168.1.10:28080',
      security_mode: 'secure',
    });
    expect(result.action).toBe('unchanged');
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe('a real diff', () => {
  it('PUTs exactly once, and only the changed connectivity field', async () => {
    const active = cloudStatus();
    mockStatus.mockResolvedValue(active);
    mockUpdate.mockResolvedValue(cloudStatus({ config: { ...active.config, relay_url: 'wss://new.relay/v1/sync/ws' } }));

    const result = await reconcileSyncClientConfig({
      enabled: true,
      transport: 'relay',
      relay_url: 'wss://new.relay/v1/sync/ws',
      device_name: 'Something else entirely',
    });

    expect(result.action).toBe('applied');
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    // The refresh never carries the cosmetic device name.
    expect(mockUpdate).toHaveBeenCalledWith({ relay_url: 'wss://new.relay/v1/sync/ws' });
  });

  it('PUTs once when the user switches transport (apply mode)', async () => {
    const active = status();
    mockStatus.mockResolvedValue(active);
    mockUpdate.mockResolvedValue(cloudStatus());

    const result = await applySyncClientConfig({
      enabled: true,
      transport: 'relay',
      relay_url: 'wss://sync.soulbits.app/v1/sync/ws',
      peer_address: '',
      peer_wss_address: '',
    });

    expect(result.action).toBe('applied');
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith({
      transport: 'relay',
      relay_url: 'wss://sync.soulbits.app/v1/sync/ws',
      peer_address: '',
    });
  });

  it('repairs a client the engine reports as stuck `stopped` — only on an explicit apply', async () => {
    const stuck = status({ state: 'stopped' });
    mockStatus.mockResolvedValue(stuck);

    expect(needsSyncClientRepair(stuck)).toBe(true);
    const result = await applySyncClientConfig({
      enabled: true,
      transport: 'lan',
      peer_address: '192.168.1.10:28080',
      security_mode: 'secure',
    });

    expect(result.action).toBe('applied');
    expect(result.action === 'applied' && result.repair).toBe(true);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });

  it('does NOT repair while awaiting the sync-group key (a truthful wait, not a stuck client)', async () => {
    const waiting = cloudStatus({ state: 'stopped', awaiting_group_key: true });
    mockStatus.mockResolvedValue(waiting);
    const result = await applySyncClientConfig({
      enabled: true,
      transport: 'relay',
      relay_url: waiting.config.relay_url,
    });
    expect(result.action).toBe('unchanged');
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

// ── Rule 2: one valid PUT (the payloads that used to 400) ───────────────

describe('toggle-on assembles ONE payload the engine accepts', () => {
  it('rejects enabling LAN with no desktop address locally — no 400 is ever sent', async () => {
    // The exact payload that produced the two HTTP 400s at 18:56:36Z:
    // `enabled:true` over `transport:lan` with an empty `peer_address`.
    const unpaired = status({
      enabled: false,
      config: { ...status().config, enabled: false, peer_address: '', device_name: 'Pixel 8' },
    });
    mockStatus.mockResolvedValue(unpaired);

    const result = await applySyncClientConfig({
      enabled: true,
      transport: 'lan',
      peer_address: '',
      peer_wss_address: '',
      security_mode: 'secure',
      device_name: 'Pixel 8',
    });

    expect(result.action).toBe('invalid');
    expect(result.action === 'invalid' && result.problem.code).toBe('peer_address_required');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('rejects a malformed desktop address locally (host:port is the engine rule)', async () => {
    const unpaired = status({
      enabled: false,
      config: { ...status().config, enabled: false, peer_address: '' },
    });
    mockStatus.mockResolvedValue(unpaired);
    const result = await applySyncClientConfig({
      enabled: true,
      transport: 'lan',
      peer_address: '192.168.1.10',
      security_mode: 'secure',
    });
    expect(result.action).toBe('invalid');
    expect(result.action === 'invalid' && result.problem.code).toBe('invalid_host_port');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('rejects enabling the relay with no relay URL locally', async () => {
    mockStatus.mockResolvedValue(status({ enabled: false, config: { ...status().config, enabled: false } }));
    const result = await applySyncClientConfig({ enabled: true, transport: 'relay', relay_url: '' });
    expect(result.action).toBe('invalid');
    expect(result.action === 'invalid' && result.problem.code).toBe('relay_url_required');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('toggling on a PAIRED phone sends exactly one PUT that passes the engine contract', async () => {
    const unpaired = status({
      enabled: false,
      config: { ...status().config, enabled: false, peer_address: '' },
    });
    mockStatus.mockResolvedValue(unpaired);
    mockUpdate.mockResolvedValue(status());

    const result = await applySyncClientConfig({
      enabled: true,
      transport: 'lan',
      peer_address: '192.168.1.10:28080',
      peer_wss_address: '',
      security_mode: 'secure',
      device_name: 'Pixel 8',
    });

    expect(result.action).toBe('applied');
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const body = mockUpdate.mock.calls[0][0];
    // The engine validates the MERGED block; that block must be valid…
    expect(validateMergedClientConfig(merged(unpaired, body))).toBeNull();
    // …and the payload must not carry the empty/no-op keys the old form sent.
    expect(body).toEqual({ enabled: true, peer_address: '192.168.1.10:28080', device_name: 'Pixel 8' });
  });

  it('pairing always PUTs (the transient secrets are never diffed away)', async () => {
    const active = cloudStatus();
    mockStatus.mockResolvedValue(active);
    const result = await applySyncClientConfig({
      transport: 'relay',
      relay_url: active.config.relay_url,
      pairing_token: 'tok-once',
    });
    expect(result.action).toBe('applied');
    expect(mockUpdate).toHaveBeenCalledWith({ pairing_token: 'tok-once' });
  });

  it('surfaces an engine rejection without retrying (no double PUT)', async () => {
    mockStatus.mockResolvedValue(status({ config: { ...status().config, relay_url: '' } }));
    mockUpdate.mockRejectedValue(new Error('invalid relay_url'));
    const result = await applySyncClientConfig({
      transport: 'relay',
      relay_url: 'wss://x.test/v1/sync/ws',
    });
    expect(result.action).toBe('failed');
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });

  it('reports an unreadable status instead of PUTting blind', async () => {
    mockStatus.mockRejectedValue(new Error('engine down'));
    const result = await applySyncClientConfig({ enabled: true, transport: 'lan', peer_address: '1.2.3.4:80' });
    expect(result.action).toBe('unavailable');
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

// ── Rule 3: client-role hygiene ─────────────────────────────────────────

describe('no authority fields on the phone path', () => {
  it('strips every authority-flavoured field before the PUT', async () => {
    const active = cloudStatus();
    mockStatus.mockResolvedValue(active);

    const intent = {
      enabled: true,
      transport: 'relay' as const,
      relay_url: 'wss://new.relay/v1/sync/ws',
      // A loose/legacy call site trying to make the engine take authority.
      role: 'authority',
      authority: true,
      authority_bridge: true,
      claim_authority: true,
    };
    await applySyncClientConfig(intent as any);

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const body = mockUpdate.mock.calls[0][0];
    for (const field of CLIENT_ROLE_FORBIDDEN_FIELDS) {
      expect(body).not.toHaveProperty(field);
    }
    expect(body).toEqual({ relay_url: 'wss://new.relay/v1/sync/ws' });
    // The drop is loud, never silent.
    expect(mockLog.warn.mock.calls.some(c => String(c[0]).includes('authority-flavoured field'))).toBe(true);
  });

  it('sanitizeClientPatch is the single choke point (and is idempotent)', () => {
    const clean = sanitizeClientPatch({ enabled: true, role: 'authority', peer_address: '1.2.3.4:80' });
    expect(clean).toEqual({ enabled: true, peer_address: '1.2.3.4:80' });
    expect(sanitizeClientPatch(clean as Record<string, unknown>)).toEqual(clean);
  });
});

// ── The contract mirror itself ──────────────────────────────────────────

describe('validateMergedClientConfig mirrors the engine', () => {
  it('accepts the empty transport/mode defaults (engine: lan + unencrypted)', () => {
    expect(validateMergedClientConfig({ transport: '' as never, security_mode: '' })).toBeNull();
  });

  it('rejects an unknown transport or security mode', () => {
    expect(validateMergedClientConfig({ transport: 'carrier-pigeon' as any })?.code).toBe('invalid_transport');
    expect(validateMergedClientConfig({ security_mode: 'plain' })?.code).toBe('invalid_security_mode');
  });

  it('requires the endpoint for the selected transport only when enabled', () => {
    expect(validateMergedClientConfig({ transport: 'lan', enabled: true })?.code).toBe('peer_address_required');
    expect(validateMergedClientConfig({ transport: 'relay', enabled: true })?.code).toBe('relay_url_required');
    // Disabled → no endpoint required (the disable path must stay valid).
    expect(validateMergedClientConfig({ transport: 'relay', enabled: false })).toBeNull();
  });

  it('accepts ws(s) URLs and bare host:port relay endpoints, rejects other schemes', () => {
    expect(validateMergedClientConfig({ relay_url: 'wss://sync.soulbits.app/v1/sync/ws' })).toBeNull();
    expect(validateMergedClientConfig({ relay_url: 'sync.test:443' })).toBeNull();
    expect(validateMergedClientConfig({ relay_url: 'https://sync.soulbits.app' })?.code).toBe('invalid_relay_url');
  });

  it('accepts bracketed IPv6 host:port peer addresses', () => {
    expect(validateMergedClientConfig({ peer_address: '[::1]:28080' })).toBeNull();
    expect(validateMergedClientConfig({ peer_address: '[::1]' })?.code).toBe('invalid_host_port');
  });

  it('rejects an out-of-range port', () => {
    expect(validateMergedClientConfig({ peer_address: '1.2.3.4:0' })?.code).toBe('invalid_host_port');
    expect(validateMergedClientConfig({ peer_address: '1.2.3.4:70000' })?.code).toBe('invalid_host_port');
  });

  it('mirrors the TOFU pin rule (64 hex digits, sha256:/colon spelling tolerated)', () => {
    const pin = 'sha256:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89';
    expect(validateMergedClientConfig({ peer_fingerprint: pin })).toBeNull();
    expect(validateMergedClientConfig({ peer_fingerprint: 'sha256:AB:CD' })?.code).toBe(
      'invalid_fingerprint',
    );
    expect(validateMergedClientConfig({ peer_fingerprint: 'ZZ'.repeat(32) })?.code).toBe(
      'invalid_fingerprint',
    );
  });
});
