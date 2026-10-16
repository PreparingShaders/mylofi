"""Mock checks for the ai_verdict rules in app/services/ai_vision.py.

No network: the model is replaced by a canned answer, so these assert the two
halves of the contract - the prompt states the five rules for every persona, and
the stored verdict obeys them even when the model ignores them.
"""

import json
import re
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

from app.services.ai_vision import (  # noqa: E402
    EMOJI_PATTERN,
    PERSONA_PROMPTS,
    VERDICT_MAX_SENTENCES,
    VERDICT_MIN_SENTENCES,
    _extract_json_object,
    _parse_llm_json,
    _sanitize_verdict,
    _validate_analysis,
    build_prompt,
    count_sentences,
)

TARGETS = {
    "target_calories": 2000,
    "target_protein_g": 150,
    "target_fat_g": 70,
    "target_carbs_g": 220,
}
BALANCE = {"calories": 1200, "protein_g": 80, "fat_g": 40, "carbs_g": 140}

# A model that ignored the brief: emoji, a wall of text, and macro digits.
CHAOTIC_VERDICT = (
    "🥩 Отличный стейк! 😍 Белка выше нормы — красавчик! "
    "Калорийность блюда 720 ккал, белка 62 г. "
    "Жиры выше нормы, это превышение на 18 г. "
    "Углеводы в норме. "
    "Добавь овощи. "
    "Пей воду. "
    "Не жарь в панике. "
    "Сахар не перебарчивай. "
    "Соль в меру. "
    "Жарь на сильном огне. "
    "Отдыхай. "
    "Повтори завтра."
)

GOOD_VERDICT = (
    "Стейк из говядины с овощами гриль — плотный, сытный и с понятным составом. "
    "Белок в этой порции выше дневной отметки, и это отличная новость для мышц и для сытости. "
    "Жиры и калории самые высокие за сегодня, поэтому дальше лучше строить день вокруг овощей и белка. "
    "Овощи здесь несут основную клетчатку, и её стоит оставить, а не заменить гарниром. "
    "Соль стоит пробовать аккуратно, особенно если гарнир тоже солёный. "
    "Как улучшение: добавь свежие овощи к этому блюду и не заправляй его дополнительным маслом."
)

MOCK_ANALYSIS = {
    "dish_name": "Стейк из говядины с овощами гриль",
    "calories": 720.0,
    "protein_g": 62.0,
    "fat_g": 48.0,
    "carbs_g": 14.0,
    "fiber_g": 6.0,
    "sugar_g": 5.0,
    "sodium_mg": 640.0,
    "tags": ["стейк", "мясо", "овощи гриль"],
    "quality_score": 8.6,
    "quality_metrics": [
        {"label": "Белок", "score": 9.5},
        {"label": "Клетчатка", "score": 6.0},
        {"label": "Обработка", "score": 7.0},
    ],
    "ai_verdict": CHAOTIC_VERDICT,
}


def _prompt(persona: str) -> str:
    return build_prompt(
        user_goal="lose",
        targets=TARGETS,
        current_balance=BALANCE,
        user_notes="стейк средней прожарки, овощи гриль",
        persona=persona,
        persona_custom_text="Разговаривай как дед, который любит внуков." if persona == "custom" else None,
    )


# --- rule coverage in the prompt ------------------------------------------------

@pytest.mark.parametrize("persona", sorted(PERSONA_PROMPTS))
def test_prompt_carries_all_five_rules(persona):
    prompt = _prompt(persona)

    # 1. zero emojis - stated as a rule, and the prompt ships none of its own
    assert "НОЛЬ ЭМОДЗИ" in prompt
    assert not EMOJI_PATTERN.search(prompt)

    # 2. dish-analysis focus, numbers stay in the JSON fields
    assert "НОЛЬ ЦИФР МАКРОСОВ" in prompt
    assert "внутренний расчёт" in prompt
    assert "сытость" in prompt
    assert "соответствие цели" in prompt

    # 3. protein surplus is praise, never a scolding
    assert "БЕЛОК - ВСЕГДА ПЛЮС" in prompt
    assert "превышение белка никогда не подаётся как ошибка" in prompt
    assert "мышц" in prompt and "сытости" in prompt

    # 5. exact length
    assert f"РОВНО {VERDICT_MIN_SENTENCES}-{VERDICT_MAX_SENTENCES} предложений" in prompt
    assert f'"{VERDICT_MIN_SENTENCES}-{VERDICT_MAX_SENTENCES}' not in prompt
    assert '"ai_verdict": "Оценка нутрициолога РОВНО из 5-7' in prompt

    # the persona never overrides any of the above
    assert "Персона влияет только на тон формулировок ai_verdict" in prompt
    assert "все правила оценки выше действуют в полном объёме" in prompt


