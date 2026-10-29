/**
 * apkSelfUpdate — the optional Android in-app APK self-update (plan 7-10 §8;
 * observable + resumable download since "Auto-Update UX phases 1+2").
 *
 * Sideload-channel only (see `config/appChannel`). The flow:
 *   1. ask the native `SoulbitsApkInstall` module whether installs are allowed
 *      (PERMISSION FIRST — before a single byte is fetched, so the caller can
 *      offer the "install unknown apps" settings page without wasting a
 *      multi-MB download);
 *   2. download the APK from the manifest URL into the app cache dir — either
 *      with RNFS' `downloadFile` (fresh) or with HTTP range requests (resume);
 *   3. report every step through the observable {@link ApkDownloadState}
 *      (downloading → ready → installing), so the UI can render a real dialog
 *      with bytes, percent and a Cancel button;
 *   4. launch the system installer for the cached file on request.
 *
 * Observability mirrors `UpdateAvailableService`: module-level state + a
 * listener `Set` + `emit`. {@link beginApkSelfUpdate} is fire-and-forget — it
 * NEVER throws; every failure lands in `state.error` (with
 * {@link INSTALL_PERMISSION_REQUIRED} as the sentinel for the permission case).
 *
 * Phase 2 — persistence. The destination is DETERMINISTIC
 * (`soulbits-update-<sanitized-version>.apk`), and a small sidecar in
 * AsyncStorage records `{ version, url, contentLength, destPath }`. The file
 * SIZE ON DISK is the only truth about progress: `bytesFetched` is deliberately
 * NOT persisted (a crash between an append and any counter update would leave a
 * counter that lies, and a lying counter corrupts the next resume). A cold
 * start therefore reads the sidecar, stats the file and either reports a
 * complete artifact, a resumable partial, or cleans the leftovers up.
 *
 * Resume is range-based: a `Range: bytes=0-0` probe discovers the total (and
 * detects a changed artifact), then ~2 MiB chunks are appended as base64. Every
 * chunk MUST come back `206`; a `200` means the server ignored the offset and
 * appending it would silently corrupt the file, so the partial is kept and the
 * run fails (a retry resumes cleanly). A network/IO failure keeps the partial +
 * sidecar for the same reason; only Cancel (and an unusable artifact) deletes.
 *
 * iOS has no such flow (platform-forbidden) — the caller links to the portal
 * INSTALLATION instructions instead. The user-confirmation UI lives in the
 * caller (the update prompt); this module is the mechanism.
 */

import { NativeModules, Platform } from 'react-native';
import RNFS from 'react-native-fs';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createLogger } from '../../utils/logger';
import { uint8ArrayToBase64 } from '../../database/base64';

const log = createLogger('[ApkSelfUpdate]');

/** Sentinel used both as the thrown value (legacy API) and as `state.error`. */
export const INSTALL_PERMISSION_REQUIRED = 'install_permission_required';

/** AsyncStorage key holding the pending-download sidecar. */
export const APK_DOWNLOAD_SIDECAR_KEY = '@soulbits_apk_download';

/** RNFS progress cadence (ms) for the fresh-download path. */
const PROGRESS_INTERVAL_MS = 250;
/** Range size for the resume path (~2 MiB). */
const RESUME_CHUNK_BYTES = 2 * 1024 * 1024;
/** Cache-file prefix shared by the artifact and the legacy timestamped files. */
const APK_FILE_PREFIX = 'soulbits-update-';
const APK_FILE_SUFFIX = '.apk';

// ── Public types ────────────────────────────────────────────────────────

/** `idle` → `downloading` → `ready` → `installing` (or `failed` anywhere). */
export type ApkDownloadPhase = 'idle' | 'downloading' | 'ready' | 'installing' | 'failed';

/** A single progress statement for the update UI. */
export interface ApkDownloadProgress {
  version: string;
  url: string;
  bytesFetched: number;
  /** null when the server did not report a total (render indeterminate). */
  contentLength: number | null;
  /** 0–100, or null when contentLength is unknown. */
  percent: number | null;
}

/** The observable download state. */
export interface ApkDownloadState {
  phase: ApkDownloadPhase;
  progress: ApkDownloadProgress | null;
  /** Human-relevant failure detail; equals INSTALL_PERMISSION_REQUIRED for the permission case. */
  error: string | null;
}

