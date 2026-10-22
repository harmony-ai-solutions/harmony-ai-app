/**
 * PersonaListScreen — the dedicated Settings-tab persona list (owner-approved
 * settings rework).
 *
 * Mirrors the My Profile > Personas tab interaction model without the profile
 * hero / tabs:
 *   - each row is the shared `PersonaRow` (avatar, name, description, active
 *     chip + pencil);
 *   - tapping a row sets the global "chatting as" persona
 *     (`ChatPreferencesService.setGlobalImpersonatedEntity`, same service and
 *     confirmation as MyProfileScreen);
 *   - the pencil opens `PersonaEdit` for that persona;
 *   - the bottom pill (and the empty-state action) opens `PersonaEdit` in
 *     create mode.
 *
 * The shared persona voice-input config is intentionally NOT surfaced here —
 * it lives once on the Settings tab (it applies to every persona).
 */

import React, { useCallback, useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../../contexts/ThemeContext';
import { useAppAlert } from '../../contexts/AppAlertContext';
import { ThemedView } from '../../components/themed/ThemedView';
import { ThemedText } from '../../components/themed/ThemedText';
import { ThemedCard } from '../../components/themed/ThemedCard';
import { ThemedButton } from '../../components/themed/ThemedButton';
import { ThemedEmptyState } from '../../components/themed/ThemedEmptyState';
import { ScreenHeader } from '../../components/themed/ScreenHeader';
import { PersonaRow } from '../../components/profile/PersonaRow';
import { getUserEntities, Persona } from '../../database/repositories';
import ChatPreferencesService from '../../services/ChatPreferencesService';
import { hapticLightPress } from '../../utils/haptics';
import { createLogger } from '../../utils/logger';

const log = createLogger('[PersonaListScreen]');

export const PersonaListScreen: React.FC = () => {
  const { theme } = useAppTheme();
  const { bottom: safeBottom } = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const { t } = useTranslation('settings');
  const { t: tProfile } = useTranslation('profile');
  const { showAlert } = useAppAlert();

  const [personas, setPersonas] = useState<Persona[]>([]);
  const [activePersonaId, setActivePersonaId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadPersonas = useCallback(async () => {
    try {
      const stored = await ChatPreferencesService.getGlobalImpersonatedEntity();
      const all = await getUserEntities();
      const active = stored && all.some(p => p.id === stored) ? stored : null;
      setActivePersonaId(active);
      setPersonas(all.map(p => ({ ...p, isActive: p.id === active })));
    } catch (err) {
      log.error('Failed to load personas:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadPersonas();
    }, [loadPersonas]),
  );

  const handleOpenPersonaEdit = (entityId?: string) => {
    navigation.navigate('PersonaEdit', entityId ? { entityId } : {});
  };

  /** Tap row = set the globally selected "chatting as" identity. */
  const handleSetActivePersona = async (id: string) => {
    try {
      await ChatPreferencesService.setGlobalImpersonatedEntity(id);
      const persona = personas.find(p => p.id === id);
      setActivePersonaId(id);
      setPersonas(prev => prev.map(p => ({ ...p, isActive: p.id === id })));
      showAlert(tProfile('personaSetActiveDone', { name: persona?.name ?? '' }));
    } catch (err) {
      log.error('Failed to set active persona:', err);
    }
  };

  if (!theme) return null;

  const renderNewPersonaPill = () => (
    <TouchableOpacity
      onPress={() => {
        hapticLightPress();
        handleOpenPersonaEdit();
      }}
      activeOpacity={0.7}
      style={[
        styles.newPersonaPill,
        {
          borderColor: theme.colors.accent.primary + '55',
          backgroundColor: theme.colors.accent.primary + '18',
        },
      ]}
      testID="new-persona-button"
      accessibilityRole="button"
      accessibilityLabel={tProfile('newPersona')}
    >
      <Icon name="plus" size={16} color={theme.colors.accent.primary} />
      <ThemedText
        size={12}
        weight="medium"
        style={{ color: theme.colors.accent.primary }}
      >
        {tProfile('newPersona')}
      </ThemedText>
    </TouchableOpacity>
  );

  return (
    <ThemedView style={styles.container}>
      <ScreenHeader
        title={t('personas')}
        subtitle={tProfile('personasHint')}
        onBack={() => navigation.goBack()}
      />

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: 32 + safeBottom },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color={theme.colors.accent.primary} />
          </View>
        ) : personas.length === 0 ? (
          <ThemedEmptyState
            icon="account-outline"
            title={tProfile('tabPersonasEmpty')}
            subtitle={tProfile('tabPersonasEmptyHint')}
            testID="persona-list-empty"
            action={
              <ThemedButton
                label={tProfile('newPersona')}
                onPress={() => handleOpenPersonaEdit()}
                variant="ghost"
                icon="plus"
                testID="new-persona-button"
              />
            }
          />
        ) : (
          <>
            <ThemedCard elevated accentStripe style={styles.card}>
              <View style={styles.personaList}>
                {personas.map(persona => (
                  <PersonaRow
                    key={persona.id}
                    name={persona.name}
                    description={persona.description}
                    avatarUri={persona.avatarUri}
                    isActive={persona.id === activePersonaId}
                    onPress={() => {
                      hapticLightPress();
                      void handleSetActivePersona(persona.id);
                    }}
                    onEditPress={() => {
                      hapticLightPress();
                      handleOpenPersonaEdit(persona.id);
                    }}
                  />
                ))}
              </View>
            </ThemedCard>

            {renderNewPersonaPill()}
          </>
        )}
      </ScrollView>
    </ThemedView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: {
    padding: 16,
    gap: 12,
  },
  card: {
    padding: 0,
    overflow: 'hidden',
  },
  personaList: {
    gap: 4,
  },
  loadingRow: {
    paddingVertical: 32,
    alignItems: 'center',
  },
  newPersonaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 4,
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
  },
});

export default PersonaListScreen;
