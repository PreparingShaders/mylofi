# Final Architecture Plan: Duration, Rest Intervals & Strict Russian Localization in AI Workout Service

## Overview
This plan details the implementation for:
1. **Accurate Session Duration & Timezone Handling**: Using `resolve_duration_seconds` (UTC-normalized `abs()` diff) across all workout completion flows and AI summaries.
2. **Rest Interval Tracking & Prompt Integration (`rest_stats`)**:
   - Query completed `workout_sets` for `completed_at` and `created_at` timestamps.
   - Calculate `avg_rest_seconds` and `max_rest_seconds` between consecutive completed sets.
   - Pass `rest_stats` payload into `WORKOUT_ANALYSIS_PROMPT` and instruct the AI coach to evaluate rest efficiency and pacing.
3. **Strict Russian Localization Enforcement**:
   - Add explicit system prompt rules: *"ALL fields in the JSON response MUST be strictly in Russian."* and *"NEVER use English words for muscle groups, exercise advice, or focus points."*
   - Validate and sanitize responses to ensure zero English drift in muscle groups and advice.

---

## Detailed Implementation Steps

### 1. Session Duration Verification
- Ensure `complete_workout_session` and `cancel_workout_session` in `app/services/workout.py` call `resolve_duration_seconds(session.started_at, completed_at)`.
- Ensure `load_workout_metrics` in `ai_workout_service.py` correctly uses `duration_seconds` or falls back to robust UTC epoch differences.

### 2. Rest Interval Metrics (`rest_stats`)
- In `app/services/ai_workout_service.py` (or helper function), iterate through completed sets ordered chronologically by `completed_at` (or `started_at`/`id`).
- Compute time gaps between consecutive completed sets as rest intervals.
- Compute average rest (`avg_rest_seconds`) and maximum rest (`max_rest_seconds`).
- Inject `rest_stats` into the summary prompt:
  ```python
  rest_stats_line = f"Интервалы отдыха между подходами: среднее время отдыха {rest_stats['avg_rest_seconds']} сек, максимальное {rest_stats['max_rest_seconds']} сек."
  ```
- Instruct AI: *"Оценивай плотность нагрузки и эффективность восстановления, опираясь на фактические интервалы отдыха."*

### 3. Strict Russian Prompt Enforcement
- Update `WORKOUT_ANALYSIS_PROMPT` and preview prompts with mandatory rules:
  - *"ЯЗЫК: ВСЕ поля в JSON-ответе (включая группы мышц, названия, советы, рекомендации) ДОЛЖНЫ быть строго на русском языке. Использование английских слов запрещено."*
- Ensure validation routines check for English characters in generated muscle groups or fallback to Russian equivalents.

---

## Validation Plan
1. **Plan Review**: Verify all requirements are addressed.
2. **Readiness**: Save plan, call `open_plan`, and exit planning mode.
