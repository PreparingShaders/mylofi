"""AI workout coach: the plan before a session, the verdict after it.

Same two halves as the nutrition side, built on the same primitives: the model
cascade (`run_text_cascade`), the persona keys (`normalize_persona`), the verdict
rules (`strip_emojis`, `clamp_sentences`, `normalise_score`) and the tier gate
(`can_run_workout_ai`). Only the domain differs - there is no photo and no
per-meal verdict, there is a session with sets in it.

The two answers are deliberately asymmetric:

- the **preview** is advice for the workout in progress. It is not stored, it
  never raises, and it never consumes the quota: a user who asked for a plan and
  then got a model error must still be able to lift.
- the **summary** is the retrospective verdict. It is written on the session, so
  re-opening the history costs no quota, and it is the one call that moves the
  Free tier's weekly cooldown (`last_workout_ai_analysis_at`).

Every number the coach speaks about is arithmetic, never the model's: tonnage,
set counts and per-muscle-group volume are summed by SQL and handed to the prompt
as context, and the response is forbidden from restating them (rule 6). The only
figures the model is allowed to produce are the *proposed* ones in the preview
and in the recommendations, which are advice rather than a reading of the past.
"""

import asyncio
import json
import logging
import math
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Sequence, Tuple

from sqlalchemy import case, func, literal, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.session import async_session_maker

from app.models import (
    ExerciseCatalog,
    User,
    WorkoutSession,
    WorkoutSessionExercise,
    WorkoutSessionStatus,
    WorkoutSet,
    WorkoutTemplate,
)
from app.services.ai_vision import (
    clamp_sentences,
    count_sentences,
    normalise_score,
    normalize_persona,
    run_text_cascade,
    sanitize_persona_text,
    strip_emojis,
)
from app.services.limits import LimitDecision, can_run_workout_ai
from app.services.nutrition import utcnow
from app.services.workout import (
    WORKOUT_GOAL_SETTINGS,
    as_utc,
    select_quick_start_exercises,
)

logger = logging.getLogger(__name__)

# Wall-clock budget for one coach answer. `run_text_cascade` bounds every single
# model call; this bounds the cascade as a whole, so the request that asked for a
# verdict always gets an answer - a stored one, or an empty state.
WORKOUT_AI_TASK_TIMEOUT = 60.0

# A verdict on a session is read, not studied: 3-6 sentences is one glance on the
# phone. The upper bound is enforced by a clamp (a model drifting into an essay is
# cut on a sentence end); the lower one is a prompt rule only, because padding a
# verdict the model already wrote well is worse than a slightly short one.
SUMMARY_MIN_SENTENCES = 3
SUMMARY_MAX_SENTENCES = 6

# Upper bounds on a prompt, not on the workout: a template with 30 exercises must
# not crowd the exercises the user actually picked out of the answer, and a long
# personal note must not crowd out the rules.
MAX_EXERCISES_IN_PROMPT = 12
MAX_NOTES_CHARS = 400
MAX_RECENT_SESSIONS = 8
# Working sets spelled out per exercise in the prompt, newest first: the last few
# sessions of "weight x reps" are what makes a weight going up while the reps go
# down visible, which a single "last weight" figure cannot show.
MAX_HISTORY_SETS = 3
# Length of the coach's per-exercise lines on the active workout card. The card is
# one exercise wide between two set rows, so a line the model writes at length
# pushes the set list off the screen on a phone and shrinks to nothing on a
# desktop. 12-15 words is what fits there without being cut mid-thought. The upper
# bound is enforced by a clamp; the lower one is a prompt rule only, because
# padding a tip the model already wrote well is worse than a slightly short one.
TIP_MIN_WORDS = 12
TIP_MAX_WORDS = 15
MAX_MUSCLE_GROUPS = 8
MAX_HIGHLIGHTS = 4
MAX_RECOMMENDATIONS = 4

# Upper bounds on the new structured report fields. These are advice sections,
# not prose dumps: one line each, clamped so a chatty model cannot push the
# card off the screen.
MAX_INTENSITY_CONCLUSIONS_CHARS = 400
MAX_BALANCE_ANALYSIS_CHARS = 400
MAX_NEXT_WORKOUT_FOCUS_CHARS = 200
MAX_NEXT_WORKOUT_FOCUS_ITEMS = 3

# Plausible ranges for the figures the model proposes. A value outside one of them
# is dropped rather than clamped: printing "340 кг" as a working weight would be
# worse advice than printing no weight at all.
PREVIEW_MAX_SETS = 10
PREVIEW_MAX_REPS = 60
PREVIEW_MAX_WEIGHT_KG = 500.0
PREVIEW_MAX_REST_SECONDS = 600

# A per-exercise line is a target, not a manual.
MAX_NOTE_CHARS = 200
MAX_RECOVERY_CHARS = 400
MAX_HIGHLIGHT_CHARS = 180
MAX_RECOMMENDATION_CHARS = 400

# Reasons the cards show instead of a verdict. They travel with the payload rather
# than living in the UI copy, so the wording sits next to the rule that produced it.
REASON_NO_EXERCISES = "Нет упражнений для плана"
REASON_PREVIEW_FAILED = "Не удалось составить план тренировки"
REASON_NO_SETS = "Нет выполненных подходов с весом"
REASON_FAILED = "Не удалось разобрать тренировку"
REASON_NOT_ANALYZED = "Тренировка ещё не разобрана"
REASON_NOT_FOUND = "Тренировка не найдена"

# Status values for the async AI plan generation on WorkoutSession.ai_plan_status.
AI_PLAN_STATUS_PENDING = "pending"
AI_PLAN_STATUS_AVAILABLE = "available"
AI_PLAN_STATUS_FAILED = "failed"
AI_PLAN_STATUS_NO_EXERCISES = "no_exercises"

# Which group an exercise that is not in the catalog is filed under. The session
# stores free-text names, so this is the honest bucket: it is counted, but the
# model is told it is an unnamed group rather than being given a fake name.
OTHER_MUSCLE_GROUP = "прочие мышцы"

# How the database's lowercase English muscle group keys read in Russian.
# The catalog stores `back`, `chest`, `quadriceps` and the rest; the user and
# the coach both speak Russian, so every line that names a group is translated
# here rather than in the markup. A key that is not in the map falls back to
# `OTHER_MUSCLE_GROUP` (which is already Russian), so an unknown group never
# reaches the prompt as raw English.
MUSCLE_GROUP_LABELS = {
    "back": "Спина",
    "chest": "Грудь",
    "quadriceps": "Квадрицепс",
    "hamstrings": "Бицепс бедра",
    "glutes": "Ягодицы",
    "shoulders": "Плечи",
    "biceps": "Бицепс",
    "triceps": "Трицепс",
    "abs": "Пресс",
    "calves": "Икры",
    OTHER_MUSCLE_GROUP: "Прочие мышцы",
}

_MUSCLE_RU_RE = re.compile(
    r"\b(" + "|".join(re.escape(k) for k in MUSCLE_GROUP_LABELS if k != OTHER_MUSCLE_GROUP) + r")\b",
    re.IGNORECASE,
)
_MUSCLE_RU_MAP = {k.lower(): v for k, v in MUSCLE_GROUP_LABELS.items() if k != OTHER_MUSCLE_GROUP}


def _russianize_muscle_groups(text: str) -> str:
    """Replace known English muscle group keys in text with Russian labels."""
    if not text:
        return text

    def _replace(match: re.Match) -> str:
        return _MUSCLE_RU_MAP.get(match.group(0).lower(), match.group(0))

    return _MUSCLE_RU_RE.sub(_replace, text)


def _translate_muscle_group(value: Any) -> str:
    """The Russian label for a muscle group key, or the honest fallback.

    The database stores lowercase English slugs (`back`, `chest`); everything
    the user sees - the volume pills, the balance analysis, the prompt's
    context block - is Russian. Unknown keys keep their own text rather than
    being mapped to the fallback, so a typo in the catalog does not silently
    rename a group.
    """
    key = " ".join(str(value or "").split()).lower()
    if not key:
        return OTHER_MUSCLE_GROUP
    return MUSCLE_GROUP_LABELS.get(key, key)

# How the stored workout goal key reads inside a prompt. The profile goal
# (`lose`/`maintain`/`gain`) describes the body, this one describes the session.
WORKOUT_GOAL_LABELS = {
    "strength": "сила: базовые движения, низкие повторы",
    "hypertrophy": "набор массы: объём и контроль",
    "endurance": "выносливость: лёгкий вес и много подходов",
}

