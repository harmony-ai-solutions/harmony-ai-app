/**
 * MemoriesTab — the AI's memory timeline (tts-voice-ux Phase 6, `Memories` tab).
 *
 * Reads `GET /api/entities/:id/memories` through the read-only `memories`
 * repository. Rows are grouped by `compaction_level` (L2 core first, then L1
 * summaries, then L0 raw) and newest-first inside each group; tapping a row
 * expands the full `content` in place.
 *
 * `emotional_state_bits` is an OPAQUE engine bitfield. It is NEVER decoded and
 * no emotion label is inferred from it — at most a neutral "emotional context"
 * dot marks its presence.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  SectionList,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import type { Memory } from '../../database/models';
import { getMemoriesForEntity } from '../../services/engine/repositories/memories';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedText } from '../themed/ThemedText';
import { hapticLightPress } from '../../utils/haptics';
import { createLogger } from '../../utils/logger';

const log = createLogger('[MemoriesTab]');

type LevelFilter = 'all' | 2 | 1 | 0;

interface MemorySection {
  level: number;
  title: string;
  data: Memory[];
}

/** Compact calendar date: "Nov 12" (year added when it is not this year). */
function formatMemoryDate(date: Date | null): string {
  if (!date) return '';
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return '';
  const sameYear = parsed.getFullYear() === new Date().getFullYear();
  return parsed.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

function levelLabelKey(level: number): string {
  if (level >= 2) return 'memoryLevelCore';
  if (level === 1) return 'memoryLevelSummary';
  return 'memoryLevelRaw';
}

export interface MemoriesTabProps {
  entityId: string | null;
  /** Bumped by the sheet when this tab is (re)focused. */
  refreshToken?: number;
}

export const MemoriesTab: React.FC<MemoriesTabProps> = ({ entityId, refreshToken }) => {
  const { theme } = useAppTheme();
  const { t } = useTranslation('chatDetail');

  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<LevelFilter>('all');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = useCallback(
    async (mode: 'initial' | 'refresh' | 'silent' = 'initial') => {
      if (!entityId) {
        setMemories([]);
        setLoading(false);
        return;
      }
      if (mode === 'initial') setLoading(true);
      if (mode === 'refresh') setRefreshing(true);
      try {
        const rows = await getMemoriesForEntity(entityId);
        setMemories(rows);
        setError(null);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.warn(`Memory read failed for ${entityId}:`, err);
        setError(message);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [entityId],
  );

  useEffect(() => {
    void load('initial');
  }, [load, refreshToken]);

  const toggleExpanded = useCallback((id: string) => {
    hapticLightPress();
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const sections = useMemo<MemorySection[]>(() => {
    const visible =
      filter === 'all'
        ? memories
        : memories.filter(memory => {
            const level = memory.compaction_level;
            if (filter === 2) return level >= 2;
            return level === filter;
          });

    const byLevel = new Map<number, Memory[]>();
    for (const memory of visible) {
      const level = memory.compaction_level;
      const bucket = byLevel.get(level) ?? [];
      bucket.push(memory);
      byLevel.set(level, bucket);
    }

    // L2 core first — the most compacted, longest-lived memories lead.
    return [...byLevel.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([level, rows]) => ({
        level,
        title: `L${level} · ${t(levelLabelKey(level))}`,
        data: [...rows].sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        ),
      }));
  }, [memories, filter, t]);

  if (!theme) return null;

  const renderDateRange = (memory: Memory): string => {
    if (memory.start_date && memory.end_date) {
      return `${formatMemoryDate(memory.start_date)} – ${formatMemoryDate(memory.end_date)}`;
    }
    if (memory.start_date) {
      return `${formatMemoryDate(memory.start_date)} – ${t('memoryNow')}`;
    }
    return formatMemoryDate(memory.created_at);
  };

  const filters: Array<{ key: LevelFilter; label: string }> = [
    { key: 'all', label: t('memoryLevelAll') },
    { key: 2, label: t('memoryLevelCore') },
    { key: 1, label: t('memoryLevelSummary') },
    { key: 0, label: t('memoryLevelRaw') },
  ];

  return (
    <View style={styles.container} testID="memories-tab">
      <View style={styles.filterRow}>
        {filters.map(item => {
          const selected = filter === item.key;
          return (
            <TouchableOpacity
              key={String(item.key)}
              onPress={() => setFilter(item.key)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              testID={`memory-filter-${String(item.key)}`}
              style={[
                styles.chip,
                {
                  borderColor: selected
                    ? theme.colors.accent.primary
                    : theme.colors.border.default,
                  backgroundColor: selected
                    ? theme.colors.accent.primary + '1A'
                    : 'transparent',
                },
              ]}
            >
              <ThemedText size={12} variant={selected ? 'accent' : 'primary'}>
                {item.label}
              </ThemedText>
            </TouchableOpacity>
          );
        })}
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={theme.colors.accent.primary} />
        </View>
      ) : sections.length === 0 ? (
        <View style={styles.centered}>
          <ThemedText variant="muted" size={13} style={styles.emptyText} testID="memory-empty">
            {error ? t('memoryLoadFailed') : t('memoryEmpty')}
          </ThemedText>
          {error ? (
            <TouchableOpacity
              onPress={() => void load('initial')}
              accessibilityRole="button"
              testID="memory-retry"
            >
              <ThemedText size={13} variant="accent">
                {t('common:retry')}
              </ThemedText>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={item => item.id}
          stickySectionHeadersEnabled={false}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void load('refresh')}
              colors={[theme.colors.accent.primary]}
              tintColor={theme.colors.accent.primary}
              progressBackgroundColor={theme.colors.background.surface}
            />
          }
          renderSectionHeader={({ section }) => (
            <ThemedText
              size={11}
              variant="muted"
              weight="medium"
              style={styles.sectionHeader}
              testID={`memory-section-${section.level}`}
            >
              {section.title}
            </ThemedText>
          )}
          renderItem={({ item }) => {
            const isExpanded = expanded.has(item.id);
            return (
              <TouchableOpacity
                onPress={() => toggleExpanded(item.id)}
                activeOpacity={0.75}
                accessibilityRole="button"
                accessibilityState={{ expanded: isExpanded }}
                accessibilityLabel={`${t(levelLabelKey(item.compaction_level))}: ${
                  item.content
                }`}
                testID={`memory-row-${item.id}`}
                style={[
                  styles.row,
                  {
                    backgroundColor: theme.colors.background.base + '66',
                    borderColor: theme.colors.border.default + '66',
                  },
                ]}
              >
                <View style={styles.rowHeader}>
                  <ThemedText size={11} variant="secondary">
                    {renderDateRange(item)}
                  </ThemedText>
                  <View style={styles.rowHeaderRight}>
                    {item.emotional_state_bits !== 0 && (
                      <View
                        style={[styles.contextDot, { backgroundColor: theme.colors.accent.primary }]}
                        accessibilityLabel={t('emotionalContext')}
                        testID={`memory-context-${item.id}`}
                      />
                    )}
                    <ThemedText size={11} variant="muted">
                      {isExpanded ? '−' : '+'}
                    </ThemedText>
                  </View>
                </View>
                <ThemedText
                  size={13}
                  numberOfLines={isExpanded ? undefined : 2}
                  testID={`memory-content-${item.id}`}
                >
                  {item.content}
                </ThemedText>
              </TouchableOpacity>
            );
          }}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexShrink: 1,
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
  },
  list: {
    flexShrink: 1,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  centered: {
    paddingHorizontal: 20,
    paddingVertical: 32,
    alignItems: 'center',
    gap: 8,
  },
  emptyText: {
    textAlign: 'center',
  },
  sectionHeader: {
    marginTop: 12,
    marginBottom: 6,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  row: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
  },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  rowHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  contextDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
});

export default MemoriesTab;
