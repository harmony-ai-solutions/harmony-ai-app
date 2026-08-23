/**
 * MarketplacePublishScreen — publish ANY content on the marketplace for a
 * SOUL price or free. Wizard steps: type → source → details → preview/price.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Image,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { launchImageLibrary } from 'react-native-image-picker';
import { useAppTheme } from '../contexts/ThemeContext';
import { useToast } from '../contexts/AppToastContext';
import { useAuth } from '../contexts/AuthContext';
import { useBiometricLock } from '../contexts/BiometricLockContext';
import { ThemedView } from '../components/themed/ThemedView';
import { ScreenHeader } from '../components/themed/ScreenHeader';
import { ThemedButton } from '../components/themed/ThemedButton';
import { hexToRgba } from '../utils/colorUtils';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  MARKETPLACE_ITEM_TYPES,
  itemTypeIcon,
  itemTypeLabelKey,
  type MarketplaceItemType,
} from '../services/marketplace/marketplaceTypes';
import {
  buildCharacterSnapshot,
  craftCharacterPublish,
  craftTextPublish,
} from '../services/marketplace/itemSnapshots';
import marketplaceApiService from '../services/marketplace/MarketplaceApiService';
import {
  getUserCharacterProfiles,
  getCharacterProfile,
} from '../database/repositories/characters';
import {
  cacheListing,
  getCachedListing,
} from '../database/repositories/marketplace';
import { generateId } from '../utils/uuid';
import type { RootStackParamList } from '../navigation/AppNavigator';

type RouteParams = RouteProp<RootStackParamList, 'MarketplacePublish'>;

type Step = 'type' | 'source' | 'details' | 'preview';

export const MarketplacePublishScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<RouteParams>();
  const { t } = useTranslation('market');
  const { theme } = useAppTheme();
  const { showToast } = useToast();
  const { user } = useAuth();
  const { bottom: safeBottom } = useSafeAreaInsets();

  // Preload from AI Profile "Sell this character".
  const preloadProfileId = route.params?.profileId;
  // Edit mode — route has a listingId for an existing listing.
  const editListingId = route.params?.listingId ?? null;
  const isEdit = !!editListingId;

  const [step, setStep] = useState<Step>(isEdit ? 'details' : 'type');
  const [itemType, setItemType] = useState<MarketplaceItemType | null>(
    preloadProfileId ? 'character' : null,
  );
  const [characters, setCharacters] = useState<
    { id: string; name: string }[]
  >([]);
  const [sourceProfileId, setSourceProfileId] = useState<string | null>(
    preloadProfileId ?? null,
  );
  const [textMode, setTextMode] = useState<'fromCharacter' | 'scratch'>('fromCharacter');

  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [tags, setTags] = useState('');
  const [price, setPrice] = useState('');
  const [isFree, setIsFree] = useState(false);

  const [scratchText, setScratchText] = useState('');
  const [publishing, setPublishing] = useState(false);

  // ── Photo (listing thumbnail) ─────────────────────────────────────────
  const { withExternalFlow } = useBiometricLock();
  const [photoData, setPhotoData] = useState<string | null>(null);
  const [photoMime, setPhotoMime] = useState<string | null>(null);
  const [originalPayload, setOriginalPayload] = useState<unknown>(null);

  const handlePickPhoto = async () => {
    try {
      const result = await withExternalFlow(() =>
        launchImageLibrary({
          mediaType: 'photo',
          includeBase64: true,
          quality: 0.8,
        }),
      );
      if (result.assets && result.assets[0]?.base64) {
        const asset = result.assets[0];
        setPhotoData(asset.base64!);
        setPhotoMime(asset.type ?? 'image/jpeg');
      }
    } catch {
      // picker cancelled / failed — ignore
    }
  };

  // Load characters for the source step when the type is character/text.
  const loadCharacters = useCallback(async () => {
    try {
      const profiles = await getUserCharacterProfiles(false);
      setCharacters(profiles.map(p => ({ id: p.id, name: p.name })));
    } catch {
      setCharacters([]);
    }
  }, []);

  const startFlow = (type: MarketplaceItemType) => {
    setItemType(type);
    if (type === 'character' || type === 'backstory' || type === 'description' ||
        type === 'personality' || type === 'prompt' || type === 'dialogue') {
      loadCharacters();
    }
    setStep('source');
  };

  // ── Edit mode: prefill from the existing listing ──────────────────────
  useEffect(() => {
    if (!isEdit || !editListingId) return;
    (async () => {
      try {
        const listing = await getCachedListing(editListingId);
        if (!listing) return;
        setItemType(listing.itemType);
        setTitle(listing.title);
        setSummary(listing.summary ?? '');
        setTags(listing.tags.join(', '));
        setPrice(listing.priceSouls > 0 ? String(listing.priceSouls) : '');
        setIsFree(listing.priceSouls === 0);
        setPhotoData(listing.previewImageData);
        setPhotoMime(listing.previewMimeType);
        setOriginalPayload(listing.payloadJson);
      } catch {
        // ignore — stays on fresh publish defaults
      }
    })();
  }, [isEdit, editListingId]);

  const editableTextType =
    itemType === 'backstory' || itemType === 'description' ||
    itemType === 'personality' || itemType === 'prompt' || itemType === 'dialogue';

  const handlePublish = async () => {
    if (!itemType) return;
    setPublishing(true);
    try {
      let crafted;
      if (itemType === 'character') {
        const snapshot = await buildCharacterSnapshot(sourceProfileId!, user?.id);
        crafted = craftCharacterPublish(snapshot, {
          title,
          summary,
          tags: parseTags(tags),
          priceSouls: isFree ? 0 : Number(price) || 0,
        });
      } else if (editableTextType) {
        const text = textMode === 'scratch' ? scratchText : await getProfileField(sourceProfileId, itemType);
        crafted = craftTextPublish(text, itemType as any, {
          title,
          summary,
          tags: parseTags(tags),
          priceSouls: isFree ? 0 : Number(price) || 0,
        });
      } else {
        // theme & any structured asset — publish with a lightweight payload
        // (a real theme picker can extend payloadJson later).
        const label = t(itemTypeLabelKey(itemType));
        crafted = {
          itemType: itemType as MarketplaceItemType,
          title: title.trim() || label,
          summary: summary.trim() || null,
          tags: parseTags(tags),
          priceSouls: isFree ? 0 : Number(price) || 0,
          payloadJson: { type: itemType, label },
          previewImageData: photoData ?? null,
          previewMimeType: photoMime ?? null,
          previewText: summary.trim().slice(0, 200) || null,
        };
      }

      // Merge the user's chosen photo over any character/listing snapshot
      // image so a manually-picked photo is always used as the thumbnail.
      const finalImageData = photoData ?? crafted.previewImageData;
      const finalImageMime = photoMime ?? crafted.previewMimeType;

      const targetId = isEdit ? editListingId! : undefined;

      // ── EDIT MODE ─────────────────────────────────────────────────────
      if (isEdit && editListingId) {
        try {
          // Cloud update when available.
          try {
            await marketplaceApiService.update(editListingId, {
              item_type: crafted.itemType,
              title: crafted.title,
              summary: crafted.summary,
              tags: crafted.tags,
              price_souls: crafted.priceSouls,
              payload_json: crafted.payloadJson,
              preview_image_data: finalImageData,
              preview_mime_type: finalImageMime,
            });
          } catch {
            // backend not live → local update below
          }
          await cacheListing({
            id: editListingId,
            itemType: crafted.itemType,
            title: crafted.title,
            summary: crafted.summary,
            tags: crafted.tags,
            priceSouls: crafted.priceSouls,
            status: 'active',
            sellerUserId: user?.id ?? null,
            previewText: crafted.previewText,
            previewImageData: finalImageData,
            previewMimeType: finalImageMime,
            payloadJson: originalPayload ?? crafted.payloadJson,
          });
        } catch (err) {
          throw err;
        }
        showToast(t('snapshotUpdated'));
        navigation.goBack();
        return;
      }

      // ── CREATE MODE ───────────────────────────────────────────────────
      try {
        // Cloud publish (account-bound). When the backend isn't live yet
        // (or offline), fall back to a LOCAL listing so the item still
        // appears on the Market immediately.
        const dto = await marketplaceApiService.publish({
          item_type: crafted.itemType,
          title: crafted.title,
          summary: crafted.summary,
          tags: crafted.tags,
          price_souls: crafted.priceSouls,
          payload_json: crafted.payloadJson,
          preview_image_data: finalImageData,
          preview_mime_type: finalImageMime,
        });
        if (dto?.id) {
          await cacheListing({
            id: dto.id,
            itemType: crafted.itemType,
            title: crafted.title,
            summary: crafted.summary,
            tags: crafted.tags,
            priceSouls: crafted.priceSouls,
            status: 'active',
            sellerUserId: user?.id ?? null,
            previewText: crafted.previewText,
            previewImageData: finalImageData,
            previewMimeType: finalImageMime,
            payloadJson: crafted.payloadJson,
          });
        }
      } catch {
        // Backend unavailable → publish locally so it works on-device.
        await cacheListing({
          id: targetId ?? generateId(),
          itemType: crafted.itemType,
          title: crafted.title,
          summary: crafted.summary,
          tags: crafted.tags,
          priceSouls: crafted.priceSouls,
          status: 'active',
          sellerUserId: user?.id ?? null,
          previewText: crafted.previewText,
          previewImageData: finalImageData,
          previewMimeType: finalImageMime,
          payloadJson: crafted.payloadJson,
        });
      }

      showToast(t('publishSuccess'));
      navigation.goBack();
    } catch (err: any) {
      if (err?.name === 'AuthExpiredError') {
        showToast(t('publishAuthRequired'));
      } else {
        showToast(t('publishFailed'));
      }
    } finally {
      setPublishing(false);
    }
  };

  if (!theme) return null;
  const accent = theme.colors.accent.primary;
  const baseHex = theme.colors.background.base;
  const inputBg = hexToRgba(baseHex, 0.55);

  const renderTypeStep = () => (
    <ScrollView style={styles.flex} contentContainerStyle={styles.stepContent}>
      <Text style={[styles.stepTitle, { color: theme.colors.text.primary }]}>
        {t('sellStepType')}
      </Text>
      <View style={styles.typeGrid}>
        {MARKETPLACE_ITEM_TYPES.map(type => (
          <Pressable
            key={type}
            onPress={() => startFlow(type)}
            style={[
              styles.typeCard,
              { backgroundColor: hexToRgba(baseHex, 0.5), borderColor: hexToRgba(accent, 0.2) },
            ]}
          >
            <Icon name={itemTypeIcon(type)} size={26} color={accent} />
            <Text style={[styles.typeLabel, { color: theme.colors.text.primary }]}>
              {t(itemTypeLabelKey(type))}
            </Text>
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );

  const renderSourceStep = () => {
    if (itemType === 'character' || editableTextType) {
      if (characters.length === 0 && editableTextType) {
        return (
          <ScrollView style={styles.flex} contentContainerStyle={styles.stepContent}>
            <Text style={[styles.stepTitle, { color: theme.colors.text.primary }]}>
              {t('sellStepSource')}
            </Text>
            <Pressable
              onPress={() => setTextMode(textMode === 'scratch' ? 'fromCharacter' : 'scratch')}
              style={[styles.modeRow, { borderColor: hexToRgba(accent, 0.3) }]}
            >
              <Icon name={textMode === 'scratch' ? 'pencil-outline' : 'account-heart'} size={18} color={accent} />
              <Text style={[styles.modeText, { color: theme.colors.text.primary }]}>
                {textMode === 'scratch' ? t('writeFromScratch') : t('fromCharacter')}
              </Text>
            </Pressable>
            {textMode === 'scratch' ? (
              <TextInput
                multiline
                style={[styles.scratchInput, { backgroundColor: inputBg, borderColor: hexToRgba(accent, 0.25), color: theme.colors.text.primary }]}
                placeholder={t('summaryPlaceholder')}
                placeholderTextColor={theme.colors.text.disabled}
                value={scratchText}
                onChangeText={setScratchText}
              />
            ) : (
              <Text style={[styles.hint, { color: theme.colors.text.muted }]}>
                {t('noCharactersHint')}
              </Text>
            )}
          </ScrollView>
        );
      }
      return (
        <ScrollView style={styles.flex} contentContainerStyle={styles.stepContent}>
          <Text style={[styles.stepTitle, { color: theme.colors.text.primary }]}>
            {t('sellStepSource')}
          </Text>
          {characters.map(c => (
            <Pressable
              key={c.id}
              onPress={() => setSourceProfileId(c.id)}
              style={[styles.charRow, { borderColor: hexToRgba(accent, sourceProfileId === c.id ? 0.8 : 0.2) }]}
            >
              <Icon name="account-heart" size={18} color={accent} />
              <Text style={[styles.charName, { color: theme.colors.text.primary }]}>{c.name}</Text>
              {sourceProfileId === c.id ? (
                <Icon name="check-circle" size={18} color="#2ea043" />
              ) : null}
            </Pressable>
          ))}
          {editableTextType && (
            <>
              <Pressable
                onPress={() => setTextMode('scratch')}
                style={[styles.modeRow, { borderColor: hexToRgba(accent, 0.3) }]}
              >
                <Icon name="pencil-outline" size={18} color={accent} />
                <Text style={[styles.modeText, { color: theme.colors.text.primary }]}>
                  {t('writeFromScratch')}
                </Text>
              </Pressable>
              {textMode === 'scratch' && (
                <TextInput
                  multiline
                  style={[styles.scratchInput, { backgroundColor: inputBg, borderColor: hexToRgba(accent, 0.25), color: theme.colors.text.primary }]}
                  placeholder={t('summaryPlaceholder')}
                  placeholderTextColor={theme.colors.text.disabled}
                  value={scratchText}
                  onChangeText={setScratchText}
                />
              )}
            </>
          )}
        </ScrollView>
      );
    }
    // theme & other — placeholder
    return (
      <ScrollView style={styles.flex} contentContainerStyle={styles.stepContent}>
        <Text style={[styles.stepTitle, { color: theme.colors.text.primary }]}>
          {t('sellStepSource')}
        </Text>
        <Text style={[styles.hint, { color: theme.colors.text.muted }]}>
          {t('noCharactersHint')}
        </Text>
      </ScrollView>
    );
  };

  const renderDetailsStep = () => (
    <ScrollView style={styles.flex} contentContainerStyle={styles.stepContent}>
      <Text style={[styles.stepTitle, { color: theme.colors.text.primary }]}>
        {t('sellStepDetails')}
      </Text>
      <TextInput
        style={[styles.input, { backgroundColor: inputBg, borderColor: hexToRgba(accent, 0.25), color: theme.colors.text.primary }]}
        placeholder={t('titlePlaceholder')}
        placeholderTextColor={theme.colors.text.disabled}
        value={title}
        onChangeText={setTitle}
      />
      <TextInput
        style={[styles.input, { backgroundColor: inputBg, borderColor: hexToRgba(accent, 0.25), color: theme.colors.text.primary }]}
        placeholder={t('summaryPlaceholder')}
        placeholderTextColor={theme.colors.text.disabled}
        value={summary}
        onChangeText={setSummary}
        multiline
      />
      <TextInput
        style={[styles.input, { backgroundColor: inputBg, borderColor: hexToRgba(accent, 0.25), color: theme.colors.text.primary }]}
        placeholder={t('tagsPlaceholder')}
        placeholderTextColor={theme.colors.text.disabled}
        value={tags}
        onChangeText={setTags}
      />

      {/* ── Photo (editable right here — create AND edit) ─────────────── */}
      <Text style={[styles.sectionLabel, { color: theme.colors.text.primary }]}>
        {photoData ? t('changePhoto') : t('addPhoto')}
      </Text>
      <Pressable onPress={handlePickPhoto}>
        <View style={[styles.previewMedia, { borderColor: hexToRgba(accent, 0.3) }]}>
          {photoData && photoMime ? (
            <Image
              source={{ uri: `data:${photoMime};base64,${photoData}` }}
              style={styles.previewImage}
              resizeMode="cover"
            />
          ) : (
            <View style={[styles.previewIcon, { backgroundColor: hexToRgba(accent, 0.14) }]}>
              <Icon name={itemTypeIcon(itemType ?? 'character')} size={28} color={accent} />
            </View>
          )}
          {/* Type tag overlay */}
          <View style={[styles.typeTag, { backgroundColor: hexToRgba('#0b0b10', 0.78) }]}>
            <Icon name={itemTypeIcon(itemType ?? 'character')} size={11} color={accent} />
            <Text style={[styles.typeTagText, { color: accent }]}>
              {t(itemTypeLabelKey(itemType ?? 'backstory'))}
            </Text>
          </View>
          <View style={[styles.photoOverlayBadge, { backgroundColor: hexToRgba(accent, 0.85) }]}>
            <Icon name={photoData ? 'image-edit-outline' : 'image-plus'} size={16} color="#fff" />
          </View>
        </View>
      </Pressable>
    </ScrollView>
  );

  const renderPreviewStep = () => (
    <ScrollView style={styles.flex} contentContainerStyle={styles.stepContent}>
      <Text style={[styles.stepTitle, { color: theme.colors.text.primary }]}>
        {t('sellStepPreview')}
      </Text>

      <View style={[styles.previewCard, { backgroundColor: hexToRgba(baseHex, 0.5), borderColor: hexToRgba(accent, 0.25) }]}>
        {/* Photo (with type tag overlay) OR icon placeholder */}
        <View style={[styles.previewMedia, { borderColor: hexToRgba(accent, 0.3) }]}>
          {photoData && photoMime ? (
            <Image
              source={{ uri: `data:${photoMime};base64,${photoData}` }}
              style={styles.previewImage}
              resizeMode="cover"
            />
          ) : (
            <View style={[styles.previewIcon, { backgroundColor: hexToRgba(accent, 0.14) }]}>
              <Icon name={itemTypeIcon(itemType ?? 'character')} size={28} color={accent} />
            </View>
          )}
          {/* Type tag pinned over the photo */}
          <View style={[styles.typeTag, { backgroundColor: hexToRgba('#0b0b10', 0.78) }]}>
            <Icon name={itemTypeIcon(itemType ?? 'character')} size={11} color={accent} />
            <Text style={[styles.typeTagText, { color: accent }]}>
              {t(itemTypeLabelKey(itemType ?? 'backstory'))}
            </Text>
          </View>
        </View>

        {/* Add / change photo */}
        <Pressable
          onPress={handlePickPhoto}
          style={[styles.photoBtn, { borderColor: hexToRgba(accent, 0.4) }]}
        >
          <Icon name={photoData ? 'image-edit-outline' : 'image-plus'} size={16} color={accent} />
          <Text style={[styles.photoBtnText, { color: accent }]}>
            {photoData ? (isEdit ? t('changePhotoEdit') : t('changePhoto')) : t('addPhoto')}
          </Text>
        </Pressable>
        <Text style={[styles.previewTitle, { color: theme.colors.text.primary }]}>
          {title.trim() || (itemType === 'character' ? characters.find(c => c.id === sourceProfileId)?.name : t('itemType' + cap(itemType ?? 'backstory')))}
        </Text>
        {summary.trim() ? (
          <Text style={[styles.previewSummary, { color: theme.colors.text.muted }]} numberOfLines={2}>
            {summary}
          </Text>
        ) : null}
        {isFree || price === '0' ? (
          <Text style={[styles.freeText, { color: '#2ea043' }]}>{t('listFree')}</Text>
        ) : (
          <Text style={[styles.priceText, { color: accent }]}>
            {t('souls')}: {price || '0'}
          </Text>
        )}
      </View>

      {/* Price + Free toggle */}
      <View style={[styles.priceCard, { backgroundColor: inputBg, borderColor: hexToRgba(accent, 0.25) }]}>
        <Text style={[styles.priceLabel, { color: theme.colors.text.primary }]}>{t('priceLabel')}</Text>
        <View style={styles.priceRow}>
          <TextInput
            style={[styles.priceInput, { color: theme.colors.text.primary }]}
            keyboardType="numeric"
            value={price}
            onChangeText={setPrice}
            editable={!isFree}
            placeholder="0"
            placeholderTextColor={theme.colors.text.disabled}
          />
          <Pressable
            onPress={() => setIsFree(v => !v)}
            style={[styles.freeToggle, isFree && { backgroundColor: 'rgba(46,160,67,0.2)', borderColor: '#2ea043' }]}
          >
            <Icon name={isFree ? 'check' : 'gift-outline'} size={16} color={isFree ? '#2ea043' : theme.colors.text.muted} />
            <Text style={[styles.freeToggleText, { color: isFree ? '#2ea043' : theme.colors.text.muted }]}>
              {t('freeToggle')}
            </Text>
          </Pressable>
        </View>
      </View>
    </ScrollView>
  );

  const canContinue =
    step === 'type'
      ? !!itemType
      : step === 'source'
        ? itemType === 'character'
          ? !!sourceProfileId
          : editableTextType
            ? textMode === 'scratch'
              ? scratchText.trim().length > 0
              : !!sourceProfileId
            : false
        : step === 'details'
          ? (title.trim().length > 0 || !!sourceProfileId || textMode === 'scratch')
          : true;

  // ── EDIT MODE: a single scrollable form (details + photo + price + Save) ──
  const renderEditForm = () => (
    <ScrollView style={styles.flex} contentContainerStyle={[styles.stepContent, { paddingBottom: safeBottom + 140 }]}>
      <Text style={[styles.stepTitle, { color: theme.colors.text.primary }]}>
        {t('sellStepDetails')}
      </Text>

      <TextInput
        style={[styles.input, { backgroundColor: inputBg, borderColor: hexToRgba(accent, 0.25), color: theme.colors.text.primary }]}
        placeholder={t('titlePlaceholder')}
        placeholderTextColor={theme.colors.text.disabled}
        value={title}
        onChangeText={setTitle}
      />
      <TextInput
        style={[styles.input, { backgroundColor: inputBg, borderColor: hexToRgba(accent, 0.25), color: theme.colors.text.primary }]}
        placeholder={t('summaryPlaceholder')}
        placeholderTextColor={theme.colors.text.disabled}
        value={summary}
        onChangeText={setSummary}
        multiline
      />
      <TextInput
        style={[styles.input, { backgroundColor: inputBg, borderColor: hexToRgba(accent, 0.25), color: theme.colors.text.primary }]}
        placeholder={t('tagsPlaceholder')}
        placeholderTextColor={theme.colors.text.disabled}
        value={tags}
        onChangeText={setTags}
      />

      {/* Photo (tap to change) */}
      <Text style={[styles.sectionLabel, { color: theme.colors.text.primary }]}>
        {photoData ? t('changePhoto') : t('addPhoto')}
      </Text>
      <Pressable onPress={handlePickPhoto}>
        <View style={[styles.previewMedia, { borderColor: hexToRgba(accent, 0.3) }]}>
          {photoData && photoMime ? (
            <Image
              source={{ uri: `data:${photoMime};base64,${photoData}` }}
              style={styles.previewImage}
              resizeMode="cover"
            />
          ) : (
            <View style={[styles.previewIcon, { backgroundColor: hexToRgba(accent, 0.14) }]}>
              <Icon name={itemTypeIcon(itemType ?? 'character')} size={28} color={accent} />
            </View>
          )}
          <View style={[styles.typeTag, { backgroundColor: hexToRgba('#0b0b10', 0.78) }]}>
            <Icon name={itemTypeIcon(itemType ?? 'character')} size={11} color={accent} />
            <Text style={[styles.typeTagText, { color: accent }]}>
              {t(itemTypeLabelKey(itemType ?? 'backstory'))}
            </Text>
          </View>
          <View style={[styles.photoOverlayBadge, { backgroundColor: hexToRgba(accent, 0.85) }]}>
            <Icon name={photoData ? 'image-edit-outline' : 'image-plus'} size={16} color="#fff" />
          </View>
        </View>
      </Pressable>

      {/* Price + free toggle */}
      <View style={[styles.priceCard, { backgroundColor: inputBg, borderColor: hexToRgba(accent, 0.25) }]}>
        <Text style={[styles.priceLabel, { color: theme.colors.text.primary }]}>{t('priceLabel')}</Text>
        <View style={styles.priceRow}>
          <TextInput
            style={[styles.priceInput, { color: theme.colors.text.primary }]}
            keyboardType="numeric"
            value={price}
            onChangeText={setPrice}
            editable={!isFree}
            placeholder="0"
            placeholderTextColor={theme.colors.text.disabled}
          />
          <Pressable
            onPress={() => setIsFree(v => !v)}
            style={[styles.freeToggle, isFree && { backgroundColor: 'rgba(46,160,67,0.2)', borderColor: '#2ea043' }]}
          >
            <Icon name={isFree ? 'check' : 'gift-outline'} size={16} color={isFree ? '#2ea043' : theme.colors.text.muted} />
            <Text style={[styles.freeToggleText, { color: isFree ? '#2ea043' : theme.colors.text.muted }]}>
              {t('freeToggle')}
            </Text>
          </Pressable>
        </View>
      </View>
    </ScrollView>
  );

  return (
    <ThemedView variant="base" style={styles.container}>
      <ScreenHeader
        title={isEdit ? t('editListingTitle') : t('sellTitle')}
        subtitle={isEdit ? t('editListingSubtitle') : t('sellSubtitle')}
        onBack={() => {
          // In edit mode, Back always leaves the screen back to My Listings.
          if (isEdit) {
            navigation.goBack();
            return;
          }
          if (step !== 'type') {
            setStep(step === 'source' ? 'type' : step === 'details' ? 'source' : 'details');
          } else {
            navigation.goBack();
          }
        }}
      />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={80}
      >
        {isEdit ? (
          renderEditForm()
        ) : (
          <>
            {step === 'type' && renderTypeStep()}
            {step === 'source' && renderSourceStep()}
            {step === 'details' && renderDetailsStep()}
            {step === 'preview' && renderPreviewStep()}
          </>
        )}

        <View style={[styles.actions, { paddingBottom: safeBottom + 12 }]}>
          {isEdit ? (
            <ThemedButton
              label={publishing ? '...' : t('saveChanges')}
              variant="primary"
              icon="content-save-outline"
              style={styles.flex}
              disabled={publishing}
              onPress={handlePublish}
            />
          ) : (
            <>
              {step !== 'type' && (
                <ThemedButton
                  label="← Back"
                  variant="ghost"
                  onPress={() => {
                    setStep(step === 'source' ? 'type' : step === 'details' ? 'source' : 'details');
                  }}
                  style={styles.backBtn}
                />
              )}
              {step !== 'preview' ? (
                <ThemedButton
                  label={step === 'type' ? t('itemTypeCharacter') : t('publish')}
                  variant="secondary"
                  style={styles.flex}
                  disabled={!canContinue}
                  onPress={() => {
                    if (step === 'type') setStep('source');
                    else if (step === 'source') setStep('details');
                    else if (step === 'details') setStep('preview');
                  }}
                />
              ) : (
                <ThemedButton
                  label={publishing ? '...' : t('publish')}
                  variant="primary"
                  icon="storefront-outline"
                  style={styles.flex}
                  disabled={publishing}
                  onPress={handlePublish}
                />
              )}
            </>
          )}
        </View>
      </KeyboardAvoidingView>
      {publishing && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color={accent} />
        </View>
      )}
    </ThemedView>
  );
};

