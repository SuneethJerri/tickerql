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

from pydantic import BaseModel, Field


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
