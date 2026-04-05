# UI Visual Enhancement Proposal — Harmony AI App
**Date:** 2026-04-04  
**Author:** Roo (UI/UX Frontend Engineer)  
**Status:** Draft — Awaiting Review

---

## 1. Executive Summary

The Harmony AI App shares an identical design-token vocabulary with the Harmony Link frontend (same theme colors, gradient definitions, border palette) but almost entirely omits the visual refinements that give Harmony Link its premium, cohesive look. The gradient infrastructure is already wired up (`ThemedGradient`, `GradientButton`, `parseGradient`, theme `gradients.*`) but is used in exactly **one place**: the primary `ThemedButton`. Every card, header, and panel in the app still renders as a flat solid-color rectangle with minimal shadow.

This document compares both UIs at a component level, identifies the specific gaps, and proposes actionable improvements — component by component — that bring the app visually in line with Harmony Link without requiring any theme or architecture changes.

---

## 2. Side-by-Side Design Comparison

### 2.1 Card / Row Containers

| Aspect | Harmony Link | Harmony AI App | Gap |
|---|---|---|---|
| **Background** | `linear-gradient(135deg, elevated → surface)` | Flat `background.elevated` solid | ❌ Missing |
| **Accent tint overlay** | `accent.primary` bled from top-left at 8–9% opacity | None | ❌ Missing |
| **Left accent stripe** | 3 px gradient stripe (`primary → secondary`) | None | ❌ Missing |
| **Box shadow** | `0 10–20px 50px -5..12px rgba(0,0,0,0.3–0.5)` | `elevation: 2`, `shadowOpacity: 0.1` | ❌ Too weak |
| **Border** | `rgba(255,255,255,0.05)` (soft translucent) | Solid `border.default` color | ⚠️ Slightly flat |
| **Hover / press** | `border-color → hover`, shadow lift, `brightness(1.15)` | `activeOpacity: 0.8` only | ⚠️ Partial |

### 2.2 Icon / Badge Containers

| Aspect | Harmony Link | Harmony AI App | Gap |
|---|---|---|---|
| **Icon badge** | `linear-gradient(135deg, primary, secondary)` square badge | `accent + '22'` hex alpha circle | ⚠️ Works, but lacks gradient |
| **Module chips** | Nuance-colored accent fills | `accent + '22'` bg, `accent + '44'` border | ✅ Similar, good |

### 2.3 Screen Headers / Appbars

| Aspect | Harmony Link | Harmony AI App | Gap |
|---|---|---|---|
| **Background** | Gradient surface + subtle tint | Flat `background.surface` solid | ❌ Missing |
| **Section dividers** | `rgba(255,255,255,0.07)` translucent lines | Standard border | ⚠️ OK but flat |

### 2.4 Chat Bubbles (own messages)

| Aspect | Harmony Link | Harmony AI App | Gap |
|---|---|---|---|
| **Own bubble background** | N/A (no chat in HL) | Flat `accent.primary` solid | ⚠️ Could use gradient |
| **Partner bubble** | N/A | Flat `background.elevated` solid | ⚠️ Could use subtle gradient |

### 2.5 Modal Chrome

| Aspect | Harmony Link | Harmony AI App | Gap |
|---|---|---|---|
| **Modal content** | Gradient bg + `::before` surface-gradient at 30% | Flat elevated bg | ❌ Missing |
| **Modal header** | Gradient bg + tint overlay + accent stripe | Plain solid | ❌ Missing |

### 2.6 Section Headers (within scrollable forms)

| Aspect | Harmony Link | Harmony AI App | Gap |
|---|---|---|---|
| **Header bar** | Gradient left fade, uppercase, tight letter-spacing | `ThemedText variant="muted"` only | ⚠️ Exists but plain |
| **Section panels** | Gradient border-container with header bar | Plain `View` with margin | ❌ Missing panel concept |

### 2.7 CTA Buttons

| Aspect | Harmony Link | Harmony AI App | Gap |
|---|---|---|---|
| **Primary** | `var(--gradient-primary)` + shadow + hover lift | `ThemedGradient gradient="primary"` | ✅ Equivalent |
| **Secondary/outline** | Solid elevated bg | Solid elevated bg | ✅ Equivalent |

---

## 3. Root Cause Analysis

### 3.1 Existing Infrastructure — Already Available

The app already has:

- **[`ThemedGradient`](src/components/themed/ThemedGradient.tsx)** — full CSS gradient parser, wraps `react-native-linear-gradient`
- **[`GradientButton`](src/components/themed/ThemedGradient.tsx:117)** — convenience gradient-button wrapper
- **Theme `gradients.*`** — `primary`, `secondary`, `surface` gradients in all themes
- **[`ThemedCard`](src/components/themed/ThemedCard.tsx)** — shared card component, ready for enhancement

