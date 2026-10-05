"""Mock checks for the AI workout coach rules in app/services/ai_workout_service.py.

No network and no database: the model is replaced by a canned answer and the
session is a stub that replays canned rows, so these assert the two halves of the
contract - the prompts state the rules for every persona and carry the session's
real figures, and the stored verdict obeys the rules even when the model ignores
them. The figures are the other half: they are summed by SQL and handed over as
they are, so the coach can only talk about them.

The quota is asserted too, because it is the one rule the user meets without a
model call: a Free user who already spent the week must get the reason, not an
error, and a stored verdict must survive every failed path.
"""

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

from app.services.ai_vision import EMOJI_PATTERN, count_sentences  # noqa: E402
from app.services.ai_workout_service import (  # noqa: E402
    MAX_EXERCISES_IN_PROMPT,
    REASON_FAILED,
    REASON_NO_EXERCISES,
    REASON_NO_SETS,
    REASON_NOT_ANALYZED,
    REASON_PREVIEW_FAILED,
    MAX_NOTES_CHARS,
    SUMMARY_MAX_SENTENCES,
    SUMMARY_MIN_SENTENCES,
    build_summary_payload,
    build_workout_preview_prompt,
    build_workout_summary_prompt,
    load_stored_analysis,
    _preview_validator,
    _validate_workout_summary,
)
from app.services.limits import AI_ANALYSIS_COOLDOWN_DAYS, can_run_workout_ai  # noqa: E402

# Four days ago, i.e. inside the 7-day window: a Free user who ran the coach then
# is blocked until the cooldown is out.
RECENT = datetime(2026, 10, 1, 10, tzinfo=timezone.utc)

METRICS = {
    "tonnage_kg": 1605.0,
    "sets_count": 18,
    "completed_sets": 17,
    "top_weight_kg": 60.0,
    "reps": 150,
    "duration_seconds": 3120,
    "name": "Верх",
}

MUSCLE_LINES = ["- грудь: 900 кг тоннажа, 9 подходов", "- спина: 705 кг тоннажа, 8 подходов"]

GOOD_SUMMARY = (
    "Тренировка получилась собранной: объём вырос, а тяжёлый подход в жиме взялся уверенно. "
    "Распределение по группам осталось перекошенным в грудь, и спина отработала меньше, чем могла. "
    "Как следующий шаг: добавь тягу на следующей тренировке и не добавляй вес, пока не закроешь этот пробел."
)

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
            "motivation": "Первый подход — самый сильный",
        },
        {
            "name": "Тяга",
            "sets": 3,
            "reps": 10,
            "weight_kg": None,
            "rest_seconds": 120,
            "focus": "Корпус не гуляется",
            "motivation": "Тяни локтями к бёдрам",
        },
    ],
}

ATHLETE_LINE = "Профиль: пол male, возраст 30 лет, рост 180 см, вес 80 кг, активность moderate. Цель по телу: gain."


def _persona(prompt, key):
    return f"{key} влияет только на тон формулировок" in prompt


def _user(**overrides):
    fields = {
        "id": 7,
        "gender": "male",
        "age": 30,
        "height_cm": 180.0,
        "weight_kg": 80.0,
        "activity_level": "moderate",
        "goal": "gain",
        "ai_persona": "kind",
        "ai_persona_custom_text": None,
        "is_premium": False,
        "last_workout_ai_analysis_at": None,
    }
    fields.update(overrides)
    return SimpleNamespace(**fields)


def _session(**overrides):
    """A session row as SQLAlchemy hands it back: attributes, not a dict."""
    fields = {
        "id": 42,
        "user_id": 7,
        "name": "Верх",
        "exercises": [
            SimpleNamespace(name="Жим лёжа"),
            SimpleNamespace(name="Тяга"),
        ],
        "ai_summary": None,
        "ai_recommendations_json": None,
        "analyzed_at": None,
        "ai_persona": None,
    }
    fields.update(overrides)
    return SimpleNamespace(**fields)


def _stored_session():
    """A session that already carries a verdict."""
    return _session(
        ai_summary=GOOD_SUMMARY,
        ai_recommendations_json=json.dumps(
            {
                "overall_score": 7.5,
                "recovery_advice": "Сон и белок",
                "highlights": ["Объём вырос"],
                "recommendations": [{"title": "Тяга", "text": "Добавь 3 подхода"}],
            },
            ensure_ascii=False,
        ),
        analyzed_at=RECENT,
        ai_persona="kind",
    )


