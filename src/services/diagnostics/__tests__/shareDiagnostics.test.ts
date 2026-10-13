/**
 * shareDiagnostics — unit tests (plan 7-11).
 *
 * The share wiring is exercised with the global native mocks
 * (`react-native-fs` / `react-native-share` / `react-native-device-info`) plus
 * stubbed engine-version sources.
 */

jest.mock('../../../utils/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

jest.mock('../../engine/EngineApiClient', () => ({
  engineApiClient: {
    engineAppVersion: jest.fn(() => Promise.resolve({ appVersion: 'v0.3.0-dev' })),
  },
}));

jest.mock('../../engine/EngineService', () => ({
  getEngineVersionState: jest.fn(() => ({ engineVersion: 'cached-1.0.0', contract: 'ok' })),
}));

import RNFS from 'react-native-fs';
import Share from 'react-native-share';
import { engineApiClient } from '../../engine/EngineApiClient';
import { getEngineVersionState } from '../../engine/EngineService';
import {
  collectDiagnosticsHeader,
  resolveEngineVersion,
  shareDiagnosticsReport,
} from '../shareDiagnostics';
import type { EngineLogEntryDto } from '../../engine/EngineApiClient';

const entry: EngineLogEntryDto = {
  id: 1,
  timestamp: '2026-10-13T11:59:00Z',
  level: 'info',
  component: 'chat',
  entityId: 'ent-1',
  message: 'hi',
  isPrompt: false,
};

describe('shareDiagnostics', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (engineApiClient.engineAppVersion as jest.Mock).mockResolvedValue({ appVersion: 'v0.3.0-dev' });
    (getEngineVersionState as jest.Mock).mockReturnValue({ engineVersion: 'cached-1.0.0', contract: 'ok' });
  });

  it('resolves the live engine version and normalizes it', async () => {
    expect(await resolveEngineVersion()).toBe('0.3.0-dev');
  });

  it('falls back to the cached canary state when the probe fails', async () => {
    (engineApiClient.engineAppVersion as jest.Mock).mockRejectedValue(new Error('down'));
    expect(await resolveEngineVersion()).toBe('cached-1.0.0');
  });

  it('collects a header from the device + engine', async () => {
    const header = await collectDiagnosticsHeader('2026-10-13T12:00:00.000Z');
    expect(header.engineVersion).toBe('0.3.0-dev');
    expect(header.contractVersion).toBe('1.4.0');
    expect(header.generatedAt).toBe('2026-10-13T12:00:00.000Z');
    expect(typeof header.platform).toBe('string');
  });

  it('writes the report to the cache dir and opens the share sheet', async () => {
    const path = await shareDiagnosticsReport({ entries: [entry], scope: 'filtered', filterSummary: 'none' });
    expect(path.startsWith('/mock/caches/')).toBe(true);
    expect(RNFS.writeFile).toHaveBeenCalledWith(
      expect.stringContaining('/mock/caches/soulbits-diagnostics-'),
      expect.stringContaining('Soulbits Engine — diagnostics report'),
      'utf8',
    );
    expect(Share.open).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'text/plain', failOnCancel: false }),
    );
  });
});
