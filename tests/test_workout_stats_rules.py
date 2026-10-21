"""Rules for the workout statistics: the length of a session and the breaks in it.

The bug these guard: the breaks of a session were counted across exercises, so
the changeover from one exercise to the next was reported as a rest, and the
duration of a session was summed once per set, so a 45-minute session of nine
sets was reported as six hours and a half of training.

The session is measured on the server, from the completion stamps of the sets
that were performed. The rules are the same wherever the figures are read - the
history card, the coach's verdict and the statistics - so they live in one
place and are checked from every side.
"""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from app.models import (
    WorkoutSession,
    WorkoutSessionExercise,
    WorkoutSessionStatus,
    WorkoutSet,
)
from app.services.ai_workout_service import load_rest_stats
from app.services.workout import (
    complete_workout_session,
    get_workout_statistics,
    measured_rest_times,
    resolve_completed_duration,
    resolve_rest_times,
    resolve_session_duration,
)

# The first set of the workout. Every stamp below is counted from here.
BASE = datetime(2026, 10, 1, 18, 0, tzinfo=timezone.utc)


def _set(set_id, set_number, completed_at, rest_time_seconds=None):
    return SimpleNamespace(
        id=set_id,
        set_number=set_number,
        completed_at=completed_at,
        rest_time_seconds=rest_time_seconds,
        is_completed=completed_at is not None,
    )


def _exercise(exercise_id, order, sets):
    return SimpleNamespace(id=exercise_id, order=order, sets=sets)


def _session(exercises, started_at=None):
    return SimpleNamespace(
        id=1,
        started_at=started_at,
        completed_at=None,
        duration_seconds=None,
        exercises=exercises,
    )


def _two_exercise_session():
    """A session of two exercises: three sets in the first, two in the second.

    The last set of the first exercise and the first set of the second are two
    minutes apart - the time it takes to change the weight, not a rest.
    """
    return _session(
        [
            _exercise(
                1,
                0,
                [
                    _set(11, 1, BASE),
                    _set(12, 2, BASE + timedelta(seconds=90)),
                    _set(13, 3, BASE + timedelta(seconds=180)),
                ],
            ),
            _exercise(
                2,
                1,
                [
                    _set(21, 1, BASE + timedelta(seconds=300)),
                    _set(22, 2, BASE + timedelta(seconds=390)),
                ],
            ),
        ],
        started_at=BASE - timedelta(minutes=15),
    )


class _StubSession:
    """Session stand-in that replays canned rows and records its commits."""

    def __init__(self, session=None, rows=None):
        self.session = session
        self.rows = rows or []
        self.commits = 0
        self.statements = []

    async def execute(self, statement):
        self.statements.append(statement)
        return SimpleNamespace(
            scalar_one_or_none=lambda: self.session,
            scalars=lambda: SimpleNamespace(all=lambda: [self.session]),
            all=lambda: self.rows,
            first=lambda: self.rows[0] if self.rows else None,
        )

    async def commit(self):
        self.commits += 1

    async def refresh(self, obj):
        pass

    async def rollback(self):
        pass


# --- the breaks belong to the exercise they were taken in ---------------------

def test_a_break_is_counted_inside_the_exercise_and_not_across_it():
    """The bug: the client measured the gap from the last set it had seen,
    whichever exercise that set belonged to, so the changeover was stored as a
    rest the user never took."""
    session = _two_exercise_session()

    resolve_rest_times(session)

    first, second = session.exercises
    # The first set of an exercise has no set before it, so it carries no rest.
    assert first.sets[0].rest_time_seconds is None
    assert first.sets[1].rest_time_seconds == 90
    assert first.sets[2].rest_time_seconds == 90
    # The changeover between the two exercises is not a break.
    assert second.sets[0].rest_time_seconds is None
    assert second.sets[1].rest_time_seconds == 90


def test_a_set_that_was_not_performed_anchors_nothing():
    """A set without a stamp was not performed: the gap behind it is not a
    break, and the set after it cannot be measured against it either."""
    session = _session(
        [
            _exercise(
                1,
                0,
                [
                    _set(11, 1, BASE),
                    _set(12, 2, None),
                    _set(13, 3, BASE + timedelta(seconds=120)),
                ],
            )
        ]
    )

    resolve_rest_times(session)

    sets = session.exercises[0].sets
    assert sets[1].rest_time_seconds is None
    assert sets[2].rest_time_seconds is None


