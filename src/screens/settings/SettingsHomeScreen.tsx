import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { useAppTheme } from '../../contexts/ThemeContext';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { SettingsMenu } from '../../components/navigation/SettingsMenu';

export const SettingsHomeScreen: React.FC<any> = ({ navigation }) => {
    const { theme } = useAppTheme();
    const [menuVisible, setMenuVisible] = useState(false);

    if (!theme) return null;

    const navigateTo = (screen: string) => {
        navigation.navigate(screen);
    };

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.background.base }]}>
            <View style={[styles.header, { borderBottomColor: theme.colors.border.default }]}>
                <Text style={[styles.headerTitle, { color: theme.colors.text.primary }]}>
                    Settings
                </Text>
                <TouchableOpacity onPress={() => setMenuVisible(true)}>
                    <Icon name="menu" size={28} color={theme.colors.text.primary} />
                </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.content}>
                <TouchableOpacity
                    style={[styles.item, { borderBottomColor: theme.colors.border.default }]}
                    onPress={() => navigation.navigate('ThemeSettings')}
                >
                    <Icon name="palette" size={24} color={theme.colors.accent.primary} />
                    <Text style={[styles.itemLabel, { color: theme.colors.text.primary }]}>
                        Appearance & Theme
                    </Text>
                    <Icon name="chevron-right" size={24} color={theme.colors.text.muted} />
                </TouchableOpacity>

                <TouchableOpacity
                    style={[styles.item, { borderBottomColor: theme.colors.border.default }]}
                    onPress={() => navigation.navigate('SyncSettings')}
                >
                    <Icon name="sync" size={24} color={theme.colors.accent.primary} />
                    <Text style={[styles.itemLabel, { color: theme.colors.text.primary }]}>
                        Data Synchronization
                    </Text>
                    <Icon name="chevron-right" size={24} color={theme.colors.text.muted} />
                </TouchableOpacity>

                {/* DEV ONLY: Database Tests */}
                {__DEV__ && (
                    <TouchableOpacity
                        style={[styles.item, { borderBottomColor: theme.colors.border.default }]}
                        onPress={() => navigation.navigate('DatabaseTests')}
                    >
                        <Icon name="test-tube" size={24} color={theme.colors.status.warning} />
                        <Text style={[styles.itemLabel, { color: theme.colors.text.primary }]}>
                            Database Tests
                        </Text>
                        <View style={[styles.devBadge, { backgroundColor: theme.colors.status.warning }]}>
                            <Text style={styles.devBadgeText}>DEV</Text>
                        </View>
                        <Icon name="chevron-right" size={24} color={theme.colors.text.muted} />
                    </TouchableOpacity>
                )}

                {/* Add more items here as needed */}
            </ScrollView>

            <SettingsMenu
                visible={menuVisible}
                onClose={() => setMenuVisible(false)}
                onNavigate={navigateTo}
            />
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    header: {
        paddingTop: 48,
        paddingBottom: 16,
        paddingHorizontal: 16,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderBottomWidth: 1,
    },
    headerTitle: {
        fontSize: 20,
        fontWeight: 'bold',
    },
    content: {
        padding: 16,
    },
    item: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 16,
        borderBottomWidth: 1,
    },
    itemLabel: {
        flex: 1,
        fontSize: 16,
        marginLeft: 16,
    },
    devBadge: {
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 4,
        marginRight: 8,
    },
    devBadgeText: {
        color: '#ffffff',
        fontSize: 10,
        fontWeight: 'bold',
        letterSpacing: 0.5,
    },
});
