/**
 * PersonaSwitcherModal — choose the persona to chat as, or create a new one.
 *
 * Replaces the old "My Identity Settings" entry in the chat context menu:
 * the user can switch between their personas (from the My Profile personas
 * tab) or jump to PersonaEdit to create a fresh one. Personas are the ONLY
 * identities the user can chat as — AI characters are chat partners, not
 * identities.
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Modal,
  TouchableWithoutFeedback,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedText } from '../themed/ThemedText';
import { ProfileAvatar } from '../profile/ProfileAvatar';
import { getAllPersonas, Persona } from '../../database/repositories/personas';
import { hapticLightPress } from '../../utils/haptics';
import { createLogger } from '../../utils/logger';

const log = createLogger('[PersonaSwitcherModal]');

interface PersonaSwitcherModalProps {
  visible: boolean;
  activePersonaId: string | null;
  /** Called with the selected persona id ('user' = chat as own profile). */
  onSelect: (personaId: string) => void;
  onClose: () => void;
}

export const PersonaSwitcherModal: React.FC<PersonaSwitcherModalProps> = ({
  visible,
  activePersonaId,
  onSelect,
  onClose,
}) => {
  const { theme } = useAppTheme();
  const { t } = useTranslation('chatDetail');
  const navigation = useNavigation<any>();
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [loading, setLoading] = useState(false);

  const loadPersonas = useCallback(async () => {
    if (!visible) return;
    setLoading(true);
    try {
      const all = await getAllPersonas();
      setPersonas(all);
    } catch (err) {
      log.error('Failed to load personas:', err);
    } finally {
      setLoading(false);
    }
  }, [visible]);

  React.useEffect(() => {
    loadPersonas();
  }, [loadPersonas]);

  if (!theme) return null;

  const handleSelect = (persona: Persona) => {
    onSelect(persona.id);
  };

  const handleSelectUser = () => {
    onSelect('user');
  };

  const handleCreateNew = () => {
    onClose();
    navigation.navigate('PersonaEdit');
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.overlay}>
          <TouchableWithoutFeedback>
            <View style={[styles.shell, { backgroundColor: theme.colors.background.surface }]}>
              <LinearGradient
                colors={[
                  theme.colors.accent.primary + '12',
                  'transparent',
                ]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0.6 }}
                style={StyleSheet.absoluteFill}
                pointerEvents="none"
              />

              {/* Header */}
              <View style={styles.header}>
                <View>
                  <ThemedText size={17} weight="bold" hierarchy="header">
                    {t('personaSwitcherTitle')}
                  </ThemedText>
                  <ThemedText size={12} variant="muted" hierarchy="caption">
                    {t('personaSwitcherCaption')}
                  </ThemedText>
                </View>
                <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Icon name="close" size={22} color={theme.colors.text.muted} />
                </TouchableOpacity>
              </View>

              {/* Chat as my own profile (no persona) */}
              <TouchableOpacity
                style={[
                  styles.row,
                  styles.userRow,
                  (activePersonaId === null || activePersonaId === 'user') && {
                    backgroundColor: theme.colors.accent.primary + '14',
                  },
                ]}
                onPress={() => {
                  hapticLightPress();
                  handleSelectUser();
                }}
                activeOpacity={0.7}
                testID="persona-switcher-user"
              >
                <View
                  style={[
                    styles.userBadge,
                    { backgroundColor: theme.colors.accent.primary + '1A' },
                  ]}
                >
                  <Icon name="account-outline" size={22} color={theme.colors.accent.primary} />
                </View>
                <View style={styles.rowInfo}>
                  <ThemedText
                    size={15}
                    weight={
                      activePersonaId === null || activePersonaId === 'user'
                        ? 'bold'
                        : 'medium'
                    }
                    numberOfLines={1}
                  >
                    {t('personaSwitcherUser')}
                  </ThemedText>
                  <ThemedText size={12} variant="muted" numberOfLines={1}>
                    {t('personaSwitcherUserCaption')}
                  </ThemedText>
                </View>
                {(activePersonaId === null || activePersonaId === 'user') && (
                  <Icon name="check-circle" size={20} color={theme.colors.accent.primary} />
                )}
              </TouchableOpacity>

              {/* Separator between "as user" and personas */}
              <View style={[styles.separator, { backgroundColor: theme.colors.border.default + '55' }]} />

              {/* Persona list */}
              {personas.length === 0 && !loading ? (
                <ThemedText size={13} variant="muted" style={styles.emptyText}>
                  {t('personaSwitcherEmpty')}
                </ThemedText>
              ) : (
                <FlatList
                  data={personas}
                  keyExtractor={p => p.id}
                  style={styles.list}
                  contentContainerStyle={styles.listContent}
                  renderItem={({ item }) => {
                    const isActive = item.id === activePersonaId;
                    return (
                      <TouchableOpacity
                        style={[styles.row, isActive && { backgroundColor: theme.colors.accent.primary + '14' }]}
                        onPress={() => {
                          hapticLightPress();
                          handleSelect(item);
                        }}
                        activeOpacity={0.7}
                        testID="persona-switcher-row"
                      >
                        <ProfileAvatar name={item.name} uri={item.avatarUri} size={44} showRing={false} />
                        <View style={styles.rowInfo}>
                          <ThemedText size={15} weight={isActive ? 'bold' : 'medium'} numberOfLines={1}>
                            {item.name}
                          </ThemedText>
                          {item.personality ? (
                            <ThemedText size={12} variant="muted" numberOfLines={1}>
                              {item.personality}
                            </ThemedText>
                          ) : null}
                        </View>
                        {isActive && (
                          <Icon name="check-circle" size={20} color={theme.colors.accent.primary} />
                        )}
                      </TouchableOpacity>
                    );
                  }}
                />
              )}

              {/* Create new */}
              <TouchableOpacity
                style={[styles.newRow, { borderColor: theme.colors.border.default + '66' }]}
                onPress={() => {
                  hapticLightPress();
                  handleCreateNew();
                }}
                activeOpacity={0.7}
                testID="persona-switcher-create"
              >
                <View
                  style={[
                    styles.newBadge,
                    { backgroundColor: theme.colors.accent.primary + '1A' },
                  ]}
                >
                  <Icon name="plus" size={20} color={theme.colors.accent.primary} />
                </View>
                <ThemedText size={15} weight="medium" style={{ color: theme.colors.accent.primary }}>
                  {t('personaSwitcherCreate')}
                </ThemedText>
              </TouchableOpacity>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  shell: {
    borderRadius: 18,
    padding: 18,
    maxHeight: '70%',
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  list: {
    flexGrow: 0,
  },
  listContent: {
    gap: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 12,
  },
  rowInfo: {
    flex: 1,
    gap: 2,
  },
  emptyText: {
    textAlign: 'center',
    paddingVertical: 24,
  },
  newRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 12,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderTopWidth: 1,
  },
  newBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  userRow: {
    marginBottom: 4,
  },
  userBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 8,
  },
});

export default PersonaSwitcherModal;
