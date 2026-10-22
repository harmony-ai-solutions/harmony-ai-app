# Phase 1-3 — Themed Primitives, Outline Button & Header Polish

**Repo:** `harmony-ai-app` · **Depends on:** none · **Blocks:** 2-3, 4-1, 4-2  
**Codebase Mapping Refs:** `.planning/codebase/ARCHITECTURE.md` (Presentation / Components & Theme), `.planning/codebase/CONVENTIONS.md`

## Objective

Fix three cross-app visual defects identified in the device screenshots:
1. **`ThemedButton` `variant="outline"` gradient bleed (`src/components/themed/ThemedButton.tsx:142-178`):** Fix the inner surface opacity so outline buttons look like crisp dark-glass outline buttons instead of washed-out grey-to-pink gradient slabs.
2. **`ScreenHeader` floating 40dp top-left stripe (`src/components/themed/ScreenHeader.tsx:69`):** Only render the decorative top-left `accentStripe` on root/tab headers (when `onBack` is absent) or when explicitly requested via prop, so stack screens with a `←` back button don't have a stray 40dp purple line floating above the back arrow.
3. **Double left accent stripes on cards & provider chips (`ThemedCard`, `SectionHeader`, `ProviderSlotSection`):** Prevent the "double vertical purple bar" artifact when `SectionHeader` sits inside an `accentStripe` card, and remove the redundant `chipPip` bar inside selected provider chips.

---

## Root Cause Analysis

1. **`ThemedButton` `variant="outline"` (`src/components/themed/ThemedButton.tsx:158-175`):**
   - The outer `<LinearGradient>` paints `colors={[borderGradientStart, borderGradientEnd]}` across the entire `width: '100%', height: '100%'` button rectangle, relying on the inner `<LinearGradient>` (`styles.glassInnerBtn`, inset by `1dp`) to cover the interior.
   - However, `variant="outline"` sets the inner fill to `hexToRgba(theme.colors.background.surface, 0.15)` → `0.08` (85–92% transparent!). The outer white/pink border gradient therefore shows straight through the entire button face.
   - By contrast, `variant="secondary"` uses a solid-ish surface fill, which still lets the underlying card show slightly. For `variant="outline"`, the interior fill must match the card/base background (`hexToRgba(theme.colors.background.base, 0.92)` → `hexToRgba(theme.colors.background.surface, 0.88)`) so only the 1dp gradient border ring is visible around a dark glass interior.

2. **`ScreenHeader` top-left `accentStripe` (`src/components/themed/ScreenHeader.tsx:68-70`):**
   - Every `<ScreenHeader>` unconditionally renders `<ThemedGradient gradient="primary" style={styles.accentStripe} />` (`width: 40, height: 3, marginBottom: 16`) above `titleRow`.
   - On root tab screens (`Chats`, `Characters`, `Discover`, `Market`) where there is no `←` back arrow, the stripe sits directly above the 24pt page title. On pushed stack screens (`← Edit Backend Config`, `← Edit AI Partner — Claire`), the 40dp stripe sits directly over the `←` arrow and looks like a stuck progress bar.

3. **Double vertical stripes (`ThemedCard` + `SectionHeader` & `ProviderSlotSection.chipPip`):**
   - `<ThemedCard accentStripe>` draws a 3dp vertical accent stripe along the left edge of the card, while `<SectionHeader>` draws *another* 3dp vertical accent pip 16dp to the right of it.
   - In `ProviderSlotSection.tsx:160-165`, selected provider chips render `styles.chipPip` (`position: 'absolute', left: 0, width: 3`) inside a `borderRadius: 8` chip that already has a `1px` accent border, accent background tint, accent text color, and a `✓` icon — causing the 3px square bar to collide with the rounded left corners.

---

## Detailed Implementation Steps

### 1. Fix `ThemedButton` `variant="outline"` interior fill
**File:** `src/components/themed/ThemedButton.tsx`

In the `if (variant === 'outline')` branch (lines 142–178), update the inner `<LinearGradient>` colors so they mask the outer border gradient cleanly while preserving the dark-glass look:

```tsx
<LinearGradient
    colors={[
        hexToRgba(theme.colors.background.base, 0.92),
        hexToRgba(theme.colors.background.surface, 0.88),
    ]}
    start={{ x: 0, y: 0 }}
    end={{ x: 1, y: 1 }}
    style={[styles.glassInnerBtn, { borderRadius: BUTTON_RADIUS - 1 }]}
>
    {renderContent(theme.colors.accent.primary)}
</LinearGradient>
```

### 2. Hide `ScreenHeader` top-left `accentStripe` on stack sub-screens
**File:** `src/components/themed/ScreenHeader.tsx`

Add an optional prop `showAccentStripe?: boolean` to `ScreenHeaderProps` (defaulting to `!onBack`):
```tsx
const shouldShowStripe = showAccentStripe ?? !onBack;
```
Render `<ThemedGradient gradient="primary" style={styles.accentStripe} />` only when `shouldShowStripe` is `true`, and reduce `wrapper` top padding slightly (`safeTop + 8` when `!shouldShowStripe`) so pushed screens have a tighter, standard mobile app bar.

### 3. Clean up `ProviderSlotSection` chip selection & card stripes
**File:** `src/components/config/ProviderSlotSection.tsx`

1. Remove the redundant `<LinearGradient style={styles.chipPip} />` and `paddingLeft: isSelected ? 8 : 0` from `renderProviderChips()` in `ProviderSlotSection.tsx:159-174`. Keep the crisp `1px` accent border, `15%` accent background tint, medium accent text, and `check` icon.
2. Drop `accentStripe` from the `<ThemedCard>` wrappers on `ModuleConfigEditScreen` and `CreateAIScreen` where `<SectionHeader>` already provides the section's accent pip, eliminating the parallel double-stripe effect.

---

## Files to Create / Modify

- `src/components/themed/ThemedButton.tsx`
- `src/components/themed/ScreenHeader.tsx`
- `src/components/config/ProviderSlotSection.tsx`

---

## Progress Checklist

- [ ] Fix `ThemedButton` `variant="outline"` inner fill opacity so the outer border gradient no longer bleeds across the button face
- [ ] Default `ScreenHeader` `showAccentStripe` to `!onBack` so stack screens with a back button do not show the floating 40dp bar above `←`
- [ ] Remove `chipPip` from `ProviderSlotSection` provider chips
- [ ] Remove redundant outer `accentStripe` prop on cards that already contain a `<SectionHeader>` with its own accent pip