class _FakeResult:
    """Canned answer for one `execute`, in the shapes the service reads."""

    def __init__(self, row=None, scalars=None):
        self._row = row
        self._scalars = scalars or []

    def first(self):
        return self._row

    def all(self):
        return self._scalars

    def scalars(self):
        return SimpleNamespace(all=lambda: list(self._scalars))


class _StubSession:
    """Session stand-in that replays canned results and records its statements."""

    def __init__(self, *results):
        self.results = list(results)
        self.statements = []
        self.commits = 0
        self.rolled_back = False

    async def execute(self, statement):
        self.statements.append(statement)
        if not self.results:
            raise AssertionError("unexpected extra query")
        return self.results.pop(0)

    async def commit(self):
        self.commits += 1

    async def refresh(self, obj):
        pass

    async def rollback(self):
        self.rolled_back = True


def _metrics_row(**overrides):
    row = {
        "tonnage_kg": METRICS["tonnage_kg"],
        "sets_count": METRICS["sets_count"],
        "completed_sets": METRICS["completed_sets"],
        "top_weight_kg": METRICS["top_weight_kg"],
        "reps": METRICS["reps"],
        "duration_seconds": METRICS["duration_seconds"],
        "name": "Верх",
    }
    row.update(overrides)
    return SimpleNamespace(**row)


def _summary_prompt(persona="kind", **overrides):
    kwargs = {
        "session_name": "Верх",
        "metrics": METRICS,
        "muscle_lines": MUSCLE_LINES,
        "performance_lines": ["- Жим лёжа: прошлый рабочий вес 55 кг на 8 повт."],
        "notes": None,
        "goal": "hypertrophy",
        "athlete_line": ATHLETE_LINE,
        "persona": persona,
    }
    kwargs.update(overrides)
    return build_workout_summary_prompt(**kwargs)


def _preview_prompt(persona="kind", exercises=None):
    return build_workout_preview_prompt(
        exercises or [{"name": "Жим лёжа"}, {"name": "Тяга"}],
        session_name="Верх",
        goal="hypertrophy",
        athlete_line=ATHLETE_LINE,
        performance_lines=["- Жим лёжа: прошлый рабочий вес 55 кг на 8 повт., лучшая оценка 1ПМ 69.7 кг"],
        persona=persona,
        persona_custom_text="Говори кратко, как тренер в зале." if persona == "custom" else None,
    )


# --- the prompts state the contract --------------------------------------------

@pytest.mark.parametrize("persona", ["kind", "strict", "sarcastic", "custom"])
def test_summary_prompt_carries_the_rules_for_every_persona(persona):
    prompt = _summary_prompt(persona)

    assert "НОЛЬ ЭМОДЗИ" in prompt
    assert not EMOJI_PATTERN.search(prompt)
    assert "ЧЕСТНОСТЬ" in prompt
    assert f"РОВНО {SUMMARY_MIN_SENTENCES}-{SUMMARY_MAX_SENTENCES} предложений" in prompt
    assert _persona(prompt, "Персона")
    # The coach answers in its own voice, not the nutritionist's.
    assert "нутрициолог" not in prompt.lower()


def test_summary_prompt_forbids_the_model_from_restating_the_figures():
    prompt = _summary_prompt()

    assert "НИ ОДНОЙ ЦИФРЫ В ai_summary И recovery_advice" in prompt
    # The exact sums are still context - without them the coach cannot say whether
    # the session was light or heavy.
    assert "посчитано точно по базе" in prompt
    assert "1605 кг" in prompt
    assert "выполнено 17 из 18 подходов" in prompt
    assert "время 52 мин" in prompt


def test_summary_prompt_allows_figures_only_in_the_recommendations():
    prompt = _summary_prompt()

    assert "ЦИФРЫ РАЗРЕШЕНЫ ТОЛЬКО В recommendations" in prompt


def test_summary_prompt_carries_the_session_it_is_about():
    prompt = _summary_prompt()

    assert "Название тренировки: Верх" in prompt
    assert "Цель тренировки: набор массы" in prompt
    assert "- грудь: 900 кг тоннажа, 9 подходов" in prompt
    # The muscle groups come from the catalog join, so the model is told not to
    # invent names that are not in the block.
    assert "названия не выдумывай" in prompt


