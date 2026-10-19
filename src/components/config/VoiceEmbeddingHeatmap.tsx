/**
 * VoiceEmbeddingHeatmap — React Native port of the desktop `Heatmap.jsx`
 * (Phase 3-5).
 *
 * The engine's `POST /api/module-configs/tts/embed-speaker` returns a
 * base64-encoded speaker embedding vector (float32 little-endian). Rendering the
 * raw dimensions as a compact 2D grid gives users an at-a-glance fingerprint of
 * the reference voice and confirms that the embedding is non-degenerate:
 *
 *   - a diverging palette (cool blue → near-black → hot pink/magenta) maps the
 *     normalized `[min, max]` value of each dimension;
 *   - a `N dims` badge reports the decoded vector length.
 *
 * Both helpers are pure and exported for unit testing.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Buffer } from 'buffer';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedText } from '../themed/ThemedText';

export interface VoiceEmbeddingHeatmapProps {
  /** Base64-encoded float32-little-endian speaker embedding. */
  embeddingBase64: string;
  /** Optional heading (defaults to "Speaker Embedding"). */
  title?: string;
  /** Render only the compact grid (for the horizontal `heatmap-row`). */
  compact?: boolean;
}

/** Six-stop purple → magenta palette from the File 3 design. */
const HEATMAP_PALETTE = [
  '#1E1B4B',
  '#4C1D95',
  '#7C3AED',
  '#C026D3',
  '#E879F9',
  '#F0ABFC',
];

/**
 * Decode a base64 float32-little-endian buffer into a number array.
 *
 * Non-multiple-of-four trailing bytes (malformed/truncated payloads) are
 * ignored rather than producing NaN cells. Empty input yields `[]`.
 */
export function decodeEmbeddingFloats(b64: string): number[] {
  if (!b64) return [];
  let buffer: Buffer;
  try {
    buffer = Buffer.from(b64, 'base64');
  } catch {
    return [];
  }
  const count = Math.floor(buffer.length / 4);
  const floats: number[] = new Array(count);
  for (let i = 0; i < count; i += 1) {
    floats[i] = buffer.readFloatLE(i * 4);
  }
  return floats;
}

/**
 * Lay the embedding out as a compact 2D grid.
 *
 * `cols = min(maxSide, ceil(sqrt(n)))`, `rows = ceil(n / cols)`; the final row
 * is zero-padded so `cells.length === rows * cols`. `min`/`max` are computed
 * from the decoded values only (padding never skews normalization). For an
 * empty vector the grid is `{ rows: 0, cols: 0, cells: [], min: 0, max: 0 }`.
 */
export function computeHeatmapGrid(
  floats: number[],
  maxSide = 8,
): { rows: number; cols: number; cells: number[]; min: number; max: number } {
  const safeMaxSide = Math.max(1, Math.floor(maxSide) || 8);
  const values = floats ?? [];
  if (values.length === 0) {
    return { rows: 0, cols: 0, cells: [], min: 0, max: 0 };
  }

  const cols = Math.min(safeMaxSide, Math.ceil(Math.sqrt(values.length)));
  const rows = Math.ceil(values.length / cols);
  const cells: number[] = new Array(rows * cols).fill(0);
  for (let i = 0; i < values.length; i += 1) cells[i] = values[i];

  let min = values[0];
  let max = values[0];
  for (let i = 1; i < values.length; i += 1) {
    if (values[i] < min) min = values[i];
    if (values[i] > max) max = values[i];
  }
  return { rows, cols, cells, min, max };
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const value = parseInt(clean, 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

function lerpHex(from: string, to: string, t: number): string {
  const ratio = Math.min(1, Math.max(0, t));
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  const channels = a.map((channel, i) =>
    Math.round(channel + (b[i] - channel) * ratio),
  );
  return `rgb(${channels[0]}, ${channels[1]}, ${channels[2]})`;
}

/**
 * Map a normalized `[0, 1]` value across the six-stop purple → magenta palette
 * (`#1E1B4B` → `#4C1D95` → `#7C3AED` → `#C026D3` → `#E879F9` → `#F0ABFC`).
 */
export function heatmapColorFor(normalized: number): string {
  const t = Number.isFinite(normalized) ? Math.min(1, Math.max(0, normalized)) : 0.5;
  const scaled = t * (HEATMAP_PALETTE.length - 1);
  const index = Math.min(HEATMAP_PALETTE.length - 2, Math.floor(scaled));
  return lerpHex(HEATMAP_PALETTE[index], HEATMAP_PALETTE[index + 1], scaled - index);
}

export const VoiceEmbeddingHeatmap: React.FC<VoiceEmbeddingHeatmapProps> = ({
  embeddingBase64,
  title,
  compact = false,
}) => {
  const { theme } = useAppTheme();

  if (!theme) return null;

  const floats = decodeEmbeddingFloats(embeddingBase64);
  if (floats.length === 0) {
    return (
      <View style={styles.wrapper}>
        <ThemedText size={13} variant="muted" testID="voice-embedding-empty">
          No speaker embedding yet — generate one from a reference sample.
        </ThemedText>
      </View>
    );
  }

  const grid = computeHeatmapGrid(floats);
  const range = grid.max - grid.min;

  const rows: number[][] = [];
  for (let r = 0; r < grid.rows; r += 1) {
    rows.push(grid.cells.slice(r * grid.cols, (r + 1) * grid.cols));
  }

  const gridBox = (
    <View
      style={[styles.grid, compact ? styles.gridCompact : null]}
      testID="voice-embedding-heatmap"
    >
      {rows.map((row, rowIndex) => (
        <View key={rowIndex} style={styles.gridRow}>
          {row.map((value, colIndex) => {
            const normalized = range === 0 ? 0.5 : (value - grid.min) / range;
            return (
              <View
                key={colIndex}
                testID={`embedding-cell-${rowIndex * grid.cols + colIndex}`}
                style={[
                  styles.cell,
                  { backgroundColor: heatmapColorFor(normalized) },
                ]}
              />
            );
          })}
        </View>
      ))}
    </View>
  );

  if (compact) {
    return gridBox;
  }

  return (
    <View style={styles.wrapper}>
      <View style={styles.header}>
        <ThemedText size={13} weight="medium">
          {title ?? 'Speaker Embedding'}
        </ThemedText>
        <View testID="voice-embedding-dims" style={styles.dimsBadge}>
          <ThemedText size={10} style={styles.dimsText}>
            {`${floats.length} dims`}
          </ThemedText>
        </View>
      </View>

      {gridBox}

      <ThemedText size={10} style={styles.rangeText}>
        {`${grid.min.toFixed(2)} … ${grid.max.toFixed(2)}`}
      </ThemedText>
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: { gap: 6 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dimsBadge: {
    backgroundColor: 'rgba(232, 121, 249, 0.15)',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
  },
  dimsText: {
    color: '#E879F9',
    fontWeight: '600',
  },
  grid: {
    alignSelf: 'flex-start',
    gap: 1.5,
  },
  gridCompact: {
    flexShrink: 0,
  },
  gridRow: {
    flexDirection: 'row',
    gap: 1.5,
  },
  cell: {
    width: 6,
    height: 6,
    borderRadius: 1,
  },
  rangeText: {
    color: '#64748B',
  },
});
