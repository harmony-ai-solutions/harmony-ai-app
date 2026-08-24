/**
 * MyListingsScreen — the user's published marketplace items: edit / delist /
 * re-list, sales counts, price or Free. Data from MarketplaceService.getMyListings().
 */
import React, { useCallback, useState } from 'react';
import { FlatList, View, StyleSheet, ActivityIndicator } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useAppTheme } from '../contexts/ThemeContext';
import { useToast } from '../contexts/AppToastContext';
import { useAppAlert } from '../contexts/AppAlertContext';
import { ThemedView } from '../components/themed/ThemedView';
import { ScreenHeader } from '../components/themed/ScreenHeader';
import { ThemedEmptyState } from '../components/themed/ThemedEmptyState';
import { ListingManageRow } from '../components/market/ListingManageRow';
import { ThemedButton } from '../components/themed/ThemedButton';
import {
  getMyListings,
  delistListing,
  type MarketplaceListingSummary,
} from '../services/marketplace/MarketplaceService';

export const MyListingsScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { t } = useTranslation('market');
  const { theme } = useAppTheme();
  const { showToast } = useToast();
  const { showAlert } = useAppAlert();

  const [listings, setListings] = useState<MarketplaceListingSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setListings(await getMyListings());
    } catch {
      setListings([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const handleToggleStatus = async (listing: MarketplaceListingSummary) => {
    const isActive = listing.status === 'active' || listing.status === 'pending';
    if (isActive) {
      // Delist → soft-delete (status 'removed') via the stub backend.
      try {
        await delistListing(listing.id);
        setListings(prev =>
          prev.map(p => (p.id === listing.id ? { ...p, status: 'removed' as const } : p)),
        );
        showToast(t('delist'));
      } catch {
        showToast(t('publishFailed'));
      }
      return;
    }
    // Re-list: the stub backend has no re-activation API — honest error.
    showToast(t('relistUnavailablePreview'));
  };

  const confirmDelist = (listing: MarketplaceListingSummary) => {
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
            itemType="character"
            priceSouls={item.priceSouls}
            status={item.status}
            t={t}
            onEdit={() => navigation.navigate('MarketplacePublish', { listingId: item.id })}
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