/**
 * AppLogScreen — viewer tests.
 *
 * Covers rendering entries from the ring buffer, the level filter + text
 * search, the clear confirmation flow, the share/copy invocations, the
 * follow/pause data gating, and the no-scroll-side-effects regression (follow
 * must never yank the list — EngineLogScreen parity).
 */

import React from 'react';
import { FlatList } from 'react-native';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import Clipboard from '@react-native-clipboard/clipboard';

afterEach(cleanup);
beforeEach(() => {
  cleanup();
  jest.clearAllMocks();
});

const mockShowAlert = jest.fn();
const mockShowToast = jest.fn();

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

jest.mock('../../contexts/AppAlertContext', () => ({
  useAppAlert: () => ({ showAlert: mockShowAlert }),
}));

jest.mock('../../contexts/AppToastContext', () => ({
  useToast: () => ({ showToast: mockShowToast }),
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
jest.mock('../../components/themed/ScreenHeader', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, ScreenHeader: ({ right, children, ...props }: any) => React.createElement(View, props, right, children) };
});

const mockBuildReport = jest.fn((..._args: unknown[]) => 'APP-REPORT');
const mockCopyEntries = jest.fn(() => Promise.resolve(true));
jest.mock('../../services/diagnostics/appDiagnostics', () => ({
  buildAppDiagnosticsReport: (...args: unknown[]) => (mockBuildReport as jest.Mock)(...args),
  copyAppLogEntries: (...args: unknown[]) => (mockCopyEntries as jest.Mock)(...args),
}));

const mockShareTextFileReport = jest.fn(() => Promise.resolve('/mock/caches/report.txt'));
jest.mock('../../services/diagnostics/shareDiagnostics', () => ({
  shareTextFileReport: (...args: unknown[]) => (mockShareTextFileReport as jest.Mock)(...args),
}));

import { AppLogScreen, APP_LOG_POLL_MS, buildAppLogRows } from '../settings/AppLogScreen';
import { appLogBuffer, type AppLogEntry } from '../../utils/appLogs';

function seed() {
  appLogBuffer.clear();
  appLogBuffer.push({
    timestamp: '2026-10-19T10:00:00.000Z',
    level: 'info',
    namespace: '[Svc]',
    message: 'hello world',
  });
  appLogBuffer.push({
    timestamp: '2026-10-19T10:00:01.000Z',
    level: 'error',
    namespace: null,
    message: 'boom failure',
  });
}

describe('AppLogScreen render', () => {
  it('renders the buffer entries newest-first', async () => {
    seed();
    const { getByText, getByTestId, getAllByTestId } = await render(<AppLogScreen />);
    expect(getByText('hello world')).toBeTruthy();
    expect(getByText('boom failure')).toBeTruthy();
    expect(getByTestId('app-log-count')).toBeTruthy();

    const [older, newer] = appLogBuffer.getEntries();
    expect(getAllByTestId(/^app-log-row-\d+$/).map(row => row.props.testID)).toEqual([
      `app-log-row-${newer.id}`,
      `app-log-row-${older.id}`,
    ]);
  });

  it('shows the empty state when the buffer is empty', async () => {
    appLogBuffer.clear();
    const { getByTestId } = await render(<AppLogScreen />);
    expect(getByTestId('app-log-empty')).toBeTruthy();
  });
});

describe('AppLogScreen filter + search', () => {
  it('filters to the error level and above', async () => {
    seed();
    const { getByTestId, queryByText, getByText } = await render(<AppLogScreen />);
    await fireEvent.press(getByTestId('app-log-level-error'));
    expect(queryByText('hello world')).toBeNull();
    expect(getByText('boom failure')).toBeTruthy();
  });

  it('searches messages case-insensitively', async () => {
    seed();
    const { getByTestId, queryByText, getByText } = await render(<AppLogScreen />);
    await fireEvent.changeText(getByTestId('app-log-search'), 'BOOM');
    expect(getByText('boom failure')).toBeTruthy();
    expect(queryByText('hello world')).toBeNull();
  });
});

describe('AppLogScreen actions', () => {
  it('confirms before clearing the buffer', async () => {
    seed();
    const { getByTestId } = await render(<AppLogScreen />);
    fireEvent.press(getByTestId('app-log-clear'));

    expect(mockShowAlert).toHaveBeenCalledTimes(1);
    const buttons = mockShowAlert.mock.calls[0][2];
    const destructive = buttons.find((b: any) => b.style === 'destructive');
    expect(destructive).toBeTruthy();

    destructive.onPress();
    await waitFor(() => expect(appLogBuffer.size()).toBe(0));
    expect(mockShowToast).toHaveBeenCalledWith('clearedToast');
  });

  it('shares the filtered buffer as a written text file', async () => {
    seed();
    const { getByTestId } = await render(<AppLogScreen />);
    fireEvent.press(getByTestId('app-log-share'));
    await waitFor(() => expect(mockBuildReport).toHaveBeenCalled());
    // The viewer is newest-first, but the exported report stays chronological.
    const [older, newer] = appLogBuffer.getEntries();
    const sharedEntries = mockBuildReport.mock.calls[0][0] as AppLogEntry[];
    expect(sharedEntries.map(e => e.id)).toEqual([older.id, newer.id]);
    // A file URL (not a full-report `Share.share({ message })` blob) is shared,
    // so a large buffer stays under Android's intent limit.
    await waitFor(() =>
      expect(mockShareTextFileReport).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Soulbits App diagnostics',
          filename: expect.stringMatching(/^soulbits-diagnostics-.+\.txt$/),
          report: 'APP-REPORT',
        }),
      ),
    );
  });

  it('copies the filtered buffer and confirms with a toast', async () => {
    seed();
    const { getByTestId } = await render(<AppLogScreen />);
    fireEvent.press(getByTestId('app-log-copy'));
    await waitFor(() => expect(mockCopyEntries).toHaveBeenCalled());
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith('copiedToast'));
  });
});

