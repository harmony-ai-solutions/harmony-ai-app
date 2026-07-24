import React, { useState, useCallback } from 'react';
import { StyleSheet, View, ScrollView, RefreshControl } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../contexts/ThemeContext';
import { ThemedView } from '../components/themed/ThemedView';
import { ThemedText } from '../components/themed/ThemedText';
import { ScreenHeader } from '../components/themed/ScreenHeader';

export const AIConfigScreen: React.FC<any> = ({ navigation }) => {
    const { theme } = useAppTheme();
    const { t } = useTranslation('config');
    const [refreshing, setRefreshing] = useState(false);

    if (!theme) return null;

    const onRefresh = useCallback(async () => {
        setRefreshing(true);
        setTimeout(() => setRefreshing(false), 800);
    }, []);

    return (
        <ThemedView style={styles.container}>
            <ScreenHeader title={t('aiConfig')} />

            <ScrollView
                contentContainerStyle={styles.scrollContent}
                refreshControl={
                    <RefreshControl
                        refreshing={refreshing}
                        onRefresh={onRefresh}
                        colors={[theme!.colors.accent.primary]}
                        tintColor={theme!.colors.accent.primary}
                        progressBackgroundColor={theme!.colors.background.surface}
                    />
                }
            >
            <View style={styles.content}>
                <ThemedText weight="bold" size={24}>
                    {t('aiConfig')}
                </ThemedText>
                <ThemedText variant="secondary" style={styles.subtext}>
                    {t('common:comingSoon')}
                </ThemedText>
            </View>
            </ScrollView>

        </ThemedView>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    scrollContent: {
        flexGrow: 1,
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
