# Implementation Plan: AI Workout Personalization

## Goal
Implement personalized AI workout plan generation based on user workout history, anthropometrics, fitness level, and stated goals within the MyLofi application.

## Affected Boundaries
- **Backend Services**: `app/services/ai_workout_service.py`, `app/services/limits.py`
- **Backend Schemas & Models**: `app/schemas/ai_workout.py`, database models for workout plans
- **API Routes**: `app/api/v1/routes.py` (workout generation endpoints)
- **Frontend UI**: `static/js/workouts.js`, `static/js/components.js`
- **Tests**: `tests/test_ai_workout_rules.py`

## Data Flow
1. **User Request**: The user initiates AI workout generation via `static/js/workouts.js`, providing current preferences, fitness level, and goals.
2. **Backend Validation & Limits Check**: `app/api/v1/routes.py` verifies user authentication, usage limits (`app/services/limits.py`), and request payload validity against Pydantic schemas (`app/schemas/ai_workout.py`).
3. **Context Gathering**: `app/services/ai_workout_service.py` gathers historical workout data, previous sets, and anthropometric records for the user.
4. **AI Generation**: The service constructs a structured prompt incorporating user history and invokes the LLM vision/text model service.
5. **Persistence & Response**: The generated plan is validated, saved to the database, and returned to the client.
6. **Frontend Rendering**: `workouts.js` renders the generated personalized workout plan interactively.

## Failure Modes & Mitigations
- **Malformed LLM Output**: Strict Pydantic parsing with fallback/retry logic in `ai_workout_service.py`.
- **Exceeded Usage Limits**: Pre-check user limits in API routes and return a clear 429 response handled gracefully in the frontend.
- **Missing Workout History**: Gracefully handle cold-start users (no prior workout history) by falling back to standard fitness level defaults.

## Validation & Testing Plan
1. Run backend unit tests: `pytest tests/test_ai_workout_rules.py`.
2. Verify API endpoint integration with mock LLM responses.
3. Validate frontend rendering and error handling in `static/js/workouts.js`.
