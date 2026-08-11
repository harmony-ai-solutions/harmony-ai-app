/**
 * GreetingBubble — RNTL render tests (§1-10).
 *
 * Verifies:
 *  - `arrived` state renders the greeting as a partner glass message with
 *    macros resolved for display (resolveMacros: {{char}}/{{user}}, unknown
 *    macros preserved).
 *  - `preparing` state (P2 surface) renders shimmer + TypingIndicator.
 *  - empty resolved text renders nothing.
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import { GreetingBubble } from '../GreetingBubble';

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

const theme = null; // ThemedText/ThemedCard are mocked — theme is not consumed.

describe('GreetingBubble', () => {
  it('renders the arrived greeting with macros resolved ({{char}}/{{user}})', async () => {
    const { getByText } = await render(
      <GreetingBubble
        text={'Hello {{char}}, it\'s {{user}}!'}
        charName="Aria"
        userName="Alex"
        theme={theme}
        state="arrived"
      />,
    );
    expect(getByText("Hello Aria, it's Alex!")).toBeTruthy();
  });

  it('preserves unknown {{...}} macros unchanged', async () => {
    const { getByText } = await render(
      <GreetingBubble
        text="Roll the {{dice}}!"
        charName="Aria"
        userName="Alex"
        theme={theme}
      />,
    );
    expect(getByText('Roll the {{dice}}!')).toBeTruthy();
  });

  it('resolves all occurrences of a macro', async () => {
    const { getByText } = await render(
      <GreetingBubble
        text="{{char}} waves at {{user}}. {{char}} smiles."
        charName="Aria"
        userName="Alex"
        theme={theme}
      />,
    );
    expect(getByText('Aria waves at Alex. Aria smiles.')).toBeTruthy();
  });

  it('renders the preparing state with shimmer + typing indicator (P2 surface)', async () => {
    const { getByTestId } = await render(
      <GreetingBubble
        text=""
        charName="Aria"
        userName="Alex"
        theme={theme}
        state="preparing"
      />,
    );
    expect(getByTestId('greeting-bubble-preparing')).toBeTruthy();
    expect(getByTestId('greeting-shimmer-mock')).toBeTruthy();
    expect(getByTestId('typing-indicator-mock')).toBeTruthy();
  });

  it('renders nothing for an arrived greeting with no resolvable text', async () => {
    const { queryByTestId } = await render(
      <GreetingBubble
        text="   "
        charName="Aria"
        userName="Alex"
        theme={theme}
      />,
    );
    expect(queryByTestId('greeting-bubble-text')).toBeNull();
  });
});
