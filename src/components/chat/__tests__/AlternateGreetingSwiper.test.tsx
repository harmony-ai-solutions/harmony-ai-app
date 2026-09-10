/**
 * AlternateGreetingSwiper — RNTL render tests (§1-10).
 *
 * Verifies:
 *  - the authored greetings pager renders with the {{n}}/{{total}} indicator.
 *  - chevron navigation updates the indicator/page (P1 authored-only).
 *  - reduced-motion → chevrons only (single static page, no swipe pager).
 *  - parseAlternateGreetings degrades malformed/non-array JSON to [].
 */

import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import {
  AlternateGreetingSwiper,
  parseAlternateGreetings,
} from '../AlternateGreetingSwiper';
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
      // Plain View (not TouchableOpacity): keeps onPress on the HOST element so
      // tests can invoke it directly. Mirrors real ThemedButton by firing
      // onPress even when disabled; disabled surfaced via accessibilityState.
      React.createElement(
        View,
        { onPress: () => onPress(), accessibilityState: { disabled: !!disabled }, testID, accessibilityRole: 'button', ...props },
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

describe('AlternateGreetingSwiper', () => {
  beforeEach(() => {
    mockUseReducedMotion.mockReset();
    mockUseReducedMotion.mockReturnValue(false);
  });

  it('renders the swipe pager with a {{n}}/{{total}} indicator', async () => {
    const { getByTestId, getByText } = await render(
      <AlternateGreetingSwiper
        greetings={GREETINGS}
        charName="Aria"
        userName="Alex"
        theme={theme}
      />,
    );
    expect(getByTestId('greeting-swiper-pager')).toBeTruthy();
    // All pages render inside the pager (horizontal ScrollView).
    expect(getByText('First hello')).toBeTruthy();
    expect(getByText('Second hello')).toBeTruthy();
    expect(getByText('Third hello')).toBeTruthy();
    expect(getByTestId('greeting-swiper-indicator').props.children).toBe('1/3');
  });

  it('chevron navigation updates the indicator and clamps at the ends', async () => {
    const { getByTestId } = await render(
      <AlternateGreetingSwiper
        greetings={GREETINGS}
        charName="Aria"
        userName="Alex"
        theme={theme}
      />,
    );
    // Start at 1/3 — prev disabled.
    expect(getByTestId('greeting-swiper-prev').props.accessibilityState.disabled).toBe(true);
    await act(async () => {
      getByTestId('greeting-swiper-next').props.onPress();
    });
    expect(getByTestId('greeting-swiper-indicator').props.children).toBe('2/3');
    expect(getByTestId('greeting-swiper-prev').props.accessibilityState.disabled).toBe(false);
    await act(async () => {
      getByTestId('greeting-swiper-next').props.onPress();
    });
    expect(getByTestId('greeting-swiper-indicator').props.children).toBe('3/3');
    expect(getByTestId('greeting-swiper-next').props.accessibilityState.disabled).toBe(true);
    // Pressing next past the end stays clamped.
    await act(async () => {
      getByTestId('greeting-swiper-next').props.onPress();
    });
    expect(getByTestId('greeting-swiper-indicator').props.children).toBe('3/3');
  });

  it('reduced-motion → chevrons only (single static page, no pager)', async () => {
    mockUseReducedMotion.mockReturnValue(true);
    const { getByTestId, queryByTestId, getByText } = await render(
      <AlternateGreetingSwiper
        greetings={GREETINGS}
        charName="Aria"
        userName="Alex"
        theme={theme}
      />,
    );
    expect(queryByTestId('greeting-swiper-pager')).toBeNull();
    expect(getByTestId('greeting-swiper-page')).toBeTruthy();
    // Only the current page renders; chevrons still navigate.
    expect(getByText('First hello')).toBeTruthy();
    expect(getByTestId('greeting-swiper-indicator').props.children).toBe('1/3');
    await act(async () => {
      getByTestId('greeting-swiper-next').props.onPress();
    });
    expect(getByText('Second hello')).toBeTruthy();
    expect(getByTestId('greeting-swiper-indicator').props.children).toBe('2/3');
  });

  it('renders nothing when there are no greetings', async () => {
    const { queryByTestId } = await render(
      <AlternateGreetingSwiper
        greetings={[]}
        charName="Aria"
        userName="Alex"
        theme={theme}
      />,
    );
    expect(queryByTestId('greeting-swiper-pager')).toBeNull();
    expect(queryByTestId('greeting-swiper-page')).toBeNull();
  });
});

describe('parseAlternateGreetings', () => {
  it('parses a valid JSON string array', () => {
    expect(
      parseAlternateGreetings('["One","Two","Three"]'),
    ).toEqual(['One', 'Two', 'Three']);
  });

  it('filters out non-strings and empty entries', () => {
    expect(
      parseAlternateGreetings('["One", 42, "", null, "Two"]'),
    ).toEqual(['One', 'Two']);
  });

  it('returns [] for null/undefined/empty', () => {
    expect(parseAlternateGreetings(null)).toEqual([]);
    expect(parseAlternateGreetings(undefined)).toEqual([]);
    expect(parseAlternateGreetings('')).toEqual([]);
  });

  it('returns [] for malformed JSON or non-array values', () => {
    expect(parseAlternateGreetings('{not json')).toEqual([]);
    expect(parseAlternateGreetings('{"a":1}')).toEqual([]);
    expect(parseAlternateGreetings('"just a string"')).toEqual([]);
  });
});