// ── Helpers ─────────────────────────────────────────────────────────────

function parseTags(raw: string): string[] {
  return raw
    .split(',')
    .map(x => x.trim())
    .filter(Boolean);
}

async function getProfileField(
  profileId: string | null,
  itemType: MarketplaceItemType,
): Promise<string> {
  if (!profileId) return '';
  const profile = await getCharacterProfile(profileId);
  if (!profile) return '';
  switch (itemType) {
    case 'description':
      return profile.description ?? '';
    case 'personality':
      return profile.personality ?? '';
    case 'prompt':
      return profile.base_prompt ?? '';
    case 'dialogue':
      return profile.mes_example ?? '';
    default:
      return '';
  }
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default MarketplacePublishScreen;

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  stepContent: { padding: 20 },
  stepTitle: {
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 16,
  },
  typeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  typeCard: {
    width: '48%',
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 20,
    alignItems: 'center',
    marginBottom: 10,
  },
  typeLabel: {
    marginTop: 8,
    fontSize: 13,
    fontWeight: '600',
  },
  charRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 8,
  },
  charName: { flex: 1, fontSize: 15, fontWeight: '600' },
  modeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    marginTop: 4,
  },
  modeText: { fontSize: 14, fontWeight: '600' },
  scratchInput: {
    marginTop: 12,
    minHeight: 120,
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    textAlignVertical: 'top',
  },
  hint: { fontSize: 14, marginTop: 8 },
  input: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    marginBottom: 10,
    fontSize: 14,
  },
  previewCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    alignItems: 'center',
    marginBottom: 16,
  },
  previewIcon: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  previewMedia: {
    width: '100%',
    aspectRatio: 3 / 4,
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
    marginBottom: 12,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
    marginTop: 12,
  },
  photoOverlayBadge: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
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
  photoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 9,
    paddingHorizontal: 14,
    marginBottom: 12,
  },
  photoBtnText: { fontSize: 13, fontWeight: '600' },
  previewTitle: { fontSize: 17, fontWeight: '700', textAlign: 'center' },
  previewSummary: { fontSize: 13, textAlign: 'center', marginTop: 6 },
  priceText: { fontSize: 15, fontWeight: '700', marginTop: 8 },
  freeText: { fontSize: 15, fontWeight: '700', marginTop: 8 },
  priceCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
  },
  priceLabel: { fontSize: 14, fontWeight: '600', marginBottom: 8 },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  priceInput: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    borderWidth: 1,
    borderColor: 'transparent',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 12,
  },
  freeToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(128,128,128,0.3)',
  },
  freeToggleText: { fontSize: 13, fontWeight: '600' },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  backBtn: { paddingHorizontal: 8 },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
});