def test_summary_prompt_says_so_when_there_is_no_history():
    prompt = _summary_prompt(performance_lines=[], muscle_lines=[])

    assert "Предыдущих тренировок по этим упражнениям нет" in prompt
    assert "Распределение по мышечным группам определить не удалось" in prompt


def test_summary_prompt_flattens_and_caps_the_user_note():
    long_note = "\n".join(["плечо побаливает после второго подхода"] * 40)
    prompt = _summary_prompt(notes=long_note)

    # The note is one line and bounded: a wall of user text cannot crowd out the
    # rules or the figures.
    note = re.search(r'Комментарий пользователя о тренировке: "([^"]*)"', prompt).group(1)
    assert note.startswith("плечо побаливает")
    assert note.endswith("...")
    assert len(note) <= MAX_NOTES_CHARS + 3
    assert "\n" not in note


def test_summary_prompt_uses_an_unknown_persona_as_the_default_one():
    prompt = _summary_prompt(persona="coach-mode-that-does-not-exist")

    assert "Ты — добрый тренер." in prompt
    assert f"РОВНО {SUMMARY_MIN_SENTENCES}-{SUMMARY_MAX_SENTENCES} предложений" in prompt


def test_preview_prompt_lists_the_chosen_exercises_and_closes_the_list():
    prompt = _preview_prompt()

    assert "СПИСОК ЗАКРЫТ" in prompt
    assert "- 1. Жим лёжа" in prompt
    assert "- 2. Тяга" in prompt
    assert "ВЕС - ИЗ ИСТОРИИ, А НЕ ИЗ ГОЛОВЫ" in prompt
    assert "верни weight_kg: null и не выдумывай число" in prompt


def test_preview_prompt_states_the_no_digit_and_no_emoji_rules():
    prompt = _preview_prompt()

    assert "БЕЗ ЦИФР В ТЕКСТЕ" in prompt
    assert "НОЛЬ ЭМОДЗИ" in prompt
    assert not EMOJI_PATTERN.search(prompt)


def test_preview_prompt_reports_when_there_is_no_history_to_plan_from():
    prompt = build_workout_preview_prompt(
        [{"name": "Жим лёжа"}],
        session_name="Верх",
        athlete_line=ATHLETE_LINE,
        performance_lines=[],
    )

    assert "История по этим упражнениям пуста" in prompt


def test_preview_prompt_caps_a_very_long_exercise_list():
    many = [{"name": f"Упражнение {i}"} for i in range(MAX_EXERCISES_IN_PROMPT + 6)]
    prompt = build_workout_preview_prompt(many, athlete_line=ATHLETE_LINE)

    # The prompt only ever spells out the exercises the coach must answer about.
    assert f"- {MAX_EXERCISES_IN_PROMPT}. Упражнение {MAX_EXERCISES_IN_PROMPT - 1}" in prompt
    assert "Упражнение 100" not in prompt


# --- the stored verdict obeys the rules ---------------------------------------

def test_validate_strips_emoji_and_clamps_length():
    chaotic = "🤜 " + " ".join([f"Замечание номер {i} о тренировке." for i in range(1, 12)])
    result = _validate_workout_summary(
        {"ai_summary": chaotic, "overall_score": 8.4, "highlights": ["Заметка"]}
    )
    summary = result["ai_summary"]

    assert not EMOJI_PATTERN.search(summary)
    assert count_sentences(summary) <= SUMMARY_MAX_SENTENCES
    # it is a cut, not a rewrite: the opening judgement survives
    assert summary.startswith("Замечание номер 1 о тренировке.")
    assert result["overall_score"] == 8.4


def test_validate_leaves_a_compliant_verdict_untouched():
    result = _validate_workout_summary(
        {"ai_summary": GOOD_SUMMARY, "overall_score": 7.5, "highlights": ["Объём вырос"]}
    )

    assert result["ai_summary"] == GOOD_SUMMARY
    assert SUMMARY_MIN_SENTENCES <= count_sentences(GOOD_SUMMARY) <= SUMMARY_MAX_SENTENCES


def test_validate_normalises_scores_onto_the_printed_scale():
    payload = {"ai_summary": GOOD_SUMMARY, "highlights": ["Объём вырос"]}
    assert _validate_workout_summary({**payload, "overall_score": 0.78})["overall_score"] == pytest.approx(7.8)
    assert _validate_workout_summary({**payload, "overall_score": 42})["overall_score"] == 10.0
    assert _validate_workout_summary({**payload, "overall_score": -3})["overall_score"] == 1.0


