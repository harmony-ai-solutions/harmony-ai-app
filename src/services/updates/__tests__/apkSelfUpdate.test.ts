/**
 * apkSelfUpdate — observable, resumable APK download ("Auto-Update UX"
 * phases 1+2).
 *
 * The service owns the whole mechanism: permission-first gating, an observable
 * phase/progress state, a DETERMINISTIC destination + AsyncStorage sidecar, and
 * a range-based resume (probe → ~2 MiB chunks → append). This suite drives it
 * entirely through the test seams (`setApkDownloadFsForTests`,
 * `setApkInstallModuleForTests`, `setApkDownloadFetchForTests`), so no real
 * filesystem, timer or network is involved.
 *
 * The global jest setup mocks Platform.OS='ios'; this suite re-mocks the RN
 * Platform module to 'android' because the whole feature is Android-only.
 */

jest.mock('../../../utils/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

jest.mock('react-native/Libraries/Utilities/Platform', () => ({
  __esModule: true,
  default: {
    OS: 'android',
    select: (obj: Record<string, unknown>) => obj.android ?? obj.default,
  },
}));

const store: Record<string, string> = {};
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (k: string) => (k in store ? store[k] : null)),
    setItem: jest.fn(async (k: string, v: string) => {
      store[k] = v;
    }),
    removeItem: jest.fn(async (k: string) => {
      delete store[k];
    }),
    clear: jest.fn(async () => {
      for (const k of Object.keys(store)) delete store[k];
    }),
  },
}));

import { base64ToUint8Array } from '../../../database/base64';
import {
  APK_DOWNLOAD_SIDECAR_KEY,
  INSTALL_PERMISSION_REQUIRED,
  beginApkSelfUpdate,
  cancelApkSelfUpdate,
  findPendingApkDownload,
  getApkDownloadState,
  installDownloadedApk,
  onApkDownloadStateChange,
  resetApkDownloadStateForTests,
  setApkDownloadFetchForTests,
  setApkDownloadFsForTests,
  setApkInstallModuleForTests,
} from '../apkSelfUpdate';
import type {
  ApkDownloadFileOptions,
  ApkDownloadFileResult,
  ApkDownloadProgress,
  ApkDownloadState,
  ApkReadDirItemLike,
} from '../apkSelfUpdate';

const CACHE_DIR = '/cache';
const VERSION = '1.4.0';
const URL = 'https://download.soulbits.app/app/v1.4.0/dev/soulbits-v1.4.0.apk';
const DEST = `${CACHE_DIR}/soulbits-update-1.4.0.apk`;
/** Mirrors the service's resume chunk size (2 MiB). */
const CHUNK = 2 * 1024 * 1024;

// ── Fakes ───────────────────────────────────────────────────────────────

interface FakeFs {
  /** path → size in bytes (content is irrelevant except for append order). */
  files: Map<string, number>;
  appends: Array<{ path: string; bytes: Uint8Array }>;
  stat: jest.Mock;
  unlink: jest.Mock;
  readDir: jest.Mock;
  appendFile: jest.Mock;
  downloadFile: jest.Mock;
  stopDownload: jest.Mock;
}

function createFakeFs(): FakeFs {
  const files = new Map<string, number>();
  const appends: Array<{ path: string; bytes: Uint8Array }> = [];

  const stat = jest.fn(async (path: string) => {
    const size = files.get(path);
    if (size == null) throw new Error(`ENOENT: ${path}`);
    return { size };
  });
  const unlink = jest.fn(async (path: string) => {
    if (!files.delete(path)) throw new Error(`ENOENT: ${path}`);
  });
  const readDir = jest.fn(async (dir: string) =>
    [...files.keys()]
      .filter(p => p.startsWith(`${dir}/`))
      .map(
        (p): ApkReadDirItemLike => ({
          name: p.slice(dir.length + 1),
          path: p,
          size: files.get(p) ?? 0,
        }),
      ),
  );
  const appendFile = jest.fn(async (path: string, contents: string) => {
    const bytes = base64ToUint8Array(contents);
    appends.push({ path, bytes });
    files.set(path, (files.get(path) ?? 0) + bytes.length);
  });
  const downloadFile = jest.fn();
  const stopDownload = jest.fn();

  return { files, appends, stat, unlink, readDir, appendFile, downloadFile, stopDownload };
}

