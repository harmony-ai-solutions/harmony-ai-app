/**
 * TtsTestPanel — TTS playback test studio (persona-modules 2-3, Phase 3-5,
 * player rework).
 *
 * The panel has ONE transport: the stateless `testTtsSpeech` API (the
 * entity-bound eventserver path was removed by owner decision 2026-10-21).
 *
 * Verifies:
 *  - no provider selected → honest "choose a provider" hint, no button, no call
 *  - offline keeps the studio available (with a notice) when a provider is known
 *  - synthesis posts the live form settings to `testTtsSpeech` and plays the
 *    returned base64 through the AudioPlayer
 *  - engine failures surface in the error state
 *  - paralinguistic chips append their tag to the sample text, capped at 20
 *    inline with a "[+ N more]" chip opening the picker
 *  - the player row (play/pause never stops the track), completion polling,
 *    replay-vs-resynthesize (guarded by the sample text AND the settings the
 *    sample was synthesized with — a changed voice must re-synthesize), the
 *    seek slider and the download/share flow
 *  - the completion poll never reads the pre-start `loading`/`ready`
 *    transients as "finished" (and needs a fresh `playing` per playback)
 *  - an EXTERNAL pause (audio focus loss → `autoHandleInterruptions`) triggers
 *    one auto-resume, then settles into 'paused' — never 'idle' — so the
 *    player row, the loaded sample and (until it settles) the keep-awake hold
 *    survive the interruption
 *  - keep-awake is held across the synthesis wait AND playback, released on a
 *    genuine end / error / unmount
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

jest.mock('../../../utils/logger', () => {
  // One shared logger object per module instance so tests can assert on warns
  // (the factory runs lazily, hence no out-of-scope references here).
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  return { createLogger: () => logger };
});

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

import AudioPlayer from '../../../services/AudioPlayer';
import { engineApiClient } from '../../../services/engine/EngineApiClient';
import RNFS from 'react-native-fs';
import Share from 'react-native-share';
import {
  activateKeepScreenOn,
  deactivateKeepScreenOn,
} from '../../../services/keepScreenOn';
import { makeWavFixture } from '../../../utils/__tests__/audioFixtures';

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
const mockLogWarn = (jest.requireMock('../../../utils/logger') as {
  createLogger: () => { warn: jest.Mock };
}).createLogger().warn;

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

/** One poll tick that observes a specific RNTP state. */
async function tickWithState(state: string) {
  mockGetState.mockResolvedValue(state);
  await tick();
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
  // `QUJDRA==` is not a recognizable container, so the declared format wins.
  mockTestTtsSpeech.mockResolvedValue({
    status: 'ok',
    audio_base64: 'QUJDRA==',
    format: 'wav',
  });
});

describe('TtsTestPanel — provider requirement + offline notice', () => {
  // Generous timeouts: this block is pure render + flush, but the shared
  // render/flush helper spins microtasks, and a saturated parallel worker can
  // push it past Jest's 5 s default (seen in CI on run 39607735066).
  it('shows the provider hint instead of a test button when no provider is selected', async () => {
    const utils = await render(<TtsTestPanel />);
    await flush();

    // The test-speech route requires `provider`, so there is nothing to press.
    expect(utils.getByTestId('tts-needs-provider')).toBeTruthy();
    expect(utils.getByText('ttsNeedsProviderHint')).toBeTruthy();
    expect(utils.queryByTestId('tts-play-button')).toBeNull();
    expect(utils.queryByTestId('tts-text-input')).toBeNull();
    expect(mockTestTtsSpeech).not.toHaveBeenCalled();
  }, 20000);

  it('keeps the studio available offline when a providerType is given', async () => {
    mockIsConnected = false;
    const utils = await render(<TtsTestPanel providerType="soulvoice" />);
    await flush();

    // Informational only — the engine HTTP route may still answer when only the
    // socket is down, so the buttons stay live.
    expect(utils.getByTestId('tts-offline-notice')).toBeTruthy();
    expect(utils.getByText('ttsOfflineTitle')).toBeTruthy();
    expect(utils.getByText('ttsOfflineHint')).toBeTruthy();
    expect(utils.getByTestId('tts-play-button')).toBeTruthy();
  }, 20000);

  it('renders no offline notice while connected', async () => {
    const utils = await render(<TtsTestPanel providerType="soulvoice" />);
    await flush();

    expect(utils.queryByTestId('tts-offline-notice')).toBeNull();
    expect(utils.queryByText('ttsOfflineTitle')).toBeNull();
  }, 20000);
});