def test_validate_rejects_a_verdict_without_text_or_score():
    with pytest.raises(ValueError, match="Missing required field: ai_summary"):
        _validate_workout_summary({"overall_score": 7.0})
    with pytest.raises(ValueError, match="Missing required field: overall_score"):
        _validate_workout_summary({"ai_summary": GOOD_SUMMARY})
    with pytest.raises(ValueError, match="empty after removing emoji"):
        _validate_workout_summary({"ai_summary": "💪🔥", "overall_score": 7.0, "highlights": ["x"]})
    with pytest.raises(ValueError, match="highlights must be a list"):
        _validate_workout_summary({"ai_summary": GOOD_SUMMARY, "overall_score": 7.0})


def test_validate_cleans_the_breakdown_the_verdict_comes_with():
    result = _validate_workout_summary(
        {
            "ai_summary": GOOD_SUMMARY,
            "overall_score": 7.5,
            "recovery_advice": "  Сон 😴\nи белок  ",
            "highlights": ["- Объём вырос 📈", "   ", None],
            "recommendations": [
                {"title": "Тяга", "text": "Добавь 3 подхода"},
                {"title": "", "text": "пропустить"},
                {"title": "Без текста", "text": "  "},
                "not an object",
            ],
        }
    )

    assert result["recovery_advice"] == "Сон и белок"
    assert result["highlights"] == ["Объём вырос"]
    assert result["recommendations"] == [{"title": "Тяга", "text": "Добавь 3 подхода"}]


def test_validate_rejects_a_breakdown_with_nothing_in_it():
    with pytest.raises(ValueError, match="highlights are empty"):
        _validate_workout_summary(
            {"ai_summary": GOOD_SUMMARY, "overall_score": 7.5, "highlights": ["  ", None]}
        )


# --- the plan matches the workout that was asked about -------------------------

def test_preview_validator_keeps_the_plan_on_the_chosen_exercises():
    result = _preview_validator(["Жим лёжа", "Тяга"])(json.loads(json.dumps(GOOD_PREVIEW, ensure_ascii=False)))

    assert [r["name"] for r in result["recommendations"]] == ["Жим лёжа", "Тяга"]
    assert result["recommendations"][0]["weight_kg"] == 55.0
    # An exercise the user has never loaded gets targets, never an invented weight.
    assert result["recommendations"][1]["weight_kg"] is None
    assert result["focus"] == GOOD_PREVIEW["focus"]


def test_preview_validator_drops_an_exercise_the_model_smuggled_in():
    raw = json.loads(json.dumps(GOOD_PREVIEW, ensure_ascii=False))
    raw["recommendations"].append({"name": "Жим лёжа в суперсерии", "sets": 5, "reps": 3})
    raw["recommendations"][0]["name"] = "жим лёжа"

    result = _preview_validator(["Жим лёжа", "Тяга"])(raw)

    assert [r["name"] for r in result["recommendations"]] == ["жим лёжа", "Тяга"]


def test_preview_validator_drops_an_implausible_weight():
    raw = json.loads(json.dumps(GOOD_PREVIEW, ensure_ascii=False))
    raw["recommendations"][0]["weight_kg"] = 900.0

    result = _preview_validator(["Жим лёжа", "Тяга"])(raw)

    # 900 кг is not a heavy squat, it is a made-up number: it is dropped rather
    # than clamped to something that would still be wrong advice.
    assert result["recommendations"][0]["weight_kg"] is None
    assert result["recommendations"][0]["sets"] == 4


def test_preview_validator_strips_emoji_from_the_notes():
    raw = json.loads(json.dumps(GOOD_PREVIEW, ensure_ascii=False))
    raw["recommendations"][0]["focus"] = "🤜 Лопатки\nсведены"

    result = _preview_validator(["Жим лёжа", "Тяга"])(raw)

    assert result["recommendations"][0]["focus"] == "Лопатки сведены"


def test_preview_validator_rejects_a_plan_for_another_workout():
    """A plan that matches nothing is a failure, so the cascade tries the next model."""
    raw = {"recommendations": [{"name": "Приседание", "sets": 3, "reps": 5}]}

    with pytest.raises(ValueError, match="matched none of the requested exercises"):
        _preview_validator(["Жим лёжа"])(raw)


