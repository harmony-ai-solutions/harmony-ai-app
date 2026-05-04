# Phase 3: Emoji Style Context

## Objective

Create an `EmojiContext` that manages the user's preferred emoji set and skin tone, persisted to AsyncStorage. This follows the exact same pattern as the existing `ThemeContext`.

## Codebase References

- [`src/contexts/ThemeContext.tsx`](../../src/contexts/ThemeContext.tsx) — primary pattern reference for context + AsyncStorage + provider
- [`src/types/emoji.ts`](../../src/types/emoji.ts) — `EmojiSet`, `EmojiStylePreference` types
- [`src/services/EmojiService.ts`](../../src/services/EmojiService.ts) — service to initialize on mount
- [`App.tsx`](../../App.tsx) — provider nesting
- [`.planning/codebase/CONVENTIONS.md`](../../.planning/codebase/CONVENTIONS.md) — context pattern conventions

---

## Task 1 — Create EmojiContext

**File:** `src/contexts/EmojiContext.tsx`

```typescript
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import EmojiService from '../services/EmojiService';
import { EmojiSet, EmojiStylePreference } from '../types/emoji';
import { createLogger } from '../utils/logger';

const log = createLogger('[EmojiContext]');

const STORAGE_KEY_EMOJI_SET = '@harmony_emoji_set';
const STORAGE_KEY_SKIN_TONE = '@harmony_emoji_skin_tone';
const STORAGE_KEY_RECENT = '@harmony_emoji_recent';

const DEFAULT_SET: EmojiSet = 'native';
const DEFAULT_SKIN_TONE = 1;
const MAX_RECENT_EMOJIS = 40;

interface RecentEmoji {
  id: string;
  native: string;
  timestamp: number;
}

interface EmojiContextType {
  // Current preferences
  emojiSet: EmojiSet;
  skinTone: number;
  recentEmojis: RecentEmoji[];
  
  // Loading state
  loading: boolean;
  
  // Actions
  setEmojiSet: (set: EmojiSet) => Promise<void>;
  setSkinTone: (tone: number) => Promise<void>;
  addRecentEmoji: (id: string, native: string) => Promise<void>;
  clearRecentEmojis: () => Promise<void>;
  
  // Service access
  emojiService: typeof EmojiService;
}

const EmojiContext = createContext<EmojiContextType | undefined>(undefined);

export const EmojiProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [emojiSet, setEmojiSetState] = useState<EmojiSet>(DEFAULT_SET);
  const [skinTone, setSkinToneState] = useState<number>(DEFAULT_SKIN_TONE);
  const [recentEmojis, setRecentEmojis] = useState<RecentEmoji[]>([]);
  const [loading, setLoading] = useState(true);

  /**
   * Load preferences from AsyncStorage and initialize EmojiService
   */
  const loadPreferences = useCallback(async () => {
    try {
      setLoading(true);
      
      // Initialize emoji data service
      await EmojiService.initialize();
      
      // Load saved preferences
      const [savedSet, savedSkinTone, savedRecent] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEY_EMOJI_SET),
        AsyncStorage.getItem(STORAGE_KEY_SKIN_TONE),
        AsyncStorage.getItem(STORAGE_KEY_RECENT),
      ]);
      
      if (savedSet) {
        setEmojiSetState(savedSet as EmojiSet);
      }
      if (savedSkinTone) {
        setSkinToneState(parseInt(savedSkinTone, 10));
      }
      if (savedRecent) {
        setRecentEmojis(JSON.parse(savedRecent));
      }
    } catch (error) {
      log.error('Failed to load emoji preferences:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Switch emoji image set
   */
  const setEmojiSet = useCallback(async (set: EmojiSet) => {
    try {
      setEmojiSetState(set);
      await AsyncStorage.setItem(STORAGE_KEY_EMOJI_SET, set);
      log.info(`Switched emoji set to: ${set}`);
    } catch (error) {
      log.error('Failed to save emoji set preference:', error);
      throw error;
    }
  }, []);

  /**
   * Set preferred skin tone (1-6)
   */
  const setSkinTone = useCallback(async (tone: number) => {
    try {
      const clamped = Math.max(1, Math.min(6, tone));
      setSkinToneState(clamped);
      await AsyncStorage.setItem(STORAGE_KEY_SKIN_TONE, String(clamped));
    } catch (error) {
      log.error('Failed to save skin tone preference:', error);
      throw error;
    }
  }, []);

  /**
   * Add an emoji to the recent list (moves to front, deduplicates, caps at MAX_RECENT_EMOJIS)
   */
  const addRecentEmoji = useCallback(async (id: string, native: string) => {
    try {
      const updated: RecentEmoji[] = [
        { id, native, timestamp: Date.now() },
        ...recentEmojis.filter(r => r.id !== id),
      ].slice(0, MAX_RECENT_EMOJIS);
      
      setRecentEmojis(updated);
      await AsyncStorage.setItem(STORAGE_KEY_RECENT, JSON.stringify(updated));
    } catch (error) {
      log.error('Failed to save recent emoji:', error);
    }
  }, [recentEmojis]);

  /**
   * Clear recent emojis list
   */
  const clearRecentEmojis = useCallback(async () => {
    try {
      setRecentEmojis([]);
      await AsyncStorage.removeItem(STORAGE_KEY_RECENT);
    } catch (error) {
      log.error('Failed to clear recent emojis:', error);
    }
  }, []);

  // Load on mount
  useEffect(() => {
    loadPreferences();
  }, [loadPreferences]);

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
 * Hook to access emoji context
 */
export const useEmoji = (): EmojiContextType => {
  const context = useContext(EmojiContext);
  if (!context) {
    throw new Error('useEmoji must be used within EmojiProvider');
  }
  return context;
};
```

---

## Task 2 — Add EmojiProvider to App.tsx

**File:** `App.tsx`

Add `EmojiProvider` to the provider nesting. It should wrap the same level as `ThemeProvider` since it's independent:

```typescript
import { EmojiProvider } from './src/contexts/EmojiContext';

// Inside App component render:
<ThemeProvider>
  <DatabaseProvider>
    <SyncConnectionProvider>
      <EntitySessionProvider>
        <EmojiProvider>          {/* ← ADD HERE, inside other providers */}
          <AppNavigator navigationRef={navigationRef} />
        </EmojiProvider>
      </EntitySessionProvider>
    </SyncConnectionProvider>
  </DatabaseProvider>
</ThemeProvider>
```

Place it as the innermost provider (or near innermost) since it depends on nothing except being initialized. The `EmojiService.initialize()` call inside it is idempotent.

---

## Progress Checklist

- [ ] `src/contexts/EmojiContext.tsx` created with provider, hooks, AsyncStorage persistence
- [ ] `useEmoji()` hook exported and functional
- [ ] `EmojiProvider` added to `App.tsx` provider tree
- [ ] Emoji preferences survive app restart (AsyncStorage round-trip works)
- [ ] `EmojiService.initialize()` is called once on provider mount
