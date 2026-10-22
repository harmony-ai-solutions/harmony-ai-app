/**
 * ChatBubble — playback completion-poll classification (parity with the TTS
 * test panel, `src/services/playbackState.ts`).
 *
 * RNTP reports `loading`/`ready` while a track is prepared; the poll used to
 * read "not playing and not buffering" as "finished", which flipped the bubble
 * back to ▶ ~250 ms into playback (and, in the TTS panel, dropped keep-awake
 * mid-sample). Playback now ends only on a genuine end state AFTER at least one
 * `playing` observation. UI consistency only — ChatBubble holds no keep-awake.
 *
 * `paused` is NOT a genuine end (owner device, 2026-10-21): AudioPlayer sets up
 * RNTP with `autoHandleInterruptions: true`, so any audio-focus loss pauses the
 * player. The bubble tries ONE auto-resume per start; if the interruption still
 * holds, it settles back to ▶ with the position kept (the audio stays loaded and
 * a tap continues from there) instead of reporting the message as finished.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { ChatBubble } from '../ChatBubble';
import { ConversationMessage } from '../../../database/models';

jest.mock('../../../utils/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('../../../contexts/ThemeContext', () => ({
  useAppTheme: () => ({ theme: {} }),
}));

jest.mock('react-native-linear-gradient', () => {
  const React = require('react');
  const { View } = require('react-native');
  return ({ children, ...props }: any) => React.createElement(View, props, children);
});

jest.mock('react-native-paper', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    Provider: ({ children }: any) => children,
    DefaultTheme: {},
    Avatar: { Image: (props: any) => React.createElement(View, props) },
    // Keeps `icon` on the rendered node (and a stable testID) so tests can read
    // the play/pause glyph.
    IconButton: ({ icon, ...props }: any) =>
      React.createElement(View, { ...props, testID: `icon-${icon}` }),
    Menu: Object.assign(
      (props: any) => React.createElement(React.Fragment, null, props.children),
      { Item: (props: any) => React.createElement(View, props) },
    ),
  };
});

jest.mock('../../../services/AudioPlayer', () => ({
  __esModule: true,
  default: {
    isMessageLoaded: jest.fn(() => true),
    getCurrentMessageId: jest.fn(() => null),
    loadAudioForMessage: jest.fn().mockResolvedValue(undefined),
    getDuration: jest.fn().mockResolvedValue(12),
    getProgress: jest.fn().mockResolvedValue({ position: 1 }),
    getState: jest.fn().mockResolvedValue('playing'),
    pause: jest.fn().mockResolvedValue(undefined),
    resume: jest.fn().mockResolvedValue(undefined),
    seekTo: jest.fn().mockResolvedValue(undefined),
  },
  AudioPlayer: class {},
}));

jest.mock('../../../services/engine/repositories/conversation_messages', () => ({
  getConversationMessageAudioBase64: jest.fn().mockResolvedValue('UVVJRFJBPT0='),
  getConversationMessageImageBase64: jest.fn().mockResolvedValue(''),
}));

jest.mock('../../../services/EmojiService', () => ({
  __esModule: true,
  default: { parseShortcodes: (s: string) => s },
}));

jest.mock('../../emoji/EmojiAwareText', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { EmojiAwareText: ({ children }: any) => React.createElement(Text, null, children) };
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

import AudioPlayer from '../../../services/AudioPlayer';
import {
  getConversationMessageAudioBase64,
  getConversationMessageImageBase64,
} from '../../../services/engine/repositories/conversation_messages';

const mockGetState = (AudioPlayer as any).getState as jest.Mock;
const mockResume = (AudioPlayer as any).resume as jest.Mock;
const mockPause = (AudioPlayer as any).pause as jest.Mock;
const mockSeekTo = (AudioPlayer as any).seekTo as jest.Mock;
const mockLoadAudio = (AudioPlayer as any).loadAudioForMessage as jest.Mock;
const mockIsMessageLoaded = (AudioPlayer as any).isMessageLoaded as jest.Mock;

const theme = {
  colors: {
    accent: { primary: '#7c3aed' },
    background: { base: '#12121c', elevated: '#232333' },
    text: { primary: '#ffffff', secondary: '#dddddd', muted: '#999999' },
    border: { default: '#333333' },
    status: { error: '#f43f5e' },
  },
} as any;

const audioMessage: ConversationMessage = {
  id: 'audio-1',
  entity_id: 'char-entity',
  sender_entity_id: 'char-entity',
  interaction_id: 'interaction-1',
  content: '',
  audio_data: 'QUJDRA==',
  audio_mime_type: 'audio/wav',
  audio_duration: null,
  message_type: 'audio',
  emotional_state_bits: 0,
  is_recon_followup: false,
  is_edited: false,
  created_at: new Date('2026-08-10T12:00:00Z'),
  updated_at: new Date('2026-08-10T12:00:00Z'),
  deleted_at: null,
};

/** True when the bubble shows the pause glyph (i.e. it believes it is playing). */
function isShowingPlaying(utils: Awaited<ReturnType<typeof render>>): boolean {
  return utils.queryByTestId('icon-pause') !== null;
}