describe('TtsTestPanel — stateless direct synthesis (Phase 3-5)', () => {
  it('synthesizes via testTtsSpeech and plays the returned base64 audio', async () => {
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
    // Duration comes up-front from the static parser, not the first poll.
    expect(mockGetDurationFromBase64).toHaveBeenCalledWith('QUJDRA==', 'audio/wav');
  });

  it('sends a null account id when no account is selected', async () => {
    const utils = await render(<TtsTestPanel providerType="soulvoice" />);
    await flush();

    await fireEvent.press(utils.getByTestId('tts-play-button'));
    await flush();

    expect(mockTestTtsSpeech).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'soulvoice', provider_account_id: null }),
    );
  });

  it('surfaces a direct-synthesis failure', async () => {
    mockTestTtsSpeech.mockRejectedValue(new Error('engine down'));
    const utils = await render(<TtsTestPanel providerType="soulvoice" />);
    await flush();

    await fireEvent.press(utils.getByTestId('tts-play-button'));
    await flush();

    expect(utils.getByTestId('tts-error')).toBeTruthy();
    expect(utils.getByText('ttsError:engine down')).toBeTruthy();
    expect(mockPlayBase64Audio).not.toHaveBeenCalled();
  });

  it('fails cleanly when the engine returns no audio payload', async () => {
    mockTestTtsSpeech.mockResolvedValue({ status: 'ok' });
    const utils = await render(<TtsTestPanel providerType="soulvoice" />);
    await flush();

    await fireEvent.press(utils.getByTestId('tts-play-button'));
    await flush();

    expect(utils.getByText('ttsError:No audio returned')).toBeTruthy();
    expect(mockPlayBase64Audio).not.toHaveBeenCalled();
  });

  it('swaps the big button for the player row while playing', async () => {
    const utils = await render(<TtsTestPanel providerType="soulvoice" />);
    await flush();

    await fireEvent.press(utils.getByTestId('tts-play-button'));
    await flush();
    expect(mockPlayBase64Audio).toHaveBeenCalledTimes(1);

    // Now playing → the compact player row replaces the synthesize button.
    expect(utils.queryByTestId('tts-play-button')).toBeNull();
    expect(utils.getByTestId('tts-play-toggle')).toBeTruthy();
    expect(utils.getByTestId('tts-seek-slider')).toBeTruthy();
    expect(utils.getByTestId('tts-time-label')).toBeTruthy();
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

    // A real `playing` observation, then the player reaches its end state.
    await tickWithState('playing');
    expect(utils.getByTestId('tts-play-toggle')).toBeTruthy();
    await tickWithState('ended');

    expect(utils.queryByTestId('tts-play-toggle')).toBeNull();
    expect(utils.getByTestId('tts-play-button')).toBeTruthy();
    // Audio stays loaded, so the sample remains downloadable.
    expect(isDisabled(utils.getByTestId('tts-download-button'))).toBe(false);
  });

  it('does not end playback on the pre-start loading/ready transients', async () => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick', 'setImmediate'] });
    const utils = await render(<TtsTestPanel providerType="soulvoice" />);
    await flush();

    await fireEvent.press(utils.getByTestId('tts-play-button'));
    await flush();

    // RNTP prepares the track: `loading` then `ready`. Neither is "finished"
    // (the old rule ended playback here ~250 ms in).
    await tickWithState('loading');
    expect(utils.getByTestId('tts-play-toggle')).toBeTruthy();
    expect(mockDeactivateKeepAwake).not.toHaveBeenCalled();

    await tickWithState('ready');
    expect(utils.getByTestId('tts-play-toggle')).toBeTruthy();
    expect(mockDeactivateKeepAwake).not.toHaveBeenCalled();

    // A `none`/`stopped` tick BEFORE any `playing` sample is a transient too.
    await tickWithState('stopped');
    expect(utils.getByTestId('tts-play-toggle')).toBeTruthy();

    // Then it really plays and really ends.
    await tickWithState('playing');
    expect(utils.getByTestId('tts-play-toggle')).toBeTruthy();
    await tickWithState('ended');
    expect(utils.queryByTestId('tts-play-toggle')).toBeNull();
  });

  it('requires a fresh playing observation for every new playback', async () => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick', 'setImmediate'] });
    const utils = await render(<TtsTestPanel providerType="soulvoice" />);
    await flush();

    await fireEvent.press(utils.getByTestId('tts-play-button'));
    await flush();
    await tickWithState('playing');
    await tickWithState('ended');
    expect(utils.getByTestId('tts-play-button')).toBeTruthy();

    // Replay: the previous utterance's "it played" proof must not carry over,
    // so a `ready` tick right after replaying cannot end the new one.
    await fireEvent.press(utils.getByTestId('tts-play-button'));
    await flush();
    expect(utils.getByTestId('tts-play-toggle')).toBeTruthy();

    await tickWithState('ready');
    expect(utils.getByTestId('tts-play-toggle')).toBeTruthy();

    await tickWithState('playing');
    await tickWithState('ended');
    expect(utils.queryByTestId('tts-play-toggle')).toBeNull();
  });

  it('replays unchanged text instantly (rebuilding the queue) and re-synthesizes edited text', async () => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick', 'setImmediate'] });
    const utils = await render(<TtsTestPanel providerType="soulvoice" />);
    await flush();

    await fireEvent.changeText(utils.getByTestId('tts-text-input'), 'Hello replay');
    await fireEvent.press(utils.getByTestId('tts-play-button'));
    await flush();
    expect(mockTestTtsSpeech).toHaveBeenCalledTimes(1);

    // Playback finishes → footer shows the synthesize button again.
    await tickWithState('playing');
    await tickWithState('ended');
    await fireEvent.press(utils.getByTestId('tts-play-button'));
    await flush();

    // Same text → instant replay from the KEPT bytes, no second engine
    // round-trip. The queue is rebuilt instead of seek/resume: an external
    // reset (session teardown) can leave the panel's state ahead of TrackPlayer.
    expect(mockPlayBase64Audio).toHaveBeenCalledWith('QUJDRA==', 'audio/wav');
    expect(mockSeekTo).not.toHaveBeenCalled();
    expect(mockResume).not.toHaveBeenCalled();
    expect(mockTestTtsSpeech).toHaveBeenCalledTimes(1);
    expect(utils.getByTestId('tts-play-toggle')).toBeTruthy();

    // Finish again, then edit the text → re-synthesize.
    await tickWithState('playing');
    await tickWithState('ended');
    await fireEvent.changeText(utils.getByTestId('tts-text-input'), 'Hello edited');
    await fireEvent.press(utils.getByTestId('tts-play-button'));
    await flush();

    expect(mockTestTtsSpeech).toHaveBeenCalledTimes(2);
    expect(mockTestTtsSpeech.mock.calls[1][0].text).toBe('Hello edited');
  });

  it('re-synthesizes when the voice settings change although the text is unchanged', async () => {
    // Owner report, 2026-10-21: changing the TTS model settings kept replaying
    // the previous voice, because the replay guard only compared the sample
    // text. The guard must cover the whole synthesis input (provider, account,
    // capability overlay) as well.
    jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick', 'setImmediate'] });
    const utils = await render(
      <TtsTestPanel
        providerType="soulvoice"
        accountId="acc-1"
        capability={{ model: 'soulvoice-turbo', voice: 'aria' }}
      />,
    );
    await flush();

    await fireEvent.changeText(utils.getByTestId('tts-text-input'), 'Same words');
    await fireEvent.press(utils.getByTestId('tts-play-button'));
    await flush();
    expect(mockTestTtsSpeech).toHaveBeenCalledTimes(1);
    await tickWithState('playing');
    await tickWithState('ended');

    // The editor rebuilds the capability overlay object on every field edit;
    // a changed VOICE (new object, SAME text) must NOT take the replay branch.
    await act(async () => {
      utils.rerender(
        <TtsTestPanel
          providerType="soulvoice"
          accountId="acc-1"
          capability={{ voice: 'aria', model: 'soulvoice-turbo', speed: 1.5 }}
        />,
      );
    });
    await flush();
    await fireEvent.press(utils.getByTestId('tts-play-button'));
    await flush();

    expect(mockTestTtsSpeech).toHaveBeenCalledTimes(2);
    // The new synthesis carries the LIVE settings.
    expect(mockTestTtsSpeech.mock.calls[1][0].capability_json).toEqual({
      voice: 'aria',
      model: 'soulvoice-turbo',
      speed: 1.5,
    });
  });

  it('still replays instantly when the settings prop is re-created with the same content', async () => {
    // The editor's per-slot state rebuilds the object on unrelated renders;
    // a fresh-but-identical capability object must not force a re-synthesis.
    jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick', 'setImmediate'] });
    const capability = { model: 'soulvoice-turbo', voice: 'aria' };
    const utils = await render(
      <TtsTestPanel providerType="soulvoice" accountId="acc-1" capability={capability} />,
    );
    await flush();

    await fireEvent.changeText(utils.getByTestId('tts-text-input'), 'Same words');
    await fireEvent.press(utils.getByTestId('tts-play-button'));
    await flush();
    expect(mockTestTtsSpeech).toHaveBeenCalledTimes(1);
    await tickWithState('playing');
    await tickWithState('ended');

    await act(async () => {
      utils.rerender(
        // Same CONTENT, new object, different key order — must compare equal.
        <TtsTestPanel
          providerType="soulvoice"
          accountId="acc-1"
          capability={{ voice: 'aria', model: 'soulvoice-turbo' }}
        />,
      );
    });
    await flush();
    await fireEvent.press(utils.getByTestId('tts-play-button'));
    await flush();

    // Instant replay from the kept bytes — no second engine round-trip.
    expect(mockTestTtsSpeech).toHaveBeenCalledTimes(1);
    expect(mockPlayBase64Audio).toHaveBeenCalledWith('QUJDRA==', 'audio/wav');
  });

  it('replay re-arms the player after a session teardown reset the shared queue', async () => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick', 'setImmediate'] });
    const utils = await render(<TtsTestPanel providerType="soulvoice" />);
    await flush();

    await fireEvent.changeText(utils.getByTestId('tts-text-input'), 'Hello teardown');
    await fireEvent.press(utils.getByTestId('tts-play-button'));
    await flush();
    await tickWithState('playing');
    await tickWithState('ended');

    // The whole app stopped (ON_STOP): EntitySessionService's teardown resets
    // the shared TrackPlayer (a preview is left alone by the ownership-aware
    // stop, but the queue is gone regardless). The panel is still mounted and
    // believes a sample is loaded.
    mockSeekTo.mockClear();
    mockResume.mockClear();
    mockPlayBase64Audio.mockClear();

    await fireEvent.press(utils.getByTestId('tts-play-button'));
    await flush();

    // The replay reloads the kept bytes — resuming a reset queue would look dead.
    expect(mockPlayBase64Audio).toHaveBeenCalledWith('QUJDRA==', 'audio/wav');
    expect(mockResume).not.toHaveBeenCalled();
    expect(mockSeekTo).not.toHaveBeenCalled();
    expect(utils.getByTestId('tts-play-toggle')).toBeTruthy();
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

  it('holds the screen awake during the synthesis wait, before any audio plays', async () => {
    // A REAL async boundary is required here: with an instantly-resolving mock
    // React batches the synthesizing state away and only ever commits
    // 'playing', so the window under test would never render (in production the
    // engine round-trip is a real task).
    let activatesWhenPlaybackStarts = -1;
    mockPlayBase64Audio.mockImplementation(async () => {
      activatesWhenPlaybackStarts = mockActivateKeepAwake.mock.calls.length;
    });
    mockTestTtsSpeech.mockImplementation(
      () => new Promise((resolve) => {
        setTimeout(
          () => resolve({ status: 'ok', audio_base64: 'QUJDRA==', format: 'wav' }),
          20,
        );
      }),
    );

    const utils = await render(<TtsTestPanel providerType="soulvoice" />);
    await flush();
    // Idle holds nothing.
    expect(mockActivateKeepAwake).not.toHaveBeenCalled();

    const pressed = fireEvent.press(utils.getByTestId('tts-play-button'));
    // Synthesis still in flight; the busy button is what the user sees while
    // the (long, no-touch) wait ages the display idle timer.
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(utils.getByTestId('tts-play-button')).toBeTruthy();
    expect(mockActivateKeepAwake).toHaveBeenCalled();
    expect(mockDeactivateKeepAwake).not.toHaveBeenCalled();

    await pressed;
    await flush();

    // The hold existed BEFORE playback started (the old rule only took it once
    // 'playing' was committed, leaving the whole synthesis wait uncovered).
    expect(activatesWhenPlaybackStarts).toBeGreaterThan(0);
    expect(utils.getByTestId('tts-play-toggle')).toBeTruthy();
    // One hold spans synthesis → playback (no phase churn between the two).
    expect(mockActivateKeepAwake).toHaveBeenCalledTimes(1);
    expect(mockDeactivateKeepAwake).not.toHaveBeenCalled();
    // Real wall-clock waits (setTimeout boundaries) → allow a slow worker.
  }, 20000);

  it('releases the hold on pause and re-acquires it on resume and genuine end', async () => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick', 'setImmediate'] });
    const utils = await render(<TtsTestPanel providerType="soulvoice" />);
    await flush();

    await fireEvent.press(utils.getByTestId('tts-play-button'));
    await flush();
    expect(utils.getByTestId('tts-play-toggle')).toBeTruthy();
    expect(mockActivateKeepAwake).toHaveBeenCalled();

    // Pause releases it; resume re-acquires it.
    mockActivateKeepAwake.mockClear();
    mockDeactivateKeepAwake.mockClear();
    await fireEvent.press(utils.getByTestId('tts-play-toggle'));
    await flush();
    expect(mockDeactivateKeepAwake).toHaveBeenCalled();
    expect(mockActivateKeepAwake).not.toHaveBeenCalled();

    await fireEvent.press(utils.getByTestId('tts-play-toggle'));
    await flush();
    expect(mockActivateKeepAwake).toHaveBeenCalled();

    // A genuine end (after a real `playing` observation) releases it again.
    mockDeactivateKeepAwake.mockClear();
    await tickWithState('playing');
    expect(mockDeactivateKeepAwake).not.toHaveBeenCalled();
    await tickWithState('ended');
    expect(mockDeactivateKeepAwake).toHaveBeenCalled();
  });

  it('releases the wake lock when synthesis fails mid-flight', async () => {
    // Real async boundary (see the synthesis-wait test above) so the panel
    // actually commits 'synthesizing' — and takes the hold — before the engine
    // error lands.
    mockTestTtsSpeech.mockImplementation(
      () => new Promise((_resolve, reject) => {
        setTimeout(() => reject(new Error('engine down')), 20);
      }),
    );

    const utils = await render(<TtsTestPanel providerType="soulvoice" />);
    await flush();

    const pressed = fireEvent.press(utils.getByTestId('tts-play-button'));
    await new Promise((resolve) => setTimeout(resolve, 5));
    // The synthesis wait is covered from the start (that is the whole point).
    expect(mockActivateKeepAwake).toHaveBeenCalled();
    expect(mockDeactivateKeepAwake).not.toHaveBeenCalled();

    await pressed;
    await flush();

    expect(utils.getByText('ttsError:engine down')).toBeTruthy();
    expect(mockDeactivateKeepAwake).toHaveBeenCalled();
  }, 20000);

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

  it('auto-resumes once on an external pause, then settles into paused (never idle)', async () => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick', 'setImmediate'] });
    const utils = await render(<TtsTestPanel providerType="soulvoice" />);
    await flush();

    await fireEvent.press(utils.getByTestId('tts-play-button'));
    await flush();
    await tickWithState('playing');
    expect(utils.getByTestId('tts-play-toggle')).toBeTruthy();

    mockResume.mockClear();
    mockDeactivateKeepAwake.mockClear();

    // An incoming call (or any other app claiming audio focus, Bluetooth
    // turning noisy, OEM ducking) pauses the player: `autoHandleInterruptions`,
    // NOT the user — the user's pause never reaches the poll.
    await tickWithState('paused');

    // Exactly one resume attempt, and the panel is still 'playing': the player
    // row survives and the keep-awake hold is not dropped mid-listen.
    expect(mockResume).toHaveBeenCalledTimes(1);
    expect(utils.getByTestId('tts-play-toggle')).toBeTruthy();
    expect(utils.queryByTestId('tts-play-button')).toBeNull();
    expect(mockDeactivateKeepAwake).not.toHaveBeenCalled();

    // The interruption still holds focus → the next `paused` tick settles into
    // the EXISTING 'paused' phase (row stays, sample stays loaded) with NO
    // second resume attempt (one per utterance, never a resume loop).
    await tickWithState('paused');
    expect(mockResume).toHaveBeenCalledTimes(1);
    expect(utils.getByTestId('tts-play-toggle')).toBeTruthy();
    expect(utils.queryByTestId('tts-play-button')).toBeNull();
    expect(utils.getByTestId('tts-seek-slider')).toBeTruthy();
    // 'paused', not 'idle': the toggle shows ▶ and a tap continues playback.
    expect(utils.getByTestId('tts-play-toggle').props.accessibilityLabel).toBe('play');
    // Paused is a settled state, so the hold is released there (existing rule).
    expect(mockDeactivateKeepAwake).toHaveBeenCalled();

    // The user picks the sample back up where the interruption caught them.
    await fireEvent.press(utils.getByTestId('tts-play-toggle'));
    await flush();
    expect(mockResume).toHaveBeenCalledTimes(2);
    expect(utils.getByTestId('tts-play-toggle').props.accessibilityLabel).toBe('pause');
  });

  it('keeps playing when the auto-resume brings the audio back', async () => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick', 'setImmediate'] });
    const utils = await render(<TtsTestPanel providerType="soulvoice" />);
    await flush();

    await fireEvent.press(utils.getByTestId('tts-play-button'));
    await flush();
    await tickWithState('playing');

    mockResume.mockClear();
    mockDeactivateKeepAwake.mockClear();

    // A brief focus loss: the player is paused, the poll resumes it…
    await tickWithState('paused');
    expect(mockResume).toHaveBeenCalledTimes(1);

    // …and the focus comes back, so the SAME utterance keeps playing.
    await tickWithState('playing');
    expect(utils.getByTestId('tts-play-toggle').props.accessibilityLabel).toBe('pause');
    expect(utils.queryByTestId('tts-play-button')).toBeNull();
    expect(mockDeactivateKeepAwake).not.toHaveBeenCalled();

    // A buffering blip after the interruption is still in progress, not an end.
    await tickWithState('buffering');
    expect(utils.getByTestId('tts-play-toggle')).toBeTruthy();
    expect(mockDeactivateKeepAwake).not.toHaveBeenCalled();

    // And the utterance still ends normally afterwards.
    await tickWithState('ended');
    expect(utils.queryByTestId('tts-play-toggle')).toBeNull();
    expect(utils.getByTestId('tts-play-button')).toBeTruthy();
  });

  it('a genuine ended still ends to idle without any resume attempt', async () => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick', 'setImmediate'] });
    const utils = await render(<TtsTestPanel providerType="soulvoice" />);
    await flush();

    await fireEvent.press(utils.getByTestId('tts-play-button'));
    await flush();
    await tickWithState('playing');

    mockResume.mockClear();
    await tickWithState('ended');

    // The paused path must never hijack a real end.
    expect(mockResume).not.toHaveBeenCalled();
    expect(utils.queryByTestId('tts-play-toggle')).toBeNull();
    expect(utils.getByTestId('tts-play-button')).toBeTruthy();
    // Audio stays loaded after a genuine end (replay/download still work).
    expect(isDisabled(utils.getByTestId('tts-download-button'))).toBe(false);
  });
});

