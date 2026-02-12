import { logger, consoleTransport } from 'react-native-logs';

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
 * Logger configuration for Harmony AI App
 * 
 * - Development (__DEV__): All levels (debug, info, warn, error)
 * - Production: Only ERROR level
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