# The voice the coach answers in. The keys are the profile's personas and
# `normalize_persona` is the same resolver the nutritionist uses, so one place
# decides which voices exist and what an unknown one falls back to; only the
# wording is domain-specific here, because a coach that calls itself a
# nutritionist would be answering the wrong question.
COACH_PERSONA_PROMPTS = {
    "kind": (
        "Ты — добрый тренер. Говори тепло и поддерживающе, без нравоучений: "
        "сначала что получилось, потом что подтянуть, и всегда с конкретным действием."
    ),
    "strict": (
        "Ты — строгий тренер. Говори коротко, по делу и без уступок: называй просадки прямо, "
        "требуй конкретных действий и не смягчай оценку общими словами."
    ),
    "sarcastic": (
        "Ты — тренер в духе Джарвиса: спокойный, умный, с сухим английским юмором и иронией, "
        "которая звучит фоном, а не фокусом. Ирония направлена на подход, технику и привычки, "
        "а не на человека: никаких насмешек над пользователем и никакой снисходительности. "
        "Текст всё равно остаётся точной профессиональной оценкой: ирония слышна фоном, "
        "а выводы по тренировке - серьёзно."
    ),
    "custom": (
        "Ты — тренер. Стиль общения пользователь задаёт сам, и он указан сразу после этого "
        "предложения. Следуй ему в формулировках, не меняя при этом факты, цифры и JSON-формат ответа."
    ),
}


# ===== text helpers ============================================================

def _exercise_key(value: Any) -> str:
    """The comparison key of an exercise name.

    Session exercises are free-text names the user typed or picked from the
    catalog, so the same movement arrives with different spacing or casing
    depending on where it was created. Everything that matches names across rows
    goes through this key, the same way `get_last_exercise_sets` compares them.
    """
    return " ".join(str(value or "").split()).lower()


def _flatten(value: Any, limit: int) -> str:
    """One bounded line: newlines flattened, capped, no leading or trailing space.

    The model is asked for single sentences, but a chatty answer turns a prompt
    field into a paragraph or a bullet list, and a bullet list on a set row reads
    as a rendering bug. Flattening keeps the card's layout the prompt promised.
    """
    if value is None:
        return ""
    cleaned = " ".join(str(value).split())
    if len(cleaned) > limit:
        cleaned = cleaned[:limit].rstrip() + "..."
    return cleaned


def _clean_line(value: Any, limit: int) -> Optional[str]:
    """A single emoji-free line, or None when nothing usable is left."""
    cleaned = strip_emojis(_flatten(value, limit))
    if not cleaned.strip():
        return None
    # A field the model filled with a bare list marker reads as a broken card.
    return cleaned.lstrip("-•*— ").strip() or None


def _clean_tip(value: Any) -> Optional[str]:
    """A coach's line for one exercise, cut to TIP_MAX_WORDS words.

    The rule is asked for in the prompt and applied here, because a model that
    ignores the length still has to produce a card that fits: the cut lands on a
    word end so the line stays readable, and a tip that already fits is left
    exactly as written rather than rephrased.
    """
    cleaned = _clean_line(value, MAX_NOTE_CHARS)
    if not cleaned:
        return None
    if count_sentences(cleaned) > 1:
        logger.info(
            f"[AI Workout] Exercise tip is {count_sentences(cleaned)} sentences, clamping to 1: {cleaned!r}"
        )
        cleaned = clamp_sentences(cleaned, 1)
    words = cleaned.split()
    if len(words) <= TIP_MAX_WORDS:
        return cleaned
    logger.info(
        f"[AI Workout] Exercise tip is {len(words)} words, cutting to {TIP_MAX_WORDS}: {cleaned!r}"
    )
    return " ".join(words[:TIP_MAX_WORDS])


def _clean_optional_number(value: Any, low: float, high: float) -> Optional[float]:
    """A proposed figure inside its plausible range, or None.

    Dropped rather than clamped: a weight of 900 kg is not "a very heavy squat",
    it is the model inventing a number, and printing it as a target would be worse
    than printing nothing.
    """
    if value is None or isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number) or number < low or number > high:
        return None
    # Tenths are what the plate maths of the tracker works in, so a weight is
    # rounded there and everything else to whole units.
    return round(number, 1)


def _clean_int(value: Any, low: int, high: int) -> Optional[int]:
    if value is None or isinstance(value, bool):
        return None
    try:
        number = int(round(float(value)))
    except (TypeError, ValueError):
        return None
    if number < low or number > high:
        return None
    return number


def _sanitize_verdict(text: Any) -> str:
    """Apply the verdict rules the model is asked for but cannot be trusted with.

    Same treatment as the dish verdict: emoji stripped, length clamped on a
    sentence end. A verdict that came back short is left short rather than padded
    with filler.
    """
    cleaned = strip_emojis(_flatten(text, 1200))
    if count_sentences(cleaned) > SUMMARY_MAX_SENTENCES:
        cleaned = clamp_sentences(cleaned, SUMMARY_MAX_SENTENCES)
    if count_sentences(cleaned) < SUMMARY_MIN_SENTENCES:
        logger.info(
            f"[AI Workout] ai_summary is shorter than {SUMMARY_MIN_SENTENCES} sentences: "
            f"{count_sentences(cleaned)}"
        )
    return cleaned


def _persona_line(persona: Optional[str], persona_custom_text: Optional[str], field: str) -> str:
    """The persona block, shared by both prompts.

    The persona is a tone of voice, not a task: it is stated once and the rules
    around it (the JSON contract, the length, the no-emoji rule, the no-digits
    rule) stay binding regardless of voice, exactly as they do for the dish
    verdict and the daily recap.
    """
    persona_key = normalize_persona(persona)
    custom_text = sanitize_persona_text(persona_custom_text)
    return (
        f"Персонализация: {COACH_PERSONA_PROMPTS[persona_key]}"
        + (
            f' Пользовательский стиль: "{custom_text}". '
            if persona_key == "custom" and custom_text
            else ""
        )
        + f" Персона влияет только на тон формулировок {field}: длина, отсутствие эмодзи, "
        "формат ответа и все правила оценки выше действуют в полном объёме."
    )


def _fmt_weight(value: Any) -> str:
    """A weight for the prompt: "50", "62.5", or "?" when there is none.

    `:g` rather than `str(float)`, so 50.0 reads as 50 and the model is not shown
    a precision the tracker itself does not use (plates move in 1.25 kg steps).
    """
    try:
        number = float(value)
    except (TypeError, ValueError):
        return "?"
    return f"{number:g}"


def _athlete_line(user: User) -> str:
    """Who the coach is talking to, in the words the profile stores.

    A missing figure is printed as "?" rather than omitted, so the model can tell
    "not set" from "zero" - the difference between "nobody told me anything about
    this lifter" and "a lifter who weighs nothing".
    """
    return (
        f"Профиль: пол {user.gender or '?'}, возраст {user.age if user.age is not None else '?'} лет, "
        f"рост {user.height_cm if user.height_cm is not None else '?'} см, "
        f"вес {user.weight_kg if user.weight_kg is not None else '?'} кг, "
        f"активность {user.activity_level or '?'}. "
        f"Цель по телу: {user.goal or 'не определена'}. "
    )


# ===== context read from the database ===========================================

async def load_workout_metrics(db: AsyncSession, session_id: int) -> Dict[str, Any]:
    """Exact figures of one session, added up by the database.

    Tonnage, set counts, the heaviest completed set: all arithmetic, so the coach
    reasons about the same numbers the history card and the tonnage chart show.
    `coalesce` turns a session with no sets into zeros rather than a NULL row.
    """
    result = await db.execute(
        select(
            func.coalesce(
                func.sum(
                    case(
                        (WorkoutSet.is_completed.is_(True), WorkoutSet.weight_kg * WorkoutSet.reps),
                        else_=0,
                    )
                ),
                0,
            ).label("tonnage_kg"),
            func.count(WorkoutSet.id).label("sets_count"),
            func.coalesce(
                func.sum(case((WorkoutSet.is_completed.is_(True), 1), else_=0)),
                0,
            ).label("completed_sets"),
            func.max(
                case(
                    (WorkoutSet.is_completed.is_(True), WorkoutSet.weight_kg),
                )
            ).label("top_weight_kg"),
            func.coalesce(func.sum(WorkoutSet.reps), 0).label("reps"),
            # The stored duration is filled in when the timer closes the session;
            # the timestamps are the fallback for a session closed another way.
            # `greatest(0, ...)` is the backstop for a row written before the
            # duration was normalised: a negative epoch would otherwise reach the
            # prompt and be quoted back to the user as a negative workout length.
            func.greatest(
                func.coalesce(
                    func.nullif(WorkoutSession.duration_seconds, 0),
                    func.extract("epoch", WorkoutSession.completed_at - WorkoutSession.started_at),
                ),
                0,
            ).label("duration_seconds"),
            WorkoutSession.name.label("name"),
        )
        .select_from(WorkoutSession)
        .join(WorkoutSessionExercise, WorkoutSessionExercise.session_id == WorkoutSession.id)
        .join(WorkoutSet, WorkoutSet.exercise_id == WorkoutSessionExercise.id)
        .where(WorkoutSession.id == session_id)
        .group_by(WorkoutSession.id)
    )
    row = result.first()
    if row is None:
        return {
            "tonnage_kg": 0.0,
            "sets_count": 0,
            "completed_sets": 0,
            "top_weight_kg": 0.0,
            "reps": 0,
            "duration_seconds": 0,
            "name": None,
        }
    return {
        "tonnage_kg": float(row.tonnage_kg or 0),
        "sets_count": int(row.sets_count or 0),
        "completed_sets": int(row.completed_sets or 0),
        "top_weight_kg": float(row.top_weight_kg or 0),
        "reps": int(row.reps or 0),
        "duration_seconds": int(row.duration_seconds or 0),
        "name": row.name,
    }