async function flush() {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function tickWithState(state: string) {
  mockGetState.mockResolvedValue(state);
  await act(async () => {
    jest.advanceTimersByTime(250);
    await Promise.resolve();
    await Promise.resolve();
  });
  await flush();
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick', 'setImmediate'] });
  mockGetState.mockResolvedValue('playing');
});

afterEach(() => {
  jest.useRealTimers();
});

describe('ChatBubble — playback completion classification', () => {
  it('does not stop on the pre-start loading/ready transients', async () => {
    const utils = await render(
      <ChatBubble message={audioMessage} isOwn={false} theme={theme} />,
    );
    await flush();

    await fireEvent.press(utils.getByTestId('chat-audio-audio-1'));
    await flush();
    expect(mockResume).toHaveBeenCalled();
    expect(isShowingPlaying(utils)).toBe(true);

    await tickWithState('loading');
    expect(isShowingPlaying(utils)).toBe(true);

    await tickWithState('ready');
    expect(isShowingPlaying(utils)).toBe(true);

    // A `stopped` tick before any `playing` sample is a transient, not an end.
    await tickWithState('stopped');
    expect(isShowingPlaying(utils)).toBe(true);
  });

  it('stops on a genuine end after a playing observation', async () => {
    const utils = await render(
      <ChatBubble message={audioMessage} isOwn={false} theme={theme} />,
    );
    await flush();

    await fireEvent.press(utils.getByTestId('chat-audio-audio-1'));
    await flush();

    await tickWithState('playing');
    expect(isShowingPlaying(utils)).toBe(true);

    await tickWithState('ended');
    expect(isShowingPlaying(utils)).toBe(false);
  });

  it('auto-resumes once on an external pause, then settles (never reports it as ended early)', async () => {
    const utils = await render(
      <ChatBubble message={audioMessage} isOwn={false} theme={theme} />,
    );
    await flush();

    await fireEvent.press(utils.getByTestId('chat-audio-audio-1'));
    await flush();
    await tickWithState('playing');
    expect(isShowingPlaying(utils)).toBe(true);

    mockResume.mockClear();

    // Audio-focus loss (call, another app, Bluetooth noise, OEM ducking) pauses
    // the player underneath the bubble: autoHandleInterruptions, not the user.
    await tickWithState('paused');
    // One resume attempt, and the bubble still shows playing — the pause was
    // not read as "the message finished".
    expect(mockResume).toHaveBeenCalledTimes(1);
    expect(isShowingPlaying(utils)).toBe(true);

    // The interruption still holds focus → settle back to the play glyph with
    // NO second attempt (one per start, never a resume loop). There is no
    // 'paused' surface in the bubble; the loaded track + kept position make the
    // next tap a continuation, which is the closest equivalent.
    await tickWithState('paused');
    expect(mockResume).toHaveBeenCalledTimes(1);
    expect(isShowingPlaying(utils)).toBe(false);
  });

  it('keeps playing when the auto-resume brings the audio back', async () => {
    const utils = await render(
      <ChatBubble message={audioMessage} isOwn={false} theme={theme} />,
    );
    await flush();

    await fireEvent.press(utils.getByTestId('chat-audio-audio-1'));
    await flush();
    await tickWithState('playing');

    mockResume.mockClear();
    await tickWithState('paused');
    expect(mockResume).toHaveBeenCalledTimes(1);

    // Focus came back: the same utterance keeps playing.
    await tickWithState('playing');
    expect(isShowingPlaying(utils)).toBe(true);

    await tickWithState('buffering');
    expect(isShowingPlaying(utils)).toBe(true);

    // …and a genuine end still ends it.
    await tickWithState('ended');
    expect(isShowingPlaying(utils)).toBe(false);
  });
});

