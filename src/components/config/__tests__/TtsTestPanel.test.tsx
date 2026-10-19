/**
 * TtsTestPanel — TTS playback test studio (persona-modules 2-3, Phase 3-5).
 *
 * Verifies:
 *  - offline state renders "Connect to Soulbits Engine to test" and never plays
 *  - no-entity state renders the disabled hint (ModuleConfigEditScreen has no
 *    entity binding) and never synthesizes
 *  - Play INITs a debug session, sends TTS_GENERATE_SPEECH 'binary', awaits
 *    ENTITY_UTTERANCE and plays the inline audio via AudioPlayer
 *  - Stop during playback stops AudioPlayer
 *  - the session-service error message surfaces in the error state
 *  - stateless direct synthesis via `testTtsSpeech` works with only a
 *    `providerType` (no entityId)
 *  - paralinguistic chips append their tag to the sample text
 */

import React from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react-native';
import { TtsTestPanel, paralinguisticTagTestId } from '../TtsTestPanel';

afterEach(cleanup);
beforeEach(cleanup);

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('../../../utils/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

jest.mock('../../../utils/haptics', () => ({ hapticLightPress: jest.fn() }));

jest.mock('react-native-linear-gradient', () => {
  const React = require('react');
  const { View } = require('react-native');
  return ({ children, style, ...props }: any) =>
    React.createElement(View, { style, ...props }, children);
});

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
  default: {
    playAudio: jest.fn(),
    playBase64Audio: jest.fn(),
    stop: jest.fn(),
  },
}));

jest.mock('../../../services/engine/EngineApiClient', () => ({
  engineApiClient: { testTtsSpeech: jest.fn() },
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
import { engineApiClient } from '../../../services/engine/EngineApiClient';
import { runTest, ModuleTestSessionError } from '../../../services/voiceInput/moduleTestSessionService';

const mockPlayAudio = (AudioPlayer as any).playAudio as jest.Mock;
const mockPlayBase64Audio = (AudioPlayer as any).playBase64Audio as jest.Mock;
const mockStop = (AudioPlayer as any).stop as jest.Mock;
const mockTestTtsSpeech = engineApiClient.testTtsSpeech as jest.Mock;
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
  mockPlayBase64Audio.mockResolvedValue(undefined);
  mockStop.mockResolvedValue(undefined);
  mockTestTtsSpeech.mockResolvedValue({
    status: 'ok',
    audio_base64: 'QUJDRA==',
    format: 'wav',
  });
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

describe('TtsTestPanel — stateless direct synthesis (Phase 3-5)', () => {
  it('keeps the test studio available offline when a providerType is given', async () => {
    mockIsConnected = false;
    const utils = await render(<TtsTestPanel providerType="soulvoice" />);
    await flush();

    expect(utils.queryByText('ttsOfflineTitle')).toBeNull();
    expect(utils.getByTestId('tts-play-button')).toBeTruthy();
  });

  it('synthesizes via testTtsSpeech without an entityId and plays base64 audio', async () => {
    const capability = { model: 'soulvoice-x', voice_config_file: 'narrator.voice.json' };
    const utils = await render(
      <TtsTestPanel
        providerType="soulvoice"
        accountId="acc-1"
        capability={capability}
      />,
    );
    await flush();

    await fireEvent.changeText(utils.getByTestId('tts-text-input'), 'Hello direct');
    await fireEvent.press(utils.getByTestId('tts-play-button'));
    await flush();

    expect(mockTestTtsSpeech).toHaveBeenCalledWith({
      text: 'Hello direct',
      provider: 'soulvoice',
      provider_account_id: 'acc-1',
      model: 'soulvoice-x',
      capability_json: capability,
      voice_config_file: 'narrator.voice.json',
    });
    expect(mockPlayBase64Audio).toHaveBeenCalledWith('QUJDRA==', 'audio/wav');
    expect(mockRunTest).not.toHaveBeenCalled();
  });

  it('surfaces a direct-synthesis failure', async () => {
    mockTestTtsSpeech.mockRejectedValue(new Error('engine down'));
    const utils = await render(<TtsTestPanel providerType="soulvoice" />);
    await flush();

    await fireEvent.press(utils.getByTestId('tts-play-button'));
    await flush();

    expect(utils.getByTestId('tts-error')).toBeTruthy();
    expect(mockPlayBase64Audio).not.toHaveBeenCalled();
  });
});

describe('TtsTestPanel — paralinguistic quick-insert chips', () => {
  it('appends a chip tag to the sample text', async () => {
    const tags = ['[laughter]', '[sigh]', '[clears throat]'];
    const utils = await render(
      <TtsTestPanel providerType="soulvoice" paralinguisticTags={tags} />,
    );
    await flush();

    expect(utils.getByTestId('tts-tag-chips')).toBeTruthy();
    expect(utils.getByTestId(paralinguisticTagTestId('[clears throat]'))).toBeTruthy();

    await fireEvent.press(utils.getByTestId(paralinguisticTagTestId('[laughter]')));
    expect(utils.getByTestId('tts-text-input').props.value).toBe('sampleText [laughter]');

    await fireEvent.press(utils.getByTestId(paralinguisticTagTestId('[sigh]')));
    expect(utils.getByTestId('tts-text-input').props.value).toBe(
      'sampleText [laughter] [sigh]',
    );
  });

  it('renders no chips when the model declares none', async () => {
    const utils = await render(<TtsTestPanel providerType="soulvoice" />);
    await flush();
    expect(utils.queryByTestId('tts-tag-chips')).toBeNull();
  });
});
