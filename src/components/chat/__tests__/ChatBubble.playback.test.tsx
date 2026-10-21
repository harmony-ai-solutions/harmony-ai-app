/**
 * ChatBubble — playback completion-poll classification (parity with the TTS
 * test panel, `src/services/playbackState.ts`).
 *
 * RNTP reports `loading`/`ready` while a track is prepared; the poll used to
 * read "not playing and not buffering" as "finished", which flipped the bubble
 * back to ▶ ~250 ms into playback (and, in the TTS panel, dropped keep-awake
 * mid-sample). Playback now ends only on a genuine end state AFTER at least one
 * `playing` observation. UI consistency only — ChatBubble holds no keep-awake.
 */

import React from 'react';
import { View } from 'react-native';
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

const mockGetState = (AudioPlayer as any).getState as jest.Mock;
const mockResume = (AudioPlayer as any).resume as jest.Mock;

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
});