async def load_muscle_volume(db: AsyncSession, session_id: int, user_id: int) -> List[Dict[str, Any]]:
    """Tonnage and set count per muscle group, as the database summed them.

    Session exercises are free-text names, so the group is resolved through the
    catalog (a global entry or the user's own), the same join the tonnage filter
    uses. An exercise nobody catalogued lands in `OTHER_MUSCLE_GROUP` instead of
    being dropped: its tonnage is still real work, and the verdict is told the
    group has no name rather than being given an invented one.
    """
    # An outer join is what makes the fallback reachable: an inner one silently
    # drops every exercise missing from the catalog, which is exactly the case the
    # fallback exists for.
    muscle_group = func.coalesce(ExerciseCatalog.muscle_group, literal(OTHER_MUSCLE_GROUP))
    result = await db.execute(
        select(
            muscle_group.label("muscle_group"),
            func.coalesce(func.sum(WorkoutSet.weight_kg * WorkoutSet.reps), 0).label("tonnage_kg"),
            func.count(WorkoutSet.id).label("sets_count"),
        )
        .select_from(WorkoutSessionExercise)
        .join(WorkoutSet, WorkoutSet.exercise_id == WorkoutSessionExercise.id)
        .outerjoin(
            ExerciseCatalog,
            (func.lower(ExerciseCatalog.name) == func.lower(WorkoutSessionExercise.name))
            & or_(ExerciseCatalog.user_id.is_(None), ExerciseCatalog.user_id == user_id),
        )
        .where(
            WorkoutSessionExercise.session_id == session_id,
            WorkoutSet.is_completed.is_(True),
            WorkoutSet.weight_kg.isnot(None),
            WorkoutSet.reps.isnot(None),
        )
        .group_by(muscle_group)
        .order_by(func.sum(WorkoutSet.weight_kg * WorkoutSet.reps).desc())
        .limit(MAX_MUSCLE_GROUPS)
    )
    return [
        {
            "muscle_group": _translate_muscle_group(row.muscle_group),
            "tonnage_kg": round(float(row.tonnage_kg or 0), 1),
            "sets_count": int(row.sets_count or 0),
        }
        for row in result.all()
    ]


async def load_rest_stats(db: AsyncSession, session_id: int) -> Dict[str, Any]:
    """Rest intervals between consecutive completed sets, computed from timestamps."""
    result = await db.execute(
        select(WorkoutSet.completed_at)
        .join(WorkoutSessionExercise, WorkoutSet.exercise_id == WorkoutSessionExercise.id)
        .where(
            WorkoutSessionExercise.session_id == session_id,
            WorkoutSet.is_completed.is_(True),
            WorkoutSet.completed_at.isnot(None),
        )
        .order_by(WorkoutSet.completed_at.asc())
    )
    timestamps = [as_utc(row.completed_at) for row in result.all()]
    timestamps = [t for t in timestamps if t is not None]
    if len(timestamps) < 2:
        return {"avg_rest_seconds": 0, "max_rest_seconds": 0}

    intervals = []
    for i in range(1, len(timestamps)):
        intervals.append(abs(int((timestamps[i] - timestamps[i - 1]).total_seconds())))

    return {
        "avg_rest_seconds": int(sum(intervals) / len(intervals)),
        "max_rest_seconds": int(max(intervals)),
    }


async def _load_working_sets(
    db: AsyncSession,
    session_ids: Sequence[int],
    *,
    exclude_session_id: Optional[int] = None,
) -> Dict[Tuple[str, int], Dict[str, float]]:
    """The working set of every exercise in every given session, keyed by both.

    The aggregate above reports the heaviest weight and the highest reps of a
    session as two separate maxima, which can come from two different sets: a
    "60 kg on 12 reps" line that was never performed. This reads the sets of the
    same bounded window and keeps the heaviest one per exercise per session, so
    a "60x8" in the prompt is a set the user actually did.

    One query for the whole window, the same reason as the aggregate above: a
    12-exercise plan stays a fixed number of reads instead of one per exercise.
    """
    if not session_ids:
        return {}

    result = await db.execute(
        select(
            WorkoutSessionExercise.name.label("name"),
            WorkoutSession.id.label("session_id"),
            WorkoutSet.weight_kg.label("weight_kg"),
            WorkoutSet.reps.label("reps"),
        )
        .select_from(WorkoutSessionExercise)
        .join(WorkoutSet, WorkoutSet.exercise_id == WorkoutSessionExercise.id)
        .join(WorkoutSession, WorkoutSession.id == WorkoutSessionExercise.session_id)
        .where(
            WorkoutSessionExercise.session_id.in_(session_ids),
            WorkoutSet.is_completed.is_(True),
            WorkoutSet.weight_kg.isnot(None),
            WorkoutSet.reps.isnot(None),
            *(
                [WorkoutSession.id != exclude_session_id]
                if exclude_session_id is not None
                else []
            ),
        )
    )

    working: Dict[Tuple[str, int], Dict[str, float]] = {}
    for row in result.all():
        key = _exercise_key(row.name)
        if not key:
            continue
        pair = {"weight_kg": float(row.weight_kg or 0), "reps": int(row.reps or 0)}
        best = working.get((key, row.session_id))
        # Heaviest set wins, and equal weight is broken by reps, so a top set of
        # eight reads as the working set instead of the five that preceded it.
        if best is None or (pair["weight_kg"], pair["reps"]) > (best["weight_kg"], best["reps"]):
            working[(key, row.session_id)] = pair
    return working


async def load_recent_performance(
    db: AsyncSession,
    user_id: int,
    exercise_names: Sequence[str],
    *,
    exclude_session_id: Optional[int] = None,
) -> Dict[str, Dict[str, Any]]:
    """What the user actually lifts, per exercise, from the last few sessions.

    The preview may not invent a working weight, so it has to be told the real
    one. This is the history the plan reasons about: the last working set, the
    working sets of the last `MAX_HISTORY_SETS` sessions as weight x reps, the
    best estimated 1RM (Epley, the same formula the tonnage trend uses) and the
    tonnage of the recent sessions, oldest first, so "up" reads as up.

    The window is the last `MAX_RECENT_SESSIONS` completed sessions, read in two
    queries (aggregates, then the sets themselves) rather than one query per
    exercise, so a 12-exercise plan stays a fixed number of reads.

    `exclude_session_id` leaves one session out of both reads: when the verdict
    is built for a session, its own sets are already given exactly above, and
    counting them twice would make every trend end in the number being judged.
    """
    names = [str(name).strip() for name in exercise_names if str(name or "").strip()]
    if not names:
        return {}

    recent = select(WorkoutSession.id).where(
        WorkoutSession.user_id == user_id,
        WorkoutSession.status == WorkoutSessionStatus.COMPLETED,
    ).order_by(WorkoutSession.started_at.desc()).limit(MAX_RECENT_SESSIONS)
    session_ids = list((await db.execute(recent)).scalars().all())
    if not session_ids:
        return {}

    result = await db.execute(
        select(
            WorkoutSessionExercise.name.label("name"),
            WorkoutSession.id.label("session_id"),
            func.coalesce(func.sum(WorkoutSet.weight_kg * WorkoutSet.reps), 0).label("tonnage_kg"),
            func.count(WorkoutSet.id).label("sets_count"),
            func.max(WorkoutSet.weight_kg).label("top_weight_kg"),
            func.max(WorkoutSet.reps).label("top_reps"),
            func.max(WorkoutSet.weight_kg * (1 + WorkoutSet.reps / 30.0)).label("best_e1rm"),
            WorkoutSession.started_at.label("started_at"),
        )
        .select_from(WorkoutSessionExercise)
        .join(WorkoutSet, WorkoutSet.exercise_id == WorkoutSessionExercise.id)
        .join(WorkoutSession, WorkoutSession.id == WorkoutSessionExercise.session_id)
        .where(
            WorkoutSessionExercise.session_id.in_(session_ids),
            WorkoutSet.is_completed.is_(True),
            WorkoutSet.weight_kg.isnot(None),
            WorkoutSet.reps.isnot(None),
            *(
                [WorkoutSession.id != exclude_session_id]
                if exclude_session_id is not None
                else []
            ),
        )
        .group_by(WorkoutSessionExercise.name, WorkoutSession.id, WorkoutSession.started_at)
        # Newest first: `entries[0]` is read as the last performance of the
        # exercise, so the order has to come from the query and not from whatever
        # order the grouping happens to produce.
        .order_by(WorkoutSession.started_at.desc(), WorkoutSession.id.desc())
    )

    history: Dict[str, List[Dict[str, Any]]] = {}
    for row in result.all():
        name = _flatten(row.name, 255)
        key = _exercise_key(name)
        if not key:
            continue
        history.setdefault(key, []).append(
            {
                "name": name,
                "session_id": row.session_id,
                "tonnage_kg": float(row.tonnage_kg or 0),
                "sets_count": int(row.sets_count or 0),
                "top_weight_kg": float(row.top_weight_kg or 0),
                "top_reps": int(row.top_reps or 0),
                "best_e1rm": float(row.best_e1rm or 0),
                "started_at": as_utc(row.started_at),
            }
        )

    working_sets = await _load_working_sets(
        db, session_ids, exclude_session_id=exclude_session_id
    )

    profile: Dict[str, Dict[str, Any]] = {}
    # A session with no start time sorts first rather than crashing the
    # comparison between an aware and a naive datetime.
    epoch = datetime.min.replace(tzinfo=timezone.utc)
    for key, entries in history.items():
        newest = max(entries, key=lambda entry: (entry["started_at"] or epoch, entry["session_id"]))
        # Oldest first, so "up" in the prompt reads as up on screen.
        trend = sorted(entries, key=lambda entry: (entry["started_at"] or epoch, entry["session_id"]))
        # Newest first, because the next session starts from the last set: the
        # sequence is what shows a weight that went up while the reps went down.
        recent_sets: List[Dict[str, Any]] = []
        for entry in reversed(trend):
            pair = working_sets.get((key, entry["session_id"]))
            if pair:
                recent_sets.append(dict(pair))
            if len(recent_sets) >= MAX_HISTORY_SETS:
                break
        profile[key] = {
            "name": newest["name"],
            "last_weight_kg": newest["top_weight_kg"],
            "last_reps": newest["top_reps"],
            "best_e1rm_kg": round(max((entry["best_e1rm"] for entry in entries), default=0.0), 1),
            "recent_sets": recent_sets,
            "tonnage_trend": [round(entry["tonnage_kg"], 1) for entry in trend],
            "sessions": len(entries),
            "total_sets": sum(entry["sets_count"] for entry in entries),
        }
    return profile


