/**
 * TtsTestPanel — TTS playback test studio (persona-modules 2-3, Phase 3-5,
 * player rework).
 *
 * Verifies:
 *  - offline state renders "Connect to Soulbits Engine to test" and never plays
 *  - no-entity state renders the disabled hint (ModuleConfigEditScreen has no
 *    entity binding) and never synthesizes
 *  - Play INITs a debug session, sends TTS_GENERATE_SPEECH 'binary', awaits
 *    ENTITY_UTTERANCE and plays the inline audio via AudioPlayer
 *  - stateless direct synthesis via `testTtsSpeech` works with only a
 *    `providerType` (no entityId)
 *  - the session-service error message surfaces in the error state
 *  - paralinguistic chips append their tag to the sample text, capped at 20
 *    inline with a "[+ N more]" chip opening the picker
 *  - the player row (play/pause never stops the track), completion polling,
 *    replay-vs-resynthesize, the seek slider and the download/share flow
 *  - keep-awake is activated only while actually playing
 */

import React from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react-native';
import { TtsTestPanel, paralinguisticTagTestId } from '../TtsTestPanel';

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});
beforeEach(cleanup);

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    // Interpolate the values tests assert on (`[+ N more]`, error messages).
    t: (key: string, options?: { count?: number; message?: string }) => {
      if (!options) return key;
      if (typeof options.count === 'number') return `${key}:${options.count}`;
      if (typeof options.message === 'string') return `${key}:${options.message}`;
      return key;
    },
  }),
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

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// The panel's player row seeker — the real native component cannot render here.
jest.mock('@react-native-community/slider', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: ({ testID, onSlidingComplete, ...props }: any) =>
      React.createElement(View, { testID, onSlidingComplete, ...props }),
  };
});

jest.mock('react-native-fs', () => {
  const mockFs = {
    CachesDirectoryPath: '/mock/caches',
    DocumentDirectoryPath: '/mock/documents',
    writeFile: jest.fn(() => Promise.resolve()),
  };
  return { __esModule: true, default: mockFs };
});

jest.mock('react-native-share', () => ({
  __esModule: true,
  default: { open: jest.fn(() => Promise.resolve({ success: true })) },
}));

jest.mock('../../../services/keepScreenOn', () => ({
  activateKeepScreenOn: jest.fn(() => Promise.resolve()),
  deactivateKeepScreenOn: jest.fn(() => Promise.resolve()),
}));

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
    pause: jest.fn(),
    resume: jest.fn(),
    seekTo: jest.fn(),
    getProgress: jest.fn(),
    getState: jest.fn(),
    getDurationFromBase64: jest.fn(),
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
import RNFS from 'react-native-fs';
import Share from 'react-native-share';
import {
  activateKeepScreenOn,
  deactivateKeepScreenOn,
} from '../../../services/keepScreenOn';

const mockPlayAudio = (AudioPlayer as any).playAudio as jest.Mock;
const mockPlayBase64Audio = (AudioPlayer as any).playBase64Audio as jest.Mock;
const mockStop = (AudioPlayer as any).stop as jest.Mock;
const mockPause = (AudioPlayer as any).pause as jest.Mock;
const mockResume = (AudioPlayer as any).resume as jest.Mock;
const mockSeekTo = (AudioPlayer as any).seekTo as jest.Mock;
const mockGetProgress = (AudioPlayer as any).getProgress as jest.Mock;
const mockGetState = (AudioPlayer as any).getState as jest.Mock;
const mockGetDurationFromBase64 = (AudioPlayer as any).getDurationFromBase64 as jest.Mock;
const mockWriteFile = (RNFS as any).writeFile as jest.Mock;
const mockShareOpen = (Share as any).open as jest.Mock;
const mockActivateKeepAwake = activateKeepScreenOn as jest.Mock;
const mockDeactivateKeepAwake = deactivateKeepScreenOn as jest.Mock;
const mockTestTtsSpeech = engineApiClient.testTtsSpeech as jest.Mock;
mockRunTest = runTest as jest.Mock;

async function flush() {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

/** Advance the 250 ms completion poll one tick and drain its async work. */
async function tick(ms = 250) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
    await Promise.resolve();
    await Promise.resolve();
  });
  await flush();
}

