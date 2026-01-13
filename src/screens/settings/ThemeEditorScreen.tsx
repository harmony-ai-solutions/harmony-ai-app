import React, { useState, useEffect, useMemo } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, TextInput } from 'react-native';
import Slider from '@react-native-community/slider';
import { Modal } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../../contexts/ThemeContext';
import { Theme, ThemeColors } from '../../theme/types';
import { ThemedView } from '../../components/themed/ThemedView';
import { ThemedText } from '../../components/themed/ThemedText';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../navigation/AppNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'ThemeEditor'>;

// Helper to convert hex to rgb
const hexToRgb = (hex: string) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : { r: 0, g: 0, b: 0 };
};

// Helper to convert rgb to hex
const rgbToHex = (r: number, g: number, b: number) => {
    return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
};

export const ThemeEditorScreen: React.FC<Props> = ({ navigation, route }) => {
    const { theme: currentAppTheme, availableThemes, createCustomTheme, updateCustomTheme } = useAppTheme();

    const editingThemeId = route.params?.themeId;
    const baseTheme = useMemo(() => {
        if (editingThemeId) {
            return availableThemes.find(t => t.id === editingThemeId);
        }
        return currentAppTheme; // Default to current theme as base
    }, [editingThemeId, availableThemes, currentAppTheme]);

    if (!currentAppTheme || !baseTheme) return null;

    const [name, setName] = useState(editingThemeId ? baseTheme.name : `${baseTheme.name} (Copy)`);
    const [colors, setColors] = useState<ThemeColors>(JSON.parse(JSON.stringify(baseTheme.colors)));

    // Color picker state
    const [pickerVisible, setPickerVisible] = useState(false);
    const [activeCategory, setActiveCategory] = useState<keyof ThemeColors | null>(null);
    const [activeColorKey, setActiveColorKey] = useState<string | null>(null);
    const [r, setR] = useState(0);
    const [g, setG] = useState(0);
    const [b, setB] = useState(0);

    const currentColorHex = useMemo(() => rgbToHex(r, g, b), [r, g, b]);

    const openColorPicker = (category: keyof ThemeColors, key: string) => {
        const color = (colors[category] as any)[key];
        if (typeof color === 'string' && color.startsWith('#')) {
            const rgb = hexToRgb(color);
            setR(rgb.r);
            setG(rgb.g);
            setB(rgb.b);
            setActiveCategory(category);
            setActiveColorKey(key);
            setPickerVisible(true);
        }
    };

    const handleColorSave = () => {
        if (activeCategory && activeColorKey) {
            const newColors = { ...colors };
            (newColors[activeCategory] as any)[activeColorKey] = currentColorHex;
            
            // Special handling for gradients (simple implementation: just solid color for now or placeholder)
            // In a real app we might want to update gradient colors too if they match
            
            setColors(newColors);
            setPickerVisible(false);
        }
    };

    const handleSave = async () => {
        try {
            const newThemeId = editingThemeId && baseTheme.isCustom ? editingThemeId : `custom-${Date.now()}`;
            const newTheme: Theme = {
                ...baseTheme,
                name: name,
                id: newThemeId,
                colors: colors,
                isCustom: true,
            };

            if (editingThemeId && baseTheme.isCustom) {
                await updateCustomTheme(editingThemeId, newTheme);
            } else {
                await createCustomTheme(newTheme);
            }
            navigation.goBack();
        } catch (e) {
            console.error("Failed to save theme", e);
        }
    };

    const renderColorItem = (category: keyof ThemeColors, key: string, label: string) => {
        const color = (colors[category] as any)[key];
        if (typeof color !== 'string' || !color.startsWith('#')) return null;

        return (
            <TouchableOpacity
                key={`${category}-${key}`}
                style={[styles.colorItem, { borderBottomColor: currentAppTheme.colors.border.default }]}
                onPress={() => openColorPicker(category, key)}
            >
                <View style={[styles.colorPreview, { backgroundColor: color, borderColor: currentAppTheme.colors.border.default }]} />
                <View style={styles.colorInfo}>
                    <ThemedText weight="medium">{label}</ThemedText>
                    <ThemedText variant="muted" size={12}>{color.toUpperCase()}</ThemedText>
                </View>
                <Icon name="pencil" size={20} color={currentAppTheme.colors.text.muted} />
            </TouchableOpacity>
        );
    };

    return (
        <ThemedView style={styles.container}>
            <View style={[styles.header, { borderBottomColor: currentAppTheme.colors.border.default }]}>
                <TouchableOpacity onPress={() => navigation.goBack()}>
                    <ThemedText variant="secondary">Cancel</ThemedText>
                </TouchableOpacity>
                <ThemedText weight="bold" size={18}>
                    {editingThemeId && baseTheme.isCustom ? 'Edit Theme' : 'New Theme'}
                </ThemedText>
                <TouchableOpacity onPress={handleSave}>
                    <ThemedText variant="accent" weight="bold">Save</ThemedText>
                </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.content}>
                <View style={styles.section}>
                    <ThemedText style={styles.label}>Theme Name</ThemedText>
                    <TextInput
                        style={[styles.input, { color: currentAppTheme.colors.text.primary, borderColor: currentAppTheme.colors.border.default, backgroundColor: currentAppTheme.colors.background.surface }]}
                        value={name}
                        onChangeText={setName}
                        placeholder="Enter theme name"
                        placeholderTextColor={currentAppTheme.colors.text.disabled}
                    />
                </View>

                <View style={styles.section}>
                    <ThemedText style={styles.sectionTitle}>Accents</ThemedText>
                    {renderColorItem('accent', 'primary', 'Primary')}
                    {renderColorItem('accent', 'secondary', 'Secondary')}
                </View>

                <View style={styles.section}>
                    <ThemedText style={styles.sectionTitle}>Backgrounds</ThemedText>
                    {renderColorItem('background', 'base', 'Base Background')}
                    {renderColorItem('background', 'surface', 'Surface')}
                    {renderColorItem('background', 'elevated', 'Elevated')}
                </View>

                <View style={styles.section}>
                    <ThemedText style={styles.sectionTitle}>Status Colors</ThemedText>
                    {renderColorItem('status', 'success', 'Success')}
                    {renderColorItem('status', 'warning', 'Warning')}
                    {renderColorItem('status', 'error', 'Error')}
                    {renderColorItem('status', 'info', 'Info')}
                </View>

                <View style={styles.section}>
                    <ThemedText style={styles.sectionTitle}>Text Colors</ThemedText>
                    {renderColorItem('text', 'primary', 'Primary Text')}
                    {renderColorItem('text', 'secondary', 'Secondary Text')}
                    {renderColorItem('text', 'muted', 'Muted Text')}
                </View>
            </ScrollView>

            <Modal
                visible={pickerVisible}
                transparent
                animationType="slide"
                onRequestClose={() => setPickerVisible(false)}
            >
                <View style={styles.modalOverlay}>
                    <ThemedView style={styles.modalContent}>
                        <View style={styles.modalHeader}>
                            <ThemedText weight="bold" size={18}>Edit Color</ThemedText>
                            <ThemedText variant="muted">{activeColorKey}</ThemedText>
                        </View>

                        <View style={[styles.previewBox, { backgroundColor: currentColorHex, borderColor: currentAppTheme.colors.border.default }]} />
                        <ThemedText style={styles.hexCode}>{currentColorHex.toUpperCase()}</ThemedText>

                        <View style={styles.sliderContainer}>
                            <ThemedText style={styles.sliderLabel}>Red: {Math.round(r)}</ThemedText>
                            <Slider
                                style={styles.slider}
                                minimumValue={0}
                                maximumValue={255}
                                step={1}
                                value={r}
                                onValueChange={setR}
                                minimumTrackTintColor="#ff5555"
                                maximumTrackTintColor={currentAppTheme.colors.border.default}
                                thumbTintColor="#ff5555"
                            />
                        </View>

                        <View style={styles.sliderContainer}>
                            <ThemedText style={styles.sliderLabel}>Green: {Math.round(g)}</ThemedText>
                            <Slider
                                style={styles.slider}
                                minimumValue={0}
                                maximumValue={255}
                                step={1}
                                value={g}
                                onValueChange={setG}
                                minimumTrackTintColor="#55ff55"
                                maximumTrackTintColor={currentAppTheme.colors.border.default}
                                thumbTintColor="#55ff55"
                            />
                        </View>

                        <View style={styles.sliderContainer}>
                            <ThemedText style={styles.sliderLabel}>Blue: {Math.round(b)}</ThemedText>
                            <Slider
                                style={styles.slider}
                                minimumValue={0}
                                maximumValue={255}
                                step={1}
                                value={b}
                                onValueChange={setB}
                                minimumTrackTintColor="#5555ff"
                                maximumTrackTintColor={currentAppTheme.colors.border.default}
                                thumbTintColor="#5555ff"
                            />
                        </View>

                        <View style={styles.modalFooter}>
                            <TouchableOpacity style={styles.modalButton} onPress={() => setPickerVisible(false)}>
                                <ThemedText variant="secondary">Cancel</ThemedText>
                            </TouchableOpacity>
                            <TouchableOpacity style={[styles.modalButton, styles.saveButton]} onPress={handleColorSave}>
                                <ThemedText weight="bold" style={{ color: '#fff' }}>Apply</ThemedText>
                            </TouchableOpacity>
                        </View>
                    </ThemedView>
                </View>
            </Modal>
        </ThemedView>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingTop: 48,
        paddingHorizontal: 16,
        paddingBottom: 16,
        borderBottomWidth: 1,
    },
    content: {
        padding: 20,
    },
    section: {
        marginBottom: 32,
    },
    label: {
        marginBottom: 8,
        fontSize: 16,
        fontWeight: '600',
    },
    input: {
        borderWidth: 1,
        borderRadius: 8,
        padding: 12,
        fontSize: 16,
    },
    sectionTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        marginTop: 16,
        marginBottom: 12,
    },
    colorItem: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 12,
        borderBottomWidth: 1,
    },
    colorPreview: {
        width: 40,
        height: 40,
        borderRadius: 20,
        borderWidth: 1,
        marginRight: 16,
    },
    colorInfo: {
        flex: 1,
    },
    previewBox: {
        height: 100,
        borderRadius: 12,
        marginBottom: 12,
        borderWidth: 1,
    },
    hexCode: {
        textAlign: 'center',
        marginBottom: 20,
        fontFamily: 'monospace',
        fontSize: 16,
    },
    sliderContainer: {
        marginBottom: 16,
    },
    sliderLabel: {
        marginBottom: 4,
        fontSize: 14,
    },
    slider: {
        width: '100%',
        height: 40,
    },
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'center',
        padding: 20,
    },
    modalContent: {
        borderRadius: 16,
        padding: 24,
        elevation: 5,
    },
    modalHeader: {
        marginBottom: 20,
    },
    modalFooter: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        marginTop: 24,
    },
    modalButton: {
        paddingVertical: 10,
        paddingHorizontal: 20,
        marginLeft: 12,
    },
    saveButton: {
        backgroundColor: '#ec4899',
        borderRadius: 8,
    }
});