def test_a_break_the_client_measured_is_kept_when_the_stamps_say_less():
    """A workout done offline reaches the server as a replay: every set carries
    the same second, so the stamps describe the replay and not the workout."""
    session = _session(
        [
            _exercise(
                1,
                0,
                [
                    _set(11, 1, BASE),
                    _set(12, 2, BASE + timedelta(seconds=1), rest_time_seconds=95),
                ],
            )
        ]
    )

    resolve_rest_times(session)

    assert session.exercises[0].sets[1].rest_time_seconds == 95


def test_the_rules_are_the_same_wherever_the_breaks_are_read():
    """The coach reads the breaks from the same rule the session service
    applies, so the verdict and the history card cannot disagree."""
    session = _two_exercise_session()
    resolve_rest_times(session)

    rests = measured_rest_times(
        (exercise.id, workout_set.completed_at, workout_set.rest_time_seconds)
        for exercise in session.exercises
        for workout_set in exercise.sets
    )

    assert rests == [None, 90, 90, None, 90]


@pytest.mark.asyncio
async def test_the_coach_is_not_told_the_changeover_was_a_rest():
    """The coach quotes the breaks it is given, and the changeover the client
    measured is not one of them - not even when it is already in the database."""
    rows = [
        SimpleNamespace(exercise_id=1, completed_at=BASE, rest_time_seconds=None),
        SimpleNamespace(
            exercise_id=1,
            completed_at=BASE + timedelta(seconds=90),
            rest_time_seconds=90,
        ),
        # The changeover: 210 seconds between the two exercises, stored as a rest.
        SimpleNamespace(
            exercise_id=2,
            completed_at=BASE + timedelta(seconds=300),
            rest_time_seconds=210,
        ),
        SimpleNamespace(
            exercise_id=2,
            completed_at=BASE + timedelta(seconds=390),
            rest_time_seconds=90,
        ),
    ]
    db = _StubSession(rows=rows)

    stats = await load_rest_stats(db, 42)

    assert stats["avg_rest_seconds"] == 90
    assert stats["max_rest_seconds"] == 90


@pytest.mark.asyncio
async def test_a_set_that_was_not_performed_breaks_the_chain_for_the_coach_as_well():
    """The set that was skipped is not a gap between two sets that were
    performed, so the coach is told nothing about it."""
    rows = [
        SimpleNamespace(exercise_id=1, completed_at=BASE, rest_time_seconds=None),
        # The set that was not performed: it breaks the chain of gaps.
        SimpleNamespace(exercise_id=1, completed_at=None, rest_time_seconds=None),
        SimpleNamespace(
            exercise_id=1,
            completed_at=BASE + timedelta(seconds=120),
            rest_time_seconds=None,
        ),
    ]
    db = _StubSession(rows=rows)

    stats = await load_rest_stats(db, 42)

    assert stats["avg_rest_seconds"] == 0
    assert stats["max_rest_seconds"] == 0


# --- the length of the session ------------------------------------------------

def test_the_session_is_as_long_as_the_sets_took():
    """The figure describes the workout: the setup before the first set and the
    cool-down after the last one stay out of it."""
    session = _two_exercise_session()

    assert resolve_session_duration(session) == 390


def test_a_session_without_stamps_has_no_length_to_measure():
    session = _session(
        [_exercise(1, 0, [_set(11, 1, BASE)])],
        started_at=BASE - timedelta(minutes=5),
    )

    assert resolve_session_duration(session) is None


def test_the_measurement_of_the_server_wins_over_the_clock_the_client_kept():
    """The client timed the whole time the app was open - the setup and the
    cool-down included. The server measures the sets themselves."""
    session = _two_exercise_session()
    completed_at = BASE + timedelta(seconds=600)

    # The client had the app open for 40 minutes, the sets took 6 and a half.
    assert resolve_completed_duration(
        session,
        client_duration_seconds=2400,
        completed_at=completed_at,
    ) == 390


def test_a_session_the_server_cannot_measure_falls_back_to_the_clock_it_has():
    session = _session(
        [_exercise(1, 0, [_set(11, 1, BASE)])],
        started_at=BASE - timedelta(minutes=5),
    )

    assert resolve_completed_duration(
        session,
        client_duration_seconds=300,
        completed_at=BASE,
    ) == 300


