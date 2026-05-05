/**
 * EmojiContext - Manages emoji style preferences and recent emojis
 */
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { EmojiSet } from '../types/emoji';
import { createLogger } from '../utils/logger';
import EmojiService from '../services/EmojiService';

const log = createLogger('[EmojiContext]');

// Storage keys
const STORAGE_KEY_EMOJI_SET = '@harmony_emoji_set';
const STORAGE_KEY_SKIN_TONE = '@harmony_emoji_skin_tone';
const STORAGE_KEY_RECENT = '@harmony_emoji_recent';

// Max recent emojis
const MAX_RECENT_EMOJIS = 40;

// Recent emoji interface
export interface RecentEmoji {
  id: string;
  native: string;
  timestamp: number;
}

// Context type
interface EmojiContextType {
  emojiSet: EmojiSet;
  skinTone: number;
  recentEmojis: RecentEmoji[];
  loading: boolean;
  setEmojiSet: (set: EmojiSet) => Promise<void>;
  setSkinTone: (tone: number) => Promise<void>;
  addRecentEmoji: (id: string, native: string) => Promise<void>;
  clearRecentEmojis: () => Promise<void>;
  emojiService: typeof EmojiService;
}

// Create context
const EmojiContext = createContext<EmojiContextType | undefined>(undefined);

/**
 * Emoji Provider Component
 */
export const EmojiProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [emojiSet, setEmojiSetState] = useState<EmojiSet>('native');
  const [skinTone, setSkinToneState] = useState<number>(1);
  const [recentEmojis, setRecentEmojis] = useState<RecentEmoji[]>([]);
  const [loading, setLoading] = useState(true);

  /**
   * Load emoji preferences from storage
   */
  const loadPreferences = useCallback(async () => {
    try {
      setLoading(true);

      // Initialize emoji service (idempotent)
      await EmojiService.initialize();

      // Load emoji set
      const savedSet = await AsyncStorage.getItem(STORAGE_KEY_EMOJI_SET);
      if (savedSet && ['native', 'noto', 'twemoji'].includes(savedSet)) {
        setEmojiSetState(savedSet as EmojiSet);
      }

      // Load skin tone
      const savedTone = await AsyncStorage.getItem(STORAGE_KEY_SKIN_TONE);
      if (savedTone) {
        const tone = parseInt(savedTone, 10);
        if (tone >= 1 && tone <= 6) {
          setSkinToneState(tone);
        }
      }

      // Load recent emojis
      const savedRecent = await AsyncStorage.getItem(STORAGE_KEY_RECENT);
      if (savedRecent) {
        try {
          const parsed = JSON.parse(savedRecent);
          if (Array.isArray(parsed)) {
            setRecentEmojis(parsed);
          }
        } catch (e) {
          log.warn('Failed to parse recent emojis:', e);
        }
      }

      log.debug('Emoji preferences loaded');
    } catch (error) {
      log.error('Failed to load emoji preferences:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Set emoji set preference
   */
  const setEmojiSet = useCallback(async (set: EmojiSet) => {
    try {
      setEmojiSetState(set);
      await AsyncStorage.setItem(STORAGE_KEY_EMOJI_SET, set);
      log.debug('Emoji set changed to:', set);
    } catch (error) {
      log.error('Failed to save emoji set:', error);
      throw error;
    }
  }, []);

  /**
   * Set skin tone preference
   */
  const setSkinTone = useCallback(async (tone: number) => {
    if (tone < 1 || tone > 6) {
      log.warn('Invalid skin tone:', tone);
      return;
    }

    try {
      setSkinToneState(tone);
      await AsyncStorage.setItem(STORAGE_KEY_SKIN_TONE, String(tone));
      log.debug('Skin tone changed to:', tone);
    } catch (error) {
      log.error('Failed to save skin tone:', error);
      throw error;
    }
  }, []);

  /**
   * Add emoji to recent list
   */
  const addRecentEmoji = useCallback(async (id: string, native: string) => {
    try {
      setRecentEmojis(prev => {
        // Remove existing if present
        const filtered = prev.filter(e => e.id !== id);
        // Add to front with timestamp
        const updated = [
          { id, native, timestamp: Date.now() },
          ...filtered,
        ];
        // Limit to max
        const limited = updated.slice(0, MAX_RECENT_EMOJIS);

        // Save to storage (async, don't await)
        AsyncStorage.setItem(STORAGE_KEY_RECENT, JSON.stringify(limited)).catch(err => {
          log.error('Failed to save recent emojis:', err);
        });

        return limited;
      });
    } catch (error) {
      log.error('Failed to add recent emoji:', error);
    }
  }, []);

  /**
   * Clear recent emojis
   */
  const clearRecentEmojis = useCallback(async () => {
    try {
      setRecentEmojis([]);
      await AsyncStorage.removeItem(STORAGE_KEY_RECENT);
      log.debug('Recent emojis cleared');
    } catch (error) {
      log.error('Failed to clear recent emojis:', error);
      throw error;
    }
  }, []);

  // Load on mount
  useEffect(() => {
    loadPreferences();
  }, [loadPreferences]);

  // Context value
  const value: EmojiContextType = {
    emojiSet,
    skinTone,
    recentEmojis,
    loading,
    setEmojiSet,
    setSkinTone,
    addRecentEmoji,
    clearRecentEmojis,
    emojiService: EmojiService,
  };

  return (
    <EmojiContext.Provider value={value}>
      {children}
    </EmojiContext.Provider>
  );
};

/**
 * Hook to use emoji context
 */
export const useEmoji = (): EmojiContextType => {
  const context = useContext(EmojiContext);
  if (!context) {
    throw new Error('useEmoji must be used within EmojiProvider');
  }
  return context;
};

export default EmojiContext;