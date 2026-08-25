/**
 * VisibilitySettingsSection — RNTL component tests.
 *
 * Covers the three required behaviors of the reusable visibility control:
 *   1. renders all three segments (private / public / marketplace),
 *   2. shows the SOUL price input only when marketplace is selected,
 *   3. callbacks fire (segment tap → onChange, price edit → onPriceChange,
 *      clamped ≥ 0).
 *
 * i18n is stubbed to return the key itself, so assertions run against the
 * legacy createAI visibility keys (visibilityPrivate/Public/Marketplace) and
 * the market priceLabel/priceHint keys exactly as the component resolves them.
 *
 * NOTE: RNTL v14's fireEvent is async — every fireEvent call must be awaited
 * (see MarketplaceItemDetailScreen.test.tsx), otherwise the pending act()
 * update poisons the next test's render.
 */

import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react-native';
import { VisibilitySettingsSection } from '../VisibilitySettingsSection';

// Explicit cleanup — RNTL auto-cleanup plus multiple renders per file.
afterEach(cleanup);
beforeEach(() => {
  jest.clearAllMocks();
});

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

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
  hexToRgba: (hex: string, alpha: number) => hex,
}));

// SoulIcon uses the (mocked) ThemeContext only — safe to render as-is.

const baseProps = {
  value: 'marketplace' as const,
  onChange: jest.fn(),
  priceSouls: 120,
  onPriceChange: jest.fn(),
};

describe('VisibilitySettingsSection', () => {
  it('renders all three visibility segments', async () => {
    const { getByText, getAllByText, getByTestId } = await render(
      <VisibilitySettingsSection {...baseProps} />,
    );

    // Segment labels (i18n keys pass through the stub).
    expect(getByText('visibilityPrivate')).toBeTruthy();
    expect(getByText('visibilityPublic')).toBeTruthy();
    // Marketplace label appears twice — summary row + segment.
    expect(getAllByText('visibilityMarketplace')).toHaveLength(2);

    // All three segment pressables exist.
    expect(getByTestId('visibility-segment-private')).toBeTruthy();
    expect(getByTestId('visibility-segment-public')).toBeTruthy();
    expect(getByTestId('visibility-segment-marketplace')).toBeTruthy();

    // Summary row shows the active selection hint.
    expect(getByText('visibilityMarketplaceHint')).toBeTruthy();
  });

  it('shows the SOUL price input only when marketplace is selected', async () => {
    // Marketplace → price input present.
    const marketplace = await render(<VisibilitySettingsSection {...baseProps} />);
    expect(marketplace.getByTestId('visibility-price-input')).toBeTruthy();
    expect(marketplace.getByText('priceLabel')).toBeTruthy();
    expect(marketplace.getByText('priceHint')).toBeTruthy();
    await marketplace.unmount();

    // Private → price input hidden, private hint shown instead.
    const priv = await render(
      <VisibilitySettingsSection {...baseProps} value="private" />,
    );
    expect(priv.queryByTestId('visibility-price-input')).toBeNull();
    expect(priv.queryByText('priceLabel')).toBeNull();
    expect(priv.getByText('visibilityPrivateHint')).toBeTruthy();
    await priv.unmount();

    // Public → price input hidden.
    const pub = await render(
      <VisibilitySettingsSection {...baseProps} value="public" />,
    );
    expect(pub.queryByTestId('visibility-price-input')).toBeNull();
  });

  it('fires onChange when a segment is tapped', async () => {
    const onChange = jest.fn();
    const { getByTestId } = await render(
      <VisibilitySettingsSection {...baseProps} onChange={onChange} />,
    );

    await fireEvent.press(getByTestId('visibility-segment-public'));
    expect(onChange).toHaveBeenCalledWith('public');

    await fireEvent.press(getByTestId('visibility-segment-private'));
    expect(onChange).toHaveBeenCalledWith('private');
  });

  it('fires onPriceChange with the clamped non-negative price on edit', async () => {
    const onPriceChange = jest.fn();
    const { getByTestId } = await render(
      <VisibilitySettingsSection {...baseProps} onPriceChange={onPriceChange} />,
    );

    await fireEvent.changeText(getByTestId('visibility-price-input'), '250');
    expect(onPriceChange).toHaveBeenCalledWith(250);

    // Negative input clamps to 0.
    await fireEvent.changeText(getByTestId('visibility-price-input'), '-5');
    expect(onPriceChange).toHaveBeenCalledWith(0);
  });

  it('disables segments and the price input when disabled', async () => {
    const onChange = jest.fn();
    const { getByTestId } = await render(
      <VisibilitySettingsSection {...baseProps} onChange={onChange} disabled />,
    );

    await fireEvent.press(getByTestId('visibility-segment-public'));
    expect(onChange).not.toHaveBeenCalled();

    expect(getByTestId('visibility-price-input').props.editable).toBe(false);
  });
});