// ── Pure row building (dedup) ────────────────────────────────────────────────

function entry(over: Partial<AppLogEntry> = {}): AppLogEntry {
  return {
    id: over.id ?? 1,
    timestamp: over.timestamp ?? '2026-10-19T10:00:00.000Z',
    level: over.level ?? 'info',
    namespace: over.namespace ?? '[Svc]',
    message: over.message ?? 'hello',
  };
}

describe('buildAppLogRows', () => {
  it('collapses consecutive duplicates onto the newest representative', () => {
    const rows = buildAppLogRows([
      entry({ id: 1, message: 'a' }),
      entry({ id: 2, message: 'a' }),
      entry({ id: 3, level: 'warn', namespace: null, message: 'b' }),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0].entry.id).toBe(3); // newest row first
    expect(rows[0].count).toBe(1);
    expect(rows[1].entry.id).toBe(2); // newest entry of the duplicate run
    expect(rows[1].count).toBe(2);
    expect(rows[1].ids).toEqual([1, 2]);
  });

  it('returns rows newest → oldest for display', () => {
    const rows = buildAppLogRows([
      entry({ id: 1, message: 'a' }),
      entry({ id: 2, message: 'b' }),
      entry({ id: 3, message: 'c' }),
    ]);
    expect(rows.map(r => r.entry.id)).toEqual([3, 2, 1]);
  });

  it('ignores the timestamp when collapsing (keeps the newest)', () => {
    const rows = buildAppLogRows([
      entry({ id: 1, timestamp: '2026-10-19T10:00:00.000Z', message: 'a' }),
      entry({ id: 2, timestamp: '2026-10-19T10:00:05.000Z', message: 'a' }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(2);
    expect(rows[0].entry.timestamp).toBe('2026-10-19T10:00:05.000Z');
  });

  it('does not collapse non-adjacent same-content entries', () => {
    const rows = buildAppLogRows([
      entry({ id: 1, message: 'a' }),
      entry({ id: 2, message: 'b' }),
      entry({ id: 3, message: 'a' }),
    ]);
    expect(rows).toHaveLength(3);
    expect(rows.every(r => r.count === 1)).toBe(true);
  });

  it('returns an empty array for empty input', () => {
    expect(buildAppLogRows([])).toEqual([]);
  });
});

// ── Dedup badge + per-row long-press copy ────────────────────────────────────

describe('AppLogScreen dedup + copy', () => {
  it('collapses consecutive duplicates and renders the ×N badge', async () => {
    appLogBuffer.clear();
    appLogBuffer.push({
      timestamp: '2026-10-19T10:00:00.000Z',
      level: 'info',
      namespace: '[Svc]',
      message: 'dup line',
    });
    appLogBuffer.push({
      timestamp: '2026-10-19T10:00:01.000Z',
      level: 'info',
      namespace: '[Svc]',
      message: 'dup line',
    });
    const { getByText, queryAllByText, getByTestId } = await render(<AppLogScreen />);
    expect(queryAllByText('dup line')).toHaveLength(1);
    expect(getByText('×2')).toBeTruthy();
    const newestId = appLogBuffer.getEntries()[1].id;
    expect(getByTestId(`app-log-row-dedup-${newestId}`)).toBeTruthy();
  });

  it('copies a single row line on long-press', async () => {
    seed();
    const { getByTestId } = await render(<AppLogScreen />);
    const first = appLogBuffer.getEntries()[0];
    fireEvent(getByTestId(`app-log-row-${first.id}`), 'longPress');
    expect(Clipboard.setString).toHaveBeenCalledWith(
      '[2026-10-19T10:00:00.000Z] INFO [Svc] — hello world',
    );
  });

  it('appends the ×count to a collapsed row copy', async () => {
    appLogBuffer.clear();
    appLogBuffer.push({
      timestamp: '2026-10-19T10:00:00.000Z',
      level: 'info',
      namespace: null,
      message: 'dup',
    });
    appLogBuffer.push({
      timestamp: '2026-10-19T10:00:01.000Z',
      level: 'info',
      namespace: null,
      message: 'dup',
    });
    const { getByTestId } = await render(<AppLogScreen />);
    const newestId = appLogBuffer.getEntries()[1].id;
    fireEvent(getByTestId(`app-log-row-${newestId}`), 'longPress');
    expect(Clipboard.setString).toHaveBeenCalledWith('[2026-10-19T10:00:01.000Z] INFO — dup (×2)');
  });
});

// ── Pause freezes the visible snapshot ───────────────────────────────────────

describe('AppLogScreen pause', () => {
  it('does not apply buffer mutations while paused and catches up on resume', async () => {
    jest.useFakeTimers();
    try {
      seed();
      const { getByTestId, queryByText } = await render(<AppLogScreen />);
      expect(queryByText('hello world')).toBeTruthy();

      // pause
      await fireEvent.press(getByTestId('app-log-follow-toggle'));

      // mutate the buffer while paused
      appLogBuffer.push({
        timestamp: '2026-10-19T10:00:02.000Z',
        level: 'warn',
        namespace: null,
        message: 'paused-arrival',
      });
      await act(async () => {
        jest.advanceTimersByTime(APP_LOG_POLL_MS * 3);
      });

      // frozen: the new entry is not rendered
      expect(queryByText('paused-arrival')).toBeNull();

      // resume → catch up immediately
      await fireEvent.press(getByTestId('app-log-follow-toggle'));
      expect(queryByText('paused-arrival')).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });
});

// ── Regression: follow must not manipulate the scroll position ──────────────
// The previous `onContentSizeChange` → scrollToOffset(0) handler fired on every
// content-size change, including virtualization re-measures DURING the user's
// own scroll, constantly snapping the view back to the top. EngineLogScreen has
// no scroll manipulation: follow/pause only gates data ingestion, and
// newest-first prepending keeps the top current by itself.

describe('AppLogScreen follow has no scroll side effects', () => {
  it('never calls scrollToOffset when new data arrives while following', async () => {
    jest.useFakeTimers();
    const scrollSpy = jest.spyOn(FlatList.prototype, 'scrollToOffset');
    try {
      seed();
      const { getByTestId, queryByText } = await render(<AppLogScreen />);
      const list = getByTestId('app-log-list');

      // A live arrival while following still ingests data...
      appLogBuffer.push({
        timestamp: '2026-10-19T10:00:02.000Z',
        level: 'info',
        namespace: null,
        message: 'live-arrival',
      });
      await act(async () => {
        jest.advanceTimersByTime(APP_LOG_POLL_MS * 2);
      });
      expect(queryByText('live-arrival')).toBeTruthy();

      // ...and a content-size change (virtualization re-measure during the
      // user's own scroll) no longer yanks the view to the top.
      fireEvent(list, 'contentSizeChange', 360, 2000);
      await act(async () => {
        jest.advanceTimersByTime(APP_LOG_POLL_MS);
      });

      expect(scrollSpy).not.toHaveBeenCalled();
    } finally {
      scrollSpy.mockRestore();
      jest.useRealTimers();
    }
  });
});