/** Snapshot of a persisted download found on cold start. */
export interface PendingApkDownload {
  version: string;
  url: string;
  bytesFetched: number;
  contentLength: number | null;
  percent: number | null;
  /** true when the file size matches the known total — ready to install without downloading. */
  complete: boolean;
}

/** The native `SoulbitsApkInstall` bridge surface. */
export interface ApkInstallNativeModule {
  canInstall(): Promise<boolean>;
  installApk(path: string): Promise<boolean>;
  openInstallSettings(): Promise<boolean>;
}

// ── Test seams: filesystem / native module / fetch ──────────────────────

/** The subset of RNFS this service uses (injectable for tests). */
export interface ApkDownloadFsLike {
  CachesDirectoryPath: string;
  stat(path: string): Promise<{ size: number }>;
  unlink(path: string): Promise<void>;
  readDir(path: string): Promise<ApkReadDirItemLike[]>;
  appendFile(path: string, contents: string, encoding?: string): Promise<void>;
  downloadFile(options: ApkDownloadFileOptions): ApkDownloadFileHandle;
  stopDownload(jobId: number): void;
}

/** The `readDir` entry fields this service reads. */
export interface ApkReadDirItemLike {
  name: string;
  path: string;
  size: number;
}

/** The `downloadFile` options this service passes. */
export interface ApkDownloadFileOptions {
  fromUrl: string;
  toFile: string;
  headers?: Record<string, string>;
  progressInterval?: number;
  begin?: (res: {
    jobId: number;
    contentLength: number;
    statusCode: number;
    headers: Record<string, string>;
  }) => void;
  progress?: (res: {
    jobId: number;
    contentLength: number;
    bytesWritten: number;
  }) => void;
}

/** The `downloadFile` result this service reads. */
export interface ApkDownloadFileResult {
  jobId: number;
  statusCode: number;
  bytesWritten: number;
}

/** The `downloadFile` handle this service reads. */
export interface ApkDownloadFileHandle {
  jobId?: number;
  promise: Promise<ApkDownloadFileResult>;
}

type ApkFetch = (url: string, init?: RequestInit) => Promise<Response>;

/** The persisted sidecar (bytesFetched is intentionally absent — see header). */
interface ApkDownloadSidecar {
  version: string;
  url: string;
  contentLength: number | null;
  destPath: string;
}

/** One in-flight begin/cancel window (module-level concurrency guard). */
interface ActiveRun {
  cancelled: boolean;
  jobId: number | null;
  destPath: string | null;
}

// ── Module state ────────────────────────────────────────────────────────

const IDLE_STATE: ApkDownloadState = { phase: 'idle', progress: null, error: null };

let state: ApkDownloadState = IDLE_STATE;
const listeners = new Set<(s: ApkDownloadState) => void>();

let activeRun: ActiveRun | null = null;

let installModuleOverride: Partial<ApkInstallNativeModule> | null = null;

function createDefaultFs(): ApkDownloadFsLike {
  return {
    CachesDirectoryPath: RNFS.CachesDirectoryPath,
    stat: path => RNFS.stat(path),
    unlink: path => RNFS.unlink(path),
    readDir: path => RNFS.readDir(path),
    appendFile: (path, contents, encoding) => RNFS.appendFile(path, contents, encoding),
    downloadFile: options =>
      RNFS.downloadFile(
        options as unknown as Parameters<typeof RNFS.downloadFile>[0],
      ) as ApkDownloadFileHandle,
    stopDownload: jobId => RNFS.stopDownload(jobId),
  };
}

let fsImpl: ApkDownloadFsLike = createDefaultFs();

let fetchImpl: ApkFetch =
  typeof fetch !== 'undefined' ? fetch : (undefined as unknown as ApkFetch);

function nativeModule(): Partial<ApkInstallNativeModule> | undefined {
  return (
    installModuleOverride ??
    (NativeModules.SoulbitsApkInstall as ApkInstallNativeModule | undefined)
  );
}

// ── Test seams ──────────────────────────────────────────────────────────

