/**
 * BackgroundSettingsScreen
 *
 * Dedicated screen for toggling dynamic background effects on/off
 * and picking a visual style from 5 distinct animated designs.
 */

import React, { useCallback } from 'react';
import {
    View,
    Text,
    ScrollView,
    StyleSheet,
    TouchableOpacity,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { Switch } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../../contexts/ThemeContext';
import { useAppAlert } from '../../contexts/AppAlertContext';
import { RootStackParamList } from '../../navigation/AppNavigator';
import { ScreenHeader } from '../../components/themed/ScreenHeader';
import { ThemedView } from '../../components/themed/ThemedView';
import { ThemedCard } from '../../components/themed/ThemedCard';
import { SectionHeader } from '../../components/themed/SectionHeader';
import { BackgroundStyle } from '../../theme/types';
import { hexToRgba } from '../../utils/colorUtils';

type Props = NativeStackScreenProps<RootStackParamList, 'BackgroundSettings'>;

export const BackgroundSettingsScreen: React.FC<Props> = ({ navigation }) => {
    const { t } = useTranslation('themeSettings');
    const {
        theme,
        dynamicBackgroundEnabled,
        backgroundStyle,
        setDynamicBackgroundEnabled,
        setBackgroundStyle,
    } = useAppTheme();
    const { showAlert } = useAppAlert();

    const BACKGROUND_STYLES: { style: BackgroundStyle; label: string; icon: string; description: string }[] = [
        { style: 'aurora', label: t('bgStyleAurora'), icon: 'blur', description: t('bgStyleAuroraDesc') },
        { style: 'geodesic', label: t('bgStyleGeodesic'), icon: 'diamond', description: t('bgStyleGeodesicDesc') },
        { style: 'lightPillars', label: t('bgStyleLightPillars'), icon: 'flashlight', description: t('bgStyleLightPillarsDesc') },
        { style: 'constellation', label: t('bgStyleConstellation'), icon: 'star-four-points', description: t('bgStyleConstellationDesc') },
        { style: 'gradientFlow', label: t('bgStyleGradientFlow'), icon: 'waves', description: t('bgStyleGradientFlowDesc') },
    ];

    const handleDynamicBackgroundToggle = useCallback(async (value: boolean) => {
        try {
            await setDynamicBackgroundEnabled(value);
        } catch {
            showAlert(t('error'), t('backgroundUpdateFailed'));
        }
    }, [setDynamicBackgroundEnabled, showAlert, t]);

    const handleBackgroundStyleChange = useCallback(async (style: BackgroundStyle) => {
        try {
            await setBackgroundStyle(style);
        } catch {
            showAlert(t('error'), t('backgroundUpdateFailed'));
        }
    }, [setBackgroundStyle, showAlert, t]);

    if (!theme) return null;

    return (
        <ThemedView style={styles.container}>
            <ScreenHeader
                title={t('title')}
                onBack={() => navigation.goBack()}
            />
            <ScrollView contentContainerStyle={styles.scrollContent}>
                {/* Enable / Disable toggle */}
                <View style={styles.sectionWrapper}>
                    <ThemedCard elevated accentStripe>
                        <SectionHeader title={t('dynamicBackgroundEffects')} />
                        <View style={styles.switchRow}>
                            <View style={styles.switchLabel}>
                                <Text style={[styles.switchText, { color: theme.colors.text.primary }]}>
                                    {t('dynamicBackgroundEffects')}
                                </Text>
                                <Text style={[styles.switchDescription, { color: theme.colors.text.secondary }]}>
                                    {t('dynamicBackgroundDesc')}
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

                {/* Style picker */}
                <View style={styles.sectionWrapper}>
                    <ThemedCard elevated accentStripe>
                        <SectionHeader title={t('backgroundStyle')} />
                        <Text
                            style={[styles.sectionDescription, { color: theme.colors.text.secondary }]}
                        >
                            {t('backgroundStyleDesc')}
                        </Text>
                        <View style={styles.bgStyleContainer}>
                            {BACKGROUND_STYLES.map((bgItem) => (
                                <TouchableOpacity
                                    key={bgItem.style}
                                    style={[
                                        styles.bgStyleCard,
                                        {
                                            borderColor: backgroundStyle === bgItem.style
                                                ? theme.colors.accent.primary
                                                : hexToRgba(theme.colors.border.default, 0.3),
                                            backgroundColor: backgroundStyle === bgItem.style
                                                ? hexToRgba(theme.colors.accent.primary, 0.1)
                                                : theme.colors.background.elevated,
                                            opacity: dynamicBackgroundEnabled ? 1 : 0.45,
                                        },
                                    ]}
                                    onPress={() => handleBackgroundStyleChange(bgItem.style)}
                                    activeOpacity={0.7}
                                >
                                    <View style={styles.bgStyleHeader}>
                                        <View style={[styles.iconPill, { backgroundColor: hexToRgba(theme.colors.accent.primary, 0.12) }]}>
                                            <Icon name={bgItem.icon} size={18} color={theme.colors.accent.primary} />
                                        </View>
                                        {backgroundStyle === bgItem.style && (
                                            <Icon name="check-circle" size={20} color={theme.colors.accent.primary} />
                                        )}
                                    </View>
                                    <Text style={[styles.bgStyleLabel, { color: theme.colors.text.primary }]}>
                                        {bgItem.label}
                                    </Text>
                                    <Text style={[styles.bgStyleDesc, { color: theme.colors.text.secondary }]}>
                                        {bgItem.description}
                                    </Text>
                                </TouchableOpacity>
                            ))}
                        </View>
                    </ThemedCard>
                </View>
            </ScrollView>
        </ThemedView>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1 },
    scrollContent: { paddingTop: 16 },
    sectionWrapper: { paddingHorizontal: 16, marginBottom: 16 },
    switchRow: {
        paddingHorizontal: 16,
        paddingBottom: 16,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    switchLabel: { flex: 1, marginRight: 16 },
    switchText: { fontSize: 16, fontWeight: '500' },
    switchDescription: { fontSize: 14, marginTop: 4 },
    sectionDescription: { fontSize: 14, marginBottom: 16, paddingHorizontal: 16 },
    bgStyleContainer: { paddingHorizontal: 16, paddingBottom: 16, gap: 12 },
    bgStyleCard: { borderWidth: 1.5, borderRadius: 12, padding: 14, gap: 8 },
    bgStyleHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    iconPill: { width: 34, height: 34, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
    bgStyleLabel: { fontSize: 16, fontWeight: '600' },
    bgStyleDesc: { fontSize: 13, lineHeight: 18 },
});

export default BackgroundSettingsScreen;
