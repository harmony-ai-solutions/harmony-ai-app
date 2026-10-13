/**
 * buildDiagnosticsReport — unit tests (plan 7-11).
 *
 * Pure report builder: header block + desktop-shaped log dump + filename.
 */

import {
  buildDiagnosticsReport,
  diagnosticsFileName,
  formatLogEntry,
  LOG_DUMP_MARKER,
  type DiagnosticsHeader,
} from '../buildDiagnosticsReport';
import type { EngineLogEntryDto } from '../../engine/EngineApiClient';

const header: DiagnosticsHeader = {
  appVersion: '1.4.0',
  engineVersion: '0.3.0-dev',
  contractVersion: '1.3.0',
  platform: 'ios',
  osVersion: '17.4',
  deviceModel: 'iPhone15,2',
  generatedAt: '2026-10-13T12:00:00.000Z',
};

const entry: EngineLogEntryDto = {
  id: 42,
  timestamp: '2026-10-13T11:59:00Z',
  level: 'info',
  component: 'chat',
  entityId: 'ent-1',
  subSystem: '',
  message: 'composed reply',
  data: { latency: '12ms' },
  isPrompt: false,
};

describe('formatLogEntry', () => {
  it('renders the desktop-viewer line shape', () => {
    expect(formatLogEntry(entry)).toBe(
      '[2026-10-13T11:59:00Z] INFO  chat ent-1 — composed reply {"latency":"12ms"}',
    );
  });

  it('marks prompt entries with their type', () => {
    const line = formatLogEntry({ ...entry, isPrompt: true, promptType: 'system', data: undefined });
    expect(line).toContain('[prompt:system]');
    expect(line).not.toContain('{');
  });

  it('omits the entity when absent', () => {
    const line = formatLogEntry({ ...entry, entityId: '', data: undefined });
    expect(line).toBe('[2026-10-13T11:59:00Z] INFO  chat — composed reply');
  });
});

describe('buildDiagnosticsReport', () => {
  it('includes the full diagnostics header', () => {
    const report = buildDiagnosticsReport({ header, entries: [entry], scope: 'filtered' });
    expect(report).toContain('Soulbits Engine — diagnostics report');
    expect(report).toContain('Generated: 2026-10-13T12:00:00.000Z');
    expect(report).toContain('App version: 1.4.0');
    expect(report).toContain('Soulbits Engine: 0.3.0-dev');
    expect(report).toContain('Management contract: 1.3.0');
    expect(report).toContain('Platform: ios 17.4');
    expect(report).toContain('Device: iPhone15,2');
    expect(report).toContain(LOG_DUMP_MARKER);
    expect(report).toContain('[2026-10-13T11:59:00Z] INFO  chat ent-1 — composed reply');
  });

  it('labels the scope and appends the filter summary when filtered', () => {
    const report = buildDiagnosticsReport({
      header,
      entries: [entry],
      scope: 'filtered',
      filterSummary: 'level=info, component=chat',
    });
    expect(report).toContain('Scope: current filter (1 entry) — level=info, component=chat');
  });

  it('labels the full-buffer scope and pluralizes counts', () => {
    const report = buildDiagnosticsReport({ header, entries: [entry, entry], scope: 'full' });
    expect(report).toContain('Scope: full buffer (2 entries)');
  });

  it('defaults the generatedAt to now when omitted', () => {
    const report = buildDiagnosticsReport({
      header: { ...header, generatedAt: undefined },
      entries: [],
      scope: 'full',
    });
    expect(report).toMatch(/Generated: \d{4}-\d{2}-\d{2}T/);
  });
});

describe('diagnosticsFileName', () => {
  it('builds a filesystem-safe stamped name', () => {
    expect(diagnosticsFileName('2026-10-13T12:00:00.000Z')).toBe(
      'soulbits-diagnostics-2026-10-13T12-00-00-000Z.txt',
    );
  });
});
