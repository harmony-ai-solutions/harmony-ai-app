/**
 * AlternateGreetingSwiper — regenerate-slot tests (§2-4).
 *
 * The regenerate slot (enabled in P2) appears AFTER the last authored greeting
 * when `onRegenerateSwipe` is provided: swiping past the last page (or tapping
 * ⟳) shows a shimmer slot + dispatches GENERATE_GREETING via the callback.
 * No slot when `onRegenerateSwipe` is absent (P1 authored-only behaviour).
 */

import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { AlternateGreetingSwiper } from '../AlternateGreetingSwiper';
import { useReducedMotion } from '../../../hooks/useReducedMotion';

const mockUseReducedMotion = useReducedMotion as jest.Mock;

jest.mock('../../../hooks/useReducedMotion', () => ({
  useReducedMotion: jest.fn(() => false),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: { n?: number; total?: number }) =>
      key === 'swipeIndicator' ? `${params?.n}/${params?.total}` : key,
  }),
}));

jest.mock('../../themed/ThemedCard', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    ThemedCard: ({ children, style, ...props }: any) =>
      React.createElement(View, { style, ...props }, children),
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

jest.mock('../../themed/ThemedButton', () => {
  const React = require('react');
  const { View, Text } = require('react-native');
  return {
    __esModule: true,
    ThemedButton: ({ label, onPress, disabled, testID, ...props }: any) =>
      React.createElement(
        View,
        {
          onPress: () => onPress(),
          accessibilityState: { disabled: !!disabled },
          testID,
          accessibilityRole: 'button',
          ...props,
        },
        React.createElement(Text, { testID: `${testID}-label` }, label),
      ),
  };
});

jest.mock('../GreetingShimmer', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    GreetingShimmer: () => React.createElement(View, { testID: 'greeting-shimmer-mock' }),
  };
});

jest.mock('../TypingIndicator', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    TypingIndicator: () => React.createElement(View, { testID: 'typing-indicator-mock' }),
  };
});

const theme = null;
const GREETINGS = ['First hello', 'Second hello', 'Third hello'];

describe('AlternateGreetingSwiper — regenerate slot (§2-4)', () => {
  beforeEach(() => {
    mockUseReducedMotion.mockReset();
    mockUseReducedMotion.mockReturnValue(false);
  });

  it('renders the regenerate slot after the last authored greeting when onRegenerateSwipe is provided', async () => {
    const onRegenerate = jest.fn();
    const { getByTestId } = await render(
      <AlternateGreetingSwiper
        greetings={GREETINGS}
        charName="Aria"
        userName="Alex"
        theme={theme}
        onRegenerateSwipe={onRegenerate}
      />,
    );
    // The slot is rendered as an extra page in the pager.
    expect(getByTestId('greeting-swiper-regenerate')).toBeTruthy();
    expect(getByTestId('greeting-swiper-regenerate-button')).toBeTruthy();
    expect(getByTestId('greeting-shimmer-mock')).toBeTruthy();
  });

  it('chevron past the last authored greeting lands on the regenerate slot and dispatches', async () => {
    const onRegenerate = jest.fn();
    const { getByTestId } = await render(
      <AlternateGreetingSwiper
        greetings={GREETINGS}
        charName="Aria"
        userName="Alex"
        theme={theme}
        onRegenerateSwipe={onRegenerate}
      />,
    );
    // 1/3 → 2/3 → 3/3 (last authored) — next then steps onto the slot (4/3).
    await act(async () => {
      getByTestId('greeting-swiper-next').props.onPress();
    });
    await act(async () => {
      getByTestId('greeting-swiper-next').props.onPress();
    });
    expect(getByTestId('greeting-swiper-indicator').props.children).toBe('3/3');
    await act(async () => {
      getByTestId('greeting-swiper-next').props.onPress();
    });
    expect(getByTestId('greeting-swiper-indicator').props.children).toBe('4/3');
    expect(onRegenerate).toHaveBeenCalledTimes(1);
  });

  it('tapping the ⟳ Generate-another button dispatches', async () => {
    const onRegenerate = jest.fn();
    const { getByTestId } = await render(
      <AlternateGreetingSwiper
        greetings={GREETINGS}
        charName="Aria"
        userName="Alex"
        theme={theme}
        onRegenerateSwipe={onRegenerate}
      />,
    );
    await fireEvent.press(getByTestId('greeting-swiper-regenerate-button'));
    expect(onRegenerate).toHaveBeenCalledTimes(1);
    expect(getByTestId('greeting-swiper-regenerate-button-label').props.children).toBe(
      'generateAnother',
    );
  });

  it('no regenerate slot when onRegenerateSwipe is absent (authored-only)', async () => {
    const { queryByTestId } = await render(
      <AlternateGreetingSwiper
        greetings={GREETINGS}
        charName="Aria"
        userName="Alex"
        theme={theme}
      />,
    );
    expect(queryByTestId('greeting-swiper-regenerate')).toBeNull();
  });

  it('reduced-motion: chevrons navigate onto the regenerate slot and dispatch', async () => {
    mockUseReducedMotion.mockReturnValue(true);
    const onRegenerate = jest.fn();
    const { getByTestId, getByText } = await render(
      <AlternateGreetingSwiper
        greetings={GREETINGS}
        charName="Aria"
        userName="Alex"
        theme={theme}
        onRegenerateSwipe={onRegenerate}
      />,
    );
    // Static single page: step through 1/3 → 2/3 → 3/3 → regenerate slot.
    await act(async () => {
      getByTestId('greeting-swiper-next').props.onPress();
    });
    await act(async () => {
      getByTestId('greeting-swiper-next').props.onPress();
    });
    expect(getByText('Third hello')).toBeTruthy();
    await act(async () => {
      getByTestId('greeting-swiper-next').props.onPress();
    });
    expect(getByTestId('greeting-swiper-regenerate')).toBeTruthy();
    expect(getByTestId('greeting-swiper-indicator').props.children).toBe('4/3');
    expect(onRegenerate).toHaveBeenCalledTimes(1);
  });
});
