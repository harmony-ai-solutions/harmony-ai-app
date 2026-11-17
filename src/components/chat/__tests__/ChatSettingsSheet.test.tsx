/**
 * ChatSettingsSheet — per-conversation display settings (tts-voice-ux Phase 5).
 *
 * Verifies the opt-in "Show emotional state" switch wiring and the always
 * available character-state entry (the sheet stays reachable with the header
 * chip hidden).
 */

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { ChatSettingsSheet } from '../ChatSettingsSheet';

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
        accent: { primary: '#7c3aed', secondary: '#a78bfa' },
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

const onClose = jest.fn();
const onToggleShowEmotionState = jest.fn();
const onOpenCharacterState = jest.fn();

function renderSheet(showEmotionState = false, visible = true) {
  return render(
    <ChatSettingsSheet
      visible={visible}
      onClose={onClose}
      showEmotionState={showEmotionState}
      onToggleShowEmotionState={onToggleShowEmotionState}
      onOpenCharacterState={onOpenCharacterState}
      characterName="Mira"
    />,
  );
}

describe('ChatSettingsSheet', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders nothing while closed', async () => {
    const { queryByTestId } = await renderSheet(false, false);
    expect(queryByTestId('chat-settings-sheet')).toBeNull();
  });

  it('reflects and writes the opt-in toggle', async () => {
    const { getByTestId } = await renderSheet(false);
    const toggle = getByTestId('chat-settings-emotion-switch');
    expect(toggle.props.value).toBe(false);

    await fireEvent(toggle, 'valueChange', true);
    expect(onToggleShowEmotionState).toHaveBeenCalledWith(true);
  });

  it('shows the toggle as on when the preference is on', async () => {
    const { getByTestId } = await renderSheet(true);
    expect(getByTestId('chat-settings-emotion-switch').props.value).toBe(true);
  });

  it('closes itself and opens the character-state sheet', async () => {
    const { getByTestId } = await renderSheet(false);
    await fireEvent.press(getByTestId('chat-settings-open-character-state'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onOpenCharacterState).toHaveBeenCalledTimes(1);
  });
});
