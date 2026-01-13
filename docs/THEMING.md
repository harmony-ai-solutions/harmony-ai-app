# Themings System

## Overview
The Harmony AI App features a robust, dynamic theming system that ensures a consistent and modern user interface while allowing for extensive user personalization. The system is built on top of React Context and integrates seamlessly with React Native Paper (Material Design 3).

## Key Features
- **6 Default Themes**: Includes professionally designed themes like Midnight Rose, Classic Harmony, and Forest Night.
- **Dynamic Theme Switching**: Users can switch themes instantly without restarting the app.
- **Advanced Theme Editor**: A feature-rich editor that allows full customization of all theme colors using RGB sliders.
- **Custom Theme Management**: Create, edit, and delete personal themes.
- **Import/Export**: Share themes as JSON files using the system file picker.
- **Persistence**: All theme preferences and custom themes are saved locally using `AsyncStorage`.
- **Harmony Link Sync**: (Planned) Synchronize themes with the Harmony Link backend.

## Theme Structure
A theme in Harmony AI App consists of several color categories:

### Background Colors
- **Base**: The primary background color for screens.
- **Surface**: Used for cards and secondary panels.
- **Elevated**: Used for modals and floating elements.
- **Hover**: Subtle feedback for interactive elements.

### Accent Colors
- **Primary**: The main brand/action color.
- **Secondary**: Used for less prominent interactive elements.

### Status Colors
- **Success**: Indicates completion or positive results.
- **Warning**: Highlights potential issues.
- **Error**: Indicates failures or critical problems.
- **Info**: Used for general informational messages.

### Text Colors
- **Primary**: High-contrast text for main content.
- **Secondary**: Medium-contrast for descriptions.
- **Muted**: Low-contrast for less important details.
- **Disabled**: Indicates non-interactive text.

### Gradients
The system supports CSS-like linear gradients for backgrounds and buttons, parsed and rendered using `react-native-linear-gradient`.

## User Guide

### Switching Themes
1. Tap the burger menu icon [≡] in the top header.
2. Select **Appearance & Theme**.
3. Tap on any theme card in the **AVAILABLE THEMES** list to apply it instantly.

### Creating a Custom Theme
1. In the **Appearance & Theme** screen, tap **Create Custom Theme**.
2. Give your theme a unique name and description.
3. Tap on any color setting to open the **Color Picker Overlay**.
4. Use the **Red, Green, and Blue sliders** to find your perfect color.
5. Tap **Apply** to save the color change.
6. Tap **Save Theme** at the bottom to add it to your collection.

### Deleting a Theme
1. Custom themes show a trash can icon [🗑️] on their card.
2. Tap the icon and confirm deletion in the dialog.
*Note: Built-in themes cannot be deleted.*

### Importing/Exporting
- **Export**: Tap the pencil icon on a custom theme to enter the editor and view its configuration.
- **Import**: Tap **Import Theme** in the theme settings screen to select a `.json` theme file from your device.