### 3.2 Why the Gap Exists

The [`ThemedCard`](src/components/themed/ThemedCard.tsx) component was designed with a flat background (only `elevated` or `surface` solid color). All screens that use raw `<View style={[..., {backgroundColor: theme.colors.background.elevated}]}>` bypass even this. The prismatic tint overlay and left accent stripe patterns from Harmony Link were never ported to the mobile component library.

---

## 4. Improvement Proposals

### Proposal A — Enhance `ThemedCard` with gradient + optional accent decorations

**Priority:** High — single change propagates across all screens

**Changes to [`ThemedCard`](src/components/themed/ThemedCard.tsx):**
- Replace flat solid `backgroundColor` with `LinearGradient` using `surface` gradient
- Add optional `accentStripe` prop (boolean, default `false`) that renders a 3px left border stripe using `primary → secondary` gradient
- Add optional `accentTint` prop (boolean, default `false`) that overlays an absolutely-positioned `LinearGradient` at 8% opacity from top-left
- Increase shadow: `elevation: 4`, `shadowOpacity: 0.2`, `shadowRadius: 8`
- Change border to `rgba(255,255,255,0.06)` (translucent) instead of solid border color

**Before (current):**
```tsx
<View style={[styles.card, {
  backgroundColor: elevated ? theme.colors.background.elevated : theme.colors.background.surface,
  borderColor: theme.colors.border.default,
}]}>
```

**After (proposed):**
```tsx
<LinearGradient
  colors={[theme.colors.background.elevated, theme.colors.background.surface]}
  start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
  style={[styles.card, { borderColor: 'rgba(255,255,255,0.06)' }, style]}
>
  {accentStripe && (
    <LinearGradient
      colors={[theme.colors.accent.primary, theme.colors.accent.secondary]}
      start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }}
      style={styles.accentStripe}
    />
  )}
  {accentTint && (
    <LinearGradient
      colors={[theme.colors.accent.primary + '17', 'transparent']}
      start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
      style={StyleSheet.absoluteFillObject}
      pointerEvents="none"
    />
  )}
  {children}
</LinearGradient>
```

---

### Proposal B — Apply accent decorations to `LandingCard`

**Priority:** High — this is the home screen hero element

**Changes to [`LandingCard`](src/components/landing/LandingCard.tsx):**
- Replace flat `backgroundColor` with `ThemedGradient gradient="secondary"` (elevated→surface)
- Add left accent stripe for `variant="hero"` cards
- Use `ThemedGradient gradient="primary"` for the icon container instead of flat hex-alpha tint
- Increase shadow: `elevation: 6`, `shadowOpacity: 0.25`, `shadowRadius: 12`

**Visual result:** The hero card on the landing screen gets the same prismatic depth as Harmony Link's integration rows.

---

### Proposal C — Enhance `EntityCard` with accent stripe + gradient background

**Priority:** High — entity list is one of the most-viewed screens

**Changes to [`EntityCard`](src/components/entities/EntityCard.tsx):**
- Replace flat `backgroundColor` with gradient (`elevated → surface`, 135deg)
- Add 3px left gradient accent stripe (always on, matches HL integration-row aesthetic)
- Add prismatic tint overlay at 8% opacity
- Increase shadow depth: `elevation: 5`
- Avatar background: use `surface` gradient instead of `base` flat

---

### Proposal D — Gradient-tinted section headers

**Priority:** Medium — improves form screens (`SettingsScreen`, `EntityConfigEditScreen`, `CharacterProfileEditScreen`)

The pattern in Harmony Link for in-page section headers:
```css
.character-editor-section-header {
  background: linear-gradient(to right, var(--color-background-elevated), transparent);
}
```

In the app, introduce a **`SectionHeader`** component (or enhance `ThemedText` with a `sectionHeader` variant) that renders:
- A gradient row background fading left-to-right (elevated → transparent)
- Uppercase text, `letterSpacing: 0.8`, muted color
- Optional accent-colored left border pip (4px, rounded)

This replaces the scattered `<ThemedText weight="bold" size={14} variant="muted" style={styles.cardTitle}>` patterns in [`SettingsScreen`](src/screens/SettingsScreen.tsx).

---

### Proposal E — Chat bubble gradient for own messages

**Priority:** Medium — high-visibility area

**Changes to [`ChatBubble`](src/components/chat/ChatBubble.tsx):**
- For `isOwn` bubbles: replace flat `accent.primary` solid background with `ThemedGradient gradient="primary"` (creates a subtle 2-stop gradient using primary + secondary accent colors)
- For partner bubbles: apply `surface` gradient at low opacity as background
- This differentiates own/partner bubbles more clearly and gives the chat screen visual richness

