import React, { useState, useMemo } from 'react';
import {
    View,
    Text,
    ScrollView,
    StyleSheet,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Switch } from 'react-native-paper';
import * as DocumentPicker from '@react-native-documents/picker';
import { isErrorWithCode, errorCodes } from '@react-native-documents/picker';
import RNFS from 'react-native-fs';
import { useAppTheme } from '../../contexts/ThemeContext';
import { useAppAlert } from '../../contexts/AppAlertContext';
import { useEmoji } from '../../contexts/EmojiContext';
import { RootStackParamList } from '../../navigation/AppNavigator';
import { ScreenHeader } from '../../components/themed/ScreenHeader';
import { ThemedView } from '../../components/themed/ThemedView';
import { ThemedCard } from '../../components/themed/ThemedCard';
import { ThemedButton } from '../../components/themed/ThemedButton';
import { SectionHeader } from '../../components/themed/SectionHeader';
import { ThemeCard } from '../../components/settings/ThemeCard';
import { EmojiStyleCard } from '../../components/settings/EmojiStyleCard';
import { Theme } from '../../theme/types';
import { EmojiSet } from '../../types/emoji';
import { soulBitsThemes, otherThemes } from '../../theme/themes';

type Props = NativeStackScreenProps<RootStackParamList, 'ThemeSettings'>;

