/**
 * GreetingShimmer — RNTL render tests (§1-10).
 *
 * Verifies reduced-motion handling: default = animated shimmer wrapper,
 * reduce-motion enabled = static skeleton (no Animated opacity wrapper).
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import { GreetingShimmer } from '../GreetingShimmer';
import { useReducedMotion } from '../../../hooks/useReducedMotion';

const mockUseReducedMotion = useReducedMotion as jest.Mock;

jest.mock('../../../hooks/useReducedMotion', () => ({
  useReducedMotion: jest.fn(() => false),
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

jest.mock('../../../contexts/ThemeContext', () => ({
  useAppTheme: () => ({ theme: { colors: { background: { elevated: '#222' } } } }),
}));

describe('GreetingShimmer', () => {
  beforeEach(() => {
    mockUseReducedMotion.mockReset();
    mockUseReducedMotion.mockReturnValue(false);
  });

  it('renders the animated shimmer wrapper by default', async () => {
    const { getByTestId, queryByTestId } = await render(<GreetingShimmer />);
    expect(getByTestId('greeting-shimmer-animated')).toBeTruthy();
    expect(queryByTestId('greeting-shimmer-static')).toBeNull();
  });

  it('renders a static skeleton when reduce-motion is enabled', async () => {
    mockUseReducedMotion.mockReturnValue(true);
    const { getByTestId, queryByTestId } = await render(<GreetingShimmer />);
    expect(getByTestId('greeting-shimmer-static')).toBeTruthy();
    expect(queryByTestId('greeting-shimmer-animated')).toBeNull();
  });
});
