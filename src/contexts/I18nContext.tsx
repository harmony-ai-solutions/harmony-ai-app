/**
 * I18n Context
 *
 * Provides i18next translation infrastructure to the entire app.
 * Follows the same pattern as ThemeContext, DatabaseContext, etc.
 */

import React, { createContext, useContext, useEffect, useState } from 'react';
import { I18nextProvider } from 'react-i18next';
import i18n, { InitOptions } from 'i18next';
import { initReactI18next } from 'react-i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createLogger } from '../utils/logger';

const log = createLogger('[I18nContext]');

// ── Locale resources ────────────────────────────────────────────────────────

import common from '../i18n/locales/en/common.json';
import landing from '../i18n/locales/en/landing.json';
import chatList from '../i18n/locales/en/chatList.json';
import chatDetail from '../i18n/locales/en/chatDetail.json';
import characters from '../i18n/locales/en/characters.json';
import createAI from '../i18n/locales/en/createAI.json';
import settings from '../i18n/locales/en/settings.json';
import connection from '../i18n/locales/en/connection.json';
import theme from '../i18n/locales/en/theme.json';
import profile from '../i18n/locales/en/profile.json';
import entityConfig from '../i18n/locales/en/entityConfig.json';
import modals from '../i18n/locales/en/modals.json';
import navigation from '../i18n/locales/en/navigation.json';
import database from '../i18n/locales/en/database.json';
import config from '../i18n/locales/en/config.json';
import development from '../i18n/locales/en/development.json';

// ── Storage key ─────────────────────────────────────────────────────────────

const STORAGE_KEY_LANGUAGE = '@harmony_language';

// ── Available languages ─────────────────────────────────────────────────────

export const SUPPORTED_LANGUAGES = {
  en: 'English',
} as const;

export type SupportedLanguage = keyof typeof SUPPORTED_LANGUAGES;

// ── Context type ────────────────────────────────────────────────────────────

interface I18nContextType {
  currentLanguage: SupportedLanguage;
  isInitialized: boolean;
  setLanguage: (lang: SupportedLanguage) => Promise<void>;
}

const I18nContext = createContext<I18nContextType>({
  currentLanguage: 'en',
  isInitialized: false,
  setLanguage: async () => {},
});

// ── Resources object ────────────────────────────────────────────────────────

const resources = {
  en: {
    common,
    landing,
    chatList,
    chatDetail,
    characters,
    createAI,
    settings,
    connection,
    theme,
    profile,
    entityConfig,
    modals,
    navigation,
    database,
    config,
    development,
  },
};

// ── i18n configuration ──────────────────────────────────────────────────────

const i18nConfig: InitOptions = {
  resources,
  lng: 'en',
  fallbackLng: 'en',
  defaultNS: 'common',
  ns: [
    'common',
    'landing',
    'chatList',
    'chatDetail',
    'characters',
    'createAI',
    'settings',
    'connection',
    'theme',
    'profile',
    'entityConfig',
    'modals',
    'navigation',
    'database',
    'config',
    'development',
  ],
  interpolation: {
    escapeValue: false, // React already escapes
  },
  compatibilityJSON: 'v4',
};

// ── Initialize i18next ──────────────────────────────────────────────────────

let i18nInitialized = false;

async function initializeI18n(): Promise<void> {
  if (i18nInitialized) return;

  try {
    // Load stored language preference
    const storedLang = await AsyncStorage.getItem(STORAGE_KEY_LANGUAGE);
    if (storedLang && storedLang in SUPPORTED_LANGUAGES) {
      i18nConfig.lng = storedLang;
    }

    await i18n.use(initReactI18next).init(i18nConfig);
    i18nInitialized = true;
    log.info('i18n initialized with language:', i18n.language);
  } catch (err) {
    log.error('Failed to initialize i18n:', err);
    // Fallback: init without async storage
    await i18n.use(initReactI18next).init({
      ...i18nConfig,
      lng: 'en',
    });
    i18nInitialized = true;
  }
}

// ── Provider ────────────────────────────────────────────────────────────────

interface I18nProviderProps {
  children: React.ReactNode;
}

export const I18nProvider: React.FC<I18nProviderProps> = ({ children }) => {
  const [isInitialized, setIsInitialized] = useState(false);
  const [currentLanguage, setCurrentLanguage] = useState<SupportedLanguage>('en');

  useEffect(() => {
    initializeI18n().then(() => {
      setCurrentLanguage(i18n.language as SupportedLanguage);
      setIsInitialized(true);
    });
  }, []);

  const setLanguage = async (lang: SupportedLanguage) => {
    try {
      await i18n.changeLanguage(lang);
      await AsyncStorage.setItem(STORAGE_KEY_LANGUAGE, lang);
      setCurrentLanguage(lang);
      log.info('Language changed to:', lang);
    } catch (err) {
      log.error('Failed to change language:', err);
      throw err;
    }
  };

  const value: I18nContextType = {
    currentLanguage,
    isInitialized,
    setLanguage,
  };

  return (
    <I18nContext.Provider value={value}>
      <I18nextProvider i18n={i18n}>
        {children}
      </I18nextProvider>
    </I18nContext.Provider>
  );
};

// ── Hook ────────────────────────────────────────────────────────────────────

export const useI18n = (): I18nContextType => {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used within I18nProvider');
  }
  return context;
};

export default i18n;
