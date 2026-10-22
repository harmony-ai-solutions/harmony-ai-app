/**
 * EngineMemoryTelemetry — dev-build RSS telemetry for the in-process iOS engine
 * (task 4-2 Design: "Memory/battery telemetry hooks (dev builds): RSS before/after
 * chat sessions").
 *
 * The engine holds a single SQLite connection plus the two loopback servers; on
 * older devices memory pressure decides whether local mode is enabled on iOS
 * (assessment §8 / the 4-2 risks). This samples the app process resident set via
 * the native module and reports the delta across a chat session.
 *
 * Telemetry is observational only — never on a critical path, never throws.
 */

import { NativeModules, Platform } from 'react-native';
import { createLogger } from '../../utils/logger';

const log = createLogger('[EngineMemory]');

const native: any = Platform.OS === 'ios' ? (NativeModules as any).SoulbitsEngine : null;

/** One RSS sample. */
export interface MemorySample {
  label: string;
  /** Resident set size in bytes, or null when unavailable. */
  rssBytes: number | null;
  /** Sample time (ms epoch). */
  at: number;
}

/** The process RSS in bytes, or null when the native hook is unavailable. */
export async function readRssBytes(): Promise<number | null> {
  if (!native || typeof native.rssBytes !== 'function') return null;
  try {
    const value = Number(await native.rssBytes());
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch (e) {
    log.warn('rssBytes failed:', e);
    return null;
  }
}

/** Take a labelled RSS sample (never throws). */
export async function sampleMemory(label: string): Promise<MemorySample> {
  return { label, rssBytes: await readRssBytes(), at: Date.now() };
}

/** The byte delta between two samples, or null when either is unavailable. */
export function computeMemoryDelta(before: MemorySample, after: MemorySample): number | null {
  if (before.rssBytes == null || after.rssBytes == null) return null;
  return after.rssBytes - before.rssBytes;
}

/**
 * Run `fn` wrapped in before/after RSS samples (dev builds only). Returns the
 * result plus the samples + delta; a telemetry failure never affects `fn`.
 */
export async function measureChatSession<T>(
  label: string,
  fn: () => Promise<T>,
): Promise<{ result: T; before: MemorySample; after: MemorySample; deltaBytes: number | null }> {
  const before = await sampleMemory(`${label}:before`);
  const result = await fn();
  const after = await sampleMemory(`${label}:after`);
  const deltaBytes = computeMemoryDelta(before, after);
  if (__DEV__) {
    log.info(
      `${label} RSS ${before.rssBytes ?? '?'} → ${after.rssBytes ?? '?'} (delta ${
        deltaBytes == null ? '?' : Math.round(deltaBytes / 1024) + ' KiB'
      })`,
    );
  }
  return { result, before, after, deltaBytes };
}
