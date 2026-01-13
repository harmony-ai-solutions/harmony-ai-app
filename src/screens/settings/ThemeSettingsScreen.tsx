import React, { useState } from 'react';
import {
    View,
    Text,
    ScrollView,
    TouchableOpacity,
    StyleSheet,
    Alert,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { Switch } from 'react-native-paper';
import * as DocumentPicker from '@react-native-documents/picker';
import { isErrorWithCode, errorCodes } from '@react-native-documents/picker';
import RNFS from 'react-native-fs';
import { useAppTheme } from '../../contexts/ThemeContext';
import { RootStackParamList } from '../../navigation/AppNavigator';
import { ThemeCard } from '../../components/settings/ThemeCard';
import { Theme } from '../../theme/types';

type Props = NativeStackScreenProps<RootStackParamList, 'ThemeSettings'>;

export const ThemeSettingsScreen: React.FC<Props> = ({ navigation }) => {
    const {
        theme,
        availableThemes,
        themeMode,
        switchTheme,
        setThemeMode,
        importTheme,
        deleteCustomTheme,
        syncWithHarmonyLink,
        syncStatus,
    } = useAppTheme();

    const [systemThemeEnabled, setSystemThemeEnabled] = useState(themeMode === 'system');

    if (!theme) return null;

    const handleSystemThemeToggle = async (value: boolean) => {
        setSystemThemeEnabled(value);
        if (value) {
            await setThemeMode('system');
        } else {
            await setThemeMode(theme.id);
        }
    };

    const handleThemeSelect = async (themeId: string) => {
        try {
            await switchTheme(themeId);
            if (systemThemeEnabled) {
                setSystemThemeEnabled(false);
            }
        } catch (err) {
            Alert.alert('Error', 'Failed to switch theme');
        }
    };

    const handleCreateCustom = () => {
        navigation.navigate('ThemeEditor');
    };

    const handleEditTheme = (themeToEdit: Theme) => {
        if (!themeToEdit.isCustom) {
            Alert.alert(
                'Built-in Theme',
                'Built-in themes cannot be edited. Create a custom theme based on this one?',
                [
                    { text: 'Cancel', style: 'cancel' },
                    {
                        text: 'Create Copy',
                        onPress: () => {
                            // Navigate to editor with this theme as base
                            navigation.navigate('ThemeEditor', { themeId: themeToEdit.id });
                        },
                    },
                ]
            );
            return;
        }
        navigation.navigate('ThemeEditor', { themeId: themeToEdit.id });
    };

    const handleDeleteTheme = (themeToDelete: Theme) => {
        Alert.alert(
            'Delete Theme',
            `Are you sure you want to delete "${themeToDelete.name}"?`,
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            await deleteCustomTheme(themeToDelete.id);
                        } catch (e) {
                            Alert.alert('Error', 'Failed to delete theme');
                        }
                    },
                },
            ]
        );
    };

    const handleImportTheme = async () => {
        try {
            const [result] = await DocumentPicker.pick({
                type: [DocumentPicker.types.json],
            });

            if (result) {
                const fileContent = await RNFS.readFile(result.uri, 'utf8');
                await importTheme(fileContent);
                Alert.alert('Success', 'Theme imported successfully');
            }
        } catch (err) {
            if (isErrorWithCode(err)) {
                if (err.code !== errorCodes.OPERATION_CANCELED) {
                    Alert.alert('Error', 'Failed to import theme');
                }
            } else {
                Alert.alert('Error', 'An unexpected error occurred');
            }
        }
    };

    const handleSyncThemes = async () => {
        try {
            await syncWithHarmonyLink();
            Alert.alert('Success', 'Themes synced with Harmony Link');
        } catch (err) {
            Alert.alert('Error', 'Failed to sync themes');
        }
    };

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.background.base }]}>
            <ScrollView>
                {/* System Theme Toggle */}
                <View
                    style={[
                        styles.section,
                        { backgroundColor: theme.colors.background.surface },
                    ]}
                >
                    <View style={styles.sectionHeader}>
                        <Icon name="theme-light-dark" size={20} color={theme.colors.accent.primary} />
                        <Text style={[styles.sectionTitle, { color: theme.colors.text.primary }]}>
                            Theme Mode
                        </Text>
                    </View>

                    <View style={styles.switchRow}>
                        <View style={styles.switchLabel}>
                            <Text style={[styles.switchText, { color: theme.colors.text.primary }]}>
                                Follow System Theme
                            </Text>
                            <Text style={[styles.switchDescription, { color: theme.colors.text.secondary }]}>
                                Automatically switch theme based on system settings
                            </Text>
                        </View>
                        <Switch
                            value={systemThemeEnabled}
                            onValueChange={handleSystemThemeToggle}
                            color={theme.colors.accent.primary}
                        />
                    </View>
                </View>

                {/* Current Theme Preview */}
                <View style={styles.currentThemeSection}>
                    <Text style={[styles.label, { color: theme.colors.text.muted }]}>
                        CURRENT THEME
                    </Text>
                    <View style={styles.currentThemeCard}>
                        <ThemeCard
                            theme={theme}
                            isActive={true}
                            onPress={() => { }}
                            onEdit={() => handleEditTheme(theme)}
                        />
                    </View>
                </View>

                {/* Available Themes */}
                <View style={styles.themesSection}>
                    <Text style={[styles.label, { color: theme.colors.text.muted }]}>
                        AVAILABLE THEMES
                    </Text>
                    <View style={styles.themesGrid}>
                        {availableThemes.map((t) => (
                            <ThemeCard
                                key={t.id}
                                theme={t}
                                isActive={t.id === theme.id}
                                onPress={() => handleThemeSelect(t.id)}
                                onEdit={() => handleEditTheme(t)}
                                onDelete={t.isCustom ? () => handleDeleteTheme(t) : undefined}
                            />
                        ))}
                    </View>
                </View>

                {/* Actions */}
                <View style={styles.actionsSection}>
                    <TouchableOpacity
                        style={[
                            styles.actionButton,
                            { backgroundColor: theme.colors.accent.primary },
                        ]}
                        onPress={handleCreateCustom}
                    >
                        <Icon name="plus-circle" size={20} color="#ffffff" />
                        <Text style={styles.actionButtonText}>Create Custom Theme</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={[
                            styles.actionButton,
                            { backgroundColor: theme.colors.background.elevated },
                        ]}
                        onPress={handleImportTheme}
                    >
                        <Icon name="import" size={20} color={theme.colors.text.primary} />
                        <Text style={[styles.actionButtonText, { color: theme.colors.text.primary }]}>
                            Import Theme
                        </Text>
                    </TouchableOpacity>

                    {syncStatus.syncEnabled && (
                        <TouchableOpacity
                            style={[
                                styles.actionButton,
                                { backgroundColor: theme.colors.background.elevated },
                            ]}
                            onPress={handleSyncThemes}
                        >
                            <Icon name="cloud-sync" size={20} color={theme.colors.accent.primary} />
                            <Text style={[styles.actionButtonText, { color: theme.colors.text.primary }]}>
                                Sync with Harmony Link
                            </Text>
                            {syncStatus.pendingChanges && (
                                <View style={[styles.badge, { backgroundColor: theme.colors.status.warning }]} />
                            )}
                        </TouchableOpacity>
                    )}
                </View>
            </ScrollView>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    section: {
        margin: 16,
        padding: 16,
        borderRadius: 12,
    },
    sectionHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 16,
    },
    sectionTitle: {
        fontSize: 16,
        fontWeight: '600',
        marginLeft: 8,
    },
    switchRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    switchLabel: {
        flex: 1,
        marginRight: 16,
    },
    switchText: {
        fontSize: 16,
        fontWeight: '500',
    },
    switchDescription: {
        fontSize: 14,
        marginTop: 4,
    },
    currentThemeSection: {
        paddingHorizontal: 16,
        marginTop: 8,
    },
    label: {
        fontSize: 12,
        fontWeight: '600',
        marginBottom: 12,
        letterSpacing: 0.5,
    },
    currentThemeCard: {
        marginBottom: 16,
    },
    themesSection: {
        paddingHorizontal: 16,
        marginTop: 16,
    },
    themesGrid: {
        gap: 12,
    },
    actionsSection: {
        padding: 16,
        gap: 12,
    },
    actionButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        borderRadius: 12,
        gap: 8,
    },
    actionButtonText: {
        fontSize: 16,
        fontWeight: '600',
        color: '#ffffff',
    },
    badge: {
        width: 8,
        height: 8,
        borderRadius: 4,
        marginLeft: 8,
    },
});