/** True when a TouchableOpacity was rendered disabled. */
function isDisabled(element: any): boolean {
  return (
    element.props.disabled === true ||
    element.props.accessibilityState?.disabled === true
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockIsConnected = true;
  mockCapturedSendEvents = [];
  mockPlayAudio.mockResolvedValue(undefined);
  mockPlayBase64Audio.mockResolvedValue(undefined);
  mockStop.mockResolvedValue(undefined);
  mockPause.mockResolvedValue(undefined);
  mockResume.mockResolvedValue(undefined);
  mockSeekTo.mockResolvedValue(undefined);
  mockGetProgress.mockResolvedValue({ position: 1, duration: 12, buffered: 0 });
  mockGetState.mockResolvedValue('playing');
  mockGetDurationFromBase64.mockResolvedValue(12);
  mockWriteFile.mockResolvedValue(undefined);
  mockShareOpen.mockResolvedValue({ success: true });
  mockActivateKeepAwake.mockResolvedValue(undefined);
  mockDeactivateKeepAwake.mockResolvedValue(undefined);
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

  it('swaps the big button for the player row while playing', async () => {
    const utils = await render(<TtsTestPanel entityId="ai-entity-1" />);
    await flush();

    await fireEvent.press(utils.getByTestId('tts-play-button'));
    await flush();
    expect(mockPlayAudio).toHaveBeenCalledTimes(1);

    // Now playing → the compact player row replaces the synthesize button.
    expect(utils.queryByTestId('tts-play-button')).toBeNull();
    expect(utils.getByTestId('tts-play-toggle')).toBeTruthy();
    expect(utils.getByTestId('tts-seek-slider')).toBeTruthy();
    expect(utils.getByTestId('tts-time-label')).toBeTruthy();
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
    // Duration comes up-front from the static parser, not the first poll.
    expect(mockGetDurationFromBase64).toHaveBeenCalledWith('QUJDRA==', 'audio/wav');
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

describe('TtsTestPanel — player row, download and completion', () => {
  it('downloads and shares the synthesized sample with failOnCancel: false', async () => {
    const utils = await render(<TtsTestPanel providerType="soulvoice" />);
    await flush();

    await fireEvent.press(utils.getByTestId('tts-play-button'));
    await flush();

    const download = utils.getByTestId('tts-download-button');
    expect(isDisabled(download)).toBe(false);

    await fireEvent.press(download);
    await flush();

    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining('/mock/caches/soulbits-tts-sample-'),
      'QUJDRA==',
      'base64',
    );
    expect(mockWriteFile.mock.calls[0][0]).toMatch(/\.wav$/);
    expect(mockShareOpen).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Soulbits voice sample',
        subject: 'Soulbits voice sample',
        type: 'audio/wav',
        url: expect.stringContaining('file:///mock/caches/'),
        failOnCancel: false,
      }),
    );
    expect(utils.queryByTestId('tts-error')).toBeNull();
  });

  it('keeps the download button disabled before any synthesis', async () => {
    const utils = await render(<TtsTestPanel providerType="soulvoice" />);
    await flush();

    const download = utils.getByTestId('tts-download-button');
    expect(isDisabled(download)).toBe(true);

    await fireEvent.press(download);
    await flush();
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('surfaces a real download failure through the error text', async () => {
    mockWriteFile.mockRejectedValue(new Error('disk full'));
    const utils = await render(<TtsTestPanel providerType="soulvoice" />);
    await flush();

    await fireEvent.press(utils.getByTestId('tts-play-button'));
    await flush();
    await fireEvent.press(utils.getByTestId('tts-download-button'));
    await flush();

    expect(utils.getByTestId('tts-error')).toBeTruthy();
    expect(utils.getByText('downloadFailed:disk full')).toBeTruthy();
    expect(mockShareOpen).not.toHaveBeenCalled();
  });

  it('resets to idle when the poll reports playback ended, keeping the audio', async () => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick', 'setImmediate'] });
    const utils = await render(<TtsTestPanel providerType="soulvoice" />);
    await flush();

    await fireEvent.press(utils.getByTestId('tts-play-button'));
    await flush();
    expect(utils.getByTestId('tts-play-toggle')).toBeTruthy();

    // Poll reports a live position, then the player leaves playing/buffering.
    mockGetState.mockResolvedValue('ready');
    await tick();

    expect(utils.queryByTestId('tts-play-toggle')).toBeNull();
    expect(utils.getByTestId('tts-play-button')).toBeTruthy();
    // Audio stays loaded, so the sample remains downloadable.
    expect(isDisabled(utils.getByTestId('tts-download-button'))).toBe(false);
  });

  it('replays unchanged text instantly and re-synthesizes edited text', async () => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick', 'setImmediate'] });
    const utils = await render(<TtsTestPanel providerType="soulvoice" />);
    await flush();

    await fireEvent.changeText(utils.getByTestId('tts-text-input'), 'Hello replay');
    await fireEvent.press(utils.getByTestId('tts-play-button'));
    await flush();
    expect(mockTestTtsSpeech).toHaveBeenCalledTimes(1);

    // Playback finishes → footer shows the synthesize button again.
    mockGetState.mockResolvedValue('ready');
    await tick();
    await fireEvent.press(utils.getByTestId('tts-play-button'));
    await flush();

    // Same text → instant replay, no second engine round-trip.
    expect(mockSeekTo).toHaveBeenCalledWith(0);
    expect(mockResume).toHaveBeenCalled();
    expect(mockTestTtsSpeech).toHaveBeenCalledTimes(1);
    expect(utils.getByTestId('tts-play-toggle')).toBeTruthy();

    // Finish again, then edit the text → re-synthesize.
    mockGetState.mockResolvedValue('ready');
    await tick();
    await fireEvent.changeText(utils.getByTestId('tts-text-input'), 'Hello edited');
    await fireEvent.press(utils.getByTestId('tts-play-button'));
    await flush();

    expect(mockTestTtsSpeech).toHaveBeenCalledTimes(2);
    expect(mockTestTtsSpeech.mock.calls[1][0].text).toBe('Hello edited');
  });

  it('pauses and resumes without stopping the loaded track', async () => {
    const utils = await render(<TtsTestPanel providerType="soulvoice" />);
    await flush();

    await fireEvent.press(utils.getByTestId('tts-play-button'));
    await flush();

    await fireEvent.press(utils.getByTestId('tts-play-toggle'));
    await flush();
    expect(mockPause).toHaveBeenCalledTimes(1);
    expect(mockStop).not.toHaveBeenCalled();
    // Still paused: the player row stays, with the play glyph.
    expect(utils.getByTestId('tts-play-toggle')).toBeTruthy();

    await fireEvent.press(utils.getByTestId('tts-play-toggle'));
    await flush();
    expect(mockResume).toHaveBeenCalledTimes(1);
    expect(mockStop).not.toHaveBeenCalled();
  });

  it('seeks the loaded track when the slider is released', async () => {
    const utils = await render(<TtsTestPanel providerType="soulvoice" />);
    await flush();

    await fireEvent.press(utils.getByTestId('tts-play-button'));
    await flush();

    await fireEvent(utils.getByTestId('tts-seek-slider'), 'slidingComplete', 5);
    await flush();

    expect(mockSeekTo).toHaveBeenCalledWith(5);
    expect(utils.getByTestId('tts-time-label').props.children).toBe('0:05 / 0:12');
  });

  it('keeps the screen awake only while actually playing', async () => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick', 'setImmediate'] });
    const utils = await render(<TtsTestPanel providerType="soulvoice" />);
    await flush();
    expect(mockActivateKeepAwake).not.toHaveBeenCalled();

    await fireEvent.press(utils.getByTestId('tts-play-button'));
    await flush();
    expect(mockActivateKeepAwake).toHaveBeenCalled();

    // Pause releases the wake lock and never re-activates.
    mockActivateKeepAwake.mockClear();
    await fireEvent.press(utils.getByTestId('tts-play-toggle'));
    await flush();
    expect(mockDeactivateKeepAwake).toHaveBeenCalled();
    expect(mockActivateKeepAwake).not.toHaveBeenCalled();

    // Resume re-acquires it; playback end releases it again.
    mockActivateKeepAwake.mockClear();
    mockDeactivateKeepAwake.mockClear();
    await fireEvent.press(utils.getByTestId('tts-play-toggle'));
    await flush();
    expect(mockActivateKeepAwake).toHaveBeenCalled();

    mockGetState.mockResolvedValue('ready');
    await tick();
    expect(mockDeactivateKeepAwake).toHaveBeenCalled();
  });

  it('releases the wake lock when unmounted while playing', async () => {
    const utils = await render(<TtsTestPanel providerType="soulvoice" />);
    await flush();

    await fireEvent.press(utils.getByTestId('tts-play-button'));
    await flush();
    expect(mockActivateKeepAwake).toHaveBeenCalled();

    mockDeactivateKeepAwake.mockClear();
    await utils.unmount();
    expect(mockDeactivateKeepAwake).toHaveBeenCalled();
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

  it('caps the inline chips at 20 and folds the rest into the more-chip', async () => {
    const tags = Array.from({ length: 25 }, (_, i) => `[tag-${i + 1}]`);
    const utils = await render(
      <TtsTestPanel providerType="soulvoice" paralinguisticTags={tags} />,
    );
    await flush();

    const rendered = tags.filter((tag) =>
      utils.queryByTestId(paralinguisticTagTestId(tag)) !== null,
    );
    expect(rendered).toHaveLength(20);
    expect(utils.getByTestId('tts-tag-more')).toBeTruthy();
    expect(utils.getByText('tagMore:5')).toBeTruthy();
  });

  it('does not render a more-chip when the vocabulary fits inline', async () => {
    const tags = Array.from({ length: 20 }, (_, i) => `[tag-${i + 1}]`);
    const utils = await render(
      <TtsTestPanel providerType="soulvoice" paralinguisticTags={tags} />,
    );
    await flush();

    expect(utils.queryByTestId('tts-tag-more')).toBeNull();
    expect(utils.queryByTestId(paralinguisticTagTestId('[tag-20]'))).toBeTruthy();
  });

  it('inserts a tag picked from the full-list modal', async () => {
    // > 20 tags → the picker is the only way to reach the tail. FlatList renders
    // only its first window here, so pick a tag sorted into that window.
    const tags = Array.from({ length: 25 }, (_, i) => `[tag${i + 1}]`);
    const utils = await render(
      <TtsTestPanel providerType="soulvoice" paralinguisticTags={tags} />,
    );
    await flush();

    await fireEvent.press(utils.getByTestId('tts-tag-more'));
    await flush();

    await fireEvent.press(utils.getByTestId('tts-tag-row:tag1'));
    await flush();

    expect(utils.getByTestId('tts-text-input').props.value).toBe('sampleText [tag1]');
  });
});
