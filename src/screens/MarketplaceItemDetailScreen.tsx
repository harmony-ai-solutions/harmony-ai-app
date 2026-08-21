/**
 * MarketplaceItemDetailScreen — preview any marketplace item and Acquire it
 * (Buy for N SOULs or Get Free). On acquire, the delivered copy is
 * materialized (character clone → AIProfile; text/theme → My Library).
 */

import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Image,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../contexts/ThemeContext';
import { useToast } from '../contexts/AppToastContext';
import { useAuth } from '../contexts/AuthContext';
import { useAppAlert } from '../contexts/AppAlertContext';
import { ThemedView } from '../components/themed/ThemedView';
import { ScreenHeader } from '../components/themed/ScreenHeader';
import { ThemedButton } from '../components/themed/ThemedButton';
import { FreeBadge } from '../components/market/FreeBadge';
import { hexToRgba } from '../utils/colorUtils';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createDataURL } from '../database/base64';
import { getCachedListing, hasOwnedAsset } from '../database/repositories/marketplace';
import { acquireItem, MarketInsufficientError } from '../services/marketplace/acquireItem';
import { itemTypeIcon } from '../services/marketplace/marketplaceTypes';
import { formatSoulPrice } from '../services/MarketplacePurchaseService';
import type { RootStackParamList } from '../navigation/AppNavigator';

type RouteParams = RouteProp<RootStackParamList, 'MarketplaceItemDetail'>;