/**
 * Transport controls — the same player row shape as the TTS test panel
 * (`TtsTestPanel`): one play/pause toggle, a seek slider, and a
 * `0:03 / 0:57` clock. Regression coverage for the owner's 2026-10-22 report
 * (narrow audio bubble, missing seeker, pause overridden by the auto-resume).
 */
describe('ChatBubble — transport controls', () => {
  it('gives an audio message the width a wrapped text bubble gets', async () => {
    const utils = await render(
      <ChatBubble message={audioMessage} isOwn={false} theme={theme} />,
    );
    await flush();

    const row = utils.getByTestId('chat-audio-row-audio-1');
    const flat = StyleSheet.flatten(row.props.style) as { minWidth?: number };
    expect(flat.minWidth).toBeGreaterThan(200);
  });

  it('seeks with the slider, sized from row metadata before the track is loaded', async () => {
    const message: ConversationMessage = {
      ...audioMessage,
      id: 'seek-1',
      audio_duration: 57,
    };
    const utils = await render(
      <ChatBubble message={message} isOwn={false} theme={theme} />,
    );
    await flush();

    const slider = utils.getByTestId('chat-audio-seek-seek-1');
    expect(slider.props.maximumValue).toBe(57);
    expect(utils.getByText('0:00 / 0:57')).not.toBeNull();

    await fireEvent(slider, 'slidingComplete', 15);
    await flush();
    expect(mockSeekTo).toHaveBeenCalledWith(15);
  });

  it('never auto-resumes a pause the user requested', async () => {
    const utils = await render(
      <ChatBubble message={audioMessage} isOwn={false} theme={theme} />,
    );
    await flush();

    await fireEvent.press(utils.getByTestId('chat-audio-audio-1'));
    await flush();
    await tickWithState('playing');
    expect(isShowingPlaying(utils)).toBe(true);

    mockResume.mockClear();

    // The user taps pause: the intent is claimed before the player is awaited.
    await fireEvent.press(utils.getByTestId('chat-audio-audio-1'));
    await flush();
    expect(mockPause).toHaveBeenCalledTimes(1);
    expect(isShowingPlaying(utils)).toBe(false);

    // A poll tick observing RNTP's `paused` right after that tap must NOT be
    // read as an external interruption (the old auto-resume overrode the tap).
    await tickWithState('paused');
    expect(mockResume).not.toHaveBeenCalled();
    expect(isShowingPlaying(utils)).toBe(false);
  });

  it('still auto-resumes an interruption that was not a tap-pause', async () => {
    const utils = await render(
      <ChatBubble message={audioMessage} isOwn={false} theme={theme} />,
    );
    await flush();

    await fireEvent.press(utils.getByTestId('chat-audio-audio-1'));
    await flush();
    await tickWithState('playing');

    mockResume.mockClear();
    await tickWithState('paused');
    expect(mockResume).toHaveBeenCalledTimes(1);
    expect(isShowingPlaying(utils)).toBe(true);
  });
});

