/**
 * EngineBootGate — boot-gate render-state + retry tests (owner ruling 2026-10-18).
 *
 * The gate is driven entirely by the (mocked) EngineService status surface:
 *   - holds the branded splash while the engine is null/starting/stopped,
 *   - releases on 'ready' (and fast-paths when already ready at mount),
 *   - auto-retries ONCE on the first 'failed', then surfaces the error panel on
 *     a second failure (or an auto-retry that rejects), with Retry + share.
 */

import React from 'react';
import { Text } from 'react-native';
import { act, cleanup, fireEvent, render } from '@testing-library/react-native';

// ── Hoisted module mocks ────────────────────────────────────────────────
// `mockState` / `mockRestartEngine` are only READ from inside the deferred
// arrows, so the hoisted factory never touches them before init (no TDZ).

const mockState: {
  status: any;
  listener: ((status: any) => void) | null;
} = { status: null, listener: null };

const mockRestartEngine = jest.fn(() => Promise.resolve({}));
const mockShare = jest.fn(() => Promise.resolve('/mock/caches/report.txt'));

jest.mock('../../../services/engine/EngineService', () => ({
  getEngineStatus: jest.fn(() => mockState.status),
  onEngineStatusChange: jest.fn((cb: (status: any) => void) => {
    mockState.listener = cb;
    return () => {
      mockState.listener = null;
    };
  }),
  restartEngine: (...args: unknown[]) => (mockRestartEngine as jest.Mock)(...args),
}));

jest.mock('../../../services/diagnostics/shareDiagnostics', () => ({
  shareDiagnosticsReport: (...args: unknown[]) => (mockShare as jest.Mock)(...args),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('../../../contexts/ThemeContext', () => ({
  useAppTheme: () => ({
    theme: {
      colors: {
        accent: { primary: '#7c3aed' },
        status: { error: '#ef4444' },
      },
    },
  }),
}));

jest.mock('../../../utils/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

jest.mock('../../themed/ThemedView', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    ThemedView: ({ children, style, ...props }: any) =>
      React.createElement(View, { style, ...props }, children),
  };
});
jest.mock('../../themed/ThemedText', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    ThemedText: ({ children, style, ...props }: any) =>
      React.createElement(Text, { style, ...props }, children),
  };
});
jest.mock('../../themed/ThemedButton', () => {
  const React = require('react');
  const { TouchableOpacity, Text } = require('react-native');
  return {
    __esModule: true,
    ThemedButton: ({ label, onPress, disabled, testID, ...props }: any) =>
      React.createElement(
        TouchableOpacity,
        { onPress, disabled, testID, accessibilityRole: 'button', ...props },
        React.createElement(Text, null, label),
      ),
  };
});

// ── Imports (after mocks) ───────────────────────────────────────────────

import { EngineBootGate } from '../EngineBootGate';
import * as EngineService from '../../../services/engine/EngineService';

const mockOnEngineStatusChange = EngineService.onEngineStatusChange as jest.Mock;

const Child = () => <Text testID="child">CHILD</Text>;

