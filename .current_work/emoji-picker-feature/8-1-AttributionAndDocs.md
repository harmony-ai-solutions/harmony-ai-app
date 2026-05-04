# Phase 8: Attribution & Documentation

## Objective

Add proper third-party attribution to `README.md` for the open-licensed emoji assets used in the app. This is legally required for CC-BY 4.0 (Twemoji) and good practice for Apache 2.0 (Google Noto).

## Codebase References

- [`README.md`](../../README.md) — project readme to update
- [`.planning/codebase/CONVENTIONS.md`](../../.planning/codebase/CONVENTIONS.md)

---

## Task 1 — Add Third-Party Licenses section to README.md

**File:** `README.md`

Add a new section after the `## 📄 License` section (or as a new `## 📋 Third-Party Licenses & Attribution` section). Insert before `## 🔗 Links`:

```markdown
## 📋 Third-Party Licenses & Attribution

This project uses the following third-party emoji assets:

### Google Noto Emoji
- **Source:** [googlefonts/noto-emoji](https://github.com/googlefonts/noto-emoji)
- **License:** [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0) (tools & images) / [SIL Open Font License 1.1](https://scripts.sil.org/OFL) (fonts)
- **Copyright:** Google LLC
- **Usage:** Emoji images used under the Apache 2.0 license. Fonts used under the SIL OFL 1.1 license.

### Twemoji (Twitter Emoji)
- **Source:** [jdecked/twemoji](https://github.com/jdecked/twemoji) (active community fork of [twitter/twemoji](https://github.com/twitter/twemoji))
- **License:** [MIT License](https://opensource.org/licenses/MIT) (code) / [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/) (graphics)
- **Copyright:** Twitter, Inc and other contributors
- **Usage:** Twemoji graphics are licensed under CC-BY 4.0, which requires attribution. This notice serves as that attribution.

### Emoji Data
- **Source:** [iamcal/emoji-data](https://github.com/iamcal/emoji-data)
- **License:** [MIT License](https://opensource.org/licenses/MIT)
- **Copyright:** Cal Henderson
- **Usage:** Emoji metadata (names, categories, sprite sheet coordinates) used under the MIT license.

### Emoji Mart
- **Source:** [missive/emoji-mart](https://github.com/missive/emoji-mart)
- **License:** [MIT License](https://opensource.org/licenses/MIT)
- **Copyright:** Missive Inc.
- **Usage:** Emoji search index and metadata used under the MIT license.
```

---

## Task 2 — Update README Implementation Progress

**File:** `README.md`

Add the emoji picker feature to the Phase 2 checklist:

```markdown
### Phase 2: Advanced Features
- [ ] On-device AI model integration / Full Offline Mode
- [ ] AI Lifecycle system
- [ ] Proactive AI behaviour
- [ ] Configure Settings and configuration in App directly
- [ ] Custom character creation
- [ ] Voice Calls with AIs
+ - [X] Emoji Picker with switchable emoji styles (Native, Google Noto, Twemoji)
```

---

## Progress Checklist

- [ ] `README.md` updated with "Third-Party Licenses & Attribution" section
- [ ] Google Noto attribution present (Apache 2.0 + SIL OFL)
- [ ] Twemoji attribution present (CC-BY 4.0 for graphics)
- [ ] Emoji Data attribution present (MIT)
- [ ] Emoji Mart attribution present (MIT)
- [ ] Implementation Progress section updated with emoji picker feature
