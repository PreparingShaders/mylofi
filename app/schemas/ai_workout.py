"""Contracts of the AI workout coach.

The coach answers two questions about a workout, and they are separate contracts
because they are asked at opposite ends of the session:

- the **preview** answers "what should this session look like", before the first
  set, and is never stored - it is advice for the workout in progress;
- the **summary** answers "how did it go and what now", after the last one, and
  is persisted on the session so it can be re-read later without spending the
  quota twice.

Both follow the shape the daily recap uses: a missing verdict is an empty state
with a `reason`, never an error, so the workout screen keeps its layout whatever
the model or the tier did.
"""

from typing import List, Optional

from pydantic import BaseModel, Field

from app.schemas import UsageLimitEntry, UtcDateTime


# ===== Preview =====

class AIWorkoutPreviewExercise(BaseModel):
    """One exercise's targets, as the coach proposes them for this session.

    `weight_kg` is the proposed working weight and is null when the coach has no
    basis for one (an exercise the user has never loaded, bodyweight work): the
    card then shows the sets and reps without inventing a number. `focus` is what
    to watch in the movement, `motivation` one short line to start it with.
    """

    name: str
    sets: Optional[int] = None
    reps: Optional[int] = None
    weight_kg: Optional[float] = None
    rest_seconds: Optional[int] = None
    focus: Optional[str] = None
    motivation: Optional[str] = None


class AIWorkoutPreviewRequest(BaseModel):
    """What to plan: an existing template, or a plain list of exercise names.

    Exactly one source is expected. `exercises` is the fallback for a session the
    user is about to build from scratch, where there is no template id yet; the
    service prefers the template and falls back to the names. `session_id` is set
    when a plan was already generated and stored for the session in progress: the
    preview endpoint then reads the cached plan instead of regenerating it.

    `reduce` asks for the lighter half of the catalogue picks (the strength
    variant), which keeps the compound lifts and drops the accessories. It is the
    same selection the quick start makes, so the plan and the session agree on
    what "shorter" means.
    """

    template_id: Optional[int] = None
    exercises: Optional[List[str]] = Field(None, max_length=40)
    goal: Optional[str] = Field(None, max_length=40)
    name: Optional[str] = Field(None, max_length=255)
    session_id: Optional[int] = None
    reduce: bool = False


class AIWorkoutPreviewResponse(BaseModel):
    """The coach's plan for the session about to start, or why there is none.

    `available` is what the button renders on: an unavailable preview still names
    the workout, so the user can start it without the coach rather than being
    stopped. `limit` is the AI quota as the tier sees it, so the same screen can
    show "Free: one analysis a week" without a second request.
    """

    name: Optional[str] = None
    available: bool = False
    reason: Optional[str] = None
    recommendations: List[AIWorkoutPreviewExercise] = []
    focus: Optional[str] = None
    motivation: Optional[str] = None
    limit: Optional[UsageLimitEntry] = None


# ===== Summary =====

class AIWorkoutSummaryRequest(BaseModel):
    """Optional context for the analysis of one session.

    `notes` is what the model cannot see on its own - a sore shoulder, a rushed
    session, an injury the user worked around. `force` rewrites a verdict that was
    already stored in place, which is the re-analyze button on the history card.
    """

    notes: Optional[str] = Field(None, max_length=400)
    force: bool = False


class AIWorkoutMuscleVolume(BaseModel):
    """One muscle group's contribution to the session.

    `tonnage_kg` and `sets_count` are arithmetic, summed by the database over the
    completed sets of that group - the coach only says what they mean.
    """

    muscle_group: str
    tonnage_kg: float = 0.0
    sets_count: int = 0


class AIWorkoutRecommendation(BaseModel):
    """One next step the coach proposes for the following sessions."""

    title: str
    text: str


class AIWorkoutSummaryResponse(BaseModel):
    """The coach's verdict on one session, or the reason there is none.

    `available` is the flag the card renders on and covers both "never analysed"
    and "could not be analysed": the reason says which, so a missing verdict is an
    empty state rather than an error. `generated` marks a first analysis and
    `reanalyzed` a rewrite of a stored one. `limit` travels on every answer,
    allowed or not, so the history card can show the tier state without guessing.

    The new report structure adds structured sections beyond the headline
    `ai_summary`: `intensity_conclusions` (how hard the work was relative to plan
    and history), `balance_analysis` (distribution across muscle groups), and
    `next_workout_focus` (1-3 concrete actions for the following session).
    """

    workout_id: int
    available: bool = False
    reason: Optional[str] = None
    ai_summary: Optional[str] = None
    overall_score: Optional[float] = None
    muscle_groups: List[AIWorkoutMuscleVolume] = []
    recovery_advice: Optional[str] = None
    highlights: List[str] = []
    recommendations: List[AIWorkoutRecommendation] = []
    # New structured sections for the refactored report.
    intensity_conclusions: Optional[str] = None
    balance_analysis: Optional[str] = None
    next_workout_focus: List[str] = []
    ai_persona: Optional[str] = None
    analyzed_at: Optional[UtcDateTime] = None
    generated: bool = False
    reanalyzed: bool = False
    limit: Optional[UsageLimitEntry] = None


class WorkoutCompletionResponse(BaseModel):
    """Acknowledgement for an async workout completion with AI analysis.

    The completion endpoint returns 202 Accepted immediately when
    `with_ai_analysis=true`: the session is stored, the background task is
    queued, and the verdict will appear in the history once the model answers.
    """

    session_id: int
    message: str


class WorkoutCompletionRequest(BaseModel):
    """Optional flags for completing a workout session.

    `with_ai_analysis` enqueues the retrospective verdict as a background task
    (HTTP 202) instead of requiring a separate call. `notes` carries user
    context for the model that cannot be read from the database alone.
    `duration_seconds` is the client-measured workout duration, used when the
    server timestamp delta would be skewed by timezone offset mismatches.
    """

    with_ai_analysis: bool = False
    notes: Optional[str] = Field(None, max_length=400)
    duration_seconds: Optional[int] = Field(None, ge=0)


__all__ = [
    "AIWorkoutPreviewExercise",
    "AIWorkoutPreviewRequest",
    "AIWorkoutPreviewResponse",
    "AIWorkoutSummaryRequest",
    "AIWorkoutSummaryResponse",
    "AIWorkoutMuscleVolume",
    "AIWorkoutRecommendation",
    "WorkoutCompletionResponse",
    "WorkoutCompletionRequest",
]