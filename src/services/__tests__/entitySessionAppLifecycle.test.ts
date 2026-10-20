/**
 * EntitySessionService — app-lifecycle source.
 *
 * Regression (on-device diagnostics): on Android RN AppState emits `background`
 * on ANY Activity onPause, including the volume HUD that pauses-but-leaves the
 * app VISIBLE during audio playback. That transient event closed every entity
 * session ~1.5s into each listen. The service must subscribe to
 * `react-native-applifecycle` (androidx ProcessLifecycleOwner ON_STOP) instead,
 * reacting only to a REAL background leave.
 */
import { AppState } from 'react-native';
import { EntitySessionService } from '../EntitySessionService';

jest.mock('react-native-applifecycle', () => {
  const handlers = new Set();
  return {
    __esModule: true,
    AppLifecycle: {
      addEventListener: jest.fn((_event: string, handler: (s: string) => void) => {
        handlers.add(handler);
        return { remove: jest.fn(() => handlers.delete(handler)) };
      }),
      get currentState() {
        return 'active';
      },
      __handlers: handlers,
    },
  };
});

jest.mock('../../utils/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

jest.mock('../connection/ConnectionManager', () => {
  const { EventEmitter: EE } = require('eventemitter3');
  const cm: any = new EE();
  cm.sendEvent = jest.fn().mockResolvedValue(undefined);
  cm.isConnected = jest.fn().mockReturnValue(true);
  cm.disconnectConnection = jest.fn();
  return { __esModule: true, default: cm };
});

jest.mock('../AudioPlayer', () => ({
  __esModule: true,
  default: { stop: jest.fn().mockResolvedValue(undefined) },
  AudioPlayer: class {},
}));

interface LifecycleControl {
  addEventListener: jest.Mock;
  __handlers: Set<(state: string) => void>;
}

const lifecycle = (jest.requireMock('react-native-applifecycle') as {
  AppLifecycle: LifecycleControl;
}).AppLifecycle;

function resetSingleton(): void {
  (EntitySessionService as any).instance = null;
}

function fireLifecycle(state: 'active' | 'background' | 'inactive'): void {
  lifecycle.__handlers.forEach(handler => handler(state));
}

describe('EntitySessionService — app lifecycle source', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    lifecycle.__handlers.clear();
    resetSingleton();
  });

  it('subscribes to AppLifecycle and not RN AppState', () => {
    const appStateSpy = jest.spyOn(AppState, 'addEventListener');
    try {
      EntitySessionService.getInstance();

      expect(lifecycle.addEventListener).toHaveBeenCalledWith(
        'change',
        expect.any(Function),
      );
      // A raw AppState listener is exactly what caused the false teardown.
      expect(appStateSpy).not.toHaveBeenCalledWith('change', expect.any(Function));
    } finally {
      appStateSpy.mockRestore();
    }
  });

  it('closes entity sessions on a REAL AppLifecycle background', () => {
    const svc = EntitySessionService.getInstance();
    const closeAll = jest.spyOn(svc, 'closeAllSessions').mockResolvedValue(undefined);

    fireLifecycle('background');

    expect(closeAll).toHaveBeenCalledTimes(1);
  });

  it('keeps sessions on active / inactive transitions', () => {
    const svc = EntitySessionService.getInstance();
    const closeAll = jest.spyOn(svc, 'closeAllSessions').mockResolvedValue(undefined);

    // `inactive` is the iOS AppState fallback for transient overlays — it must
    // never be treated as a background leave.
    fireLifecycle('inactive');
    fireLifecycle('active');

    expect(closeAll).not.toHaveBeenCalled();
  });
});