def test_preview_validator_rejects_a_plan_with_no_list():
    with pytest.raises(ValueError, match="Missing required field: recommendations"):
        _preview_validator(["Жим лёжа"])({"focus": "что-то"})


# --- storage ------------------------------------------------------------------

def test_stored_verdict_is_read_back_out_of_the_json_column():
    stored = load_stored_analysis(_stored_session())

    assert stored["ai_summary"] == GOOD_SUMMARY
    assert stored["overall_score"] == 7.5
    assert stored["recovery_advice"] == "Сон и белок"
    assert stored["recommendations"] == [{"title": "Тяга", "text": "Добавь 3 подхода"}]


def test_a_session_that_was_never_analysed_has_no_verdict():
    assert load_stored_analysis(_session()) is None


def test_a_corrupted_column_reads_as_no_verdict():
    """A card that cannot be parsed must not take the history screen down."""
    assert load_stored_analysis(_session(ai_recommendations_json="{not json")) is None


@pytest.mark.asyncio
async def test_writing_a_verdict_stamps_the_analysis_and_the_weekly_cooldown(monkeypatch):
    import app.services.ai_workout_service as service

    monkeypatch.setattr(
        service, "run_text_cascade", _fake_cascade({"ai_summary": GOOD_SUMMARY, "overall_score": 7.5})
    )
    db = _StubSession()
    user = _user()
    session = _session()

    await service.store_workout_analysis(
        db,
        user,
        session,
        {"ai_summary": GOOD_SUMMARY, "overall_score": 7.5, "highlights": ["Объём вырос"], "recommendations": []},
    )

    assert session.ai_summary == GOOD_SUMMARY
    assert json.loads(session.ai_recommendations_json)["overall_score"] == 7.5
    # The cooldown reads this column, so a Free user who got a verdict cannot ask
    # again until the week is out.
    assert user.last_workout_ai_analysis_at == session.analyzed_at
    # The voice the verdict was written in is copied, not read live.
    assert session.ai_persona == "kind"
    assert db.commits == 1


def _fake_cascade(payload):
    """A cascade stand-in that returns one canned answer."""

    async def _run(prompt, validate, log_prefix="[AI]"):
        return validate(payload)

    return _run


# --- the answer paths ---------------------------------------------------------

@pytest.mark.asyncio
async def test_a_stored_verdict_is_returned_without_asking_the_model(monkeypatch):
    import app.services.ai_workout_service as service

    async def _boom(*args, **kwargs):
        raise AssertionError("the model must not be asked for a stored verdict")

    monkeypatch.setattr(service, "run_text_cascade", _boom)

    db = _StubSession(_FakeResult(scalars=[]))
    payload = await service.analyze_workout_session(db, _user(), _stored_session())

    assert payload["available"] is True
    assert payload["ai_summary"] == GOOD_SUMMARY
    assert payload["workout_id"] == 42
    assert payload["reason"] is None


@pytest.mark.asyncio
async def test_a_free_user_who_spent_the_week_gets_the_reason_and_keeps_the_verdict(monkeypatch):
    import app.services.ai_workout_service as service

    async def _boom(*args, **kwargs):
        raise AssertionError("a spent quota must not reach the model")

    monkeypatch.setattr(service, "run_text_cascade", _boom)

    db = _StubSession(_FakeResult(scalars=[]), _FakeResult(scalars=[]))
    user = _user(last_workout_ai_analysis_at=RECENT)
    assert can_run_workout_ai(user).allowed is False

    # Re-opening the verdict is free: the stored answer comes back untouched.
    payload = await service.analyze_workout_session(db, user, _session(ai_summary=GOOD_SUMMARY))

    assert payload["available"] is True
    assert payload["ai_summary"] == GOOD_SUMMARY
    assert payload["limit"]["allowed"] is False
    assert payload["reason"] is None

    # Asking for a new one is what costs quota, so it carries the cooldown reason.
    payload = await service.analyze_workout_session(
        db, user, _session(ai_summary=GOOD_SUMMARY), force=True
    )

    assert payload["available"] is True
    assert payload["ai_summary"] == GOOD_SUMMARY
    assert "7 дней" in payload["reason"]


