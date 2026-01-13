import { Theme } from '../types';

export const forestNight: Theme = {
    id: 'forest-night',
    name: 'Forest Night',
    description: 'Natural soothing theme with emerald accents',
    version: '1.0.0',
    colors: {
        background: {
            base: '#052e16',
            surface: '#064e3b',
            elevated: '#065f46',
            hover: '#047857',
        },
        accent: {
            primary: '#10b981',
            primaryHover: '#34d399',
            secondary: '#14b8a6',
            secondaryHover: '#2dd4bf',
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
            primary: '#f0fdf4',
            secondary: '#dcfce7',
            muted: '#bbf7d0',
            disabled: '#86efac',
        },
        border: {
            default: '#065f46',
            focus: '#10b981',
            hover: '#047857',
            accent: '#10b981',
        },
        gradients: {
            primary: 'linear-gradient(135deg, #10b981 0%, #14b8a6 100%)',
            secondary: 'linear-gradient(135deg, #052e16 0%, #064e3b 100%)',
            surface: 'linear-gradient(135deg, rgba(16, 185, 129, 0.05) 0%, rgba(20, 184, 166, 0.05) 100%)',
        },
    },
};
