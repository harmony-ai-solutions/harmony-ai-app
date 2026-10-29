/**
 * UpdateDownloadModal — presentational dialog for the in-app APK download
 * ("Auto-Update UX phases 1+2").
 *
 * Renders from a fixture state (the component never imports `apkSelfUpdate`),
 * with the themed primitives mocked to plain RN components so the suite asserts
 * copy, progress geometry and callback wiring without a theme tree.
 *
 * i18n resolves through the real `en/updates.json` copy (placeholders
 * interpolated), so string regressions surface here instead of silently passing.
 */

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
        accent: { primary: '#7c3aed', secondary: '#a78bfa', primaryHover: '#8b5cf6' },
        background: { base: '#0f0f1a', surface: '#151d30', elevated: '#1e1e2e', hover: '#222' },
        border: { default: '#333333', focus: '#444', hover: '#555', accent: '#7c3aed' },
        text: { primary: '#ffffff', secondary: '#cccccc', muted: '#aaaaaa', disabled: '#555555' },
        status: {
          success: '#22c55e',
          successBg: '#22c55e22',
          warning: '#f59e0b',
          warningBg: '#f59e0b22',
          error: '#ef4444',
          errorBg: '#ef444422',
          info: '#38bdf8',
          infoBg: '#38bdf822',
        },
        glass: {
          cardOpacity: 0.5,
          borderGradientStart: 'rgba(255,255,255,0.4)',
          borderGradientEnd: 'rgba(124,58,237,0.4)',
        },
        typography: { headerOpacity: 1, subtextOpacity: 0.7, captionOpacity: 0.5 },
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

jest.mock('../../themed/ThemedButton', () => {
  const React = require('react');
  const { TouchableOpacity, Text } = require('react-native');
  return {
    __esModule: true,
    ThemedButton: ({ label, onPress, disabled, style, ...props }: any) =>
      React.createElement(
        TouchableOpacity,
        { onPress, disabled, style, accessibilityRole: 'button', ...props },
        React.createElement(Text, null, label),
      ),
  };
});

jest.mock('react-i18next', () => {
  const copy = require('../../../i18n/locales/en/updates.json');
  const t = (key: string, opts?: Record<string, unknown>) => {
    const path = key.split('.');
    let message: any = copy;
    for (const part of path) {
      message = message?.[part];
    }
    if (typeof message !== 'string') return key;
    if (!opts) return message;
    return Object.entries(opts).reduce(
      (acc, [name, value]) => acc.split(`{{${name}}}`).join(String(value)),
      message,
    );
  };
  return { useTranslation: () => ({ t }) };
});

jest.mock('../../../utils/haptics', () => ({
  hapticLightPress: jest.fn(),
}));

import React from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react-native';
import { UpdateDownloadModal, formatBytes } from '../UpdateDownloadModal';
import type {
  UpdateDownloadModalState,
  UpdateDownloadPhase,
} from '../UpdateDownloadModal';

const BYTES_FETCHED = 24641536; // 23.5 MB
const CONTENT_LENGTH = 52533658; // 50.1 MB
const VERSION = 'v0.4.16';

const makeState = (
  phase: UpdateDownloadPhase,
  overrides: Partial<UpdateDownloadModalState> = {},
): UpdateDownloadModalState => ({
  phase,
  progress: {
    version: VERSION,
    bytesFetched: BYTES_FETCHED,
    contentLength: CONTENT_LENGTH,
    percent: 47,
  },
  error: null,
  ...overrides,
});

/** Flatten a RN style array into one object so widths can be asserted. */
const flatStyle = (style: unknown): Record<string, any> =>
  Array.isArray(style)
    ? style.reduce<Record<string, any>>((acc, part) => ({ ...acc, ...flatStyle(part) }), {})
    : ((style as Record<string, any>) ?? {});

const onCancel = jest.fn();
const onInstall = jest.fn();
const onRetry = jest.fn();
const onOpenSettings = jest.fn();

const renderModal = (state: UpdateDownloadModalState) =>
  render(
    <UpdateDownloadModal
      state={state}
      onCancel={onCancel}
      onInstall={onInstall}
      onRetry={onRetry}
      onOpenSettings={onOpenSettings}
    />,
  );

beforeEach(() => {
  jest.clearAllMocks();
  cleanup();
});

afterEach(cleanup);

