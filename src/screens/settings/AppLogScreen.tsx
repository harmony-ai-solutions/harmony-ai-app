/**
 * AppLogScreen — the on-device viewer for the app's own log stream.
 *
 * Mirrors the EngineLogScreen conventions: a newest-first live view with
 * follow/pause, a level filter row, text search, and share/copy/clear header
 * actions. Follow/pause only gates DATA ingestion — like EngineLogScreen there
 * is NO scroll manipulation: newest-first prepending keeps the top current by
 * itself, and any programmatic scroll (e.g. on content-size change) would fight
 * the user's own scroll while virtualization re-measures rows.
 * Backed by the in-memory ring buffer in `src/utils/appLogs.ts`
 * (captured by the logger's capture transport). Export text stays chronological
 * (oldest → newest) and carries a diagnostics header (app version, engine
 * contract version, platform/OS, device model, app uptime, entry count + time
 * range).
 *
 * Entry point: Settings → Help & Support → "App logs".
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Share,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import Clipboard from '@react-native-clipboard/clipboard';
import { useAppTheme } from '../../contexts/ThemeContext';
import { useAppAlert } from '../../contexts/AppAlertContext';
import { useToast } from '../../contexts/AppToastContext';
import { ThemedView } from '../../components/themed/ThemedView';
import { ThemedText } from '../../components/themed/ThemedText';
import { ScreenHeader } from '../../components/themed/ScreenHeader';
import { hexToRgba } from '../../utils/colorUtils';
import {
  appLogBuffer,
  clearAllAppLogs,
  filterAppLogEntries,
  type AppLogEntry,
  type AppLogFilter,
} from '../../utils/appLogs';
import {
  buildAppDiagnosticsReport,
  copyAppLogEntries,
} from '../../services/diagnostics/appDiagnostics';
import { createLogger } from '../../utils/logger';

const log = createLogger('[AppLogScreen]');

// ── View constants (exported for tests) ──────────────────────────────────────

/** Poll cadence for picking up new buffer entries (ms). */
export const APP_LOG_POLL_MS = 250;

/** The selectable level chips (severity threshold; matches the spec). */
export const APP_LOG_FILTER_LEVELS = ['info', 'warn', 'error'] as const;

/** The default (unfiltered) filter state. */
export const EMPTY_APP_LOG_FILTER: AppLogFilter = { minLevel: null, search: '' };

/** A human-readable clock from an ISO timestamp (best-effort). */
export function formatAppLogClock(timestamp: string): string {
  const m = /T(\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?/.exec(timestamp ?? '');
  if (!m) return timestamp ?? '';
  return m[2] ? `${m[1]}.${m[2].padEnd(3, '0')}` : m[1];
}

/** A display row: one logical entry plus its collapsed duplicate count + ids. */
export interface AppLogRow {
  entry: AppLogEntry;
  count: number;
  ids: number[];
}

/** The identity used to collapse consecutive duplicate entries (ignores time/id). */
function appLogIdentity(entry: AppLogEntry): string {
  return [entry.level, entry.namespace ?? '', entry.message].join('\u0000');
}

/**
 * Collapse runs of consecutive identical entries (identity = level + namespace +
 * message) into a single row, keeping the NEWEST entry of the run as the
 * representative — mirroring EngineLogScreen's `applyStreamEvent` newest-wins
 * dedup. Non-adjacent identical entries stay separate (runs are contiguous).
 * Returns rows NEWEST → OLDEST so the viewer (and every render) shows the latest
 * activity at the top, matching EngineLogScreen.
 */
export function buildAppLogRows(entries: readonly AppLogEntry[]): AppLogRow[] {
  const rows: AppLogRow[] = [];
  // Walk newest → oldest: the first entry of a run is its newest representative.
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    const head = rows[rows.length - 1];
    if (head && appLogIdentity(head.entry) === appLogIdentity(entry)) {
      rows[rows.length - 1] = { entry: head.entry, count: head.count + 1, ids: [entry.id, ...head.ids] };
    } else {
      rows.push({ entry, count: 1, ids: [entry.id] });
    }
  }
  return rows;
}

/**
 * Filter rows by the same criteria as {@link filterAppLogEntries}, applied to
 * each row's representative entry. Reuses the entry filter verbatim (via the
 * surviving ids) so the criteria stay in one place and a collapsed count
 * survives filtering — the rows are built from the raw buffer first, then
 * filtered (engine-style: dedup at ingestion, filter the collapsed rows).
 */
export function filterAppLogRows(
  rows: readonly AppLogRow[],
  criteria: AppLogFilter = {},
): AppLogRow[] {
  const kept = new Set(filterAppLogEntries(rows.map(row => row.entry), criteria).map(e => e.id));
  return rows.filter(row => kept.has(row.entry.id));
}

// ── Screen ───────────────────────────────────────────────────────────────────

