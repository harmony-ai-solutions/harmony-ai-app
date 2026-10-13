/**
 * EngineMemoryTelemetry — unit tests (task 4-2 dev telemetry hook).
 *
 * The native module is resolved at module load, so each test loads the wrapper
 * with a fresh registry after installing the native mock.
 */

jest.mock('../../../utils/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import { NativeModules, Platform } from 'react-native';
import { computeMemoryDelta } from '../EngineMemoryTelemetry';

function load(rssBytes: (() => Promise<number>) | null = async () => 123456) {
  jest.resetModules();
  (Platform as any).OS = 'ios';
  (NativeModules as any).SoulbitsEngine = rssBytes ? { rssBytes: jest.fn(rssBytes) } : undefined;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('../EngineMemoryTelemetry');
}

describe('EngineMemoryTelemetry', () => {
  it('reads the native RSS', async () => {
    const mod = load();
    await expect(mod.readRssBytes()).resolves.toBe(123456);
  });

  it('returns null when the native hook is unavailable', async () => {
    const mod = load(null);
    await expect(mod.readRssBytes()).resolves.toBeNull();
  });

  it('returns null when the native call throws', async () => {
    const mod = load(async () => { throw new Error('boom'); });
    await expect(mod.readRssBytes()).resolves.toBeNull();
  });

  it('computes the delta between samples', () => {
    expect(computeMemoryDelta({ label: 'b', rssBytes: 1000, at: 1 }, { label: 'a', rssBytes: 1600, at: 2 })).toBe(600);
  });

  it('returns null delta when a sample is unavailable', () => {
    expect(computeMemoryDelta({ label: 'b', rssBytes: null, at: 1 }, { label: 'a', rssBytes: 5, at: 2 })).toBeNull();
  });

  it('measures a chat session and returns the wrapped result', async () => {
    const mod = load();
    const out = await mod.measureChatSession('chat', async () => 'ok');
    expect(out.result).toBe('ok');
    expect(out.before.rssBytes).toBe(123456);
    expect(out.deltaBytes).toBe(0);
  });
});
