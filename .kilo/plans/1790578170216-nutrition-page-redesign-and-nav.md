# Plan: Refined Nutrition Page Redesign, Unified Dashboard & Interactive Food Cards

## Objective
Redesign the "Nutrition" page (`/nutrition`) and simplify the Bottom Navigation Bar (3 tabs), implementing a unified nutrition dashboard with a caloric donut chart, macro progress bars, and AI meal quality score, along with interactive flip-cards in a horizontal carousel, gallery/camera photo uploads below the carousel, date selector with future-date blocking, and correct terminology ("Углеводы").

---

## 1. Bottom Navigation Bar Redesign
- **Target state**: Exactly 3 tabs:
  1. **Питание (Nutrition)** (`data-page="nutrition"`)
  2. **Тренировки (Workouts)** (`data-page="workouts"`)
  3. **Профиль (Profile)** (`data-page="profile"`)
- **Changes**: Remove Camera floating circle and History tab from `#bottom-nav` in `static/index.html`. Update grid columns to `grid-cols-3`.

---

## 2. Header & Layout Adjustments
- **Top Padding**: Add appropriate top padding (`pt-safe` / `safe-area-inset-top`) and spacing for the nutrition page header so it doesn't overlap the screen top.
- **Date Limits**: Disable the "next day" (`>`) date button when the selected date is equal to today's date (prevent future dates).
- **Terminology Fix**: Replace instances of "Углы" with "Углеводы" (or "Углев.") across the UI.

---

## 3. Unified Nutrition Dashboard (Merging Macros & Goals)
- **Removal**: Remove separate macro summary block.
- **Widget Structure**:
  - **Center**: Caloric Progress Ring / Donut Chart with current vs target calories (e.g., `1450 / 2000 ккал`).
  - **Macros**: 3 progress bars / mini-indicators for Protein, Fat, and Carbs with current grams and targets.
  - **Meal Quality Score**: AI-derived quality metric (score 1–10 or balance percentage) integrated into the unified dashboard.

---

## 4. Page Layout Restructuring (Top to Bottom Sequence)
1. **Header & Date Selector** (`← Сегодня, [Дата] →` with future date restriction)
2. **Unified Nutrition Dashboard** (Caloric Donut Chart + Macros + Meal Quality Score)
3. **Food Carousel Section** (Horizontal scroll-snap with peek effect)
4. **Actions Section** (Below carousel: Photo upload from camera/gallery button, manual entry button, notes input)

---

## 5. Action Area Enhancements (Photo & Gallery Input)
- **File Input**: Remove rigid `capture="environment"` attribute from `input[type="file"]` so users can choose between capturing with camera or selecting from device gallery.
- **Placement**: Located below the food carousel.

---

## 6. Interactive Flip-Cards for Food Carousel (`MealCarouselCard`)
- **Front Side**:
  - Full-cover background image of the dish.
  - Gradient overlay for text contrast and readability.
  - Overlay metadata: Dish name / meal type, time, KCBZ badge, and AI quality badge.
- **Card Flip Animation**: Tap/click triggers 180-degree CSS card flip (`perspective`, `transform: rotateY(180deg)`).
- **Back Side**:
  - Detailed AI composition breakdown.
  - Analytical AI recommendation comment.
  - Action buttons: «Редактировать» and «Удалить».
  - Second tap flips back to the front side.
- **Empty State**: Neatly styled block when no meals exist for the selected date.

---

## 7. Validation & Verification Plan
1. **Navigation**: Verify 3-tab bottom navigation (`nutrition`, `workouts`, `profile`).
2. **Date Limits & Terminology**: Verify future dates cannot be selected and "Углы" is replaced by "Углеводы".
3. **Unified Dashboard**: Verify calorie donut chart, macro bars, and AI quality score render correctly.
4. **Layout Sequence**: Verify blocks appear in the exact specified order (Header/Date → Dashboard → Carousel → Actions).
5. **Interactive Flip Cards**: Verify card flip animation on tap, front/back details, and edit/delete actions.
6. **Gallery & Camera Upload**: Verify file input allows gallery selection without forced camera capture.
