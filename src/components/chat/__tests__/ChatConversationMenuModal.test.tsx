/**
 * ChatConversationMenuModal — emotional-state parity toggle (tts-voice-ux
 * Phase 5). The action is opt-in for the parent: it renders only when the
 * chat list supplies the handler (it owns the per-conversation participantKey).
 */

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { ChatConversationMenuModal } from '../ChatConversationMenuModal';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../../../contexts/ThemeContext', () => ({
  useAppTheme: () => ({
    theme: {
      colors: {
        accent: { primary: '#7c3aed', secondary: '#a78bfa', primaryHover: '#6d28d9' },
        background: { base: '#0f0f1a', surface: '#151d30', elevated: '#1e1e2e' },
        border: { default: '#333333' },
        text: { primary: '#ffffff', secondary: '#cccccc', muted: '#aaaaaa' },
        status: { error: '#ef4444', success: '#22c55e' },
        typography: { headerOpacity: 1, subtextOpacity: 0.7, captionOpacity: 0.5 },
      },
    },
  }),
}));

jest.mock('../../themed/ThemedText', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    ThemedText: ({ children, style, ...props }: any) =>
      React.createElement(Text, { style, ...props }, children),
  };
});

jest.mock('../../../utils/haptics', () => ({ hapticLightPress: jest.fn() }));

jest.mock('react-native-linear-gradient', () => {
  const React = require('react');
  const { View } = require('react-native');
  return ({ children, style, ...props }: any) =>
    React.createElement(View, { style, ...props }, children);
});

const SETTINGS = {
  pinned: false,
  archived: false,
  muted: false,
  disabled: false,
  unreadCount: 0,
  replyMode: 'realistic' as const,
};

function renderMenu(extra: Record<string, unknown> = {}) {
  const onClose = jest.fn();
  const onToggleEmotionState = jest.fn();
  return {
    onClose,
    onToggleEmotionState,
    utils: render(
      <ChatConversationMenuModal
        visible
        conversationName="Mira"
        settings={SETTINGS}
        isDisabled={false}
        onClose={onClose}
        onTogglePin={jest.fn()}
        onToggleArchive={jest.fn()}
        onToggleMute={jest.fn()}
        onOpenBubble={jest.fn()}
        onToggleRead={jest.fn()}
        onToggleDisable={jest.fn()}
        onToggleReplyMode={jest.fn()}
        onDelete={jest.fn()}
        onToggleEmotionState={onToggleEmotionState}
        {...extra}
      />,
    ),
  };
}

describe('ChatConversationMenuModal — emotional-state parity toggle', () => {
  it('offers "Show emotional state" when the toggle is currently off', async () => {
    const { utils, onClose, onToggleEmotionState } = renderMenu({
      emotionStateVisible: false,
    });
    const { getByLabelText } = await utils;

    await fireEvent.press(getByLabelText('menuShowEmotionState'));
    expect(onClose).toHaveBeenCalled();
    expect(onToggleEmotionState).toHaveBeenCalledTimes(1);
  });

  it('is state-aware ("Hide emotional state" when on)', async () => {
    const { utils } = renderMenu({ emotionStateVisible: true });
    const rendered = await utils;
    expect(rendered.getByLabelText('menuHideEmotionState')).toBeTruthy();
    expect(rendered.queryByLabelText('menuShowEmotionState')).toBeNull();
  });

  it('renders no action when the parent does not wire the handler', async () => {
    const { utils } = renderMenu({ onToggleEmotionState: undefined });
    const { queryByLabelText, getByLabelText } = await utils;

    expect(queryByLabelText('menuShowEmotionState')).toBeNull();
    expect(queryByLabelText('menuHideEmotionState')).toBeNull();
    // The existing actions are untouched.
    expect(getByLabelText('menuDelete')).toBeTruthy();
  });
});
