/**
 * ContextSizeAdvisory — non-blocking cross-slot context-window hint.
 *
 * Covers: silence when the backend window is not the smaller one (or either
 * window is unknown); the backend value in the message; the "Align" action;
 * and the busy state while the align write runs.
 *
 * Theme / i18n are mocked so the component is exercised in isolation.
 */

import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react-native';
import {
  ContextSizeAdvisory,
  CONTEXT_SIZE_ADVISORY_ALIGN_TESTID,
  CONTEXT_SIZE_ADVISORY_TESTID,
  shouldShowContextSizeAdvisory,
} from '../ContextSizeAdvisory';

afterEach(cleanup);

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key} ${JSON.stringify(opts)}` : key,
  }),
}));

jest.mock('../../../contexts/ThemeContext', () => ({
  useAppTheme: () => ({
    theme: {
      colors: {
        accent: { primary: '#b84fd0', secondary: '#4a5fcf' },
        background: { base: '#0b0f19', surface: '#0f1525', elevated: '#151d30' },
        border: { default: '#2e2355' },
        text: { primary: '#f0edf6', secondary: '#d2cde3', muted: '#9692b0' },
        status: { success: '#4caf82', warning: '#f0a23b', error: '#ef5350' },
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

describe('shouldShowContextSizeAdvisory', () => {
  it('shows only when both windows are known and backend < cognition', () => {
    expect(shouldShowContextSizeAdvisory(32768, 65536)).toBe(true);
    expect(shouldShowContextSizeAdvisory(32768, 32768)).toBe(false);
    expect(shouldShowContextSizeAdvisory(65536, 32768)).toBe(false);
  });

  it('is silent when either window is unknown or not finite', () => {
    expect(shouldShowContextSizeAdvisory(undefined, 65536)).toBe(false);
    expect(shouldShowContextSizeAdvisory(32768, undefined)).toBe(false);
    expect(shouldShowContextSizeAdvisory(undefined, undefined)).toBe(false);
    expect(shouldShowContextSizeAdvisory(NaN, 65536)).toBe(false);
    expect(shouldShowContextSizeAdvisory(32768, NaN)).toBe(false);
    expect(shouldShowContextSizeAdvisory(32768, null)).toBe(false);
  });
});

describe('ContextSizeAdvisory', () => {
  it('stays silent when the backend window is not the smaller one', async () => {
    const utils = await render(
      <ContextSizeAdvisory backendTokens={65536} cognitionTokens={32768} onAlign={jest.fn()} />,
    );
    expect(utils.queryByTestId(CONTEXT_SIZE_ADVISORY_TESTID)).toBeNull();
  });

  it('stays silent when a window is unknown', async () => {
    const utils = await render(
      <ContextSizeAdvisory backendTokens={32768} cognitionTokens={undefined} onAlign={jest.fn()} />,
    );
    expect(utils.queryByTestId(CONTEXT_SIZE_ADVISORY_TESTID)).toBeNull();
  });

  it('names the backend window and offers Align', async () => {
    const onAlign = jest.fn();
    const utils = await render(
      <ContextSizeAdvisory backendTokens={32768} cognitionTokens={65536} onAlign={onAlign} />,
    );

    expect(utils.getByTestId(CONTEXT_SIZE_ADVISORY_TESTID)).toBeTruthy();
    expect(utils.getByText(/contextAdvisoryBody/)).toBeTruthy();
    expect(utils.getByText(/"backend":"32\.8K"/)).toBeTruthy();

    await fireEvent.press(utils.getByTestId(CONTEXT_SIZE_ADVISORY_ALIGN_TESTID));
    expect(onAlign).toHaveBeenCalledTimes(1);
  });

  it('disables Align while the write is in flight', async () => {
    const onAlign = jest.fn();
    const utils = await render(
      <ContextSizeAdvisory backendTokens={32768} cognitionTokens={65536} onAlign={onAlign} busy />,
    );
    expect(utils.getByTestId(CONTEXT_SIZE_ADVISORY_ALIGN_TESTID).props.accessibilityState).toEqual(
      { disabled: true },
    );
    await fireEvent.press(utils.getByTestId(CONTEXT_SIZE_ADVISORY_ALIGN_TESTID));
    expect(onAlign).not.toHaveBeenCalled();
  });
});
