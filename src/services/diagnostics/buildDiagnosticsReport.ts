/**
 * buildDiagnosticsReport — the pure builder for the "Share diagnostics" export
 * (plan 7-11).
 *
 * Assembles a plain-text report: a header block (app version, running engine
 * version, management-contract version, platform/OS, device model, generation
 * time) followed by a log dump. The entry format mirrors the desktop Dev-Tools
 * log viewer's shape (`[timestamp] LEVEL component entity — message {data}`).
 *
 * Pure: every environmental value is injected, so it runs in the fast `unit`
 * jest project with no native modules. The share-sheet wiring lives in
 * `shareDiagnostics.ts`.
 *
 * Privacy: prompt-type entries contain conversation text. The dump is the
 * user's own data and sharing is an explicit OS-sheet action; nothing is ever
 * uploaded automatically (the cloud stays data-blind).
 */

import type { EngineLogEntryDto } from '../engine/EngineApiClient';

/** The report header fields (injected by the caller). */
export interface DiagnosticsHeader {
  appVersion: string;
  /** Running engine version (normalized), or `unknown`. */
  engineVersion: string;
  /** The management-contract version the app is pinned to. */
  contractVersion: string;
  /** `ios` | `android` | other (the `Platform.OS` value). */
  platform: string;
  /** OS version string (e.g. `17.4`). */
  osVersion: string;
  /** Device model (e.g. `iPhone15,2`). */
  deviceModel: string;
  /** RFC3339 generation time; defaults to now. */
  generatedAt?: string;
}

/** Options for {@link buildDiagnosticsReport}. */
export interface DiagnosticsReportOptions {
  header: DiagnosticsHeader;
  entries: EngineLogEntryDto[];
  /** `filtered` = the current filter window; `full` = the whole buffer. */
  scope: 'filtered' | 'full';
  /** Human-readable filter description (present when `scope === 'filtered'`). */
  filterSummary?: string;
}

/** The literal marker line separating header from log dump. */
export const LOG_DUMP_MARKER = '── Logs ─────────────────────────────────────────';

/** The desktop-viewer-shaped single-entry line. */
export function formatLogEntry(entry: EngineLogEntryDto): string {
  const level = (entry.level || 'info').toUpperCase().padEnd(5, ' ');
  const ts = entry.timestamp ?? '';
  const parts = [`[${ts}]`, level, entry.component || '-'];
  if (entry.entityId) parts.push(entry.entityId);
  parts.push(`— ${entry.message ?? ''}`);
  let line = parts.join(' ');
  if (entry.isPrompt) {
    line += ` [prompt${entry.promptType ? `:${entry.promptType}` : ''}]`;
  }
  if (entry.data && Object.keys(entry.data).length > 0) {
    try {
      line += ` ${JSON.stringify(entry.data)}`;
    } catch {
      /* ignore unserializable data */
    }
  }
  return line;
}

/** Build the full diagnostics report text. */
export function buildDiagnosticsReport(options: DiagnosticsReportOptions): string {
  const { header, entries, scope, filterSummary } = options;
  const generatedAt = header.generatedAt ?? new Date().toISOString();

  const lines: string[] = [];
  lines.push('Soulbits Engine — diagnostics report');
  lines.push(`Generated: ${generatedAt}`);
  lines.push(`App version: ${header.appVersion}`);
  lines.push(`Soulbits Engine: ${header.engineVersion}`);
  lines.push(`Management contract: ${header.contractVersion}`);
  lines.push(`Platform: ${header.platform} ${header.osVersion}`.trimEnd());
  lines.push(`Device: ${header.deviceModel}`);
  lines.push('');
  const scopeLabel = scope === 'full' ? 'full buffer' : 'current filter';
  lines.push(
    `Scope: ${scopeLabel} (${entries.length} ${entries.length === 1 ? 'entry' : 'entries'})` +
      (scope === 'filtered' && filterSummary ? ` — ${filterSummary}` : ''),
  );
  lines.push(LOG_DUMP_MARKER);
  for (const entry of entries) {
    lines.push(formatLogEntry(entry));
  }
  lines.push('');
  return lines.join('\n');
}

/** The suggested share filename (stable per-day; OS dedupes as needed). */
export function diagnosticsFileName(generatedAt: string = new Date().toISOString()): string {
  const stamp = generatedAt.replace(/[:.]/g, '-');
  return `soulbits-diagnostics-${stamp}.txt`;
}
