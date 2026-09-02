/**
 * TtsTestPanel — TTS playback test block (persona-modules 2-3).
 *
 * Verifies:
 *  - offline state renders "Connect to Harmony Link to test" and never plays
 *  - Play synthesizes via the engine test client and plays via AudioPlayer
 *  - Stop during playback stops AudioPlayer
 *  - the endpoint error message surfaces in the error state
 * (client + player mocked; contract-shaped fixtures, no live engine)
 */

import React from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react-native';
import { TtsTestPanel } from '../TtsTestPanel';

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
  const { Text, TouchableOpacity } = require('react-native');
  return { __esModule: true, ThemedButton: ({ label, onPress, testID, disabled, ...props }: any) =>
    React.createElement(TouchableOpacity, { testID, onPress: () => onPress(), disabled, accessibilityRole: 'button', ...props },
      React.createElement(Text, null, label)) };
});

jest.mock('../../../services/AudioPlayer', () => ({
  __esModule: true,
  default: { playAudio: jest.fn(), stop: jest.fn() },
}));

jest.mock('../../../services/voiceInput/moduleTestClient', () => {
  const actual = jest.requireActual('../../../services/voiceInput/moduleTestClient');
  return { ...actual, testTts: jest.fn() };
});

import AudioPlayer from '../../../services/AudioPlayer';
import { testTts, ModuleTestError } from '../../../services/voiceInput/moduleTestClient';

const mockPlayAudio = (AudioPlayer as any).playAudio as jest.Mock;
const mockStop = (AudioPlayer as any).stop as jest.Mock;
const mockTestTts = testTts as jest.Mock;

const draftConfig = {
  provider_type: 'elevenlabs',
  provider_config_id: 7,
  module_config: { output_type: 'mp3' },
};

async function flush() {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

beforeEach(() => {
  jest.clearAllMocks();
  mockIsConnected = true;
  mockPlayAudio.mockResolvedValue(undefined);
  mockStop.mockResolvedValue(undefined);
  mockTestTts.mockResolvedValue({ audio_base64: 'QUJDRA==', mime_type: 'audio/mpeg' });
});

describe('TtsTestPanel — synthesize + playback', () => {
  it('renders the offline state and never plays when disconnected', async () => {
    mockIsConnected = false;
    const utils = await render(<TtsTestPanel draftConfig={draftConfig} />);
    await flush();

    expect(utils.getByText('ttsOfflineTitle')).toBeTruthy();
    expect(utils.queryByTestId('tts-play-button')).toBeNull();
    expect(mockTestTts).not.toHaveBeenCalled();
  });

  it('synthesizes the typed text and plays the returned audio', async () => {
    const utils = await render(<TtsTestPanel draftConfig={draftConfig} />);
    await flush();

    await fireEvent.changeText(utils.getByTestId('tts-text-input'), 'Hello there');
    await fireEvent.press(utils.getByTestId('tts-play-button'));
    await flush();

    expect(mockTestTts).toHaveBeenCalledWith(draftConfig, 'Hello there');
    expect(mockPlayAudio).toHaveBeenCalledWith('QUJDRA==', 'audio/mpeg');
  });

  it('stops playback when pressed again while playing', async () => {
    const utils = await render(<TtsTestPanel draftConfig={draftConfig} />);
    await flush();

    await fireEvent.press(utils.getByTestId('tts-play-button'));
    await flush();
    expect(mockPlayAudio).toHaveBeenCalledTimes(1);

    // Now playing → press = stop.
    await fireEvent.press(utils.getByTestId('tts-play-button'));
    await flush();
    expect(mockStop).toHaveBeenCalledTimes(1);
  });

  it('surfaces the engine endpoint error message', async () => {
    mockTestTts.mockRejectedValue(new ModuleTestError('unknown provider_type'));
    const utils = await render(<TtsTestPanel draftConfig={draftConfig} />);
    await flush();

    await fireEvent.press(utils.getByTestId('tts-play-button'));
    await flush();

    expect(utils.getByTestId('tts-error')).toBeTruthy();
    expect(utils.getByText(/unknown provider_type/)).toBeTruthy();
  });
});
