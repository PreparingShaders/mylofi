"""Mock checks for the AI-Synergy cross-analysis rules in app/services/ai_synergy_service.py.

No network and no database: the prompt builder is pure text, so these assert
that the prompt states the rules for every persona, carries the custom persona
text for "custom", mandates causal analysis, and enforces the JSON contract
with strict tone adherence.
"""

import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

from app.services.ai_synergy_service import (  # noqa: E402
    DEFAULT_PERSONA,
    PERSONA_PROMPTS as SYNERGY_PERSONA_PROMPTS,
    REQUIRED_FIELDS,
    SYNERGY_RATE_LIMIT_DAYS,
    VALID_TONES,
    _calibrate_synergy_score,
    _check_synergy_rate_limit,
    _normalise_finding,
    _resolve_period_type,
    _synergy_score_ceiling,
    _validate_synergy,
    build_synergy_prompt,
)
from app.services.ai_vision import (  # noqa: E402
    MAX_PERSONA_TEXT_CHARS,
    PERSONA_PROMPTS,
    normalize_persona,
)

CUSTOM_TEXT = "Разговаривай, как дед, который любит внуков, но всё равно доложи по цифрам."


def _user(**overrides):
    fields = {
        "id": 7,
        "goal": "gain",
        "activity_level": "moderate",
        "weight_kg": 80.0,
        "target_calories": 2800,
        "target_protein_g": 160.0,
        "ai_persona": "kind",
        "ai_persona_custom_text": None,
    }
    fields.update(overrides)
    return SimpleNamespace(**fields)


def _aggregated(days=14):
    return {
        "user_profile": {
            "goal": "gain",
            "activity_level": "moderate",
            "weight_kg": 80.0,
            "target_weight_kg": 84.0,
            "target_calories": 2800,
            "target_protein_g": 160.0,
        },
        "period_summary": {
            "days_analyzed": days,
            "nutrition": {
                "avg_daily_calories": 2600,
                "avg_daily_protein_g": 150,
                "avg_daily_carbs_g": 300,
                "avg_daily_fat_g": 90,
                "calorie_target_adherence_pct": 92.8,
                "protein_target_adherence_pct": 93.7,
                "avg_meal_quality_score": 7.5,
                "meals_logged_count": 60,
            },
            "workouts": {
                "total_workouts": 8,
                "avg_workout_duration_min": 65.0,
                "total_tonnage_kg": 12000,
                "tonnage_trend_pct": 3.5,
                "muscle_groups_hit": {"Грудь": 4, "Спина": 4},
                "avg_rpe": 7.2,
            },
            "lifestyle": {"avg_sleep_hours": 7.5},
        },
    }


def _prompt(persona, custom_text=None, aggregated=None, sleep=7.5):
    if aggregated is None:
        aggregated = _aggregated()
    return build_synergy_prompt(
        user=_user(
            ai_persona=persona,
            ai_persona_custom_text=custom_text,
        ),
        aggregated=aggregated,
        avg_sleep_hours=sleep,
    )


# --- prompt states the contract ----------------------------------------------

REQUIRED_PROMPT_SUBSTRINGS = [
    "verdict_headline",
    "overall_score",
    "key_findings",
    "growth_points",
    "risk_factors",
    "nutrition_adjustment",
    "workout_adjustment",
    "tone",
    "success",
    "warning",
    "risk",
    "JSON",
    "1–10",
    "10 слов",
]


def test_prompt_declares_all_required_fields():
    prompt = _prompt("kind")
    for field in REQUIRED_FIELDS:
        assert f'"{field}"' in prompt


def test_prompt_declares_strict_json_format():
    prompt = _prompt("kind")
    assert "Формат ответа (строго валидный JSON)" in prompt
    assert "Ответ должен быть только валидным JSON без комментариев" in prompt


@pytest.mark.parametrize("field", REQUIRED_PROMPT_SUBSTRINGS)
def test_prompt_contains_contract_keywords(field):
    prompt = _prompt("kind")
    assert field in prompt


def test_prompt_carries_the_score_instructions():
    prompt = _prompt("kind")
    assert "=== ИНСТРУКЦИИ ПО ОЦЕНКЕ (overall_score) ===" in prompt
    assert "1–2" in prompt
    assert "3–4" in prompt
    assert "5–6" in prompt
    assert "НИКОГДА не ставь 8–10" in prompt


def test_prompt_mandates_causal_analysis():
    prompt = _prompt("kind")
    assert "причинно-следственн" in prompt
    assert "тоннаж" in prompt
    assert "RPE" in prompt
    assert "2–4 недели" in prompt


