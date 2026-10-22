"""The lazy loads behind `sqlalchemy.exc.MissingGreenlet`.

A relationship that is not eager-loaded is fetched on first access, and an
async session cannot fetch it outside of a query: the read raises
`MissingGreenlet` instead of returning the rows. The coach reads a session,
its template and the sets of its exercises from two places - the route that
answers the preview and the background task that stores the plan - so both
reads have to bring the relationships they touch with them.

These tests talk to the real database, because the failure is about what the
loader does with the rows it got, not about the query that asked for them.
"""

import json
import uuid
from datetime import datetime, timezone

import pytest
import pytest_asyncio
from sqlalchemy import delete, inspect, select

from app.api.v1 import routes as routes_module
from app.api.v1.routes import ai_workout_preview
from app.db.session import async_session_maker
from app.models import (
    User,
    WorkoutSession,
    WorkoutSessionExercise,
    WorkoutSessionStatus,
    WorkoutSet,
    WorkoutTemplate,
    WorkoutTemplateExercise,
)
from app.schemas.ai_workout import AIWorkoutPreviewRequest
from app.services.ai_workout_service import (
    AI_PLAN_STATUS_AVAILABLE,
    AI_PLAN_STATUS_PENDING,
    build_workout_preview_and_store,
)
from app.services.workout import get_workout_session

GOOD_PREVIEW = {
    "focus": "Прогрессия в жиме без потери техники",
    "motivation": "Сначала разминка, потом рабочие подходы",
    "recommendations": [
        {
            "name": "Жим лёжа",
            "sets": 4,
            "reps": 8,
            "weight_kg": 55.0,
            "rest_seconds": 150,
            "focus": "Лопатки сведены, пауза внизу",
            "motivation": "Первый подход - самый сильный",
        }
    ],
}


def _fake_cascade(payload):
    """A cascade stand-in: the model answers, everything around it runs for real."""

    async def _run(prompt, validate, log_prefix="[AI]"):
        return validate(payload)

    return _run


async def _seed_workout(db, user_id: int):
    """A template, a session built from it, and the sets the coach reads."""
    template = WorkoutTemplate(user_id=user_id, name="Верх")
    db.add(template)
    await db.flush()

    db.add(
        WorkoutTemplateExercise(
            template_id=template.id,
            name="Жим лёжа",
            order=0,
            target_sets=4,
            target_reps=8,
            target_weight_kg=50.0,
            rest_seconds=120,
        )
    )

    session = WorkoutSession(
        user_id=user_id,
        template_id=template.id,
        name="Верх",
        status=WorkoutSessionStatus.ACTIVE,
        started_at=datetime.now(timezone.utc),
    )
    db.add(session)
    await db.flush()

    exercise = WorkoutSessionExercise(session_id=session.id, name="Жим лёжа", order=0)
    db.add(exercise)
    await db.flush()

    db.add(
        WorkoutSet(
            exercise_id=exercise.id,
            set_number=1,
            weight_kg=50.0,
            reps=8,
            is_completed=True,
        )
    )
    await db.flush()
    return template, session


@pytest_asyncio.fixture
async def workout(db_session, normal_user):
    """A template and a session built from it, in the test's own transaction."""
    template, session = await _seed_workout(db_session, normal_user.id)
    return {
        "db": db_session,
        "user": normal_user,
        "template": template,
        "session": session,
    }


# --- the session read ----------------------------------------------------------


@pytest.mark.asyncio
async def test_the_session_read_brings_the_template_and_the_sets(workout):
    """Nothing the coach reads may be left to a lazy load.

    A relationship that was not eager-loaded is fetched on first access, and
    in an async session that fetch has no greenlet to run in: it raises
    `MissingGreenlet` instead of returning the rows.
    """
    session = await get_workout_session(
        workout["db"], workout["session"].id, workout["user"].id
    )

    assert session is not None
    assert "template" not in inspect(session).unloaded
    assert "exercises" not in inspect(session).unloaded
    assert "sets" not in inspect(session.exercises[0]).unloaded
    # The template of the session is read too: it carries the plan's targets.
    assert "exercises" not in inspect(session.template).unloaded


# --- the preview endpoint ------------------------------------------------------