describe('TtsTestPanel — actual audio format (bytes win over the declared label)', () => {
  // The TTS backend declares mp3 but returns WAV bytes; the panel must follow
  // the bytes for the mime, badge, filename and duration parse.
  const wavFixture = makeWavFixture({ durationSeconds: 2 });
  const wavBase64 = wavFixture.base64;

  it('direct synthesis declared mp3 + WAV bytes: mime, badge, filename, duration all WAV', async () => {
    mockTestTtsSpeech.mockResolvedValue({
      status: 'ok',
      audio_base64: wavBase64,
      format: 'mp3',
    });

    const utils = await render(
      <TtsTestPanel providerType="soulvoice" capability={{ format: 'mp3' }} />,
    );
    await flush();

    // Before synthesis the badge shows the DECLARED capability format.
    expect(utils.getByText('MP3')).toBeTruthy();

    await fireEvent.press(utils.getByTestId('tts-play-button'));
    await flush();

    // Player + duration parser get the ACTUAL mime.
    expect(mockPlayBase64Audio).toHaveBeenCalledWith(wavBase64, 'audio/wav');
    expect(mockGetDurationFromBase64).toHaveBeenCalledWith(wavBase64, 'audio/wav');

    // Badge now reflects the stored actual mime.
    expect(utils.getByText('WAV')).toBeTruthy();
    expect(utils.queryByText('MP3')).toBeNull();

    // Download filename + share type follow the stored mime.
    await fireEvent.press(utils.getByTestId('tts-download-button'));
    await flush();
    expect(mockWriteFile.mock.calls[0][0]).toMatch(/\.wav$/);
    expect(mockShareOpen).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'audio/wav' }),
    );

    // One mismatch warning, naming both formats.
    expect(mockLogWarn).toHaveBeenCalledTimes(1);
    expect(mockLogWarn.mock.calls[0][0]).toContain('declared audio/mp3 but bytes are WAV');
  });

  it('response declared audio/mpeg + WAV bytes: plays and stores WAV', async () => {
    mockTestTtsSpeech.mockResolvedValue({
      status: 'ok',
      audio_base64: wavBase64,
      format: 'audio/mpeg',
    });

    const utils = await render(<TtsTestPanel providerType="soulvoice" />);
    await flush();

    await fireEvent.press(utils.getByTestId('tts-play-button'));
    await flush();

    expect(mockPlayBase64Audio).toHaveBeenCalledWith(wavBase64, 'audio/wav');
    expect(mockGetDurationFromBase64).toHaveBeenCalledWith(wavBase64, 'audio/wav');
    expect(utils.getByText('WAV')).toBeTruthy();
    expect(mockLogWarn.mock.calls[0][0]).toContain('declared audio/mpeg but bytes are WAV');
  });

  it('matching declared + actual format: no warning', async () => {
    mockTestTtsSpeech.mockResolvedValue({
      status: 'ok',
      audio_base64: wavBase64,
      format: 'wav',
    });

    const utils = await render(
      <TtsTestPanel providerType="soulvoice" capability={{ format: 'wav' }} />,
    );
    await flush();

    await fireEvent.press(utils.getByTestId('tts-play-button'));
    await flush();

    expect(mockPlayBase64Audio).toHaveBeenCalledWith(wavBase64, 'audio/wav');
    expect(mockLogWarn).not.toHaveBeenCalled();
    expect(utils.getByText('WAV')).toBeTruthy();
  });

  it('unrecognizable bytes keep the declared mime (and never warn)', async () => {
    mockTestTtsSpeech.mockResolvedValue({
      status: 'ok',
      audio_base64: 'QUJDRA==',
      format: 'mp3',
    });

    const utils = await render(<TtsTestPanel providerType="soulvoice" />);
    await flush();

    await fireEvent.press(utils.getByTestId('tts-play-button'));
    await flush();

    expect(mockPlayBase64Audio).toHaveBeenCalledWith('QUJDRA==', 'audio/mp3');
    expect(mockGetDurationFromBase64).toHaveBeenCalledWith('QUJDRA==', 'audio/mp3');
    expect(mockLogWarn).not.toHaveBeenCalled();
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
