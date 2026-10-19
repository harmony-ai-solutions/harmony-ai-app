/**
 * AppLogScreen — the on-device viewer for the app's own log stream.
 *
 * Mirrors the EngineLogScreen conventions: a chronological tail with follow/
 * pause, a level filter row, text search, and share/copy/clear header actions.
 * Backed by the in-memory ring buffer in `src/utils/appLogs.ts` (captured by
 * the logger's capture transport). Export text carries a diagnostics header
 * (app version, engine contract version, platform/OS, device model, app
 * uptime, entry count + time range).
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

  const listRef = useRef<FlatList<AppLogEntry>>(null);
  const versionRef = useRef(appLogBuffer.getVersion());

  // Poll the buffer; only re-render when the mutation version changed.
  useEffect(() => {
    const tick = () => {
      const version = appLogBuffer.getVersion();
      if (version === versionRef.current) return;
      versionRef.current = version;
      setRaw([...appLogBuffer.getEntries()]);
    };
    tick();
    const id = setInterval(tick, APP_LOG_POLL_MS);
    return () => clearInterval(id);
  }, []);

  const visible = useMemo(() => filterAppLogEntries(raw, filter), [raw, filter]);

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
      const text = buildAppDiagnosticsReport(visible);
      await Share.share({ title: t('title'), message: text });
    } catch (err) {
      log.warn('App-log share failed:', err);
      showToast(t('shareFailedToast'));
    }
  }, [visible, t, showToast]);

  const copy = useCallback(async () => {
    const ok = await copyAppLogEntries(visible);
    showToast(ok ? t('copiedToast') : t('copyFailedToast'));
  }, [visible, t, showToast]);

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

  const renderRow = ({ item }: { item: AppLogEntry }) => (
    <View style={styles.row} testID={`app-log-row-${item.id}`}>
      <ThemedText variant="muted" size={11} style={styles.rowTime}>
        {formatAppLogClock(item.timestamp)}
      </ThemedText>
      <ThemedText
        size={11}
        weight="medium"
        style={[styles.rowLevel, { color: levelColors[item.level] ?? theme.colors.text.secondary }]}
      >
        {item.level.toUpperCase()}
      </ThemedText>
      <View style={styles.rowBody}>
        {item.namespace ? (
          <ThemedText variant="accent" size={11}>
            {item.namespace}{' '}
          </ThemedText>
        ) : null}
        <ThemedText size={12} style={styles.rowMessage}>
          {item.message}
        </ThemedText>
      </View>
    </View>
  );

  return (
    <ThemedView style={styles.container}>
      <ScreenHeader
        title={t('title')}
        onBack={() => navigation.goBack()}
        right={
          <View style={styles.headerActions}>
            <TouchableOpacity
              onPress={() => setFollowing(prev => !prev)}
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
        ref={listRef}
        data={visible}
        keyExtractor={item => String(item.id)}
        renderItem={renderRow}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        initialNumToRender={30}
        maxToRenderPerBatch={40}
        windowSize={11}
        removeClippedSubviews
        onContentSizeChange={() => {
          if (following) listRef.current?.scrollToEnd({ animated: false });
        }}
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
  rowBody: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start' },
  rowMessage: { flexShrink: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
});

export default AppLogScreen;
