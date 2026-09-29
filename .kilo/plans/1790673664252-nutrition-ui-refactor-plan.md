# Plan: Refactoring Nutrition Screen UI & AI Integration

## Goal
Comprehensive refactoring of the nutrition screen interface: increase meal tile/carousel size by 50%, integrate AI analysis directly inside each meal card (1 card = 1 meal + 1 analysis), reduce top blur intensity project-wide, and align top padding with the Profile tab.

## Requirements & Constraints
1. **Meal Card & Carousel Size (+50%)**:
   - Increase `#meal-carousel` height in `static/js/nutrition.js` from `h-[210px]` to ~`h-[320px]`.
   - Update `.meal-card-slot` height in `static/css/styles.css` (e.g. `clamp(240px, 42dvh, 290px)`) to accommodate the larger size without internal vertical scrolling.
   - Adjust internal layout, spacing (`p-4`), font sizes, and gradient scrims (`h-28`) in `static/js/components.js` (`mealCardPhoto`) for proportional scaling.
2. **Integrated AI Analysis Inside Meal Card**:
   - Move the AI analysis from a separate standalone block under the carousel directly into each meal card (or slide structure), tying 1 analysis strictly to 1 meal (`meal.ai_insight`).
   - Remove the old standalone `#ai-analysis-block` from beneath the carousel.
   - Ensure swiping through the carousel cycles through cards containing both the dish photo/info and its corresponding AI response.
3. **Reduced Blur Intensity**:
   - Reduce heavy backdrop blur values across the project (e.g. `backdrop-blur-md` / `backdrop-blur-lg` / `backdrop-filter: blur(...)`) to lighter effects like `backdrop-blur-sm` or `blur(4px)` / `blur(6px)` to prevent excessive blur over status bar / Face ID areas.
4. **Top Padding Alignment with Profile Tab**:
   - Align the top padding/margin of `#screen-main` / `.single-viewport` in nutrition.js with the profile screen (`.p-4` or `pt-[calc(env(safe-area-inset-top)+16px)]`), ensuring navigation and headers match across tabs.

## Affected Files
- `static/css/styles.css`: Update `.meal-card-slot` height and review project-wide backdrop blur classes.
- `static/js/nutrition.js`:
  - Update wrapper top padding to match Profile tab.
  - Set `#meal-carousel` height to `h-[320px]`.
  - Remove separate `#ai-analysis-block`.
- `static/js/components.js`:
  - Update `mealCardPhoto` to incorporate the AI analysis section (or slide content) directly into the card structure.

## Implementation Steps
1. **Styles (`static/css/styles.css`)**:
   - Update `.meal-card-slot` height: `height: clamp(240px, 42dvh, 290px);`.
   - Adjust backdrop blur utility classes / rules from `-md`/`-lg` to `-sm` (or lighter blur values).
2. **Components (`static/js/components.js`)**:
   - In `mealCardPhoto`, add the AI insight section directly onto the front face (or integrate it cleanly within the card layout) so every card displays its AI analysis.
3. **Nutrition Screen (`static/js/nutrition.js`)**:
   - Match top padding with Profile tab (`pt-[calc(env(safe-area-inset-top)+16px)]` or standard `p-4`).
   - Set carousel container height to `h-[320px]`.
   - Remove standalone AI analysis block.

## Validation & Verification Plan
1. Verify carousel height is increased (~320px) and cards scale properly (+50%).
2. Verify AI analysis is embedded inside each meal card and moves synchronously with card swiping.
3. Verify standalone AI analysis block is removed.
4. Verify backdrop blur is lighter across headers/navigation.
5. Verify top padding aligns correctly with the Profile tab.