/**
 * Engine-parity two-phase loading: the management-API timeline payload is
 * metadata-only (blob-free). Media presence is signaled by the mime columns /
 * message_type, and the heavy bytes are fetched lazily from
 * `GET /api/messages/:id/{audio,image}` — audio on first play, image inline.
 */
describe('ChatBubble — metadata-only media (two-phase loading)', () => {
  const metaAudioMessage: ConversationMessage = {
    ...audioMessage,
    id: 'meta-audio-1',
    audio_data: null,
    audio_mime_type: 'audio/wav',
  };

  const textMessage: ConversationMessage = {
    ...audioMessage,
    id: 'text-only-1',
    audio_data: null,
    audio_mime_type: null,
    message_type: 'text',
    content: 'Hello there',
  };

  const metaImageMessage: ConversationMessage = {
    ...audioMessage,
    id: 'meta-image-1',
    audio_data: null,
    audio_mime_type: null,
    image_data: null,
    image_mime_type: 'image/jpeg',
    message_type: 'image',
  };

  it('renders the audio player for a metadata-only message (no inline bytes)', async () => {
    const utils = await render(
      <ChatBubble message={metaAudioMessage} isOwn={false} theme={theme} />,
    );
    await flush();

    expect(utils.queryByTestId('chat-audio-meta-audio-1')).not.toBeNull();
  });

  it('fetches audio bytes lazily on first play and hands them to the shared player', async () => {
    mockIsMessageLoaded.mockReturnValue(false);
    const utils = await render(
      <ChatBubble message={metaAudioMessage} isOwn={false} theme={theme} />,
    );
    await flush();

    await fireEvent.press(utils.getByTestId('chat-audio-meta-audio-1'));
    await flush();

    expect(getConversationMessageAudioBase64).toHaveBeenCalledWith('meta-audio-1');
    await flush();
    expect(mockLoadAudio).toHaveBeenCalledWith(
      'meta-audio-1',
      'UVVJRFJBPT0=',
      'audio/wav',
    );
    expect(mockResume).toHaveBeenCalled();
    expect(isShowingPlaying(utils)).toBe(true);
  });

  it('does not render an audio player for a text-only message', async () => {
    const utils = await render(
      <ChatBubble message={textMessage} isOwn={false} theme={theme} />,
    );
    await flush();

    expect(utils.queryByTestId('chat-audio-text-only-1')).toBeNull();
  });

  it('renders an inline image for a metadata-only image message after the lazy fetch', async () => {
    (getConversationMessageImageBase64 as jest.Mock).mockResolvedValue('aW1nYnl0ZXM=');
    const utils = await render(
      <ChatBubble message={metaImageMessage} isOwn={false} theme={theme} />,
    );
    await flush();

    expect(getConversationMessageImageBase64).toHaveBeenCalledWith('meta-image-1');
    expect(utils.queryByTestId('chat-image-meta-image-1')).not.toBeNull();
  });

  it('stops retrying the image fetch after a failure (no refetch loop)', async () => {
    (getConversationMessageImageBase64 as jest.Mock).mockRejectedValue(
      new Error('engine unreachable'),
    );
    const failingImage: ConversationMessage = {
      ...metaImageMessage,
      id: 'meta-image-fail-1',
    };
    const utils = await render(
      <ChatBubble message={failingImage} isOwn={false} theme={theme} />,
    );
    await flush();
    expect(getConversationMessageImageBase64).toHaveBeenCalledTimes(1);

    utils.unmount();
    // A fresh mount of the same row must not re-fire the failed fetch.
    const remount = await render(
      <ChatBubble message={failingImage} isOwn={false} theme={theme} />,
    );
    await flush();
    expect(getConversationMessageImageBase64).toHaveBeenCalledTimes(1);
    expect(remount.queryByTestId('chat-image-meta-image-fail-1')).toBeNull();
  });
});