def _performance_line(profile: Dict[str, Any]) -> str:
    """One prompt line per exercise the user has done before."""
    name = _flatten(profile.get("name"), 80)
    trend = profile.get("tonnage_trend") or []
    trend_text = " -> ".join(_fmt_weight(value) for value in trend) if trend else "?"
    sets_text = (
        " -> ".join(
            f"{_fmt_weight(entry.get('weight_kg'))}x{entry.get('reps') or 0}"
            for entry in (profile.get("recent_sets") or [])
        )
        or "?"
    )
    return (
        f"- {name}: прошлый рабочий вес {_fmt_weight(profile.get('last_weight_kg'))} кг на "
        f"{profile.get('last_reps') or 0} повт., рабочие подходы последних тренировок "
        f"(от свежей к старой): {sets_text}, "
        f"лучшая оценка 1ПМ "
        f"{_fmt_weight(profile.get('best_e1rm_kg'))} кг, тоннаж последних "
        f"{profile.get('sessions') or 0} тренировок: {trend_text} кг, "
        f"всего подходов {profile.get('total_sets') or 0}."
    )


def _muscle_line(entry: Dict[str, Any]) -> str:
    return (
        f"- {entry['muscle_group']}: {_fmt_weight(entry['tonnage_kg'])} кг тоннажа, "
        f"{entry['sets_count']} подходов"
    )


# ===== preview =================================================================

PREVIEW_REQUIRED_FIELDS = ["recommendations"]


def build_workout_preview_prompt(
    exercises: Sequence[Dict[str, Any]],
    *,
    session_name: Optional[str] = None,
    goal: Optional[str] = None,
    athlete_line: str = "",
    performance_lines: Sequence[str] = (),
    persona: Optional[str] = None,
    persona_custom_text: Optional[str] = None,
    reduce: bool = False,
) -> str:
    """Prompt for the plan of the session that is about to start.

    The exercise list is closed: the model answers about the movements the user
    actually picked, and validation maps the answers back onto that list, so a
    chatty model cannot smuggle an exercise into the workout. The history of those
    exercises travels as context, because the one thing the model must not do is
    invent a working weight for a lifter it knows nothing about.
    """
    listed = "\n".join(
        f"- {index + 1}. {_flatten(item.get('name'), 80)}"
        + (
            f" (в шаблоне: {item['sets']}x{item['reps']}"
            + (f", {_fmt_weight(item.get('weight_kg'))} кг" if item.get("weight_kg") else "")
            + ")"
            if item.get("sets")
            else ""
        )
        for index, item in enumerate(exercises)
    )

    goal_text = WORKOUT_GOAL_LABELS.get((goal or "").strip().lower(), "")
    goal_line = f"Цель тренировки: {goal_text}. " if goal_text else ""
    name_line = f"Название тренировки: {_flatten(session_name, 80)}. " if session_name else ""

    history_block = "\n".join(performance_lines) if performance_lines else ""
    history_text = (
        f"Что пользователь уже показывает по этим упражнениям (точные цифры из базы):\n{history_block}\n"
        if history_block
        else "История по этим упражнениям пуста: ни одного завершённого подхода с весом ещё нет. "
    )

    reduce_line = (
        "Это СОКРАЩЁННЫЙ вариант тренировки: убери вспомогательные/изоляционные упражнения, "
        "оставь только базовые движения и не добавляй новых. "
        if reduce
        else ""
    )

    return f"""Ты — тренер по силовым тренировкам. Ты уже знаешь, какие упражнения выбраны, и верни СТРОГО валидный JSON с полями:
{{
  "focus": "Одно предложение: главный акцент этой тренировки.",
  "motivation": "Одно короткое предложение, чтобы начать тренировку.",
  "recommendations": [
    {{
      "name": "название упражнения из списка, дословно",
      "sets": 4,
      "reps": 8,
      "weight_kg": 62.5,
      "rest_seconds": 120,
      "focus": "Одно предложение из {TIP_MIN_WORDS}-{TIP_MAX_WORDS} слов: на что смотреть в этом движении.",
      "motivation": "Одно предложение из {TIP_MIN_WORDS}-{TIP_MAX_WORDS} слов именно к этому подходу."
    }}
  ]
}}
Все числовые значения — float. weight_kg может быть null. Никаких пояснений, только JSON.

Правила плана (обязательно):
0. ЯЗЫК: ВСЕ поля в JSON-ответе (включая названия упражнений, фокус, мотивацию, советы, рекомендации) ДОЛЖНЫ быть строго на русском языке. Использование английских слов запрещено.
1. СПИСОК ЗАКРЫТ: в recommendations РОВНО один объект на каждое упражнение из списка ниже, в том же порядке и с тем же названием. Не добавляй упражнений, не убирай их и не переименовывай.
2. НОЛЬ ЭМОДЗИ: ни одного эмодзи, смайлика, иконки или символического значка из наборов эмодзи - ни в focus, ни в motivation, ни в name. Только обычные буквы, пробелы и знаки препинания.
3. ВЕС - ИЗ ИСТОРИИ, А НЕ ИЗ ГОЛОВЫ: если по упражнению есть история, отталкивайся от прошлого рабочего веса и добавь не больше 10% на силовые базовые движения и не больше 5% на изоляцию. Если истории по упражнению нет - верни weight_kg: null и не выдумывай число. Никогда не указывай вес, которого пользователь не поднимал.
4. ПОВТОРЕНИЯ И ПОДХОДЫ: держись диапазона, который реально даёт прогресс (для силы 3-6 повторов, для массы 6-12, для выносливости 12-20), и не предлагай больше 10 подходов одного упражнения за тренировку. Отдых 60-180 секунд, для тяжёлых базовых движений до 240.
5. БЕЗ ЦИФР В ТЕКСТЕ: в focus и motivation никаких цифр, килограммов и повторений. Цифры живут только в полях sets, reps, weight_kg и rest_seconds, а пользователь видит их в бейджах на карточке упражнения.
6. НИКАКИХ СПИСКОВ И РАЗМЕТОК: focus и motivation - одно связное предложение обычным текстом, без маркеров, нумерации, заголовков и переносов строк.
7. КОРОТКО: каждая строка focus и motivation - {TIP_MIN_WORDS}-{TIP_MAX_WORDS} слов. Это подпись под карточкой упражнения, а не разбор упражнения: длинная фраза выдавливает список подходов с экрана.
8. ПРОГРЕССИВНАЯ ПЕРЕГРУЗКА: НЕ повышай рабочий вес там, где по истории упражнения повторения или тоннаж упали относительно прошлой тренировки. В таком случае верни тот же вес, который был в последней тренировке, и скажи, что сначала нужно вернуть повторения в целевой диапазон. Вес растёт только там, где прошлый результат был выполнен полностью.
9. ПЕРСОНА - ТОЛЬКО ТОН: любая персона задаёт только тон формулировок. Список упражнений, веса из истории, длина строк, правило прогрессии и формат ответа действуют при любой персона.

{_persona_line(persona, persona_custom_text, "focus, motivation и рекомендаций")}

Контекст:
    {goal_line}{name_line}{athlete_line}
    {reduce_line}Упражнения тренировки (в этом порядке):
    {listed}
    {history_text}"""