@pytest.mark.asyncio
async def test_the_preview_endpoint_answers_for_a_session_whose_plan_is_pending(
    workout, monkeypatch
):
    """The endpoint answers a session whose background plan has not landed.

    This is the `with_ai_plan=true` flow: the plan is generated in the
    background while the workout screen opens, and the endpoint reads what
    landed. The poll reads the plan's columns again, and the answer that
    follows is built from the session, its template and the user - so
    everything it reads has to arrive with a query: a relationship left to a
    lazy load raises `MissingGreenlet` here.
    """
    import app.services.ai_workout_service as service

    monkeypatch.setattr(service, "run_text_cascade", _fake_cascade(GOOD_PREVIEW))

    workout["session"].ai_plan_status = AI_PLAN_STATUS_PENDING
    await workout["db"].flush()

    real_wait = routes_module.wait_for_stored_ai_plan

    async def _short_wait(db, session_id, user_id, **kwargs):
        kwargs["timeout"] = 0.2
        return await real_wait(db, session_id, user_id, **kwargs)

    monkeypatch.setattr(routes_module, "wait_for_stored_ai_plan", _short_wait)

    payload = await ai_workout_preview(
        request=AIWorkoutPreviewRequest(
            session_id=workout["session"].id,
            template_id=workout["template"].id,
            name="Верх",
        ),
        db=workout["db"],
        current_user=workout["user"],
    )

    assert payload["available"] is True
    assert [item["name"] for item in payload["recommendations"]] == ["Жим лёжа"]


@pytest.mark.asyncio
async def test_the_preview_endpoint_returns_the_stored_plan(workout, monkeypatch):
    """A plan the background task stored is served without asking the model."""
    import app.services.ai_workout_service as service

    async def _boom(*args, **kwargs):
        raise AssertionError("a stored plan must not reach the model")

    monkeypatch.setattr(service, "run_text_cascade", _boom)

    stored = {
        "name": "Верх",
        "available": True,
        "reason": None,
        "recommendations": GOOD_PREVIEW["recommendations"],
        "focus": GOOD_PREVIEW["focus"],
        "motivation": GOOD_PREVIEW["motivation"],
        "limit": None,
    }
    workout["session"].ai_plan_status = AI_PLAN_STATUS_AVAILABLE
    workout["session"].ai_plan_json = json.dumps(stored, ensure_ascii=False)
    await workout["db"].flush()

    payload = await ai_workout_preview(
        request=AIWorkoutPreviewRequest(session_id=workout["session"].id),
        db=workout["db"],
        current_user=workout["user"],
    )

    assert payload["available"] is True
    assert [item["name"] for item in payload["recommendations"]] == ["Жим лёжа"]


# --- the background task -------------------------------------------------------


@pytest.mark.asyncio
async def test_the_background_task_stores_a_plan_without_a_lazy_load(monkeypatch):
    """The task that stores the plan reads the session the same way.

    It runs in its own session, in the background of the request, and every
    relationship it touches - the template, the session's exercises and their
    sets - has to arrive with the query: a lazy load there is a
    `MissingGreenlet` in a task nobody is watching.
    """
    import app.services.ai_workout_service as service

    monkeypatch.setattr(service, "run_text_cascade", _fake_cascade(GOOD_PREVIEW))

    watched = []

    class _Watched:
        """The task's own session, watched: what it loaded is what it may read."""

        def __init__(self, session):
            self._session = session
            self.instances = []

        def __getattr__(self, name):
            return getattr(self._session, name)

        async def execute(self, statement, *args, **kwargs):
            return await self._session.execute(statement, *args, **kwargs)

        async def commit(self):
            # The identity map is emptied when the session closes, and it holds
            # its rows weakly, so what the task had loaded is taken while the
            # task still holds on to it.
            for instance in self._session.identity_map.values():
                if instance not in self.instances:
                    self.instances.append(instance)
            return await self._session.commit()

        async def __aenter__(self):
            await self._session.__aenter__()
            return self

        async def __aexit__(self, *exc):
            return await self._session.__aexit__(*exc)

    def _watched_maker():
        session = _Watched(async_session_maker())
        watched.append(session)
        return session

    monkeypatch.setattr(service, "async_session_maker", _watched_maker)

    email = f"eager_loading_{uuid.uuid4().hex[:8]}@example.com"
    async with async_session_maker() as db:
        user = User(email=email, hashed_password="x", is_active=True, is_verified=True)
        db.add(user)
        await db.flush()
        _template, session = await _seed_workout(db, user.id)
        await db.commit()
        user_id, session_id = user.id, session.id

    try:
        await build_workout_preview_and_store(session_id)

        async with async_session_maker() as db:
            stored = (
                await db.execute(
                    select(WorkoutSession).where(WorkoutSession.id == session_id)
                )
            ).scalar_one()

        assert stored.ai_plan_status == AI_PLAN_STATUS_AVAILABLE
        plan = json.loads(stored.ai_plan_json)
        assert plan["available"] is True
        assert [item["name"] for item in plan["recommendations"]] == ["Жим лёжа"]

        # Everything the task read came with the query: the plan is built from
        # the template's exercises, and the session's own sets are read too.
        instances = watched[0].instances
        read = next(item for item in instances if isinstance(item, WorkoutSession))
        assert "exercises" not in inspect(read).unloaded
        assert "sets" not in inspect(read.exercises[0]).unloaded
        assert "exercises" not in inspect(read.template).unloaded
    finally:
        async with async_session_maker() as db:
            await db.execute(delete(User).where(User.id == user_id))
            await db.commit()