export const MarketplaceItemDetailScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<RouteParams>();
  const { listingId } = route.params;
  const { t } = useTranslation('market');
  const { theme } = useAppTheme();
  const { showToast } = useToast();
  const { showAlert } = useAppAlert();
  const { user } = useAuth();
  const { bottom: safeBottom } = useSafeAreaInsets();

  const [listing, setListing] = useState<any>(null);
  const [owned, setOwned] = useState(false);
  const [loading, setLoading] = useState(true);
  const [acquiring, setAcquiring] = useState(false);

  const load = useCallback(async () => {
    try {
      const cached = await getCachedListing(listingId);
      setListing(cached);
      setOwned(await hasOwnedAsset(listingId));
    } finally {
      setLoading(false);
    }
  }, [listingId]);

  React.useEffect(() => {
    load();
  }, [load]);

  const doAcquire = async () => {
    if (!listing) return;
    setAcquiring(true);
    try {
      await runAcquire();
    } catch (err) {
      if (err instanceof MarketInsufficientError) {
        showToast(t('insufficientBody'));
      } else if ((err as { name?: string })?.name === 'AuthExpiredError') {
        showToast(t('acquireAuthRequired'));
      } else {
        showToast(t('acquireFailed'));
      }
    } finally {
      setAcquiring(false);
      setOwned(true);
    }
  };

  /** The actual acquire + post-nav logic (extracted for the confirm dialog). */
  const runAcquire = async () => {
    if (!listing) return;
    const outcome = await acquireItem(listing.id, user?.id, {
        onInsufficient: () => {
          showToast(t('insufficientBody'));
        },
      });

      // Post-acquire navigation.
      if (outcome.dest === 'character' && outcome.profileId) {
        showToast(
          (t('acquireSuccess')).replace('{{name}}', listing.title),
        );
        navigation.navigate('AIProfile', { profileId: outcome.profileId });
      } else {
        showToast(
          (outcome.status === 'free' ? t('freeSuccess') : t('acquireSuccess')).replace('{{name}}', listing.title),
        );
        navigation.navigate('MyLibrary');
      }
  };

  const handleAcquire = async () => {
    if (!listing) return;
    // Paid items → confirm first; free items → straight in.
    if (listing.priceSouls > 0) {
      showAlert(
        t('acquireTitle').replace('{{name}}', listing.title),
        t('acquireBody')
          .replace('{{name}}', listing.title)
          .replace('{{priceText}}', `${formatSoulPrice(listing.priceSouls)} Souls`),
        [
          { text: t('buyCancel'), style: 'cancel' },
          { text: t('acquireConfirm').replace('{{price}}', formatSoulPrice(listing.priceSouls)), onPress: doAcquire },
        ],
        { icon: 'storefront-outline', blockBackdropDismiss: true },
      );
      return;
    }
    await doAcquire();
  };
  if (!theme) return null;
  const accent = theme.colors.accent.primary;
  const baseHex = theme.colors.background.base;

  if (loading) {
    return (
      <ThemedView variant="base" style={styles.container}>
        <ScreenHeader title={t('title')} onBack={() => navigation.goBack()} />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={accent} />
        </View>
      </ThemedView>
    );
  }

  if (!listing) {
    return (
      <ThemedView variant="base" style={styles.container}>
        <ScreenHeader title={t('title')} onBack={() => navigation.goBack()} />
        <View style={styles.centered}>
          <Text style={{ color: theme.colors.text.muted }}>{t('noListingsTitle')}</Text>
        </View>
      </ThemedView>
    );
  }

  const priceText = listing.priceSouls > 0 ? formatSoulPrice(listing.priceSouls) : t('priceFree');
  const isSeller = listing.sellerUserId && listing.sellerUserId === user?.id;
  const isFree = listing.priceSouls === 0;

  return (
    <ThemedView variant="base" style={styles.container}>
      <ScreenHeader
        title={listing.title}
        subtitle={t('itemType' + cap(listing.itemType))}
        onBack={() => navigation.goBack()}
      />

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: safeBottom + 120 }]}>
        {/* Preview */}
        <View
          style={[
            styles.previewCard,
            { backgroundColor: hexToRgba(baseHex, 0.5), borderColor: hexToRgba(accent, 0.25) },
          ]}
        >
          <View style={[styles.previewMedia, { borderColor: hexToRgba(accent, 0.3) }]}>
            {listing.previewImageData && listing.previewMimeType ? (
              <Image
                source={{
                  uri: createDataURL(listing.previewImageData, listing.previewMimeType),
                }}
                style={styles.previewImage}
                resizeMode="cover"
              />
            ) : (
              <View style={[styles.previewIcon, { backgroundColor: hexToRgba(accent, 0.14) }]}>
                <Icon name={itemTypeIcon(listing.itemType)} size={40} color={accent} />
              </View>
            )}
            {/* Type tag overlay */}
            <View style={[styles.typeTag, { backgroundColor: 'rgba(11,11,16,0.78)' }]}>
              <Icon name={itemTypeIcon(listing.itemType)} size={11} color={accent} />
              <Text style={[styles.typeTagText, { color: accent }]}>
                {t('itemType' + cap(listing.itemType))}
              </Text>
            </View>
          </View>
          <Text style={[styles.price, { color: listing.priceSouls > 0 ? accent : '#2ea043' }]}>
            {priceText}
          </Text>
          {isFree ? <FreeBadge label={t('listFree')} /> : null}
        </View>

        {/* Summary */}
        {listing.summary ? (
          <Text style={[styles.summary, { color: theme.colors.text.primary }]}>
            {listing.summary}
          </Text>
        ) : null}

        {/* Tags */}
        {listing.tags?.length > 0 && (
          <View style={styles.tags}>
            {listing.tags.slice(0, 6).map((tag: string) => (
              <View
                key={tag}
                style={[styles.tag, { borderColor: hexToRgba(accent, 0.3) }]}
              >
                <Text style={[styles.tagText, { color: theme.colors.text.muted }]}>{tag}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Preview text / unlock hint */}
        {listing.previewText ? (
          <View
            style={[
              styles.textPreview,
              { backgroundColor: hexToRgba(baseHex, 0.4), borderColor: hexToRgba(accent, 0.2) },
            ]}
          >
            <Text style={[{ color: theme.colors.text.muted, fontSize: 14 }]}>
              {listing.previewText}
              {!owned && listing.priceSouls > 0 ? '…' : ''}
            </Text>
            {!owned && listing.priceSouls > 0 ? (
              <Text style={[styles.unlockHint, { color: theme.colors.text.disabled }]}>
                {t('unlockHint')}
              </Text>
            ) : null}
          </View>
        ) : null}

        <Text style={[styles.meta, { color: theme.colors.text.muted }]}>
          {t('salesCountLabel', { count: listing.salesCount })}
        </Text>
      </ScrollView>

      {/* Sticky acquire bar */}
      <View style={[styles.acquireBar, { paddingBottom: safeBottom + 12 }]}>
        {owned ? (
          <ThemedButton
            label={isSeller ? t('sellerLabel') : t('ownLabel')}
            variant="secondary"
            icon="check"
            onPress={() => navigation.goBack()}
          />
        ) : (
          <ThemedButton
            label={
              acquiring
                ? '...'
                : isFree
                  ? t('acquireFreeConfirm')
                  : t('acquireConfirm').replace('{{price}}', formatSoulPrice(listing.priceSouls))
            }
            variant={isFree ? 'secondary' : 'primary'}
            icon={isFree ? 'gift-outline' : 'cart-outline'}
            disabled={acquiring}
            onPress={handleAcquire}
          />
        )}
      </View>
    </ThemedView>
  );
};

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default MarketplaceItemDetailScreen;

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    padding: 20,
  },
  previewCard: {
    borderRadius: 20,
    borderWidth: 1,
    paddingVertical: 30,
    alignItems: 'center',
    marginBottom: 16,
  },
  previewIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  previewMedia: {
    width: '100%',
    aspectRatio: 3 / 4,
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    marginBottom: 12,
  },
  previewImage: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
  },
  typeTag: {
    position: 'absolute',
    bottom: 10,
    left: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  typeTagText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.3 },
  price: {
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 6,
  },
  summary: {
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 12,
  },
  tags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  tag: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  tagText: { fontSize: 12, fontWeight: '600' },
  textPreview: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    marginBottom: 12,
  },
  unlockHint: {
    marginTop: 8,
    fontSize: 12,
    fontStyle: 'italic',
  },
  meta: {
    fontSize: 13,
    marginTop: 4,
  },
  acquireBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 20,
    paddingTop: 12,
    backgroundColor: 'rgba(10,10,14,0.85)',
  },
});