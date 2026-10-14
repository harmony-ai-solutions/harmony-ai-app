/**
 * EngineContractGate — variant gating (plan 7-14 V4).
 *
 * The blocking "engine too old" card must never steer a store user to the
 * portal / sideload install instructions (store-policy violation). Full keeps
 * the channel-aware action button; store renders a neutral, non-linked caption.
 */

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react-native';
import { EngineContractGate } from '../EngineContractGate';
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

// The engine canary reports a too-old contract so the card renders.
jest.mock('../../../services/engine/EngineService', () => ({
  getEngineVersionState: () => ({ engineVersion: 'v0.1.0', contract: 'too_old' }),
  onEngineVersionStateChange: jest.fn(() => jest.fn()),
}));

jest.mock('../../../services/updates/UpdateAvailableService', () => ({
  getUpdateState: () => ({ engineUpdate: null, appUpdate: null, checkedAt: null, dismissed: [] }),
}));

jest.mock('../../../config/appChannel', () => ({
  isApkSelfUpdateAvailable: () => false,
}));

jest.mock('../../../config/cloud', () => ({
  RELEASES: { baseUrl: 'https://download.soulbits.app' },
}));

describe('EngineContractGate — variant gating (7-14 V4)', () => {
  it('full: renders the channel-aware action button', async () => {
    setAppVariantForTests('full');
    await render(<EngineContractGate />);

    expect(screen.getByTestId('engine-contract-gate')).toBeTruthy();
    expect(screen.getByTestId('engine-contract-gate-action')).toBeTruthy();
    expect(screen.queryByText('tooOld.storeHint')).toBeNull();
  });

  it('store: renders a neutral non-linked caption instead of the action button', async () => {
    setAppVariantForTests('store');
    await render(<EngineContractGate />);

    expect(screen.getByTestId('engine-contract-gate')).toBeTruthy();
    expect(screen.getByText('tooOld.storeHint')).toBeTruthy();
    // No action button → no link to the portal / sideload instructions.
    expect(screen.queryByTestId('engine-contract-gate-action')).toBeNull();
  });
});