/** Replace (part of) the filesystem implementation (test seam). */
export function setApkDownloadFsForTests(fs: Partial<ApkDownloadFsLike>): void {
  fsImpl = { ...fsImpl, ...fs };
}

/** Replace (part of) the native installer bridge (test seam). */
export function setApkInstallModuleForTests(mod: Partial<ApkInstallNativeModule>): void {
  installModuleOverride = mod;
}

/** Replace the fetch implementation (test seam). */
export function setApkDownloadFetchForTests(fetch: ApkFetch): void {
  fetchImpl = fetch;
}

/** Test-only: drop all state + restore the real seams. */
export function resetApkDownloadStateForTests(): void {
  if (activeRun) activeRun.cancelled = true;
  activeRun = null;
  state = IDLE_STATE;
  listeners.clear();
  fsImpl = createDefaultFs();
  installModuleOverride = null;
  fetchImpl = typeof fetch !== 'undefined' ? fetch : (undefined as unknown as ApkFetch);
}

// ── Observability ───────────────────────────────────────────────────────

/** The current download state (synchronous snapshot). */
export function getApkDownloadState(): ApkDownloadState {
  return state;
}

/** Subscribe to download-state changes. Returns an unsubscribe function. */
export function onApkDownloadStateChange(listener: (s: ApkDownloadState) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emit(next: ApkDownloadState): void {
  state = next;
  for (const listener of listeners) {
    try {
      listener(next);
    } catch (e) {
      log.warn('Apk download listener threw:', e);
    }
  }
}

/** 0–100 rounded, or null when the total is unknown (indeterminate). */
function computePercent(bytesFetched: number, contentLength: number | null): number | null {
  if (contentLength == null || contentLength <= 0) return null;
  const raw = (bytesFetched / contentLength) * 100;
  return Math.min(100, Math.max(0, Math.round(raw)));
}

function progressSnapshot(
  version: string,
  url: string,
  bytesFetched: number,
  contentLength: number | null,
): ApkDownloadProgress {
  return {
    version,
    url,
    bytesFetched,
    contentLength,
    percent: computePercent(bytesFetched, contentLength),
  };
}

function emitProgress(
  version: string,
  url: string,
  bytesFetched: number,
  contentLength: number | null,
): void {
  emit({
    phase: 'downloading',
    progress: progressSnapshot(version, url, bytesFetched, contentLength),
    error: null,
  });
}

function emitReady(
  version: string,
  url: string,
  bytesFetched: number,
  contentLength: number | null,
): void {
  emit({
    phase: 'ready',
    progress: progressSnapshot(version, url, bytesFetched, contentLength),
    error: null,
  });
}

/** Failure keeps the last known progress (human-relevant byte count) unless given. */
function emitFailed(detail: string, progress: ApkDownloadProgress | null = state.progress): void {
  emit({ phase: 'failed', progress, error: detail });
}

function emitIdle(): void {
  emit(IDLE_STATE);
}

// ── Paths + sidecar persistence ─────────────────────────────────────────

/** Deterministic artifact name component: anything outside `[A-Za-z0-9._-]` → `-`. */
function sanitizeVersion(version: string): string {
  const cleaned = version.replace(/[^A-Za-z0-9._-]/g, '-');
  return cleaned.length > 0 ? cleaned : 'unknown';
}

/** `${CachesDirectoryPath}/soulbits-update-<sanitized-version>.apk` (no timestamps). */
function destPathFor(version: string): string {
  return `${fsImpl.CachesDirectoryPath}/${APK_FILE_PREFIX}${sanitizeVersion(version)}${APK_FILE_SUFFIX}`;
}

async function readSidecar(): Promise<ApkDownloadSidecar | null> {
  try {
    const raw = await AsyncStorage.getItem(APK_DOWNLOAD_SIDECAR_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ApkDownloadSidecar> | null;
    if (
      !parsed ||
      typeof parsed.version !== 'string' ||
      typeof parsed.url !== 'string' ||
      typeof parsed.destPath !== 'string'
    ) {
      log.warn('Ignoring malformed APK download sidecar');
      return null;
    }
    return {
      version: parsed.version,
      url: parsed.url,
      contentLength: typeof parsed.contentLength === 'number' ? parsed.contentLength : null,
      destPath: parsed.destPath,
    };
  } catch (e) {
    log.warn('Failed to read the APK download sidecar:', e);
    return null;
  }
}

async function writeSidecar(sidecar: ApkDownloadSidecar): Promise<void> {
  try {
    await AsyncStorage.setItem(APK_DOWNLOAD_SIDECAR_KEY, JSON.stringify(sidecar));
  } catch (e) {
    log.warn('Failed to persist the APK download sidecar:', e);
  }
}

async function clearSidecar(): Promise<void> {
  try {
    await AsyncStorage.removeItem(APK_DOWNLOAD_SIDECAR_KEY);
  } catch (e) {
    log.warn('Failed to clear the APK download sidecar:', e);
  }
}

/** Size on disk, or null when the file is missing/unreadable. */
async function statSize(path: string): Promise<number | null> {
  try {
    const info = await fsImpl.stat(path);
    return typeof info?.size === 'number' ? info.size : null;
  } catch {
    // RNFS.stat throws for a missing file — that is "no file", not an error.
    return null;
  }
}

async function unlinkQuietly(path: string): Promise<void> {
  try {
    await fsImpl.unlink(path);
  } catch (e) {
    log.debug(`Could not remove ${path} (already gone?):`, e);
  }
}

/** Delete the partial/complete artifact AND drop the sidecar. */
async function discardArtifact(path: string): Promise<void> {
  await unlinkQuietly(path);
  await clearSidecar();
}

/**
 * Unlink every `soulbits-update-*.apk` in the cache dir except `keepPath`
 * (the current artifact) — covers both leftovers of other versions and the
 * legacy `<timestamp>` names. With no pending sidecar, removes all of them.
 */
async function cleanOrphanApkFiles(keepPath: string | null): Promise<void> {
  let entries: ApkReadDirItemLike[];
  try {
    entries = await fsImpl.readDir(fsImpl.CachesDirectoryPath);
  } catch (e) {
    log.debug('Could not list the cache directory:', e);
    return;
  }
  for (const entry of entries) {
    const name = entry?.name ?? '';
    if (!name.startsWith(APK_FILE_PREFIX) || !name.endsWith(APK_FILE_SUFFIX)) continue;
    const path = entry?.path ?? `${fsImpl.CachesDirectoryPath}/${name}`;
    if (keepPath && path === keepPath) continue;
    log.debug(`Removing stale update artifact ${path}`);
    await unlinkQuietly(path);
  }
}

/** `-1`/`0`/NaN mean "the server did not report a total". */
function normalizeTotal(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/** `bytes 0-0/12345` → 12345 (null when absent/unparseable, `*` → null). */
function parseContentRangeTotal(header: string | null): number | null {
  if (!header) return null;
  const match = /\/(\d+)\s*$/.exec(header.trim());
  if (!match) return null;
  return normalizeTotal(Number(match[1]));
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ── Support + permission ────────────────────────────────────────────────

/** True when the native installer bridge is present (Android build). */
export function isApkSelfUpdateSupported(): boolean {
  return Platform.OS === 'android' && nativeModule() != null;
}

/** Open the per-app "install unknown apps" settings page. */
export async function openInstallPermissionSettings(): Promise<void> {
  await nativeModule()?.openInstallSettings?.();
}

// ── Download paths ──────────────────────────────────────────────────────

/** Check permission, then download (fresh or resumed). Never throws. */
export async function beginApkSelfUpdate(version: string, url: string): Promise<void> {
  // A second begin while one is active (or while a cancel is unwinding) is a no-op.
  if (activeRun) {
    log.debug('beginApkSelfUpdate ignored: a download is already active');
    return;
  }
  if (Platform.OS !== 'android') {
    emitFailed('In-app updates are Android-only', null);
    return;
  }
  const mod = nativeModule();
  if (!mod || typeof mod.canInstall !== 'function') {
    emitFailed('SoulbitsApkInstall native module is unavailable', null);
    return;
  }

  const run: ActiveRun = { cancelled: false, jobId: null, destPath: null };
  activeRun = run;

  try {
    // PERMISSION FIRST — before any bytes, and without touching the filesystem.
    let allowed: boolean;
    try {
      allowed = await mod.canInstall();
    } catch (e) {
      emitFailed(`install permission check failed: ${errorMessage(e)}`, null);
      return;
    }
    if (run.cancelled) return;
    if (!allowed) {
      log.info('Install permission missing; download not started');
      emitFailed(INSTALL_PERMISSION_REQUIRED, progressSnapshot(version, url, 0, null));
      return;
    }

    emitProgress(version, url, 0, null);
    await runDownload(run, version, url);
  } catch (e) {
    // Defensive: beginApkSelfUpdate must never throw (the UI only reads state).
    if (!run.cancelled) {
      log.warn('Unexpected self-update failure:', e);
      emitFailed(errorMessage(e));
    }
  } finally {
    if (activeRun === run) activeRun = null;
  }
}

/** Pick the artifact on disk and route to `ready` / resume / fresh. */
async function runDownload(run: ActiveRun, version: string, url: string): Promise<void> {
  const destPath = destPathFor(version);
  run.destPath = destPath;

  let sidecar = await readSidecar();
  if (sidecar && (sidecar.version !== version || sidecar.destPath !== destPath)) {
    // A pending artifact for a DIFFERENT version/URL — the resume state cannot
    // be trusted, so drop it (the file and its sidecar) and start clean.
    log.info(`Discarding stale update artifact ${sidecar.destPath} (${sidecar.version})`);
    await discardArtifact(sidecar.destPath);
    sidecar = null;
  }

  const existing = await statSize(destPath);
  if (existing != null && existing > 0 && existing === sidecar?.contentLength) {
    // Complete artifact on disk → no network at all.
    log.info(`Update ${version} is already downloaded (${existing} bytes)`);
    emitReady(version, url, existing, sidecar.contentLength);
    return;
  }

  if (existing != null && existing > 0) {
    await resumeDownload(run, version, url, destPath, sidecar);
    return;
  }
  await freshDownload(run, version, url, destPath);
}

/** RNFS `downloadFile` path (no server-side range support needed). */
async function freshDownload(
  run: ActiveRun,
  version: string,
  url: string,
  destPath: string,
): Promise<void> {
  log.info(`Downloading update ${version} → ${destPath}`);

  // The callbacks cannot be async, so their async work is tracked here.
  const fresh: { contentLength: number | null; sidecarWrite: Promise<void> | null } = {
    contentLength: null,
    sidecarWrite: null,
  };

  let handle: ApkDownloadFileHandle;
  try {
    handle = fsImpl.downloadFile({
      fromUrl: url,
      toFile: destPath,
      progressInterval: PROGRESS_INTERVAL_MS,
      begin: res => {
        run.jobId = res.jobId;
        fresh.contentLength = normalizeTotal(res.contentLength);
        // The sidecar is written from `begin` (the first point the total is known).
        fresh.sidecarWrite = writeSidecar({
          version,
          url,
          contentLength: fresh.contentLength,
          destPath,
        });
      },
      progress: res => {
        if (run.cancelled) return;
        if (fresh.contentLength == null) fresh.contentLength = normalizeTotal(res.contentLength);
        emitProgress(version, url, res.bytesWritten, fresh.contentLength);
      },
    });
  } catch (e) {
    log.warn('Could not start the APK download:', e);
    emitFailed(`download failed: ${errorMessage(e)}`);
    return;
  }
  if (typeof handle.jobId === 'number') run.jobId = handle.jobId;

  let result: ApkDownloadFileResult;
  try {
    result = await handle.promise;
  } catch (e) {
    if (fresh.sidecarWrite) await fresh.sidecarWrite;
    if (run.cancelled) return; // cancel() already cleaned up and emitted idle
    // Network/IO failure: KEEP the partial + sidecar so a retry resumes.
    log.warn('APK download failed:', errorMessage(e));
    emitFailed(`download failed: ${errorMessage(e)}`);
    return;
  }
  if (fresh.sidecarWrite) await fresh.sidecarWrite;
  if (run.cancelled) return;

  if (result.statusCode !== 200) {
    log.warn(`APK download failed with HTTP ${result.statusCode}`);
    await discardArtifact(destPath);
    emitFailed(`download failed (HTTP ${result.statusCode})`);
    return;
  }

  const size = await statSize(destPath);
  if (fresh.contentLength != null && size != null && size !== fresh.contentLength) {
    log.warn(`APK size mismatch: ${size} of ${fresh.contentLength} bytes`);
    await discardArtifact(destPath);
    emitFailed(`download incomplete (${size} of ${fresh.contentLength} bytes)`);
    return;
  }

  log.info(`Update ${version} downloaded (${size ?? result.bytesWritten} bytes)`);
  emitReady(version, url, size ?? result.bytesWritten, fresh.contentLength);
}

/**
 * Range-based resume of an existing partial: probe the total, then append
 * ~2 MiB chunks. A non-206 chunk response aborts the run WITHOUT appending
 * (the bytes would land at the wrong offset) but keeps the partial.
 */
async function resumeDownload(
  run: ActiveRun,
  version: string,
  url: string,
  destPath: string,
  sidecar: ApkDownloadSidecar | null,
): Promise<void> {
  const startSize = (await statSize(destPath)) ?? 0;
  log.info(`Resuming update ${version} at ${startSize} bytes`);

  let probe: Response;
  try {
    probe = await fetchImpl(url, { headers: { Range: 'bytes=0-0' } });
  } catch (e) {
    if (run.cancelled) return;
    log.warn('Resume probe failed:', errorMessage(e));
    emitFailed(`download failed: ${errorMessage(e)}`);
    return;
  }
  if (run.cancelled) return;

  if (probe.status !== 206) {
    log.info(`Server ignored the range probe (HTTP ${probe.status}); restarting the download`);
    await discardArtifact(destPath);
    await freshDownload(run, version, url, destPath);
    return;
  }

  const probedTotal = parseContentRangeTotal(probe.headers.get('Content-Range'));
  const knownTotal = sidecar?.contentLength ?? null;
  if (probedTotal == null) {
    log.info('Range probe carried no usable total; restarting the download');
    await discardArtifact(destPath);
    await freshDownload(run, version, url, destPath);
    return;
  }
  if (knownTotal != null && knownTotal !== probedTotal) {
    log.info(`Update artifact changed (${knownTotal} → ${probedTotal} bytes); restarting`);
    await discardArtifact(destPath);
    await freshDownload(run, version, url, destPath);
    return;
  }

  const total = probedTotal;
  // Adopt the probed total when the sidecar did not know it (e.g. a crash
  // before `begin`, or an earlier download without a Content-Length).
  await writeSidecar({ version, url, contentLength: total, destPath });

  let start = startSize;
  emitProgress(version, url, start, total); // progress starts at the resumed offset

  while (start < total) {
    if (run.cancelled) return;

    const end = Math.min(start + RESUME_CHUNK_BYTES, total) - 1;
    let response: Response;
    try {
      response = await fetchImpl(url, { headers: { Range: `bytes=${start}-${end}` } });
    } catch (e) {
      if (run.cancelled) return;
      log.warn('Resume chunk failed:', errorMessage(e));
      emitFailed(`download failed: ${errorMessage(e)}`);
      return;
    }
    if (run.cancelled) return;

    if (response.status !== 206) {
      // 200 = the server sent the WHOLE file, not this offset. Appending it
      // would corrupt the artifact, so keep the partial and fail (retry resumes).
      log.warn(`Resume chunk rejected (HTTP ${response.status}); keeping the partial`);
      emitFailed(`download failed (HTTP ${response.status})`);
      return;
    }

    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await response.arrayBuffer());
    } catch (e) {
      if (run.cancelled) return;
      log.warn('Could not read the resume chunk body:', errorMessage(e));
      emitFailed(`download failed: ${errorMessage(e)}`);
      return;
    }
    if (run.cancelled) return;
    if (bytes.length === 0) {
      // A 206 with no body would loop forever — fail and keep the partial.
      log.warn('Resume chunk was empty');
      emitFailed('download stalled (empty chunk)');
      return;
    }

    try {
      await fsImpl.appendFile(destPath, uint8ArrayToBase64(bytes), 'base64');
    } catch (e) {
      if (run.cancelled) return;
      log.warn('Could not append the resume chunk:', errorMessage(e));
      emitFailed(`write failed: ${errorMessage(e)}`);
      return;
    }

    start += bytes.length;
    if (run.cancelled) return; // cancel() already deleted the partial
    emitProgress(version, url, start, total);
  }

  const finalSize = await statSize(destPath);
  if (finalSize != null && finalSize !== total) {
    log.warn(`Resumed APK size mismatch: ${finalSize} of ${total} bytes`);
    await discardArtifact(destPath);
    emitFailed(`download incomplete (${finalSize} of ${total} bytes)`);
    return;
  }

  log.info(`Update ${version} resumed and completed (${finalSize ?? total} bytes)`);
  emitReady(version, url, finalSize ?? total, total);
}

// ── Cancel ──────────────────────────────────────────────────────────────

/** Cancel the active download (or clear a persisted one) → idle. */
export async function cancelApkSelfUpdate(): Promise<void> {
  const run = activeRun;
  const jobId = run?.jobId ?? null;

  if (run) {
    run.cancelled = true;
    if (jobId != null) {
      try {
        fsImpl.stopDownload(jobId);
      } catch (e) {
        log.warn('Could not stop the APK download job:', e);
      }
    }
  }

  const destPath = run?.destPath ?? (await readSidecar())?.destPath ?? null;
  if (destPath) {
    await discardArtifact(destPath);
  } else {
    await clearSidecar();
  }
  log.info('APK download cancelled');

  // Release the slot immediately: the runner sees `cancelled` and stays silent.
  if (run && activeRun === run) activeRun = null;
  emitIdle();
}

// ── Install ─────────────────────────────────────────────────────────────

/** Launch the system installer for the `ready` artifact. */
export async function installDownloadedApk(): Promise<void> {
  if (state.phase !== 'ready' || !state.progress) {
    log.debug(`installDownloadedApk ignored in phase ${state.phase}`);
    return;
  }
  const progress = state.progress;
  const destPath = destPathFor(progress.version);

  const mod = nativeModule();
  if (!mod || typeof mod.installApk !== 'function') {
    emitFailed('SoulbitsApkInstall native module is unavailable', progress);
    return;
  }

  let allowed: boolean;
  try {
    allowed = typeof mod.canInstall === 'function' ? await mod.canInstall() : false;
  } catch (e) {
    emitFailed(`install permission check failed: ${errorMessage(e)}`, progress);
    return;
  }
  if (!allowed) {
    log.info('Install permission missing; cannot launch the installer');
    emitFailed(INSTALL_PERMISSION_REQUIRED, progress);
    return;
  }

  log.info('Launching the system installer');
  emit({ phase: 'installing', progress, error: null });
  try {
    const launched = await mod.installApk(destPath);
    if (launched === false) {
      // The intent did not launch (no activity / user declined). Keep the file so
      // the user can re-tap install after granting permission.
      log.warn('The system installer did not launch');
    }
  } catch (e) {
    log.warn('Could not launch the system installer:', errorMessage(e));
    emitFailed(errorMessage(e), progress);
    return;
  }

  // Back to `ready`: the file stays, so backing out of the installer allows a retry.
  emit({ phase: 'ready', progress, error: null });
}

// ── Cold start ──────────────────────────────────────────────────────────

/**
 * Read the sidecar and stat the artifact. Cleans up anything unusable (stale
 * sidecar, empty file, orphans of other versions, legacy timestamped files).
 * Returns null when there is no resumable/installable download.
 */
export async function findPendingApkDownload(): Promise<PendingApkDownload | null> {
  const sidecar = await readSidecar();

  if (!sidecar) {
    await cleanOrphanApkFiles(null);
    return null;
  }

  const size = await statSize(sidecar.destPath);
  if (size == null || size <= 0) {
    log.info(`Dropping the pending update sidecar (no usable artifact for ${sidecar.version})`);
    await clearSidecar();
    await cleanOrphanApkFiles(null);
    return null;
  }

  await cleanOrphanApkFiles(sidecar.destPath);

  const complete = sidecar.contentLength != null && size === sidecar.contentLength;
  return {
    version: sidecar.version,
    url: sidecar.url,
    bytesFetched: size,
    contentLength: sidecar.contentLength,
    percent: computePercent(size, sidecar.contentLength),
    complete,
  };
}
