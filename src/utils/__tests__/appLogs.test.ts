/**
 * appLogs / logger capture — unit tests.
 *
 * Covers the ring-buffer caps (entries + bytes), release-mode capture config,
 * the capture transport, clear, persistence flush/load round-trip (mocked
 * react-native-fs) and the release console gate.
 */

import RNFS from 'react-native-fs';
import { logger } from 'react-native-logs';
import {
  AppLogRingBuffer,
  appLogBuffer,
  appLogFilePath,
  clearAllAppLogs,
  clearPersistedAppLogs,
  entryByteSize,
  filterAppLogEntries,
  flushAppLogTail,
  formatLogMessage,
  levelRank,
  loadPersistedAppLogs,
  makeCaptureTransport,
  markAppLogDirty,
  parseAppLogs,
  serializeAppLogs,
  utf8ByteLength,
} from '../appLogs';
import { buildLoggerConfig, makeConsoleGate } from '../logger';

function makeEntry(over: Partial<{ level: string; message: string; namespace: string | null }> = {}) {
  return {
    timestamp: '2026-10-19T10:00:00.000Z',
    level: over.level ?? 'info',
    namespace: over.namespace ?? '[Test]',
    message: over.message ?? 'hello',
  };
}

beforeEach(() => {
  appLogBuffer.clear();
  jest.clearAllMocks();
});

describe('AppLogRingBuffer', () => {
  it('evicts oldest entries past the entry cap', () => {
    const buffer = new AppLogRingBuffer({ maxEntries: 3 });
    for (let i = 0; i < 5; i += 1) buffer.push(makeEntry({ message: `m${i}` }));
    expect(buffer.size()).toBe(3);
    expect(buffer.getEntries().map(e => e.message)).toEqual(['m2', 'm3', 'm4']);
  });

  it('evicts oldest entries past the byte cap', () => {
    const long = 'x'.repeat(100);
    const buffer = new AppLogRingBuffer({ maxEntries: 100, maxBytes: 200 });
    buffer.push(makeEntry({ message: long }));
    buffer.push(makeEntry({ message: long }));
    // one 100-char entry (~132 bytes incl. overhead) fits; two do not
    expect(buffer.size()).toBe(1);
    expect(buffer.byteSize()).toBeLessThanOrEqual(200);
  });

  it('clears every entry and resets the byte count', () => {
    const buffer = new AppLogRingBuffer();
    buffer.push(makeEntry());
    buffer.push(makeEntry());
    buffer.clear();
    expect(buffer.size()).toBe(0);
    expect(buffer.byteSize()).toBe(0);
    expect(buffer.getEntries()).toEqual([]);
  });

  it('filters by severity threshold and search text', () => {
    const buffer = new AppLogRingBuffer();
    buffer.push(makeEntry({ level: 'info', message: 'hello world' }));
    buffer.push(makeEntry({ level: 'warn', message: 'careful' }));
    buffer.push(makeEntry({ level: 'error', message: 'boom' }));

    expect(buffer.filter({ minLevel: 'warn' }).map(e => e.level)).toEqual(['warn', 'error']);
    expect(buffer.filter({ search: 'BOOM' }).map(e => e.message)).toEqual(['boom']);
    expect(buffer.filter({ minLevel: 'error', search: 'nope' })).toEqual([]);
  });

  it('returns the newest entries for getRecentEntries and getTailBytes', () => {
    const buffer = new AppLogRingBuffer();
    for (let i = 0; i < 5; i += 1) buffer.push(makeEntry({ message: `m${i}` }));
    expect(buffer.getRecentEntries(2).map(e => e.message)).toEqual(['m3', 'm4']);
    const tail = buffer.getTailBytes(entryByteSize(buffer.getEntries()[0]) + 1);
    expect(tail.length).toBeLessThanOrEqual(2);
    // tail is chronological (oldest → newest)
    const msgs = tail.map(e => e.message);
    expect([...msgs].sort()).toEqual(msgs);
  });
});

describe('pure helpers', () => {
  it('ranks levels by severity', () => {
    expect(levelRank('debug')).toBe(0);
    expect(levelRank('error')).toBe(3);
    expect(levelRank('nonsense')).toBe(0);
  });

  it('counts UTF-8 bytes', () => {
    expect(utf8ByteLength('abc')).toBe(3);
    expect(utf8ByteLength('é')).toBe(2);
    expect(utf8ByteLength('😀')).toBe(4);
  });

  it('formats Error objects with message + stack', () => {
    const err = new Error('kaboom');
    const out = formatLogMessage([err]);
    expect(out).toContain('kaboom');
    expect(out).toContain('Error');
  });

  it('joins string and object args', () => {
    expect(formatLogMessage(['a', 1, { b: 2 }])).toBe('a 1 {"b":2}');
  });

  it('filters entries purely', () => {
    const entries = [
      { id: 1, timestamp: 't', level: 'info', namespace: '[A]', message: 'one' },
      { id: 2, timestamp: 't', level: 'error', namespace: null, message: 'two' },
    ];
    expect(filterAppLogEntries(entries, { minLevel: 'error' }).map(e => e.id)).toEqual([2]);
    expect(filterAppLogEntries(entries, { search: 'one' }).map(e => e.id)).toEqual([1]);
  });
});

