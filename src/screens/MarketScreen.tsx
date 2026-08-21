/**
 * MarketScreen — SOUL Marketplace
 *
 * Browse AI characters that creators have listed for sale. Each listing shows
 * the character's portrait + SOUL price. Tapping a card opens the character's
 * public AI profile (viewing is always free); the Chat button runs the
 * purchase gate — chatting with a marketplace character requires buying it
 * with SOULs (one-time purchase, permanent access).
 *
 * The user's SOUL balance is shown in the header badge.
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  TextInput,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../contexts/ThemeContext';
import { useToast } from '../contexts/AppToastContext';
import { useAuth } from '../contexts/AuthContext';
import { ThemedView } from '../components/themed/ThemedView';
import { ThemedEmptyState } from '../components/themed/ThemedEmptyState';
import { ScreenHeader } from '../components/themed/ScreenHeader';
import { SoulBalanceDropdown } from '../components/market/SoulBalanceDropdown';
import { MarketListingCard } from '../components/market/MarketListingCard';
import { HeaderMenuButton } from '../components/navigation/HeaderMenuButton';
import { HeaderNotificationButton } from '../components/navigation/HeaderNotificationButton';
import { TAB_BAR_CONTENT_PAD } from '../components/navigation/GlassTabBar';
import { hexToRgba } from '../utils/colorUtils';
import { hapticLightPress } from '../utils/haptics';
import { createLogger } from '../utils/logger';
import {
  getMarketplaceCharacterProfiles,
  getSoulBalance,
  type MarketplaceListingWithProfile,
} from '../database/repositories/marketplace';
import { getCharacterImages } from '../database/repositories/characters';
import { createDataURL } from '../database/base64';
import { filterBlockedCharacterProfiles } from '../database/repositories/blockedContent';
import { openCharacterChat } from '../services/CharacterChatService';
import {
  isChatLocked,
  canChatWithProfile,
} from '../services/MarketplacePurchaseService';

const log = createLogger('[MarketScreen]');

export const MarketScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { theme } = useAppTheme();
  const { showToast } = useToast();
  const { user } = useAuth();
  const { t } = useTranslation('market');
  const { bottom: safeBottom } = useSafeAreaInsets();

  const [listings, setListings] = useState<MarketplaceListingWithProfile[]>([]);
  const [primaryImages, setPrimaryImages] = useState<Record<string, string | null>>({});
  const [canChatMap, setCanChatMap] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState('');
  const [balance, setBalance] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [chattingId, setChattingId] = useState<string | null>(null);

  const loadMarketplace = useCallback(async () => {
    try {
      let data = await getMarketplaceCharacterProfiles();
      // Hide marketplace listings created by blocked users.
      data = await filterBlockedCharacterProfiles(data);
      setListings(data);

      // Load primary image + chat-access per listing in parallel
      const imageMap: Record<string, string | null> = {};
      const chatMap: Record<string, boolean> = {};
      await Promise.all(
        data.map(async listing => {
          try {
            const images = await getCharacterImages(listing.profileId);
            const primary = images.find(img => img.is_primary === true);
            imageMap[listing.profileId] = primary
              ? createDataURL(primary.image_data, primary.mime_type)
              : null;
          } catch {
            imageMap[listing.profileId] = null;
          }
          try {
            chatMap[listing.profileId] = await canChatWithProfile(
              listing.profileId,
              user?.id,
            );
          } catch {
            chatMap[listing.profileId] = false;
          }
        }),
      );
      setPrimaryImages(imageMap);
      setCanChatMap(chatMap);

      const bal = await getSoulBalance();
      setBalance(bal);
    } catch (err) {
      log.error('Failed to load marketplace:', err);
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  }, [user?.id]);

  // Reload on focus so new listings + balance reflect immediately
  useFocusEffect(
    useCallback(() => {
      loadMarketplace();
    }, [loadMarketplace]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadMarketplace();
    setRefreshing(false);
  }, [loadMarketplace]);

  const handleOpenProfile = (profileId: string) => {
    navigation.navigate('AIProfile', { profileId });
  };

  const handleChat = async (listing: MarketplaceListingWithProfile) => {
    if (chattingId === listing.profileId) return;
    setChattingId(listing.profileId);
    try {
      // HARD GATE (payment not implemented yet): marketplace-listed characters
      // that the user has not purchased (and does not own) are locked — the
      // Chat tap is silently ignored so the chat screen can never be reached.
      if (await isChatLocked(listing.profileId, user?.id)) {
        return;
      }
      await openCharacterChat(
        listing.profile,
        {
          navigateToChat: params => navigation.navigate('ChatDetail', params),
        },
        user?.id,
      );
    } catch (err) {
      log.error('Failed to open chat:', err);
      showToast(t('chatOpenFailed'));
    } finally {
      setChattingId(null);
    }
  };

  if (!theme) return null;

  const accent = theme.colors.accent.primary;
  const baseHex = theme.colors.background.base;
  const inputBg = hexToRgba(baseHex, 0.55);

  const filtered = query.trim()
    ? listings.filter(l =>
        l.profile.name.toLowerCase().includes(query.trim().toLowerCase()),
      )
    : listings;

  return (
    <ThemedView variant="base" style={styles.container}>
      {/* ── Header + balance badge + search bar ── */}
      <ScreenHeader
        title={t('title')}
        subtitle={t('subtitle')}
        right={
          <View style={styles.headerRightRow}>
            <HeaderNotificationButton />
            <HeaderMenuButton />
          </View>
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
      </ScreenHeader>

      <FlatList
        style={styles.list}
        data={filtered}
        keyExtractor={item => item.profileId}
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
            colors={[theme.colors.accent.primary]}
            tintColor={theme.colors.accent.primary}
            progressBackgroundColor={theme.colors.background.surface}
          />
        }
        ListEmptyComponent={
          isLoading ? (
            <View style={styles.centered}>
              <ActivityIndicator size="large" color={theme.colors.accent.primary} />
            </View>
          ) : (
            <ThemedEmptyState
              icon={query ? 'file-search-outline' : 'storefront-outline'}
              title={query ? t('noResultsTitle', { query }) : t('noListingsTitle')}
              subtitle={query ? t('noResultsHint', { query }) : t('noListingsHint')}
              style={styles.emptyOverlay}
            />
          )
        }
        renderItem={({ item }) => (
          <MarketListingCard
            profile={item.profile}
            imageUri={primaryImages[item.profileId] ?? null}
            priceSouls={item.priceSouls}
            canChat={canChatMap[item.profileId] ?? false}
            onPress={() => handleOpenProfile(item.profileId)}
            onChatPress={() => handleChat(item)}
          />
        )}
      />
    </ThemedView>
  );
};

const styles = StyleSheet.create({
  headerRightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  container: {
    flex: 1,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  columnWrapper: {
    justifyContent: 'space-between',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyOverlay: {
    width: '100%',
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
});

export default MarketScreen;
