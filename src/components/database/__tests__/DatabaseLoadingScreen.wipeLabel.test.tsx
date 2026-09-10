/**
 * DatabaseLoadingScreen rebuild-gate label tests (phase 3-2 / D58 as amended
 * by D61).
 *
 * The "Rebuilding from Soulbits Engine…" label rides the existing loading
 * screen while `isRebuilding` is true (the boot-window wipe is in progress)
 * and reverts to the normal initialization label once the wipe completes.
 * Proper i18n keys (en only), label text "Soulbits Engine" — the t() mock
 * returns the key, so the rendered strings ARE the keys.
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {DatabaseLoadingScreen} from '../DatabaseLoadingScreen';

const mockUseDatabase = jest.fn();
jest.mock('../../../contexts/DatabaseContext', () => ({
  useDatabase: (...args: any[]) => mockUseDatabase(...args),
}));

jest.mock('../../../contexts/ThemeContext', () => ({
  useAppTheme: () => ({
    theme: {
      colors: {
        accent: {primary: '#000000'},
        status: {error: '#ff5252'},
      },
    },
  }),
}));

jest.mock('../../../contexts/AppAlertContext', () => ({
  useAppAlert: () => ({showAlert: jest.fn()}),
}));

// t returns the key so the rendered text nodes ARE the i18n keys.
jest.mock('react-i18next', () => ({
  useTranslation: () => ({t: (key: string) => key}),
}));

// Themed components render children inline so label assertions reach the tree.
jest.mock('../../themed/ThemedView', () => ({
  ThemedView: ({children}: any) => children,
}));
jest.mock('../../themed/ThemedText', () => ({
  ThemedText: ({children}: any) => children,
}));
jest.mock('../../themed/ThemedGradient', () => ({
  ThemedGradient: ({children}: any) => children ?? null,
}));
jest.mock('../../themed/ThemedCard', () => ({
  ThemedCard: ({children}: any) => children,
}));
jest.mock('../../themed/ThemedButton', () => ({
  ThemedButton: ({label}: any) => label,
}));

const baseDbState = {
  isLoading: true,
  error: null,
  retryInitialization: jest.fn(),
};

function renderLoading() {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(<DatabaseLoadingScreen />);
  });
  return renderer;
}

function renderedText(renderer: ReactTestRenderer.ReactTestRenderer): string {
  return JSON.stringify(renderer.toJSON());
}

describe('DatabaseLoadingScreen rebuild gate (D58/D61)', () => {
  it('shows the "Rebuilding from Soulbits Engine…" label while the wipe runs', () => {
    mockUseDatabase.mockReturnValue({...baseDbState, isRebuilding: true});
    const renderer = renderLoading();

    const text = renderedText(renderer);
    expect(text).toContain('rebuilding');
    expect(text).toContain('rebuildingDescription');
    expect(text).not.toContain('initializing');
    expect(text).not.toContain('settingUp');
  });

  it('shows the normal initialization label once the wipe completes', () => {
    mockUseDatabase.mockReturnValue({...baseDbState, isRebuilding: false});
    const renderer = renderLoading();

    const text = renderedText(renderer);
    expect(text).toContain('initializing');
    expect(text).toContain('settingUp');
    expect(text).not.toContain('rebuilding');
  });

  it('renders the error state when initialization fails after a wipe', () => {
    mockUseDatabase.mockReturnValue({
      ...baseDbState,
      isRebuilding: false,
      error: 'wipe failed',
    });
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(<DatabaseLoadingScreen />);
    });

    const text = renderedText(renderer);
    expect(text).toContain('errorTitle');
    expect(text).toContain('wipe failed');
  });
});