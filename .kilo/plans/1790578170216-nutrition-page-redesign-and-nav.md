# Plan: Optimized Dashboard Layout, Flip-Card UI Bugfix, Enlarged Carousel & Mandatory Meal Type Selector

## Objective
Optimize the nutrition dashboard with compact layout and period selector (Day / Week / Month averages), fix the 3D flip-card layout overflow and pending status bugs, enlarge carousel cards, enforce a mandatory meal type selector before photo upload, and simplify bottom navigation to 3 tabs.

---

## 1. Bottom Navigation Bar Redesign
- **Target state**: Exactly 3 tabs in `#bottom-nav`:
  1. **Питание (Nutrition)** (`data-page="nutrition"`)
  2. **Тренировки (Workouts)** (`data-page="workouts"`)
  3. **Профиль (Profile)** (`data-page="profile"`)
- Remove Camera floating circle and History tab. Update grid columns to `grid-cols-3`.

---

## 2. Header & Layout Adjustments
- **Top Padding**: Add top padding/margin (`pt-safe`) for the nutrition page header.
- **Date Limits**: Disable the next day (`>`) button when selected date equals today (prevent future dates).
- **Terminology**: Replace "Углы" with "Углеводы" (or "Углев.") globally.

---

## 3. Compact Dashboard & Period Selector (Week / Month Averages)
- **Period Selector**: Tabs/Pills: **День | Неделя | Месяц**.
- **Averages**: When Week or Month is selected, compute and display average daily calories and macro values.
- **Compact Layout**:
  - Remove wide full-width progress bars.
  - Position calorie ring (donut chart) on the left/center and 3 macros (Protein, Fat, Carbs) in a compact horizontal bar / mini columns with colored fills.
  - Reduced vertical padding.
  - AI Meal Quality Score integrated into the dashboard widget.

---

## 4. Page Layout Restructuring (Top to Bottom Sequence)
1. **Header & Date Selector** (with future-date restriction)
2. **Compact Dashboard** (Period Selector + Calorie Ring + Macros + Quality Score)
3. **Food Carousel Section** (Enlarged cards, horizontal scroll-snap with peek effect)
4. **Actions Section** (Below carousel: Meal type selector chips + Photo upload button + Manual entry button + Notes input)

---

## 5. Mandatory Meal Type Selector Before Photo Upload
- **Selector UI**: Chips / buttons for **Завтрак | Обед | Ужин | Перекус** positioned above upload.
- **Validation**: When clicking "Сфотографировать / Добавить блюдо", require meal type selection first (show alert or modal if not selected). Do not upload or call AI without it.
- **Card Display**: Display selected meal type and time on card front (e.g. `Обед · 14:15`).

---

## 6. Fix Flip-Card Layout, Size & Pending Status Bug (`MealCarouselCard`)
- **Enlarged Cards**: Increase card width and height in the horizontal carousel for clear image and text visibility.
- **3D Flip Bugfix**:
  - Use `perspective`, `transform-style: preserve-3d`, `backface-visibility: hidden`.
  - `.flip-card-back` must use `position: absolute; inset: 0; overflow-y-auto` to prevent content from spilling out or overlapping adjacent cards.
- **Pending Status Bugfix**:
  - Instantly hide/remove the yellow "Очередь" badge and reset background/border styles when a meal transitions from pending/offline to synced (`sync_status === SYNCED`).

---

## 7. Validation & Verification Plan
1. **Navigation**: Verify 3-tab bottom nav.
2. **Dashboard & Periods**: Verify Day/Week/Month period switching and average metrics display.
3. **Layout & Terminology**: Verify header top padding, future date blocking, and "Углеводы".
4. **Mandatory Meal Type**: Verify photo upload requires meal type selection and displays correctly on card front.
5. **Flip-Card UI & Bugfix**: Verify enlarged carousel cards, clean 3D card flip with no content overflow, and instant pending badge removal upon sync.
