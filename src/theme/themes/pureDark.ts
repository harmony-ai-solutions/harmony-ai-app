import { Theme } from '../types';

export const pureDark: Theme = {
    id: 'pure-dark',
    name: 'Pure Dark',
    description: 'Minimalist OLED-friendly theme with subtle gray accents',
    version: '1.0.0',
    colors: {
        background: {
            base: '#000000',
            surface: '#0a0a0a',
            elevated: '#171717',
            hover: '#262626',
        },
        accent: {
            primary: '#6b7280',
            primaryHover: '#9ca3af',
            secondary: '#4b5563',
            secondaryHover: '#6b7280',
        },
        status: {
            success: '#10b981',
            successBg: 'rgba(16, 185, 129, 0.1)',
            warning: '#f59e0b',
            warningBg: 'rgba(245, 158, 11, 0.1)',
            error: '#ef4444',
            errorBg: 'rgba(239, 68, 68, 0.1)',
            info: '#3b82f6',
            infoBg: 'rgba(59, 130, 246, 0.1)',
        },
        text: {
            primary: '#ffffff',
            secondary: '#e5e7eb',
            muted: '#9ca3af',
            disabled: '#6b7280',
        },
        border: {
            default: '#262626',
            focus: '#6b7280',
            hover: '#404040',
            accent: '#6b7280',
        },
        gradients: {
            primary: 'linear-gradient(135deg, #6b7280 0%, #4b5563 100%)',
            secondary: 'linear-gradient(135deg, #000000 0%, #0a0a0a 100%)',
            surface: 'linear-gradient(135deg, rgba(107, 114, 128, 0.05) 0%, rgba(75, 85, 99, 0.05) 100%)',
        },
    },
};
