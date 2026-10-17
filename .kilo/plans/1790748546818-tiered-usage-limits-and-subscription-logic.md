# Plan: Profile UI Enhancements & Tiered Limits (Dev PRO Toggle, Clean Tariff Block, Anthropometrics & KBZhU Form)

## Goal
Refine the Profile page and backend logic to support:
1. Dev/Testing PRO subscription toggle (`POST /api/v1/users/me/toggle-pro`).
2. Clean Tariff & Usage UI: Conditional rendering for PRO members (clean status card, no repeated "Без ограничений" spam) vs Free users (active usage progress bars).
3. Anthropometrics & Target KBZhU Section: Storage of gender, age, height, weight, activity, goal, and Mifflin-St Jeor macro calculation modal/form.

## Affected Boundaries & Files
1. **Backend Route (`app/api/v1/routes.py` or user routes)**: Add `POST /api/v1/users/me/toggle-pro` endpoint.
2. **Database Models & Schemas (`app/models/__init__.py`, `app/schemas/__init__.py`)**: Add fields: `is_premium`, `age`, `goal` ('lose'/'maintain'/'gain'), `meal_ai_daily_count`, `last_meal_ai_date`, etc.
3. **Profile Frontend (`static/js/profile.js`, `static/index.html`)**:
   - PRO toggle button / badge click handler.
   - Clean PRO status card vs Free progress bars card.
   - Anthropometrics & Target KBZhU card and calculation modal with Mifflin-St Jeor formula.

## Detailed Requirements
- Dev PRO Toggle: Endpoint to toggle `user.is_premium`. Frontend button to switch between Free and PRO.
- Clean Tariff UI:
  - If PRO: Badge "PRO Member", descriptive text, "Сбросить до Free (Dev)" button.
  - If Free: Progress bars for Meal AI (X / 5) and Workout Templates (Y / 3), "Активировать PRO" button.
- Anthropometrics & KBZhU Form:
  - Display Gender, Age, Height, Weight, Activity, Goal, and daily target Calories, Protein, Fat, Carbs.
  - Interactive modal to update and recalculate automatically.

## Validation Plan
1. Test backend PRO toggle endpoint via API / frontend click.
2. Verify UI adapts correctly between PRO and Free states.
3. Test Mifflin-St Jeor calculation logic and form updates.