def _preview_validator(requested: Sequence[str]) -> Any:
    """Build the validate callback that knows which exercises were asked for."""

    allowed = [" ".join(str(name).split()).lower() for name in requested]

    def validate(result: Dict[str, Any]) -> Dict[str, Any]:
        return _validate_workout_preview(result, allowed)

    return validate


def _validate_workout_preview(result: Dict[str, Any], allowed: Sequence[str]) -> Dict[str, Any]:
    """Check the answer is a usable plan and normalise its ranges.

    The plan is matched back onto the requested exercises by name and anything
    left over is dropped: the model answered, but it cannot change the workout.
    A plan that matches nothing is a failure rather than an empty one - the
    cascade then tries the next model, and an exercise-less card never reaches the
    screen.
    """
    if not isinstance(result, dict):
        raise ValueError(f"Response must be a JSON object, got {type(result).__name__}")

    for field in PREVIEW_REQUIRED_FIELDS:
        if field not in result:
            raise ValueError(f"Missing required field: {field}")

    raw = result["recommendations"]
    if not isinstance(raw, list):
        raise ValueError("recommendations must be a list")

    by_name: Dict[str, Dict[str, Any]] = {}
    for item in raw:
        if not isinstance(item, dict):
            continue
        name = _flatten(item.get("name"), 255)
        if not name:
            continue
        by_name.setdefault(_exercise_key(name), item)

    recommendations: List[Dict[str, Any]] = []
    for wanted in allowed:
        item = by_name.get(wanted)
        if item is None:
            logger.info(f"[AI Workout] Preview has no recommendation for {wanted!r}, leaving its targets to the template")
            continue
        recommendations.append(
            {
                "name": _flatten(item.get("name"), 255) or wanted,
                "sets": _clean_int(item.get("sets"), 1, PREVIEW_MAX_SETS),
                "reps": _clean_int(item.get("reps"), 1, PREVIEW_MAX_REPS),
                "weight_kg": _clean_optional_number(item.get("weight_kg"), 0, PREVIEW_MAX_WEIGHT_KG),
                "rest_seconds": _clean_int(item.get("rest_seconds"), 0, PREVIEW_MAX_REST_SECONDS),
                "focus": _clean_tip(item.get("focus")),
                "motivation": _clean_tip(item.get("motivation")),
            }
        )

    if not recommendations:
        raise ValueError("recommendations matched none of the requested exercises")

    result["recommendations"] = recommendations
    result["focus"] = _clean_line(result.get("focus"), MAX_NOTE_CHARS)
    result["motivation"] = _clean_line(result.get("motivation"), MAX_NOTE_CHARS)
    return result


async def generate_workout_preview_payload(
    exercises: Sequence[Dict[str, Any]],
    *,
    session_name: Optional[str] = None,
    goal: Optional[str] = None,
    user: User,
    performance: Optional[Dict[str, Dict[str, Any]]] = None,
    reduce: bool = False,
) -> Dict[str, Any]:
    """Ask the cascade for one session plan, bounded as a whole."""
    performance = performance or {}
    # The exercise order is the contract: the plan is matched back onto the list in
    # the order the workout will be done in, so a set is only ever used for the
    # membership test and never for the answer's order.
    names = [_exercise_key(item.get("name")) for item in exercises]
    wanted = set(names)
    performance_lines = [
        _performance_line(entry) for key, entry in performance.items() if key in wanted
    ]
    prompt = build_workout_preview_prompt(
        exercises,
        session_name=session_name,
        goal=goal,
        athlete_line=_athlete_line(user),
        performance_lines=performance_lines,
        persona=user.ai_persona,
        persona_custom_text=user.ai_persona_custom_text,
        reduce=reduce,
    )
    return await asyncio.wait_for(
        run_text_cascade(prompt, _preview_validator(names), "[AI Workout Preview]"),
        timeout=WORKOUT_AI_TASK_TIMEOUT,
    )


def _preview_payload(
    name: Optional[str],
    *,
    available: bool,
    reason: Optional[str] = None,
    recommendations: Optional[List[Dict[str, Any]]] = None,
    focus: Optional[str] = None,
    motivation: Optional[str] = None,
    limit: Optional[LimitDecision] = None,
) -> Dict[str, Any]:
    """Shape of the preview answer, for both the plan and the empty path.

    `name` travels even when there is no plan, so the user can still start the
    workout without the coach rather than being stopped by a missing answer.
    """
    return {
        "name": name,
        "available": available,
        "reason": reason,
        "recommendations": recommendations or [],
        "focus": focus,
        "motivation": motivation,
        "limit": _limit_entry(limit),
    }


async def build_workout_preview(
    db: AsyncSession,
    user: User,
    *,
    template=None,
    exercises: Optional[Sequence[str]] = None,
    goal: Optional[str] = None,
    name: Optional[str] = None,
    reduce: bool = False,
) -> Dict[str, Any]:
    """The plan for the session about to start, or the reason there is none.

    Never raises. A model failure degrades to an empty plan and the user starts
    the workout without the coach - a plan is an addition to a workout, and losing
    it must never cost the workout itself.

    The quota is reported, not consumed. The Free tier's weekly allowance is for
    the retrospective analysis, which is the expensive half and the one the limits
    table names; a plan for a workout that is about to happen stays available so
    the user is not met with a paywall between two presses of the same button.

    `reduce` asks the coach for a shorter plan: the session it describes is the
    strength variant, which keeps the compound lifts and drops the accessories,
    so the plan has to talk about the same movements the user will actually do.
    """
    limit = can_run_workout_ai(user)

    if template is not None:
        planned = [
            {
                "name": ex.name,
                "sets": ex.target_sets,
                "reps": ex.target_reps,
                "weight_kg": ex.target_weight_kg,
                "rest_seconds": ex.rest_seconds,
            }
            for ex in sorted(template.exercises or [], key=lambda e: (e.order or 0, e.id))
        ]
        session_name = name or template.name
    else:
        seen = set()
        planned = []
        for raw in exercises or []:
            clean = _flatten(raw, 255)
            key = _exercise_key(clean)
            if not clean or key in seen:
                continue
            seen.add(key)
            planned.append({"name": clean})
        session_name = name

        # A goal-only preview is the quick start: the session picks its exercises
        # from the catalog by goal, so the plan resolves them the same way instead
        # of arriving with nothing to say about.
        if not planned and goal:
            settings = WORKOUT_GOAL_SETTINGS.get(
                (goal or "").strip().lower(), WORKOUT_GOAL_SETTINGS["hypertrophy"]
            )
            planned = [
                {
                    "name": ex.name,
                    "sets": settings["default_sets"],
                    "reps": settings["default_reps"],
                    "rest_seconds": settings["default_rest_seconds"],
                }
                for ex in await select_quick_start_exercises(db, goal, reduce=reduce)
            ]

    if len(planned) > MAX_EXERCISES_IN_PROMPT:
        logger.info(
            f"[AI Workout Preview] {len(planned)} exercises asked for, showing the first {MAX_EXERCISES_IN_PROMPT}"
        )
        planned = planned[:MAX_EXERCISES_IN_PROMPT]

    if not planned:
        return _preview_payload(session_name, available=False, reason=REASON_NO_EXERCISES, limit=limit)

    performance = await load_recent_performance(db, user.id, [item["name"] for item in planned])

    try:
        payload = await generate_workout_preview_payload(
            planned,
            session_name=session_name,
            goal=goal,
            user=user,
            performance=performance,
        )
    except Exception as e:
        logger.exception(f"[AI Workout Preview] Plan for user {user.id} failed: {e}")
        await db.rollback()
        return _preview_payload(session_name, available=False, reason=REASON_PREVIEW_FAILED, limit=limit)

    return _preview_payload(
        session_name,
        available=True,
        recommendations=payload.get("recommendations") or [],
        focus=payload.get("focus"),
        motivation=payload.get("motivation"),
        limit=limit,
    )


