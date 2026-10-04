"""Mock checks for the daily recap rules in app/services/ai_summary.py.

No network and no database: the model is replaced by a canned answer and the
session is a stub that replays canned rows, so these assert the two halves of the
contract - the prompt states the rules for every persona and carries the day it is
about, and the stored recap obeys the rules even when the model ignores them. The
day's figures are the other half: they are summed by SQL and handed over as they
are, so the recap can only talk about them.
"""

import sys
from datetime import date, datetime, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

from app.services.ai_summary import (  # noqa: E402
    MAX_MEALS_IN_PROMPT,
    REASON_DAY_NOT_FINISHED,
    SUMMARY_MAX_SENTENCES,
    SUMMARY_MIN_SENTENCES,
    _validate_daily_summary,
    build_daily_summary_prompt,
    get_or_create_daily_summary,
    load_day_totals,
)
from app.services.ai_vision import EMOJI_PATTERN, PERSONA_PROMPTS, count_sentences  # noqa: E402
from app.services.nutrition import local_day_of, utcnow  # noqa: E402

DAY = date(2026, 10, 3)
TARGETS = {
    "target_calories": 2000,
    "target_protein_g": 150,
    "target_fat_g": 70,
    "target_carbs_g": 220,
}

GOOD_SUMMARY = (
    "День вышел плотным по калориям, и тяжёлым приёмом стал поздний ужин. "
    "Белка за день набралось больше дневной отметки, и это отличная новость для мышц и для сытости. "
    "Овощей и клетчатки было заметно меньше, чем хотелось бы, а соли набралось многовато. "
    "Как улучшение: начни завтра с овощного приёма пищи и не добавляй соль в ужин."
)

# A model that ignored the brief: emoji and an essay instead of one paragraph.
CHAOTIC_SUMMARY = " ".join(
    ["🥩 День так себе. 😍"]
    + [f"Замечание номер {i} о том, как распределился день по времени." for i in range(1, 12)]
)


def _totals(**overrides):
    """Day figures as SQL hands them over, for the prompt builders below."""
    totals = {
        "meals_count": 0,
        "calories": 0.0,
        "protein_g": 0.0,
        "fat_g": 0.0,
        "carbs_g": 0.0,
        "fiber_g": 0.0,
        "sugar_g": 0.0,
        "sodium_mg": 0.0,
    }
    totals.update(overrides)
    return totals


def _meal(hour: int, calories: float = 500.0, protein: float = 30.0):
    return SimpleNamespace(
        dish_name=f"Блюдо в {hour}:00",
        eaten_at=datetime(2026, 10, 3, hour, tzinfo=timezone.utc),
        calories=calories,
        protein_g=protein,
        fat_g=20.0,
        carbs_g=60.0,
        fiber_g=6.0,
        sugar_g=5.0,
        sodium_mg=400.0,
    )


def _prompt(persona: str, meals=None) -> str:
    meals = meals if meals is not None else [_meal(9), _meal(13), _meal(19)]
    return build_daily_summary_prompt(
        target_date=DAY,
        totals=_totals(
            meals_count=len(meals),
            calories=sum(m.calories or 0 for m in meals),
            protein_g=sum(m.protein_g or 0 for m in meals),
        ),
        meals=meals,
        tz_offset_minutes=0,
        user_goal="lose",
        targets=TARGETS,
        persona=persona,
        persona_custom_text="Разговаривай как дед, который любит внуков." if persona == "custom" else None,
    )


def _row(**overrides):
    """One aggregate row as SQLAlchemy hands it back: named columns, not a dict."""
    return SimpleNamespace(**_totals(**overrides))


class _FakeResult:
    """Canned answer for one `execute`, in either shape the service reads."""

    def __init__(self, row=None, scalar=None):
        self._row = row
        self._scalar = scalar

    def one(self):
        return self._row

    def scalar_one_or_none(self):
        return self._scalar


class _StubSession:
    """Session stand-in that replays canned results and records its statements."""

    def __init__(self, *results):
        self.results = list(results)
        self.statements = []

    async def execute(self, statement):
        self.statements.append(statement)
        return self.results.pop(0)

    async def rollback(self):
        pass


def _stored_recap():
    return SimpleNamespace(
        summary_text=GOOD_SUMMARY,
        overall_score=7.5,
        ai_persona="kind",
    )


# --- the prompt states the contract --------------------------------------------

@pytest.mark.parametrize("persona", sorted(PERSONA_PROMPTS))
def test_prompt_carries_the_rules_for_every_persona(persona):
    prompt = _prompt(persona)

    assert "НОЛЬ ЭМОДЗИ" in prompt
    assert not EMOJI_PATTERN.search(prompt)
    assert "НИКАКИХ СПИСКОВ И РАЗМЕТОК" in prompt
    assert "ЧЕСТНОСТЬ" in prompt
    assert "БЕЛОК - ВСЕГДА ПЛЮС" in prompt
    assert f"РОВНО {SUMMARY_MIN_SENTENCES}-{SUMMARY_MAX_SENTENCES} предложений" in prompt
    assert "Персона влияет только на тон формулировок summary_text" in prompt


