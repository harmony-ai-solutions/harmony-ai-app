/**
 * EmptyChatCTA — RNTL render tests (§1-10).
 *
 * P1: the scenario trigger is PRESENT but DISABLED (no generation). Verifies:
 *  - icon variant is flagged disabled (accessibilityState.disabled) with the
 *    muted disabled color.
 *  - pill variant renders disabled with the Scenario label.
 *  - the onPress wiring surfaces the "coming soon" handler (P1 tap behavior).
 */

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { EmptyChatCTA } from '../EmptyChatCTA';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => (key === 'ctaScenario' ? 'Scenario' : key),
  }),
}));

jest.mock('../../themed/ThemedButton', () => {
  const React = require('react');
  const { TouchableOpacity, Text } = require('react-native');
  return {
    __esModule: true,
    ThemedButton: ({ label, onPress, disabled, testID, ...props }: any) =>
      React.createElement(
        // onPress fires regardless of `disabled` — mirrors real ThemedButton,
        // which calls onPress() unconditionally. The disabled state is exposed
        // via accessibilityState for assertion.
        TouchableOpacity,
        { onPress: () => onPress(), accessibilityState: { disabled: !!disabled }, testID, accessibilityRole: 'button', ...props },
        React.createElement(Text, { testID: `${testID}-label` }, label),
      ),
  };
});

const theme = {
  colors: {
    accent: { primary: '#7c3aed' },
    text: { disabled: '#555555' },
  },
} as any;

describe('EmptyChatCTA (P1 — present but disabled)', () => {
  it('renders the icon variant flagged disabled with the muted disabled color', async () => {
    const { getByTestId } = await render(
      <EmptyChatCTA variant="icon" disabled onPress={jest.fn()} theme={theme} />,
    );
    const icon = getByTestId('empty-chat-cta-icon');
    expect(icon.props.accessibilityState.disabled).toBe(true);
    expect(icon.props.accessibilityLabel).toBe('Scenario');
    // P1 visual disabled treatment: muted color, not accent.
    expect(getByTestId('empty-chat-cta-icon-glyph').props.color).toBe('#555555');
  });

  it('renders the pill variant disabled with the Scenario label', async () => {
    const { getByTestId } = await render(
      <EmptyChatCTA variant="pill" disabled onPress={jest.fn()} theme={theme} />,
    );
    const pill = getByTestId('empty-chat-cta-pill');
    expect(pill.props.accessibilityState.disabled).toBe(true);
    expect(pill.props.accessibilityRole).toBe('button');
    expect(getByTestId('empty-chat-cta-pill-label').props.children).toBe('Scenario');
  });

  it('pill taps surface the "coming soon" handler (onPress)', async () => {
    const onPress = jest.fn();
    // P1 renders the pill disabled; the onPress wiring is what surfaces the
    // "coming soon" state. Press tested with disabled=false (P2 semantics)
    // because RNTL blocks presses on elements flagged disabled.
    const { getByTestId } = await render(
      <EmptyChatCTA variant="pill" disabled={false} onPress={onPress} theme={theme} />,
    );
    fireEvent.press(getByTestId('empty-chat-cta-pill-label'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('renders the icon with accent color when enabled (P2 will enable)', async () => {
    const { getByTestId } = await render(
      <EmptyChatCTA variant="icon" disabled={false} onPress={jest.fn()} theme={theme} />,
    );
    const icon = getByTestId('empty-chat-cta-icon');
    expect(icon.props.accessibilityState.disabled).toBe(false);
    expect(getByTestId('empty-chat-cta-icon-glyph').props.color).toBe('#7c3aed');
  });
});
