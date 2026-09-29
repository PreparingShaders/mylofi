# Plan: Refine Meal Card Header & Metadata in `static/js/components.js`

## Goal
Update `static/js/components.js` (`mealCardPhoto`) to combine date, time, and meal type inside the top translucent chip/badge, and remove the redundant metadata row below the dish name.

## Requirements & Constraints
1. **Top Chip Update**:
   - Remove static "Приём пищи" from the top left badge.
   - Put date, time, and meal type info directly inside this chip (e.g., `"29 сент. 12:21 · Завтрак"` or similar localized format using `escDate`, `escTime`, `escType`).
   - Retain all visual styles (rounded-full, glass-badge, dark translucent background, meal type icon).
2. **Metadata Cleanup**:
   - Remove the old duplicate metadata line below the dish name (e.g., `29 сент. 12:21 · Приём пищи · 0 ккал...`).
   - Keep dish name (`escName`) neatly positioned below the top chip with adequate readable spacing.

## Affected Files
- `static/js/components.js`: Update `mealCardPhoto` markup.

## Implementation Steps
1. **Edit `static/js/components.js` (`mealCardPhoto`)**:
   - Construct unified top chip content:
     ```javascript
     const chipLabel = [dateLabel, timeLabel, mealType].filter(Boolean).join(' · ');
     ```
   - Render inside the top badge:
     ```html
     <div class="glass-badge inline-flex items-center gap-1.5 rounded-full pl-2 pr-3.5 py-1.5 min-w-0">
         <span class="inline-flex items-center justify-center w-6 h-6 shrink-0 rounded-full bg-white/15 text-white">
             ${this.mealTypeIcon(meal.meal_type, 'w-3.5 h-3.5')}
         </span>
         <span class="text-xs font-semibold text-white truncate">${escapeHtml(chipLabel)}</span>
     </div>
     ```
   - Remove the redundant metadata paragraph (`unifiedMeta`) below the dish name.

## Validation & Verification Plan
1. Check meal card front face rendering in browser/UI.
2. Verify top chip correctly displays date, time, and meal type with icon.
3. Verify no duplicate metadata row appears below the dish name.
