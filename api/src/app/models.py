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


class SparklineSeries(BaseModel):
    """One asset's price shape, downsampled to weekly closes.

    Carries no per-point dates: a sparkline is shape over a stated span, and
    135 assets x 52 points of ISO date strings is four times the payload of the
    numbers they label. `start_date` and `end_date` say what the span is.
    """

    ticker: str
    start_date: date
    end_date: date
    closes: list[float]


class CorrelationCell(BaseModel):
    ticker_a: str
    ticker_b: str
    correlation: float | None
    observations: int


class CorrelationMatrix(BaseModel):
    window_days: int
    tickers: list[str]
    cells: list[CorrelationCell]


class SectorCorrelationCell(BaseModel):
    """One cell of the sector grid, plus the strongest pair inside it.

    `top_*` costs nothing to produce - the pairwise correlations are already in
    hand - and it means a caller that wants one interesting pair to plot does
    not have to pull the whole 135x135 matrix to find it.
    """

    sector_a: str
    sector_b: str
    correlation: float | None
    pairs: int
    top_ticker_a: str | None
    top_ticker_b: str | None
    top_correlation: float | None


class SectorCorrelationMatrix(BaseModel):
    window_days: int
    sectors: list[str]
    cells: list[SectorCorrelationCell]


class RollingCorrelationPoint(BaseModel):
    """One trailing window, with the uncertainty on its estimate.

    `ci_low`/`ci_high` are the 95 per cent Fisher z interval for `correlation`
    given `observations` shared trading days. They are asymmetric around the
    estimate by construction, and a floor on the real uncertainty rather than a
    measurement of it: Fisher assumes bivariate normal, independent returns,
    and daily returns are neither. Null when the window is too short (n <= 3)
    to have an interval at all.
    """

    date: date
    correlation: float | None
    observations: int
    ci_low: float | None
    ci_high: float | None


class RollingCorrelation(BaseModel):
    """Correlation between one pair, as a series rather than a summary.

    `span_correlation` is the single figure the heatmap shows for this pair over
    the same span, carried so the chart can draw it as a reference line. The
    distance between that line and the series is the whole point of the view:
    it is how much the one number is hiding.
    """

    ticker_a: str
    ticker_b: str
    window_days: int
    span_days: int
    span_correlation: float | None
    points: list[RollingCorrelationPoint]


class DistributionBucket(BaseModel):
    """One bar of the return histogram, measured in standard deviations.

    Edges are given in both units: `z_low`/`z_high` so the same normal curve
    overlays every asset, `return_low`/`return_high` so the axis can be
    labelled in per cent, which is the unit a reader thinks in. A null edge
    means unbounded - the outer two buckets hold everything past +/- 4 sd.
    """

    bucket: int
    z_low: float | None
    z_high: float | None
    return_low: float | None
    return_high: float | None
    days: int


class TailRisk(BaseModel):
    """What a volatility figure leaves out about the days that produced it.

    `beyond_2sd`/`beyond_3sd` are counts of actual days; `expected_beyond_*`
    are what a normal distribution of the same width predicts over the same
    number of days. The gap between them is the fat tail, stated without
    requiring the reader to know what kurtosis is.

    `total_return_without_best_5` recomputes the window with its five largest
    days removed, in log space where a total return is a sum. It is the most
    concrete measure of concentration available: a year of gains often lives
    in a week of it.
    """

    observations: int
    mean_daily_return: float | None
    daily_volatility: float | None
    skewness: float | None
    excess_kurtosis: float | None
    beyond_2sd: int
    beyond_3sd: int
    expected_beyond_2sd: float
    expected_beyond_3sd: float
    best_return: float | None
    best_date: date | None
    worst_return: float | None
    worst_date: date | None
    total_return: float | None
    total_return_without_best_5: float | None
    total_return_without_worst_5: float | None


class ReturnDistribution(BaseModel):
    ticker: str
    window_days: int
    observations: int
    mean_daily_return: float | None
    daily_volatility: float | None
    buckets: list[DistributionBucket]
    tail: TailRisk


class BetaOut(BaseModel):
    """One asset's fit against the equal-weighted index of its own market.

    `market` names what the beta is against, and is not decoration: this
    universe holds three of them, in two currencies, and a beta quoted without
    its benchmark is not a number anyone can use.

    `beta_low`/`beta_high` are the ordinary 95 per cent regression interval,
    symmetric because beta is unbounded. `r_squared` is the share of the
    asset's daily variation the market accounts for, and it is the figure that
    says whether the beta means anything: the same slope through a tight cloud
    and a diffuse one are very different claims.
    """

    ticker: str
    name: str
    sector: str
    asset_type: Literal["stock", "crypto"]
    market: str
    observations: int
    beta: float | None
    beta_low: float | None
    beta_high: float | None
    market_correlation: float | None
    r_squared: float | None
    idiosyncratic_share: float | None
    alpha_annualized: float | None


class BetaPoint(BaseModel):
    date: date
    asset_return: float
    market_return: float


class BetaFit(BaseModel):
    """The regression plus the cloud it was fitted to."""

    fit: BetaOut
    points: list[BetaPoint]


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