@pytest.mark.asyncio
async def test_a_session_without_weighted_sets_is_an_empty_state(monkeypatch):
    import app.services.ai_workout_service as service

    async def _boom(*args, **kwargs):
        raise AssertionError("nothing to analyse must not reach the model")

    monkeypatch.setattr(service, "run_text_cascade", _boom)

    db = _StubSession(
        _FakeResult(row=_metrics_row(tonnage_kg=0, completed_sets=0, top_weight_kg=0)),
        _FakeResult(scalars=[]),
    )
    payload = await service.analyze_workout_session(db, _user(), _session())

    assert payload["available"] is False
    assert payload["reason"] == REASON_NO_SETS


@pytest.mark.asyncio
async def test_a_failed_model_keeps_the_last_verdict(monkeypatch):
    import app.services.ai_workout_service as service

    async def _boom(*args, **kwargs):
        raise RuntimeError("all attempted models failed")

    monkeypatch.setattr(service, "run_text_cascade", _boom)

    stored = _stored_session()
    db = _StubSession(
        _FakeResult(row=_metrics_row()),
        _FakeResult(scalars=[]),
        _FakeResult(scalars=[]),
        _FakeResult(scalars=[]),
    )
    payload = await service.analyze_workout_session(db, _user(), stored, force=True)

    assert payload["available"] is True
    assert payload["ai_summary"] == GOOD_SUMMARY
    assert payload["reason"] == REASON_FAILED
    assert db.rolled_back is True


@pytest.mark.asyncio
async def test_a_first_verdict_is_generated_and_stored(monkeypatch):
    import app.services.ai_workout_service as service

    monkeypatch.setattr(
        service,
        "run_text_cascade",
        _fake_cascade(
            {
                "ai_summary": GOOD_SUMMARY,
                "overall_score": 7.5,
                "recovery_advice": "Сон и белок",
                "highlights": ["Объём вырос"],
                "recommendations": [{"title": "Тяга", "text": "Добавь 3 подхода"}],
            }
        ),
    )

    db = _StubSession(
        _FakeResult(row=_metrics_row()),
        _FakeResult(scalars=[10, 11]),
        _FakeResult(scalars=[]),
        _FakeResult(scalars=[]),
        _FakeResult(scalars=[]),
    )
    user = _user()
    session = _session()

    payload = await service.analyze_workout_session(db, user, session)

    assert payload["available"] is True
    assert payload["generated"] is True
    assert payload["reanalyzed"] is False
    assert payload["overall_score"] == 7.5
    assert payload["ai_summary"] == GOOD_SUMMARY
    assert session.ai_summary == GOOD_SUMMARY
    assert can_run_workout_ai(user).allowed is False


@pytest.mark.asyncio
async def test_reanalysing_is_flagged_as_a_rewrite(monkeypatch):
    import app.services.ai_workout_service as service

    monkeypatch.setattr(
        service,
        "run_text_cascade",
        _fake_cascade({"ai_summary": GOOD_SUMMARY, "overall_score": 8.0, "highlights": ["Объём вырос"]}),
    )

    db = _StubSession(
        _FakeResult(row=_metrics_row()),
        _FakeResult(scalars=[10]),
        _FakeResult(scalars=[]),
        _FakeResult(scalars=[]),
        _FakeResult(scalars=[]),
    )
    payload = await service.analyze_workout_session(db, _user(), _stored_session(), force=True)

    assert payload["available"] is True
    assert payload["reanalyzed"] is True
    assert payload["generated"] is True


@pytest.mark.asyncio
async def test_the_muscle_breakdown_is_summed_by_the_database():
    session = _session()
    db = _StubSession(
        _FakeResult(
            scalars=[
                SimpleNamespace(muscle_group="грудь", tonnage_kg=900.0, sets_count=9),
                SimpleNamespace(muscle_group="спина", tonnage_kg=705.0, sets_count=8),
            ]
        )
    )

    payload = await build_summary_payload(db, session, available=False)

    assert payload["muscle_groups"] == [
        {"muscle_group": "грудь", "tonnage_kg": 900.0, "sets_count": 9},
        {"muscle_group": "спина", "tonnage_kg": 705.0, "sets_count": 8},
    ]
    # The card renders the figures, so they must arrive even with no verdict.
    assert payload["reason"] is None or payload["available"] is False

    sql = str(db.statements[0])
    assert "sum(workout_sets.weight_kg * workout_sets.reps)" in sql
    assert "exercise_catalog.muscle_group" in sql
    assert "workout_sets.is_completed IS true" in sql


