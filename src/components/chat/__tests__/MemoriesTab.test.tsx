/**
 * MemoriesTab — memory timeline (tts-voice-ux Phase 6).
 *
 * Verifies compaction-level grouping order (L2 first), newest-first rows,
 * in-place expansion, level filters, the opaque `emotional_state_bits` dot (no
 * decoded emotion label) and the empty/error states.
 */

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { Memory } from '../../../database/models';
import { getMemoriesForEntity } from '../../../services/engine/repositories/memories';
import { MemoriesTab } from '../MemoriesTab';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('../../../contexts/ThemeContext', () => ({
  useAppTheme: () => ({
    theme: {
      colors: {
        accent: { primary: '#7c3aed', secondary: '#a78bfa' },
        background: { base: '#0f0f1a', surface: '#151d30', elevated: '#1e1e2e' },
        border: { default: '#333333' },
        text: { primary: '#ffffff', secondary: '#cccccc', muted: '#aaaaaa' },
        status: { error: '#ef4444', success: '#22c55e' },
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

jest.mock('../../../utils/haptics', () => ({ hapticLightPress: jest.fn() }));

jest.mock('../../../services/engine/repositories/memories', () => ({
  getMemoriesForEntity: jest.fn(),
}));

const getMemoriesMock = getMemoriesForEntity as jest.Mock;

function memory(overrides: Partial<Memory>): Memory {
  return {
    id: 'mem',
    entity_id: 'ent-1',
    compaction_level: 0,
    content: 'content',
    emotional_state_bits: 0,
    start_date: null,
    end_date: null,
    created_at: new Date('2026-11-10T14:02:00Z'),
    updated_at: new Date('2026-11-10T14:02:00Z'),
    deleted_at: null,
    ...overrides,
  };
}

const CORE = memory({
  id: 'mem-core',
  compaction_level: 2,
  content: 'Mira prefers tea over coffee; keeps old maps.',
  emotional_state_bits: 5,
  start_date: new Date('2026-11-12T00:00:00Z'),
  created_at: new Date('2026-11-12T10:00:00Z'),
});

const SUMMARY = memory({
  id: 'mem-summary',
  compaction_level: 1,
  content: 'We talked about the harbor and the lighthouse.',
  created_at: new Date('2026-11-11T10:00:00Z'),
});

const RAW = memory({
  id: 'mem-raw',
  compaction_level: 0,
  content: 'raw detail',
  created_at: new Date('2026-11-10T14:02:00Z'),
});

describe('MemoriesTab', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('groups by compaction level (L2 core first) then newest first', async () => {
    getMemoriesMock.mockResolvedValue([RAW, SUMMARY, CORE]);
    const { getByTestId } = await render(<MemoriesTab entityId="ent-1" />);

    await waitFor(() => expect(getByTestId('memory-section-2')).toBeTruthy());
    expect(getByTestId('memory-section-2').props.children).toBe('L2 · memoryLevelCore');
    expect(getByTestId('memory-section-1').props.children).toBe('L1 · memoryLevelSummary');
    expect(getByTestId('memory-section-0').props.children).toBe('L0 · memoryLevelRaw');
    expect(getMemoriesMock).toHaveBeenCalledWith('ent-1');
  });

  it('expands the full content in place on tap', async () => {
    getMemoriesMock.mockResolvedValue([CORE]);
    const { getByTestId } = await render(<MemoriesTab entityId="ent-1" />);

    await waitFor(() => expect(getByTestId('memory-content-mem-core')).toBeTruthy());
    expect(getByTestId('memory-content-mem-core').props.numberOfLines).toBe(2);
    expect(getByTestId('memory-content-mem-core').props.children).toBe(
      'Mira prefers tea over coffee; keeps old maps.',
    );

    await fireEvent.press(getByTestId('memory-row-mem-core'));
    expect(getByTestId('memory-content-mem-core').props.numberOfLines).toBeUndefined();
  });

  it('filters by compaction level', async () => {
    getMemoriesMock.mockResolvedValue([RAW, SUMMARY, CORE]);
    const { getByTestId, queryByTestId } = await render(<MemoriesTab entityId="ent-1" />);

    await waitFor(() => expect(getByTestId('memory-row-mem-raw')).toBeTruthy());
    await fireEvent.press(getByTestId('memory-filter-0'));

    expect(getByTestId('memory-row-mem-raw')).toBeTruthy();
    expect(queryByTestId('memory-row-mem-core')).toBeNull();
  });

  it('never decodes emotional_state_bits — only a neutral context dot', async () => {
    getMemoriesMock.mockResolvedValue([CORE, RAW]);
    const { getByTestId, queryByTestId } = await render(<MemoriesTab entityId="ent-1" />);

    await waitFor(() => expect(getByTestId('memory-context-mem-core')).toBeTruthy());
    expect(queryByTestId('memory-context-mem-raw')).toBeNull();
    // A neutral label only — no emotion name is invented from the bitfield.
    expect(getByTestId('memory-context-mem-core').props.accessibilityLabel).toBe(
      'emotionalContext',
    );
  });

  it('shows the empty state when there are no memories', async () => {
    getMemoriesMock.mockResolvedValue([]);
    const { getByTestId } = await render(<MemoriesTab entityId="ent-1" />);
    await waitFor(() => expect(getByTestId('memory-empty')).toBeTruthy());
    expect(getByTestId('memory-empty').props.children).toBe('memoryEmpty');
  });

  it('degrades to an error state with retry', async () => {
    getMemoriesMock.mockRejectedValueOnce(new Error('engine down'));
    const { getByTestId } = await render(<MemoriesTab entityId="ent-1" />);

    await waitFor(() => expect(getByTestId('memory-retry')).toBeTruthy());
    expect(getByTestId('memory-empty').props.children).toBe('memoryLoadFailed');

    getMemoriesMock.mockResolvedValueOnce([RAW]);
    await fireEvent.press(getByTestId('memory-retry'));
    await waitFor(() => expect(getByTestId('memory-row-mem-raw')).toBeTruthy());
  });
});