function useFakeFs(fs: FakeFs): void {
  setApkDownloadFsForTests({
    CachesDirectoryPath: CACHE_DIR,
    stat: fs.stat,
    unlink: fs.unlink,
    readDir: fs.readDir,
    appendFile: fs.appendFile,
    downloadFile: fs.downloadFile,
    stopDownload: fs.stopDownload,
  });
}

/** A byte buffer filled with `fill` (Uint8Array coerces to 0–255 itself). */
function bytesOf(length: number, fill: number): Uint8Array {
  const bytes = new Uint8Array(length);
  bytes.fill(fill);
  return bytes;
}

function rangeResponse(
  status: number,
  contentRange: string | null,
  body: Uint8Array = new Uint8Array(0),
): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get: (name: string) => (name.toLowerCase() === 'content-range' ? contentRange : null),
    },
    arrayBuffer: async () => body.buffer as ArrayBuffer,
  } as unknown as Response;
}

/** RNFS `downloadFile` write a complete file after emitting `steps`. */
function serveDownload(
  fs: FakeFs,
  opts: {
    /** reported Content-Length (null → RNFS reports -1, i.e. unknown). */
    reportedLength?: number | null;
    /** bytes actually written to disk (defaults to the reported length). */
    fileSize?: number;
    steps?: number[];
    statusCode?: number;
  } = {},
): void {
  const reported = opts.reportedLength === null ? -1 : opts.reportedLength ?? 1000;
  const fileSize = opts.fileSize ?? (reported > 0 ? reported : 0);
  const steps = opts.steps ?? [1000];
  const statusCode = opts.statusCode ?? 200;

  fs.downloadFile.mockImplementation((options: ApkDownloadFileOptions) => {
    const jobId = 7;
    const promise = (async (): Promise<ApkDownloadFileResult> => {
      await Promise.resolve();
      options.begin?.({ jobId, contentLength: reported, statusCode, headers: {} });
      for (const step of steps) {
        await Promise.resolve();
        options.progress?.({ jobId, contentLength: reported, bytesWritten: step });
      }
      if (statusCode === 200) fs.files.set(options.toFile, fileSize);
      return { jobId, statusCode, bytesWritten: fileSize };
    })();
    return { jobId, promise };
  });
}

function headerOf(init: RequestInit | undefined, name: string): string | null {
  const headers = (init?.headers ?? {}) as Record<string, string>;
  return headers[name] ?? null;
}

/** A range-capable server: `bytes=0-0` probes, then serves each chunk. */
function serveRanges(
  opts: {
    total: number;
    /** byte value for a chunk starting at `start` (lets tests assert order). */
    fill?: (start: number, call: number) => number;
    /** return a response to short-circuit the default 206 chunk behaviour. */
    intercept?: (range: string, call: number) => Response | null;
  },
): { fetchMock: jest.Mock; ranges: string[] } {
  const ranges: string[] = [];
  const fetchMock = jest.fn(async (_url: string, init?: RequestInit) => {
    const range = headerOf(init, 'Range') ?? '';
    ranges.push(range);
    const call = ranges.length;
    const intercepted = opts.intercept?.(range, call) ?? null;
    if (intercepted) return intercepted;

    if (range === 'bytes=0-0') return rangeResponse(206, `bytes 0-0/${opts.total}`);
    const match = /^bytes=(\d+)-(\d+)$/.exec(range);
    if (!match) return rangeResponse(416, null);
    const start = Number(match[1]);
    const end = Number(match[2]);
    const fill = opts.fill ? opts.fill(start, call) : 1;
    return rangeResponse(206, `bytes ${start}-${end}/${opts.total}`, bytesOf(end - start + 1, fill));
  });
  setApkDownloadFetchForTests(fetchMock);
  return { fetchMock, ranges };
}