def test_prompt_carries_the_day_it_is_about():
    prompt = _prompt("kind", meals=[_meal(8, calories=420.0, protein=31.0), _meal(19, calories=810.0, protein=54.0)])

    # The day, its totals and every dish are in the prompt: the model has no
    # other way to know what it is summarising.
    assert "3 окт 2026" in prompt
    assert "Итого за 3 окт 2026 (2 приёмов пищи)" in prompt
    assert "1230 ккал" in prompt
    assert "белки 85 г" in prompt
    assert "- 08:00: Блюдо в 8:00: 420 ккал" in prompt
    assert "- 19:00: Блюдо в 19:00: 810 ккал" in prompt


def test_prompt_reports_which_meals_it_left_out():
    meals = [_meal(hour) for hour in range(0, 24)]
    prompt = _prompt("kind", meals=meals)

    assert len(meals) > MAX_MEALS_IN_PROMPT
    assert f"(показаны последние {MAX_MEALS_IN_PROMPT} из {len(meals)} приёмов" in prompt
    # The totals still cover the whole day, so a truncated list cannot mislead.
    assert f"({len(meals)} приёмов пищи)" in prompt


def test_prompt_says_so_when_the_day_carries_no_meals():
    prompt = build_daily_summary_prompt(
        target_date=DAY,
        totals=_totals(),
        meals=[],
        user_goal=None,
        targets=None,
    )

    assert "0 приёмов пищи" in prompt
    assert "Дневные нормы пользователя не заданы" in prompt
    assert "не определена" in prompt


def test_prompt_uses_the_persona_and_its_custom_wording():
    custom = _prompt("custom")
    assert "Пользовательский стиль" in custom
    assert "дед" in custom

    # An unknown persona falls back to the default voice, rules intact.
    fallback = _prompt("joke-mode-that-does-not-exist")
    assert PERSONA_PROMPTS["kind"] in fallback
    assert "РОВНО 3-6 предложений" in fallback


# --- the stored recap obeys the rules ------------------------------------------

def test_validate_strips_emoji_and_clamps_length():
    result = _validate_daily_summary(
        {"summary_text": CHAOTIC_SUMMARY, "overall_score": 8.4}
    )
    summary = result["summary_text"]

    assert not EMOJI_PATTERN.search(summary)
    assert count_sentences(summary) <= SUMMARY_MAX_SENTENCES
    # it is a cut, not a rewrite: the opening judgement survives
    assert summary.startswith("День так себе.")
    assert result["overall_score"] == 8.4


def test_validate_leaves_a_compliant_recap_untouched():
    result = _validate_daily_summary(
        {"summary_text": GOOD_SUMMARY, "overall_score": 7.5}
    )

    assert result["summary_text"] == GOOD_SUMMARY
    assert SUMMARY_MIN_SENTENCES <= count_sentences(GOOD_SUMMARY) <= SUMMARY_MAX_SENTENCES


def test_validate_normalises_a_zero_to_one_score():
    """Models answer 0-1 or 1-10 for the same judgement; both must print as 1-10."""
    result = _validate_daily_summary({"summary_text": GOOD_SUMMARY, "overall_score": 0.78})
    assert result["overall_score"] == pytest.approx(7.8)


def test_validate_clamps_an_out_of_range_score():
    assert _validate_daily_summary({"summary_text": GOOD_SUMMARY, "overall_score": 42})["overall_score"] == 10.0
    assert _validate_daily_summary({"summary_text": GOOD_SUMMARY, "overall_score": -3})["overall_score"] == 1.0


def test_validate_rejects_a_recap_that_is_only_emoji():
    with pytest.raises(ValueError, match="empty after removing emoji"):
        _validate_daily_summary({"summary_text": "😋🔥🥩", "overall_score": 7.0})


def test_validate_rejects_a_recap_without_text():
    with pytest.raises(ValueError, match="Missing required field: summary_text"):
        _validate_daily_summary({"overall_score": 7.0})


def test_validate_rejects_a_recap_without_a_score():
    with pytest.raises(ValueError, match="Missing required field: overall_score"):
        _validate_daily_summary({"summary_text": GOOD_SUMMARY})


def test_empty_prose_is_not_a_recap():
    with pytest.raises(ValueError, match="non-empty string"):
        _validate_daily_summary({"summary_text": "   ", "overall_score": 7.0})


# --- day bookkeeping -----------------------------------------------------------

@pytest.mark.asyncio
async def test_totals_are_summed_by_the_database():
    """The figures are arithmetic, so the query is what has to be right."""
    session = _StubSession(_FakeResult(row=_row(meals_count=2, calories=1230.0, protein_g=85.0)))

    totals = await load_day_totals(session, user_id=7, target_date=DAY)

    assert totals["meals_count"] == 2
    assert totals["calories"] == 1230.0
    assert totals["protein_g"] == 85.0

    sql = str(session.statements[0])
    # The day is summed in SQL over the analysed meals of that user and day, so a
    # figure can only be wrong if the query is wrong.
    assert "sum(meals.calories)" in sql
    assert "sum(meals.protein_g)" in sql
    assert "count(meals.id)" in sql
    assert "meals.user_id" in sql
    assert "meals.eaten_at" in sql
    assert "meals.status" in sql