def test_a_session_replayed_from_the_offline_queue_keeps_the_length_the_client_measured():
    """A workout done offline is created on the server when the queue is
    flushed, so the session and its sets carry the same second. The client
    measured that workout for real, and the two clocks disagreeing by that
    much is what gives the replay away."""
    session = _session(
        [
            _exercise(
                1,
                0,
                [
                    _set(11, 1, BASE),
                    _set(12, 2, BASE + timedelta(seconds=1)),
                ],
            )
        ],
        started_at=BASE,
    )

    assert resolve_completed_duration(
        session,
        client_duration_seconds=2700,
        completed_at=BASE + timedelta(seconds=2),
    ) == 2700


# --- the session as it is closed ----------------------------------------------

@pytest.mark.asyncio
async def test_closing_a_session_stores_the_length_of_its_sets():
    session = _two_exercise_session()
    db = _StubSession(session)

    closed = await complete_workout_session(db, session.id, 7, duration_seconds=1800)

    assert closed is session
    assert session.status == WorkoutSessionStatus.COMPLETED
    # The client's 30 minutes are replaced by the 6 and a half the sets took.
    assert session.duration_seconds == 390
    # The changeover is not a break, and the breaks inside an exercise are.
    assert session.exercises[1].sets[0].rest_time_seconds is None
    assert session.exercises[0].sets[1].rest_time_seconds == 90
    assert db.commits == 1


# --- the statistics -----------------------------------------------------------

@pytest.mark.asyncio
async def test_the_duration_of_a_session_is_counted_once_and_not_once_per_set(
    db_session, normal_user
):
    """The bug: the duration was summed next to the sets, so every set of a
    session added the whole length of that session to the total."""
    session = WorkoutSession(
        user_id=normal_user.id,
        name="Верх",
        started_at=BASE - timedelta(minutes=45),
        completed_at=BASE,
        duration_seconds=2700,
        status=WorkoutSessionStatus.COMPLETED,
    )
    db_session.add(session)
    await db_session.flush()

    exercise = WorkoutSessionExercise(session_id=session.id, name="Жим лёжа", order=0)
    db_session.add(exercise)
    await db_session.flush()

    db_session.add_all(
        [
            WorkoutSet(
                exercise_id=exercise.id,
                set_number=number,
                reps=8,
                weight_kg=60.0,
                is_completed=True,
                completed_at=BASE + timedelta(seconds=number * 30),
            )
            for number in range(1, 10)
        ]
    )
    await db_session.flush()

    stats = await get_workout_statistics(db_session, normal_user.id)

    # 45 minutes of training, counted once.
    assert stats["total_duration_hours"] == 0.8
    assert stats["avg_workout_duration_min"] == 45.0
    # The volume of the sets is untouched by the fix.
    assert stats["total_sets"] == 9
    assert stats["total_volume_kg"] == 4320.0


@pytest.mark.asyncio
async def test_a_session_recorded_through_the_service_ends_with_the_length_of_its_sets(
    db_session, normal_user
):
    """The whole path: the sets are stamped, the session is closed, and the
    database holds the length of the workout and the breaks inside it."""
    session = WorkoutSession(
        user_id=normal_user.id,
        name="Верх",
        started_at=BASE - timedelta(minutes=15),
        status=WorkoutSessionStatus.ACTIVE,
    )
    db_session.add(session)
    await db_session.flush()

    first = WorkoutSessionExercise(session_id=session.id, name="Жим лёжа", order=0)
    second = WorkoutSessionExercise(session_id=session.id, name="Тяга", order=1)
    db_session.add_all([first, second])
    await db_session.flush()

    db_session.add_all(
        [
            WorkoutSet(
                exercise_id=first.id,
                set_number=1,
                reps=8,
                weight_kg=60.0,
                is_completed=True,
                completed_at=BASE,
            ),
            WorkoutSet(
                exercise_id=first.id,
                set_number=2,
                reps=8,
                weight_kg=60.0,
                is_completed=True,
                completed_at=BASE + timedelta(seconds=90),
            ),
            WorkoutSet(
                exercise_id=second.id,
                set_number=1,
                reps=10,
                weight_kg=70.0,
                is_completed=True,
                completed_at=BASE + timedelta(seconds=300),
            ),
        ]
    )
    await db_session.flush()

    closed = await complete_workout_session(
        db_session, session.id, normal_user.id, duration_seconds=1800
    )

    assert closed is not None
    # The setup before the first set and the cool-down after the last one are
    # not part of the workout.
    assert closed.duration_seconds == 300
    # The changeover between the two exercises is not a break.
    assert closed.exercises[0].sets[1].rest_time_seconds == 90
    assert closed.exercises[1].sets[0].rest_time_seconds is None
