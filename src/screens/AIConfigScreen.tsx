import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Appbar } from 'react-native-paper';
import { ThemedAppbar } from '../components/themed/ThemedAppbar';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../contexts/ThemeContext';
import { ThemedView } from '../components/themed/ThemedView';
import { ThemedText } from '../components/themed/ThemedText';

export const AIConfigScreen: React.FC<any> = ({ navigation }) => {
    const { theme } = useAppTheme();
    const { t } = useTranslation('config');

    if (!theme) return null;

    return (
        <ThemedView style={styles.container}>
            <ThemedAppbar style={styles.header}>
                <Appbar.Content
                    title={t('aiConfig')}
                    titleStyle={{ color: theme.colors.text.primary, fontWeight: 'bold' }}
                />
            </ThemedAppbar>

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
    header: {
        elevation: 4,
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
