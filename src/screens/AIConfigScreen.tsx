import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Appbar } from 'react-native-paper';
import { useAppTheme } from '../contexts/ThemeContext';
import { ThemedView } from '../components/themed/ThemedView';
import { ThemedText } from '../components/themed/ThemedText';
import { SettingsMenu } from '../components/navigation/SettingsMenu';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

export const AIConfigScreen: React.FC<any> = ({ navigation }) => {
    const { theme } = useAppTheme();
    const [menuVisible, setMenuVisible] = useState(false);

    if (!theme) return null;

    return (
        <ThemedView style={styles.container}>
            <Appbar.Header style={[styles.header, { backgroundColor: theme.colors.background.surface }]}>
                <Appbar.Content
                    title="AI Configuration"
                    titleStyle={{ color: theme.colors.text.primary, fontWeight: 'bold' }}
                />
                <Appbar.Action
                    icon={() => <Icon name="menu" size={24} color={theme.colors.text.primary} />}
                    onPress={() => setMenuVisible(true)}
                />
            </Appbar.Header>

            <View style={styles.content}>
                <ThemedText weight="bold" size={24}>
                    AI Configuration
                </ThemedText>
                <ThemedText variant="secondary" style={styles.subtext}>
                    Coming Soon
                </ThemedText>
            </View>

            <SettingsMenu
                visible={menuVisible}
                onClose={() => setMenuVisible(false)}
                onNavigate={(screen) => navigation.navigate(screen)}
            />
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
