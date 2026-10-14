/**
 * SoulBalanceDropdown — variant gating (plan 7-14 V4).
 *
 * Full: the balance badge is a button that opens the wallet action dropdown
 * ("Buy Souls" / "Sell Souls"). Store: purchases are disabled at launch, so the
 * badge is a static, informational pill with NO wallet actions.
 */

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react-native';
import { SoulBalanceDropdown } from '../SoulBalanceDropdown';
import { setAppVariantForTests } from '../../../config/appVariant';

afterEach(() => {
  cleanup();
  setAppVariantForTests(null);
});

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('react-native-linear-gradient', () => {
  const React = require('react');
  const { View } = require('react-native');
  return ({ children, style, ...props }: any) =>
    React.createElement(View, { style, ...props }, children);
});

jest.mock('../../../contexts/ThemeContext', () => ({
  useAppTheme: () => ({
    theme: {
      colors: {
        background: { base: '#0f0f1a', surface: '#151d30', elevated: '#1e1e2e' },
        accent: { primary: '#7c3aed', secondary: '#a78bfa', primaryHover: '#8b5cf6' },
        text: { primary: '#ffffff', secondary: '#cccccc', muted: '#aaaaaa', disabled: '#555555' },
        border: { default: '#333333' },
        status: { error: '#ef4444' },
        typography: { headerOpacity: 1.0, subtextOpacity: 0.7, captionOpacity: 0.5 },
      },
    },
  }),
}));

jest.mock('../../../contexts/AppAlertContext', () => ({
  useAppAlert: () => ({ showAlert: jest.fn() }),
}));

jest.mock('../../../utils/colorUtils', () => ({
  hexToRgba: (hex: string) => hex,
}));

describe('SoulBalanceDropdown — variant gating (7-14 V4)', () => {
  it('full: renders the interactive balance badge (wallet actions available)', async () => {
    setAppVariantForTests('full');
    await render(<SoulBalanceDropdown balance={50} />);

    const badge = screen.getByTestId('soul-balance-badge');
    expect(badge).toBeTruthy();
    expect(badge.props.accessibilityRole).toBe('button');
    expect(screen.getByText('50')).toBeTruthy();
    expect(screen.getByText('souls')).toBeTruthy();
  });

  it('store: renders a static balance pill with no wallet actions', async () => {
    setAppVariantForTests('store');
    await render(<SoulBalanceDropdown balance={50} />);

    const badge = screen.getByTestId('soul-balance-badge');
    expect(badge).toBeTruthy();
    // Not a button — there is no dropdown to open.
    expect(badge.props.accessibilityRole).toBeUndefined();
    // Balance stays visible.
    expect(screen.getByText('50')).toBeTruthy();
    expect(screen.getByText('souls')).toBeTruthy();
    // No purchase / cash-out affordances anywhere.
    expect(screen.queryByTestId('wallet-action-buy')).toBeNull();
    expect(screen.queryByTestId('wallet-action-sell')).toBeNull();
    expect(screen.queryByTestId('soul-wallet-dropdown')).toBeNull();
  });
});
