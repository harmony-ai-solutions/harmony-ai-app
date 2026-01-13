/**
 * Theme System Type Definitions
 * Matches Harmony Link's theme structure for cross-platform consistency
 */

/**
 * Background color variants
 */
export interface BackgroundColors {
  base: string;      // Main background color
  surface: string;   // Card/panel background
  elevated: string;  // Elevated elements (modals, popovers)
  hover: string;     // Hover state background
}

/**
 * Accent colors for primary UI elements
 */
export interface AccentColors {
  primary: string;           // Primary accent color
  primaryHover: string;      // Primary hover state
  secondary: string;         // Secondary accent
  secondaryHover: string;    // Secondary hover state
}

/**
 * Status/semantic colors with backgrounds
 */
export interface StatusColors {
  success: string;       // Success text color
  successBg: string;     // Success background (with alpha)
  warning: string;       // Warning text color
  warningBg: string;     // Warning background
  error: string;         // Error text color
  errorBg: string;       // Error background
  info: string;          // Info text color
  infoBg: string;        // Info background
}

/**
 * Text color hierarchy
 */
export interface TextColors {
  primary: string;      // Primary text
  secondary: string;    // Secondary/less prominent text
  muted: string;        // Muted/helper text
  disabled: string;     // Disabled state text
}

/**
 * Border colors for various states
 */
export interface BorderColors {
  default: string;      // Default border color
  focus: string;        // Focused element border
  hover: string;        // Hover state border
  accent: string;       // Accent border (highlights)
}

/**
 * Gradient definitions (CSS gradient strings)
 */
export interface Gradients {
  primary: string;      // Primary gradient (buttons, headers)
  secondary: string;    // Secondary gradient
  surface: string;      // Subtle surface gradient
}

/**
 * Complete color palette for a theme
 */
export interface ThemeColors {
  background: BackgroundColors;
  accent: AccentColors;
  status: StatusColors;
  text: TextColors;
  border: BorderColors;
  gradients: Gradients;
}

/**
 * Complete theme definition
 */
export interface Theme {
  id: string;                // Unique identifier (e.g., 'midnight-rose')
  name: string;              // Display name
  description: string;       // Theme description
  version: string;           // Theme version (semver)
  colors: ThemeColors;       // Complete color palette
  isCustom?: boolean;        // True if user-created
  isSynced?: boolean;        // True if synced with Harmony Link
  lastModified?: string;     // ISO timestamp of last modification
}

/**
 * Theme mode options
 */
export type ThemeMode = 
  | 'system'           // Follow system appearance
  | string;            // Specific theme ID

/**
 * Sync status for themes
 */
export interface ThemeSyncStatus {
  lastSync?: string;          // ISO timestamp
  pendingChanges: boolean;    // Has unsaved local changes
  syncEnabled: boolean;       // Is sync with Harmony Link enabled
}

/**
 * Theme context state
 */
export interface ThemeContextType {
  // Current theme
  theme: Theme | null;
  
  // All available themes
  availableThemes: Theme[];
  
  // Theme mode preference
  themeMode: ThemeMode;
  
  // Loading state
  loading: boolean;
  
  // Error state
  error: Error | null;
  
  // Sync status
  syncStatus: ThemeSyncStatus;
  
  // Actions
  switchTheme: (themeId: string) => Promise<void>;
  setThemeMode: (mode: ThemeMode) => Promise<void>;
  createCustomTheme: (theme: Theme) => Promise<void>;
  updateCustomTheme: (themeId: string, theme: Theme) => Promise<void>;
  deleteCustomTheme: (themeId: string) => Promise<void>;
  importTheme: (themeJson: string) => Promise<void>;
  exportTheme: (themeId: string) => Promise<string>;
  syncWithHarmonyLink: () => Promise<void>;
  refreshThemes: () => Promise<void>;
}

/**
 * React Native Paper theme mapping
 * Converts our theme structure to Paper's MD3Theme format
 */
export interface PaperThemeColors {
  primary: string;
  onPrimary: string;
  primaryContainer: string;
  onPrimaryContainer: string;
  secondary: string;
  onSecondary: string;
  secondaryContainer: string;
  onSecondaryContainer: string;
  tertiary: string;
  onTertiary: string;
  tertiaryContainer: string;
  onTertiaryContainer: string;
  error: string;
  onError: string;
  errorContainer: string;
  onErrorContainer: string;
  background: string;
  onBackground: string;
  surface: string;
  onSurface: string;
  surfaceVariant: string;
  onSurfaceVariant: string;
  outline: string;
  outlineVariant: string;
  shadow: string;
  scrim: string;
  inverseSurface: string;
  inverseOnSurface: string;
  inversePrimary: string;
  elevation: {
    level0: string;
    level1: string;
    level2: string;
    level3: string;
    level4: string;
    level5: string;
  };
  surfaceDisabled: string;
  onSurfaceDisabled: string;
  backdrop: string;
}
