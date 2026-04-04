# Phase 4: Settings Menu Update

## Objective

Update `SettingsMenu` to add a "Navigate" section at the top that lets users jump directly between AI Chat, Characters, and Settings — enabling cross-section switching without going back to the Landing Screen. Also clean up menu items pointing to unimplemented screens.

## Files to Modify

- `src/components/navigation/SettingsMenu.tsx`

---

## Current State

The `SettingsMenu` is a modal dropdown rendered from the top-right hamburger icon in screen Appbars. Its current `menuSections` are:

```
User:
  - User Profile → ProfileSettings

App Settings:
  - Appearance & Theme → ThemeSettings  ⭐
  - Data & Privacy → PrivacySettings     ← NOT IMPLEMENTED
  - Notifications → NotificationSettings ← NOT IMPLEMENTED

Sync & Connection:
  - Sync Settings → SyncSettings

Info:
  - About → About       ← NOT IMPLEMENTED
  - Help & Support → Help ← NOT IMPLEMENTED

Development (DEV only):
  - Database Tests → DatabaseTests
  - Database Table Viewer → DatabaseTableViewer
```

## Target State

```
Navigate:
  - AI Chat → ChatList
  - Characters → Characters
  - Settings → Settings
  - Home → Landing

User:
  - User Profile → ProfileSettings

App Settings:
  - Appearance & Theme → ThemeSettings  ⭐

Sync & Connection:
  - Sync Settings → SyncSettings
  - Connection Setup → ConnectionSetup

Development (DEV only):
  - Database Tests → DatabaseTests
  - Database Table Viewer → DatabaseTableViewer
```

**Changes:**

- Add new "Navigate" section at the top with quick links
- Remove `PrivacySettings`, `NotificationSettings`, `About`, `Help` items (not yet implemented — avoids dead-end navigation)
- Add `ConnectionSetup` to Sync & Connection section (currently only reachable from SyncSettingsScreen)
- Remove Info section entirely (until About/Help exist)

---

## Implementation Steps

### Step 1: Update `menuSections` constant

**File:** `src/components/navigation/SettingsMenu.tsx`

Replace the `menuSections` constant with:

```typescript
const menuSections: MenuSection[] = [
  {
    title: 'Navigate',
    items: [
      { icon: 'chat-processing', label: 'AI Chat', screen: 'ChatList' },
      { icon: 'account-group', label: 'Characters', screen: 'Characters' },
      { icon: 'tune', label: 'Settings', screen: 'Settings' },
      { icon: 'home', label: 'Home', screen: 'Landing' },
    ],
  },
  {
    title: 'User',
    items: [
      {
        icon: 'account-circle',
        label: 'User Profile',
        screen: 'ProfileSettings',
      },
    ],
  },
  {
    title: 'App Settings',
    items: [
      {
        icon: 'palette',
        label: 'Appearance & Theme',
        screen: 'ThemeSettings',
        badge: '⭐',
      },
    ],
  },
  {
    title: 'Sync & Connection',
    items: [
      { icon: 'sync', label: 'Sync Settings', screen: 'SyncSettings' },
      {
        icon: 'connection',
        label: 'Connection Setup',
        screen: 'ConnectionSetup',
      },
    ],
  },
  ...(__DEV__
    ? [
        {
          title: 'Development',
          items: [
            {
              icon: 'test-tube',
              label: 'Database Tests',
              screen: 'DatabaseTests',
              badge: 'DEV',
            },
            {
              icon: 'database-eye',
              label: 'Database Table Viewer',
              screen: 'DatabaseTableViewer',
              badge: 'DEV',
            },
          ],
        },
      ]
    : []),
];
```

### Step 2: No layout changes needed

The `SettingsMenu` rendering logic is already generic (maps over `menuSections`), so no layout code changes are required — only the data above.

### Step 3: Visual differentiation for "Navigate" section

The "Navigate" section items should visually feel distinct from configuration items — they are navigation shortcuts, not settings. Add an optional `type` field to `MenuItem` to support styling:

```typescript
interface MenuItem {
  icon: string;
  label: string;
  screen: string;
  badge?: string;
  type?: 'navigate' | 'setting'; // NEW optional field
}
```

In the render loop, when `item.type === 'navigate'`, render the icon with `theme.colors.accent.secondary` instead of `theme.colors.accent.primary`:

```typescript
<Icon
    name={item.icon}
    size={24}
    color={item.type === 'navigate'
        ? theme.colors.accent.secondary ?? theme.colors.accent.primary
        : theme.colors.accent.primary}
    style={styles.menuIcon}
/>
```

Update `menuSections` Navigate items to include `type: 'navigate'`.

### Step 4: Ensure `SettingsMenu` is present on all new screens

The `SettingsMenu` should appear in the Appbar of these screens (verify each has it):

- `ChatListScreen` — already has it ✓
- `CharactersScreen` — needs it (currently has stub version ✓ but needs update for new screen names)
- `EntityConfigScreen` — add it (new screen)
- `LandingScreen` — **does NOT need it** — the landing screen's settings icon navigates to `SettingsScreen` directly; adding a full hamburger menu would be redundant

---

## Progress Checklist

- [x] Update `menuSections` in `src/components/navigation/SettingsMenu.tsx` with the new "Navigate" section
- [x] Remove unimplemented menu items (`PrivacySettings`, `NotificationSettings`, `About`, `Help`)
- [x] Add `type?: 'navigate' | 'setting'` to `MenuItem` interface
- [x] Apply visual styling difference for navigate-type items (different icon color)
- [x] Add `ConnectionSetup` to the Sync & Connection section
- [x] Verify `SettingsMenu` is correctly included in `CharactersScreen` and `EntityConfigScreen` appbars
- [x] Verify `LandingScreen` does NOT include `SettingsMenu` (uses direct settings icon instead)
