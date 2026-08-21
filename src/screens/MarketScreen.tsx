/**
 * MarketScreen — SOUL Marketplace catalog (any content type).
 *
 * Browse cached/cloud listings with category chips + search + free badges.
 * Character listings open their AI profile (or detail); other types open the
 * item detail with Buy/Get-Free.
 *
 * Data flow: cloud-first via MarketplaceApiService, fall back to the local
 * cache when offline / not signed in.
 */
import React, { useState, useCallback } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  TextInput,
  RefreshControl,
  ActivityIndicator,
  Pressable,
  Text,
  Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { ThemedView } from '../components/themed/ThemedView';
import { ThemedEmptyState } from '../components/themed/ThemedEmptyState';
import { ThemedButton } from '../components/themed/ThemedButton';
import { ScreenHeader } from '../components/themed/ScreenHeader';
import { SoulBalanceDropdown } from '../components/market/SoulBalanceDropdown';
import { FreeBadge } from '../components/market/FreeBadge';
import { MarketFilterDropdown } from '../components/market/MarketFilterDropdown';
import { MarketActionsMenu } from '../components/market/MarketActionsMenu';
import { TAB_BAR_CONTENT_PAD } from '../components/navigation/GlassTabBar';
import { hexToRgba } from '../utils/colorUtils';
import { hapticLightPress } from '../utils/haptics';
import { createLogger } from '../utils/logger';
import { createDataURL } from '../database/base64';
import {
  getCachedListings,
  getSoulBalance,
  type CachedListing,
} from '../database/repositories/marketplace';
import { applyMarketFilters } from '../utils/marketFilters';
import { itemTypeIcon } from '../services/marketplace/marketplaceTypes';
import { formatSoulPrice } from '../services/MarketplacePurchaseService';
import marketplaceApiService from '../services/marketplace/MarketplaceApiService';
import { listingDtoToCache } from '../services/marketplace/marketplaceTypes';

const log = createLogger('[MarketScreen]');

export const MarketScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { theme } = useAppTheme();
  const { status: authStatus } = useAuth();
  const { t } = useTranslation('market');
  const { bottom: safeBottom } = useSafeAreaInsets();

  const [listings, setListings] = useState<CachedListing[]>([]);
  const [query, setQuery] = useState('');
  const [activeChip, setActiveChip] = useState<string>('all');
  const [balance, setBalance] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [offline, setOffline] = useState(false);

  const loadMarket = useCallback(async () => {
    try {
      // Cloud-first (account-bound listings).
      try {
        const res = await marketplaceApiService.list({
          query,
          itemType: activeChip !== 'all' && activeChip !== 'free' ? (activeChip as any) : undefined,
          freeOnly: activeChip === 'free',
        });
        const rows = res.listings.map(listingDtoToCache);
        setListings(rows);
        setOffline(false);
      } catch {
        // Offline / not signed-in → cache fallback.
        const cached = await getCachedListings({
          query,
          itemType: activeChip !== 'all' && activeChip !== 'free' ? (activeChip as any) : undefined,
          freeOnly: activeChip === 'free',
        });
        setListings(cached);
        setOffline(true);
      }

      const bal = await getSoulBalance();
      setBalance(bal);
    } catch (err) {
      log.error('Failed to load marketplace:', err);
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  }, [query, activeChip]);

  useFocusEffect(
    useCallback(() => {
      loadMarket();
    }, [loadMarket]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadMarket();
    setRefreshing(false);
  }, [loadMarket]);

  const handleOpen = (listing: CachedListing) => {
    navigation.navigate('MarketplaceItemDetail', { listingId: listing.id });
  };

  if (!theme) return null;

  const accent = theme.colors.accent.primary;
  const baseHex = theme.colors.background.base;
  const inputBg = hexToRgba(baseHex, 0.55);

  const filtered = applyMarketFilters(listings, {
    query,
    itemType:
      activeChip !== 'all' && activeChip !== 'free'
        ? (activeChip as any)
        : undefined,
    freeOnly: activeChip === 'free',
  });

  return (
    <ThemedView variant="base" style={styles.container}>
      {/* ── Header + balance + search ── */}
      <ScreenHeader
        title={t('title')}
        subtitle={t('subtitle')}
        right={
          <MarketActionsMenu
            accent={accent}
            onPublish={() => navigation.navigate('MarketplacePublish', {})}
            onMyListings={() => navigation.navigate('MyListings')}
            onMyLibrary={() => navigation.navigate('MyLibrary')}
          />
        }
        titleRight={<SoulBalanceDropdown balance={balance} />}
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
          {query.length > 0 && (
            <Icon
              name="close-circle"
              size={18}
              color={theme.colors.text.muted}
              onPress={() => {
                hapticLightPress();
                setQuery('');
              }}
              style={styles.clearIcon}
            />
          )}
        </View>
        <MarketFilterDropdown value={activeChip} onChange={setActiveChip} t={t} />
      </ScreenHeader>

      <FlatList
        style={styles.list}
        data={filtered}
        keyExtractor={item => item.id}
        numColumns={2}
        columnWrapperStyle={filtered.length > 0 ? styles.columnWrapper : undefined}
        contentContainerStyle={[
          styles.listContent,
          { flexGrow: 1, paddingBottom: TAB_BAR_CONTENT_PAD + safeBottom },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[accent]}
            tintColor={accent}
            progressBackgroundColor={theme.colors.background.surface}
          />
        }
        ListEmptyComponent={
          isLoading ? (
            <View style={styles.centered}>
              <ActivityIndicator size="large" color={accent} />
            </View>
          ) : (
            <ThemedEmptyState
              icon={query || activeChip !== 'all' ? 'file-search-outline' : 'storefront-outline'}
              title={
                query || activeChip !== 'all'
                  ? t('noResultsTitle', { query })
                  : t('noListingsTitle')
              }
              subtitle={
                offline
                  ? authStatus === 'unauthenticated'
                    ? t('signInToBrowseBody')
                    : t('browseOffline')
                  : query
                    ? t('noResultsHint')
                    : t('noListingsHint')
              }
              action={
                offline && authStatus === 'unauthenticated' ? (
                  <ThemedButton
                    label={t('signInToBrowse')}
                    variant="secondary"
                    icon="account-outline"
                    onPress={() => navigation.navigate('Login')}
                  />
                ) : undefined
              }
              style={styles.emptyOverlay}
            />
          )
        }
        renderItem={({ item }) => (
          <GenericListingCard
            listing={item}
            accent={accent}
            onPress={() => handleOpen(item)}
          />
        )}
      />
    </ThemedView>
  );
};