async def build_workout_preview_and_store(
    db: AsyncSession,
    session_id: int,
) -> None:
    """Generate a preview plan for a session and persist it.

    Called as a background task when a session is started with
    `with_ai_plan=true`. The plan is generated from the session's template (or
    its exercises) and stored on `ai_plan_json` with the status on
    `ai_plan_status`. A failure sets the status to `failed` but never raises:
    the workout must start regardless of whether the coach answered.
    """
    result = await db.execute(
        select(WorkoutSession)
        .where(WorkoutSession.id == session_id)
        .options(
            selectinload(WorkoutSession.template).selectinload(WorkoutTemplate.exercises),
            selectinload(WorkoutSession.exercises),
        )
    )
    session = result.scalar_one_or_none()
    if session is None:
        logger.warning(f"[AI Workout Preview] Session {session_id} not found")
        return

    user = await db.get(User, session.user_id)
    if user is None:
        logger.warning(f"[AI Workout Preview] User {session.user_id} for session {session_id} not found")
        return

    session.ai_plan_status = AI_PLAN_STATUS_PENDING
    await db.commit()

    try:
        template = session.template

        exercise_names: Optional[List[str]] = None
        if session.exercises:
            exercise_names = [
                ex.name
                for ex in sorted(session.exercises, key=lambda e: (e.order or 0, e.id))
            ]

        payload = await build_workout_preview(
            db,
            user,
            template=template,
            exercises=exercise_names,
            goal=None,
            name=session.name,
        )

        if payload.get("available"):
            session.ai_plan_json = json.dumps(payload, ensure_ascii=False)
            session.ai_plan_status = AI_PLAN_STATUS_AVAILABLE
        else:
            session.ai_plan_json = None
            session.ai_plan_status = AI_PLAN_STATUS_FAILED

        await db.commit()
    except Exception as e:
        logger.exception(
            f"[AI Workout Preview] Failed to store plan for session {session_id}: {e}"
        )
        session.ai_plan_status = AI_PLAN_STATUS_FAILED
        session.ai_plan_json = None
        await db.rollback()
        await db.commit()


def load_stored_ai_plan(session: WorkoutSession) -> Optional[Dict[str, Any]]:
    """Read the stored AI plan from a session, or None if not yet generated."""
    raw = getattr(session, "ai_plan_json", None)
    if not raw:
        return None
    try:
        parsed = json.loads(raw)
    except (TypeError, ValueError):
        logger.warning(f"[AI Workout Preview] Stored plan for session {session.id} is not readable JSON")
        return None
    return parsed if isinstance(parsed, dict) else None


# ===== summary =================================================================

SUMMARY_REQUIRED_FIELDS = ["ai_summary", "overall_score"]


def build_workout_summary_prompt(
    *,
    session_name: str,
    metrics: Dict[str, Any],
    muscle_lines: Sequence[str],
    performance_lines: Sequence[str] = (),
    notes: Optional[str] = None,
    goal: Optional[str] = None,
    athlete_line: str = "",
    persona: Optional[str] = None,
    persona_custom_text: Optional[str] = None,
    rest_stats: Optional[Dict[str, Any]] = None,
) -> str:
    """Prompt for the verdict on a finished session, in the user's coach voice.

    The session's figures are context for the judgement, not something to repeat:
    the verdict is prose plus a score, and every number the user sees is rendered
    from the arithmetic outside the model (rule 6). The recommendations are the
    one place figures are allowed - they are advice about the next session, not a
    reading of this one.
    """
    goal_text = WORKOUT_GOAL_LABELS.get((goal or "").strip().lower(), "")
    goal_line = f"Цель тренировки: {goal_text}. " if goal_text else ""

    duration_min = round((metrics.get("duration_seconds") or 0) / 60)
    totals_line = (
        f"Итоги тренировки, посчитано точно по базе: тоннаж {_fmt_weight(metrics.get('tonnage_kg'))} кг, "
        f"выполнено {metrics.get('completed_sets') or 0} из {metrics.get('sets_count') or 0} подходов, "
        f"повторений {metrics.get('reps') or 0}, тяжёлый подход {_fmt_weight(metrics.get('top_weight_kg'))} кг, "
        f"время {duration_min} мин. "
        if duration_min
        else (
            f"Итоги тренировки, посчитано точно по базе: тоннаж {_fmt_weight(metrics.get('tonnage_kg'))} кг, "
            f"выполнено {metrics.get('completed_sets') or 0} из {metrics.get('sets_count') or 0} подходов, "
            f"повторений {metrics.get('reps') or 0}, тяжёлый подход {_fmt_weight(metrics.get('top_weight_kg'))} кг. "
            "Длительность тренировки неизвестна, оценивай её по объёму работы. "
        )
    )

    clean_notes = _flatten(notes, MAX_NOTES_CHARS)
    notes_line = (
        f'Комментарий пользователя о тренировке: "{clean_notes}". '
        "Используй его при оценке самочувствия и нагрузки. "
        if clean_notes
        else ""
    )

    rest_stats = rest_stats or {}
    rest_stats_line = (
        f"Интервалы отдыха между подходами: среднее время отдыха {rest_stats.get('avg_rest_seconds', 0)} сек, "
        f"максимальное {rest_stats.get('max_rest_seconds', 0)} сек. "
        "Оценивай плотность нагрузки и эффективность восстановления, опираясь на фактические интервалы отдыха. "
        if rest_stats.get("avg_rest_seconds") or rest_stats.get("max_rest_seconds")
        else ""
    )

    return f"""Ты — поддерживающий, профессиональный и аналитически строгий тренер по силовым тренировкам. Ты уже видел всю тренировку пользователя и верни СТРОГО валидный JSON с полями:
{{
  "ai_summary": "Оценка тренировки РОВНО из 3-6 связанных предложений: без эмодзи и без цифр.",
  "overall_score": 7.5,
  "recovery_advice": "Одно-два предложения о восстановлении: без эмодзи и без цифр.",
  "highlights": ["кратко о чем получилось", "кратко о чем требует внимания"],
  "intensity_conclusions": "Одно-два предложения о том, насколько тяжело шла тренировка: интенсивность, темп, утомление - без эмодзи и без цифр.",
  "balance_analysis": "Одно-два предложения о распределении нагрузки по мышечным группам: чем хороша, где перекос - без эмодзи и без цифр.",
  "next_workout_focus": ["Четкое действие 1", "Четкое действие 2", "Четкое действие 3"],
  "recommendations": [
    {{"title": "Краткий заголовок действия", "text": "Одно-два предложения: что делать в следующей тренировке"}}
  ]
}}
Все числовые значения — float. overall_score от 1.0 до 10.0: это оценка тренировки целиком, а не средняя оценка упражнений. highlights — массив из 2-4 коротких строк. next_workout_focus — массив из 1-3 конкретных действий. recommendations — массив из 1-3 объектов с полями title и text. Никаких пояснений, только JSON.

Правила разбора тренировки (обязательно):
0. ЯЗЫК: ВСЕ поля в JSON-ответе (включая группы мышц, названия, советы, рекомендации) ДОЛЖНЫ быть строго на русском языке. Использование английских слов запрещено.
1. ДЛИНА: в ai_summary РОВНО {SUMMARY_MIN_SENTENCES}-{SUMMARY_MAX_SENTENCES} предложений, связанных в один связный текст. Меньше {SUMMARY_MIN_SENTENCES} или больше {SUMMARY_MAX_SENTENCES} - нарушение. Каждое предложение несуще: не добивай объём дежурными фразами.
2. НОЛЬ ЭМОДЗИ: ни одного эмодзи, смайлика, иконки или символического значка из наборов эмодзи - ни в ai_summary, ни в recovery_advice, ни в highlights, ни в intensity_conclusions, ни в balance_analysis, ни в next_workout_focus, ни в recommendations. Только обычные буквы, пробелы и знаки препинания.
3. НИ ОДНОЙ ЦИФРЫ В текстовых полях: тоннаж, подходы, повторения, веса и время система уже посчитала точно по базе и показывает пользователю отдельно. Говори словами ("тоннаж вырос", "подходов сделано меньше плана", "работа была тяжёлой") и опирайся на точные итоги из блока Контекст. Любая цифра или число прописью - нарушение. Цифры допустимы только в recommendations (вес, повторения, подходы уместны и желательны).
4. НИКАКИХ СПИСКОВ И РАЗМЕТОК: ai_summary, recovery_advice, intensity_conclusions и balance_analysis - обычный текст, без маркеров, нумерации, заголовков и переносов строк.
5. ЧЕСТНОСТЬ: оценивай тренировку такой, какая она есть. Недобор плана, однообразная нагрузка, перекос по группам и отсутствие восстановления - называй прямо и конкретно, без приуменьшений ("почти", "слегка", "нормально"). Если тренировка была сильной - скажи это прямо. Пустых комплиментов вроде "хорошая работа в целом" не пиши.
6. ГЛУБИНА АНАЛИЗА: intensity_conclusions - оцени интенсивность тренировки (была тяжела, легко, рваная, ровная?). balance_analysis - проанализируй распределение работы по мышечным группам: есть ли перекосы? next_workout_focus - приди 1-3 конкретных действий на следующую тренировку (какие упражнения добавить, что увеличить, что убрать). Каждое действие - кратко и по делу.
7. ПРОГРЕССИВНАЯ ПЕРЕГРУЗКА: НЕ рекомендуй увеличивать рабочий вес, если в этой тренировке количество повторений упало ниже целевого диапазона или тоннаж по упражнению ниже, чем в прошлой тренировке из блока Динамика. В таком случае прямо скажи: закрепить текущий вес и сначала довести повторения до нормы. Рост веса предлагай только там, где прошлый результат был выполнен полностью.
8. СПОРТИВНАЯ КОНКРЕТИКА: запрещены абстрактные, метафорические и философские формулировки ("созерцание тренажера", "виток Вселенной", "атмосфера зала", "путь к себе"). Отвечай только спортивно-конкретно: интенсивность, темп, утомление, распределение по группам, прогресс по весу и повторениям, соответствие плану и восстановление.
9. ПЕРСОНА - ТОЛЬКО ТОН: любая персона задаёт только тон формулировок. Длина, отсутствие эмодзи, запрет цифр, спортивная конкретика, формат ответа и честность по просадкам действуют при любой персона.
10. НАЗВАНИЯ МЫШЕЧНЫХ ГРУПП - ТОЛЬКО НА РУССКОМ: в balance_analysis и везде, где ты упоминаешь мышечную группу, используй русские названия из блока Контекст (Спина, Грудь, Квадрицепс, Бицепс бедра, Ягодицы, Плечи, Бицепс, Трицепс, Пресс, Икры, Прочие мышцы). Английские ключи вроде `back` или `quadriceps` в ответе недопустимы - это не названия групп, это служебные ключи базы.
11. ОТДЫХ И ПЛОТНОСТЬ НАГРУЗКИ: в recommendations и в разговоре о темпе тренировки учитывай реальный отдых. Для тяжёлых базовых движений (приседания, становая, жимы) норма 2-3 минута, для изоляционных упражнений и среднего веса - 1-2 минуты, для высокоповторных упражнений на выносливость - 60-90 секунд. Если в прошлой тренировке отдых был короче и Quality (качество) упражнения упала - предложи увеличить отдых, а не сокращать. Плотность - соотношение полезной работы и общего времени: если тренировка растянулась на 2+ часа при нормальном объёме, скажи это прямо и предложи сжать за счёт более коротких пауз.
12. ДЛИТЕЛЬНОСТЬ ТРЕНИРОВКИ: в ai_summary и recommendations учитывай время из блока Контекст. Целевая продолжительность - 45-75 минут для силовой и на массу, 30-45 минут для выносливости. Если тренировка короче - возможно, не хватило времени на все подходы; если длиннее - паузы были слишком длинными или работа шла с перерывами. Упоминай это конкретно, без общих фраз вроде "всё было в норме".

{_persona_line(persona, persona_custom_text, "ai_summary, recovery_advice и рекомендаций")}

Контекст:
Название тренировки: {_flatten(session_name, 80)}. {goal_line}{athlete_line}{totals_line}{notes_line}{rest_stats_line}Работа по мышечным группам (точные цифры из базы, названия не выдумывай):
{muscle_lines if muscle_lines else 'Распределение по мышечным группам определить не удалось.'}
Динамика по упражнениям, с которыми сравнивается эта тренировка:
{performance_lines if performance_lines else 'Предыдущих тренировок по этим упражнениям нет.'}"""


