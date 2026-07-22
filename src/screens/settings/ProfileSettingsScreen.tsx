import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../contexts/ThemeContext';
import { ThemedView } from '../../components/themed/ThemedView';
import { ThemedText } from '../../components/themed/ThemedText';
import { ScreenHeader } from '../../components/themed/ScreenHeader';

export const ProfileSettingsScreen: React.FC = () => {
    const { theme } = useAppTheme();
    const navigation = useNavigation();
    const { t } = useTranslation('profile');

    if (!theme) return null;

    return (
        <ThemedView style={styles.container}>
            <ScreenHeader
                title={t('title')}
                onBack={() => navigation.goBack()}
            />
            <View style={styles.content}>
                <ThemedText variant="muted">Profile Settings (Coming Soon)</ThemedText>
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
});