export const AppLogScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { theme } = useAppTheme();
  const { t } = useTranslation('appLogs');
  const { showAlert } = useAppAlert();
  const { showToast } = useToast();

  const [raw, setRaw] = useState<AppLogEntry[]>(() => [...appLogBuffer.getEntries()]);
  const [filter, setFilter] = useState<AppLogFilter>(EMPTY_APP_LOG_FILTER);
  const [following, setFollowing] = useState(true);

  const versionRef = useRef(appLogBuffer.getVersion());
  // Read inside the poll tick so a pause is honoured without a stale closure.
  const followingRef = useRef(following);
  followingRef.current = following;

  // Poll the buffer; only re-render when the mutation version changed. While
  // paused the snapshot is frozen (buffer mutations are not applied); resuming
  // catches up to the current buffer immediately.
  useEffect(() => {
    const tick = () => {
      const version = appLogBuffer.getVersion();
      if (version === versionRef.current) return;
      if (!followingRef.current) return; // paused: hold the visible snapshot
      versionRef.current = version;
      setRaw([...appLogBuffer.getEntries()]);
    };
    tick();
    const id = setInterval(tick, APP_LOG_POLL_MS);
    return () => clearInterval(id);
  }, []);

  /** Toggle follow/pause; on resume, catch the frozen snapshot up to the buffer. */
  const toggleFollow = useCallback(() => {
    const next = !followingRef.current;
    followingRef.current = next; // apply immediately so the next tick sees it
    setFollowing(next);
    if (next) {
      versionRef.current = appLogBuffer.getVersion();
      setRaw([...appLogBuffer.getEntries()]);
    }
  }, []);

  // Build rows from the raw buffer (collapsing consecutive duplicates) before
  // filtering, so a dedup count survives level/search filtering.
  const visible = useMemo(() => filterAppLogRows(buildAppLogRows(raw), filter), [raw, filter]);
  // Export/copy operate on the representative entries of the visible rows,
  // re-ordered oldest → newest so the shared diagnostics reads top-down (the
  // list itself is newest-first).
  const exportEntries = useMemo(
    () => [...visible.map(row => row.entry)].reverse(),
    [visible],
  );

  const levelColors = useMemo(() => {
    if (!theme) return {} as Record<string, string>;
    return {
      error: theme.colors.status.error,
      warn: theme.colors.status.warning,
      info: theme.colors.accent.primary,
      debug: theme.colors.text.muted,
    } as Record<string, string>;
  }, [theme]);

  const share = useCallback(async () => {
    try {
      const text = buildAppDiagnosticsReport(exportEntries);
      await Share.share({ title: t('title'), message: text });
    } catch (err) {
      log.warn('App-log share failed:', err);
      showToast(t('shareFailedToast'));
    }
  }, [exportEntries, t, showToast]);

  const copy = useCallback(async () => {
    const ok = await copyAppLogEntries(exportEntries);
    showToast(ok ? t('copiedToast') : t('copyFailedToast'));
  }, [exportEntries, t, showToast]);

  /** Copy one row's line to the clipboard (long-press). Never throws. */
  const copyEntry = useCallback((row: AppLogRow) => {
    const ns = row.entry.namespace ?? '';
    const head = `[${row.entry.timestamp}] ${row.entry.level.toUpperCase()}${ns ? ` ${ns}` : ''}`;
    const line = row.count > 1 ? `${head} — ${row.entry.message} (×${row.count})` : `${head} — ${row.entry.message}`;
    try {
      Clipboard.setString(line);
    } catch {
      /* ignore */
    }
  }, []);

  const clear = useCallback(() => {
    showAlert(t('clearConfirmTitle'), t('clearConfirmMessage'), [
      { text: t('common:cancel'), style: 'cancel' },
      {
        text: t('clear'),
        style: 'destructive',
        onPress: () => {
          void clearAllAppLogs()
            .then(() => {
              versionRef.current = appLogBuffer.getVersion();
              setRaw([]);
              showToast(t('clearedToast'));
            })
            .catch(() => {
              /* never surface a clear failure */
            });
        },
      },
    ]);
  }, [showAlert, showToast, t]);

  if (!theme) return null;

  const renderRow = ({ item }: { item: AppLogRow }) => (
    <TouchableOpacity
      activeOpacity={0.6}
      onLongPress={() => copyEntry(item)}
      style={styles.row}
      testID={`app-log-row-${item.entry.id}`}
    >
      <ThemedText variant="muted" size={11} style={styles.rowTime}>
        {formatAppLogClock(item.entry.timestamp)}
      </ThemedText>
      <ThemedText
        size={11}
        weight="medium"
        style={[styles.rowLevel, { color: levelColors[item.entry.level] ?? theme.colors.text.secondary }]}
      >
        {item.entry.level.toUpperCase()}
      </ThemedText>
      <View style={styles.rowBody}>
        {item.entry.namespace ? (
          <ThemedText variant="accent" size={11}>
            {item.entry.namespace}{' '}
          </ThemedText>
        ) : null}
        <ThemedText size={12} style={styles.rowMessage}>
          {item.entry.message}
        </ThemedText>
        {item.count > 1 && (
          <View
            style={[styles.dedupBadge, { backgroundColor: hexToRgba(theme.colors.accent.primary, 0.15) }]}
            testID={`app-log-row-dedup-${item.entry.id}`}
          >
            <ThemedText variant="accent" size={10} weight="medium">
              ×{item.count}
            </ThemedText>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );

  return (
    <ThemedView style={styles.container}>
      <ScreenHeader
        title={t('title')}
        onBack={() => navigation.goBack()}
        right={
          <View style={styles.headerActions}>
            <TouchableOpacity
              onPress={toggleFollow}
              style={styles.headerIcon}
              testID="app-log-follow-toggle"
              accessibilityLabel={following ? t('pause') : t('follow')}
            >
              <Icon
                name={following ? 'pause' : 'play'}
                size={22}
                color={following ? theme.colors.accent.primary : theme.colors.status.warning}
              />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => void copy()}
              style={styles.headerIcon}
              testID="app-log-copy"
              accessibilityLabel={t('copy')}
            >
              <Icon name="content-copy" size={20} color={theme.colors.accent.primary} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => void share()}
              style={styles.headerIcon}
              testID="app-log-share"
              accessibilityLabel={t('share')}
            >
              <Icon name="share-variant" size={20} color={theme.colors.accent.primary} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={clear}
              style={styles.headerIcon}
              testID="app-log-clear"
              accessibilityLabel={t('clear')}
            >
              <Icon name="delete-sweep-outline" size={20} color={theme.colors.status.error} />
            </TouchableOpacity>
          </View>
        }
      />

      {/* ── Filter toolbar ── */}
      <View style={styles.toolbar}>
        <TextInput
          style={[
            styles.search,
            {
              backgroundColor: hexToRgba(theme.colors.background.elevated, 0.6),
              borderColor: theme.colors.border.default,
              color: theme.colors.text.primary,
            },
          ]}
          placeholder={t('searchPlaceholder')}
          placeholderTextColor={theme.colors.text.muted}
          value={filter.search}
          onChangeText={text => setFilter(prev => ({ ...prev, search: text }))}
          testID="app-log-search"
          autoCapitalize="none"
          autoCorrect={false}
        />

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          <Chip
            label={t('levelAll')}
            active={!filter.minLevel}
            onPress={() => setFilter(prev => ({ ...prev, minLevel: null }))}
            theme={theme}
            testID="app-log-level-all"
          />
          {APP_LOG_FILTER_LEVELS.map(level => (
            <Chip
              key={level}
              label={level}
              active={filter.minLevel === level}
              onPress={() => setFilter(prev => ({ ...prev, minLevel: level }))}
              theme={theme}
              testID={`app-log-level-${level}`}
            />
          ))}
        </ScrollView>
      </View>

      {/* ── Status line ── */}
      <View style={styles.statusLine}>
        <ThemedText variant="muted" size={11} testID="app-log-count">
          {t('entryCount', { count: visible.length })}
        </ThemedText>
      </View>

      <FlatList
        data={visible}
        keyExtractor={item => String(item.entry.id)}
        renderItem={renderRow}
        style={styles.list}
        testID="app-log-list"
        contentContainerStyle={styles.listContent}
        initialNumToRender={30}
        maxToRenderPerBatch={40}
        windowSize={11}
        removeClippedSubviews
        ListEmptyComponent={
          <View style={styles.center}>
            <ThemedText variant="muted" size={13} testID="app-log-empty">
              {t('empty')}
            </ThemedText>
          </View>
        }
      />
    </ThemedView>
  );
};

