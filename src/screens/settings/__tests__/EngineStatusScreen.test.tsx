/**
 * EngineStatusScreen — render-state + action tests.
 *
 * The screen is driven entirely by the (mocked) EngineService read surface:
 * connection (readiness), lifecycle status, last exit and the engine-version
 * state. Covers the connected card (ports/pid/dataDir/token-presence), the
 * not-started and failed empty states, the versions block, and the two actions
 * (navigate to the log viewer, share diagnostics).
 */

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();

/** Mutable state the mocked EngineService reads from (set per test). */
const mockState: {
  connection: any;
  status: any;
  lastExit: any;
  version: any;
} = {
  connection: null,
  status: null,
  lastExit: null,
  version: { engineVersion: null },
};

jest.mock('../../../services/engine/EngineService', () => ({
  getEngineConnection: jest.fn(() => mockState.connection),
  getEngineStatus: jest.fn(() => mockState.status),
  getLastEngineExit: jest.fn(() => mockState.lastExit),
  getEngineVersionState: jest.fn(() => mockState.version),
  onEngineConnectionChange: jest.fn(() => () => undefined),
  onEngineStatusChange: jest.fn(() => () => undefined),
  onEngineExitChange: jest.fn(() => () => undefined),
  onEngineVersionStateChange: jest.fn(() => () => undefined),
}));

const mockShareDiagnosticsReport = jest.fn(() => Promise.resolve('/mock/caches/report.txt'));
jest.mock('../../../services/diagnostics/shareDiagnostics', () => ({
  shareDiagnosticsReport: (...args: unknown[]) =>
    (mockShareDiagnosticsReport as jest.Mock)(...args),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('../../../utils/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('react-native-linear-gradient', () => {
  const React = require('react');
  const { View } = require('react-native');
  return ({ children, style, ...props }: any) =>
    React.createElement(View, { style, ...props }, children);
});

jest.mock('../../../utils/haptics', () => ({ hapticLightPress: jest.fn() }));

jest.mock('../../../contexts/ThemeContext', () => ({
  useAppTheme: () => ({
    theme: {
      colors: {
        background: { base: '#0f0f1a', surface: '#151d30', elevated: '#1e1e2e', hover: '#26263a' },
        accent: { primary: '#7c3aed', secondary: '#a78bfa', primaryHover: '#8b5cf6', secondaryHover: '#c4b5fd' },
        text: { primary: '#ffffff', secondary: '#cccccc', muted: '#aaaaaa', disabled: '#555555' },
        status: {
          success: '#22c55e',
          successBg: 'rgba(34,197,94,0.1)',
          warning: '#f59e0b',
          warningBg: 'rgba(245,158,11,0.1)',
          error: '#ef4444',
          errorBg: 'rgba(239,68,68,0.1)',
          info: '#3b82f6',
          infoBg: 'rgba(59,130,246,0.1)',
        },
        border: { default: '#333333', focus: '#7c3aed', hover: '#444444', accent: '#7c3aed' },
        gradients: { primary: '#7c3aed', secondary: '#4a4a6a', surface: '#1e1e2e' },
        glass: {
          cardOpacity: 0.5,
          glowOpacity: 0.08,
          glowRadius: 14,
          borderGradientStart: '#fff',
          borderGradientEnd: '#a78bfa',
        },
        typography: { headerOpacity: 1.0, subtextOpacity: 0.7, captionOpacity: 0.5 },
      },
    },
  }),
}));

jest.mock('../../../utils/colorUtils', () => ({
  hexToRgba: (hex: string) => hex,
}));

import { ENGINE_CONTRACT_VERSION } from '../../../services/engine/engineContract';
import { EngineStatusScreen } from '../EngineStatusScreen';

beforeEach(() => {
  cleanup();
  jest.clearAllMocks();
  mockState.connection = null;
  mockState.status = null;
  mockState.lastExit = null;
  mockState.version = { engineVersion: null };
});

afterEach(cleanup);

const CONNECTION = {
  adminBaseUrl: 'http://127.0.0.1:28081',
  wsBaseUrl: 'ws://127.0.0.1:28080',
  wssBaseUrl: 'wss://127.0.0.1:28443',
  token: 'super-secret-loopback-token',
  bind: '127.0.0.1',
  wsPort: 28080,
  wssPort: 28443,
  adminPort: 28081,
  pid: 4242,
  dataDir: '/data/engine',
};

describe('EngineStatusScreen', () => {
  it('shows the running state and the connection details when connected', async () => {
    mockState.connection = CONNECTION;
    mockState.status = 'ready';
    await render(<EngineStatusScreen />);

    expect(screen.getByText('state.ready')).toBeTruthy();
    expect(screen.getByTestId('engine-status-details')).toBeTruthy();
    expect(screen.getByText('127.0.0.1')).toBeTruthy();
    expect(screen.getByText('28080')).toBeTruthy();
    expect(screen.getByText('28443')).toBeTruthy();
    expect(screen.getByText('28081')).toBeTruthy();
    expect(screen.getByText('4242')).toBeTruthy();
    expect(screen.getByText('/data/engine')).toBeTruthy();
    expect(screen.getByText('detail.tokenPresent')).toBeTruthy();
    // The loopback token value must NEVER be rendered.
    expect(screen.queryByText('super-secret-loopback-token')).toBeNull();
  });

  it('shows the not-started empty state when the engine is down', async () => {
    mockState.connection = null;
    mockState.status = null;
    await render(<EngineStatusScreen />);

    expect(screen.getByText('state.unknown')).toBeTruthy();
    expect(screen.getByTestId('engine-status-hint')).toBeTruthy();
    expect(screen.getByText('hint.notStarted')).toBeTruthy();
    expect(screen.queryByTestId('engine-status-details')).toBeNull();
  });

  it('shows the failed state plus the last exit info', async () => {
    mockState.connection = null;
    mockState.status = 'failed';
    mockState.lastExit = {
      code: 1,
      signal: null,
      expected: false,
      restartAttempt: 3,
      willRestart: false,
    };
    await render(<EngineStatusScreen />);

    expect(screen.getByText('state.failed')).toBeTruthy();
    expect(screen.getByText('hint.failed')).toBeTruthy();
    expect(screen.getByText('lastExit.unexpected')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
  });

  it('renders the app / engine / contract versions', async () => {
    mockState.version = { engineVersion: '0.3.0' };
    await render(<EngineStatusScreen />);

    // DeviceInfo.getVersion() is mocked to 1.0.0 in jest.setup.js.
    expect(screen.getByText('1.0.0')).toBeTruthy();
    expect(screen.getByText('0.3.0')).toBeTruthy();
    expect(screen.getByText(ENGINE_CONTRACT_VERSION)).toBeTruthy();
  });

  it('navigates to the engine log viewer', async () => {
    await render(<EngineStatusScreen />);

    fireEvent.press(screen.getByText('viewLogs'));
    expect(mockNavigate).toHaveBeenCalledWith('EngineLog');
  });

  it('shares diagnostics through the reused 7-11 mechanism', async () => {
    await render(<EngineStatusScreen />);

    fireEvent.press(screen.getByText('share'));
    await waitFor(() =>
      expect(mockShareDiagnosticsReport).toHaveBeenCalledWith({ entries: [], scope: 'full' }),
    );
  });
});
