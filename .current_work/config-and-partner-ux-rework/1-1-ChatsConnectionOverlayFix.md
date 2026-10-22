# Phase 1-1 — Chats Connection Overlay & Chat Menu Fix

**Repo:** `harmony-ai-app` · **Depends on:** none · **Blocks:** 5-1  
**Codebase Mapping Refs:** `.planning/codebase/ARCHITECTURE.md` (State Management / Contexts), `.planning/codebase/CONVENTIONS.md`

## Objective

Fix the broken `"Not connected"` overlay on `ChatListScreen` so that the app recognizes the embedded Soulbits Engine sidecar is running and displays the user's conversation list, guard the `+` (New Chat) FAB when genuinely unavailable, and clean up the `ChatDetailScreen` overflow menu (i18n for `"Delete Entity"`, full-row touch targets for captions, and removal of navigation chevrons on confirmation dialogs).

---

## Root Cause Analysis

1. **Why `ChatListScreen` shows `"Not connected"` while the embedded engine is running (`src/contexts/SyncConnectionContext.tsx:208-211`):**
   - When the embedded engine sidecar starts, `onEngineConnectionChange` (`line 268`) sets `isPaired = true` (`available || ConnectionStateManager.getIsPaired()`) and invokes `connect()`.
   - When the loopback WebSocket (`ws://127.0.0.1:<port>`) connects, `handleSyncConnected` (`line 163`) calls `ConnectionStateManager.markConnected()`.
   - `ConnectionStateManager.markConnected()` (`src/services/ConnectionStateManager.ts:183`) emits `'state:changed'` with `{ isConnected: true, isPaired: this.isPaired }`. Because embedded-engine boots never write legacy QR-pairing keys (`soulbits_paired`, `soulbits_jwt`) to `AsyncStorage`, `ConnectionStateManager.isPaired` is `false`.
   - `handleStateChange` in `SyncConnectionContext.tsx:208-211` listens to `'state:changed'` and runs:
     ```ts
     const handleStateChange = (state: any) => {
       setIsPairedSync(state.isPaired || false);
       setIsConnectedSync(state.isConnected || false);
     };
     ```
     Because it omits `|| engineAvailable()` (unlike lines 223, 270, and 353), `isPaired` is overwritten to `false` the moment the engine WebSocket connects!
   - `canUseChat` (`canUseChatForMode(currentSource, isPaired)`) immediately flips to `false`, rendering the `"Not connected"` `ThemedEmptyState` over the loaded `chatList`.

2. **Secondary issues on `ChatListScreen` & `ChatDetailScreen`:**
   - In `ChatListScreen.tsx`, the bottom-right `+` FAB remains rendered and tappable even when `!canUseChat`.
   - In `src/i18n/locales/en/chatList.json`, `notConnectedHint` reads `"Connect to Soulbits Engine or cloud to load your entities."` — leaking internal `"entities"` terminology.
   - In `ChatDetailScreen.tsx:2680-2805`, the overflow menu renders `myPersonasCaption` and `partnerSettingsCaption` *outside* the `<TouchableOpacity>` rows (so tapping the subtitle does nothing and the icon/chevron alignment is off), renders a hardcoded English string `"Delete Entity"` on line 2799 instead of `t('deleteEntity', { name: headerName })`, and puts `chevron-right` (`>`) on destructive modal actions (`Disable Claire`, `Delete`).

---

## Detailed Implementation Steps

### 1. Preserve `engineAvailable()` in `SyncConnectionContext.handleStateChange`
**File:** `src/contexts/SyncConnectionContext.tsx`

Update `handleStateChange` (lines 208–211) so that `isPaired` remains `true` whenever the embedded engine is available:

```ts
const handleStateChange = (state: any) => {
  setIsPairedSync(Boolean(state.isPaired) || engineAvailable());
  setIsConnectedSync(Boolean(state.isConnected));
};
```

Also verify the initial state hook on line 70:
```ts
const [isPaired, setIsPaired] = useState(() => getEngineConnection() !== null);
```
and `isPairedRef`:
```ts
const isPairedRef = useRef(getEngineConnection() !== null);
```
so that if the embedded engine is already ready before `SyncConnectionProvider` mounts, there is zero single-frame flash of `!canUseChat`.

### 2. Guard the `+` FAB and improve fallback copy in `ChatListScreen`
**Files:** `src/screens/ChatListScreen.tsx`, `src/i18n/locales/en/chatList.json`

1. In `ChatListScreen.tsx`, only render the `+` New Chat FAB when `canUseChat` is `true`.
2. In `src/i18n/locales/en/chatList.json`, update `notConnectedHint` to user-friendly copy:
   ```json
   "notConnected": "Engine starting…",
   "notConnectedHint": "Waiting for the local AI engine to finish starting up."
   ```

### 3. Clean up the `ChatDetailScreen` overflow menu
**Files:** `src/screens/ChatDetailScreen.tsx`, `src/i18n/locales/en/chatDetail.json`

1. Move the subtitle `<ThemedText variant="muted" size={11}>` inside the `<TouchableOpacity>` for both `My Personas` and `Partner / Character Settings` (wrapped in a `<View style={{ flex: 1 }}>` column alongside the title) so the entire row + subtitle is tappable and the left icon badge + right chevron center vertically against the two-line row.
2. Replace the hardcoded `"Delete Entity"` on `src/screens/ChatDetailScreen.tsx:2799` with `t('deleteCharacter', { name: headerName })` (and add `"deleteCharacter": "Delete {{name}}"` to `src/i18n/locales/en/chatDetail.json`).
3. Remove the trailing `<Icon name="chevron-right" />` from the two destructive confirmation rows (`Disable {{name}}` and `Delete {{name}}`), since they trigger confirmation alerts rather than navigating to a sub-screen.

---

## Files to Create / Modify

- `src/contexts/SyncConnectionContext.tsx`
- `src/contexts/__tests__/SyncConnectionContext.test.tsx` (or `connectionStatusHelper.test.ts`)
- `src/screens/ChatListScreen.tsx`
- `src/screens/__tests__/ChatListScreen.test.tsx`
- `src/screens/ChatDetailScreen.tsx`
- `src/i18n/locales/en/chatList.json`
- `src/i18n/locales/en/chatDetail.json`

---

## Progress Checklist

- [ ] Fix `handleStateChange` in `SyncConnectionContext.tsx` to preserve `|| engineAvailable()`
- [ ] Seed initial `isPaired` state from `getEngineConnection() !== null`
- [ ] Hide `+` New Chat FAB on `ChatListScreen` when `!canUseChat`
- [ ] Move menu item captions inside `TouchableOpacity` rows on `ChatDetailScreen`
- [ ] Replace hardcoded `"Delete Entity"` with localized `t('deleteCharacter', { name: headerName })` and remove chevrons from destructive alert actions
- [ ] Add unit regression test verifying `markConnected()` / `'state:changed'` with `state.isPaired = false` does not clear `isPaired` or `canUseChat` when `getEngineConnection()` is non-null
