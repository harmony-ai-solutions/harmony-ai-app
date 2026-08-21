/**
 * MyListingsScreen — the user's published marketplace items: edit / delist /
 * re-list, sales counts, price or Free.
 */
import React, { useCallback, useState } from 'react';
import { FlatList, View, StyleSheet, ActivityIndicator } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useAppTheme } from '../contexts/ThemeContext';
import { useToast } from '../contexts/AppToastContext';
import { useAppAlert } from '../contexts/AppAlertContext';
import { useAuth } from '../contexts/AuthContext';
import { ThemedView } from '../components/themed/ThemedView';
import { ScreenHeader } from '../components/themed/ScreenHeader';
import { ThemedEmptyState } from '../components/themed/ThemedEmptyState';
import { ListingManageRow } from '../components/market/ListingManageRow';
import { ThemedButton } from '../components/themed/ThemedButton';
import marketplaceApiService from '../services/marketplace/MarketplaceApiService';
import { listingDtoToCache } from '../services/marketplace/marketplaceTypes';
import {
  getCachedMyListings,
  setCachedListingStatus,
  type CachedListing,
} from '../database/repositories/marketplace';

export const MyListingsScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { t } = useTranslation('market');
  const { theme } = useAppTheme();
  const { showToast } = useToast();
  const { showAlert } = useAppAlert();
  const { user } = useAuth();

  const [listings, setListings] = useState<CachedListing[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      // Cloud-first; when the backend isn't live yet (or offline), fall back
      // to the locally-published listings so newly sold items appear here.
      try {
        const dto = await marketplaceApiService.getMine();
        setListings(dto.map(listingDtoToCache));
      } catch (err: any) {
        if (err?.name === 'AuthExpiredError') {
          // not fatal — still show local listings
        }
        if (user?.id) {
          const local = await getCachedMyListings(user.id);
          setListings(local);
        } else {
          setListings([]);
        }
      }
    } finally {
      setIsLoading(false);
    }
  }, [user?.id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const handleToggleStatus = async (listing: CachedListing) => {
    const next = listing.status === 'active' ? 'delisted' : 'active';
    try {
      // Cloud delist when possible; local status update as the source of
      // truth for local/offline listings (backend not live yet).
      try {
        if (next === 'delisted') {
          await marketplaceApiService.delist(listing.id);
        } else {
          await marketplaceApiService.update(listing.id, {});
        }
      } catch {
        // backend unavailable → local-only is fine
      }
      await setCachedListingStatus(listing.id, next);
      setListings(prev =>
        prev.map(p => (p.id === listing.id ? { ...p, status: next } : p)),
      );
      showToast(t(next === 'active' ? 'relist' : 'delist'));
    } catch {
      showToast(t('publishFailed'));
    }
  };

  const confirmDelist = (listing: CachedListing) => {
    showAlert(
      t('delist'),
      t('buyersKeepCopy'),
      [
        { text: t('buyCancel'), style: 'cancel' },
        {
          text: t('delist'),
          style: 'destructive',
          onPress: () => handleToggleStatus(listing),
        },
      ],
      { icon: 'close-circle-outline' },
    );
  };

  if (!theme) return null;

  return (
    <ThemedView variant="base" style={styles.container}>
      <ScreenHeader
        title={t('myListingsTitle')}
        onBack={() => navigation.goBack()}
        titleRight={
          <ThemedButton
            label={t('sell')}
            variant="secondary"
            icon="plus"
            onPress={() => navigation.navigate('MarketplacePublish', {})}
            style={styles.sellBtn}
          />
        }
      />
      <FlatList
        style={styles.list}
        data={listings}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          isLoading ? (
            <View style={styles.centered}>
              <ActivityIndicator size="large" color={theme.colors.accent.primary} />
            </View>
          ) : (
            <ThemedEmptyState
              icon="storefront-outline"
              title={t('listingsEmpty')}
              subtitle={t('listingsEmptyHint')}
            />
          )
        }
        renderItem={({ item }) => (
          <ListingManageRow
            title={item.title}
            itemType={item.itemType}
            priceSouls={item.priceSouls}
            status={item.status}
            salesCount={item.salesCount}
            t={t}
            onEdit={() => navigation.navigate('MarketplacePublish', { profileId: item.itemType === 'character' ? undefined : undefined, listingId: item.id })}
            onToggleStatus={() => confirmDelist(item)}
          />
        )}
      />
    </ThemedView>
  );
};

export default MyListingsScreen;

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { flex: 1 },
  listContent: { padding: 20 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 80,
  },
  sellBtn: { paddingHorizontal: 12 },
});