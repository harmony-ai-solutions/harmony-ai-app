/**
 * SttTestPanel — STT/VAD recorder test block (persona-modules 2-2).
 *
 * Verifies:
 *  - the pure computeVadBars helper (clamping / empty / duration bounds)
 *  - offline state renders "Connect to Harmony Link to test" and never records
 *  - the record → stop → transcribe state machine drives AudioRecorder + the
 *    engine test client (both mocked; contract-shaped fixtures, no live engine)
 *  - the endpoint error message surfaces in the error state
 */

import React from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react-native';
import { SttTestPanel, computeVadBars } from '../SttTestPanel';

afterEach(cleanup);
beforeEach(cleanup);

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('../../../utils/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

jest.mock('../../../utils/haptics', () => ({ hapticLightPress: jest.fn() }));

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return ({ name, ...props }: any) => React.createElement(Text, { ...props }, name);
});

jest.mock('../../../contexts/ThemeContext', () => ({
  useAppTheme: () => ({
    theme: {
      colors: {
        accent: { primary: '#7c3aed', secondary: '#a78bfa' },
        background: { base: '#0f0f1a', surface: '#151d30', elevated: '#1e1e2e' },
        border: { default: '#333333' },
        text: { primary: '#ffffff', secondary: '#cccccc', muted: '#aaaaaa', disabled: '#555555' },
        status: { success: '#22c55e', warning: '#f59e0b', error: '#ef4444' },
      },
    },
  }),
}));

let mockIsConnected = true;
jest.mock('../../../contexts/SyncConnectionContext', () => ({
  useSyncConnection: () => ({ isConnected: mockIsConnected, connectionStatus: {} }),
}));

jest.mock('../../themed/ThemedText', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { __esModule: true, ThemedText: ({ children, style, ...props }: any) =>
    React.createElement(Text, { style, ...props }, children) };
});
jest.mock('../../themed/ThemedButton', () => {
  const React = require('react');
  const { View, Text, TouchableOpacity } = require('react-native');
  return { __esModule: true, ThemedButton: ({ label, onPress, testID, disabled, ...props }: any) =>
    React.createElement(TouchableOpacity, { testID, onPress: () => onPress(), disabled, accessibilityRole: 'button', ...props },
      React.createElement(Text, null, label)) };
});

jest.mock('../../../services/AudioRecorder', () => ({
  __esModule: true,
  default: {
    startRecording: jest.fn(),
    stopRecording: jest.fn(),
  },
}));

jest.mock('../../../services/voiceInput/moduleTestClient', () => {
  const actual = jest.requireActual('../../../services/voiceInput/moduleTestClient');
  return { ...actual, testStt: jest.fn() };
});

import AudioRecorder from '../../../services/AudioRecorder';
import { testStt, ModuleTestError } from '../../../services/voiceInput/moduleTestClient';

const mockStartRecording = (AudioRecorder as any).startRecording as jest.Mock;
const mockStopRecording = (AudioRecorder as any).stopRecording as jest.Mock;
const mockTestStt = testStt as jest.Mock;

const draftConfig = {
  provider_type: 'openai',
  provider_config_id: 42,
  module_config: { transcription_provider: 'openai', vad_provider: 'openai' },
};

async function flush() {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe('computeVadBars — pure VAD layout helper', () => {
  it('maps segments to percentage left/width against the duration', () => {
    expect(
      computeVadBars(
        [
          { start_ms: 0, end_ms: 1000 },
          { start_ms: 1000, end_ms: 2000 },
        ],
        2000,
      ),
    ).toEqual([
      { left: 0, width: 50 },
      { left: 50, width: 50 },
    ]);
  });

  it('clamps segments outside [0, duration] and returns a non-negative width', () => {
    const bars = computeVadBars([{ start_ms: -100, end_ms: 5000 }], 2000);
    expect(bars).toEqual([{ left: 0, width: 100 }]);
  });

  it('returns [] for empty segments or a zero duration', () => {
    expect(computeVadBars([], 2000)).toEqual([]);
    expect(computeVadBars([{ start_ms: 0, end_ms: 1000 }], 0)).toEqual([]);
  });
});

describe('SttTestPanel — state machine + offline handling', () => {
  beforeEach(() => {
    mockIsConnected = true;
    jest.clearAllMocks();
    mockStartRecording.mockResolvedValue(undefined);
    mockStopRecording.mockResolvedValue({ data: 'QUJDRA==', mimeType: 'audio/wav', duration: 1.5 });
    mockTestStt.mockResolvedValue({
      transcript: 'hello world',
      vad_segments: [{ start_ms: 0, end_ms: 1200 }],
      duration_ms: 2100,
    });
  });

  it('renders the offline state and never records when disconnected', async () => {
    mockIsConnected = false;
    const utils = await render(<SttTestPanel draftConfig={draftConfig} />);
    await flush();

    expect(utils.getByText('offlineTitle')).toBeTruthy();
    // No record button is offered offline.
    expect(utils.queryByTestId('stt-record-button')).toBeNull();
    expect(mockStartRecording).not.toHaveBeenCalled();
  });

  it('records → transcribes → renders transcript + VAD bars on the engine result', async () => {
    const utils = await render(<SttTestPanel draftConfig={draftConfig} />);
    await flush();

    await fireEvent.press(utils.getByTestId('stt-record-button'));
    await flush();
    expect(mockStartRecording).toHaveBeenCalledTimes(1);

    // Record → stop (the same button now says Stop).
    await fireEvent.press(utils.getByTestId('stt-record-button'));
    await flush();

    expect(mockStopRecording).toHaveBeenCalledTimes(1);
    expect(mockTestStt).toHaveBeenCalledWith(
      draftConfig,
      'QUJDRA==',
      'audio/wav',
    );
    expect(utils.getByTestId('stt-transcript')).toBeTruthy();
    expect(utils.getByText('hello world')).toBeTruthy();
    expect(utils.getByTestId('stt-vad-timeline')).toBeTruthy();
  });

  it('renders the "no VAD segments" note when the provider returns []', async () => {
    mockTestStt.mockResolvedValue({
      transcript: 'hi',
      vad_segments: [],
      duration_ms: 500,
    });
    const utils = await render(<SttTestPanel draftConfig={draftConfig} />);
    await flush();

    await fireEvent.press(utils.getByTestId('stt-record-button'));
    await flush();
    await fireEvent.press(utils.getByTestId('stt-record-button'));
    await flush();

    expect(utils.getByText('noVadSegments')).toBeTruthy();
    expect(utils.queryByTestId('stt-vad-timeline')).toBeNull();
  });

  it('surfaces the engine endpoint error message', async () => {
    mockTestStt.mockRejectedValue(new ModuleTestError('undecodable audio'));
    const utils = await render(<SttTestPanel draftConfig={draftConfig} />);
    await flush();

    await fireEvent.press(utils.getByTestId('stt-record-button'));
    await flush();
    await fireEvent.press(utils.getByTestId('stt-record-button'));
    await flush();

    expect(utils.getByTestId('stt-error')).toBeTruthy();
    expect(utils.getByText(/undecodable audio/)).toBeTruthy();
  });
});
