import { logger, consoleTransport } from 'react-native-logs';
import {
  appLogBuffer,
  loadPersistedAppLogs,
  makeCaptureTransport,
  markAppLogDirty,
  startAppLogPersistence,
} from './appLogs';

/** App-wide tag for filtering Soulbits logs in ADB logcat */
const APP_TAG = 'SOULBITS';

// Extension to handle Error objects better in transports
const errorHandlingTransport = (props: any) => {
  if (props.rawMsg) {
    props.rawMsg = props.rawMsg.map((arg: any) => {
      if (arg instanceof Error) {
        return `${arg.message}\n${arg.stack}`;
      }
      return arg;
    });
  }
  return consoleTransport(props);
};

/**
 * Custom format function that prepends the [SOULBITS] app tag.
 *
 * Every log line becomes: `[SOULBITS] [Time] | [Namespace] | LEVEL | message`
 *
 * Filter in logcat with:  adb logcat | grep "[SOULBITS]"
 */
const formatFunc = (level: string, extension?: string | null, ...msg: any[]): string => {
  const parts = [`[${APP_TAG}]`];
  if (extension) {
    parts.push(extension);
  }
  parts.push(level.toUpperCase());
  parts.push(msg.map(m => {
    if (typeof m === 'string') return m;
    // Error objects have non-enumerable properties — JSON.stringify
    // produces "{}".  Extract message + stack explicitly so ADB logs
    // are actually useful for debugging.
    if (m instanceof Error) return m.stack || m.message;
    try { return JSON.stringify(m); } catch { return String(m); }
  }).join(' '));
  return parts.join(' | ');
};

/**
 * Console transport gate.
 *
 * Dev: every level reaches the console (unchanged).
 * Release: only ERROR reaches the console so prod logcat stays quiet — while
 * the ring buffer (a separate transport) still receives info+.
 */
export function makeConsoleGate(isDev: boolean): (props: any) => void {
  return (props: any) => {
    if (!isDev && props?.level?.text !== 'error') return;
    errorHandlingTransport(props);
  };
}

const isJest = (): boolean =>
  (globalThis as unknown as { __JEST__?: boolean }).__JEST__ === true;

/**
 * Build the logger configuration.
 *
 * - Development (__DEV__): all levels (debug, info, warn, error) to console + buffer
 * - Production: `severity: 'info'` lets info+ through to the transports; the
 *   ring buffer captures info+, the console gate drops everything below error.
 * - All console logs prefixed with [SOULBITS] for easy logcat filtering.
 *
 * Exported for tests (release-mode config assertions).
 */
export function buildLoggerConfig(dev: boolean, jest: boolean) {
  return {
    levels: {
      debug: 0,
      info: 1,
      warn: 2,
      error: 3,
    },
    severity: dev ? 'debug' : 'info',
    transport: [makeCaptureTransport(appLogBuffer, markAppLogDirty), makeConsoleGate(dev)],
    transportOptions: {
      colors: {
        debug: 'blueBright',
        info: 'white',
        warn: 'yellowBright',
        error: 'redBright',
      } as const,
    },
    // Synchronous under Jest: the async transport batches via a timer, which can
    // flush AFTER a test environment tears down ("Cannot log after tests are
    // done"). The app keeps the async transport.
    async: !jest,
    dateFormat: 'time',
    formatFunc,
    printLevel: true,
    printDate: dev, // Only show timestamps in dev
    enabled: true,
  };
}

const rootLogger = logger.createLogger(buildLoggerConfig(__DEV__, isJest()));

// Best-effort, non-blocking persistence of a bounded log tail (no-op under Jest):
// restore the previous session's tail, then flush periodically while dirty.
if (!isJest()) {
  void loadPersistedAppLogs();
  startAppLogPersistence();
}

/**
 * Create a logger with a specific namespace (e.g. '[ServiceName]')
 */
export function createLogger(namespace: string) {
  return rootLogger.extend(namespace);
}

/**
 * Default logger instance
 */
export default rootLogger;
