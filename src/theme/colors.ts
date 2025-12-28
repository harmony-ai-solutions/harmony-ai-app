/**
 * Color palette matching Harmony Link design
 */
export const colors = {
  // Primary colors
  background: '#282828',      // rgb(40, 40, 40)
  surface: '#404040',
  primary: '#ea580c',         // Orange accent
  
  // Gray scale
  gray: {
    50: '#f5f5f5',
    100: '#888888',
    200: '#666666',
    300: '#404040',
    400: '#282828',
  },
  
  // Text colors
  text: {
    primary: '#f5f5f5',
    secondary: '#888888',
    disabled: '#666666',
  },
  
  // UI elements
  border: '#666666',
  divider: '#404040',
  
  // Status colors
  success: '#4ade80',
  warning: '#fbbf24',
  error: '#ef4444',
  info: '#3b82f6',
  
  // Chat bubbles
  userMessage: '#ea580c',
  aiMessage: '#404040',
};

export type Colors = typeof colors;