describe('capture transport', () => {
  it('records level, namespace and formatted message', () => {
    const buffer = new AppLogRingBuffer();
    const seen: string[] = [];
    const transport = makeCaptureTransport(buffer, level => seen.push(level));
    transport({ level: { severity: 3, text: 'error' }, extension: '[Svc]', rawMsg: ['boom'] });
    expect(buffer.size()).toBe(1);
    expect(buffer.getEntries()[0]).toMatchObject({
      level: 'error',
      namespace: '[Svc]',
      message: 'boom',
    });
    expect(seen).toEqual(['error']);
  });

  it('never throws on malformed props', () => {
    const transport = makeCaptureTransport(new AppLogRingBuffer());
    expect(() => transport(undefined)).not.toThrow();
    expect(() => transport({})).not.toThrow();
  });
});

describe('release-mode logger config', () => {
  it('raises severity to info in release and keeps debug in dev', () => {
    expect(buildLoggerConfig(false, true).severity).toBe('info');
    expect(buildLoggerConfig(true, true).severity).toBe('debug');
    expect(Array.isArray(buildLoggerConfig(false, true).transport)).toBe(true);
  });

  it('captures info+ (not debug) into the buffer in release', () => {
    const release = logger.createLogger(buildLoggerConfig(false, true) as any);
    appLogBuffer.clear();
    release.debug('d');
    release.info('i');
    release.warn('w');
    release.error('e');
    expect(appLogBuffer.getEntries().map(e => e.level)).toEqual(['info', 'warn', 'error']);
  });

  it('keeps the console error-only in release, all levels in dev', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const releaseGate = makeConsoleGate(false);
    releaseGate({ msg: 'i', rawMsg: ['i'], level: { severity: 1, text: 'info' }, options: {} });
    expect(logSpy).not.toHaveBeenCalled();
    releaseGate({ msg: 'e', rawMsg: ['e'], level: { severity: 3, text: 'error' }, options: {} });
    expect(logSpy).toHaveBeenCalledTimes(1);

    logSpy.mockClear();
    const devGate = makeConsoleGate(true);
    devGate({ msg: 'i', rawMsg: ['i'], level: { severity: 1, text: 'info' }, options: {} });
    expect(logSpy).toHaveBeenCalledTimes(1);
    logSpy.mockRestore();
  });
});

describe('persistence', () => {
  it('serializes and parses the persisted payload', () => {
    const entries = [
      { id: 1, timestamp: 't1', level: 'info', namespace: '[A]', message: 'one' },
      { id: 2, timestamp: 't2', level: 'error', namespace: null, message: 'two' },
    ];
    const text = serializeAppLogs(entries);
    expect(parseAppLogs(text)).toEqual([
      { timestamp: 't1', level: 'info', namespace: '[A]', message: 'one' },
      { timestamp: 't2', level: 'error', namespace: null, message: 'two' },
    ]);
    expect(parseAppLogs('not json')).toEqual([]);
  });

  it('flushes a tail and loads it back as previous-session history', async () => {
    let written = '';
    (RNFS.exists as jest.Mock).mockResolvedValue(true);
    (RNFS.writeFile as jest.Mock).mockImplementation((_path: string, text: string) => {
      written = text;
      return Promise.resolve();
    });
    (RNFS.readFile as jest.Mock).mockImplementation(() => Promise.resolve(written));

    appLogBuffer.clear();
    appLogBuffer.push(makeEntry({ message: 'persist-me' }));
    markAppLogDirty('error');
    await flushAppLogTail();

    expect(RNFS.writeFile).toHaveBeenCalledWith(appLogFilePath(), expect.any(String), 'utf8');
    expect(written).toContain('persist-me');

    appLogBuffer.clear();
    const restored = await loadPersistedAppLogs();
    expect(restored).toBe(1);
    expect(appLogBuffer.getEntries()[0]).toMatchObject({
      message: 'persist-me',
      previousSession: true,
    });
  });

  it('never throws when storage fails', async () => {
    (RNFS.exists as jest.Mock).mockRejectedValue(new Error('nope'));
    await expect(loadPersistedAppLogs()).resolves.toBe(0);
    await expect(clearPersistedAppLogs()).resolves.toBeUndefined();

    (RNFS.writeFile as jest.Mock).mockRejectedValue(new Error('disk full'));
    appLogBuffer.push(makeEntry());
    markAppLogDirty();
    await expect(flushAppLogTail()).resolves.toBeUndefined();
  });

  it('clearAllAppLogs empties the buffer and removes the persisted tail', async () => {
    (RNFS.exists as jest.Mock).mockResolvedValue(true);
    appLogBuffer.push(makeEntry());
    await clearAllAppLogs();
    expect(appLogBuffer.size()).toBe(0);
    expect(RNFS.unlink).toHaveBeenCalled();
  });
});
