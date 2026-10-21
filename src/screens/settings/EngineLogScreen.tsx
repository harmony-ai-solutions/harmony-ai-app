/**
 * EngineLogScreen — the app's Dev-Tools log viewer for the embedded engine
 * (plan 7-11).
 *
 * Feature set mirrors the desktop (Wails) Dev-Tools Log Viewer: a live tail over
 * the engine's WS log stream with follow/pause, a REST ring-buffer history
 * backfill on load, level/component/entity/search/prompt filters, "load older"
 * pagination, dedup-count badges driven by stream remove events, an in-memory
 * row cap, and a share-sheet diagnostics export. Live frames are coalesced
 * into ~250 ms render batches (the Wails buffered-batch pattern).
 *
 * Entry point: Settings → Help & Support → "Engine logs".
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
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
import { ThemedCard } from '../../components/themed/ThemedCard';
import { ScreenHeader } from '../../components/themed/ScreenHeader';
import { hexToRgba } from '../../utils/colorUtils';
import { engineApiClient } from '../../services/engine/EngineApiClient';
import type {
  EngineLogEntryDto,
  EngineLogQuery,
} from '../../services/engine/EngineApiClient';
import {
  EngineLogStream,
  type EngineLogStreamEvent,
  type EngineLogStreamStatus,
} from '../../services/engine/EngineLogStream';
import { shareDiagnosticsReport } from '../../services/diagnostics/shareDiagnostics';
import { formatLogEntry } from '../../services/diagnostics/buildDiagnosticsReport';
import { createLogger } from '../../utils/logger';

const log = createLogger('[EngineLogScreen]');

// ── Pure view logic (exported for unit tests) ────────────────────────────────

/** In-memory row cap (the Wails viewer keeps a bounded tail). */
export const LOG_ROW_CAP = 2000;
/** Backfill page size. */
export const LOG_PAGE_SIZE = 200;
/** Render-batch coalescing window (ms). */
export const LOG_BATCH_MS = 250;

/** Severity order (lower = more severe), mirroring the engine's level table. */
export const LOG_LEVELS = ['panic', 'fatal', 'error', 'warn', 'info', 'debug', 'trace'] as const;
export type LogLevelName = (typeof LOG_LEVELS)[number];

/** A display row: one logical entry plus its collapsed duplicate count + ids. */
export interface LogRow {
  entry: EngineLogEntryDto;
  count: number;
  ids: number[];
}

/** The active filter state. */
export interface LogFilterState {
  minLevel: string | null;
  component: string | null;
  entityId: string | null;
  search: string;
  promptOnly: boolean;
  promptType: string | null;
}

/** The default (unfiltered) filter state. */
export const EMPTY_LOG_FILTER: LogFilterState = {
  minLevel: null,
  component: null,
  entityId: null,
  search: '',
  promptOnly: false,
  promptType: null,
};

/** Severity rank for a level string (lower = more severe); unknown → debug(5). */
export function levelRank(level: string): number {
  const idx = LOG_LEVELS.indexOf(String(level).toLowerCase() as LogLevelName);
  return idx === -1 ? 5 : idx;
}

/** `HH:MM:SS.mmm` from an RFC3339 timestamp (best-effort). */
export function formatLogClock(timestamp: string): string {
  const m = /T(\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?/.exec(timestamp ?? '');
  if (!m) return timestamp ?? '';
  return m[2] ? `${m[1]}.${m[2].padEnd(3, '0')}` : m[1];
}

/** The identity used to collapse consecutive duplicate entries (ignores latency). */
export function logIdentity(entry: EngineLogEntryDto): string {
  let data = '';
  if (entry.data && typeof entry.data === 'object') {
    const keys = Object.keys(entry.data)
      .filter(k => k !== 'latency')
      .sort();
    data = keys.map(k => `${k}=${String((entry.data as Record<string, unknown>)[k])}`).join('|');
  }
  return [
    entry.level,
    entry.component,
    entry.entityId,
    entry.subSystem ?? '',
    entry.message,
    data,
  ].join('\u0000');
}

/** Convert backfill entries (newest-first) into rows, deduped by id. */
export function mergeBackfill(
  rows: LogRow[],
  incoming: EngineLogEntryDto[],
  cap: number = LOG_ROW_CAP,
): LogRow[] {
  const seen = new Set<number>();
  const merged: LogRow[] = [];
  for (const entry of incoming) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    merged.push({ entry, count: 1, ids: [entry.id] });
  }
  for (const row of rows) {
    if (seen.has(row.entry.id)) continue;
    seen.add(row.entry.id);
    merged.push(row);
  }
  merged.sort((a, b) => b.entry.id - a.entry.id);
  return merged.slice(0, cap);
}

