/**
 * EngineLogScreen — 7-11 tests.
 *
 * Covers the exported pure view logic (stream-event folding with dedup counts,
 * backfill merge/cap, filter → REST query / WS filter, filter description) and a
 * render smoke of the screen over mocked engine services.
 */

import React from 'react';
import { cleanup, render, waitFor } from '@testing-library/react-native';

afterEach(cleanup);
beforeEach(() => {
  cleanup();
  jest.clearAllMocks();
});

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('../../utils/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return ({ name, ...props }: any) => React.createElement(Text, { ...props }, name);
});

jest.mock('../../contexts/ThemeContext', () => ({
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

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
}));

jest.mock('../../components/themed/ThemedView', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, ThemedView: ({ children, style, ...props }: any) => React.createElement(View, { style, ...props }, children) };
});
jest.mock('../../components/themed/ThemedText', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { __esModule: true, ThemedText: ({ children, style, ...props }: any) => React.createElement(Text, { style, ...props }, children) };
});
jest.mock('../../components/themed/ThemedCard', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, ThemedCard: ({ children, style, ...props }: any) => React.createElement(View, { style, ...props }, children) };
});
jest.mock('../../components/themed/ScreenHeader', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, ScreenHeader: ({ right, children, ...props }: any) => React.createElement(View, props, right, children) };
});

jest.mock('../../services/engine/EngineApiClient', () => ({
  engineApiClient: {
    engineLogComponents: jest.fn(() => Promise.resolve({ components: ['chat'] })),
    engineLogEntities: jest.fn(() => Promise.resolve({ entities: ['ent-1'] })),
    engineLogPromptTypes: jest.fn(() => Promise.resolve({ promptTypes: ['system'] })),
    engineLogs: jest.fn(() => Promise.resolve({ entries: [], count: 0, offset: 0, limit: 200 })),
    engineLogLevels: jest.fn(() =>
      Promise.resolve({ defaultLevel: 'debug', componentLevels: {}, promptVerbosity: 'summary' }),
    ),
    setEngineLogLevels: jest.fn(() => Promise.resolve({ status: 'ok' })),
  },
}));

jest.mock('../../services/engine/EngineLogStream', () => ({
  EngineLogStream: jest.fn().mockImplementation(() => ({
    setFilter: jest.fn(),
    setPaused: jest.fn(),
    setEventHandler: jest.fn(),
    setStatusHandler: jest.fn(),
    start: jest.fn(),
    stop: jest.fn(),
  })),
}));

jest.mock('../../services/diagnostics/shareDiagnostics', () => ({
  shareDiagnosticsReport: jest.fn(() => Promise.resolve('/mock/caches/report.txt')),
}));

import {
  EngineLogScreen,
  applyStreamEvent,
  mergeBackfill,
  buildEngineLogQuery,
  buildStreamFilter,
  describeFilter,
  formatLogClock,
  levelRank,
  logIdentity,
  LOG_ROW_CAP,
  type LogRow,
  EMPTY_LOG_FILTER,
} from '../settings/EngineLogScreen';
import type { EngineLogEntryDto } from '../../services/engine/EngineApiClient';

function entry(over: Partial<EngineLogEntryDto> = {}): EngineLogEntryDto {
  return {
    id: 1,
    timestamp: '2026-10-13T11:59:00Z',
    level: 'info',
    component: 'chat',
    entityId: 'ent-1',
    message: 'hello',
    isPrompt: false,
    ...over,
  };
}

