"""Pydantic response models.

Money is stored as `numeric` in Postgres and arrives as `Decimal`. These models
declare `float`, so Pydantic coerces on the way out: JSON has no decimal type,
and every consumer of these fields is a chart. The exact values remain in the
database; only the wire representation is lossy, and only at a precision far
below anything a price chart can express.
"""

from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import BaseModel, Field, field_validator


class HealthResponse(BaseModel):
    status: Literal["ok", "degraded"]
    database: bool
    asset_count: int | None = None
    price_rows: int | None = None
    latest_bar: date | None = None
    stale_days: int | None = Field(
        None, description="Calendar days between the latest bar and today."
    )
    pools: dict = Field(default_factory=dict)
    detail: str | None = None


class AssetOut(BaseModel):
    ticker: str
    name: str
    asset_type: Literal["stock", "crypto"]
    sector: str
    currency: str
    bar_count: int
    first_date: date | None
    last_date: date | None


class PriceBar(BaseModel):
    date: date
    open: float | None
    high: float | None
    low: float | None
    close: float
    adj_close: float | None
    volume: float | None


class PriceSeries(BaseModel):
    ticker: str
    bars: list[PriceBar]


class SectorPerformanceOut(BaseModel):
    sector: str
    start_date: date
    end_date: date
    observations: int
    asset_count: int
    total_return: float | None
    annualized_return: float | None
    annualized_volatility: float | None
    return_per_unit_risk: float | None


class SectorIndexPoint(BaseModel):
    sector: str
    date: date
    equal_weighted_return: float | None
    indexed_value: float


class AssetRiskMetricOut(BaseModel):
    ticker: str
    name: str
    sector: str
    asset_type: Literal["stock", "crypto"]
    observations: int
    start_date: date
    end_date: date
    total_return: float | None
    annualized_return: float | None
    annualized_volatility: float | None
    return_per_unit_risk: float | None
    max_drawdown: float | None
    avg_volume: float | None
    volatility_rank: int


class CorrelationCell(BaseModel):
    ticker_a: str
    ticker_b: str
    correlation: float | None
    observations: int


class CorrelationMatrix(BaseModel):
    window_days: int
    tickers: list[str]
    cells: list[CorrelationCell]


class PeriodOut(BaseModel):
    period_start: date
    first_date: date
    last_date: date
    observations: int
    period_return: float
    kind: Literal["best", "worst"]
    rank: int


class MovingAveragePoint(BaseModel):
    date: date
    close: float
    window_size: int
    avg_close: float
    bars_used: int
    is_partial: bool


class MovingAverageSeries(BaseModel):
    ticker: str
    windows: list[int]
    points: list[MovingAveragePoint]


# Conversation memory is bounded on two axes because it is billed on two axes.
# A turn cap alone lets one enormous pasted table through; a character cap alone
# lets a hundred short turns through. Both are enforced, and the history is
# TRIMMED to fit rather than rejected: a long conversation should keep working
# with a shorter memory, not start failing.
MAX_HISTORY_TURNS = 12
MAX_HISTORY_CHARS = 12_000


class Turn(BaseModel):
    """One prior message in the conversation, as the client remembers it."""

    role: Literal["user", "assistant"]
    content: str = Field(..., min_length=1, max_length=4_000)


class QueryRequest(BaseModel):
    question: str = Field(
        ...,
        min_length=3,
        max_length=1000,
        description="A natural-language question about the market data.",
        examples=["Which sector had the highest volatility last year?"],
    )
    history: list[Turn] = Field(
        default_factory=list,
        description=(
            "Prior turns, oldest first, so follow-up questions can refer back. "
            f"Trimmed to the most recent {MAX_HISTORY_TURNS} turns and "
            f"{MAX_HISTORY_CHARS} characters."
        ),
    )

    @field_validator("history")
    @classmethod
    def _bound_history(cls, turns: list[Turn]) -> list[Turn]:
        kept: list[Turn] = []
        budget = MAX_HISTORY_CHARS
        # Walk backwards: the turns nearest the question are the ones a
        # follow-up is most likely to be referring to.
        for turn in reversed(turns[-MAX_HISTORY_TURNS:]):
            budget -= len(turn.content)
            if budget < 0:
                break
            kept.append(turn)
        kept.reverse()
        # The Messages API requires the conversation to open with a user turn,
        # and trimming can easily cut one off mid-exchange.
        while kept and kept[0].role != "user":
            kept.pop(0)
        return kept


class QueryAttempt(BaseModel):
    """One candidate SQL string and its fate.

    Surfaced so a user can see what was tried and, when the guard intervened,
    that it did - the security boundary is a feature, not an implementation
    detail to hide.
    """

    sql: str
    accepted: bool
    rejection: str | None = None
    error: str | None = None
    row_count: int | None = None
    elapsed_ms: int | None = None


class QueryResponse(BaseModel):
    question: str
    answer: str
    sql: str | None = Field(None, description="The SQL that produced the answer.")
    columns: list[str] = Field(default_factory=list)
    rows: list[list] = Field(default_factory=list)
    row_count: int = 0
    truncated: bool = Field(False, description="True if the row cap was hit.")
    attempts: list[QueryAttempt] = Field(default_factory=list)
    model: str
    model_calls: int
    elapsed_ms: int
    model_ms: int = Field(
        0, description="Time spent waiting on the model, of elapsed_ms."
    )
    usage: dict[str, int] = Field(default_factory=dict)