function seedSidecar(contentLength: number | null): void {
  store[APK_DOWNLOAD_SIDECAR_KEY] = JSON.stringify({
    version: VERSION,
    url: URL,
    contentLength,
    destPath: DEST,
  });
}

function sidecar(): Record<string, unknown> | null {
  const raw = store[APK_DOWNLOAD_SIDECAR_KEY];
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
}

function downloadingProgress(): ApkDownloadProgress[] {
  return emissions.filter(e => e.phase === 'downloading').map(e => e.progress as ApkDownloadProgress);
}

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

// ── Setup ───────────────────────────────────────────────────────────────

let fs: FakeFs;
let install: { canInstall: jest.Mock; installApk: jest.Mock; openInstallSettings: jest.Mock };
let fetchMock: jest.Mock;
let emissions: ApkDownloadState[];

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  resetApkDownloadStateForTests();

  fs = createFakeFs();
  useFakeFs(fs);

  install = {
    canInstall: jest.fn(async () => true),
    installApk: jest.fn(async () => true),
    openInstallSettings: jest.fn(async () => true),
  };
  setApkInstallModuleForTests(install);

  fetchMock = jest.fn(async () => rangeResponse(206, 'bytes 0-0/0'));
  setApkDownloadFetchForTests(fetchMock);

  emissions = [];
  onApkDownloadStateChange(next => emissions.push(next));
});

// ── Fresh download ──────────────────────────────────────────────────────

describe('beginApkSelfUpdate — fresh download', () => {
  it('reports progress and ends ready, writing the sidecar', async () => {
    serveDownload(fs, { reportedLength: 1000, steps: [250, 500, 1000] });

    await beginApkSelfUpdate(VERSION, URL);

    expect(install.canInstall).toHaveBeenCalledTimes(1);
    expect(emissions[0].phase).toBe('downloading');
    expect(emissions[emissions.length - 1].phase).toBe('ready');

    const progress = downloadingProgress();
    expect(progress.map(p => p.bytesFetched)).toEqual([0, 250, 500, 1000]);
    expect(progress.map(p => p.percent)).toEqual([null, 25, 50, 100]);
    for (const p of progress) {
      expect(p.version).toBe(VERSION);
      expect(p.url).toBe(URL);
    }

    const state = getApkDownloadState();
    expect(state).toEqual({
      phase: 'ready',
      progress: {
        version: VERSION,
        url: URL,
        bytesFetched: 1000,
        contentLength: 1000,
        percent: 100,
      },
      error: null,
    });
    expect(fs.files.get(DEST)).toBe(1000);
    expect(sidecar()).toEqual({
      version: VERSION,
      url: URL,
      contentLength: 1000,
      destPath: DEST,
    });
  });

  it('uses a deterministic destination and asks RNFS for 250ms progress', async () => {
    serveDownload(fs, { reportedLength: 42, steps: [42] });

    await beginApkSelfUpdate(VERSION, URL);

    const options = fs.downloadFile.mock.calls[0][0] as ApkDownloadFileOptions;
    expect(options.fromUrl).toBe(URL);
    expect(options.toFile).toBe(`${CACHE_DIR}/soulbits-update-1.4.0.apk`);
    expect(options.progressInterval).toBe(250);
  });

  it('fails with the permission sentinel BEFORE touching the network or disk', async () => {
    install.canInstall.mockResolvedValueOnce(false);

    await beginApkSelfUpdate(VERSION, URL);

    const state = getApkDownloadState();
    expect(state.phase).toBe('failed');
    expect(state.error).toBe(INSTALL_PERMISSION_REQUIRED);
    expect(fs.downloadFile).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(fs.stat).not.toHaveBeenCalled();
    expect(sidecar()).toBeNull();
  });

  it('ignores a second begin while a download is active', async () => {
    const deferred: { resolve: ((r: ApkDownloadFileResult) => void) | null } = { resolve: null };
    fs.downloadFile.mockImplementation((options: ApkDownloadFileOptions) => {
      const jobId = 11;
      options.begin?.({ jobId, contentLength: 1000, statusCode: 200, headers: {} });
      return {
        jobId,
        promise: new Promise<ApkDownloadFileResult>(resolve => {
          deferred.resolve = resolve;
        }),
      };
    });

    const first = beginApkSelfUpdate(VERSION, URL);
    await flush();
    await beginApkSelfUpdate(VERSION, URL);

    expect(fs.downloadFile).toHaveBeenCalledTimes(1);
    expect(getApkDownloadState().phase).toBe('downloading');

    deferred.resolve?.({ jobId: 11, statusCode: 200, bytesWritten: 0 });
    await first;
  });

  it('cleans up and fails when the downloaded size does not match the total', async () => {
    serveDownload(fs, { reportedLength: 1000, fileSize: 800, steps: [800] });

    await beginApkSelfUpdate(VERSION, URL);

    const state = getApkDownloadState();
    expect(state.phase).toBe('failed');
    expect(state.error).toContain('incomplete');
    expect(fs.unlink).toHaveBeenCalledWith(DEST);
    expect(sidecar()).toBeNull();
  });

  it('keeps the partial + sidecar on a network failure', async () => {
    fs.downloadFile.mockImplementation((options: ApkDownloadFileOptions) => {
      const jobId = 13;
      const promise = (async (): Promise<ApkDownloadFileResult> => {
        await Promise.resolve();
        options.begin?.({ jobId, contentLength: 1000, statusCode: 200, headers: {} });
        options.progress?.({ jobId, contentLength: 1000, bytesWritten: 300 });
        fs.files.set(options.toFile, 300);
        throw new Error('network unreachable');
      })();
      return { jobId, promise };
    });

    await beginApkSelfUpdate(VERSION, URL);

    const state = getApkDownloadState();
    expect(state.phase).toBe('failed');
    expect(state.error).toContain('network unreachable');
    expect(fs.files.get(DEST)).toBe(300);
    expect(sidecar()?.contentLength).toBe(1000);
    expect(fs.unlink).not.toHaveBeenCalled();
  });
});