/**
 * Apply a stream event to the row list: `entry` collapses onto the newest row
 * when identical (incrementing its dedup count), else prepends; `remove` drops
 * the matching id from its row (and the row when its count reaches 0). Capped.
 */
export function applyStreamEvent(
  rows: LogRow[],
  event: EngineLogStreamEvent,
  cap: number = LOG_ROW_CAP,
): LogRow[] {
  if (event.type === 'entry' && event.entry) {
    const entry = event.entry;
    const head = rows[0];
    if (head && logIdentity(head.entry) === logIdentity(entry)) {
      const updated: LogRow = {
        entry,
        count: head.count + 1,
        ids: [...head.ids, entry.id],
      };
      return [updated, ...rows.slice(1)].slice(0, cap);
    }
    return [{ entry, count: 1, ids: [entry.id] }, ...rows].slice(0, cap);
  }
  if (event.type === 'remove' && typeof event.removeId === 'number') {
    const removeId = event.removeId;
    const next: LogRow[] = [];
    for (const row of rows) {
      if (!row.ids.includes(removeId)) {
        next.push(row);
        continue;
      }
      const ids = row.ids.filter(id => id !== removeId);
      if (ids.length === 0) continue; // row fully evicted
      next.push({ entry: row.entry, count: row.count - 1, ids });
    }
    return next;
  }
  return rows;
}

/** Build the REST query for the filter + a page window. */
export function buildEngineLogQuery(
  filter: LogFilterState,
  opts: { limit?: number; offset?: number } = {},
): EngineLogQuery {
  return {
    minLevel: filter.minLevel ?? undefined,
    component: filter.component ?? undefined,
    entityId: filter.entityId ?? undefined,
    search: filter.search.trim() || undefined,
    isPrompt: filter.promptOnly ? true : undefined,
    promptType: filter.promptOnly ? filter.promptType ?? undefined : undefined,
    limit: opts.limit,
    offset: opts.offset,
  };
}

/** The in-band WS filter message shape. */
export function buildStreamFilter(filter: LogFilterState): {
  component?: string;
  entityId?: string;
  minLevel?: string;
} {
  return {
    component: filter.component ?? undefined,
    entityId: filter.entityId ?? undefined,
    minLevel: filter.minLevel ?? undefined,
  };
}

/** Human-readable filter description (for the export header). */
export function describeFilter(filter: LogFilterState, t: (k: string) => string): string {
  const parts: string[] = [];
  if (filter.minLevel) parts.push(`${t('filterLevel')}=${filter.minLevel}`);
  if (filter.component) parts.push(`${t('filterComponent')}=${filter.component}`);
  if (filter.entityId) parts.push(`${t('filterEntity')}=${filter.entityId}`);
  if (filter.search.trim()) parts.push(`${t('filterSearch')}="${filter.search.trim()}"`);
  if (filter.promptOnly) {
    parts.push(filter.promptType ? `${t('filterPromptType')}=${filter.promptType}` : t('filterPromptsOnly'));
  }
  return parts.join(', ');
}

/** Flatten rows (display order, newest-first) to entries for the export dump. */
export function rowsToEntries(rows: LogRow[]): EngineLogEntryDto[] {
  return rows.map(r => r.entry);
}

/**
 * Clipboard text for the Copy action: the visible entries oldest → newest, one
 * share-report line each (the same formatting the diagnostics dump uses).
 */
export function buildCopyText(rows: LogRow[]): string {
  return [...rows].reverse().map(row => formatLogEntry(row.entry)).join('\n');
}

// ── Screen ───────────────────────────────────────────────────────────────────

