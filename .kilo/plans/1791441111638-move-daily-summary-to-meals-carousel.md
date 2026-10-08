# Plan: Move Daily Summary Card to Meals Carousel

## Goal
Move the "Daily Summary" card (nutritionist daily verdict) from its separate vertical block beneath the KBJU dashboard ring into the horizontal meals carousel (`#meal-carousel`) as its first item, ensuring proper styling, snap-scroll behavior, internal scrolling for long verdicts, correct initial focus on the "Add Meal" card, and rate-limited regeneration protection.

---

## Architecture & Changes

### 1. Removal of Separate Vertical Block
- **File:** `static/js/nutrition.js`
- **Change:** Remove `dailySummaryBlock` rendering from the page header (`viewport-header`), which previously placed the daily summary card between the dashboard ring and the meal carousel.

### 2. Embedding Daily Summary Card in Meals Carousel
- **File:** `static/js/nutrition.js`
- **Change:** In the `#meal-carousel` HTML generation block, place the daily summary card as the very first item, before the "Add Meal" action card (`Components.addMealActionCard()`).
- **Condition:** The daily summary card should appear in the day view (`selectedPeriod === 'day'`) when daily summary data is available or when the empty/generate state applies. For wider periods (week, month, custom), omit the daily summary card from the carousel.

### 3. Styling & Layout (`.daily-summary-slot`)
- **Files:** `static/js/components.js`, `static/css/styles.css`
- **Changes:**
  - Wrap or style the daily summary card within a carousel slot (`.daily-summary-slot` or `.meal-card-slot` style) matching other carousel items (`snap-center shrink-0 w-[85vw] sm:w-[380px] h-full flex flex-col`).
  - Style the card with a stylish purple gradient background/border (`bg-gradient-to-b from-purple-900/30 to-zinc-900/80 border border-purple-500/30` or existing `dailySummaryCard` classes).
  - Ensure header has ✨ icon, title "Итог дня", date, and AI score badge (e.g., "ИИ 2.1 /10").
  - Center content: full text of nutritionist verdict with clean internal scroll (`overflow-y-auto max-h-[300px]`) for long texts.
  - Bottom: "+ Сформировать итог" button if summary is not yet formed.

### 4. Carousel Focus on Load
- **File:** `static/js/nutrition.js`
- **Change:** After initial render / construction of the carousel, ensure the starting scroll position focuses on the "Add Meal" card (`.meal-action-slot`) rather than the first item (`.daily-summary-slot`).
- **Implementation:** Invoke `scrollToSlot(carousel.querySelector('.meal-action-slot'), { behavior: 'instant' })` (or equivalent method) during initial render settlement so the add action is immediately in view while daily summary is accessible by swiping left.

### 5. Rate-Limit / Cooldown Protection for Refresh
- **File:** `static/js/nutrition.js`
- **Change:** In `generateDailySummary()` / regeneration logic:
  - When the user taps the refresh icon `🔄` on an already completed daily summary (`available: true`), prevent sending redundant network requests.
  - Show a toast notification: `"Анализ за сегодня уже готов! Повторный перерасчет будет доступен завтра."`.
  - Allow regeneration (`force=true`) only when explicitly requested via initial generation or when meal count/composition changed (or error state).

---

## Validation Plan
1. **Automated Checks:**
   - Run linter/type checks (`ruff check .`, pytest) to ensure no regressions.
2. **Visual & Functional Verification:**
   - Verify day view: Daily summary card appears as the first item in the horizontal meals carousel.
   - Verify non-day views (week/month): Daily summary card is omitted from the carousel.
   - Verify carousel focus starts on the "Add Meal" card (`.meal-action-slot`), with daily summary swipeable to the left.
   - Verify tapping refresh on a completed summary shows the rate-limit toast without triggering network calls.