def test_prompt_mentions_sleep_in_causal_analysis():
    prompt = _prompt("kind", sleep=6.5)
    assert "6.5 часов" in prompt


def test_prompt_references_days_analyzed():
    prompt = _prompt("kind", aggregated=_aggregated(days=21))
    assert "21 дней" in prompt


# --- persona handling --------------------------------------------------------

def test_prompt_carries_persona_for_every_known_persona():
    for persona_key in PERSONA_PROMPTS:
        prompt = _prompt(persona_key)
        assert SYNERGY_PERSONA_PROMPTS[persona_key] in prompt


def test_prompt_uses_custom_text_for_custom_persona():
    prompt = _prompt("custom", custom_text=CUSTOM_TEXT)
    assert "Пользовательский стиль" in prompt
    assert CUSTOM_TEXT in prompt


def test_prompt_does_not_inject_custom_text_for_non_custom_persona():
    prompt = _prompt("kind", custom_text=CUSTOM_TEXT)
    assert "Пользовательский стиль" not in prompt
    assert CUSTOM_TEXT not in prompt


def test_prompt_sanitizes_custom_text():
    messy = "  Разговаривай.\n\nКак  дед.   "
    prompt = _prompt("custom", custom_text=messy)
    assert "Пользовательский стиль" in prompt
    assert "Разговаривай. Как дед." in prompt


def test_prompt_truncates_oversized_custom_text():
    long_text = "A" * (MAX_PERSONA_TEXT_CHARS + 500)
    prompt = _prompt("custom", custom_text=long_text)
    assert "Пользовательский стиль" in prompt
    assert f'"{long_text}"' not in prompt


def test_prompt_falls_back_to_default_for_unknown_persona():
    prompt = _prompt("joke-mode-that-does-not-exist")
    assert SYNERGY_PERSONA_PROMPTS[DEFAULT_PERSONA] in prompt


def test_prompt_persona_line_explains_scope():
    prompt = _prompt("kind")
    assert "Персона влияет только на тон формулировок" in prompt
    assert "JSON-контракта" in prompt


def test_normalize_persona_returns_custom_key():
    assert normalize_persona("custom") == "custom"


def test_normalize_persona_falls_back_to_default():
    assert normalize_persona(None) == DEFAULT_PERSONA
    assert normalize_persona("") == DEFAULT_PERSONA
    assert normalize_persona("unknown") == DEFAULT_PERSONA


# --- tone validation ---------------------------------------------------------

def test_valid_tones_are_only_success_warning_risk():
    assert set(VALID_TONES) == {"success", "warning", "risk"}


def test_normalise_finding_strips_invalid_tone():
    item = {"text": "Finding", "tone": "info"}
    result = _normalise_finding(item)
    assert result["tone"] == "warning"
    assert result["text"] == "Finding"


def test_normalise_finding_lowercases_valid_tone():
    item = {"text": "Finding", "tone": "SUCCESS"}
    result = _normalise_finding(item)
    assert result["tone"] == "success"


def test_normalise_finding_handles_plain_string():
    result = _normalise_finding("Just a string")
    assert result["tone"] == "warning"
    assert result["text"] == "Just a string"


def test_normalise_finding_strips_emoji():
    result = _normalise_finding({"text": "Great 💪 lifting", "tone": "success"})
    assert "💪" not in result["text"]
    assert result["text"] == "Great lifting"


# --- validate synergy --------------------------------------------------------

def _valid_synergy_payload():
    return {
        "verdict_headline": "Good",
        "overall_score": 7.5,
        "key_findings": [],
        "growth_points": [],
        "risk_factors": [],
        "nutrition_adjustment": "Eat more.",
        "workout_adjustment": "Lift more.",
    }


def test_validate_synergy_accepts_valid_payload():
    result = _validate_synergy(_valid_synergy_payload())
    assert result["overall_score"] == 7.5
    assert result["verdict_headline"] == "Good"


def test_validate_synergy_rejects_missing_field():
    payload = _valid_synergy_payload()
    del payload["verdict_headline"]
    with pytest.raises(ValueError, match="Missing required field"):
        _validate_synergy(payload)


def test_validate_synergy_normalises_zero_to_one_score():
    payload = _valid_synergy_payload()
    payload["overall_score"] = 0.8
    result = _validate_synergy(payload)
    assert result["overall_score"] == pytest.approx(8.0)


