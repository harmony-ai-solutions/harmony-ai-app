import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../contexts/ThemeContext';
import { ThemedView } from '../components/themed/ThemedView';
import { ThemedText } from '../components/themed/ThemedText';
import { ScreenHeader } from '../components/themed/ScreenHeader';

export const AIConfigScreen: React.FC<any> = ({ navigation }) => {
    const { theme } = useAppTheme();
    const { t } = useTranslation('config');

    if (!theme) return null;

    return (
        <ThemedView style={styles.container}>
            <ScreenHeader title={t('aiConfig')} />

            <View style={styles.content}>
                <ThemedText weight="bold" size={24}>
                    {t('aiConfig')}
                </ThemedText>
                <ThemedText variant="secondary" style={styles.subtext}>
                    {t('common:comingSoon')}
                </ThemedText>
            </View>

        </ThemedView>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    content: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    subtext: {
        marginTop: 8,
    },
});