export const EngineLogScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { theme } = useAppTheme();
  const { t } = useTranslation('engineLogs');
  const { showAlert } = useAppAlert();
  const { showToast } = useToast();

  const [rows, setRows] = useState<LogRow[]>([]);
  const [status, setStatus] = useState<EngineLogStreamStatus>('idle');
  const [paused, setPaused] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [filter, setFilter] = useState<LogFilterState>(EMPTY_LOG_FILTER);
  const [components, setComponents] = useState<string[]>([]);
  const [entities, setEntities] = useState<string[]>([]);
  const [promptTypes, setPromptTypes] = useState<string[]>([]);

  const [sharing, setSharing] = useState(false);

  const streamRef = useRef<EngineLogStream | null>(null);
  const pendingRef = useRef<EngineLogStreamEvent[]>([]);
  const filterRef = useRef(filter);
  filterRef.current = filter;

  const refreshOptions = useCallback(async () => {
    try {
      const [c, e, p] = await Promise.all([
        engineApiClient.engineLogComponents(),
        engineApiClient.engineLogEntities(),
        engineApiClient.engineLogPromptTypes(),
      ]);
      setComponents(c.components ?? []);
      setEntities(e.entities ?? []);
      setPromptTypes(p.promptTypes ?? []);
    } catch (err) {
      log.warn('Failed to load log filter options:', err);
    }
  }, []);

  /** REST backfill for the current filter (page 0) — the Wails load pattern. */
  const backfill = useCallback(async (nextFilter: LogFilterState) => {
    setLoading(true);
    setError(null);
    try {
      const res = await engineApiClient.engineLogs(
        buildEngineLogQuery(nextFilter, { limit: LOG_PAGE_SIZE, offset: 0 }),
      );
      setRows(mergeBackfill([], res.entries ?? []));
      setHasMore((res.entries?.length ?? 0) >= LOG_PAGE_SIZE);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setRows([]);
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load: options + backfill, then start the live stream.
  useEffect(() => {
    void refreshOptions();
    void backfill(EMPTY_LOG_FILTER);

    const stream = new EngineLogStream({
      onEvent: event => {
        pendingRef.current.push(event);
      },
      onStatusChange: setStatus,
    });
    streamRef.current = stream;
    stream.setFilter(buildStreamFilter(EMPTY_LOG_FILTER));
    stream.start();

    const flush = setInterval(() => {
      if (pendingRef.current.length === 0) return;
      const batch = pendingRef.current;
      pendingRef.current = [];
      setRows(prev => batch.reduce((acc, ev) => applyStreamEvent(acc, ev), prev));
    }, LOG_BATCH_MS);

    return () => {
      clearInterval(flush);
      stream.stop();
      streamRef.current = null;
    };
  }, [refreshOptions, backfill]);

  // Push filter changes to the live stream + re-backfill the REST window.
  const applyFilter = useCallback(
    (patch: Partial<LogFilterState>) => {
      const next = { ...filterRef.current, ...patch };
      setFilter(next);
      streamRef.current?.setFilter(buildStreamFilter(next));
      void backfill(next);
    },
    [backfill],
  );

  const togglePause = useCallback(() => {
    setPaused(prev => {
      const next = !prev;
      streamRef.current?.setPaused(next);
      return next;
    });
  }, []);

  const loadOlder = useCallback(async () => {
    if (loadingOlder || !hasMore) return;
    setLoadingOlder(true);
    try {
      const res = await engineApiClient.engineLogs(
        buildEngineLogQuery(filterRef.current, {
          limit: LOG_PAGE_SIZE,
          offset: rows.length,
        }),
      );
      const entries = res.entries ?? [];
      setRows(prev => mergeBackfill(prev, entries));
      setHasMore(entries.length >= LOG_PAGE_SIZE);
    } catch (err) {
      log.warn('Failed to load older logs:', err);
    } finally {
      setLoadingOlder(false);
    }
  }, [hasMore, loadingOlder, rows.length]);

  const share = useCallback(async () => {
    if (sharing) return;
    setSharing(true);
    try {
      const entries = rowsToEntries(rows);
      await shareDiagnosticsReport({
        entries,
        scope: 'filtered',
        filterSummary: describeFilter(filterRef.current, t) || t('filterNone'),
      });
    } catch (err) {
      log.warn('Diagnostics share failed:', err);
    } finally {
      setSharing(false);
    }
  }, [rows, sharing, t]);

  const copy = useCallback(() => {
    try {
      Clipboard.setString(buildCopyText(rows));
      showToast(t('copiedToast'));
    } catch {
      showToast(t('copyFailedToast'));
    }
  }, [rows, showToast, t]);

  /**
   * Clear the LOCAL view: drop the buffered rows + pagination window and let the
   * live stream keep running. The engine's ring buffer cannot be wiped through
   * the management API — the contract exposes only reads + runtime verbosity
   * under `/api/development/logs`, no DELETE — so this deliberately does not
   * call the engine. Old history reappears only if the live stream re-sends it.
   */
  const clear = useCallback(() => {
    showAlert(t('clearConfirmTitle'), t('clearConfirmMessage'), [
      { text: t('common:cancel'), style: 'cancel' },
      {
        text: t('clear'),
        style: 'destructive',
        onPress: () => {
          // Drop buffered pre-clear frames too, so they cannot re-fill the pane
          // on the next 250 ms flush.
          pendingRef.current = [];
          setRows([]);
          setHasMore(false);
          setLoadingOlder(false);
          setError(null);
          showToast(t('clearedToast'));
        },
      },
    ]);
  }, [showAlert, showToast, t]);

  const copyEntry = useCallback((entry: EngineLogEntryDto) => {
    const line = `[${entry.timestamp}] ${entry.level.toUpperCase()} ${entry.component}${
      entry.entityId ? ` ${entry.entityId}` : ''
    } — ${entry.message}`;
    try {
      Clipboard.setString(line);
    } catch {
      /* ignore */
    }
  }, []);

  const levelColors = useMemo(() => {
    if (!theme) return {} as Record<string, string>;
    return {
      panic: theme.colors.status.error,
      fatal: theme.colors.status.error,
      error: theme.colors.status.error,
      warn: theme.colors.status.warning,
      info: theme.colors.accent.primary,
      debug: theme.colors.text.secondary,
      trace: theme.colors.text.muted,
    } as Record<string, string>;
  }, [theme]);

  if (!theme) return null;

  const renderRow = ({ item }: { item: LogRow }) => (
    <TouchableOpacity
      activeOpacity={0.6}
      onLongPress={() => copyEntry(item.entry)}
      style={styles.row}
      testID={`log-row-${item.entry.id}`}
    >
      <ThemedText variant="muted" size={11} style={styles.rowTime}>
        {formatLogClock(item.entry.timestamp)}
      </ThemedText>
      <ThemedText
        size={11}
        weight="medium"
        style={[styles.rowLevel, { color: levelColors[item.entry.level] ?? theme.colors.text.secondary }]}
      >
        {item.entry.level.toUpperCase()}
      </ThemedText>
      <View style={styles.rowBody}>
        <ThemedText size={12} numberOfLines={4} style={styles.rowMessage}>
          {item.entry.component ? `[${item.entry.component}] ` : ''}
          {item.entry.message}
        </ThemedText>
        {item.count > 1 && (
          <View style={[styles.dedupBadge, { backgroundColor: hexToRgba(theme.colors.accent.primary, 0.15) }]}>
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
              onPress={togglePause}
              style={styles.headerIcon}
              testID="log-follow-toggle"
              accessibilityLabel={paused ? t('follow') : t('pause')}
            >
              <Icon
                name={paused ? 'play' : 'pause'}
                size={22}
                color={paused ? theme.colors.status.warning : theme.colors.accent.primary}
              />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={copy}
              style={styles.headerIcon}
              testID="engine-log-copy"
              accessibilityLabel={t('copy')}
            >
              <Icon name="content-copy" size={20} color={theme.colors.accent.primary} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={share}
              style={styles.headerIcon}
              testID="log-share"
              accessibilityLabel={t('share')}
              disabled={sharing}
            >
              <Icon name="share-variant" size={20} color={theme.colors.accent.primary} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={clear}
              style={styles.headerIcon}
              testID="engine-log-clear"
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
          onChangeText={text => applyFilter({ search: text })}
          testID="log-search"
          autoCapitalize="none"
          autoCorrect={false}
        />

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          <Chip
            label={t('levelAll')}
            active={filter.minLevel === null}
            onPress={() => applyFilter({ minLevel: null })}
            theme={theme}
            testID="level-chip-all"
          />
          {LOG_LEVELS.map(level => (
            <Chip
              key={level}
              label={level}
              active={filter.minLevel === level}
              onPress={() => applyFilter({ minLevel: level })}
              theme={theme}
              testID={`level-chip-${level}`}
            />
          ))}
        </ScrollView>

        {components.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            <Chip
              label={t('componentAll')}
              active={filter.component === null}
              onPress={() => applyFilter({ component: null })}
              theme={theme}
              testID="component-chip-all"
            />
            {components.map(comp => (
              <Chip
                key={comp}
                label={comp}
                active={filter.component === comp}
                onPress={() => applyFilter({ component: comp })}
                theme={theme}
                testID={`component-chip-${comp}`}
              />
            ))}
          </ScrollView>
        )}

        {entities.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            <Chip
              label={t('entityAll')}
              active={filter.entityId === null}
              onPress={() => applyFilter({ entityId: null })}
              theme={theme}
              testID="entity-chip-all"
            />
            {entities.map(ent => (
              <Chip
                key={ent}
                label={ent}
                active={filter.entityId === ent}
                onPress={() => applyFilter({ entityId: ent })}
                theme={theme}
                testID={`entity-chip-${ent}`}
              />
            ))}
          </ScrollView>
        )}

        <View style={styles.promptRow}>
          <Chip
            label={t('promptsOnly')}
            active={filter.promptOnly}
            onPress={() => applyFilter({ promptOnly: !filter.promptOnly, promptType: null })}
            theme={theme}
            testID="prompt-only-chip"
          />
          {filter.promptOnly &&
            promptTypes.map(pt => (
              <Chip
                key={pt}
                label={pt}
                active={filter.promptType === pt}
                onPress={() => applyFilter({ promptType: filter.promptType === pt ? null : pt })}
                theme={theme}
                testID={`prompt-type-chip-${pt}`}
              />
            ))}
        </View>
      </View>

      {/* ── Status line ── */}
      <View style={styles.statusLine}>
        <View
          style={[
            styles.statusDot,
            {
              backgroundColor:
                status === 'open'
                  ? theme.colors.status.success
                  : status === 'reconnecting' || status === 'connecting'
                  ? theme.colors.status.warning
                  : theme.colors.text.muted,
            },
          ]}
        />
        <ThemedText variant="muted" size={11} testID="log-status">
          {t(`status.${status}`)} · {t('entryCount', { count: rows.length })}
        </ThemedText>
      </View>

      {/* ── List ── */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.colors.accent.primary} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <ThemedText variant="secondary" size={13} testID="log-error">
            {t('loadFailed', { message: error })}
          </ThemedText>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={row => String(row.entry.id)}
          renderItem={renderRow}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.center}>
              <ThemedText variant="muted" size={13} testID="log-empty">
                {t('empty')}
              </ThemedText>
            </View>
          }
          ListFooterComponent={
            hasMore ? (
              <TouchableOpacity
                style={styles.loadOlder}
                onPress={() => void loadOlder()}
                testID="log-load-older"
              >
                {loadingOlder ? (
                  <ActivityIndicator color={theme.colors.accent.primary} />
                ) : (
                  <ThemedText variant="accent" size={13}>
                    {t('loadOlder')}
                  </ThemedText>
                )}
              </TouchableOpacity>
            ) : null
          }
        />
      )}
    </ThemedView>
  );
};

/** A small pill chip used by the filter + advanced rows. */
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
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
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
  promptRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
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
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  list: { flex: 1 },
  listContent: { paddingHorizontal: 12, paddingBottom: 24 },
  row: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 4, gap: 6 },
  rowTime: { width: 74, fontVariant: ['tabular-nums'] },
  rowLevel: { width: 44 },
  rowBody: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  rowMessage: { flex: 1 },
  dedupBadge: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 8 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  loadOlder: { alignItems: 'center', paddingVertical: 14 },
});

export default EngineLogScreen;