async function flush() {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function renderGate() {
  return render(
    <EngineBootGate>
      <Child />
    </EngineBootGate>,
  );
}

async function emit(status: any) {
  await act(async () => {
    mockState.listener?.(status);
  });
  await flush();
}

/** Drive the gate to the error panel: fail, let the auto-retry run, fail again. */
async function reachErrorPanel() {
  const utils = await renderGate();
  await emit('failed'); // first failure → one automatic retry
  await emit('starting'); // engine cycles during the retry
  await emit('failed'); // second failure → the panel
  return utils;
}

beforeEach(() => {
  cleanup();
  jest.clearAllMocks();
  mockState.status = null;
  mockState.listener = null;
  mockRestartEngine.mockImplementation(() => Promise.resolve({}));
});

afterEach(cleanup);

// ── Tests ───────────────────────────────────────────────────────────────

describe('EngineBootGate — splash gating', () => {
  it('holds the branded splash while the status is null', async () => {
    mockState.status = null;
    const utils = await renderGate();

    expect(utils.getByTestId('engine-boot-splash')).toBeTruthy();
    expect(utils.getByTestId('engine-boot-splash-spinner')).toBeTruthy();
    expect(utils.queryByTestId('child')).toBeNull();
  });

  it('holds the splash while the status is starting', async () => {
    mockState.status = 'starting';
    const utils = await renderGate();

    expect(utils.getByTestId('engine-boot-splash')).toBeTruthy();
    expect(utils.queryByTestId('child')).toBeNull();
  });

  it('holds the splash while the status is stopped (does not dead-end)', async () => {
    mockState.status = null;
    const utils = await renderGate();
    await emit('stopped');

    expect(utils.getByTestId('engine-boot-splash')).toBeTruthy();
    expect(utils.queryByTestId('child')).toBeNull();
  });

  it('releases the splash and renders children on ready', async () => {
    mockState.status = null;
    const utils = await renderGate();
    expect(utils.getByTestId('engine-boot-splash')).toBeTruthy();

    await emit('ready');

    expect(utils.queryByTestId('engine-boot-splash')).toBeNull();
    expect(utils.getByTestId('child')).toBeTruthy();
  });

  it('fast-paths when the engine is already ready at mount (no splash, no subscribe)', async () => {
    mockState.status = 'ready';
    const utils = await renderGate();

    expect(utils.queryByTestId('engine-boot-splash')).toBeNull();
    expect(utils.getByTestId('child')).toBeTruthy();
    // Already released → never subscribes to status changes.
    expect(mockOnEngineStatusChange).not.toHaveBeenCalled();
  });

  it('stays released after a later runtime failure (one-way latch)', async () => {
    mockState.status = null;
    const utils = await renderGate();
    await emit('ready');
    expect(utils.getByTestId('child')).toBeTruthy();

    await emit('failed');

    expect(utils.getByTestId('child')).toBeTruthy();
    expect(utils.queryByTestId('engine-boot-error')).toBeNull();
    expect(mockRestartEngine).not.toHaveBeenCalled();
  });
});

describe('EngineBootGate — failure handling', () => {
  it('auto-retries once on the first failure and keeps the splash up', async () => {
    mockState.status = null;
    const utils = await renderGate();

    await emit('failed');

    expect(mockRestartEngine).toHaveBeenCalledTimes(1);
    expect(utils.getByTestId('engine-boot-splash')).toBeTruthy();
    expect(utils.queryByTestId('engine-boot-error')).toBeNull();
  });

  it('shows the error panel on a second failure and does not stack auto-retries', async () => {
    const utils = await reachErrorPanel();

    expect(utils.getByTestId('engine-boot-error')).toBeTruthy();
    expect(utils.queryByTestId('engine-boot-splash')).toBeNull();
    // Only the single automatic retry ran — the panel waits for a manual retry.
    expect(mockRestartEngine).toHaveBeenCalledTimes(1);
  });

  it('shows the error panel when the automatic retry itself rejects', async () => {
    mockRestartEngine.mockRejectedValueOnce(new Error('boot failed'));
    mockState.status = null;
    const utils = await renderGate();

    await emit('failed');

    expect(mockRestartEngine).toHaveBeenCalledTimes(1);
    expect(utils.getByTestId('engine-boot-error')).toBeTruthy();
  });

  it('manual Retry invokes restartEngine again', async () => {
    const utils = await reachErrorPanel();
    mockRestartEngine.mockClear();

    await act(async () => {
      fireEvent.press(utils.getByTestId('engine-boot-retry'));
    });
    await flush();

    expect(mockRestartEngine).toHaveBeenCalledTimes(1);
  });

  it('releases the gate after a successful manual retry', async () => {
    const utils = await reachErrorPanel();
    // The manual retry publishes readiness mid-restart.
    mockRestartEngine.mockImplementationOnce(async () => {
      mockState.listener?.('ready');
      return {};
    });

    await act(async () => {
      fireEvent.press(utils.getByTestId('engine-boot-retry'));
    });
    await flush();

    expect(utils.queryByTestId('engine-boot-error')).toBeNull();
    expect(utils.getByTestId('child')).toBeTruthy();
  });

  it('shares diagnostics through the reused 7-11 mechanism', async () => {
    const utils = await reachErrorPanel();

    await act(async () => {
      fireEvent.press(utils.getByTestId('engine-boot-diagnostics'));
    });
    await flush();

    expect(mockShare).toHaveBeenCalledWith({ entries: [], scope: 'full' });
  });
});

describe('EngineBootGate — lifecycle hygiene', () => {
  it('unsubscribes on unmount', async () => {
    mockState.status = null;
    const utils = await renderGate();
    expect(mockState.listener).not.toBeNull();

    await act(async () => {
      utils.unmount();
    });

    expect(mockState.listener).toBeNull();
  });
});
