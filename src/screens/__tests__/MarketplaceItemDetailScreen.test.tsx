/**
 * MarketplaceItemDetailScreen — phase-1 review restoration tests.
 *
 * Locks in the restored preview region (image data-URL, text-preview block,
 * unlock hint for unowned paid listings, sales-count metadata row) plus the
 * honest post-acquire flow (owned flips only on success → MyLibrary).
 *
 * The MarketplaceService module is mocked so the screen can be driven
 * directly with a paid/unowned, owned, and free listing fixture.
 */

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import { MarketplaceItemDetailScreen } from '../MarketplaceItemDetailScreen';
import type {
  MarketplaceListingDetail,
  OwnedLibraryEntry,
} from '../../services/marketplace/MarketplaceService';

// Explicit cleanup — RNTL auto-cleanup plus multiple renders per file.
afterEach(cleanup);
beforeEach(() => {
  jest.clearAllMocks();
});

// ── Module mocks ──────────────────────────────────────────────────────────

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('react-native-linear-gradient', () => {
  const React = require('react');
  const { View } = require('react-native');
  return ({ children, style, ...props }: any) =>
    React.createElement(View, { style, ...props }, children);
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const mockNavigate = jest.fn();
const mockShowToast = jest.fn();
const mockShowAlert = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }),
  useRoute: () => ({ params: { listingId: 'listing-luna' } }),
}));

jest.mock('../../contexts/ThemeContext', () => ({
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

jest.mock('../../contexts/AppToastContext', () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

jest.mock('../../contexts/AppAlertContext', () => ({
  useAppAlert: () => ({ showAlert: mockShowAlert }),
}));

jest.mock('../../utils/colorUtils', () => ({
  hexToRgba: (hex: string, alpha: number) => hex,
}));

// The screen's data path — drive it with explicit fixtures per test.
jest.mock('../../services/marketplace/MarketplaceService', () => ({
  getListing: jest.fn(),
  getLibrary: jest.fn(),
  getMyListings: jest.fn(),
  acquire: jest.fn(),
}));

import {
  getListing,
  getLibrary,
  getMyListings,
  acquire,
} from '../../services/marketplace/MarketplaceService';

// ── Fixtures ──────────────────────────────────────────────────────────────

const paidListing: MarketplaceListingDetail = {
  id: 'listing-luna',
  title: 'Luna',
  creatorName: 'Aurora Vale',
  creatorAvatarText: 'AV',
  priceSouls: 120,
  thumbnailText: 'Luna',
  status: 'active',
  salesCount: 42,
  createdAt: '2026-08-01T00:00:00.000Z',
  description: 'A moonlit companion who remembers.',
  tags: ['companion', 'night'],
  snapshot: {
    name: 'Luna',
    description: null,
    personality: null,
    base_prompt: null,
    scenario: null,
    mes_example: null,
    voice_characteristics: null,
    typing_speed_wpm: null,
    audio_response_chance_percent: null,
    image_data: null,
    image_mime: null,
  },
  previewText: 'A field-tested teaser for Luna.',
  previewImageData: 'iVBORw0KGgo=',
  previewMimeType: 'image/png',
};

const freeListing: MarketplaceListingDetail = {
  ...paidListing,
  priceSouls: 0,
  salesCount: 3,
};

const ownedEntry: OwnedLibraryEntry = {
  id: 'entry-1',
  listingId: 'listing-luna',
  title: 'Luna',
  kind: 'purchase',
  acquiredAt: '2026-08-10T00:00:00.000Z',
  asset: {
    id: 'asset-1',
    title: 'Luna',
    kind: 'character_card',
    snapshot: paidListing.snapshot,
    createdAt: '2026-08-10T00:00:00.000Z',
  },
};

async function renderScreen() {
  await render(<MarketplaceItemDetailScreen />);
  // Wait for the loading gate to clear (getListing/getLibrary/getMyListings).
  await screen.findByText('salesCountLabel');
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('MarketplaceItemDetailScreen — restored preview region', () => {
  it('renders the preview image, preview text, unlock hint and sales count for an unowned paid listing', async () => {
    (getListing as jest.Mock).mockResolvedValue(paidListing);
    (getLibrary as jest.Mock).mockResolvedValue([]);
    (getMyListings as jest.Mock).mockResolvedValue([]);

    await renderScreen();

    // Preview image — data URL built from previewImageData + previewMimeType.
    const img = screen.root!.queryAll(n => n.type === 'Image');
    expect(img).toHaveLength(1);
    expect(img[0].props.source.uri).toBe('data:image/png;base64,iVBORw0KGgo=');

    // Text-preview block (the paid teaser, with a trailing ellipsis).
    expect(screen.getByText(/field-tested teaser for Luna/)).toBeTruthy();

    // Unlock hint — unowned AND priced.
    expect(screen.getByText('unlockHint')).toBeTruthy();

    // Sales-count metadata row.
    expect(screen.getByText('salesCountLabel')).toBeTruthy();
  });

  it('hides the unlock hint once the listing is owned', async () => {
    (getListing as jest.Mock).mockResolvedValue(paidListing);
    (getLibrary as jest.Mock).mockResolvedValue([ownedEntry]);
    (getMyListings as jest.Mock).mockResolvedValue([]);

    await renderScreen();

    expect(screen.getByText(/field-tested teaser for Luna/)).toBeTruthy();
    expect(screen.queryByText('unlockHint')).toBeNull();
    // Sticky bar reflects the owned state (no acquire button).
    expect(screen.getByText('ownLabel')).toBeTruthy();
  });

  it('does not show the unlock hint for a free listing', async () => {
    (getListing as jest.Mock).mockResolvedValue(freeListing);
    (getLibrary as jest.Mock).mockResolvedValue([]);
    (getMyListings as jest.Mock).mockResolvedValue([]);

    await renderScreen();

    expect(screen.getByText(/field-tested teaser for Luna/)).toBeTruthy();
    expect(screen.queryByText('unlockHint')).toBeNull();
  });

  it('acquiring flips owned ONLY on success and navigates to MyLibrary', async () => {
    (getListing as jest.Mock).mockResolvedValue(freeListing);
    (getLibrary as jest.Mock).mockResolvedValue([]);
    (getMyListings as jest.Mock).mockResolvedValue([]);
    (acquire as jest.Mock).mockResolvedValue({
      ok: true,
      listingId: 'listing-luna',
      deliveredEntryId: 'entry-1',
      deliveredAssetId: 'asset-1',
    });

    await renderScreen();

    // Free listing → straight in (no confirm dialog).
    await fireEvent.press(screen.getByText('acquireFreeConfirm'));

    expect(acquire).toHaveBeenCalledWith('listing-luna');
    expect(mockShowToast).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('MyLibrary');
    // Owned state flips — the sticky bar now shows the owned label.
    expect(await screen.findByText('ownLabel')).toBeTruthy();
  });
});