# Implementation Plan: Non-Blocking "Start with AI" Workout Initiation

## Goal
Optimize the "Start with AI" flow in `static/js/workouts.js` to transition to the active workout screen instantly, decoupling it from the AI preview generation.

## Affected Boundaries & Changes
- **`static/js/workouts.js` (`startTemplateWithAi`)**:
  - Remove the sequential `await` of `loadAiPlan` before calling `renderWorkoutScreen`.
  - Implement a two-step flow:
    1. Await `sessionPromise` (workout creation).
    2. Immediately call `renderWorkoutScreen` to transition the UI.
    3. Trigger `loadAiPlan` (AI preview generation/fetching) in the background.
    4. Implement a reactive update or callback mechanism in `renderWorkoutScreen` to inject AI tips into the UI once they arrive.
  - Relax any remaining frontend-side timeouts related to the AI plan, ensuring that a slow AI response does not interrupt the workout.

## Validation Plan
1. Test "Старт с ИИ" trigger: verify UI transitions to active workout screen instantly, even if AI plan is pending.
2. Verify AI tips/preview populate reactively in the UI after a few seconds without freezing the workout interface.
