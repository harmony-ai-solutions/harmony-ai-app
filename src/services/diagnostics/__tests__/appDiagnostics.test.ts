/**
 * appDiagnostics — unit tests.
 *
 * Covers the diagnostics header content (app version, contract version,
 * platform/OS, device model, uptime, entry count + time range), the report
 * renderer, the bounded error-copy selection, and the clipboard copy paths.
 */

import Clipboard from '@react-native-clipboard/clipboard';
import {
  APP_DIAGNOSTICS_ENTRY_LIMIT,
  buildAppDiagnosticsReport,
  buildErrorDiagnosticsText,
  collectAppDiagnosticsHeader,
  copyAppDiagnostics,
  copyAppDiagnosticsWithToast,
  copyAppLogEntries,
  formatAppLogEntry,
  formatUptime,
  renderAppDiagnostics,
  selectErrorDiagnosticsEntries,
  type AppDiagnosticsHeader,
} from '../appDiagnostics';
import { AppLogRingBuffer, type AppLogEntry } from '../../../utils/appLogs';
import { ENGINE_CONTRACT_VERSION } from '../../engine/engineContract';

function entry(over: Partial<AppLogEntry> = {}): AppLogEntry {
  return {
    id: over.id ?? 1,
    timestamp: over.timestamp ?? '2026-10-19T10:00:00.000Z',
    level: over.level ?? 'info',
    namespace: over.namespace ?? '[Svc]',
    message: over.message ?? 'hello',
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('app diagnostics header', () => {
  it('carries app version, contract, platform, device, uptime and range', () => {
    const header = collectAppDiagnosticsHeader(
      [entry({ timestamp: '2026-10-19T10:00:00.000Z' }), entry({ id: 2, timestamp: '2026-10-19T10:00:05.000Z' })],
      '2026-10-19T10:00:06.000Z',
    );
    expect(header.appVersion).toBe('1.0.0');
    expect(header.contractVersion).toBe(ENGINE_CONTRACT_VERSION);
    expect(header.platform).toBe('ios');
    expect(header.osVersion).toBe('17.0');
    expect(header.deviceModel).toBe('Test Model');
    expect(header.entryCount).toBe(2);
    expect(header.firstTimestamp).toBe('2026-10-19T10:00:00.000Z');
    expect(header.lastTimestamp).toBe('2026-10-19T10:00:05.000Z');
    expect(header.appUptimeMs).toBeGreaterThanOrEqual(0);
  });

  it('renders every header field plus the log dump', () => {
    const header: AppDiagnosticsHeader = {
      appVersion: '2.3.4',
      contractVersion: '1.6.0',
      platform: 'android',
      osVersion: '14',
      deviceModel: 'Pixel 8',
      appUptimeMs: 3_723_000,
      entryCount: 1,
      firstTimestamp: '2026-10-19T10:00:00.000Z',
      lastTimestamp: '2026-10-19T10:00:00.000Z',
      generatedAt: '2026-10-19T10:00:06.000Z',
    };
    const text = renderAppDiagnostics(header, [entry({ message: 'rendered-line' })]);
    expect(text).toContain('App version: 2.3.4');
    expect(text).toContain('Management contract: 1.6.0');
    expect(text).toContain('Platform: android 14');
    expect(text).toContain('Device: Pixel 8');
    expect(text).toContain('App uptime: 1h 02m 03s');
    expect(text).toContain('Entries: 1');
    expect(text).toContain('rendered-line');
  });

  it('formats uptime compactly', () => {
    expect(formatUptime(12_000)).toBe('12s');
    expect(formatUptime(65_000)).toBe('1m 05s');
    expect(formatUptime(3_723_000)).toBe('1h 02m 03s');
  });

  it('formats an entry line with namespace + level', () => {
    const line = formatAppLogEntry(entry({ level: 'warn', namespace: '[Chat]', message: 'careful' }));
    expect(line).toContain('[Chat]');
    expect(line).toContain('WARN');
    expect(line).toContain('careful');
  });
});

describe('error diagnostics selection + copy', () => {
  it('caps the error copy at the recent-entry limit', () => {
    const buffer = new AppLogRingBuffer();
    for (let i = 0; i < APP_DIAGNOSTICS_ENTRY_LIMIT + 40; i += 1) {
      buffer.push({ timestamp: `t${i}`, level: 'info', namespace: null, message: `m${i}` });
    }
    const selected = selectErrorDiagnosticsEntries(buffer);
    expect(selected.length).toBe(APP_DIAGNOSTICS_ENTRY_LIMIT);
    expect(selected[selected.length - 1].message).toBe(`m${APP_DIAGNOSTICS_ENTRY_LIMIT + 39}`);
  });

  it('copyAppDiagnostics writes the report to the clipboard', async () => {
    const ok = await copyAppDiagnostics();
    expect(ok).toBe(true);
    expect(Clipboard.setString).toHaveBeenCalledWith(expect.stringContaining('Soulbits App — diagnostics report'));
  });

  it('copyAppLogEntries copies an explicit list', async () => {
    const ok = await copyAppLogEntries([entry({ message: 'explicit' })]);
    expect(ok).toBe(true);
    expect(Clipboard.setString).toHaveBeenCalledWith(expect.stringContaining('explicit'));
  });

  it('buildErrorDiagnosticsText includes the header', () => {
    expect(buildErrorDiagnosticsText()).toContain('Soulbits App — diagnostics report');
  });

  it('reports the copy outcome through the notify callback', async () => {
    const notify = jest.fn();
    await copyAppDiagnosticsWithToast(notify, { success: 'ok', failure: 'nope' });
    expect(notify).toHaveBeenCalledWith('ok');
  });

  it('buildAppDiagnosticsReport is self-contained', () => {
    expect(buildAppDiagnosticsReport([entry()])).toContain('hello');
  });
});
