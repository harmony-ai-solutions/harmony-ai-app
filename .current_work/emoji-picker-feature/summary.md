# Emoji Picker Feature — Implementation Plan

## Overview

Add a native emoji picker to the chat UI screen, allowing users to browse, search, and insert emojis into messages. Users can switch between **three bundled emoji base designs** (Native / System, Google Noto, Twemoji) via the Appearance & Theme settings screen.

**Approach:** Hybrid (Proposal C) — use `@emoji-mart/data` for emoji metadata and headless search, `emoji-datasource` sprite sheets for bundled images, and a fully custom native React Native picker UI built with the existing ThemedView/ThemedText component system.

**Emoji Sets (all bundled, all open-licensed):**
| Set | License | Source |
|-----|---------|--------|
| **Native (System)** | N/A | OS-provided Unicode rendering |
| **Google Noto** | Apache 2.0 / SIL OFL 1.1 | `emoji-datasource-google` sprite sheets |
| **Twemoji** | CC-BY 4.0 (graphics) / MIT (code) | `emoji-datasource-twitter` sprite sheets (via jdecked/twemoji fork) |

**Codebase mapping reference:** [`.planning/codebase/CONVENTIONS.md`](../../.planning/codebase/CONVENTIONS.md) | [`.planning/codebase/ARCHITECTURE.md`](../../.planning/codebase/ARCHITECTURE.md)

---

## Phases

1. **Dependencies & Asset Setup** — Install npm packages, bundle sprite sheet assets, configure Metro for PNG assets.
2. **Emoji Data Service** — Create `EmojiService` that loads emoji metadata, resolves images per active set, manages categories and search.
3. **Emoji Style Context** — Create `EmojiContext` with AsyncStorage persistence for the user's preferred emoji set, following ThemeContext patterns.
4. **Emoji Picker UI — Core Grid & Categories** — Build the native picker component with category tabs, emoji grid (FlatList), and theming.
5. **Emoji Picker UI — Search & Skin Tones** — Add search bar with debounced search, skin tone long-press selector, and recent/frequent emoji tracking.
6. **ChatInput Integration** — Add emoji toggle button to ChatInput, wire up the picker modal, handle emoji insertion into the text input.
7. **Settings Integration** — Add "Emoji Style" section to ThemeSettingsScreen with visual preview cards for each emoji set.
8. **Attribution & Documentation** — Add third-party attribution section to README.md for Twemoji (CC-BY 4.0) and Google Noto (Apache 2.0).

---

## Implementation Status

- [ ] **Phase 1: Dependencies & Asset Setup** ([1-1-DependenciesAndAssets.md](1-1-DependenciesAndAssets.md))
- [ ] **Phase 2: Emoji Data Service** ([2-1-EmojiDataService.md](2-1-EmojiDataService.md))
- [ ] **Phase 3: Emoji Style Context** ([3-1-EmojiStyleContext.md](3-1-EmojiStyleContext.md))
- [ ] **Phase 4: Emoji Picker UI — Core Grid & Categories** ([4-1-EmojiPickerCoreGrid.md](4-1-EmojiPickerCoreGrid.md))
- [ ] **Phase 5: Emoji Picker UI — Search & Skin Tones** ([5-1-EmojiPickerSearchAndSkin.md](5-1-EmojiPickerSearchAndSkin.md))
- [ ] **Phase 6: ChatInput Integration** ([6-1-ChatInputIntegration.md](6-1-ChatInputIntegration.md))
- [ ] **Phase 7: Settings Integration** ([7-1-SettingsIntegration.md](7-1-SettingsIntegration.md))
- [ ] **Phase 8: Attribution & Documentation** ([8-1-AttributionAndDocs.md](8-1-AttributionAndDocs.md))
