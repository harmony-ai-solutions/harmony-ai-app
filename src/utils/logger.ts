import { logger, consoleTransport } from 'react-native-logs';

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
 * Logger configuration for Soulbits App
 *
 * - Development (__DEV__): All levels (debug, info, warn, error)
 * - Production: Only ERROR level
 * - All logs prefixed with [SOULBITS] for easy logcat filtering
 */
const config = {
  levels: {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  },
  severity: __DEV__ ? 'debug' : 'error',
  transport: errorHandlingTransport,
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
  async: !(globalThis as unknown as { __JEST__?: boolean }).__JEST__,
  dateFormat: 'time',
  formatFunc,
  printLevel: true,
  printDate: __DEV__, // Only show timestamps in dev
  enabled: true,
};

const rootLogger = logger.createLogger(config);

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
