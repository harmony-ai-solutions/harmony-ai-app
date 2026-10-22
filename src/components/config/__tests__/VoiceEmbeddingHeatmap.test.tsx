/**
 * VoiceEmbeddingHeatmap — base64 float32 decoding + 2D grid layout (3-5).
 */

import React from 'react';
import { cleanup, render } from '@testing-library/react-native';
import { Buffer } from 'buffer';
import {
  VoiceEmbeddingHeatmap,
  computeHeatmapGrid,
  decodeEmbeddingFloats,
  heatmapColorFor,
} from '../VoiceEmbeddingHeatmap';

afterEach(cleanup);

jest.mock('../../../contexts/ThemeContext', () => ({
  useAppTheme: () => ({
    theme: {
      colors: {
        accent: { primary: '#7c3aed', secondary: '#a78bfa' },
        background: { base: '#0f0f1a', surface: '#151d30', elevated: '#1e1e2e' },
        border: { default: '#333333' },
        text: { primary: '#ffffff', secondary: '#cccccc', muted: '#aaaaaa', disabled: '#555555' },
        status: { success: '#22c55e', warning: '#f59e0b', error: '#ef4444' },
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

function floatsToBase64(values: number[]): string {
  const buffer = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => buffer.writeFloatLE(value, index * 4));
  return buffer.toString('base64');
}

describe('decodeEmbeddingFloats', () => {
  it('decodes little-endian float32 values from base64', () => {
    const b64 = floatsToBase64([0.5, -1.25, 3]);
    expect(decodeEmbeddingFloats(b64)).toEqual([0.5, -1.25, 3]);
  });

  it('returns [] for empty input and ignores trailing partial floats', () => {
    expect(decodeEmbeddingFloats('')).toEqual([]);
    expect(decodeEmbeddingFloats(Buffer.from([1, 2, 3]).toString('base64'))).toEqual([]);
  });
});

describe('computeHeatmapGrid', () => {
  it('lays a square vector out with the requested max side', () => {
    const floats = Array.from({ length: 16 }, (_, i) => i);
    const grid = computeHeatmapGrid(floats, 4);

    expect(grid.rows).toBe(4);
    expect(grid.cols).toBe(4);
    expect(grid.cells).toHaveLength(16);
    expect(grid.cells).toEqual(floats);
    expect(grid.min).toBe(0);
    expect(grid.max).toBe(15);
  });

  it('pads the final row when the vector does not divide evenly', () => {
    const floats = Array.from({ length: 8 }, (_, i) => i / 10);
    const grid = computeHeatmapGrid(floats, 4);

    expect(grid.cols).toBe(3);
    expect(grid.rows).toBe(3);
    expect(grid.cells).toHaveLength(9);
    // Padding is zero but never skews the min/max normalization.
    expect(grid.min).toBeCloseTo(0);
    expect(grid.max).toBeCloseTo(0.7);
  });

  it('returns an empty grid for an empty vector', () => {
    expect(computeHeatmapGrid([], 4)).toEqual({
      rows: 0,
      cols: 0,
      cells: [],
      min: 0,
      max: 0,
    });
  });

  it('defaults to an 8-wide maximum side', () => {
    const floats = Array.from({ length: 64 }, (_, i) => i);
    const grid = computeHeatmapGrid(floats);

    expect(grid.cols).toBe(8);
    expect(grid.rows).toBe(8);
    expect(grid.cells).toHaveLength(64);
  });
});

describe('heatmapColorFor', () => {
  it('maps the normalized range across the purple → magenta palette', () => {
    expect(heatmapColorFor(0)).toBe('rgb(30, 27, 75)'); // #1E1B4B
    expect(heatmapColorFor(0.5)).toBe('rgb(158, 48, 224)'); // #7C3AED → #C026D3
    expect(heatmapColorFor(1)).toBe('rgb(240, 171, 252)'); // #F0ABFC
  });
});

describe('VoiceEmbeddingHeatmap', () => {
  it('renders the vector dimension badge and the 2D grid', async () => {
    const b64 = floatsToBase64([0, 1, 2, 3, 4, 5, 6, 7]);
    const utils = await render(
      <VoiceEmbeddingHeatmap embeddingBase64={b64} title="Reference voice" />,
    );

    expect(utils.getByText('Reference voice')).toBeTruthy();
    expect(utils.getByTestId('voice-embedding-heatmap')).toBeTruthy();
    expect(utils.getByText('8 dims')).toBeTruthy();
    expect(utils.getByTestId('embedding-cell-0')).toBeTruthy();
    // 8 values → 3 cols × 3 rows (last row padded) = 9 cells.
    expect(utils.getByTestId('embedding-cell-8')).toBeTruthy();
  });

  it('renders the empty state without a grid', async () => {
    const utils = await render(<VoiceEmbeddingHeatmap embeddingBase64="" />);
    expect(utils.getByTestId('voice-embedding-empty')).toBeTruthy();
    expect(utils.queryByTestId('voice-embedding-heatmap')).toBeNull();
  });

  it('compact mode renders only the grid (no title or dims badge)', async () => {
    const b64 = floatsToBase64(Array.from({ length: 48 }, (_, i) => i));
    const utils = await render(
      <VoiceEmbeddingHeatmap embeddingBase64={b64} title="Hidden title" compact />,
    );

    expect(utils.getByTestId('voice-embedding-heatmap')).toBeTruthy();
    expect(utils.queryByText('Hidden title')).toBeNull();
    expect(utils.queryByTestId('voice-embedding-dims')).toBeNull();
    expect(utils.getByTestId('embedding-cell-0')).toBeTruthy();
  });
});