// ── Unknown total ───────────────────────────────────────────────────────

describe('beginApkSelfUpdate — unknown Content-Length', () => {
  it('reports percent null end-to-end (indeterminate)', async () => {
    serveDownload(fs, { reportedLength: null, fileSize: 1200, steps: [300, 1200] });

    await beginApkSelfUpdate(VERSION, URL);

    const progress = downloadingProgress();
    expect(progress.map(p => p.contentLength)).toEqual([null, null, null]);
    expect(progress.map(p => p.percent)).toEqual([null, null, null]);

    const state = getApkDownloadState();
    expect(state.phase).toBe('ready');
    expect(state.progress).toEqual({
      version: VERSION,
      url: URL,
      bytesFetched: 1200,
      contentLength: null,
      percent: null,
    });
    expect(sidecar()?.contentLength).toBeNull();
  });
});

// ── Resume ──────────────────────────────────────────────────────────────

describe('beginApkSelfUpdate — resume', () => {
  it('resumes a partial at its on-disk offset and appends the remaining bytes', async () => {
    fs.files.set(DEST, 400);
    seedSidecar(1000);
    const { ranges } = serveRanges({ total: 1000, fill: () => 7 });

    await beginApkSelfUpdate(VERSION, URL);

    expect(ranges).toEqual(['bytes=0-0', 'bytes=400-999']);
    expect(fs.appendFile).toHaveBeenCalledTimes(1);
    expect(fs.appends[0].path).toBe(DEST);
    expect(fs.appends[0].bytes.length).toBe(600);
    expect(fs.appends[0].bytes[0]).toBe(7);
    expect(fs.files.get(DEST)).toBe(1000);
    expect(sidecar()?.contentLength).toBe(1000);

    // Progress starts at the resumed offset, then reaches the total.
    const resumed = downloadingProgress().filter(p => p.contentLength === 1000);
    expect(resumed.map(p => p.bytesFetched)).toEqual([400, 1000]);
    expect(resumed.map(p => p.percent)).toEqual([40, 100]);

    expect(getApkDownloadState().phase).toBe('ready');
    expect(getApkDownloadState().progress?.percent).toBe(100);
  });

  it('appends multiple chunks in order', async () => {
    fs.files.set(DEST, 100);
    seedSidecar(CHUNK + 600);
    const { ranges } = serveRanges({
      total: CHUNK + 600,
      fill: (start, call) => call, // 2 → first chunk, 3 → second chunk
    });

    await beginApkSelfUpdate(VERSION, URL);

    expect(ranges).toEqual([
      'bytes=0-0',
      `bytes=100-${CHUNK + 99}`,
      `bytes=${CHUNK + 100}-${CHUNK + 599}`,
    ]);
    expect(fs.appends).toHaveLength(2);
    expect(fs.appends[0].bytes.length).toBe(CHUNK);
    expect(fs.appends[1].bytes.length).toBe(500);
    expect(fs.appends.map(a => a.bytes[0])).toEqual([2, 3]);
    expect(fs.files.get(DEST)).toBe(CHUNK + 600);
    expect(getApkDownloadState().phase).toBe('ready');
  });

  it('skips the network entirely when the artifact is already complete', async () => {
    fs.files.set(DEST, 1000);
    seedSidecar(1000);

    await beginApkSelfUpdate(VERSION, URL);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(fs.downloadFile).not.toHaveBeenCalled();
    expect(getApkDownloadState().phase).toBe('ready');
    expect(getApkDownloadState().progress?.bytesFetched).toBe(1000);
  });

  it('restarts fresh when the server ignores the Range probe (200)', async () => {
    fs.files.set(DEST, 400);
    seedSidecar(1000);
    fetchMock.mockResolvedValue(rangeResponse(200, null, bytesOf(1000, 1)));
    serveDownload(fs, { reportedLength: 1000, steps: [1000] });

    await beginApkSelfUpdate(VERSION, URL);

    expect(fs.unlink).toHaveBeenCalledWith(DEST);
    expect(fs.downloadFile).toHaveBeenCalledTimes(1);
    expect(fs.appendFile).not.toHaveBeenCalled();
    expect(fs.files.get(DEST)).toBe(1000);
    expect(getApkDownloadState().phase).toBe('ready');
  });

  it('restarts fresh when the probed total differs from the sidecar (artifact changed)', async () => {
    fs.files.set(DEST, 400);
    seedSidecar(1000);
    const { fetchMock: rangeFetch } = serveRanges({ total: 1200 });
    serveDownload(fs, { reportedLength: 1200, steps: [1200] });

    await beginApkSelfUpdate(VERSION, URL);

    expect(rangeFetch).toHaveBeenCalledTimes(1); // probe only — no chunks
    expect(fs.unlink).toHaveBeenCalledWith(DEST);
    expect(fs.downloadFile).toHaveBeenCalledTimes(1);
    expect(fs.files.get(DEST)).toBe(1200);
    expect(sidecar()?.contentLength).toBe(1200);
  });

  it('adopts the probed total when the sidecar had none', async () => {
    fs.files.set(DEST, 400);
    seedSidecar(null);
    serveRanges({ total: 1000, fill: () => 3 });

    await beginApkSelfUpdate(VERSION, URL);

    expect(sidecar()?.contentLength).toBe(1000);
    expect(fs.files.get(DEST)).toBe(1000);
    expect(getApkDownloadState().phase).toBe('ready');
    expect(getApkDownloadState().progress?.percent).toBe(100);
  });

  it('keeps the partial and fails when a chunk comes back 200 (wrong offset)', async () => {
    fs.files.set(DEST, 400);
    seedSidecar(1000);
    serveRanges({
      total: 1000,
      intercept: range => (range === 'bytes=0-0' ? null : rangeResponse(200, null, bytesOf(600, 9))),
    });

    await beginApkSelfUpdate(VERSION, URL);

    const state = getApkDownloadState();
    expect(state.phase).toBe('failed');
    expect(state.error).toContain('HTTP 200');
    expect(fs.appendFile).not.toHaveBeenCalled();
    expect(fs.files.get(DEST)).toBe(400);
    expect(fs.unlink).not.toHaveBeenCalled();
    expect(sidecar()?.contentLength).toBe(1000);
  });
});

