# Phase 1: Dependencies & Asset Setup

## Objective

Install required npm packages for emoji data and sprite sheets. Configure the project to bundle Google Noto and Twemoji sprite sheet PNG assets. Ensure Metro bundler can resolve the image assets.

## Codebase References

- [`package.json`](../../package.json) — dependency list
- [`metro.config.js`](../../metro.config.js) — Metro bundler configuration
- [`src/theme/`](../../src/theme/) — existing asset organization pattern
- [`.planning/codebase/CONVENTIONS.md`](../../.planning/codebase/CONVENTIONS.md)

---

## Task 1 — Install npm dependencies

Run the following installations:

```bash
npm install emoji-mart @emoji-mart/data
npm install emoji-datasource emoji-datasource-google emoji-datasource-twitter
```

**Packages installed:**

| Package | Purpose | License |
|---------|---------|---------|
| `emoji-mart` | Headless search index (`SearchIndex`, `init`) | MIT |
| `@emoji-mart/data` | Emoji metadata JSON (names, categories, keywords, skin tones) | MIT |
| `emoji-datasource` | Core emoji metadata with sprite coordinates (`sheet_x`, `sheet_y`) | MIT |
| `emoji-datasource-google` | Google Noto sprite sheets (PNG, 64px) | MIT / Apache 2.0 |
| `emoji-datasource-twitter` | Twemoji sprite sheets (PNG, 64px) | MIT / CC-BY 4.0 |

---

## Task 2 — Verify sprite sheet assets are accessible

The `emoji-datasource-google` and `emoji-datasource-twitter` packages ship sprite sheets inside `node_modules`:

```
node_modules/emoji-datasource-google/img/google/sheets-clean/64.png
node_modules/emoji-datasource-twitter/img/twitter/sheets-clean/64.png
```

Verify these files exist after installation. We will use the **clean** sheets (no Apple fallbacks) to maintain clean licensing.

### Alternative: Copy assets into project

If Metro has trouble resolving deep `node_modules` image paths, copy the sprite sheets into the project source:

**Create directory:**
```
src/assets/emoji/
  sheets/
    google-64.png     ← copy from emoji-datasource-google
    twitter-64.png    ← copy from emoji-datasource-twitter
```

**Metro already supports PNG requires natively** — no special config needed for bundled images. Verify that `require('../../assets/emoji/sheets/google-64.png')` resolves in a test component.

> **Note:** The clean sheets are ~1.5-2.5 MB each at 64px. Total bundle impact: ~3-5 MB for both non-native sets.

---

## Task 3 — Configure TypeScript path awareness (if needed)

If images are placed in `src/assets/emoji/`, ensure TypeScript can resolve them. The existing project likely already has `@react-native` TypeScript config that handles image requires. No changes needed unless TypeScript complains about `.png` imports.

---

## Progress Checklist

- [ ] npm dependencies installed (`emoji-mart`, `@emoji-mart/data`, `emoji-datasource`, `emoji-datasource-google`, `emoji-datasource-twitter`)
- [ ] Sprite sheet PNGs verified accessible in `node_modules` (or copied to `src/assets/emoji/sheets/`)
- [ ] Image `require()` works in a test render
- [ ] `package.json` updated with new dependencies