---

### Proposal F — Appbar header subtle gradient

**Priority:** Low-Medium — affects every screen's header

**Pattern (applied per-screen on `Appbar.Header`):**
```tsx
// Wrap Appbar.Header content in a LinearGradient
<LinearGradient
  colors={[theme.colors.background.elevated, theme.colors.background.surface]}
  start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}  // horizontal gradient
  style={styles.appbarGradient}
>
  <Appbar.Header style={{ backgroundColor: 'transparent' }}>
    ...
  </Appbar.Header>
</LinearGradient>
```

Or alternatively, introduce a **`ThemedAppbar`** wrapper component that encapsulates this pattern.

---

### Proposal G — Icon badge gradient

**Priority:** Low — refinement detail

**Changes to icon badge containers** (e.g., in [`LandingCard`](src/components/landing/LandingCard.tsx), future `SectionHeader` components):
- Replace `accent + '22'` flat tint circle/square with a `LinearGradient` from `accent.primary` to `accent.secondary` at ~20% opacity
- This makes icon containers feel premium, matching the Harmony Link character-editor icon badges

---

## 5. Prioritized Implementation Plan

| Priority | Proposal | Screens Affected | Effort |
|---|---|---|---|
| 🔴 P1 | **A** — `ThemedCard` gradient + props | ALL card-using screens | S |
| 🔴 P1 | **B** — `LandingCard` gradient | `LandingScreen` | S |
| 🔴 P1 | **C** — `EntityCard` gradient + stripe | `EntityConfigScreen` | S |
| 🟡 P2 | **D** — `SectionHeader` component | Settings, Config, Profile edit screens | M |
| 🟡 P2 | **E** — Chat bubble gradient | `ChatDetailScreen` | S |
| 🟢 P3 | **F** — Appbar gradient | All screens | M |
| 🟢 P3 | **G** — Icon badge gradient | `LandingCard` + future components | S |

**Effort key:** S = Small (< 2h), M = Medium (2–4h)

---

## 6. Design Principles — Porting from Harmony Link

The following core patterns from Harmony Link's [`components.css`](../../../harmony-link-private/frontend/src/styles/components.css) should be considered the **reference design** for mobile port:

### Pattern 1: Card Gradient Background
```
linear-gradient(135deg, background.elevated 0%, background.surface 100%)
```
Use for: all cards, modals, section panels.

### Pattern 2: Prismatic Accent Tint Overlay
```
linear-gradient(135deg, accent.primary + '17' 0%, transparent 55%)
position: absolute, inset: 0, pointerEvents: none
```
Use for: hero cards, entity cards, modal headers.

### Pattern 3: Left Accent Stripe
```
LinearGradient [accent.primary, accent.secondary] vertical, width: 3
position: absolute, left: 0, top: 0, bottom: 0
```
Use for: entity rows, integration-style list items, character cards.

### Pattern 4: Deep Layered Shadow
```
elevation: 4–6
shadowColor: '#000', shadowOffset: {0, 6}, shadowOpacity: 0.2–0.3, shadowRadius: 10–14
```
Use for: elevated cards, modals.

### Pattern 5: Section Header Gradient Fade
```
LinearGradient [background.elevated, transparent] horizontal
+ uppercase text, letterSpacing: 0.8, muted color
```
Use for: card title bars, form section dividers.

---

## 7. What NOT to Change

- **Color palette** — themes are already perfectly aligned. No color changes needed.
- **Spacing and layout** — the current spacing system works well for mobile.
- **`ThemedButton`** — already uses gradient correctly.
- **Typography** — text hierarchy is adequate; not the source of the visual flatness.
- **Navigation structure** — out of scope.

---

## 8. A/B Consideration

For the chat bubble gradient (Proposal E), two variants are worth considering:

- **Variant A** (conservative): Use `gradient="primary"` full gradient for own messages. Risk: may look too flashy for a chat app.
- **Variant B** (subtle): Use a 2-stop gradient from `accent.primary` to `accent.primaryHover` (same hue, lighter end). This gives depth without a dramatic color shift.

**Recommendation:** Start with Variant B for chat bubbles; use full `gradient="primary"` only for `ThemedCard` + `LandingCard` where the surface area justifies the boldness.

---

## 9. Summary

The Harmony AI App has all the ingredients — gradient infrastructure, theme tokens, component abstractions — to look as polished as the Harmony Link frontend. The gap is purely in **application**: gradient backgrounds, prismatic tint overlays, left accent stripes, and deeper shadows are not applied to cards and containers. Implementing Proposals A–C alone (all `S`-effort) would dramatically elevate the visual quality of the three highest-traffic screens (Landing, Chat List / Entity List, Chat Detail) with minimal risk and no architectural changes.