@pytest.mark.asyncio
async def test_a_day_without_figures_reads_as_zero():
    """coalesce, not None: a day with no analysed meal is still a day of zeros."""
    session = _StubSession(
        _FakeResult(row=_row(meals_count=0, calories=0, protein_g=0, fat_g=None))
    )

    totals = await load_day_totals(session, user_id=7, target_date=DAY)

    assert totals["calories"] == 0.0
    assert totals["protein_g"] == 0.0
    assert totals["fat_g"] == 0.0


@pytest.mark.asyncio
async def test_response_carries_the_exact_day_totals():
    session = _StubSession(
        _FakeResult(scalar=_stored_recap()),
        _FakeResult(row=_row(meals_count=3, calories=2410.0, protein_g=164.0, fat_g=95.0)),
    )
    user = SimpleNamespace(id=7)

    payload = await get_or_create_daily_summary(session, user, DAY)

    assert payload["available"] is True
    assert payload["summary_text"] == GOOD_SUMMARY
    # The numbers a client renders next to the recap come from the same sums the
    # prompt was given, so the two can never disagree.
    assert payload["totals"]["calories"] == 2410.0
    assert payload["totals"]["protein_g"] == 164.0


@pytest.mark.asyncio
async def test_totals_are_answered_even_when_there_is_no_recap():
    """An empty card still carries the day's exact figures."""
    session = _StubSession(
        _FakeResult(scalar=None),
        _FakeResult(row=_row(meals_count=1, calories=530.0)),
    )
    user = SimpleNamespace(id=7)

    payload = await get_or_create_daily_summary(session, user, local_day_of(utcnow(), 0))

    assert payload["available"] is False
    assert payload["reason"] == REASON_DAY_NOT_FINISHED
    assert payload["totals"]["calories"] == 530.0


@pytest.mark.asyncio
async def test_a_day_with_nothing_eaten_sums_to_nothing():
    """A meal whose macros were never analysed contributes nothing, and stays a number."""
    session = _StubSession(
        _FakeResult(row=_row(meals_count=1, calories=0, protein_g=0, fat_g=0, carbs_g=0)),
    )

    totals = await load_day_totals(session, user_id=7, target_date=DAY)

    assert totals["meals_count"] == 1
    assert all(isinstance(totals[key], float) for key in ("calories", "protein_g", "fat_g", "carbs_g"))


def test_prompt_forbids_the_model_from_writing_figures():
    """The recap speaks about the day; the numbers are the database's job."""
    for persona in sorted(PERSONA_PROMPTS):
        prompt = _prompt(persona)

        assert "НИ ОДНОЙ ЦИФРЫ В summary_text" in prompt
        # The exact sums are still context - without them the model cannot say
        # whether the day was over its norms.
        assert "посчитано точно по базе" in prompt


def test_meal_times_are_read_in_the_clients_own_clock():
    """A 23:00 UTC meal eaten at UTC+3 belongs to the next local morning."""
    meal = _meal(23)
    utc_prompt = build_daily_summary_prompt(
        target_date=DAY, totals=_totals(meals_count=1), meals=[meal], tz_offset_minutes=0
    )
    # UTC+3 arrives as -180 (Date.getTimezoneOffset counts minutes behind UTC).
    local_prompt = build_daily_summary_prompt(
        target_date=DAY, totals=_totals(meals_count=1), meals=[meal], tz_offset_minutes=-180
    )

    assert "- 23:00: Блюдо в 23:00" in utc_prompt
    assert "- 02:00: Блюдо в 23:00" in local_prompt


def test_reason_for_a_day_that_has_not_finished_is_about_tomorrow():
    assert "завтра" in REASON_DAY_NOT_FINISHED


def test_day_label_is_the_readable_date():
    from app.services.ai_summary import day_label

    assert day_label(date(2026, 10, 3)) == "3 окт 2026"
    assert day_label(date(2026, 12, 31)) == "31 дек 2026"


def test_meal_window_covers_the_whole_local_day():
    """The recap must see the same meals the day view shows, offset included."""
    from app.services.nutrition import day_bounds_utc

    # UTC+3 arrives as -180 (minutes behind UTC), so local midnight is 21:00Z of
    # the previous day.
    start, end = day_bounds_utc(DAY, DAY, -180)

    assert start == datetime(2026, 10, 2, 21, 0, tzinfo=timezone.utc)
    assert end == datetime(2026, 10, 3, 20, 59, 59, 999999, tzinfo=timezone.utc)
    # 00:30 and 23:30 local are inside the window; a UTC-only window would drop
    # both of them.
    assert start < datetime(2026, 10, 2, 21, 30, tzinfo=timezone.utc) < end
    assert start < datetime(2026, 10, 3, 20, 30, tzinfo=timezone.utc) < end