"""Target energy (KBZhU) and macro calculation.

The baseline energy expenditure uses the Mifflin-St Jeor equation, which is the
formula the Profile form previews live and the API persists. The JS mirror in
``static/js/utils.js`` (``Utils.calculateKBZhU``) implements the same constants
so the preview and the stored targets never disagree.
"""
from dataclasses import dataclass
from typing import Optional

import math

ACTIVITY_FACTORS = {
    "sedentary": 1.2,
    "light": 1.375,
    "moderate": 1.55,
    "active": 1.725,
    "athlete": 1.9,
}
DEFAULT_ACTIVITY_LEVEL = "moderate"

GOAL_CALORIE_FACTORS = {
    "lose": 0.85,
    "maintain": 1.0,
    "gain": 1.15,
}
DEFAULT_GOAL = "maintain"

GENDER_BMR_OFFSETS = {
    "male": 5.0,
    "female": -161.0,
}

# Protein keeps muscle mass up on a cut and stays ample on a bulk; fat takes a
# fixed share of the energy budget and carbs absorb the remainder.
PROTEIN_GRAMS_PER_KG = {
    "lose": 2.0,
    "maintain": 1.8,
    "gain": 1.8,
}
FAT_CALORIE_RATIO = 0.25

KCAL_PER_G = {"protein": 4, "fat": 9, "carbs": 4}

AGE_MIN, AGE_MAX = 10, 100
HEIGHT_MIN_CM, HEIGHT_MAX_CM = 100.0, 250.0
WEIGHT_MIN_KG, WEIGHT_MAX_KG = 30.0, 300.0

__all__ = [
    "ACTIVITY_FACTORS",
    "DEFAULT_ACTIVITY_LEVEL",
    "GOAL_CALORIE_FACTORS",
    "DEFAULT_GOAL",
    "GENDER_BMR_OFFSETS",
    "PROTEIN_GRAMS_PER_KG",
    "FAT_CALORIE_RATIO",
    "AGE_MIN",
    "AGE_MAX",
    "HEIGHT_MIN_CM",
    "HEIGHT_MAX_CM",
    "WEIGHT_MIN_KG",
    "WEIGHT_MAX_KG",
    "MacroTargets",
    "normalize_gender",
    "normalize_activity_level",
    "normalize_goal",
    "calculate_macro_targets",
]


@dataclass(frozen=True)
class MacroTargets:
    """Daily energy and macro targets derived from the anthropometrics."""

    bmr: float
    tdee: float
    calories: int
    protein_g: float
    fat_g: float
    carbs_g: float


def normalize_gender(value: Optional[str]) -> Optional[str]:
    """Map a stored gender string onto ``male`` / ``female``."""
    if value is None:
        return None
    value = str(value).strip().lower()
    if value in ("m", "male", "man", "муж", "мужской", "мужчина"):
        return "male"
    if value in ("f", "female", "woman", "жен", "женский", "женщина"):
        return "female"
    return None


def normalize_activity_level(value: Optional[str]) -> str:
    """Fall back to a moderate activity level for unknown stored values."""
    if value is None:
        return DEFAULT_ACTIVITY_LEVEL
    value = str(value).strip().lower()
    return value if value in ACTIVITY_FACTORS else DEFAULT_ACTIVITY_LEVEL


def normalize_goal(value: Optional[str]) -> str:
    """Fall back to weight maintenance for unknown stored goals."""
    if value is None:
        return DEFAULT_GOAL
    value = str(value).strip().lower()
    return value if value in GOAL_CALORIE_FACTORS else DEFAULT_GOAL


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _round_half_up(value: float) -> int:
    """Round halves away from zero, matching JS ``Math.round``.

    Python's built-in ``round`` is banker's rounding, so 372.5 would become 372
    here and 373 in the browser. Using one rule on both sides keeps the live
    preview and the persisted targets identical.
    """
    return int(math.floor(value + 0.5)) if value >= 0 else -int(math.floor(-value + 0.5))


def calculate_macro_targets(
    weight_kg: Optional[float],
    height_cm: Optional[float],
    age: Optional[int],
    gender: Optional[str],
    activity_level: Optional[str] = None,
    goal: Optional[str] = None,
) -> Optional[MacroTargets]:
    """Mifflin-St Jeor BMR -> TDEE -> goal-adjusted calories and macros.

    Returns ``None`` when weight, height, age, or a recognized gender is
    missing, since the formula cannot be evaluated without all four.
    """
    if weight_kg is None or height_cm is None or age is None:
        return None

    resolved_gender = normalize_gender(gender)
    if resolved_gender is None:
        return None

    weight = _clamp(float(weight_kg), WEIGHT_MIN_KG, WEIGHT_MAX_KG)
    height = _clamp(float(height_cm), HEIGHT_MIN_CM, HEIGHT_MAX_CM)
    years = int(_clamp(float(age), AGE_MIN, AGE_MAX))
    activity = normalize_activity_level(activity_level)
    target = normalize_goal(goal)

    bmr = 10.0 * weight + 6.25 * height - 5.0 * years + GENDER_BMR_OFFSETS[resolved_gender]
    bmr = max(bmr, 0.0)

    tdee = bmr * ACTIVITY_FACTORS[activity]
    calories = _round_half_up(tdee * GOAL_CALORIE_FACTORS[target])

    protein = _round_half_up(weight * PROTEIN_GRAMS_PER_KG[target])
    fat = _round_half_up(calories * FAT_CALORIE_RATIO / KCAL_PER_G["fat"])
    # Carbs close the gap the protein and fat shares leave, but never below a
    # 10% floor, so rounding can never produce an incoherent split.
    carbs = _round_half_up(
        (calories - protein * KCAL_PER_G["protein"] - fat * KCAL_PER_G["fat"]) / KCAL_PER_G["carbs"]
    )
    carbs = max(carbs, _round_half_up(calories * 0.1 / KCAL_PER_G["carbs"]))

    return MacroTargets(
        bmr=_round_half_up(bmr),
        tdee=_round_half_up(tdee),
        calories=calories,
        protein_g=float(protein),
        fat_g=float(fat),
        carbs_g=float(carbs),
    )