/** A small pill chip used by the level filter row. */
const Chip: React.FC<{
  label: string;
  active: boolean;
  onPress: () => void;
  theme: any;
  testID?: string;
}> = ({ label, active, onPress, theme, testID }) => (
  <TouchableOpacity
    onPress={onPress}
    testID={testID}
    style={[
      styles.chip,
      {
        backgroundColor: active
          ? hexToRgba(theme.colors.accent.primary, 0.2)
          : hexToRgba(theme.colors.background.elevated, 0.5),
        borderColor: active ? theme.colors.accent.primary : theme.colors.border.default,
      },
    ]}
  >
    <ThemedText size={12} variant={active ? 'accent' : 'secondary'} weight={active ? 'medium' : 'normal'}>
      {label}
    </ThemedText>
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  headerIcon: { padding: 6 },
  toolbar: { paddingHorizontal: 16, gap: 8, paddingBottom: 8 },
  search: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 13,
  },
  chipRow: { gap: 8, paddingVertical: 2, alignItems: 'center' },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  statusLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingBottom: 6,
  },
  list: { flex: 1 },
  listContent: { paddingHorizontal: 12, paddingBottom: 24 },
  row: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 4, gap: 6 },
  rowTime: { width: 74, fontVariant: ['tabular-nums'] },
  rowLevel: { width: 44 },
  rowBody: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: 6 },
  rowMessage: { flexShrink: 1 },
  dedupBadge: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 8 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
});

export default AppLogScreen;
