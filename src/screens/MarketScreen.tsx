/**
 * MarketScreen — Soul Market & Community Hub (Coming Soon)
 *
 * A premium glassmorphism marketplace hub. Because the marketplace content
 * isn't live yet, the screen shows a "Coming Soon" state with a search bar
 * and feature preview cards for:
 *   - Database search
 *   - Prompt search
 *   - Buying Souls
 *   - Selling Souls
 *   - Image generation
 *   - Video generation
 *   - Call time
 *
 * The user's Soul balance is displayed as a badge at the top of the screen.
 * When the user types a query that matches nothing, a "no content yet"
 * state is shown (mirroring the Discover screen's 0-results overlay).
 */

import React, { useState, useCallback } from 'react';
import { View, StyleSheet, ScrollView, TextInput, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../contexts/ThemeContext';
import { ThemedView } from '../components/themed/ThemedView';
import { ThemedText } from '../components/themed/ThemedText';
import { ThemedCard } from '../components/themed/ThemedCard';
import { ThemedGradient } from '../components/themed/ThemedGradient';
import { ThemedEmptyState } from '../components/themed/ThemedEmptyState';
import { ScreenHeader } from '../components/themed/ScreenHeader';
import { SoulIcon } from '../components/market/SoulIcon';
import { HeaderMenuButton } from '../components/navigation/HeaderMenuButton';
import { TAB_BAR_CONTENT_PAD } from '../components/navigation/GlassTabBar';
import { hexToRgba } from '../utils/colorUtils';

interface MarketFeature {
  key: 'databases' | 'prompts' | 'buy' | 'sell' | 'imageGen' | 'videoGen' | 'callTime';
  icon: string;
}

const MARKET_FEATURES: MarketFeature[] = [
  { key: 'databases', icon: 'database-outline' },
  { key: 'prompts', icon: 'text-box-search-outline' },
  { key: 'buy', icon: 'plus-circle-outline' },
  // Sell uses minus-circle-outline — mirrors the Buy plus-circle for a
  // clean, professional +/− pairing.
  { key: 'sell', icon: 'minus-circle-outline' },
  { key: 'imageGen', icon: 'image-multiple-outline' },
  { key: 'videoGen', icon: 'video-outline' },
  { key: 'callTime', icon: 'phone-in-talk-outline' },
];

export const MarketScreen: React.FC = () => {
  const { theme } = useAppTheme();
  const { t } = useTranslation('market');
  const { bottom: safeBottom } = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    // Market content isn't live yet — a short delay simulates a refresh.
    setTimeout(() => setRefreshing(false), 800);
  }, []);

  if (!theme) return null;

  // ── Search state ────────────────────────────────────────────────────────
  // The market has no content yet, so ANY non-empty query always yields
  // zero results → show the "nothing here yet" empty state.
  const hasQuery = query.trim().length > 0;

  const accent = theme.colors.accent.primary;
  const baseHex = theme.colors.background.base;
  const inputBg = hexToRgba(baseHex, 0.55);

  return (
    <ThemedView variant="base" style={styles.container}>
      {/* ── Header + balance badge + search bar ── */}
      <ScreenHeader
        title={t('title')}
        subtitle={t('subtitle')}
        right={<HeaderMenuButton />}
        titleRight={
          <View style={styles.balanceBadge}>
            <SoulIcon size={18} />
            <ThemedText
              variant="primary"
              size={14}
              weight="bold"
              hierarchy="header"
              numberOfLines={1}
              style={styles.balanceText}
            >
              0
            </ThemedText>
            <ThemedText
              variant="muted"
              size={12}
              hierarchy="subtext"
              numberOfLines={1}
              style={styles.balanceLabel}
            >
              {t('souls')}
            </ThemedText>
          </View>
        }
      >
        <View
          style={[
            styles.searchBar,
            { backgroundColor: inputBg, borderColor: hexToRgba(accent, 0.25) },
          ]}
        >
          <Icon
            name="magnify"
            size={20}
            color={theme.colors.text.muted}
            style={styles.searchIcon}
          />
          <TextInput
            style={[styles.searchInput, { color: theme.colors.text.primary }]}
            placeholder={t('searchPlaceholder')}
            placeholderTextColor={theme.colors.text.disabled}
            value={query}
            onChangeText={setQuery}
            returnKeyType="search"
            autoCorrect={false}
          />
          {hasQuery && (
            <Icon
              name="close-circle"
              size={18}
              color={theme.colors.text.muted}
              onPress={() => setQuery('')}
              style={styles.clearIcon}
            />
          )}
        </View>
      </ScreenHeader>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: TAB_BAR_CONTENT_PAD + safeBottom },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[theme.colors.accent.primary]}
            tintColor={theme.colors.accent.primary}
            progressBackgroundColor={theme.colors.background.surface}
          />
        }
      >
        {/* ── Search state: query with no content ─────────────────────────── */}
        {hasQuery ? (
          <ThemedEmptyState
            icon="file-search-outline"
            title={t('noResultsTitle')}
            subtitle={t('noResultsHint', { query })}
            style={styles.emptyState}
          />
        ) : (
          <>
            {/* ── Coming Soon hero card ── */}
            <ThemedCard accentStripe style={styles.heroCard}>
              <View style={styles.heroRow}>
                <View style={styles.heroIconWrap}>
                  <ThemedGradient gradient="primary" style={styles.heroIconRing}>
                    <ThemedView variant="elevated" style={styles.heroIconInner}>
                      <SoulIcon size={40} />
                    </ThemedView>
                  </ThemedGradient>
                  <View style={styles.soonBadge}>
                    <ThemedGradient gradient="primary" style={styles.soonBadgeBg}>
                      <ThemedText
                        variant="primary"
                        size={9}
                        weight="bold"
                        style={styles.soonBadgeText}
                      >
                        {t('comingSoonBadge')}
                      </ThemedText>
                    </ThemedGradient>
                  </View>
                </View>

                <View style={styles.heroText}>
                  <ThemedText
                    variant="primary"
                    size={20}
                    weight="bold"
                    hierarchy="header"
                  >
                    {t('comingSoonTitle')}
                  </ThemedText>
                  <ThemedText
                    variant="muted"
                    size={13}
                    hierarchy="subtext"
                    style={styles.heroDesc}
                  >
                    {t('comingSoonDescription')}
                  </ThemedText>
                </View>
              </View>
            </ThemedCard>

            {/* ── Feature preview cards ── */}
            <View style={styles.featuresGrid}>
              {MARKET_FEATURES.map(feature => (
                <ThemedCard key={feature.key} accentTint style={styles.featureCard}>
                  <View style={styles.featureTop}>
                    <View
                      style={[
                        styles.featureIconWrap,
                        { backgroundColor: hexToRgba(accent, 0.14) },
                      ]}
                    >
                      <Icon
                        name={feature.icon}
                        size={22}
                        color={theme.colors.accent.primary}
                      />
                    </View>
                    <ThemedGradient
                      gradient="primary"
                      style={styles.featureBadge}
                    >
                      <ThemedText
                        variant="primary"
                        size={9}
                        weight="bold"
                        style={styles.featureBadgeText}
                      >
                        {t('comingSoonBadge')}
                      </ThemedText>
                    </ThemedGradient>
                  </View>
                  <ThemedText
                    variant="primary"
                    size={15}
                    weight="bold"
                    hierarchy="header"
                    style={styles.featureTitle}
                  >
                    {t(`feature${feature.key.charAt(0).toUpperCase()}${feature.key.slice(1)}`)}
                  </ThemedText>
                  <ThemedText
                    variant="muted"
                    size={12}
                    hierarchy="subtext"
                    style={styles.featureDesc}
                  >
                    {t(
                      `feature${feature.key.charAt(0).toUpperCase()}${feature.key.slice(1)}Desc`,
                    )}
                  </ThemedText>
                </ThemedCard>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </ThemedView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  // ── Balance badge ─────────────────────────────────────────────────────
  balanceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    backgroundColor: 'rgba(0,0,0,0.22)',
    alignSelf: 'flex-start',
  },
  balanceText: {
    minWidth: 14,
  },
  balanceLabel: {
    opacity: 0.85,
  },
  // ── Search bar ─────────────────────────────────────────────────────────
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 14,
    height: 48,
    marginTop: 12,
    marginBottom: 8,
  },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: 0 },
  clearIcon: { marginLeft: 6 },
  // ── Empty state (search with no content) ──────────────────────────────
  emptyState: {
    width: '100%',
  },
  // ── Hero "Coming Soon" card ───────────────────────────────────────────
  heroCard: {
    marginBottom: 16,
  },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  heroIconWrap: {
    width: 96,
    height: 96,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroIconRing: {
    width: 92,
    height: 92,
    borderRadius: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroIconInner: {
    width: 84,
    height: 84,
    borderRadius: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  soonBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
  },
  soonBadgeBg: {
    borderRadius: 10,
    paddingVertical: 3,
    paddingHorizontal: 8,
  },
  soonBadgeText: {
    color: '#ffffff',
  },
  heroText: {
    flex: 1,
    gap: 6,
  },
  heroDesc: {
    lineHeight: 19,
  },
  // ── Feature cards ─────────────────────────────────────────────────────
  // NOTE: no `gap` here — two 48% cards + gap overflow 100% and force a
  // wrap, breaking the 2×2 grid (Buy Souls / Sell Souls must share a row).
  featuresGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  featureCard: {
    width: '48%',
    minHeight: 140,
    marginBottom: 12,
  },
  featureTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  featureIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureBadge: {
    borderRadius: 8,
    paddingVertical: 2,
    paddingHorizontal: 6,
  },
  featureBadgeText: {
    color: '#ffffff',
  },
  featureTitle: {
    marginBottom: 4,
  },
  featureDesc: {
    lineHeight: 17,
  },
});

export default MarketScreen;
