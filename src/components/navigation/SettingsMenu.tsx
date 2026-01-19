import React from 'react';
import {
    Modal,
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    ScrollView,
    TouchableWithoutFeedback,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../../contexts/ThemeContext';

interface SettingsMenuProps {
    visible: boolean;
    onClose: () => void;
    onNavigate: (screen: string) => void;
}

interface MenuSection {
    title: string;
    items: MenuItem[];
}

interface MenuItem {
    icon: string;
    label: string;
    screen: string;
    badge?: string;
}

const menuSections: MenuSection[] = [
    {
        title: 'User',
        items: [
            { icon: 'account-circle', label: 'User Profile', screen: 'ProfileSettings' },
        ],
    },
    {
        title: 'App Settings',
        items: [
            { icon: 'palette', label: 'Appearance & Theme', screen: 'ThemeSettings', badge: '⭐' },
            { icon: 'connection', label: 'Connection Settings', screen: 'ConnectionSettings' },
            { icon: 'shield-lock', label: 'Data & Privacy', screen: 'PrivacySettings' },
            { icon: 'bell', label: 'Notifications', screen: 'NotificationSettings' },
        ],
    },
    {
        title: 'Sync & Connection',
        items: [
            { icon: 'sync', label: 'Sync Settings', screen: 'SyncSettings' },
            { icon: 'link-variant', label: 'Pair with Harmony Link', screen: 'ConnectionSetup' },
        ],
    },
    {
        title: 'Info',
        items: [
            { icon: 'information', label: 'About', screen: 'About' },
            { icon: 'help-circle', label: 'Help & Support', screen: 'Help' },
        ],
    },
    ...(__DEV__ ? [{
        title: 'Development',
        items: [
            { icon: 'test-tube', label: 'Database Tests', screen: 'DatabaseTests', badge: 'DEV' },
            { icon: 'database-eye', label: 'Database Table Viewer', screen: 'DatabaseTableViewer', badge: 'DEV' },
        ],
    }] : []),
];

export const SettingsMenu: React.FC<SettingsMenuProps> = ({
    visible,
    onClose,
    onNavigate,
}) => {
    const { theme } = useAppTheme();

    if (!theme) return null;

    const handleItemPress = (screen: string) => {
        onClose();
        onNavigate(screen);
    };

    return (
        <Modal
            visible={visible}
            transparent
            animationType="fade"
            onRequestClose={onClose}
        >
            <TouchableWithoutFeedback onPress={onClose}>
                <View style={styles.overlay}>
                    <TouchableWithoutFeedback>
                        <View
                            style={[
                                styles.menu,
                                { backgroundColor: theme.colors.background.elevated },
                            ]}
                        >
                            <ScrollView>
                                {menuSections.map((section, sectionIndex) => (
                                    <View key={sectionIndex}>
                                        <Text
                                            style={[
                                                styles.sectionTitle,
                                                { color: theme.colors.text.muted },
                                            ]}
                                        >
                                            {section.title}
                                        </Text>

                                        {section.items.map((item, itemIndex) => (
                                            <TouchableOpacity
                                                key={itemIndex}
                                                style={[
                                                    styles.menuItem,
                                                    { borderBottomColor: theme.colors.border.default },
                                                ]}
                                                onPress={() => handleItemPress(item.screen)}
                                                activeOpacity={0.7}
                                            >
                                                <Icon
                                                    name={item.icon}
                                                    size={24}
                                                    color={theme.colors.accent.primary}
                                                    style={styles.menuIcon}
                                                />
                                                <View style={styles.labelContainer}>
                                                    <Text
                                                        style={[
                                                            styles.menuLabel,
                                                            { color: theme.colors.text.primary },
                                                        ]}
                                                    >
                                                        {item.label}
                                                    </Text>
                                                    {item.badge && (
                                                        <Text style={styles.badge}>{item.badge}</Text>
                                                    )}
                                                </View>
                                                <Icon
                                                    name="chevron-right"
                                                    size={20}
                                                    color={theme.colors.text.muted}
                                                />
                                            </TouchableOpacity>
                                        ))}
                                    </View>
                                ))}
                            </ScrollView>
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
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        justifyContent: 'flex-start',
        alignItems: 'flex-end',
    },
    menu: {
        width: 300,
        maxHeight: '80%',
        marginTop: 56, // Below header
        marginRight: 8,
        borderRadius: 12,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 8,
        overflow: 'hidden',
    },
    sectionTitle: {
        fontSize: 12,
        fontWeight: '600',
        textTransform: 'uppercase',
        paddingHorizontal: 16,
        paddingVertical: 12,
        marginTop: 8,
    },
    menuItem: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 16,
        paddingHorizontal: 16,
        borderBottomWidth: 1,
    },
    menuIcon: {
        marginRight: 16,
    },
    labelContainer: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
    },
    menuLabel: {
        fontSize: 16,
        fontWeight: '500',
    },
    badge: {
        marginLeft: 8,
        fontSize: 12,
    },
});
