/**
 * ChatBubble — inline image tile geometry (owner report, 2026-10-27).
 *
 * The image used to render `width: '100%'` inside a CONTENT-SIZED bubble: a
 * percentage against an indefinite parent collapses to a narrow sliver (the
 * same bug class the audio row fixed). The tile now claims an explicit pixel
 * width and derives its height from the photo's REAL aspect ratio, clamped so
 * portraits stay proper tall-ish tiles instead of cover-cropped squares.
 */

import React from 'react';
import { Image, StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import { ChatBubble } from '../ChatBubble';
import { ConversationMessage } from '../../../database/models';

jest.mock('../../../utils/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('../../../contexts/ThemeContext', () => ({
  useAppTheme: () => ({ theme: {} }),
}));

jest.mock('react-native-linear-gradient', () => {
  const React = require('react');
  const { View } = require('react-native');
  return ({ children, ...props }: any) => React.createElement(View, props, children);
});

jest.mock('react-native-paper', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    Provider: ({ children }: any) => children,
    DefaultTheme: {},
    Avatar: { Image: (props: any) => React.createElement(View, props) },
    IconButton: ({ icon, ...props }: any) =>
      React.createElement(View, { ...props, testID: `icon-${icon}` }),
    Menu: Object.assign(
      (props: any) => React.createElement(React.Fragment, null, props.children),
      { Item: (props: any) => React.createElement(View, props) },
    ),
  };
});

jest.mock('../../../services/AudioPlayer', () => ({
  __esModule: true,
  default: {
    isMessageLoaded: jest.fn(() => false),
    getCurrentMessageId: jest.fn(() => null),
    loadAudioForMessage: jest.fn().mockResolvedValue(undefined),
    getDuration: jest.fn().mockResolvedValue(0),
    getProgress: jest.fn().mockResolvedValue({ position: 0 }),
    getState: jest.fn().mockResolvedValue('none'),
    pause: jest.fn().mockResolvedValue(undefined),
    resume: jest.fn().mockResolvedValue(undefined),
    seekTo: jest.fn().mockResolvedValue(undefined),
  },
  AudioPlayer: class {},
}));

jest.mock('../../../services/engine/repositories/conversation_messages', () => ({
  getConversationMessageAudioBase64: jest.fn().mockResolvedValue(''),
  getConversationMessageImageBase64: jest.fn().mockResolvedValue(''),
}));

jest.mock('../../../services/EmojiService', () => ({
  __esModule: true,
  default: { parseShortcodes: (s: string) => s },
}));

jest.mock('../../emoji/EmojiAwareText', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { EmojiAwareText: ({ children }: any) => React.createElement(Text, null, children) };
});

jest.mock('../../themed/ThemedText', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    ThemedText: ({ children, style, ...props }: any) =>
      React.createElement(Text, { style, ...props }, children),
  };
});

const theme = {
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

const imageMessage: ConversationMessage = {
  id: 'img-1',
  entity_id: 'char-entity',
  sender_entity_id: 'char-entity',
  interaction_id: 'interaction-1',
  content: '',
  message_type: 'image',
  audio_data: null,
  audio_mime_type: null,
  audio_duration: null,
  image_data: 'QUJDRA==',
  image_mime_type: 'image/jpeg',
  emotional_state_bits: 0,
  is_recon_followup: false,
  is_edited: false,
  created_at: new Date('2026-10-27T12:00:00Z'),
  updated_at: new Date('2026-10-27T12:00:00Z'),
  deleted_at: null,
};

const originalGetSize = (Image as any).getSize;

/** The inline image `style` flattened — width/height come from the component. */
function imageStyle(utils: any) {
  const container = utils.getByTestId('chat-image-img-1');
  // RNTL 14 exposes HOST nodes only; the Image host is the container's child.
  const image = (container.children as any[]).find(child => typeof child !== 'string');
  return StyleSheet.flatten(image.props.style) as { width: number | string; height: number | string };
}

afterEach(() => {
  (Image as any).getSize = originalGetSize;
});

describe('ChatBubble — inline image tile', () => {
  it('uses an explicit pixel width (never 100%) so a content-sized bubble cannot collapse it', async () => {
    (Image as any).getSize = jest.fn((_uri: string, success: (w: number, h: number) => void) =>
      success(1600, 900),
    );

    const utils = await render(<ChatBubble message={imageMessage} isOwn={false} theme={theme} />);

    const style = imageStyle(utils);
    expect(typeof style.width).toBe('number');
    expect(style.width).not.toBe('100%');
    expect(style.width as number).toBeGreaterThan(200);
  });

  it('derives the height from the REAL aspect ratio (landscape photo)', async () => {
    (Image as any).getSize = jest.fn((_uri: string, success: (w: number, h: number) => void) =>
      success(1600, 900),
    );

    const utils = await render(<ChatBubble message={imageMessage} isOwn={false} theme={theme} />);

    const style = imageStyle(utils);
    const width = style.width as number;
    // 16:9 → height = width * 9/16, inside the 120–360 clamp.
    expect(style.height).toBe(Math.round(Math.min(360, Math.max(120, (width * 9) / 16))));
  });

  it('renders a portrait photo as a tall tile (no cover-cropped square)', async () => {
    (Image as any).getSize = jest.fn((_uri: string, success: (w: number, h: number) => void) =>
      success(1200, 1600),
    );

    const utils = await render(<ChatBubble message={imageMessage} isOwn={false} theme={theme} />);

    const style = imageStyle(utils);
    const width = style.width as number;
    // 3:4 portrait → height = width / 0.75, clamped at 360.
    expect(style.height).toBe(Math.round(Math.min(360, Math.max(120, width / 0.75))));
  });

  it('falls back to a 4:3 tile when Image.getSize fails', async () => {
    (Image as any).getSize = jest.fn(
      (_uri: string, _success: unknown, failure: (e: unknown) => void) =>
        failure(new Error('no intrinsic size')),
    );

    const utils = await render(<ChatBubble message={imageMessage} isOwn={false} theme={theme} />);

    const style = imageStyle(utils);
    const width = style.width as number;
    expect(style.height).toBe(Math.round(Math.min(360, Math.max(120, (width * 3) / 4))));
  });

  it('keeps the chat-image testID and the rounded overflow-hidden container', async () => {
    (Image as any).getSize = jest.fn((_uri: string, success: (w: number, h: number) => void) =>
      success(1600, 900),
    );

    const utils = await render(<ChatBubble message={imageMessage} isOwn={false} theme={theme} />);

    const container = utils.getByTestId('chat-image-img-1');
    const flat = StyleSheet.flatten(container.props.style) as any;
    expect(flat.borderRadius).toBe(12);
    expect(flat.overflow).toBe('hidden');
  });
});
