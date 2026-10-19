# Phase 4-2 — CreateAIScreen: Consolidated Character Card Sections Accordion & Summary Badges

**Repo:** `harmony-ai-app` · **Depends on:** 1-3, 4-1 · **Blocks:** 4-3, 5-1  
**Codebase Mapping Refs:** `.planning/codebase/ARCHITECTURE.md` (Presentation / Screens & Character Card Components), `.planning/codebase/CONVENTIONS.md`

## Objective

Implement the second third of the 1:1 **Edit AI Partner (`CreateAIScreen.tsx`)** rework:
1. Replace the 7 separate, double-striped collapsible `<ThemedCard>` boxes (`Details`, `Greeting`, `Lorebook`, `Images`, `Tags`, `Lifecycle`, `Attribution`) with a single **Character Card Sections** `<ThemedCard>` containing clean divider accordion rows.
2. Add live **summary count / status pills** on the right side of each accordion row (`Configured ▾`, `1 opening · 2 alt ▾`, `3 entries ▾`, `2 images · 4 tags ▾`, `Default ▾`) so the user can see what is populated at a glance without expanding every section.

---

## Target Screen Structure (Card 2 — `CHARACTER CARD SECTIONS`)

Inside a single `<ThemedCard elevated style={styles.section}>` with `<SectionHeader title={t('characterCardSections', 'Character Card Sections')} />`:

| Row | Title | Live Summary Badge Logic | Expanded Content |
|---|---|---|---|
| **1** | **Persona & Prompts** | `'Configured'` when any of `personality`, `voiceCharacteristics`, `basePrompt`, `scenario`, `exampleDialogues`, or `postHistoryInstructions` is non-empty; else `'Default'` | Personality, Voice & Behavior (`voiceCharacteristics`, 2-col `typingSpeedWpm` + `audioResponseChance`), Prompts & Scenario (`basePrompt`, `scenario`, `exampleDialogues`, `postHistoryInstructions`) |
| **2** | **Greetings** *(Edit mode)* | `${firstMes.trim() ? '1 opening' : '0 opening'}${alternateGreetings.length > 0 ? ` · ${alternateGreetings.length} alt` : ''}` | `<GreetingEditorSection />` + `<AlternateGreetingsSection />` |
| **3** | **Lorebook** *(Edit mode)* | `${lorebookCount} ${lorebookCount === 1 ? 'entry' : 'entries'}` (parsed from `characterBook` JSON) | `<LorebookSection />` |
| **4** | **Gallery & Tags** | In Edit mode: `${editImages.length} img · ${tags.length} tags`; in Create mode: `${galleryImages.length} img` | `<ProfileImagePicker />` (or Create-mode gallery tiles) + `<TagsSection />` |
| **5** | **AI Lifecycle & Attribution** *(Edit mode)* | `'Custom'` when `lifecycleConfig` has non-empty keys or `creatorName` is set; else `'Default'` | `<LifecycleSection />` + divider + `<AttributionSection />` |

---

## Detailed Implementation Steps

### 1. Create Pure Summary Badge Helpers in `CreateAIScreen.tsx`
**File:** `src/screens/CreateAIScreen.tsx`

Export pure helper functions (for unit testing per `.planning/codebase/CONVENTIONS.md`):
- `countLorebookEntries(characterBookJson: string | null): number`
- `buildCardSectionBadges(state: { ... }): { persona: string; greetings: string; lorebook: string; galleryTags: string; lifecycleAttribution: string }`

### 2. Render Consolidated Accordion Rows Inside One `ThemedCard`
**File:** `src/screens/CreateAIScreen.tsx`

Replace `renderCollapsibleCard(...)` with `renderAccordionRow(title, badgeText, expanded, onToggle, children, testID)`:
- Each row header (`styles.accordionRowHeader`) renders:
  - Left: `<ThemedText size={14} weight="medium">{title}</ThemedText>`
  - Right: a rounded summary pill (`styles.summaryPill`: `backgroundColor: rgba(148,163,184,0.14)`, `paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999`) showing `${badgeText}` followed by a `chevron-down` / `chevron-up` icon.
- Rows are separated by a `1px` `borderBottomColor: hexToRgba(theme.colors.border.default, 0.65)` divider.
- When `expanded` is `true`, the row's body (`styles.accordionRowBody`) renders immediately below the row header inside the same card.
- Preserve existing `testID`s (`'greeting-section-toggle'`, `'lorebook-section-toggle'`, `'images-section-toggle'`, `'tags-section-toggle'`, `'lifecycle-section-toggle'`, `'attribution-section-toggle'`) so existing component tests continue to find every toggle.

---

## Files to Modify

- `src/screens/CreateAIScreen.tsx`
- `src/i18n/locales/en/createAI.json`
- `src/screens/__tests__/CreateAIScreen.test.tsx`

---

## Progress Checklist

- [ ] Export `countLorebookEntries` and `buildCardSectionBadges` pure helpers from `CreateAIScreen.tsx`
- [ ] Consolidate the V3 editor sections into a single **Character Card Sections** `<ThemedCard>` with clean divider accordion rows and summary pills
- [ ] Preserve all existing section toggle `testID`s for test compatibility
- [ ] Add unit tests for `buildCardSectionBadges` and the consolidated accordion interactions in `CreateAIScreen.test.tsx`
