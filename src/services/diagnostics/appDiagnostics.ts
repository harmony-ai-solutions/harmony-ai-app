/**
 * appDiagnostics — header + report builders for the on-device app-log viewer
 * and the generic-error "Copy diagnostics" action.
 *
 * The header is generated once per share/copy and carries: app version,
 * engine contract version, platform/OS, device model, app uptime, entry count
 * and the time range covered. Nothing is uploaded anywhere — the text only
 * leaves the device through an explicit share/copy action.
 *
 * Pure renderers are exported for unit tests; the collectors wrap native
 * modules (DeviceInfo, Clipboard) behind try/catch so they never throw.
 */

import { Platform } from 'react-native';
import DeviceInfo from 'react-native-device-info';
import Clipboard from '@react-native-clipboard/clipboard';
import { ENGINE_CONTRACT_VERSION } from '../engine/engineContract';
import {
  appLogBuffer,
  type AppLogEntry,
} from '../../utils/appLogs';

/** Captured at module load — the reference point for "app uptime". */
const APP_START_MS = Date.now();

/** How many recent entries a generic-error diagnostics copy includes. */
export const APP_DIAGNOSTICS_ENTRY_LIMIT = 100;
/** Byte ceiling for a generic-error diagnostics copy (~32 KB). */
export const APP_DIAGNOSTICS_BYTE_LIMIT = 32 * 1024;

/** The diagnostics header fields. */
export interface AppDiagnosticsHeader {
  appVersion: string;
  /** The management-contract version the app is pinned to. */
  contractVersion: string;
  /** `ios` | `android` | other (the `Platform.OS` value). */
  platform: string;
  osVersion: string;
  deviceModel: string;
  /** Milliseconds since the JS bundle started. */
  appUptimeMs: number;
  entryCount: number;
  /** RFC3339 timestamp of the oldest included entry, or null. */
  firstTimestamp: string | null;
  /** RFC3339 timestamp of the newest included entry, or null. */
  lastTimestamp: string | null;
  /** RFC3339 generation time. */
  generatedAt: string;
}

/** Best-effort app version (a dash when the native module is unavailable). */
function safeAppVersion(): string {
  try {
    return DeviceInfo.getVersion();
  } catch {
    return '—';
  }
}

/** Best-effort OS version. */
function safeOsVersion(): string {
  try {
    return DeviceInfo.getSystemVersion();
  } catch {
    return '—';
  }
}

/** Best-effort device model. */
function safeDeviceModel(): string {
  try {
    return DeviceInfo.getModel();
  } catch {
    return '—';
  }
}

/** Milliseconds since the JS bundle started. */
export function appUptimeMs(): number {
  try {
    return Math.max(0, Date.now() - APP_START_MS);
  } catch {
    return 0;
  }
}

/** `1h 02m 03s` (or `12s` / `1m 05s`) from a millisecond duration. */
export function formatUptime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

/** Build the header for a set of entries (native reads are guarded). */
export function collectAppDiagnosticsHeader(
  entries: AppLogEntry[],
  generatedAt: string = new Date().toISOString(),
): AppDiagnosticsHeader {
  const first = entries.length > 0 ? entries[0].timestamp : null;
  const last = entries.length > 0 ? entries[entries.length - 1].timestamp : null;
  return {
    appVersion: safeAppVersion(),
    contractVersion: ENGINE_CONTRACT_VERSION,
    platform: Platform.OS,
    osVersion: safeOsVersion(),
    deviceModel: safeDeviceModel(),
    appUptimeMs: appUptimeMs(),
    entryCount: entries.length,
    firstTimestamp: first,
    lastTimestamp: last,
    generatedAt,
  };
}

/** The literal marker line separating header from log dump. */
export const APP_LOG_DUMP_MARKER = '── App logs ─────────────────────────────────────';

/** One entry line: `[timestamp] [namespace] LEVEL message`. */
export function formatAppLogEntry(entry: AppLogEntry): string {
  const level = (entry.level || 'info').toUpperCase().padEnd(5, ' ');
  const ns = entry.namespace ? `${entry.namespace} ` : '';
  const prev = entry.previousSession ? '[prev] ' : '';
  return `[${entry.timestamp}] ${prev}${ns}${level} ${entry.message}`;
}

/** Render the header + log dump (pure). */
export function renderAppDiagnostics(
  header: AppDiagnosticsHeader,
  entries: AppLogEntry[],
): string {
  const lines: string[] = [];
  lines.push('Soulbits App — diagnostics report');
  lines.push(`Generated: ${header.generatedAt}`);
  lines.push(`App version: ${header.appVersion}`);
  lines.push(`Management contract: ${header.contractVersion}`);
  lines.push(`Platform: ${header.platform} ${header.osVersion}`.trimEnd());
  lines.push(`Device: ${header.deviceModel}`);
  lines.push(`App uptime: ${formatUptime(header.appUptimeMs)}`);
  lines.push(
    `Entries: ${header.entryCount}` +
      (header.firstTimestamp && header.lastTimestamp
        ? ` (${header.firstTimestamp} → ${header.lastTimestamp})`
        : ''),
  );
  lines.push(APP_LOG_DUMP_MARKER);
  for (const entry of entries) {
    lines.push(formatAppLogEntry(entry));
  }
  lines.push('');
  return lines.join('\n');
}

/** Build the full app-diagnostics text for the given entries. */
export function buildAppDiagnosticsReport(
  entries: AppLogEntry[],
  generatedAt: string = new Date().toISOString(),
): string {
  const header = collectAppDiagnosticsHeader(entries, generatedAt);
  return renderAppDiagnostics(header, entries);
}

/**
 * The entries a generic-error diagnostics copy includes: the last ~100 entries,
 * additionally capped at ~32 KB.
 */
export function selectErrorDiagnosticsEntries(
  buffer = appLogBuffer,
): AppLogEntry[] {
  const recent = buffer.getRecentEntries(APP_DIAGNOSTICS_ENTRY_LIMIT);
  const capped = buffer.getTailBytes(APP_DIAGNOSTICS_BYTE_LIMIT);
  // getTailBytes walks newest→oldest; intersect with the recent window.
  const recentIds = new Set(recent.map(e => e.id));
  const bounded = capped.filter(e => recentIds.has(e.id));
  return bounded.length > 0 ? bounded : recent;
}

/** Build the diagnostics text for the generic-error copy action. */
export function buildErrorDiagnosticsText(): string {
  return buildAppDiagnosticsReport(selectErrorDiagnosticsEntries());
}

/**
 * Copy the diagnostics header + a bounded tail of app-log entries to the
 * clipboard. Returns true on success. Never throws.
 */
export async function copyAppDiagnostics(): Promise<boolean> {
  try {
    Clipboard.setString(buildErrorDiagnosticsText());
    return true;
  } catch {
    return false;
  }
}

/**
 * Copy the error diagnostics and report the outcome through `notify` (a themed
 * toast). Never throws. Shared by the generic error-alert "Copy diagnostics"
 * actions.
 */
export async function copyAppDiagnosticsWithToast(
  notify: (message: string) => void,
  messages: { success: string; failure: string },
): Promise<void> {
  const ok = await copyAppDiagnostics();
  try {
    notify(ok ? messages.success : messages.failure);
  } catch {
    /* never surface a notify failure */
  }
}

/**
 * Copy an explicit entry list (used by the viewer's "Copy" action). Returns
 * true on success. Never throws.
 */
export async function copyAppLogEntries(entries: AppLogEntry[]): Promise<boolean> {
  try {
    Clipboard.setString(buildAppDiagnosticsReport(entries));
    return true;
  } catch {
    return false;
  }
}