def test_prompt_no_longer_tells_the_model_to_quote_macro_numbers():
    """The old brief demanded "превышение на 240 ккал"; that must be gone."""
    prompt = _prompt("strict")
    old_rule = "превышение на 240 ккал"
    rule_line = next(line for line in prompt.splitlines() if old_rule in line)
    assert "запрещено" in rule_line
    assert "белок больше нормы на 18 г" in rule_line

    # the numeric figures themselves are still handed over for the internal maths
    assert "Дневные нормы: 2000 ккал" in prompt
    assert "белки 80 г" in prompt


def test_sarcastic_persona_is_dry_british_wit_not_an_insult():
    sarcastic = PERSONA_PROMPTS["sarcastic"]
    assert "Джарвиса" in sarcastic
    assert "английским юмором" in sarcastic
    assert "на блюдо" in sarcastic
    # explicitly not aimed at the user
    assert "насмешек над пользователем" in sarcastic
    assert "сарказма в его адрес" in sarcastic


def test_persona_unknown_falls_back_but_keeps_the_rules():
    prompt = _prompt("joke-mode-that-does-not-exist")
    assert PERSONA_PROMPTS["kind"] in prompt
    assert "РОВНО 5-7 предложений" in prompt


# --- the mock meal analysis ----------------------------------------------------

def test_mock_verdict_within_length_keeps_every_sentence():
    assert VERDICT_MIN_SENTENCES <= count_sentences(GOOD_VERDICT) <= VERDICT_MAX_SENTENCES


def test_sanitize_strips_emoji_and_clamps_length():
    sanitized = _sanitize_verdict(CHAOTIC_VERDICT)

    assert not EMOJI_PATTERN.search(sanitized)
    assert count_sentences(sanitized) <= VERDICT_MAX_SENTENCES
    # it is a cut, not a rewrite: the opening judgement survives
    assert sanitized.startswith("Отличный стейк!")


def test_sanitize_leaves_a_compliant_verdict_untouched():
    assert _sanitize_verdict(GOOD_VERDICT) == GOOD_VERDICT


def test_sanitize_keeps_short_verdicts_short():
    short = "Салат с курицей. Белка достаточно."
    assert _sanitize_verdict(short) == short


def test_sanitize_cuts_a_ramble_on_a_sentence_end():
    """A chatty answer is cut at a full stop, never mid-sentence."""
    rambling = " ".join(f"Замечание номер {i} о составе блюда." for i in range(1, 15))
    sanitized = _sanitize_verdict(rambling)
    assert count_sentences(sanitized) == VERDICT_MAX_SENTENCES
    assert sanitized.endswith("Замечание номер 7 о составе блюда.")


def test_sanitize_does_not_split_a_punctuation_less_run():
    """No sentence ends to cut on, so nothing is thrown away mid-thought."""
    rambling = " ".join(f"Мысль номер {i}" for i in range(1, 15))
    assert _sanitize_verdict(rambling) == rambling


def test_validate_analysis_sanitizes_the_stored_verdict():
    result = _validate_analysis(dict(MOCK_ANALYSIS))
    verdict = result["ai_verdict"]

    assert not EMOJI_PATTERN.search(verdict)
    assert count_sentences(verdict) <= VERDICT_MAX_SENTENCES
    assert verdict.startswith("Отличный стейк!")
    # the numeric payload is untouched - only the prose verdict was rewritten
    assert result["calories"] == 720.0
    assert result["protein_g"] == 62.0
    assert result["quality_score"] == 8.6


def test_validate_analysis_rejects_a_verdict_that_is_only_emoji():
    payload = dict(MOCK_ANALYSIS, ai_verdict="😋🔥🥩")
    with pytest.raises(ValueError, match="empty after removing emoji"):
        _validate_analysis(payload)


def test_validate_analysis_still_requires_a_verdict():
    payload = dict(MOCK_ANALYSIS)
    del payload["ai_verdict"]
    with pytest.raises(ValueError, match="Missing required field"):
        _validate_analysis(payload)


# --- JSON extraction from a chatty free model ----------------------------------

def test_parse_accepts_fenced_json():
    raw = "```json\n" + json.dumps(MOCK_ANALYSIS, ensure_ascii=False) + "\n```"
    assert _parse_llm_json(raw)["dish_name"] == MOCK_ANALYSIS["dish_name"]


def test_parse_recovers_json_wrapped_in_prose():
    raw = "Конечно! Вот разбор блюда:\n" + json.dumps(MOCK_ANALYSIS, ensure_ascii=False) + "\nПриятного аппетита."
    assert _parse_llm_json(raw)["protein_g"] == 62.0


def test_extract_json_object_returns_none_without_an_object():
    assert _extract_json_object("извините, я не смог разобрать фото") is None


def test_parse_still_raises_on_unparsable_text():
    with pytest.raises(json.JSONDecodeError):
        _parse_llm_json("наверное это салат")


# --- a prompt is prose, not a template: no stray markup -----------------------

def test_prompt_has_no_unrendered_braces():
    prompt = _prompt("kind")
    assert "{" in prompt and "}" in prompt
    # the JSON sample in the prompt must be real JSON, not a doubled-brace template
    assert "{{" not in prompt and "}}" not in prompt
    assert re.search(r'"quality_metrics": \[\s*{', prompt)