def _validate_workout_summary(result: Dict[str, Any]) -> Dict[str, Any]:
    """Check the answer is a usable verdict and normalise its ranges.

    Raising here keeps a malformed answer inside the cascade: the caller treats
    it like any other model failure and moves on to the next model.
    """
    if not isinstance(result, dict):
        raise ValueError(f"Response must be a JSON object, got {type(result).__name__}")

    for field in SUMMARY_REQUIRED_FIELDS:
        if field not in result:
            raise ValueError(f"Missing required field: {field}")

    summary = _sanitize_verdict(result["ai_summary"])
    if not summary.strip():
        raise ValueError("ai_summary is empty after removing emoji")
    result["ai_summary"] = _russianize_muscle_groups(summary)

    result["overall_score"] = normalise_score(result["overall_score"])

    recovery = _clean_line(result.get("recovery_advice"), MAX_RECOVERY_CHARS)
    result["recovery_advice"] = _russianize_muscle_groups(recovery) if recovery else None

    highlights: List[str] = []
    raw_highlights = result.get("highlights")
    if not isinstance(raw_highlights, list):
        raise ValueError("highlights must be a list")
    for item in raw_highlights[:MAX_HIGHLIGHTS]:
        clean = _clean_line(item, MAX_HIGHLIGHT_CHARS)
        if clean:
            highlights.append(_russianize_muscle_groups(clean))
    if not highlights:
        raise ValueError("highlights are empty after cleaning")
    result["highlights"] = highlights

    recommendations: List[Dict[str, str]] = []
    raw_recommendations = result.get("recommendations")
    if raw_recommendations is not None and not isinstance(raw_recommendations, list):
        raise ValueError("recommendations must be a list")
    for item in (raw_recommendations or [])[:MAX_RECOMMENDATIONS]:
        if not isinstance(item, dict):
            continue
        title = _clean_line(item.get("title"), MAX_HIGHLIGHT_CHARS)
        text = _clean_line(item.get("text"), MAX_RECOMMENDATION_CHARS)
        if title and text:
            recommendations.append({"title": _russianize_muscle_groups(title), "text": _russianize_muscle_groups(text)})
    result["recommendations"] = recommendations

    # New structured sections: intensity_conclusions, balance_analysis,
    # and next_workout_focus. These travel with the summary but are optional:
    # a plan that answers the headline without them still stores a verdict.
    result["intensity_conclusions"] = _russianize_muscle_groups(
        _clean_line(result.get("intensity_conclusions"), MAX_INTENSITY_CONCLUSIONS_CHARS)
    )

    result["balance_analysis"] = _russianize_muscle_groups(
        _clean_line(result.get("balance_analysis"), MAX_BALANCE_ANALYSIS_CHARS)
    )

    raw_focus = result.get("next_workout_focus")
    if raw_focus is None:
        result["next_workout_focus"] = []
    elif isinstance(raw_focus, list):
        focus_items: List[str] = []
        for item in raw_focus[:MAX_NEXT_WORKOUT_FOCUS_ITEMS]:
            clean = _clean_line(item, MAX_NEXT_WORKOUT_FOCUS_CHARS)
            if clean:
                focus_items.append(_russianize_muscle_groups(clean))
        result["next_workout_focus"] = focus_items
    else:
        result["next_workout_focus"] = []

    return result