// ── Cancel ──────────────────────────────────────────────────────────────

describe('cancelApkSelfUpdate', () => {
  it('stops the RNFS job and removes the partial + sidecar mid-download', async () => {
    const rejecters: { reject: ((e: Error) => void) | null } = { reject: null };
    fs.downloadFile.mockImplementation((options: ApkDownloadFileOptions) => {
      const jobId = 42;
      options.begin?.({ jobId, contentLength: 1000, statusCode: 200, headers: {} });
      options.progress?.({ jobId, contentLength: 1000, bytesWritten: 300 });
      fs.files.set(options.toFile, 300);
      return {
        jobId,
        promise: new Promise<ApkDownloadFileResult>((_resolve, reject) => {
          rejecters.reject = reject;
        }),
      };
    });
    fs.stopDownload.mockImplementation(() => rejecters.reject?.(new Error('Download stopped')));

    const run = beginApkSelfUpdate(VERSION, URL);
    await flush();
    expect(getApkDownloadState().phase).toBe('downloading');
    expect(fs.files.get(DEST)).toBe(300);

    await cancelApkSelfUpdate();
    await run;

    expect(fs.stopDownload).toHaveBeenCalledWith(42);
    expect(fs.unlink).toHaveBeenCalledWith(DEST);
    expect(fs.files.has(DEST)).toBe(false);
    expect(sidecar()).toBeNull();
    expect(getApkDownloadState()).toEqual({ phase: 'idle', progress: null, error: null });
    expect(emissions[emissions.length - 1].phase).toBe('idle');
  });

  it('stops the chunk loop without appending the in-flight chunk', async () => {
    fs.files.set(DEST, 400);
    seedSidecar(1000);
    const cancelRef: { promise: Promise<void> | null } = { promise: null };
    serveRanges({
      total: 1000,
      intercept: range => {
        if (range === 'bytes=0-0') return null;
        cancelRef.promise = cancelApkSelfUpdate();
        return rangeResponse(206, 'bytes 400-999/1000', bytesOf(600, 5));
      },
    });

    const run = beginApkSelfUpdate(VERSION, URL);
    await run;
    if (cancelRef.promise) await cancelRef.promise;

    expect(fs.appendFile).not.toHaveBeenCalled();
    expect(fs.unlink).toHaveBeenCalledWith(DEST);
    expect(sidecar()).toBeNull();
    expect(getApkDownloadState()).toEqual({ phase: 'idle', progress: null, error: null });
  });

  it('clears a persisted partial even when nothing is running', async () => {
    fs.files.set(DEST, 400);
    seedSidecar(1000);

    await cancelApkSelfUpdate();

    expect(fs.files.has(DEST)).toBe(false);
    expect(sidecar()).toBeNull();
    expect(getApkDownloadState().phase).toBe('idle');
  });
});

