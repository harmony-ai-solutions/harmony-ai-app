import { logger, consoleTransport } from 'react-native-logs';

/** App-wide tag for filtering Harmony logs in ADB logcat */
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
 * Custom format function that prepends the [HARMONY] app tag.
 *
 * Every log line becomes: `[HARMONY] [Time] | [Namespace] | LEVEL | message`
 *
 * Filter in logcat with:  adb logcat | grep "[HARMONY]"
 */
const formatFunc = (level: string, extension?: string | null, ...msg: any[]): string => {
  const parts = [`[${APP_TAG}]`];
  if (extension) {
    parts.push(extension);
  }
  parts.push(level.toUpperCase());
  parts.push(msg.map(m => (typeof m === 'string' ? m : JSON.stringify(m))).join(' '));
  return parts.join(' | ');
};

/**
 * Logger configuration for Harmony AI App
 * 
 * - Development (__DEV__): All levels (debug, info, warn, error)
 * - Production: Only ERROR level
 * - All logs prefixed with [HARMONY] for easy logcat filtering
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
  async: true,
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
