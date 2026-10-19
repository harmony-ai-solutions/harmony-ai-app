/**
 * appLogs — on-device capture of the app's own log stream.
 *
 * The app logger (`src/utils/logger.ts`) historically wrote console-only
 * (logcat), and RELEASE builds filtered to ERROR — so warn/info diagnostics
 * were discarded on-device. This module adds a bounded in-memory ring buffer
 * (info+ in release, debug+ in dev) plus best-effort, non-blocking persistence
 * so the owner can read/share app logs straight from a phone with no USB.
 *
 * Hard rule: every capture/persist path is try/catch-guarded. Logging must
 * NEVER throw into app code.
 *
 * The buffer is a module singleton ({@link appLogBuffer}); the pure pieces are
 * exported for unit tests.
 */

import RNFS from 'react-native-fs';

// ── Constants ────────────────────────────────────────────────────────────────

/** Max retained entries (drop oldest past this). */
export const APP_LOG_MAX_ENTRIES = 4000;
/** Max retained formatted bytes (drop oldest past this). ~512 KB. */
export const APP_LOG_MAX_BYTES = 512 * 1024;
/** Bounded tail persisted to storage (survives restart/crash). ~128 KB. */
export const APP_LOG_TAIL_BYTES = 128 * 1024;
/** Periodic flush cadence while dirty (ms). */
export const APP_LOG_FLUSH_INTERVAL_MS = 30_000;
/** Persisted log file name (app documents dir). */
export const APP_LOG_FILE_NAME = 'soulbits-app-logs.txt';

/** App-log severity levels, ascending. */
export const APP_LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type AppLogLevel = (typeof APP_LOG_LEVELS)[number];

// ── Types ────────────────────────────────────────────────────────────────────

/** One captured log entry. */
export interface AppLogEntry {
  /** Process-local monotonic id (stable FlatList key). */
  id: number;
  /** ISO-8601 timestamp. */
  timestamp: string;
  /** Level text (`debug` | `info` | `warn` | `error`). */
  level: string;
  /** Logger namespace/extension (e.g. `[ServiceName]`), or null. */
  namespace: string | null;
  /** Formatted message body (Error objects keep message + stack). */
  message: string;
  /** True when loaded back from a previous session's persisted tail. */
  previousSession?: boolean;
}

/** The persisted (id-less) shape written to storage. */
export interface PersistedAppLogEntry {
  timestamp: string;
  level: string;
  namespace: string | null;
  message: string;
}

/** Filter criteria for {@link AppLogRingBuffer.filter}. */
export interface AppLogFilter {
  /** Minimum level (severity threshold); null/undefined = all levels. */
  minLevel?: string | null;
  /** Case-insensitive substring matched against message + namespace + level. */
  search?: string;
}

// ── Pure helpers (exported for tests) ────────────────────────────────────────

/** Severity rank for a level (higher = more severe); unknown → 0. */
export function levelRank(level: string): number {
  const idx = APP_LOG_LEVELS.indexOf(String(level).toLowerCase() as AppLogLevel);
  return idx === -1 ? 0 : idx;
}

/** UTF-8 byte length of a string (no TextEncoder dependency). */
export function utf8ByteLength(str: string): number {
  let bytes = 0;
  for (let i = 0; i < str.length; i += 1) {
    const code = str.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      // surrogate pair → 4 bytes (consume the low surrogate too)
      bytes += 4;
      i += 1;
    } else bytes += 3;
  }
  return bytes;
}

/** Per-entry overhead (timestamp + level + namespace separators) in bytes. */
const ENTRY_OVERHEAD_BYTES = 32;

/** Approximate formatted byte size of an entry. */
export function entryByteSize(entry: AppLogEntry | PersistedAppLogEntry): number {
  return (
    utf8ByteLength(entry.message ?? '') +
    utf8ByteLength(entry.namespace ?? '') +
    ENTRY_OVERHEAD_BYTES
  );
}

/**
 * Format a transport's raw message args into the human-readable body, reusing
 * the logger's conventions: strings verbatim, Errors as `message\nstack`,
 * everything else JSON. Never throws.
 */
export function formatLogMessage(rawMsg: unknown): string {
  try {
    const args = Array.isArray(rawMsg) ? rawMsg : [rawMsg];
    return args
      .map(arg => {
        if (typeof arg === 'string') return arg;
        if (arg instanceof Error) return arg.stack || arg.message;
        try {
          return JSON.stringify(arg);
        } catch {
          return String(arg);
        }
      })
      .join(' ');
  } catch {
    return '';
  }
}

// ── Ring buffer ──────────────────────────────────────────────────────────────