describe('engine log view logic', () => {
  it('ranks levels by severity (panic most severe → trace least)', () => {
    expect(levelRank('panic')).toBe(0);
    expect(levelRank('warn')).toBe(3);
    expect(levelRank('trace')).toBe(6);
    expect(levelRank('nonsense')).toBe(5);
  });

  it('formats the clock from an RFC3339 timestamp', () => {
    expect(formatLogClock('2026-10-13T11:59:03.123Z')).toBe('11:59:03.123');
    expect(formatLogClock('2026-10-13T11:59:03Z')).toBe('11:59:03');
    expect(formatLogClock('garbage')).toBe('garbage');
  });

  it('collapses consecutive identical entries into a dedup count', () => {
    let rows: LogRow[] = [];
    rows = applyStreamEvent(rows, { type: 'entry', entry: entry({ id: 1 }) });
    rows = applyStreamEvent(rows, { type: 'entry', entry: entry({ id: 2 }) });
    rows = applyStreamEvent(rows, { type: 'entry', entry: entry({ id: 3, message: 'different' }) });

    expect(rows).toHaveLength(2);
    // newest first: the different message is at the head
    expect(rows[0].entry.message).toBe('different');
    expect(rows[1].count).toBe(2);
    expect(rows[1].ids).toEqual([1, 2]);
  });

  it('ignores the latency data key when collapsing', () => {
    let rows: LogRow[] = [];
    rows = applyStreamEvent(rows, { type: 'entry', entry: entry({ id: 1, data: { latency: '5ms' } }) });
    rows = applyStreamEvent(rows, { type: 'entry', entry: entry({ id: 2, data: { latency: '99ms' } }) });
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(2);
    expect(logIdentity(entry({ data: { latency: '1ms' } }))).toBe(
      logIdentity(entry({ data: { latency: '2ms' } })),
    );
  });

  it('drops a removed id from its row (and the row when empty)', () => {
    let rows: LogRow[] = [];
    rows = applyStreamEvent(rows, { type: 'entry', entry: entry({ id: 1 }) });
    rows = applyStreamEvent(rows, { type: 'entry', entry: entry({ id: 2 }) });
    rows = applyStreamEvent(rows, { type: 'remove', removeId: 2 });
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(1);
    expect(rows[0].ids).toEqual([1]);
    rows = applyStreamEvent(rows, { type: 'remove', removeId: 1 });
    expect(rows).toHaveLength(0);
  });

  it('caps the row list', () => {
    let rows: LogRow[] = [];
    for (let i = 0; i < LOG_ROW_CAP + 25; i += 1) {
      rows = applyStreamEvent(rows, { type: 'entry', entry: entry({ id: i, message: `m${i}` }) });
    }
    expect(rows).toHaveLength(LOG_ROW_CAP);
  });

  it('merges backfill entries newest-first and dedupes by id', () => {
    const rows: LogRow[] = [{ entry: entry({ id: 5 }), count: 1, ids: [5] }];
    const merged = mergeBackfill(rows, [entry({ id: 7 }), entry({ id: 6 }), entry({ id: 5 })]);
    expect(merged.map(r => r.entry.id)).toEqual([7, 6, 5]);
  });

  it('builds the REST query from the filter state', () => {
    expect(
      buildEngineLogQuery({
        minLevel: 'warn',
        component: 'chat',
        entityId: 'ent-1',
        search: '  boom ',
        promptOnly: true,
        promptType: 'system',
      }),
    ).toEqual({
      minLevel: 'warn',
      component: 'chat',
      entityId: 'ent-1',
      search: 'boom',
      isPrompt: true,
      promptType: 'system',
      limit: undefined,
      offset: undefined,
    });
    // prompt-type is ignored unless promptOnly is on
    expect(buildEngineLogQuery({ ...EMPTY_LOG_FILTER, promptType: 'system' }).promptType).toBeUndefined();
  });

  it('builds the in-band WS filter', () => {
    expect(buildStreamFilter({ ...EMPTY_LOG_FILTER, component: 'chat', minLevel: 'debug' })).toEqual({
      component: 'chat',
      entityId: undefined,
      minLevel: 'debug',
    });
  });

  it('describes the active filter', () => {
    const t = (k: string) => k;
    expect(describeFilter({ ...EMPTY_LOG_FILTER }, t)).toBe('');
    expect(
      describeFilter(
        { minLevel: 'info', component: 'chat', entityId: null, search: 'hi', promptOnly: true, promptType: 'system' },
        t,
      ),
    ).toBe('filterLevel=info, filterComponent=chat, filterSearch="hi", filterPromptType=system');
  });
});

describe('EngineLogScreen render', () => {
  it('renders the toolbar and loads the empty state', async () => {
    const { getByTestId } = await render(<EngineLogScreen />);
    expect(getByTestId('log-search')).toBeTruthy();
    expect(getByTestId('log-follow-toggle')).toBeTruthy();
    expect(getByTestId('log-share')).toBeTruthy();
    await waitFor(() => expect(getByTestId('log-empty')).toBeTruthy());
  });
});