describe('UpdateDownloadModal — downloading', () => {
  it('renders a determinate bar with bytes and percent', async () => {
    const screen = await renderModal(makeState('downloading'));

    expect(screen.getByText('Downloading update')).toBeTruthy();
    expect(screen.getByText('23.5 MB / 50.1 MB · 47%')).toBeTruthy();

    const fill = screen.getByTestId('update-download-progress-fill');
    expect(flatStyle(fill.props.style).width).toBe('47%');
    expect(screen.queryByTestId('update-download-indeterminate')).toBeNull();
  });

  it('clamps a non-standard percent into the track', async () => {
    const screen = await renderModal(
      makeState('downloading', {
        progress: {
          version: VERSION,
          bytesFetched: BYTES_FETCHED,
          contentLength: CONTENT_LENGTH,
          percent: 100,
        },
      }),
    );

    expect(
      flatStyle(screen.getByTestId('update-download-progress-fill').props.style).width,
    ).toBe('100%');
  });

  it('renders an indeterminate spinner and no percent when the total is unknown', async () => {
    const screen = await renderModal(
      makeState('downloading', {
        progress: {
          version: VERSION,
          bytesFetched: BYTES_FETCHED,
          contentLength: null,
          percent: null,
        },
      }),
    );

    expect(screen.getByTestId('update-download-indeterminate')).toBeTruthy();
    expect(screen.queryByTestId('update-download-progress-fill')).toBeNull();
    // Bytes only — never a percentage.
    expect(screen.getByText('23.5 MB')).toBeTruthy();
    expect(screen.queryByText(/%/)).toBeNull();
  });

  it('shows the version pill', async () => {
    const screen = await renderModal(makeState('downloading'));

    expect(screen.getByText(VERSION)).toBeTruthy();
  });

  it('cancels via the single outline button', async () => {
    const screen = await renderModal(makeState('downloading'));

    await act(async () => {
      fireEvent.press(screen.getByText('Cancel'));
    });

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onInstall).not.toHaveBeenCalled();
  });
});

describe('UpdateDownloadModal — ready', () => {
  it('shows the complete state, a full bar and installs on press', async () => {
    const screen = await renderModal(
      makeState('ready', {
        progress: {
          version: VERSION,
          bytesFetched: CONTENT_LENGTH,
          contentLength: CONTENT_LENGTH,
          percent: 100,
        },
      }),
    );

    expect(screen.getByText('Update ready to install')).toBeTruthy();
    expect(screen.getByText('Install')).toBeTruthy();
    expect(screen.getByText('50.1 MB · complete')).toBeTruthy();
    expect(
      flatStyle(screen.getByTestId('update-download-progress-fill').props.style).width,
    ).toBe('100%');

    await act(async () => {
      fireEvent.press(screen.getByText('Install'));
    });

    expect(onInstall).toHaveBeenCalledTimes(1);
  });

  it('disables the install button and shows a spinner while installing', async () => {
    const screen = await renderModal(
      makeState('installing', {
        progress: {
          version: VERSION,
          bytesFetched: CONTENT_LENGTH,
          contentLength: CONTENT_LENGTH,
          percent: 100,
        },
      }),
    );

    expect(screen.getByText('Installing…')).toBeTruthy();
    // TouchableOpacity folds `disabled` into accessibilityState on the host view.
    expect(
      screen.getByTestId('update-download-install').props.accessibilityState,
    ).toEqual(expect.objectContaining({ disabled: true }));
    expect(screen.getByTestId('update-download-installing-spinner')).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByText('Installing…'));
    });

    expect(onInstall).not.toHaveBeenCalled();
  });
});

describe('UpdateDownloadModal — failed', () => {
  it('shows the generic failure with retry and cancel', async () => {
    const screen = await renderModal(
      makeState('failed', { error: 'download failed (HTTP 500)' }),
    );

    expect(screen.getByText('Update failed')).toBeTruthy();
    expect(
      screen.getByText('Could not install the update: download failed (HTTP 500)'),
    ).toBeTruthy();
    expect(screen.queryByText('Open settings')).toBeNull();

    await act(async () => {
      fireEvent.press(screen.getByText('Retry'));
    });
    expect(onRetry).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.press(screen.getByText('Cancel'));
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('shows the permission copy with settings, retry and cancel', async () => {
    const screen = await renderModal(
      makeState('failed', { error: 'install_permission_required' }),
    );

    expect(
      screen.getByText('Allow installing apps from this source, then try again.'),
    ).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByText('Open settings'));
    });
    expect(onOpenSettings).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.press(screen.getByText('Retry'));
    });
    expect(onRetry).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.press(screen.getByText('Cancel'));
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('honours an injected permission sentinel', async () => {
    const screen = await render(
      <UpdateDownloadModal
        state={makeState('failed', { error: 'custom_sentinel' })}
        onCancel={onCancel}
        onInstall={onInstall}
        onRetry={onRetry}
        onOpenSettings={onOpenSettings}
        permissionErrorCode="custom_sentinel"
      />,
    );

    expect(screen.getByText('Open settings')).toBeTruthy();
  });
});

describe('UpdateDownloadModal — idle', () => {
  it('renders nothing while the service is idle', async () => {
    const { toJSON } = await renderModal({ phase: 'idle', progress: null, error: null });

    expect(toJSON()).toBeNull();
  });
});

describe('formatBytes', () => {
  it('formats bytes below 1 KB without a unit conversion', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1023)).toBe('1023 B');
  });

  it('formats the KB tier with one decimal', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
  });

  it('formats the MB tier with one decimal', () => {
    expect(formatBytes(1048576)).toBe('1.0 MB');
    expect(formatBytes(24641536)).toBe('23.5 MB');
    expect(formatBytes(CONTENT_LENGTH)).toBe('50.1 MB');
  });

  it('formats the GB tier with one decimal', () => {
    expect(formatBytes(1073741824)).toBe('1.0 GB');
    expect(formatBytes(5 * 1073741824)).toBe('5.0 GB');
  });

  it('degrades non-finite and negative input to 0 B', () => {
    expect(formatBytes(-1)).toBe('0 B');
    expect(formatBytes(Number.NaN)).toBe('0 B');
  });
});