// ── Cold start ──────────────────────────────────────────────────────────

describe('findPendingApkDownload', () => {
  it('reports a complete artifact as ready-to-install', async () => {
    fs.files.set(DEST, 1000);
    seedSidecar(1000);

    const pending = await findPendingApkDownload();

    expect(pending).toEqual({
      version: VERSION,
      url: URL,
      bytesFetched: 1000,
      contentLength: 1000,
      percent: 100,
      complete: true,
    });
    expect(fs.unlink).not.toHaveBeenCalled();
  });

  it('reports a resumable partial with its real on-disk percent', async () => {
    fs.files.set(DEST, 250);
    seedSidecar(1000);

    const pending = await findPendingApkDownload();

    expect(pending).toEqual({
      version: VERSION,
      url: URL,
      bytesFetched: 250,
      contentLength: 1000,
      percent: 25,
      complete: false,
    });
  });

  it('drops a stale sidecar whose file is gone', async () => {
    seedSidecar(1000);

    const pending = await findPendingApkDownload();

    expect(pending).toBeNull();
    expect(sidecar()).toBeNull();
  });

  it('unlinks legacy timestamped leftovers and other versions, keeping the current artifact', async () => {
    fs.files.set(DEST, 250);
    fs.files.set(`${CACHE_DIR}/soulbits-update-1699999999999.apk`, 900);
    fs.files.set(`${CACHE_DIR}/soulbits-update-1.3.0.apk`, 700);
    fs.files.set(`${CACHE_DIR}/unrelated.log`, 10);
    seedSidecar(1000);

    const pending = await findPendingApkDownload();

    expect(pending?.version).toBe(VERSION);
    expect(fs.files.has(`${CACHE_DIR}/soulbits-update-1699999999999.apk`)).toBe(false);
    expect(fs.files.has(`${CACHE_DIR}/soulbits-update-1.3.0.apk`)).toBe(false);
    expect(fs.files.has(DEST)).toBe(true);
    expect(fs.files.has(`${CACHE_DIR}/unrelated.log`)).toBe(true);
  });

  it('removes every APK artifact when there is no sidecar', async () => {
    fs.files.set(`${CACHE_DIR}/soulbits-update-1699999999999.apk`, 900);
    fs.files.set(`${CACHE_DIR}/soulbits-update-1.3.0.apk`, 700);

    const pending = await findPendingApkDownload();

    expect(pending).toBeNull();
    expect(fs.files.has(`${CACHE_DIR}/soulbits-update-1699999999999.apk`)).toBe(false);
    expect(fs.files.has(`${CACHE_DIR}/soulbits-update-1.3.0.apk`)).toBe(false);
  });
});