async def generate_workout_summary_payload(
    *,
    session_name: str,
    metrics: Dict[str, Any],
    muscle_lines: Sequence[str],
    performance_lines: Sequence[str] = (),
    notes: Optional[str] = None,
    goal: Optional[str] = None,
    user: User,
    rest_stats: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Ask the cascade for one session verdict, bounded as a whole."""
    prompt = build_workout_summary_prompt(
        session_name=session_name,
        metrics=metrics,
        muscle_lines=muscle_lines,
        performance_lines=performance_lines,
        notes=notes,
        goal=goal,
        athlete_line=_athlete_line(user),
        persona=user.ai_persona,
        persona_custom_text=user.ai_persona_custom_text,
        rest_stats=rest_stats,
    )
    return await asyncio.wait_for(
        run_text_cascade(prompt, _validate_workout_summary, "[AI Workout Summary]"),
        timeout=WORKOUT_AI_TASK_TIMEOUT,
    )


# ===== persistence =============================================================

def _stored_breakdown(session: WorkoutSession) -> Optional[Dict[str, Any]]:
    """The stored verdict's breakdown, or None when there is nothing stored.

    The column is JSON-encoded text (`Meal.tags` does the same), and a row that
    cannot be read back is treated as "no analysis" rather than raising: a
    corrupted card must not take the history screen down with it.
    """
    raw = getattr(session, "ai_recommendations_json", None)
    if not raw:
        return None
    try:
        parsed = json.loads(raw)
    except (TypeError, ValueError):
        logger.warning(f"[AI Workout] Stored analysis of session {session.id} is not readable JSON")
        return None
    return parsed if isinstance(parsed, dict) else None


def load_stored_analysis(session: WorkoutSession) -> Optional[Dict[str, Any]]:
    """The verdict of a session as it was stored, or None when it was never analysed."""
    summary = getattr(session, "ai_summary", None)
    breakdown = _stored_breakdown(session)
    if not summary and not breakdown:
        return None
    breakdown = breakdown or {}
    return {
        "ai_summary": summary,
        "overall_score": breakdown.get("overall_score"),
        "recovery_advice": breakdown.get("recovery_advice"),
        "highlights": breakdown.get("highlights") or [],
        "recommendations": breakdown.get("recommendations") or [],
        "intensity_conclusions": breakdown.get("intensity_conclusions"),
        "balance_analysis": breakdown.get("balance_analysis"),
        "next_workout_focus": breakdown.get("next_workout_focus") or [],
    }


async def store_workout_analysis(
    db: AsyncSession,
    user: User,
    session: WorkoutSession,
    payload: Dict[str, Any],
    now: Optional[Any] = None,
) -> None:
    """Write the verdict on the session and move the weekly cooldown.

    The analysis is the one coach call that costs quota, so `last_workout_ai_analysis_at`
    is stamped here and nowhere else: a plan never spends the week's allowance, and
    a re-analysis spends it exactly like a first one.
    """
    session.ai_summary = payload["ai_summary"]
    session.ai_recommendations_json = json.dumps(
        {
            "overall_score": payload.get("overall_score"),
            "recovery_advice": payload.get("recovery_advice"),
            "highlights": payload.get("highlights") or [],
            "recommendations": payload.get("recommendations") or [],
            "intensity_conclusions": payload.get("intensity_conclusions"),
            "balance_analysis": payload.get("balance_analysis"),
            "next_workout_focus": payload.get("next_workout_focus") or [],
        },
        ensure_ascii=False,
    )
    session.analyzed_at = now or utcnow()
    # Resolved once here, so the verdict keeps the voice it was actually written in
    # even if the profile changes later - the same reason meals carry theirs.
    session.ai_persona = normalize_persona(user.ai_persona)
    user.last_workout_ai_analysis_at = session.analyzed_at
    user.updated_at = utcnow()
    await db.commit()


def _limit_entry(decision: Optional[LimitDecision]) -> Optional[Dict[str, Any]]:
    """The quota as the tier sees it, for the payload that renders it."""
    if decision is None:
        return None
    return {
        "code": decision.code,
        "used": decision.used,
        "limit": decision.limit,
        "remaining": decision.remaining,
        "percent_used": decision.percent_used,
        "allowed": decision.allowed,
        "message": decision.message,
        "resets_at": decision.resets_at,
    }


async def build_summary_payload(
    db: AsyncSession,
    session: WorkoutSession,
    *,
    available: bool,
    reason: Optional[str] = None,
    limit: Optional[LimitDecision] = None,
    generated: bool = False,
    reanalyzed: bool = False,
    with_muscle_volume: bool = True,
) -> Dict[str, Any]:
    """Shape of the verdict answer, for the stored one and for the empty path.

    The per-muscle-group volume is recomputed from the database rather than stored
    with the verdict: it is arithmetic, and a stored copy would go stale the
    moment a set is edited. It travels on every answer, verdict or not, so the
    card can render the breakdown even before the model has been asked.
    """
    stored = load_stored_analysis(session) or {}
    muscle_groups = await load_muscle_volume(db, session.id, session.user_id) if with_muscle_volume else []
    return {
        "workout_id": session.id,
        "available": available,
        "reason": reason,
        "ai_summary": stored.get("ai_summary"),
        "overall_score": stored.get("overall_score"),
        "muscle_groups": muscle_groups,
        "recovery_advice": stored.get("recovery_advice"),
        "highlights": stored.get("highlights") or [],
        "recommendations": stored.get("recommendations") or [],
        "intensity_conclusions": stored.get("intensity_conclusions"),
        "balance_analysis": stored.get("balance_analysis"),
        "next_workout_focus": stored.get("next_workout_focus") or [],
        "ai_persona": getattr(session, "ai_persona", None),
        "analyzed_at": session.analyzed_at,
        "generated": generated,
        "reanalyzed": reanalyzed,
        "limit": _limit_entry(limit),
    }


async def get_workout_analysis(
    db: AsyncSession,
    user: User,
    session: WorkoutSession,
) -> Dict[str, Any]:
    """The verdict of a session as it is stored, without asking the model.

    Never generates: re-opening a session in the history costs no quota, and a
    session that was never analysed is an empty card with a reason.
    """
    available = load_stored_analysis(session) is not None
    return await build_summary_payload(
        db,
        session,
        available=available,
        reason=None if available else REASON_NOT_ANALYZED,
        limit=can_run_workout_ai(user),
    )


async def analyze_workout_session_task(
    session_id: int,
    user_id: int,
    notes: Optional[str] = None,
    force: bool = False,
) -> None:
    """Background runner for `analyze_workout_session` with an isolated DB session.

    The request-scoped `db` is closed when the HTTP endpoint returns, so the
    background task must open its own session rather than reusing one that may
    already be orphaned.
    """
    async with async_session_maker() as db:
        try:
            result = await db.execute(
                select(WorkoutSession)
                .where(WorkoutSession.id == session_id)
                .options(selectinload(WorkoutSession.exercises))
            )
            session = result.scalar_one_or_none()
            if session is None:
                logger.warning(f"[AI Workout Summary] Session {session_id} not found for background task")
                return

            user = await db.get(User, user_id)
            if user is None:
                logger.warning(f"[AI Workout Summary] User {user_id} not found for background task")
                return

            await analyze_workout_session(db, user, session, notes=notes, force=force)
        except Exception as e:
            logger.exception(f"[AI Workout Summary] Background task failed for session {session_id}: {e}")
            await db.rollback()


async def analyze_workout_session(
    db: AsyncSession,
    user: User,
    session: WorkoutSession,
    *,
    notes: Optional[str] = None,
    force: bool = False,
) -> Dict[str, Any]:
    """The verdict of one session, generated on demand when it is missing.

    A stored verdict is returned as it is unless `force` asks for a new one, so
    re-opening a session costs no quota. `force` is the re-analyze button on the
    history card, and it is gated like a first analysis: on the Free tier it
    spends the same weekly allowance.

    A quota that is not available, a session with no completed weighted set, and a
    model that failed are all empty states with a reason rather than errors, and
    all three keep the last known verdict when there is one - a failed re-analysis
    must never leave the user with less than they had.

    Never raises.
    """
    stored = load_stored_analysis(session)
    if stored is not None and not force:
        return await build_summary_payload(
            db, session, available=True, limit=can_run_workout_ai(user)
        )

    decision = can_run_workout_ai(user)
    if not decision.allowed:
        logger.info(
            f"[AI Workout Summary] Session {session.id} for user {user.id} is waiting for the weekly AI allowance"
        )
        return await build_summary_payload(
            db,
            session,
            available=stored is not None,
            reason=decision.message,
            limit=decision,
        )

    metrics = await load_workout_metrics(db, session.id)
    if metrics["completed_sets"] == 0 or metrics["tonnage_kg"] <= 0:
        return await build_summary_payload(
            db,
            session,
            available=stored is not None,
            reason=REASON_NO_SETS,
            limit=decision,
        )

    exercise_names = sorted({ex.name for ex in (session.exercises or []) if ex.name})
    performance = await load_recent_performance(db, user.id, exercise_names, exclude_session_id=session.id)
    performance_lines = [
        _performance_line(entry) for entry in performance.values()
    ]

    muscle_lines = [_muscle_line(entry) for entry in await load_muscle_volume(db, session.id, user.id)]
    rest_stats = await load_rest_stats(db, session.id)

    try:
        payload = await generate_workout_summary_payload(
            session_name=session.name or "Тренировка",
            metrics=metrics,
            muscle_lines=muscle_lines,
            performance_lines=performance_lines,
            notes=notes,
            goal=None,
            user=user,
            rest_stats=rest_stats,
        )
    except Exception as e:
        # The failing statement may have left the session mid-transaction; the
        # rollback keeps this session usable for the rest of the request.
        logger.exception(f"[AI Workout Summary] Session {session.id} for user {user.id} failed: {e}")
        await db.rollback()
        return await build_summary_payload(
            db,
            session,
            available=stored is not None,
            reason=REASON_FAILED,
            limit=decision,
        )

    await store_workout_analysis(db, user, session, payload)
    logger.info(
        f"[AI Workout Summary] Session {session.id} analysed for user {user.id}, "
        f"score {payload['overall_score']}"
    )
    return await build_summary_payload(
        db,
        session,
        available=True,
        limit=decision,
        generated=True,
        reanalyzed=force and stored is not None,
    )


__all__ = [
    "WORKOUT_AI_TASK_TIMEOUT",
    "SUMMARY_MAX_SENTENCES",
    "SUMMARY_MIN_SENTENCES",
    "TIP_MAX_WORDS",
    "TIP_MIN_WORDS",
    "MAX_EXERCISES_IN_PROMPT",
    "MAX_HIGHLIGHTS",
    "MAX_HISTORY_SETS",
    "MAX_MUSCLE_GROUPS",
    "MAX_RECENT_SESSIONS",
    "MAX_RECOMMENDATIONS",
    "OTHER_MUSCLE_GROUP",
    "AI_PLAN_STATUS_PENDING",
    "AI_PLAN_STATUS_AVAILABLE",
    "AI_PLAN_STATUS_FAILED",
    "AI_PLAN_STATUS_NO_EXERCISES",
    "REASON_FAILED",
    "REASON_NO_EXERCISES",
    "REASON_NO_SETS",
    "REASON_NOT_ANALYZED",
    "REASON_PREVIEW_FAILED",
    "COACH_PERSONA_PROMPTS",
    "WORKOUT_GOAL_LABELS",
    "analyze_workout_session",
    "analyze_workout_session_task",
    "build_summary_payload",
    "build_workout_preview",
    "build_workout_preview_and_store",
    "build_workout_preview_prompt",
    "build_workout_summary_prompt",
    "generate_workout_preview_payload",
    "generate_workout_summary_payload",
    "get_workout_analysis",
    "load_muscle_volume",
    "load_recent_performance",
    "load_rest_stats",
    "load_stored_analysis",
    "load_stored_ai_plan",
    "load_workout_metrics",
    "store_workout_analysis",
]
