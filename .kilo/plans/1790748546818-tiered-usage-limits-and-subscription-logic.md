# Plan: Tiered Usage Limits & Subscription Logic (Free vs PRO)

## Goal
Implement a usage-based limit system for Free tier users and display active usage counts on the Profile page, supporting Free vs PRO tiers without any emojis in UI text, labels, or badges.

## Affected Boundaries & Files
1. **Database Model (`app/models/__init__.py`)**: Add subscription and usage tracking fields (`is_premium`, `meal_ai_daily_count`, `last_meal_ai_date`, `last_workout_ai_analysis_at`, `last_nutrition_ai_analysis_at`, `created_workouts_count`).
2. **Pydantic Schemas (`app/schemas/__init__.py`)**: Expose subscription status and usage counters in `UserResponse`.
3. **Feature Gate Logic (`app/services/limits.py`)**: Implement daily reset checks and limit validation functions (`can_use_meal_ai`, `can_create_workout_template`, `can_run_workout_ai`, `can_run_nutrition_ai`, `can_use_combined_ai`).
4. **Profile UI & JS (`static/js/profile.js` & HTML)**: Render subscription status badge ("Free Plan" or "PRO Member"), usage progress bars, text counters, and the "Активировать PRO" button.

## Detailed Requirements & Constraints
- Strictly no emojis in UI text, labels, or badges.
- Daily reset at midnight for `meal_ai_daily_count`.
- Free tier limits:
  - Meal AI recognition: 5 photo analyses per day.
  - Workout routines creation: Max 3 custom templates.
  - Weekly AI workout analysis: 1 analysis per 7 days.
  - Weekly AI nutrition analysis: 1 analysis per 7 days.
  - Combined AI analysis: PRO only.

## Validation Plan
1. Inspect database model and schema migrations / initialization.
2. Verify feature gate helper functions handle daily resets and premium bypass correctly.
3. Verify Profile UI correctly renders progress bars, counters, and subscription badge without emojis.
