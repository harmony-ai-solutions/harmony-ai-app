# Phase 6-2: App — SyncSettingsScreen "Reset Cloud Data" Card + i18n

**Repo:** `C:\Users\sge20\go\src\github.com\harmony-ai-solutions\harmony-ai-app`
**Files:** `src/screens/settings/SyncSettingsScreen.tsx`, `src/i18n/locales/en/syncSettings.json`

> ⚠️ GitNexus rules apply (impact on `SyncSettingsScreen` before editing).
> Design system: themed components (`ThemedCard`, `ThemedButton`,
> `useAppAlert`, `showToast`), MaterialCommunityIcons, i18n via
> `useTranslation('syncSettings')`. Match the existing screen's structure
> (status card → estimate limit card → action buttons → warning cards).

## Objective

A destructive, cloud-mode-only card that walks the user through the purge with
proper confirmation, progress, and outcome states.

## UI spec

Placement: below the two existing action buttons (Sync Now / Force full
re-sync), render ONLY when `connectionStatus.mode === 'cloud'`:

```
┌─ ThemedCard (destructive tint) ─────────────────────────┐
│ ☁️⃠  Reset Cloud Data                                     │
│ Permanently deletes ALL soulbits-engine data in the     │
│ cloud: characters, memories, chats, and autonomy state. │
│ Your data on this device is NOT deleted.                │
│ [ Reset Cloud Data ]  (ThemedButton, destructive/error  │
│                        accent, disabled while purging)  │
└─────────────────────────────────────────────────────────┘
```

- Icon: `cloud-remove-outline`; error/status color from the theme for the card
  accent and button variant (check `ThemedButton`'s supported variants — use
  `outline` with error-colored label/icon if no `destructive` variant exists).
- On press: `showAlert` confirm dialog, destructive style:
  - Title: `resetCloudDataTitle` — "Reset cloud data?"
  - Message: `resetCloudDataMessage` — spells out scope + "This cannot be
    undone." + "Your data on this device is not deleted."
  - Buttons: `common:cancel` (cancel) / `resetCloudDataConfirm` ("Delete cloud
    data", destructive) → calls `cloudSessionService.purgeCloudData()`.
- While purging: button disabled + label `resetCloudDataInProgress`
  ("Deleting…"), card shows `resetCloudDataProgressHint` ("Deleting cloud
  data… this can take up to a minute.").
- Success: alert `resetCloudDataSuccessTitle` / `resetCloudDataSuccessMessage`
  — "Cloud data deleted. Reconnect and use Force full re-sync to push your
  local data back to the cloud." (guide, not auto-action).
- Failure: toast `resetCloudDataFailed` with error message; button re-enabled.
- `testID="reset-cloud-data-button"` + accessibilityLabel.

## i18n keys (`syncSettings.json`)

```json
"resetCloudDataTitle": "Reset cloud data?",
"resetCloudDataMessage": "This permanently deletes ALL soulbits-engine data in the cloud — characters, memories, chats, and autonomy state. Your data on this device is NOT deleted and can be re-uploaded afterwards. This cannot be undone.",
"resetCloudDataConfirm": "Delete cloud data",
"resetCloudDataInProgress": "Deleting…",
"resetCloudDataProgressHint": "Deleting cloud data… this can take up to a minute.",
"resetCloudDataSuccessTitle": "Cloud data deleted",
"resetCloudDataSuccessMessage": "Your cloud data was deleted. Reconnect, then use Force full re-sync to push your local data back to the cloud.",
"resetCloudDataFailed": "Cloud data reset failed: {{message}}",
"purgeInProgressOtherDevice": "Cloud data is being reset on another device. Try again once it completes."
```

(If locales beyond `en` exist for this namespace, add translations there too —
check `src/i18n/locales/` first; en-only is the current pattern for this file.)

## Tests

Screen test following existing screen-test patterns in the repo (search
`__tests__` for a settings screen test to mirror; if none exists for this
screen, test via the service-level tests in 6-1 + a lightweight render test
with mocked navigation/context that asserts: card hidden in selfhosted mode,
confirm dialog flow, button disabled while purging).

## Verification

```powershell
npx jest --selectProjects unit --testPathPatterns "SyncSettings|syncSettings|settings"
npm run lint -- --quiet   # or the repo's lint script
```

## Commit

Part of the Phase 6 commit.

## Checklist

- [ ] Card cloud-mode-only, destructive styling, correct placement
- [ ] Confirm → progress → success/failure flows wired to the service
- [ ] i18n keys added (en; others if present)
- [ ] testID + a11y labels
- [ ] Tests + lint green