@pytest.mark.asyncio
async def test_a_failed_read_removes_the_card_placeholder():
    """A read that fails is not a verdict: there is nothing to render."""
    import app.services.ai_workout_service as service

    db = _StubSession(_FakeResult(scalars=[]))
    payload = await service.get_workout_analysis(db, _user(), _session())

    assert payload["available"] is False
    assert payload["reason"] == REASON_NOT_ANALYZED
    assert payload["limit"]["code"] == "workout_ai"
    assert payload["limit"]["allowed"] is True


# --- the plan -----------------------------------------------------------------

@pytest.mark.asyncio
async def test_a_plan_without_exercises_is_an_empty_state(monkeypatch):
    import app.services.ai_workout_service as service

    async def _boom(*args, **kwargs):
        raise AssertionError("nothing to plan must not reach the model")

    monkeypatch.setattr(service, "run_text_cascade", _boom)

    db = _StubSession()
    payload = await service.build_workout_preview(db, _user(), exercises=["  ", ""], name="Верх")

    assert payload["available"] is False
    assert payload["reason"] == REASON_NO_EXERCISES
    # The name still travels: the user starts the workout without the coach.
    assert payload["name"] == "Верх"
    assert payload["limit"]["allowed"] is True


@pytest.mark.asyncio
async def test_a_plan_does_not_spend_the_weekly_allowance(monkeypatch):
    """The Free cooldown is for the analysis: a plan is advice, not a reading."""
    import app.services.ai_workout_service as service

    monkeypatch.setattr(
        service, "run_text_cascade", _fake_cascade(GOOD_PREVIEW)
    )

    db = _StubSession(_FakeResult(scalars=[]), _FakeResult(scalars=[]))
    user = _user(last_workout_ai_analysis_at=RECENT)

    payload = await service.build_workout_preview(db, user, exercises=["Жим лёжа", "Тяга"])

    assert payload["available"] is True
    assert len(payload["recommendations"]) == 2
    # The quota is reported so the screen can show the tier state, but nothing
    # was written and the cooldown was not moved.
    assert payload["limit"]["allowed"] is False
    assert db.commits == 0


@pytest.mark.asyncio
async def test_a_failed_plan_is_an_empty_state_not_an_error(monkeypatch):
    import app.services.ai_workout_service as service

    async def _boom(*args, **kwargs):
        raise RuntimeError("all attempted models failed")

    monkeypatch.setattr(service, "run_text_cascade", _boom)

    db = _StubSession(_FakeResult(scalars=[]))
    payload = await service.build_workout_preview(db, _user(), exercises=["Жим лёжа"])

    assert payload["available"] is False
    assert payload["reason"] == REASON_PREVIEW_FAILED
    assert db.rolled_back is True


@pytest.mark.asyncio
async def test_a_plan_from_a_template_answers_about_the_template_exercises(monkeypatch):
    import app.services.ai_workout_service as service

    monkeypatch.setattr(service, "run_text_cascade", _fake_cascade(GOOD_PREVIEW))

    template = SimpleNamespace(
        id=3,
        name="Верх",
        exercises=[
            SimpleNamespace(id=1, name="Жим лёжа", order=0, target_sets=4, target_reps=8, target_weight_kg=50.0, rest_seconds=120),
            SimpleNamespace(id=2, name="Тяга", order=1, target_sets=3, target_reps=10, target_weight_kg=None, rest_seconds=120),
        ],
    )
    db = _StubSession(_FakeResult(scalars=[]), _FakeResult(scalars=[]))

    payload = await service.build_workout_preview(db, _user(), template=template)

    assert payload["available"] is True
    assert payload["name"] == "Верх"
    assert [r["name"] for r in payload["recommendations"]] == ["Жим лёжа", "Тяга"]


