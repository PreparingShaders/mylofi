"""Contracts for AI Synergy - cross-analysis of nutrition and workouts."""

from datetime import date
from typing import List, Optional, Dict, Any, Literal

from pydantic import BaseModel, Field, field_validator

from app.schemas import UsageLimitEntry, UtcDateTime


class AISynergyRequest(BaseModel):
    """Request for AI synergy analysis.

    Optionally takes average sleep hours over the period, plus a period
    selection: either `period_days` (e.g. 14 or 30) or an explicit date range
    (`start_date` / `end_date`) for a custom window.
    """
    avg_sleep_hours: Optional[float] = Field(None, ge=4.0, le=12.0)
    period_days: Optional[int] = Field(None, ge=1, le=90)
    start_date: Optional[date] = None
    end_date: Optional[date] = None

    @field_validator("end_date")
    @classmethod
    def _end_not_before_start(cls, v: Optional[date], info) -> Optional[date]:
        start = info.data.get("start_date")
        if v is not None and start is not None and v < start:
            raise ValueError("end_date must be on or after start_date")
        return v


FindingTone = Literal["success", "warning", "risk"]


class AISynergyFinding(BaseModel):
    """One finding line rendered in the synergy modal.

    `tone` drives the icon and colour: the backend classifies each
    finding instead of the frontend guessing from keywords.
    """
    text: str
    tone: FindingTone = "warning"


class AISynergyVerdict(BaseModel):
    """Verdict from AI synergy analysis."""
    headline: str
    overall_score: float
    key_findings: List[AISynergyFinding]
    growth_points: List[AISynergyFinding]
    risk_factors: List[AISynergyFinding]
    nutrition_adjustment: str
    workout_adjustment: str
    ai_persona: Optional[str] = None


class AISynergyResponse(BaseModel):
    """Response for AI synergy analysis."""
    success: bool = True
    analyzed_at: UtcDateTime
    period_days: int = 14
    period_type: str = "week"
    metrics_snapshot: Dict[str, Any]
    verdict: AISynergyVerdict
    limit: Optional[UsageLimitEntry] = None
    reason: Optional[str] = None


class AISynergySavedResponse(BaseModel):
    """Response for fetching a previously saved synergy report.

    `available` mirrors the daily-summary contract: a stored report is an
    object, a missing one is `available: false` plus a reason, so the
    frontend renders the same two-state slot either way.
    """
    available: bool = False
    analyzed_at: Optional[UtcDateTime] = None
    period_days: Optional[int] = None
    period_type: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    metrics_snapshot: Optional[Dict[str, Any]] = None
    verdict: Optional[AISynergyVerdict] = None
    reason: Optional[str] = None
