# Plan: Redesign "Add Meal" Modal to Mobile Bottom Sheet Style (Matching Drum Picker UI)

## Goal
Refactor the "New Meal" modal (`newMealModal` in `Components` and its handlers in `Nutrition`) to use the exact same Bottom Sheet UI design system as the Workout Drum Picker (`.drum-sheet-panel`).

## Affected Boundaries & Files
1. `static/js/components.js`: Update `Components.newMealModal()` HTML structure.
2. `static/js/nutrition.js`: Update `openNewMealModal()`, `closeNewMealModal()`, and event bindings / slide-up animations.
3. `static/css/styles.css`: Add or adjust active state styling for `.new-meal-type-chip.active` matching the neon-lime theme system (`#84cc16`).

## Detailed Design & Requirements

### 1. Container Structure (Bottom Sheet)
- Wrapper: `drum-sheet fixed inset-0 z-50 pointer-events-auto`
- Backdrop: `drum-sheet-backdrop absolute inset-0 bg-black/40 dark:bg-black/60`
- Panel: `drum-sheet-panel absolute bottom-0 left-0 right-0 bg-white text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100 rounded-t-2xl border-t border-zinc-200 dark:border-white/10 flex flex-col drum-sheet-safe p-4 gap-3.5`

### 2. Header Section
- Eyebrow label: `text-[11px] uppercase tracking-wider text-zinc-500 dark:text-zinc-500 font-semibold truncate` -> `ДОБАВЛЕНИЕ ПИТАНИЯ`
- Title: `text-base font-bold text-zinc-900 dark:text-zinc-100 truncate` -> `Новый приём пищи`
- Close button: `w-8 h-8 rounded-xl bg-zinc-100 text-zinc-500 dark:bg-white/5 dark:text-zinc-400 text-sm flex-shrink-0 flex items-center justify-center hover:text-zinc-900 dark:hover:text-zinc-50 transition-colors`

### 3. Photo Input Buttons ("Камера" / "Галерея")
- Styled as clean cards: `bg-zinc-100 dark:bg-white/5 border border-zinc-200 dark:border-white/10 rounded-xl p-3 text-center cursor-pointer hover:border-lime-500/50 transition`

### 4. Meal Type Chips ("Завтрак", "Обед", "Ужин", "Перекус")
- Segmented control chips: `new-meal-type-chip px-2 py-2 rounded-xl bg-zinc-100 dark:bg-white/5 border border-zinc-200 dark:border-white/10 text-xs font-semibold text-zinc-600 dark:text-zinc-400 transition-all hover:border-lime-500/50`
- Active state: Neon lime highlight (`.new-meal-type-chip.active`).

### 5. Description / Notes Input Field
- Textarea: `w-full px-3 py-2.5 rounded-xl bg-zinc-100 dark:bg-zinc-800/80 border border-zinc-200 dark:border-white/10 text-zinc-900 dark:text-zinc-100 text-sm resize-none focus:border-lime-500 focus:outline-none`

### 6. Primary Action Button
- Submit button: `w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-lime-500 hover:bg-lime-400 text-zinc-950 font-semibold text-base shadow-lg shadow-lime-500/10 transition-all disabled:opacity-50 disabled:cursor-not-allowed`

## Validation Steps
1. Open Nutrition page and click "Добавить приём пищи" / camera button.
2. Verify modal slides up smoothly from the bottom with drag handle and rounded top corners (`rounded-t-2xl`).
3. Verify light/dark theme adaptability.
4. Test meal type chip selection (neon-lime active state).
5. Test photo upload/camera trigger and submit button enabling logic.