// ── Generic listing card (any item type) ────────────────────────────────

function GenericListingCard({
  listing,
  accent,
  onPress,
}: {
  listing: CachedListing;
  accent: string;
  onPress: () => void;
}) {
  const { theme } = useAppTheme();
  if (!theme) return null;
  const isFree = listing.priceSouls === 0;
  const priceText = formatSoulPrice(listing.priceSouls);

  const photoUri =
    listing.previewImageData && listing.previewMimeType
      ? createDataURL(listing.previewImageData, listing.previewMimeType)
      : null;

  return (
    <Pressable onPress={onPress} style={styles.card}>
      <View
        style={[
          styles.cardPortrait,
          { backgroundColor: hexToRgba(accent, 0.14), borderColor: hexToRgba(accent, 0.25) },
        ]}
      >
        {photoUri ? (
          <Image source={{ uri: photoUri }} style={styles.cardImage} resizeMode="cover" />
        ) : (
          <Icon name={itemTypeIcon(listing.itemType)} size={34} color={accent} />
        )}
        {/* Type tag always over the card media */}
        <View style={[styles.cardTag, { backgroundColor: 'rgba(11,11,16,0.78)' }]}>
          <Icon name={itemTypeIcon(listing.itemType)} size={10} color={accent} />
          <Text style={[styles.cardTagText, { color: accent }]}>
            {capType(listing.itemType)}
          </Text>
        </View>
      </View>
      <View style={styles.cardMeta}>
        <View style={styles.cardTitleRow}>
          <Icon
            name={itemTypeIcon(listing.itemType)}
            size={13}
            color={theme.colors.text.muted}
            style={{ marginRight: 4 }}
          />
          <Text
            numberOfLines={1}
            style={[styles.cardTitle, { color: theme.colors.text.primary }]}
          >
            {listing.title}
          </Text>
        </View>
        {listing.summary ? (
          <Text
            numberOfLines={2}
            style={[styles.cardSummary, { color: theme.colors.text.muted }]}
          >
            {listing.summary}
          </Text>
        ) : null}
        <View style={styles.cardBottom}>
          {isFree ? (
            <FreeBadge />
          ) : (
            <View style={[styles.pricePill, { borderColor: hexToRgba(accent, 0.5) }]}>
              <Icon name="diamond-stone" size={11} color={accent} style={{ marginRight: 3 }} />
              <Text style={[styles.priceText, { color: accent }]}>{priceText}</Text>
            </View>
          )}
        </View>
      </View>
    </Pressable>
  );
}

// Pretty type label for the tag overlay (e.g. "Backstory", "Prompt").
function capType(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { flex: 1 },
  listContent: {
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  columnWrapper: {
    justifyContent: 'space-between',
    gap: 12,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyOverlay: { width: '100%' },
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
  card: {
    width: '48%',
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 14,
  },
  cardPortrait: {
    aspectRatio: 3 / 4,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    position: 'relative',
  },
  cardImage: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
  },
  cardTag: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
  },
  cardTagText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.3 },
  cardMeta: { padding: 8 },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  cardTitle: { flex: 1, fontSize: 14, fontWeight: '600' },
  cardSummary: { fontSize: 12, lineHeight: 16 },
  cardBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
  },
  pricePill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  priceText: { fontSize: 12, fontWeight: '700' },
});

export default MarketScreen;
