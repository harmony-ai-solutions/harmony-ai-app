/**
 * ContentAssetScreen — read a collected text/structured asset, copy it,
 * apply it to one of your characters, or remove it from the library.
 *
 * Data path: MarketplaceService.getContentAsset(id) (in-memory stub). The
 * apply-to-character flow targets the local character repos directly — it
 * never needed the doomed content_library sidecar table.
 */
import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Modal,
  Pressable,
  FlatList,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import Clipboard from '@react-native-clipboard/clipboard';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../contexts/ThemeContext';
import { useToast } from '../contexts/AppToastContext';
import { useAppAlert } from '../contexts/AppAlertContext';
import { ThemedView } from '../components/themed/ThemedView';
import { ScreenHeader } from '../components/themed/ScreenHeader';
import { ThemedButton } from '../components/themed/ThemedButton';
import { hexToRgba } from '../utils/colorUtils';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  getContentAsset,
  type ContentAsset,
} from '../services/marketplace/MarketplaceService';
import {
  getUserCharacterProfiles,
  getCharacterProfile,
  updateCharacterProfile,
} from '../database/repositories/characters';
import type { RootStackParamList } from '../navigation/AppNavigator';

type RouteParams = RouteProp<RootStackParamList, 'ContentAsset'>;

export const ContentAssetScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<RouteParams>();
  const { entryId } = route.params;
  const { t } = useTranslation('market');
  const { theme } = useAppTheme();
  const { showToast } = useToast();
  const { showAlert } = useAppAlert();
  const { bottom: safeBottom } = useSafeAreaInsets();

  const [entry, setEntry] = useState<ContentAsset | null>(null);
  const [loading, setLoading] = useState(true);
  const [applyPickerOpen, setApplyPickerOpen] = useState(false);
  const [characters, setCharacters] = useState<{ id: string; name: string }[]>([]);
  const [applying, setApplying] = useState(false);

  const load = useCallback(async () => {
    try {
      const asset = await getContentAsset(entryId);
      setEntry(asset);
    } catch {
      setEntry(null);
    } finally {
      setLoading(false);
    }
  }, [entryId]);

  React.useEffect(() => {
    load();
  }, [load]);

  const openApplyPicker = async () => {
    try {
      const profiles = await getUserCharacterProfiles(false);
      setCharacters(profiles.map(p => ({ id: p.id, name: p.name })));
      setApplyPickerOpen(true);
    } catch {
      showToast(t('acquireFailed'));
    }
  };

  const handleApplyTo = async (profileId: string) => {
    if (!entry?.text) return;
    setApplying(true);
    try {
      // Apply the asset text directly to the character's description field
      // (the stub asset carries no itemType→field mapping; description is the
      // honest default until the backend encodes a target field).
      const profile = await getCharacterProfile(profileId);
      if (!profile) throw new Error('character_profile_not_found');
      await updateCharacterProfile({ ...profile, description: entry.text });
      showToast(t('appliedToast'));
      setApplyPickerOpen(false);
    } catch {
      showToast(t('acquireFailed'));
    } finally {
      setApplying(false);
    }
  };

  const handleCopy = () => {
    if (!entry?.text) return;
    Clipboard.setString(entry.text);
    showToast(t('copiedToast'));
  };

  const handleDelete = () => {
    // The stub backend has no library/content-asset delete API — honest error
    // instead of a fake success.
    showToast(t('removeUnavailablePreview'));
  };

  if (!theme) return null;
  const accent = theme.colors.accent.primary;
  const baseHex = theme.colors.background.base;

  if (loading) {
    return (
      <ThemedView variant="base" style={styles.flex}>
        <ScreenHeader title={t('myLibrary')} onBack={() => navigation.goBack()} />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={accent} />
        </View>
      </ThemedView>
    );
  }
  if (!entry) {
    return (
      <ThemedView variant="base" style={styles.flex}>
        <ScreenHeader title={t('myLibrary')} onBack={() => navigation.goBack()} />
        <View style={styles.centered}>
          <Text style={{ color: theme.colors.text.muted }}>{t('libraryEmpty')}</Text>
        </View>
      </ThemedView>
    );
  }

  return (
    <ThemedView variant="base" style={styles.flex}>
      <ScreenHeader title={entry.title} onBack={() => navigation.goBack()} />
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.content, { paddingBottom: safeBottom + 120 }]}
      >
        {entry.text ? (
          <View
            style={[
              styles.textCard,
              { backgroundColor: hexToRgba(baseHex, 0.5), borderColor: hexToRgba(accent, 0.25) },
            ]}
          >
            <Text style={[styles.text, { color: theme.colors.text.primary }]}>{entry.text}</Text>
          </View>
        ) : (
          <View
            style={[
              styles.textCard,
              { backgroundColor: hexToRgba(baseHex, 0.5), borderColor: hexToRgba(accent, 0.25) },
            ]}
          >
            <Text style={[styles.text, { color: theme.colors.text.muted }]}>
              {JSON.stringify(
                entry.snapshot ? { snapshot: entry.snapshot } : { kind: entry.kind },
                null,
                2,
              )}
            </Text>
          </View>
        )}
      </ScrollView>

      <View style={[styles.actions, { paddingBottom: safeBottom + 12 }]}>
        <ThemedButton
          label={t('copy')}
          variant="secondary"
          icon="content-copy"
          onPress={handleCopy}
          style={styles.actionBtn}
        />
        <ThemedButton
          label={t('applyToCharacter')}
          variant="secondary"
          icon="account-plus-outline"
          onPress={openApplyPicker}
          style={styles.actionBtn}
        />
        <ThemedButton
          label={t('deleteEntry')}
          variant="ghost"
          icon="trash-can-outline"
          onPress={handleDelete}
          style={styles.actionBtn}
        />
      </View>

      {/* Apply-to-character picker */}
      <Modal visible={applyPickerOpen} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View
            style={[
              styles.modalSheet,
              { backgroundColor: theme.colors.background.surface, borderColor: hexToRgba(accent, 0.3) },
            ]}
          >
            <Text style={[styles.modalTitle, { color: theme.colors.text.primary }]}>
              {t('applyToCharacter')}
            </Text>
            <FlatList
              data={characters}
              keyExtractor={item => item.id}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => handleApplyTo(item.id)}
                  style={[styles.charRow, { borderColor: hexToRgba(accent, 0.2) }]}
                >
                  <Icon name="account-heart" size={18} color={accent} />
                  <Text style={[styles.charName, { color: theme.colors.text.primary }]}>
                    {item.name}
                  </Text>
                </Pressable>
              )}
              ListEmptyComponent={
                <Text style={[styles.hint, { color: theme.colors.text.muted }]}>
                  {t('noCharactersHint')}
                </Text>
              }
            />
            <ThemedButton
              label={t('buyCancel')}
              variant="ghost"
              onPress={() => setApplyPickerOpen(false)}
            />
          </View>
        </View>
      </Modal>
      {applying && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color={accent} />
        </View>
      )}
    </ThemedView>
  );
};

export default ContentAssetScreen;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    padding: 20,
  },
  textCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
  },
  text: {
    fontSize: 15,
    lineHeight: 22,
  },
  actions: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 20,
    paddingTop: 12,
    backgroundColor: 'rgba(10,10,14,0.85)',
  },
  actionBtn: { flex: 1 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: 24,
  },
  modalSheet: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 20,
    maxHeight: '70%',
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 12,
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
  hint: { fontSize: 14, marginTop: 8 },
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