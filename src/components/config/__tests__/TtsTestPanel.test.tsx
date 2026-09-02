/**
 * TtsTestPanel — TTS playback test block (persona-modules 2-3, reworked).
 *
 * Verifies:
 *  - offline state renders "Connect to Harmony Link to test" and never plays
 *  - no-entity state renders the disabled hint (ModuleConfigEditScreen has no
 *    entity binding) and never synthesizes
 *  - Play INITs a debug session, sends TTS_GENERATE_SPEECH 'binary', awaits
 *    ENTITY_UTTERANCE and plays the inline audio via AudioPlayer
 *  - Stop during playback stops AudioPlayer
 *  - the session-service error message surfaces in the error state
 *  (session service + player mocked; contract-shaped fixtures, no live engine)
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

let mockRunTest: jest.Mock;
let mockCapturedSendEvents: any[];
jest.mock('../../../services/voiceInput/moduleTestSessionService', () => {
  const actual = jest.requireActual('../../../services/voiceInput/moduleTestSessionService');
  class ModuleTestSessionError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'ModuleTestSessionError';
    }
  }
  return {
    __esModule: true,
    runTest: jest.fn(),
    ModuleTestSessionError: actual.ModuleTestSessionError ?? ModuleTestSessionError,
  };
});

import AudioPlayer from '../../../services/AudioPlayer';
import { runTest, ModuleTestSessionError } from '../../../services/voiceInput/moduleTestSessionService';

const mockPlayAudio = (AudioPlayer as any).playAudio as jest.Mock;
const mockStop = (AudioPlayer as any).stop as jest.Mock;
mockRunTest = runTest as jest.Mock;

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
  mockCapturedSendEvents = [];
  mockPlayAudio.mockResolvedValue(undefined);
  mockStop.mockResolvedValue(undefined);
  mockRunTest.mockImplementation(async (_entityId: string, fn: any) => {
    mockCapturedSendEvents = [];
    return fn({
      sendEvent: async (ev: any) => { mockCapturedSendEvents.push(ev); },
      awaitEvent: async () => ({
        event_type: 'ENTITY_UTTERANCE',
        status: 'NEW',
        payload: { message_id: 'tts-msg', content: 'Hello there', audio: 'QUJDRA==', audio_type: 'audio/mpeg' },
      }),
    });
  });
});

describe('TtsTestPanel — synthesize + playback', () => {
  it('renders the offline state and never plays when disconnected', async () => {
    mockIsConnected = false;
    const utils = await render(<TtsTestPanel entityId="ai-1" />);
    await flush();

    expect(utils.getByText('ttsOfflineTitle')).toBeTruthy();
    expect(utils.queryByTestId('tts-play-button')).toBeNull();
    expect(mockRunTest).not.toHaveBeenCalled();
  });

  it('renders the entity-context hint and never synthesizes without an entityId', async () => {
    const utils = await render(<TtsTestPanel />);
    await flush();

    expect(utils.getByTestId('tts-needs-entity')).toBeTruthy();
    expect(utils.getByText('ttsNeedsEntityHint')).toBeTruthy();
    expect(utils.queryByTestId('tts-play-button')).toBeNull();
    expect(mockRunTest).not.toHaveBeenCalled();
  });

  it('synthesizes via TTS_GENERATE_SPEECH binary and plays the returned audio', async () => {
    const utils = await render(<TtsTestPanel entityId="ai-entity-1" />);
    await flush();

    await fireEvent.changeText(utils.getByTestId('tts-text-input'), 'Hello there');
    await fireEvent.press(utils.getByTestId('tts-play-button'));
    await flush();

    expect(mockRunTest).toHaveBeenCalledWith('ai-entity-1', expect.any(Function));

    const ttsEvent = mockCapturedSendEvents.find((e: any) => e.event_type === 'TTS_GENERATE_SPEECH');
    expect(ttsEvent).toBeTruthy();
    expect(ttsEvent.payload.tts_output_type).toBe('binary');
    expect(ttsEvent.payload.utterance).toEqual({
      type: 'UTTERANCE_COMBINED',
      content: 'Hello there',
      entity_id: 'ai-entity-1',
    });

    expect(mockPlayAudio).toHaveBeenCalledWith('QUJDRA==', 'audio/mpeg');
  });

  it('stops playback when pressed again while playing', async () => {
    const utils = await render(<TtsTestPanel entityId="ai-entity-1" />);
    await flush();

    await fireEvent.press(utils.getByTestId('tts-play-button'));
    await flush();
    expect(mockPlayAudio).toHaveBeenCalledTimes(1);

    // Now playing → press = stop.
    await fireEvent.press(utils.getByTestId('tts-play-button'));
    await flush();
    expect(mockStop).toHaveBeenCalledTimes(1);
  });

  it('surfaces the session-service error message', async () => {
    mockRunTest.mockRejectedValue(new ModuleTestSessionError('unknown provider_type'));
    const utils = await render(<TtsTestPanel entityId="ai-entity-1" />);
    await flush();

    await fireEvent.press(utils.getByTestId('tts-play-button'));
    await flush();

    expect(utils.getByTestId('tts-error')).toBeTruthy();
    expect(utils.getByText(/unknown provider_type/)).toBeTruthy();
  });
});
