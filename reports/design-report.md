# Harmony AI App — Design Report

**Version:** 0.0.1
**Date:** 2026-07-30
**Framework:** React Native 0.86.0
**Design System:** Material Design 3 via React Native Paper + Custom Theme Engine

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Design Philosophy](#2-design-philosophy)
3. [Visual Identity](#3-visual-identity)
4. [Theme System](#4-theme-system)
5. [Component Library](#5-component-library)
6. [Background & Atmosphere](#6-background--atmosphere)
7. [Glassmorphism Design Language](#7-glassmorphism-design-language)
8. [Navigation & Information Architecture](#8-navigation--information-architecture)
9. [Screen Inventory](#9-screen-inventory)
10. [Chat Experience Design](#10-chat-experience-design)
11. [Emoji System](#11-emoji-system)
12. [Typography](#12-typography)
13. [Iconography](#13-iconography)
14. [Internationalization](#14-internationalization)
15. [Accessibility](#15-accessibility)
16. [Design Tokens Reference](#16-design-tokens-reference)
17. [Known Gaps & Improvement Proposals](#17-known-gaps--improvement-proposals)

---

## 1. Executive Summary

The Harmony AI App is an open-source mobile frontend for the Harmony Link AI character ecosystem. It delivers a premium, immersive AI chat experience on Android and iOS devices, with a visual identity centered on **Obsidian Glass Luminescence** — translucent, glowing cards floating over a deep animated atmospheric background.

The design system is built on a custom theme engine that mirrors the Harmony Link desktop frontend's design token vocabulary, ensuring cross-platform visual consistency. All 8 bundled themes carry the same glassmorphism tokens, gradient definitions, and component styling through a centralized [`ThemeContext`](../src/contexts/ThemeContext.tsx).

**Key design differentiators:**
- Persistent atmospheric animated background (Aurora/Nebula + Stardust particles)
- Full glassmorphism card system with specular gradient borders and neon glow shadows
- 8 bundled themes + custom theme creation with RGB editor and JSON import/export
- Emoji-rich chat with Ekman8 emotion model integration
- 4-tab bottom navigation with floating glass tab bar (Settings moved into the header hamburger menu)

---

## 2. Design Philosophy

The app's design follows five core principles:

### 2.1 Depth Over Flatness
Every surface has dimension. Cards use translucent glass fills that reveal the animated atmospheric background beneath. Gradient borders create specular highlights. Drop shadows produce ambient neon halos. Nothing is a flat colored rectangle.

### 2.2 Atmosphere as Canvas
The [`DynamicAtmosphericBackground`](../src/components/background/DynamicAtmosphericBackground.tsx) is not a background image — it is a living, breathing layer that influences every screen. The deep blue-black canvas with drifting magenta and indigo aurora blobs creates emotional resonance before the user touches a single control.

### 2.3 Consistency with Harmony Link
The app shares the exact design token vocabulary, gradient definitions, and color palette structure as the Harmony Link desktop/web frontend. A user switching between desktop and mobile sees the same brand experience.

### 2.4 Privacy-First Transparency
The UI transparently communicates connection mode (self-hosted vs. cloud), data flow direction, and sync state. Visual indicators differentiate between local-only and synced state. Nothing is hidden from the user.

### 2.5 Mobile-Native Feel
While visually aligned with Harmony Link, the app respects mobile interaction patterns: tap targets ≥ 48dp, bottom-anchored primary navigation, swipe-to-go-back gestures, and keyboard-aware layouts.

---

## 3. Visual Identity

### 3.1 Color Palette (SoulBits Official Dark — Default Theme)

| Token | Hex | Usage |
|-------|-----|-------|
| `background.base` | `#0b0f19` | Page canvas — deep goth blue-black |
| `background.surface` | `#0f1525` | Secondary panels |
| `background.elevated` | `#151d30` | Cards, elevated panels |
| `background.hover` | `#1e2842` | Hover/press states |
| `accent.primary` | `#b84fd0` | Primary CTAs, focus — radiant neon magenta |
| `accent.primaryHover` | `#cf6be5` | Brighter magenta hover |
| `accent.secondary` | `#4a5fcf` | Secondary elements — vivid indigo |
| `accent.secondaryHover` | `#6b7de8` | Brighter indigo hover |
| `text.primary` | `#f0edf6` | Bright lavender-white |
| `text.secondary` | `#d2cde3` | Soft lavender |
| `text.muted` | `#9692b0` | Muted purple-grey |
| `text.disabled` | `#6b6780` | Disabled purple-grey |

### 3.2 Accent Palette Usage

- **Neon Magenta** (`#b84fd0`): Primary CTAs, focus rings, accent borders, ambient glow shadows, aurora blob coloring
- **Vivid Indigo** (`#4a5fcf`): Secondary CTAs, gradient endpoints, secondary aurora blob coloring
- **Deep Indigo** (`#3a2d99`): Gradient tertiary stops, deep background tones

### 3.3 Semantic Colors

| Token | Hex | Usage |
|-------|-----|-------|
| `status.success` | `#4caf82` | Success badges, connected indicators |
| `status.warning` | `#f0a23b` | Warnings, provisioning states |
| `status.error` | `#ef5350` | Errors, disconnection states |
| `status.info` | `#4d9bf0` | Info banners, status indicators |

---

## 4. Theme System

### 4.1 Architecture

The theme system is defined in [`src/theme/types.ts`](../src/theme/types.ts) and managed by [`ThemeContext`](../src/contexts/ThemeContext.tsx).

**Theme data model** (`Theme` interface):
```
Theme {
  id, name, description, version
  colors: {
    background: { base, surface, elevated, hover }
    accent: { primary, primaryHover, secondary, secondaryHover }
    status: { success, successBg, warning, warningBg, error, errorBg, info, infoBg }
    text: { primary, secondary, muted, disabled }
    border: { default, focus, hover, accent }
    gradients: { primary, secondary, surface }  // CSS gradient strings
    glass: { cardOpacity, glowOpacity, glowRadius, borderGradientStart, borderGradientEnd }
    typography: { headerOpacity, subtextOpacity, captionOpacity }
  }
}
```

### 4.2 Bundled Themes (8)

| # | Theme ID | Name | Type | Description |
|---|----------|------|------|-------------|
| 1 | `soulbits-official-dark` | SoulBits Official Dark | Dark | **DEFAULT** — Obsidian Glass, neon magenta + indigo |
| 2 | `soulbits-official-light` | SoulBits Official Light | Light | Light variant with adjusted glass opacity |
| 3 | `midnight-rose` | Midnight Rose | Dark | Pink/purple modern theme |
| 4 | `classic-harmony` | Classic Harmony | Dark | Original Harmony Link palette |
| 5 | `ocean-breeze` | Ocean Breeze | Dark | Teal/blue oceanic tones |
| 6 | `forest-night` | Forest Night | Dark | Deep green forest tones |
| 7 | `sunset-glow` | Sunset Glow | Dark | Warm orange/gold sunset tones |
| 8 | `pure-dark` | Pure Dark | Dark | Minimal dark — OLED-friendly |

### 4.3 Theme Features

- **System follow**: Toggle to automatically match device light/dark mode
- **Custom theme creation**: Full RGB color picker for all color categories
- **JSON import/export**: Share themes as portable JSON files
- **Theme sync with Harmony Link**: Pull/push themes between desktop and mobile
- **Live preview**: Theme editor shows real-time preview of changes
- **Persistence**: Current theme and mode stored in AsyncStorage

### 4.4 Theme → Material Design 3 Mapping

The [`ThemeContext`](../src/contexts/ThemeContext.tsx) transforms the app's `ThemeColors` structure into React Native Paper's MD3 theme format. This means all Paper components (buttons, cards, text inputs, etc.) automatically inherit the active theme's colors without per-component wiring.

---

## 5. Component Library

### 5.1 Themed Primitives

All themed components live in [`src/components/themed/`](../src/components/themed/). They consume theme colors from `useAppTheme()` and apply consistent styling.

| Component | File | Purpose |
|-----------|------|---------|
| **ThemedView** | [`ThemedView.tsx`](../src/components/themed/ThemedView.tsx) | Base container with theme-aware background |
| **ThemedText** | [`ThemedText.tsx`](../src/components/themed/ThemedText.tsx) | Text with hierarchy variants (primary/secondary/muted/disabled) |
| **ThemedButton** | [`ThemedButton.tsx`](../src/components/themed/ThemedButton.tsx) | Primary/secondary/outline buttons with gradient support |
| **ThemedCard** | [`ThemedCard.tsx`](../src/components/themed/ThemedCard.tsx) | **Single source of truth for cards** — Obsidian Glass with gradient border, ambient glow, optional accent stripe |
| **ThemedGradient** | [`ThemedGradient.tsx`](../src/components/themed/ThemedGradient.tsx) | CSS gradient parser → LinearGradient wrapper |
| **ThemedAppbar** | [`ThemedAppbar.tsx`](../src/components/themed/ThemedAppbar.tsx) | Glass-header appbar for screen headers |
| **ThemedFab** | [`ThemedFab.tsx`](../src/components/themed/ThemedFab.tsx) | Floating action button |
| **ScreenHeader** | [`ScreenHeader.tsx`](../src/components/themed/ScreenHeader.tsx) | Standardized screen header with back navigation |
| **SectionHeader** | [`SectionHeader.tsx`](../src/components/themed/SectionHeader.tsx) | In-page section divider with gradient fade and uppercase label |

### 5.2 Domain Components

| Domain | Key Components |
|--------|---------------|
| **Chat** | `ChatBubble` (text/audio/emoji with context menu), `ChatInput` (tap-to-record, emoji autocomplete), `TypingIndicator` (3-dot staggered animation), `NewMessagesDivider` |
| **Characters** | `CharacterProfileCard` (hero card with avatar), `ProfileImagePicker` |
| **Entities** | `EntityCard` (list item with accent stripe), `EntityModuleSelector` |
| **Emoji** | `EmojiPickerModal` (full-screen), `EmojiPickerInline` (compact), `EmojiGrid`, `EmojiSearchBar`, `CategoryTabBar`, `SkinToneSelector`, `EmojiAwareText`, `EmojiText` |
| **Navigation** | `GlassTabBar` (floating translucent tab bar), `HeaderMenuButton` (hamburger → Settings) |
| **Settings** | `ThemeCard` (theme preview/selector), `ConnectionStatusBadge`, `EmojiActionCard`, `EmojiStyleCard` |
| **Cloud** | `CloudProvisioningCard` (multi-stage provisioning with elapsed timer), `StatusPulseDot` |
| **Modals** | `AppAlertModal`, `CertificateVerificationModal`, `ImageViewerModal`, `ImpersonationSelectorModal`, `InitialPairingModal` |
| **Sync** | `SyncProgressVisualizer` |
| **Config** | `AdvancedSamplingParams` (LLM extended params), `FormField` |
| **Lock** | `LockScreen` (biometric/PIN lock overlay), `PinSetupModal` |

### 5.3 Gradient Infrastructure

The [`ThemedGradient`](../src/components/themed/ThemedGradient.tsx) component parses CSS gradient strings (e.g., `linear-gradient(135deg, #b84fd0 0%, #4a5fcf 50%, #3a2d99 100%)`) and renders them as [`react-native-linear-gradient`](https://github.com/react-native-linear-gradient/react-native-linear-gradient) views. This enables the exact same gradient definitions to be shared between the Harmony Link web frontend (which uses CSS) and the mobile app.

**Predefined gradients per theme:**
- `gradients.primary`: Neon magenta → Vivid indigo → Deep indigo (135deg) — used for CTA buttons and hero accents
- `gradients.secondary`: Deep blue-black → Surface (135deg) — used for card backgrounds
- `gradients.surface`: Subtle accent tint gradient — used for panel overlays

---

## 6. Background & Atmosphere

### 6.1 Dynamic Atmospheric Background

The [`DynamicBackground`](../src/components/background/DynamicBackground.tsx) orchestrates 4 selectable background visual styles, rendered as a persistent layer behind the entire navigation stack (zIndex: 0 in [`App.tsx`](../App.tsx)).

#### 6.1.1 Aurora (Default)
[`DynamicAtmosphericBackground.tsx`](../src/components/background/DynamicAtmosphericBackground.tsx) + [`StardustParticles.tsx`](../src/components/background/StardustParticles.tsx)

- **5 large animated gradient blobs**: Radial-gradient-like circles with independent Lissajous motion paths
- **Prime-number cycle durations** (31s, 37s, 41s, 47s, 53s): Prevents visible looping — the blobs never align the same way twice
- **Oscillating opacity and scale**: Each blob breathes independently with sine-wave opacity
- **Theme-driven color extraction**: Blob colors use `accent.primary` (Neon Magenta) and `accent.secondary` (Indigo) with varying opacity
- **Base overlay + vignette**: Deep blue-black anchors the edges, preventing washed-out corners
- **40 deterministic pseudo-random particles** ([`StardustParticles`](../src/components/background/StardustParticles.tsx)): Mulberry32 PRNG (seed=42), unique drift directions, twinkle periods (2–8s), gentle ~30px floating drift
- **All native driver animations**: 60fps performance

#### 6.1.2 Geodesic
[`GeodesicBackground.tsx`](../src/components/background/GeodesicBackground.tsx) — Drifting geometric shapes with glowing halos and luminous cores.

#### 6.1.3 Gradient Flow
[`GradientFlowBackground.tsx`](../src/components/background/GradientFlowBackground.tsx) — Multi-layered flowing gradient ribbons.

#### 6.1.4 Neural Pulse
[`NeuralPulseBackground.tsx`](../src/components/background/NeuralPulseBackground.tsx) — Living synaptic network with traveling action potentials.

### 6.2 Layering Architecture

```
┌─────────────────────────────────────────┐
│  App UI (zIndex: 1, flex: 1)           │
│  ├─ Navigation Stack                    │
│  │  └─ Screens (transparent bg)        │
│  ├─ GlassTabBar (absolute, floating)    │
│  ├─ LockScreen (overlay)               │
│  └─ Modals                              │
├─────────────────────────────────────────┤
│  DynamicBackground (zIndex: 0)          │
│  ├─ Aurora/Nebula blobs                │
│  └─ StardustParticles                   │
└─────────────────────────────────────────┘
```

Navigation `contentStyle` is set to `transparent` so the background bleeds through. Components use translucent/semi-opaque surfaces to create the glassmorphism effect without `backdrop-filter` (unavailable in React Native).

---

## 7. Glassmorphism Design Language

### 7.1 Obsidian Glass Standard

The [`ThemedCard`](../src/components/themed/ThemedCard.tsx) implements the **Obsidian Glass** standard — the app's signature visual treatment:

1. **Translucent fill**: 45–55% opacity (theme-dependent via `glass.cardOpacity`) using `hexToRgba()` of the `surface`/`elevated` hex color — the atmospheric background bleeds through
2. **1dp hairline specular gradient border**: White/silver at top-left (`glass.borderGradientStart`) → muted neon purple/indigo at bottom-right (`glass.borderGradientEnd`) — creates a light-catching bezel effect
3. **Ambient radiant glow shadow**: Neon magenta shadow (`shadowColor: accent.primary`) with `shadowOpacity: glass.glowOpacity` (0.06–0.25) and `shadowRadius: glass.glowRadius` (10–24dp) — gives cards a floating, luminescent presence
4. **Optional left 3px accent stripe**: Gradient (`primary → secondary`, vertical) — used on entity cards and list items
5. **Optional top-left prismatic tint overlay**: Accent color at low opacity from top-left corner — adds color depth

### 7.2 Glass Tokens per Theme

| Theme | cardOpacity | glowOpacity | glowRadius | Border Start | Border End |
|-------|-------------|-------------|------------|--------------|------------|
| SoulBits Official Dark | 0.48 | 0.25 | 24dp | rgba(255,255,255,0.20) | rgba(184,79,208,0.18) |
| SoulBits Official Light | 0.85 | 0.06 | 10dp | rgba(255,255,255,0.65) | rgba(184,79,208,0.12) |
| Other dark themes | 0.45–0.55 | 0.06–0.10 | 12–18dp | rgba white | rgba accent |

### 7.3 Glass Consumers

All cards and panels that follow the Obsidian Glass standard:
- **ThemedCard** — primary card component (used everywhere)
- **ThemeCard** — theme selection cards in settings
- **LandingCard** — hero cards on landing screen
- **ThemedButton** — secondary glass inner fill
- **ThemedAppbar** — screen header with glass background
- **GlassTabBar** — bottom tab bar with floating glass effect

---

## 8. Navigation & Information Architecture

### 8.1 Navigation Structure

```
RootStack (Native Stack, transparent, fade animations)
├── MainTabs (Bottom Tab Navigator)
│   ├── Discover    — Content discovery, featured characters
│   ├── Search      — Global search
│   ├── Chat [CENTER] — Primary workspace, conversation list
│   ├── Characters  — AI character management
│   └── Settings    — App configuration hub
├── ChatDetail           — Full-screen chat (pushed over tabs)
├── CharacterProfileEdit — Character editing
├── CreateAI             — AI character creation wizard
├── EntityConfig         — Entity configuration list
├── EntityConfigEdit     — Entity configuration editor
├── ModuleConfigEdit     — Module/provider configuration
├── Login / Register     — Cloud auth screens
├── ConnectionSetup      — Self-hosted/cloud connection setup
├── SyncSettings         — Sync control and status
├── ThemeSettings        — Theme browser and selector
├── ThemeEditor          — Custom theme RGB editor
├── EmojiActionEditor    — Entity-level emoji action editor
├── BiometricLockSettings — PIN/biometric lock setup
├── ProfileSettings      — User profile
├── BackgroundSettings   — Atmospheric background style selector
└── ComingSoon           — Placeholder for future features
```

### 8.2 Navigation Design Decisions

- **Center-anchored Chat tab** as primary workspace — the most frequently used screen is at thumb's natural resting position
- **Stack push for detail screens**: Full-screen detail routes push over the tab bar, hiding it for immersive content experiences
- **Fade transitions**: All stack transitions use `animation: 'fade'` for smooth, non-jarring navigation
- **GlassTabBar**: Custom floating tab bar component with translucent glass background, absolutely positioned over screen content
- **Transparent navigation theme**: Navigation container uses a transparent theme so the atmospheric background is always visible

---

## 9. Screen Inventory

### 9.1 Primary Screens

| Screen | File | Description |
|--------|------|-------------|
| **ChatListScreen** | [`ChatListScreen.tsx`](../src/screens/ChatListScreen.tsx) | Conversation list with last message previews, entity selection, JOIN-based queries |
| **ChatDetailScreen** | [`ChatDetailScreen.tsx`](../src/screens/ChatDetailScreen.tsx) | Full chat interface with text/audio bubbles, QoL features |
| **CharactersScreen** | [`CharactersScreen.tsx`](../src/screens/CharactersScreen.tsx) | AI character list and management |
| **DiscoverScreen** | [`DiscoverScreen.tsx`](../src/screens/DiscoverScreen.tsx) | Content discovery, featured content, character search |
| **SettingsScreen** | [`SettingsScreen.tsx`](../src/screens/SettingsScreen.tsx) | Settings hub with categorized sections |
| **LandingScreen** | [`LandingScreen.tsx`](../src/screens/LandingScreen.tsx) | Legacy landing with hero cards |

### 9.2 Secondary Screens

| Screen | Description |
|--------|-------------|
| **CharacterProfileEditScreen** | Edit character profile, avatar, traits |
| **CreateAIScreen** | Multi-step AI character creation wizard |
| **EntityConfigScreen** | Entity configuration overview |
| **EntityConfigEditScreen** | Entity config detail editing |
| **ModuleConfigEditScreen** | Module/provider config (15 provider types) |
| **ConnectionSetupScreen** | Self-hosted IP/port input or cloud mode toggle |
| **LoginScreen / RegisterScreen** | Cloud auth with Google/Apple social login |
| **SyncSettingsScreen** | Sync status, manual sync, force full sync |
| **ThemeSettingsScreen** | Theme grid browser with live preview |
| **ThemeEditorScreen** | RGB color picker for custom themes |
| **EmojiActionEditorScreen** | Per-entity emoji→action mappings editor |
| **BackgroundSettingsScreen** | Select background visual style (4 options) |
| **BiometricLockSettingsScreen** | PIN/biometric lock configuration |
| **ProfileSettingsScreen** | User profile editing |
| **DatabaseTableViewerScreen** | DEV-only database inspection tool |

---

## 10. Chat Experience Design

### 10.1 Chat Bubble Design

The [`ChatBubble`](../src/components/chat/ChatBubble.tsx) supports multiple message types with distinct visual treatments:

| Message Type | Own Messages | Partner Messages |
|-------------|-------------|------------------|
| **Text** | Accent-colored background | Elevated surface background |
| **Audio** | Accent bg + playback controls + duration | Surface bg + playback controls + duration |
| **Emoji-rich** | Accent bg with EmojiText rendering | Surface bg with EmojiText rendering |
| **Image** (WIP) | Accent bg + image preview | Surface bg + image preview |

**QoL features on last message:**
- Context menu: Delete, Edit, Regenerate
- Long-press to reveal actions
- Swipe gestures (future)

### 10.2 Chat Input

The [`ChatInput`](../src/components/chat/ChatInput.tsx) provides:

- **Text input** with multi-line support
- **Tap-to-record voice**: Tap mic icon to start, tap again to stop (not hold-to-record — better mobile UX, fewer accidental recordings)
- **Emoji autocomplete**: Type `:` to trigger emoji search inline
- **Permission recovery UI**: Clear error recovery if microphone permission denied
- **Recording indicator**: Pulsing red dot animation during recording
- **Android safe area padding**: Bottom inset for system navigation bar

### 10.3 Realistic Timing

The app simulates natural conversation pacing:

- **Typing indicator**: 3-dot staggered animation (150ms delay between dots)
- **Reply mode toggle**: Per-chat-partner preference — "realistic" (simulated typing delays) or "instant"
- **Variable response delay**: Based on message length and character state
- **Recording indicator**: Shows when AI is "recording" an audio message

### 10.4 QoL Features

- **New messages divider**: Visual separator between read and unread messages
- **Auto-scroll on new messages**: Smart scroll that respects manual scroll-up (doesn't force-scroll if user is reading history)
- **Mark-as-read on scroll**: Messages marked read when they enter the viewport
- **Last message actions**: Edit, delete, regenerate on the most recent message
- **Async transcription editing**: Edit STT transcription text after-the-fact

---

## 11. Emoji System

### 11.1 Emoji Sets

Three selectable emoji rendering styles via [`EmojiContext`](../src/contexts/EmojiContext.tsx):

| Set | Source | Style |
|-----|--------|-------|
| **Native** | Platform default | OS-native emoji rendering |
| **Twemoji** | Twitter 64px sprite sheet | Flat, colorful Twitter-style |
| **Noto** | Google 64px sprite sheet | Google's Noto Emoji style |

### 11.2 Emoji Picker

- **Modal picker** ([`EmojiPickerModal`](../src/components/emoji/EmojiPickerModal.tsx)): Full-screen with category tabs (Smileys, People, Animals, Food, Travel, Activities, Objects, Symbols, Flags), search bar, skin tone selector
- **Inline picker** ([`EmojiPickerInline`](../src/components/emoji/EmojiPickerInline.tsx)): Compact horizontal strip for quick access in chat
- **Autocomplete** ([`EmojiAutocomplete`](../src/components/emoji/EmojiAutocomplete.tsx)): Type `:` to trigger inline emoji search in ChatInput

### 11.3 Emoji Actions & Ekman8 Emotion Model

The app implements an entity-level emoji → action mapping system:

- **Emoji actions**: Per-entity mappings stored in `emoji_actions` table, synced via WebSocket
- **Ekman8 emotions**: 8 base emotions (joy, sadness, trust, disgust, fear, anger, surprise, anticipation) with signed delta intensity (-5.0 to +5.0)
- **Emotion effects**: JSON `emotion_effects` column on each action — defines how sending a specific emoji affects the AI's emotional state
- **AdditionalEffects payload**: When a message containing emoji is sent, [`EmojiService`](../src/services/EmojiService.ts) scans the text, resolves actions, and packages `{ emotionEffects: EmotionEffect[] }` as an `additional_effects` payload on the `SEND_MESSAGE` event
- **EmojiAwareText**: Segments text into emoji/text spans for correct rendering
- **EmojiText**: Renders emoji with proper sprite caching

---

## 12. Typography

### 12.1 Text Hierarchy

Typography uses opacity-based hierarchy tokens defined per-theme:

| Level | Token | Opacity (default dark) | Usage |
|-------|-------|----------------------|-------|
| Header | `typography.headerOpacity` | 1.0 | Screen titles, section headers |
| Subtext | `typography.subtextOpacity` | ~0.70 | Descriptions, secondary information |
| Caption | `typography.captionOpacity` | ~0.50 | Timestamps, metadata, helper text |

### 12.2 ThemedText Variants

The [`ThemedText`](../src/components/themed/ThemedText.tsx) component supports text hierarchy via color selection:

- `variant="primary"` → `text.primary` (full contrast)
- `variant="secondary"` → `text.secondary` (medium contrast)
- `variant="muted"` → `text.muted` (low contrast)
- `variant="disabled"` → `text.disabled` (lowest contrast)

Additional props: `weight` (normal, bold, semibold), `size` (numeric), `align` (left, center, right).

### 12.3 Section Headers

[`SectionHeader`](../src/components/themed/SectionHeader.tsx) implements the Harmony Link pattern for in-page section dividers:
- Gradient row background fading left-to-right (elevated → transparent)
- Uppercase text, `letterSpacing: 0.8`, muted color
- Optional accent-colored left border pip (4px, rounded)

---

## 13. Iconography

The app uses [`react-native-vector-icons`](https://github.com/oblador/react-native-vector-icons) with Material Community Icons as the primary icon set:

- **Tab bar icons**: Discover (compass), Chat (message-text), Characters (account-group), Settings (cog)
- **Status icons**: Connected (check-circle), Disconnected (close-circle), Provisioning (clock-outline)
- **Action icons**: Send (send), Microphone (microphone), Stop (stop), Play (play), Pause (pause)
- **Navigation icons**: Back (chevron-left), Close (close), Menu (dots-vertical)

Icon colors are theme-aware, using `accent.primary` for active/selected states and `text.muted` for inactive states.

---

## 14. Internationalization

### 14.1 Framework

The app uses [`i18next`](https://www.i18next.com/) + [`react-i18next`](https://react.i18next.com/) via [`I18nContext`](../src/contexts/I18nContext.tsx).

### 14.2 Locale Coverage

Currently supports **English (en)** with 25 namespaces:

| Namespace | Coverage |
|-----------|----------|
| `auth` | Login, register, verify, social auth |
| `characters` | Character management |
| `chatDetail` | Chat screen, message actions |
| `chatList` | Conversation list |
| `common` | Shared strings (OK, Cancel, etc.) |
| `config` | AI configuration |
| `connection` | Connection setup and status |
| `createAI` | AI creation wizard |
| `database` | Database loading and errors |
| `development` | DEV-only screens |
| `discover` | Discover screen |
| `entityConfig` | Entity configuration |
| `landing` | Landing screen |
| `modals` | Modal dialogs |
| `moduleConfig` | Module configuration |
| `navigation` | Tab labels, screen titles |
| `profile` | User profile |
| `settings` | Settings categories |
| `syncConnection` | Sync connection status/alerts |
| `syncSettings` | Sync settings screen |
| `theme` | Theme names and descriptions |
| `themeSettings` | Theme settings screen |

### 14.3 i18n Patterns

- All user-visible strings go through the `t()` function
- Namespaces loaded lazily per-screen
- Fallback to English for missing keys
- Date/time formatting uses `Intl` API for locale awareness (future)

---

## 15. Accessibility

### 15.1 Current Implementation

- **Screen reader labels**: `accessibilityLabel` and `accessibilityHint` on interactive elements
- **Touch targets**: Minimum 48dp × 48dp for all interactive elements
- **Color contrast**: Theme colors are designed for WCAG AA contrast ratios on dark backgrounds
- **Test IDs**: `testID` attributes on key interactive elements for E2E testing (e.g., `tab-chat`, `tab-settings`)
- **Reduced motion**: [`CloudProvisioningCard`](../src/components/cloud/CloudProvisioningCard.tsx) respects the system "Reduce Motion" accessibility setting

### 15.2 Future Improvements

- Full TalkBack/VoiceOver audit
- Dynamic font scaling (respect system font size preferences)
- High contrast mode theme variant
- Focus management for keyboard navigation (Android)

---

## 16. Design Tokens Reference

### 16.1 Color Token Usage Map

| Component | Background | Text | Border | Accent Used |
|-----------|-----------|------|--------|-------------|
| Screens (base) | `background.base` | — | — | — |
| Cards | `background.elevated` @ glass opacity | `text.primary` | Gradient border | `accent.primary` (glow) |
| Buttons (primary) | `gradients.primary` | White | — | `accent.primary` → `accent.secondary` |
| Buttons (secondary) | `background.elevated` | `text.primary` | `border.default` | — |
| Appbar | `background.elevated` (glass) | `text.primary` | — | — |
| Tab bar | `background.elevated` (glass) | `text.muted` / `accent.primary` | `border.default` | `accent.primary` (active) |
| Text inputs | `background.surface` | `text.primary` | `border.default` / `border.focus` | `accent.primary` (focus) |
| Chat bubble (own) | `accent.primary` (solid) | White | — | `accent.primary` |
| Chat bubble (partner) | `background.elevated` | `text.primary` | — | — |
| Status badges | `status.*Bg` | `status.*` | — | — |
| Dividers | — | — | `border.default` | — |

### 16.2 Spacing & Layout

- **Screen padding**: 16dp horizontal, 12dp vertical
- **Card padding**: 16dp
- **Card gap**: 12dp (vertical lists), 12dp (horizontal grids)
- **Section spacing**: 24dp between sections
- **Border radius**: 12dp (cards), 8dp (buttons), 24dp (modals)
- **Tab bar height**: 64dp (with safe area)
- **Tab bar floating offset**: 8dp from bottom

---

## 17. Known Gaps & Improvement Proposals

### 17.1 Visual Parity with Harmony Link

The [UI Visual Enhancement Proposal](../design/02%20UI%20Visual%20Enhancement%20Proposal.md) identifies specific visual gaps between the mobile app and the Harmony Link desktop frontend. While the design token vocabulary is identical, the app underuses the available gradient infrastructure. Key proposals:

| Priority | Proposal | Status |
|----------|----------|--------|
| P1 | **ThemedCard gradient + props** — Apply gradient backgrounds + accent decorations to all cards | Implemented (Obsidian Glass overhaul) |
| P1 | **LandingCard gradient** — Hero card visual upgrade | Implemented |
| P1 | **EntityCard gradient + stripe** — Entity list visual upgrade | Partially implemented |
| P2 | **SectionHeader component** — Gradient-tinted section headers | Implemented |
| P2 | **Chat bubble gradient** — Subtle gradient for message bubbles | Pending |
| P3 | **Appbar gradient** — Subtle horizontal gradient for headers | Implemented (ThemedAppbar) |
| P3 | **Icon badge gradient** — Gradient icon containers | Pending |

### 17.2 Missing Visual Features

- **Chat bubble gradient** (Proposal E): Own messages currently use flat `accent.primary` — a subtle 2-stop gradient would add depth
- **Icon badge gradient** (Proposal G): Icon containers in cards use flat hex-alpha tints instead of gradient fills
- **Image message UI**: Backend support exists but full image sending/receiving UI is not yet complete
- **Light theme polish**: The `soulBitsLight` theme needs more thorough component-level testing

### 17.3 Design Debt

- **Hardcoded opacity values**: Some older components may still use hardcoded alpha values instead of reading from `theme.colors.glass`
- **Inconsistent card usage**: Some screens use raw `<View>` with inline styles instead of `ThemedCard`
- **Modal chrome**: Some modals use flat backgrounds while newer ones use gradient surface fills

---

## Appendix A: File Index

### Design System Files

| File | Purpose |
|------|---------|
| [`src/theme/types.ts`](../src/theme/types.ts) | All theme type definitions |
| [`src/theme/themes/index.ts`](../src/theme/themes/index.ts) | Theme registry and exports |
| [`src/theme/themes/hauteGoth.ts`](../src/theme/themes/hauteGoth.ts) | Default theme definition |
| [`src/contexts/ThemeContext.tsx`](../src/contexts/ThemeContext.tsx) | Theme state management |
| [`src/components/themed/`](../src/components/themed/) | Themed component library |
| [`src/components/background/`](../src/components/background/) | Atmospheric background system |
| [`src/components/emoji/`](../src/components/emoji/) | Emoji component library |
| [`src/components/navigation/GlassTabBar.tsx`](../src/components/navigation/GlassTabBar.tsx) | Floating glass tab bar |
| [`src/components/navigation/HeaderMenuButton.tsx`](../src/components/navigation/HeaderMenuButton.tsx) | Header hamburger (three lines) → Settings |

### Design Documentation

| File | Purpose |
|------|---------|
| [`design/00 Design Document.md`](../design/00%20Design%20Document.md) | Original design specification |
| [`design/01 Theming Implementation Plan.md`](../design/01%20Theming%20Implementation%20Plan.md) | Theming system plan |
| [`design/02 UI Visual Enhancement Proposal.md`](../design/02%20UI%20Visual%20Enhancement%20Proposal.md) | Visual gap analysis vs Harmony Link |

---

## Appendix B: Theme Creation Guide

To create a new theme, follow the structure defined in [`hauteGoth.ts`](../src/theme/themes/hauteGoth.ts):

```typescript
import { Theme } from '../types';

export const myTheme: Theme = {
  id: 'my-theme-id',           // Unique kebab-case ID
  name: 'My Theme Name',       // Display name
  description: 'Description',  // Short description
  version: '1.0.0',
  colors: {
    background: {
      base: '#...',     // Page canvas
      surface: '#...',  // Panels
      elevated: '#...', // Cards
      hover: '#...',    // Hover states
    },
    accent: {
      primary: '#...',
      primaryHover: '#...',
      secondary: '#...',
      secondaryHover: '#...',
    },
    status: { /* success, warning, error, info + bg variants */ },
    text: { primary, secondary, muted, disabled },
    border: { default, focus, hover, accent },
    gradients: {
      primary: 'linear-gradient(135deg, ...)',
      secondary: 'linear-gradient(135deg, ...)',
      surface: 'linear-gradient(135deg, ...)',
    },
    glass: {
      cardOpacity: 0.48,        // 0.0–1.0
      glowOpacity: 0.25,        // 0.0–1.0
      glowRadius: 24,           // dp
      borderGradientStart: 'rgba(255,255,255,0.20)',
      borderGradientEnd: 'rgba(accent,0.18)',
    },
    typography: {
      headerOpacity: 1.0,
      subtextOpacity: 0.70,
      captionOpacity: 0.50,
    },
  },
};
```

Then register it in [`src/theme/themes/index.ts`](../src/theme/themes/index.ts) by importing and adding to the appropriate array (`soulBitsThemes` or `otherThemes`).

---

*Report generated from memory bank, source code analysis, and design documentation on 2026-07-30.*