def test_validate_synergy_strips_emoji_from_findings():
    payload = _valid_synergy_payload()
    payload["key_findings"] = [{"text": "Finding 🎉", "tone": "success"}]
    result = _validate_synergy(payload)
    assert "🎉" not in result["key_findings"][0]["text"]
    assert result["key_findings"][0]["text"] == "Finding"


def test_validate_synergy_normalises_invalid_tone_in_findings():
    payload = _valid_synergy_payload()
    payload["key_findings"] = [{"text": "Finding", "tone": "info"}]
    result = _validate_synergy(payload)
    assert result["key_findings"][0]["tone"] == "warning"


def test_validate_synergy_clamps_findings_to_ten():
    payload = _valid_synergy_payload()
    payload["key_findings"] = [{"text": f"Finding {i}", "tone": "success"} for i in range(15)]
    result = _validate_synergy(payload)
    assert len(result["key_findings"]) == 10


# --- rate limiting -----------------------------------------------------------

def test_rate_limit_is_disabled_in_dev():
    assert SYNERGY_RATE_LIMIT_DAYS == 0


def test_rate_limit_allows_when_disabled():
    now = datetime.now(timezone.utc)
    recent = SimpleNamespace(
        created_at=now - timedelta(days=3),
    )
    _check_synergy_rate_limit(recent)


def test_rate_limit_allows_when_no_prior_analysis():
    _check_synergy_rate_limit(None)


# --- period type resolution --------------------------------------------------

def test_resolve_period_type_week():
    assert _resolve_period_type(14, None, None) == "week"


def test_resolve_period_type_month():
    assert _resolve_period_type(30, None, None) == "month"


def test_resolve_period_type_custom_range():
    start = date(2026, 9, 1)
    end = date(2026, 10, 15)
    assert _resolve_period_type(None, start, end) == "custom"


def test_resolve_period_type_month_range():
    start = date(2026, 9, 1)
    end = date(2026, 9, 30)
    assert _resolve_period_type(None, start, end) == "month"


# --- score ceiling & calibration ---------------------------------------------

def test_score_ceiling_critical_deficit():
    agg = _aggregated()
    agg["user_profile"]["target_calories"] = 2800
    agg["period_summary"]["nutrition"]["avg_daily_calories"] = 1800  # ~36% deficit
    assert _synergy_score_ceiling(agg) == 2


def test_score_ceiling_strong_deficit():
    agg = _aggregated()
    agg["user_profile"]["target_calories"] = 2800
    agg["period_summary"]["nutrition"]["avg_daily_calories"] = 2100  # ~25% deficit
    assert _synergy_score_ceiling(agg) == 4


def test_score_ceiling_excellent():
    agg = _aggregated()
    agg["period_summary"]["nutrition"]["avg_daily_calories"] = 2800
    agg["period_summary"]["nutrition"]["avg_daily_protein_g"] = 170
    agg["period_summary"]["workouts"]["tonnage_trend_pct"] = 5.0
    agg["period_summary"]["lifestyle"]["avg_sleep_hours"] = 8
    assert _synergy_score_ceiling(agg) == 10


def test_score_ceiling_good_balance():
    agg = _aggregated()
    agg["period_summary"]["nutrition"]["avg_daily_calories"] = 2700  # ~3.6% deficit
    agg["period_summary"]["nutrition"]["avg_daily_protein_g"] = 170  # 2.125 g/kg
    agg["period_summary"]["workouts"]["tonnage_trend_pct"] = 2.0
    assert _synergy_score_ceiling(agg) == 7


def test_score_ceiling_hard_cap_on_gain_low_protein():
    agg = _aggregated()
    agg["period_summary"]["nutrition"]["avg_daily_protein_g"] = 100  # 1.25 g/kg for gain
    assert _synergy_score_ceiling(agg) <= 7


def test_calibrate_clamps_to_ceiling():
    agg = _aggregated()
    agg["user_profile"]["target_calories"] = 2800
    agg["period_summary"]["nutrition"]["avg_daily_calories"] = 1800  # critical deficit
    calibrated = _calibrate_synergy_score(9.5, agg)
    assert calibrated <= 2


def test_calibrate_allows_high_score_for_excellent():
    agg = _aggregated()
    agg["period_summary"]["nutrition"]["avg_daily_calories"] = 2800
    agg["period_summary"]["nutrition"]["avg_daily_protein_g"] = 170
    agg["period_summary"]["workouts"]["tonnage_trend_pct"] = 5.0
    agg["period_summary"]["lifestyle"]["avg_sleep_hours"] = 8
    calibrated = _calibrate_synergy_score(9.5, agg)
    assert calibrated == 9.5