export const ThemeSettingsScreen: React.FC<Props> = ({ navigation }) => {
    const {
        theme,
        availableThemes,
        themeMode,
        dynamicBackgroundEnabled,
        switchTheme,
        setThemeMode,
        setDynamicBackgroundEnabled,
        importTheme,
        deleteCustomTheme,
        syncWithHarmonyLink,
        syncStatus,
    } = useAppTheme();

    const { emojiSet, setEmojiSet } = useEmoji();
    const { showAlert } = useAppAlert();

    const EMOJI_STYLES = [
        { set: 'native' as EmojiSet, label: 'Native (System)', description: 'Use your device\'s built-in emoji style', sampleEmojis: ['😀', '👍', '❤️', '🎉', '🚀'] },
        { set: 'noto' as EmojiSet, label: 'Google Noto', description: 'Colorful, modern emoji by Google (Apache 2.0)', sampleEmojis: ['😀', '👍', '❤️', '🎉', '🚀'] },
        { set: 'twemoji' as EmojiSet, label: 'Twemoji', description: 'Clean, flat emoji originally by Twitter/X (CC-BY 4.0)', sampleEmojis: ['😀', '👍', '❤️', '🎉', '🚀'] },
    ];

    const [systemThemeEnabled, setSystemThemeEnabled] = useState(themeMode === 'system');

    // Separate custom themes from built-in ones
    const customThemes = useMemo(
        () => availableThemes.filter(t => t.isCustom),
        [availableThemes],
    );

    // Merge otherThemes with custom themes for the second section
    const otherAndCustomThemes = useMemo(
        () => [...otherThemes, ...customThemes],
        [customThemes],
    );

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
            showAlert('Error', 'Failed to switch theme');
        }
    };

    const handleCreateCustom = () => {
        navigation.navigate('ThemeEditor');
    };

    const handleEditTheme = (themeToEdit: Theme) => {
        if (!themeToEdit.isCustom) {
            showAlert(
                'Built-in Theme',
                'Built-in themes cannot be edited. Create a custom theme based on this one?',
                [
                    { text: 'Cancel', style: 'cancel' },
                    {
                        text: 'Create Copy',
                        onPress: () => {
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
        showAlert(
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
                            showAlert('Error', 'Failed to delete theme');
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
                showAlert('Success', 'Theme imported successfully');
            }
        } catch (err) {
            if (isErrorWithCode(err)) {
                if (err.code !== errorCodes.OPERATION_CANCELED) {
                    showAlert('Error', 'Failed to import theme');
                }
            } else {
                showAlert('Error', 'An unexpected error occurred');
            }
        }
    };

    const handleSyncThemes = async () => {
        try {
            await syncWithHarmonyLink();
            showAlert('Success', 'Themes synced with Harmony Link');
        } catch (err) {
            showAlert('Error', 'Failed to sync themes');
        }
    };

    const handleDynamicBackgroundToggle = async (value: boolean) => {
        try {
            await setDynamicBackgroundEnabled(value);
        } catch (err) {
            showAlert('Error', 'Failed to update background setting');
        }
    };

    return (
        <ThemedView style={styles.container}>
            <ScreenHeader
              title="Appearance & Theme"
              onBack={() => navigation.goBack()}
            />
            <ScrollView>
                {/* Dynamic Background Effects Toggle */}
                <View style={styles.sectionWrapper}>
                    <ThemedCard elevated accentStripe>
                        <SectionHeader title="Background Effects" />

                        <View style={styles.switchRow}>
                            <View style={styles.switchLabel}>
                                <Text style={[styles.switchText, { color: theme.colors.text.primary }]}>
                                    Dynamic Background Effects
                                </Text>
                                <Text style={[styles.switchDescription, { color: theme.colors.text.secondary }]}>
                                    Enable fluid motion and particle effects. Disable if you experience lag or wish to save battery.
                                </Text>
                            </View>
                            <Switch
                                value={dynamicBackgroundEnabled}
                                onValueChange={handleDynamicBackgroundToggle}
                                color={theme.colors.accent.primary}
                            />
                        </View>
                    </ThemedCard>
                </View>

                {/* System Theme Toggle */}
                <View style={styles.sectionWrapper}>
                    <ThemedCard elevated accentStripe>
                        <SectionHeader title="Theme Mode" />

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
                    </ThemedCard>
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

                {/* SoulBits Themes */}
                <View style={styles.themesSection}>
                    <Text style={[styles.label, { color: theme.colors.text.muted }]}>
                        SOULBITS THEMES
                    </Text>
                    <View style={styles.themesGrid}>
                        {soulBitsThemes.map((t) => (
                            <ThemeCard
                                key={t.id}
                                theme={t}
                                isActive={t.id === theme.id}
                                onPress={() => handleThemeSelect(t.id)}
                                onEdit={() => handleEditTheme(t)}
                            />
                        ))}
                    </View>
                </View>

                {/* Other Available Themes */}
                <View style={styles.themesSection}>
                    <Text style={[styles.label, { color: theme.colors.text.muted }]}>
                        OTHER AVAILABLE THEMES
                    </Text>
                    <View style={styles.themesGrid}>
                        {otherAndCustomThemes.map((t) => (
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
                <View style={styles.sectionWrapper}>
                    <ThemedCard elevated accentStripe>
                        <SectionHeader title="Actions" />

                        <View style={styles.actionsContainer}>
                            <ThemedButton
                                label="Create Custom Theme"
                                icon="plus-circle"
                                iconSize={20}
                                onPress={handleCreateCustom}
                            />

                            <ThemedButton
                                label="Import Theme"
                                icon="import"
                                variant="outline"
                                onPress={handleImportTheme}
                            />

                            {syncStatus.syncEnabled && (
                                <ThemedButton
                                    label="Sync with Harmony Link"
                                    icon="cloud-sync"
                                    variant="outline"
                                    onPress={handleSyncThemes}
                                    testID="sync-themes-button"
                                />
                            )}
                        </View>
                    </ThemedCard>
                </View>

                {/* Emoji Style Section */}
                <View style={styles.sectionWrapper}>
                    <ThemedCard elevated accentStripe>
                        <SectionHeader title="Emoji Style" />
                        <Text
                            style={[
                                styles.sectionDescription,
                                { color: theme.colors.text.secondary },
                            ]}
                        >
                            Choose how emojis look in chat messages
                        </Text>
                        <View style={styles.emojiCardsContainer}>
                            {EMOJI_STYLES.map((style) => (
                                <EmojiStyleCard
                                    key={style.set}
                                    emojiSet={style.set}
                                    label={style.label}
                                    description={style.description}
                                    sampleEmojis={style.sampleEmojis}
                                    isActive={emojiSet === style.set}
                                    onPress={() => setEmojiSet(style.set)}
                                    theme={theme}
                                />
                            ))}
                        </View>
                    </ThemedCard>
                </View>
            </ScrollView>
        </ThemedView>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    header: {
        elevation: 4,
    },
    sectionWrapper: {
        paddingHorizontal: 16,
        marginBottom: 16,
    },
    switchRow: {
        paddingHorizontal: 16,
        paddingBottom: 16,
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
    actionsContainer: {
        paddingHorizontal: 16,
        paddingBottom: 16,
        gap: 12,
    },
    emojiCardsContainer: {
        paddingHorizontal: 16,
        paddingBottom: 16,
    },
    sectionDescription: {
        fontSize: 14,
        marginBottom: 16,
        paddingHorizontal: 16,
    },
});
