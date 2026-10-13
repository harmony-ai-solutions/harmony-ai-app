/**
 * shareDiagnostics — the OS-share-sheet wiring for the diagnostics export
 * (plan 7-11).
 *
 * Collects the header (app version via `DeviceInfo`, the running engine version
 * via 7-10's `EngineApiClient.engineAppVersion()` — falling back to the cached
 * canary state — the pinned management-contract version, platform/OS + device
 * model), builds the report with {@link buildDiagnosticsReport}, writes it to
 * the app cache dir with `react-native-fs`, and opens the OS share sheet with
 * `react-native-share`.
 *
 * Privacy: nothing is uploaded anywhere. The file is the user's own data and
 * only leaves the device through the explicit OS share action.
 */

import { Platform } from 'react-native';
import DeviceInfo from 'react-native-device-info';
import RNFS from 'react-native-fs';
import Share from 'react-native-share';
import { ENGINE_CONTRACT_VERSION } from '../engine/engineContract';
import { engineApiClient } from '../engine/EngineApiClient';
import { getEngineVersionState } from '../engine/EngineService';
import { normalizeVersion } from '../../utils/semver';
import { createLogger } from '../../utils/logger';
import type { EngineLogEntryDto } from '../engine/EngineApiClient';
import {
  buildDiagnosticsReport,
  diagnosticsFileName,
  type DiagnosticsHeader,
} from './buildDiagnosticsReport';

const log = createLogger('[shareDiagnostics]');

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

/**
 * Resolve the running engine version: prefer a live `GET /public/appversion`
 * (7-10's `engineAppVersion()`), falling back to the cached canary state, then
 * `unknown`.
 */
export async function resolveEngineVersion(): Promise<string> {
  try {
    const dto = await engineApiClient.engineAppVersion();
    if (dto?.appVersion) return normalizeVersion(dto.appVersion);
  } catch {
    /* fall through to the cached state */
  }
  return getEngineVersionState().engineVersion ?? 'unknown';
}

/** Collect the diagnostics header from the live device + engine. */
export async function collectDiagnosticsHeader(
  generatedAt?: string,
): Promise<DiagnosticsHeader> {
  return {
    appVersion: safeAppVersion(),
    engineVersion: await resolveEngineVersion(),
    contractVersion: ENGINE_CONTRACT_VERSION,
    platform: Platform.OS,
    osVersion: safeOsVersion(),
    deviceModel: safeDeviceModel(),
    generatedAt,
  };
}

export interface ShareDiagnosticsOptions {
  entries: EngineLogEntryDto[];
  scope: 'filtered' | 'full';
  filterSummary?: string;
}

/**
 * Build + write + share the diagnostics report. Returns the written file path.
 * The caller owns error UX (a share-sheet cancel is not an error worth
 * surfacing aggressively).
 */
export async function shareDiagnosticsReport(
  options: ShareDiagnosticsOptions,
): Promise<string> {
  const generatedAt = new Date().toISOString();
  const header = await collectDiagnosticsHeader(generatedAt);
  const report = buildDiagnosticsReport({
    header,
    entries: options.entries,
    scope: options.scope,
    filterSummary: options.filterSummary,
  });

  const dir = RNFS.CachesDirectoryPath || RNFS.DocumentDirectoryPath;
  const path = `${dir}/${diagnosticsFileName(generatedAt)}`;
  await RNFS.writeFile(path, report, 'utf8');
  log.info(`Diagnostics report written (${report.length} bytes)`);

  await Share.open({
    title: 'Soulbits Engine diagnostics',
    subject: 'Soulbits Engine diagnostics',
    type: 'text/plain',
    url: `file://${path}`,
    filename: diagnosticsFileName(generatedAt),
    failOnCancel: false,
  });

  return path;
}
