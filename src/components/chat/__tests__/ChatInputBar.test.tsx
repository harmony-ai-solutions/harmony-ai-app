/**
 * ChatInputBar — ONE send button for text and images (owner report, 2026-10-27).
 *
 * The composer used to show a second gradient ➤N button in the image preview
 * row that sent images and discarded the text, while the main ➤ sent text and
 * discarded the images. The preview-row button is gone: the MAIN button sends
 * images + caption together, keeps the image-count badge, and clears text +
 * previews only after the parent accepts the send.
 */

import React from 'react';
import { act, fireEvent, render, within } from '@testing-library/react-native';
import { ChatInputBar, PickedImage } from '../ChatInputBar';
import { launchImageLibrary } from 'react-native-image-picker';

jest.mock('../../../utils/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const THEME = {
  colors: {
    accent: {
      primary: '#7c3aed',
      secondary: '#a78bfa',
      primaryHover: '#6d28d9',
      secondaryHover: '#8b5cf6',
    },
    background: { base: '#0f0f1a', surface: '#151d30', elevated: '#1e1e2e', hover: '#1a1a2e' },
    border: { default: '#333333', focus: '#7c3aed', hover: '#444', accent: '#7c3aed' },
    text: { primary: '#ffffff', secondary: '#cccccc', muted: '#aaaaaa', disabled: '#555555' },
    status: { error: '#ef4444', success: '#22c55e', warning: '#f59e0b', info: '#3b82f6' },
    gradients: { primary: '', secondary: '', surface: '' },
    glass: {
      cardOpacity: 0.5,
      glowOpacity: 0.08,
      glowRadius: 14,
      borderGradientStart: 'rgba(255,255,255,0.4)',
      borderGradientEnd: 'rgba(167,139,250,0.4)',
    },
    typography: { headerOpacity: 1, subtextOpacity: 0.7, captionOpacity: 0.5 },
  },
} as any;

jest.mock('../../../contexts/ThemeContext', () => ({
  useAppTheme: () => ({ theme: THEME }),
}));

jest.mock('../../../contexts/AppToastContext', () => ({
  useToast: () => ({ showToast: jest.fn() }),
}));

jest.mock('../../../contexts/AppAlertContext', () => ({
  useAppAlert: () => ({ showAlert: jest.fn() }),
}));

jest.mock('../../../contexts/BiometricLockContext', () => ({
  useBiometricLock: () => ({ withExternalFlow: (fn: () => Promise<unknown>) => fn() }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ bottom: 0 }),
}));

jest.mock('react-native-linear-gradient', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: ({ children, ...props }: any) => React.createElement(View, props, children),
  };
});

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: ({ name, ...props }: any) =>
      React.createElement(View, { ...props, testID: `icon-${name}` }),
  };
});

jest.mock('../../emoji/EmojiPickerInline', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, default: () => React.createElement(View) };
});

jest.mock('../EmptyChatCTA', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, EmptyChatCTA: () => React.createElement(View) };
});

jest.mock('react-native-image-picker', () => ({
  launchImageLibrary: jest.fn(),
}));

const mockLaunchImageLibrary = launchImageLibrary as jest.Mock;

interface BarProps {
  onSendText?: jest.Mock;
  onSendImages?: jest.Mock;
  onPreviewImage?: jest.Mock;
}

async function renderBar(overrides: BarProps = {}) {
  const onSendText = overrides.onSendText ?? jest.fn();
  const onSendImages = overrides.onSendImages ?? jest.fn().mockResolvedValue(undefined);
  const onPreviewImage = overrides.onPreviewImage ?? jest.fn();
  const utils = await render(
    <ChatInputBar
      onSendText={onSendText}
      onSendAudio={jest.fn()}
      onSendImages={onSendImages}
      onPreviewImage={onPreviewImage}
    />,
  );
  return { utils, onSendText, onSendImages, onPreviewImage };
}