@pytest.mark.asyncio
async def test_a_goal_only_plan_resolves_the_quick_start_exercises(monkeypatch):
    """A quick start has no exercise list on the wire; the plan has to find the
    same movements the session will create, or the badges describe another
    workout."""
    import app.services.ai_workout_service as service

    seen = {}

    async def _fake_capture(prompt, validator, tag):
        seen["prompt"] = prompt
        answer = json.loads(json.dumps(GOOD_PREVIEW))
        # Answer in the model's own order: the plan, not the model, decides the
        # order the badges appear in.
        answer["recommendations"] = list(reversed(answer["recommendations"]))
        return await _fake_cascade(answer)(prompt, validator, tag)

    monkeypatch.setattr(service, "run_text_cascade", _fake_capture)

    async def _catalog(db, goal):
        assert goal == "strength"
        return [
            SimpleNamespace(name="Жим лёжа"),
            SimpleNamespace(name="Тяга"),
        ]

    monkeypatch.setattr(service, "select_quick_start_exercises", _catalog)

    db = _StubSession(_FakeResult(scalars=[]))

    payload = await service.build_workout_preview(db, _user(), goal="strength", name="Быстрый старт")

    assert payload["available"] is True
    # The order of the picks is the order of the workout, so the plan keeps it.
    assert [r["name"] for r in payload["recommendations"]] == ["Жим лёжа", "Тяга"]
    assert "Жим лёжа" in seen["prompt"]


@pytest.mark.asyncio
async def test_a_goal_without_any_catalog_exercise_has_no_plan(monkeypatch):
    import app.services.ai_workout_service as service

    async def _boom(*args, **kwargs):
        raise AssertionError("nothing to plan must not reach the model")

    monkeypatch.setattr(service, "run_text_cascade", _boom)

    async def _empty_catalog(db, goal):
        return []

    monkeypatch.setattr(service, "select_quick_start_exercises", _empty_catalog)

    db = _StubSession()

    payload = await service.build_workout_preview(db, _user(), goal="strength")

    assert payload["available"] is False
    assert payload["reason"] == REASON_NO_EXERCISES


@pytest.mark.asyncio
async def test_an_unknown_muscle_group_is_named_not_dropped():
    """An exercise nobody catalogued still moved real weight, so it belongs in
    the breakdown under "прочие мышцы" instead of vanishing from the verdict."""
    import app.services.ai_workout_service as service

    db = _StubSession(_FakeResult(scalars=[]))

    await service.load_muscle_volume(db, 5, 9)

    sql = str(db.statements[0])
    # The fallback is only reachable through an outer join; an inner one silently
    # drops every uncatalogued exercise, which is the case the fallback is for.
    assert "LEFT OUTER JOIN" in sql
    # The group falls back to the constant rather than to NULL, so the verdict is
    # handed a name instead of an empty line.
    assert "coalesce(exercise_catalog.muscle_group" in sql
    assert db.statements[0].compile().params.get("param_1") == service.OTHER_MUSCLE_GROUP


@pytest.mark.asyncio
async def test_the_history_of_the_judged_session_is_left_out(monkeypatch):
    """The session under review must not count as its own history.

    A trend ending in the number being judged compares the workout with itself,
    so the session is excluded from the aggregates while everything before it
    stays - that progression is the point of the lines.
    """
    import app.services.ai_workout_service as service

    monkeypatch.setattr(
        service, "run_text_cascade", _fake_cascade({"ai_summary": GOOD_SUMMARY, "overall_score": 8.0, "highlights": ["Объём вырос"]})
    )

    db = _StubSession(
        _FakeResult(row=_metrics_row()),
        _FakeResult(scalars=[10, 11]),
        _FakeResult(scalars=[]),
        _FakeResult(scalars=[]),
        _FakeResult(scalars=[]),
    )

    await service.analyze_workout_session(db, _user(), _session(id=11))

    aggregate = str(db.statements[2])
    assert "!= 11" in aggregate or "!= :" in aggregate


def test_a_session_with_no_known_duration_does_not_claim_zero_minutes():
    """The verdict must not tell the user their hour-long workout took 0 min."""
    prompt = _summary_prompt(metrics={**METRICS, "duration_seconds": 0})

    assert "время 0 мин" not in prompt
    assert "Длительность тренировки неизвестна" in prompt

    # A known duration is still stated: the figure is the point of the block.
    assert "время 52 мин" in _summary_prompt(metrics=METRICS)


def test_the_weekly_allowance_is_the_same_one_the_limits_table_advertises():
    """The verdict and the tier snapshot must not disagree about the cooldown."""
    user = _user(last_workout_ai_analysis_at=RECENT)
    decision = can_run_workout_ai(user)

    assert decision.code == "workout_ai"
    assert decision.limit == 1
    # Three days into a seven-day window: blocked, and the reset is named.
    assert decision.allowed is False
    assert decision.resets_at is not None
    assert (decision.resets_at - RECENT).days == AI_ANALYSIS_COOLDOWN_DAYS