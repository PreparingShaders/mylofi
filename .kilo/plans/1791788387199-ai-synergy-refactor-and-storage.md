# Plan: AI Synergy & Daily Summary Vertical Stack Recomposition

## Goals
1. **Vertical Stack Layout (Replacing Tabs):**
   - Remove the mini-tabs switcher ("Итог дня" / "ИИ-Синергия") from the card header.
   - Render **«Итог дня»** as the top collapsible independent block.
   - Render **«ИИ-Синергия»** as a stacked independent block directly below "Итог дня" within the first carousel slot, allowing natural vertical flow when the top block collapses or expands.
2. **Full-Width AI Synergy Tile Layout:**
   - Header: title **«ИИ-Синергия»** (strictly emoji-free), right score badge (`✦ ИИ X.X /10`).
   - Body: full-width verdict/findings display area.
   - Footer: clean full-width action button ("Посмотреть отчёт" or "Запустить анализ").
3. **Emoji and Artifact Cleanup:**
   - Strip all stray emojis, spark/star symbols, and decorative unicode artifacts from headers and buttons across the module.

---

## Proposed Changes (`static/js/components.js`, `static/js/nutrition.js`)
- Refactor first carousel slot template to stack `.daily-summary` and `.ai-synergy-widget` vertically instead of tabbing between them.
- Clean up `aiSynergyWidget` markup to match the vertical full-width layout.

---

## Validation & Verification
1. Run `pytest` to ensure test suite passes.
2. Check UI rendering of stacked Daily Summary and AI Synergy blocks in the carousel.
