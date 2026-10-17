/**
 * AccountSettingsScreen — variant gating (plan 7-14 V4).
 *
 * Full: renders the "Billing & Purchases" card (Manage Subscription).
 * Store: purchases are disabled at launch, so the whole billing card is hidden
 * while Account & Security stays.
 */

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react-native';
import { AccountSettingsScreen } from '../AccountSettingsScreen';
import { setAppVariantForTests } from '../../../config/appVariant';

afterEach(() => {
  cleanup();
  setAppVariantForTests(null);
});

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('@react-navigation/native', () => {
  const React = require('react');
  return {
    useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn(), replace: jest.fn() }),
    // The screen now fetches device-auth status on focus; run it as a plain
    // effect (no NavigationContainer is mounted in this suite).
    useFocusEffect: (cb: () => void | (() => void)) => React.useEffect(cb, [cb]),
  };
});

// The screen is state-aware now — the billing card renders only when signed in.
jest.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: {
      id: 'u1',
      email: 'ada@example.com',
      display_name: 'Ada Lovelace',
      email_verified: true,
      created_at: '2026-01-01T00:00:00Z',
    },
    status: 'authenticated',
    signInVersion: 0,
    signInViaPortal: jest.fn(async () => {}),
    cancelSignIn: jest.fn(),
    logout: jest.fn(async () => {}),
    refreshUser: jest.fn(),
    pendingSignIn: null,
  }),
}));

jest.mock('../../../services/cloud/DeviceAuthService', () => ({
  __esModule: true,
  default: { getStatus: jest.fn(async () => ({ authorized: true, authorizationPending: false })) },
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
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
        background: { base: '#0f0f1a', surface: '#151d30', elevated: '#1e1e2e', hover: '#26263a' },
        accent: { primary: '#7c3aed', secondary: '#a78bfa', primaryHover: '#8b5cf6', secondaryHover: '#c4b5fd' },
        text: { primary: '#ffffff', secondary: '#cccccc', muted: '#aaaaaa', disabled: '#555555' },
        status: {
          success: '#22c55e',
          successBg: 'rgba(34,197,94,0.1)',
          warning: '#f59e0b',
          warningBg: 'rgba(245,158,11,0.1)',
          error: '#ef4444',
          errorBg: 'rgba(239,68,68,0.1)',
          info: '#3b82f6',
          infoBg: 'rgba(59,130,246,0.1)',
        },
        border: { default: '#333333', focus: '#7c3aed', hover: '#444444', accent: '#7c3aed' },
        gradients: { primary: '#7c3aed', secondary: '#4a4a6a', surface: '#1e1e2e' },
        glass: {
          cardOpacity: 0.5,
          glowOpacity: 0.08,
          glowRadius: 14,
          borderGradientStart: '#fff',
          borderGradientEnd: '#a78bfa',
        },
        typography: { headerOpacity: 1.0, subtextOpacity: 0.7, captionOpacity: 0.5 },
      },
    },
  }),
}));

jest.mock('../../../utils/colorUtils', () => ({
  hexToRgba: (hex: string) => hex,
}));

describe('AccountSettingsScreen — variant gating (7-14 V4)', () => {
  it('full: shows the Billing & Purchases card', async () => {
    setAppVariantForTests('full');
    await render(<AccountSettingsScreen />);

    // SectionHeader uppercases its title.
    expect(screen.getByText('BILLING')).toBeTruthy();
    expect(screen.getByText('manageSubscription')).toBeTruthy();
  });

  it('store: hides the Billing & Purchases card but keeps Account & Security', async () => {
    setAppVariantForTests('store');
    await render(<AccountSettingsScreen />);

    expect(screen.queryByText('BILLING')).toBeNull();
    expect(screen.queryByText('manageSubscription')).toBeNull();
    // Account & Security stays.
    expect(screen.getByText('SECURITY')).toBeTruthy();
    expect(screen.getByText('biometricLock')).toBeTruthy();
  });
});
