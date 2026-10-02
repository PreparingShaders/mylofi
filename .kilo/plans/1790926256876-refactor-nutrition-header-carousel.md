# Plan: Refactor Nutrition Header into Ultra-Clean Single-Tile Carousel with Circular Labels

## Goal
Completely refactor the nutrition top header section in `static/js/nutrition.js`, `static/js/components.js`, and `static/css/styles.css` to eliminate visual noise, reduce card height (~200-220px), place macro labels dynamically around the Mercedes combo ring, replace the trend chart Slide 2 with a Weekly Average Mercedes ring, and remove the fixed Day/Week/Month header toggle bar.

---

## Proposed Changes

### 1. `static/js/components.js`
- **`mercedesComboRing` Enhancement**:
  - Add absolute-positioned dynamic macro labels around the ring:
    - **Proteins**: Top-Left outer angle (`БЕЛКИ 0/150г`).
    - **Fats**: Top-Right outer angle (`ЖИРЫ 0/65г`).
    - **Carbs**: Bottom outer angle (`УГЛЕВОДЫ 0/250г`).
  - Eliminate the bottom table/row of macro values (`macroRow`) entirely.
  - Ensure center readout displays AI score (`— / 10`) at top inside center, main calorie counter (`0 / 2 413 ккал`) and remaining text (`Осталось 2 413` / `Перебор +X`) in center.
  - Implement overgoal state: if nutrient or calories exceed 100%, render arc and text label in warning red (`#EF4444` / `text-rose-500 dark:text-rose-400`) with excess indicator (`+Xг`).
- **`nutritionDashboardCard` Updates**:
  - Remove `periodSelector` parameter/injection.
  - Keep 2-slide carousel structure:
    - **Slide 1**: Today's nutrition Mercedes combo ring with surround macro labels and center calorie summary.
    - **Slide 2**: Weekly Average Mercedes combo ring showing 7-day average macro balance % and average AI score.
  - Ensure compact container height (~200-220px).

### 2. `static/js/nutrition.js`
- Remove `renderPeriodSelector()` and `bindPeriodSelector()`.
- Update `loadData` and `render` flow to fetch weekly average data for Slide 2.
- Compute weekly average summary (`avg_calories`, `avg_protein_g`, `avg_fat_g`, `avg_carbs_g`) and average AI score across logged days for Slide 2.
- Clean up unused trend chart methods (`nutritionTrendChart`, `bindNutritionTrendChart`, `periodAnalytics` if replaced by weekly average calculation).

### 3. `static/css/styles.css`
- Add utility styling and positioning rules for outer circular macro labels (`.nutrition-ring-container`, `.macro-label-protein`, `.macro-label-fat`, `.macro-label-carbs`).
- Ensure compact dashboard card height and zero visual overflow.

---

## Verification Plan
1. Check JavaScript syntax and exports.
2. Verify zero emojis are present in any modified code.
3. Validate responsive layout and dark mode glassmorphism consistency.
