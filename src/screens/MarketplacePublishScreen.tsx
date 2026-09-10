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
} from '../utils/marketTypes';
import {
  getUserCharacterProfiles,
  getCharacterProfile,
  getPrimaryImage,
} from '../database/repositories/characters';
import type { CharacterSnapshot } from '../services/marketplace/MarketplaceService';
import {
  publishListing,
  getListing,
  updateListing,
} from '../services/marketplace/MarketplaceService';
import {
  VisibilitySettingsSection,
  type VisibilityValue,
} from '../components/market/VisibilitySettingsSection';
import type { RootStackParamList } from '../navigation/AppNavigator';

type RouteParams = RouteProp<RootStackParamList, 'MarketplacePublish'>;

type Step = 'type' | 'source' | 'details' | 'preview';

export const MarketplacePublishScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<RouteParams>();
  const { t } = useTranslation('market');
  const { theme } = useAppTheme();
  const { showToast } = useToast();
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

  // Availability intent for the future backend's visibility contract
  // (20-Backend-Concept). Publishing from this screen ALWAYS creates
  // marketplace content, so the control initializes to 'marketplace' — the
  // private/public options represent the listing's availability intent and
  // are persisted here in the draft state. The stub backend currently
  // ignores them beyond the marketplace classification (it only understands
  // marketplace semantics), but the UI contract stays ready for the backend.
  const [visibility, setVisibility] = useState<VisibilityValue>('marketplace');

  // ── Photo (listing thumbnail) ─────────────────────────────────────────
  const { withExternalFlow } = useBiometricLock();
  const [photoData, setPhotoData] = useState<string | null>(null);
  const [photoMime, setPhotoMime] = useState<string | null>(null);

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
        const listing = await getListing(editListingId);
        setItemType('character');
        setTitle(listing.title);
        setSummary(listing.description);
        setTags(listing.tags.join(', '));
        setPrice(listing.priceSouls > 0 ? String(listing.priceSouls) : '');
        setIsFree(listing.priceSouls === 0);
        setPhotoData(listing.snapshot?.image_data ?? null);
        setPhotoMime(listing.snapshot?.image_mime ?? null);
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

    // ── Honest validation (no fake success — block before calling out) ──
    const priceSouls = isFree ? 0 : Number(price) || 0;
    if (!isFree && (!Number.isFinite(priceSouls) || priceSouls < 0)) {
      showToast(t('publishFailed'));
      return;
    }
    if (isEdit && !title.trim()) {
      showToast(t('publishFailed'));
      return;
    }

    setPublishing(true);
    try {
      // ── EDIT MODE ─────────────────────────────────────────────────────
      // Owner-only update via the stub (keeps status; never fake success).
      // The listing's kind is NOT editable through this form — updateListing
      // only touches title/description/price/tags/previewText.
      if (isEdit && editListingId) {
        await updateListing(editListingId, {
          title: title.trim(),
          description: summary.trim(),
          priceSouls,
          tags: parseTags(tags),
          previewText: summary.trim().slice(0, 200) || null,
        });
        showToast(t('snapshotUpdated'));
        navigation.goBack();
        return;
      }

      // ── CREATE MODE ───────────────────────────────────────────────────
      const description = summary.trim();

      if (itemType === 'character') {
        // Upload-copy (A4): freeze the local profile's card + primary image
        // into the draft; the local character is NEVER touched. sourceProfileId
        // links the listing back to the profile (chat-lock linkage).
        const snapshot = await buildSnapshot(sourceProfileId!, photoData, photoMime);
        await publishListing({
          title: title.trim() || snapshot.name,
          description,
          priceSouls,
          tags: parseTags(tags),
          cardSnapshot: snapshot,
          kind: 'character_card',
          sourceProfileId,
          previewText: description.slice(0, 200) || null,
        });
      } else if (editableTextType) {
        // Text listing — from a character field OR scratch (old wizard path).
        const text =
          textMode === 'scratch'
            ? scratchText.trim()
            : (await getProfileField(sourceProfileId, itemType)).trim();
        if (!text) {
          showToast(t('publishFailed'));
          return;
        }
        await publishListing({
          title: title.trim() || defaultTextTitle(itemType),
          description,
          priceSouls,
          tags: parseTags(tags),
          cardSnapshot: emptySnapshot(),
          kind: 'text',
          text,
          previewText: text.slice(0, 200) || null,
        });
      } else {
        // Theme & any structured asset — mirror the old lightweight payload
        // (a real theme picker can extend the payload later): the type label
        // becomes the delivered `text` payload.
        const label = t(itemTypeLabelKey(itemType));
        await publishListing({
          title: title.trim() || label,
          description,
          priceSouls,
          tags: parseTags(tags),
          cardSnapshot: emptySnapshot(),
          kind: 'theme',
          text: label,
          previewText: description.slice(0, 200) || null,
        });
      }

      showToast(t('publishSuccess'));
      navigation.goBack();
    } catch {
      // Transient 503s / 400 invalid drafts surface honestly — retryable.
      showToast(t('publishFailed'));
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

      {/* Visibility & Sharing — availability intent for the future backend.
          The listing published here IS marketplace content, so the section
          starts on Marketplace with the current price; the private/public
          options persist as draft-state classification (the stub ignores
          them beyond marketplace semantics — see VisibilitySettingsSection). */}
      <VisibilitySettingsSection
        value={visibility}
        onChange={setVisibility}
        priceSouls={isFree ? 0 : Number(price) || 0}
        onPriceChange={n => {
          setPrice(String(n));
          if (n > 0) setIsFree(false);
        }}
      />
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
            : true // theme & other — lightweight payload, nothing to pick
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

/**
 * Build the frozen character-card snapshot for a publish draft (upload-copy
 * semantics, A4). Reads the local profile + primary image; the local character
 * card is NEVER touched by the publish itself. A manually-picked photo
 * overrides the primary image so it is always used as the listing thumbnail.
 */
async function buildSnapshot(
  profileId: string,
  photoData: string | null,
  photoMime: string | null,
): Promise<CharacterSnapshot> {
  const profile = await getCharacterProfile(profileId);
  if (!profile) {
    throw new Error('character_profile_not_found');
  }

  let imageData: string | null = null;
  let imageMime: string | null = null;
  try {
    const primary = await getPrimaryImage(profileId);
    if (primary) {
      imageData = primary.image_data;
      imageMime = primary.mime_type;
    }
  } catch {
    // image is optional
  }

  return {
    name: profile.name,
    description: profile.description,
    personality: profile.personality,
    base_prompt: profile.base_prompt,
    scenario: profile.scenario,
    mes_example: profile.mes_example ?? '',
    voice_characteristics: profile.voice_characteristics,
    typing_speed_wpm: profile.typing_speed_wpm,
    audio_response_chance_percent: profile.audio_response_chance_percent,
    image_data: photoData ?? imageData,
    image_mime: photoMime ?? imageMime,
  };
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Extract a single text field from a character profile for a text listing
 * (restored old wizard path). `backstory` was a profile-description publish;
 * description/personality/prompt/dialogue map to the profile columns.
 */
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

/** Default title for a text listing when the user leaves the title empty. */
function defaultTextTitle(type: MarketplaceItemType): string {
  switch (type) {
    case 'backstory':
      return 'Backstory';
    case 'description':
      return 'Description';
    case 'personality':
      return 'Personality';
    case 'prompt':
      return 'Prompt';
    case 'dialogue':
      return 'Example Dialogues';
    default:
      return 'Content';
  }
}

/**
 * Blank frozen card for text/theme listings. The stub stores a `cardSnapshot`
 * on every listing record, but a text/theme asset is delivered from its
 * `text` payload (see assetFromListing) — the card is never consumed.
 */
function emptySnapshot(): CharacterSnapshot {
  return {
    name: '',
    description: null,
    personality: null,
    base_prompt: null,
    scenario: null,
    mes_example: null,
    voice_characteristics: null,
    typing_speed_wpm: null,
    audio_response_chance_percent: null,
    image_data: null,
    image_mime: null,
  };
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