// ── Install ─────────────────────────────────────────────────────────────

describe('installDownloadedApk', () => {
  async function reachReady(): Promise<void> {
    serveDownload(fs, { reportedLength: 1000, steps: [1000] });
    await beginApkSelfUpdate(VERSION, URL);
    expect(getApkDownloadState().phase).toBe('ready');
  }

  it('emits installing → ready and launches the system installer', async () => {
    await reachReady();
    emissions = [];

    await installDownloadedApk();

    expect(install.installApk).toHaveBeenCalledWith(DEST);
    expect(emissions.map(e => e.phase)).toEqual(['installing', 'ready']);
    const state = getApkDownloadState();
    expect(state.phase).toBe('ready');
    expect(state.error).toBeNull();
    // The artifact stays so the user can re-tap install after backing out.
    expect(fs.files.get(DEST)).toBe(1000);
  });

  it('fails with the sentinel when the permission was revoked', async () => {
    await reachReady();
    install.canInstall.mockResolvedValueOnce(false);

    await installDownloadedApk();

    const state = getApkDownloadState();
    expect(state.phase).toBe('failed');
    expect(state.error).toBe(INSTALL_PERMISSION_REQUIRED);
    expect(install.installApk).not.toHaveBeenCalled();
  });

  it('surfaces a launch failure from the native module', async () => {
    await reachReady();
    install.installApk.mockRejectedValueOnce(new Error('no_activity'));

    await installDownloadedApk();

    const state = getApkDownloadState();
    expect(state.phase).toBe('failed');
    expect(state.error).toBe('no_activity');
  });

  it('is a no-op outside the ready phase', async () => {
    await installDownloadedApk();

    expect(install.canInstall).not.toHaveBeenCalled();
    expect(install.installApk).not.toHaveBeenCalled();
    expect(getApkDownloadState().phase).toBe('idle');
    expect(emissions).toHaveLength(0);
  });
});
