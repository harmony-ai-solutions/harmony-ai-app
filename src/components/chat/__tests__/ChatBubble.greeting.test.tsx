/**
 * ChatBubble — greeting partner-message render tests (§1-10, §A21).
 *
 * A `message_type="greeting"` message carries text and is sent BY the character
 * (`sender_entity_id` = character), so it must derive as a PARTNER message and
 * render with the partner presentation. ChatBubble is content-driven (the only
 * message_type check is `'audio'`), so the derivation is purely
 * sender-based — verified here via the exported `isPartnerMessage` helper and a
 * full render of a greeting bubble as partner.
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import { ChatBubble, isPartnerMessage } from '../ChatBubble';
import { ConversationMessage } from '../../../database/models';

jest.mock('../../../utils/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// ChatBubble renders via ThemedText (senju's restyle), which resolves colors
// through useAppTheme — mock the theme context (fixture pattern shared with
// ScenarioGeneratorSheet.test / chatDetailScenarioGenerate.test).
jest.mock('../../../contexts/ThemeContext', () => ({
  useAppTheme: () => ({
    theme: {
      colors: {
        accent: { primary: '#7c3aed', secondary: '#a78bfa' },
        background: { base: '#0f0f1a', surface: '#151d30', elevated: '#1e1e2e' },
        border: { default: '#333333' },
        text: { primary: '#ffffff', secondary: '#cccccc', muted: '#aaaaaa' },
        status: { success: '#22c55e' },
        typography: { headerOpacity: 1, subtextOpacity: 0.7, captionOpacity: 0.5 },
      },
    },
  }),
}));

jest.mock('react-native-linear-gradient', () => {
  const React = require('react');
  const { View } = require('react-native');
  return (props: any) => React.createElement(View, props);
});

// Superset of the jest.setup.js paper mock — Avatar/IconButton/Menu are needed
// by ChatBubble even though the greeting render path only reaches Avatar + the
// partner fallback gradient.
jest.mock('react-native-paper', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    Provider: ({ children }: any) => children,
    DefaultTheme: {},
    Switch: 'Switch',
    Button: 'Button',
    Card: 'Card',
    Text: 'Text',
    Avatar: { Image: (props: any) => React.createElement(View, props) },
    IconButton: (props: any) => React.createElement(View, props),
    Menu: Object.assign(
      (props: any) => React.createElement(React.Fragment, null, props.children),
      { Item: (props: any) => React.createElement(View, props) },
    ),
  };
});

jest.mock('../../../services/AudioPlayer', () => ({
  __esModule: true,
  default: {
    isMessageLoaded: jest.fn(() => false),
    loadAudioForMessage: jest.fn().mockResolvedValue(undefined),
    getDuration: jest.fn().mockResolvedValue(0),
    getProgress: jest.fn().mockResolvedValue({ position: 0 }),
    getState: jest.fn().mockResolvedValue('stopped'),
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
  return {
    EmojiAwareText: ({ children }: any) => React.createElement(Text, null, children),
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

const theme = {
  colors: {
    accent: { primary: '#7c3aed', secondary: '#a78bfa', primaryHover: '#8b5cf6' },
    background: { elevated: '#232333', surface: '#1a1a28', base: '#12121c' },
    text: { primary: '#ffffff', secondary: '#dddddd', muted: '#999999', disabled: '#555555' },
    border: { default: '#333333' },
    status: { error: '#f43f5e', success: '#4caf50' },
  },
} as any;

const greetingMessage: ConversationMessage = {
  id: 'greeting-1',
  entity_id: 'char-entity',
  sender_entity_id: 'char-entity',
  interaction_id: 'interaction-1',
  content: 'Hello there, friend!',
  audio_duration: null,
  message_type: 'greeting',
  emotional_state_bits: 0,
  is_recon_followup: false,
  is_edited: false,
  created_at: new Date('2026-08-10T12:00:00Z'),
  updated_at: new Date('2026-08-10T12:00:00Z'),
  deleted_at: null,
};

describe('isPartnerMessage (greeting derivation)', () => {
  it('treats a greeting sent by the character as a PARTNER message', () => {
    // The greeting's sender is the character, NOT the own entity → partner.
    expect(isPartnerMessage(greetingMessage, 'user-entity')).toBe(true);
  });

  it('treats a message sent by the own entity as an OWN message', () => {
    expect(
      isPartnerMessage({ sender_entity_id: 'user-entity' }, 'user-entity'),
    ).toBe(false);
  });
});

describe('ChatBubble — greeting message render', () => {
  it('renders a message_type="greeting" message as a partner bubble', async () => {
    const { getByText } = await render(
      <ChatBubble
        message={greetingMessage}
        isOwn={false}
        partnerName="Aria"
        theme={theme}
      />,
    );
    // Text content renders via the hasText path (no ChatBubble code change needed).
    expect(getByText('Hello there, friend!')).toBeTruthy();
    // Partner presentation: the initials fallback (no avatar) is shown for the
    // partner — this only renders when !isOwn.
    expect(getByText('AR')).toBeTruthy();
  });

  it('does not show partner presentation for an own message', async () => {
    const { queryByText } = await render(
      <ChatBubble
        message={greetingMessage}
        isOwn={true}
        partnerName="Aria"
        theme={theme}
      />,
    );
    expect(queryByText('AR')).toBeNull();
    expect(queryByText('Hello there, friend!')).toBeTruthy();
  });
});