/** Drive the photo picker to attach ONE in-memory image. */
async function pickOneImage(utils: any) {
  mockLaunchImageLibrary.mockResolvedValueOnce({
    assets: [{ base64: 'AAAA', type: 'image/jpeg' }],
  });
  await act(async () => {
    await fireEvent.press(utils.getByTestId('chat-input-photo-btn'));
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('ChatInputBar — single main send button', () => {
  it('sends images + caption with ONE press, then clears text and previews', async () => {
    const { utils, onSendText, onSendImages } = await renderBar();
    await pickOneImage(utils);

    await fireEvent.changeText(utils.getByTestId('chat-input-text'), '  My caption  ');
    await act(async () => {
      await fireEvent.press(utils.getByTestId('chat-input-send-btn'));
    });

    expect(onSendImages).toHaveBeenCalledTimes(1);
    expect(onSendImages).toHaveBeenCalledWith(
      [{ base64: 'AAAA', mimeType: 'image/jpeg' }],
      'My caption',
    );
    expect(onSendText).not.toHaveBeenCalled();

    // Both cleared only after the parent accepted the send.
    expect(utils.getByTestId('chat-input-text').props.value).toBe('');
    expect(utils.queryByTestId('chat-input-image-preview-0')).toBeNull();
  });

  it('allows images with an empty caption', async () => {
    const { utils, onSendImages } = await renderBar();
    await pickOneImage(utils);

    await act(async () => {
      await fireEvent.press(utils.getByTestId('chat-input-send-btn'));
    });

    const [images, caption] = onSendImages.mock.calls[0];
    expect(images).toEqual([{ base64: 'AAAA', mimeType: 'image/jpeg' }] as PickedImage[]);
    expect(caption).toBeUndefined();
  });

  it('keeps previews AND text when the parent rejects the send (retry)', async () => {
    const onSendImages = jest.fn().mockRejectedValue(new Error('Session not active'));
    const { utils } = await renderBar({ onSendImages });
    await pickOneImage(utils);
    await fireEvent.changeText(utils.getByTestId('chat-input-text'), 'retry me');

    await act(async () => {
      await fireEvent.press(utils.getByTestId('chat-input-send-btn'));
    });

    expect(onSendImages).toHaveBeenCalledTimes(1);
    expect(utils.getByTestId('chat-input-text').props.value).toBe('retry me');
    expect(utils.queryByTestId('chat-input-image-preview-0')).not.toBeNull();
  });

  it('keeps text-only sends unchanged', async () => {
    const { utils, onSendText, onSendImages } = await renderBar();
    await fireEvent.changeText(utils.getByTestId('chat-input-text'), 'hello');

    await act(async () => {
      await fireEvent.press(utils.getByTestId('chat-input-send-btn'));
    });

    expect(onSendText).toHaveBeenCalledWith('hello');
    expect(onSendImages).not.toHaveBeenCalled();
    expect(utils.getByTestId('chat-input-text').props.value).toBe('');
  });

  it('shows no send button (mic instead) with an empty composer', async () => {
    const { utils } = await renderBar();
    expect(utils.queryByTestId('chat-input-send-btn')).toBeNull();
    expect(utils.queryByTestId('chat-input-mic-btn')).not.toBeNull();
  });

  it('renders the image-count badge on the main button only when images are selected', async () => {
    const { utils } = await renderBar();
    await fireEvent.changeText(utils.getByTestId('chat-input-text'), 'text only');
    expect(utils.queryByTestId('chat-input-send-count-badge')).toBeNull();

    await pickOneImage(utils);

    const badge = utils.getByTestId('chat-input-send-count-badge');
    expect(within(badge).getByText('1')).toBeTruthy();
  });

  it('opens the viewer when a selected thumbnail is tapped (✕ still removes)', async () => {
    const { utils, onPreviewImage } = await renderBar();
    await pickOneImage(utils);

    await fireEvent.press(utils.getByTestId('chat-input-image-preview-0'));
    expect(onPreviewImage).toHaveBeenCalledWith({ base64: 'AAAA', mimeType: 'image/jpeg' });

    await fireEvent.press(utils.getByTestId('chat-input-image-remove-0'));
    expect(utils.queryByTestId('chat-input-image-preview-0')).toBeNull();
    expect(onPreviewImage).toHaveBeenCalledTimes(1);
  });
});