/**
 * Pure filter: severity threshold + case-insensitive substring search across
 * message, namespace and level. Exported for the viewer + unit tests.
 */
export function filterAppLogEntries(
  entries: readonly AppLogEntry[],
  criteria: AppLogFilter = {},
): AppLogEntry[] {
  const minRank = criteria.minLevel ? levelRank(criteria.minLevel) : -1;
  const needle = (criteria.search ?? '').trim().toLowerCase();
  return entries.filter(entry => {
    if (minRank >= 0 && levelRank(entry.level) < minRank) return false;
    if (needle) {
      const haystack = `${entry.message} ${entry.namespace ?? ''} ${entry.level}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });
}

/**
 * Bounded FIFO ring buffer. Oldest entries are evicted when either the entry
 * count or the formatted byte budget is exceeded.
 */
export class AppLogRingBuffer {
  private entries: AppLogEntry[] = [];
  private bytes = 0;
  private nextId = 1;
  private version = 0;

  private readonly maxEntries: number;
  private readonly maxBytes: number;

  constructor(opts: { maxEntries?: number; maxBytes?: number } = {}) {
    this.maxEntries = opts.maxEntries ?? APP_LOG_MAX_ENTRIES;
    this.maxBytes = opts.maxBytes ?? APP_LOG_MAX_BYTES;
  }

  /** Append one entry; returns the stored entry (or null on failure). */
  push(input: Omit<AppLogEntry, 'id' | 'previousSession'>): AppLogEntry | null {
    try {
      const entry: AppLogEntry = { id: this.nextId, ...input };
      this.nextId += 1;
      this.entries.push(entry);
      this.bytes += entryByteSize(entry);
      this.evict();
      this.version += 1;
      return entry;
    } catch {
      return null;
    }
  }

  /**
   * Prepend previous-session history (older than anything in-session), re-id'd
   * and marked `previousSession`, then re-enforce the caps.
   */
  prependHistory(inputs: PersistedAppLogEntry[]): number {
    try {
      if (!Array.isArray(inputs) || inputs.length === 0) return 0;
      const history: AppLogEntry[] = inputs.map(input => {
        const entry: AppLogEntry = {
          id: this.nextId,
          timestamp: String(input.timestamp ?? ''),
          level: String(input.level ?? 'info'),
          namespace: input.namespace ?? null,
          message: String(input.message ?? ''),
          previousSession: true,
        };
        this.nextId += 1;
        return entry;
      });
      this.entries = [...history, ...this.entries];
      this.bytes += history.reduce((sum, e) => sum + entryByteSize(e), 0);
      this.evict();
      this.version += 1;
      return history.length;
    } catch {
      return 0;
    }
  }

  /** Drop oldest entries until both caps are satisfied. */
  private evict(): void {
    while (
      this.entries.length > this.maxEntries ||
      (this.bytes > this.maxBytes && this.entries.length > 1)
    ) {
      const removed = this.entries.shift();
      if (!removed) break;
      this.bytes -= entryByteSize(removed);
    }
    if (this.bytes < 0) this.bytes = 0;
  }

  /** All entries, oldest → newest (do not mutate). */
  getEntries(): readonly AppLogEntry[] {
    return this.entries;
  }

  /** The newest `limit` entries, oldest → newest. */
  getRecentEntries(limit: number): AppLogEntry[] {
    if (limit <= 0) return [];
    return this.entries.slice(-limit);
  }

  /** The newest entries fitting within `maxBytes`, oldest → newest. */
  getTailBytes(maxBytes: number): AppLogEntry[] {
    const tail: AppLogEntry[] = [];
    let total = 0;
    for (let i = this.entries.length - 1; i >= 0; i -= 1) {
      const size = entryByteSize(this.entries[i]);
      if (tail.length > 0 && total + size > maxBytes) break;
      tail.push(this.entries[i]);
      total += size;
    }
    return tail.reverse();
  }

  /** Entries matching the filter (severity threshold + substring search). */
  filter(criteria: AppLogFilter = {}): AppLogEntry[] {
    return filterAppLogEntries(this.entries, criteria);
  }

  /** Remove every entry. */
  clear(): void {
    this.entries = [];
    this.bytes = 0;
    this.version += 1;
  }

  size(): number {
    return this.entries.length;
  }

  byteSize(): number {
    return this.bytes;
  }

  /** Monotonic mutation counter (lets the viewer cheaply detect changes). */
  getVersion(): number {
    return this.version;
  }
}

/** The process-wide app-log buffer. */
export const appLogBuffer = new AppLogRingBuffer();

// ── Capture transport ────────────────────────────────────────────────────────

/**
 * Build a react-native-logs transport that records entries into `buffer`.
 * `onEntry` is notified with the level after a successful capture (used to
 * mark persistence dirty / flush on error). Never throws.
 */
export function makeCaptureTransport(
  buffer: AppLogRingBuffer,
  onEntry?: (level: string) => void,
): (props: any) => void {
  return (props: any) => {
    try {
      const level = props?.level?.text ?? 'info';
      const entry = buffer.push({
        timestamp: new Date().toISOString(),
        level,
        namespace: props?.extension ?? null,
        message: formatLogMessage(props?.rawMsg),
      });
      if (entry && onEntry) onEntry(level);
    } catch {
      /* never throw into app logging */
    }
  };
}

// ── Persistence (best-effort, non-blocking) ──────────────────────────────────

function isJest(): boolean {
  return (globalThis as unknown as { __JEST__?: boolean }).__JEST__ === true;
}

/** Absolute path of the persisted app-log tail. */
export function appLogFilePath(): string {
  return `${RNFS.DocumentDirectoryPath}/${APP_LOG_FILE_NAME}`;
}

let dirty = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushInterval: ReturnType<typeof setInterval> | null = null;

/** Serialize entries to the persisted JSON payload. */
export function serializeAppLogs(entries: AppLogEntry[]): string {
  const payload: PersistedAppLogEntry[] = entries.map(e => ({
    timestamp: e.timestamp,
    level: e.level,
    namespace: e.namespace,
    message: e.message,
  }));
  try {
    return JSON.stringify(payload);
  } catch {
    return '[]';
  }
}

/** Parse a persisted payload back into id-less entries. */
export function parseAppLogs(text: string): PersistedAppLogEntry[] {
  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(item => item && typeof item === 'object')
      .map(item => ({
        timestamp: String((item as any).timestamp ?? ''),
        level: String((item as any).level ?? 'info'),
        namespace: (item as any).namespace ?? null,
        message: String((item as any).message ?? ''),
      }));
  } catch {
    return [];
  }
}

/** Mark the buffer dirty; error-level entries flush immediately (debounced). */
export function markAppLogDirty(level?: string): void {
  dirty = true;
  if (level === 'error') scheduleAppLogFlush(0);
}

/** Schedule a flush on the next tick (no-op under Jest / when already queued). */
export function scheduleAppLogFlush(delayMs = 0): void {
  if (isJest()) return;
  if (flushTimer) return;
  try {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void flushAppLogTail();
    }, delayMs);
  } catch {
    /* ignore */
  }
}

/** Write the bounded tail to storage. Never throws; never blocks logging. */
export async function flushAppLogTail(): Promise<void> {
  try {
    if (!dirty) return;
    dirty = false;
    const tail = appLogBuffer.getTailBytes(APP_LOG_TAIL_BYTES);
    await RNFS.writeFile(appLogFilePath(), serializeAppLogs(tail), 'utf8');
  } catch {
    /* best-effort only */
  }
}

/** Begin the periodic flush loop (no-op under Jest). */
export function startAppLogPersistence(): void {
  if (isJest()) return;
  if (flushInterval) return;
  try {
    flushInterval = setInterval(() => {
      if (dirty) void flushAppLogTail();
    }, APP_LOG_FLUSH_INTERVAL_MS);
  } catch {
    /* ignore */
  }
}

/** Stop the periodic flush loop (test hygiene). */
export function stopAppLogPersistence(): void {
  if (flushInterval) {
    clearInterval(flushInterval);
    flushInterval = null;
  }
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
}

/**
 * Load the persisted tail back into the buffer (prepended, marked
 * previous-session). Returns the number of entries restored. Never throws.
 */
export async function loadPersistedAppLogs(): Promise<number> {
  try {
    const path = appLogFilePath();
    const exists = await RNFS.exists(path);
    if (!exists) return 0;
    const text = await RNFS.readFile(path, 'utf8');
    const entries = parseAppLogs(text);
    if (entries.length === 0) return 0;
    return appLogBuffer.prependHistory(entries);
  } catch {
    return 0;
  }
}

/** Delete the persisted tail. Never throws. */
export async function clearPersistedAppLogs(): Promise<void> {
  try {
    const path = appLogFilePath();
    const exists = await RNFS.exists(path);
    if (exists) await RNFS.unlink(path);
  } catch {
    /* best-effort only */
  }
}

/** Wipe the in-memory buffer AND the persisted tail. Never throws. */
export async function clearAllAppLogs(): Promise<void> {
  try {
    appLogBuffer.clear();
  } catch {
    /* ignore */
  }
  await clearPersistedAppLogs();
}

export default appLogBuffer;
