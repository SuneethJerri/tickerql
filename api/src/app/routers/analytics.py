"""Analytics endpoints.

Every endpoint is a thin wrapper over a named query in db/queries/. No SQL is
written here: the queries are tested independently, and keeping the HTTP layer
free of SQL means an endpoint change cannot quietly alter the maths.

Handlers are `def`, not `async def`, so FastAPI runs them in its threadpool
alongside synchronous psycopg. See app/db.py.
"""

from __future__ import annotations

import logging
from datetime import date
from typing import Annotated, Literal

import psycopg
from fastapi import APIRouter, HTTPException, Path, Query

from app import sql
from app.db import api_connection
from app.models import (
    AssetOut,
    AssetRiskMetricOut,
    CorrelationCell,
    CorrelationMatrix,
    MovingAveragePoint,
    MovingAverageSeries,
    PeriodOut,
    PriceBar,
    PriceSeries,
    SectorIndexPoint,
    SectorPerformanceOut,
)

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["analytics"])

# Bounds chosen so a request cannot ask the database for unbounded work.
WindowDays = Annotated[int, Query(ge=1, le=3650, description="Trailing window in days.")]
Ticker = Annotated[str, Path(min_length=1, max_length=20)]

# asset_metrics is materialized for exactly these windows; anything else would
# silently return no rows.
SUPPORTED_METRIC_WINDOWS = (30, 90, 365)


def _known_tickers(conn: psycopg.Connection) -> set[str]:
    with conn.cursor() as cur:
        cur.execute("SELECT ticker FROM market.assets WHERE is_active")
        return {row[0] for row in cur.fetchall()}


def _require_ticker(conn: psycopg.Connection, ticker: str) -> str:
    """Normalise and validate, returning a 404 for anything unknown.

    Without this an unknown ticker returns an empty series, which reads to a
    client as "this asset has no data" rather than "no such asset".
    """
    normalised = ticker.strip().upper()
    known = _known_tickers(conn)
    if normalised not in known:
        raise HTTPException(
            status_code=404,
            detail=f"Unknown ticker {ticker!r}. Known tickers: {', '.join(sorted(known))}",
        )
    return normalised


def _parse_int_list(raw: str, *, field: str, lo: int, hi: int, max_items: int) -> list[int]:
    items: list[int] = []
    for part in raw.split(","):
        part = part.strip()
        if not part:
            continue
        try:
            value = int(part)
        except ValueError:
            raise HTTPException(400, f"{field} must be a comma-separated list of integers")
        if not lo <= value <= hi:
            raise HTTPException(400, f"{field} values must be between {lo} and {hi}")
        if value not in items:
            items.append(value)
    if not items:
        raise HTTPException(400, f"{field} must contain at least one value")
    if len(items) > max_items:
        raise HTTPException(400, f"{field} accepts at most {max_items} values")
    return items


def _require_supported_window(window: int) -> int:
    if window not in SUPPORTED_METRIC_WINDOWS:
        raise HTTPException(
            400,
            f"window must be one of {', '.join(map(str, SUPPORTED_METRIC_WINDOWS))} "
            "(the windows precomputed in market.asset_metrics)",
        )
    return window


# ---------------------------------------------------------------------------
# Universe and raw prices
# ---------------------------------------------------------------------------

@router.get("/assets", response_model=list[AssetOut])
def list_assets() -> list[AssetOut]:
    """The tracked universe with per-asset coverage."""
    with api_connection() as conn:
        return [AssetOut(**row) for row in sql.fetch_all(conn, "assets")]


@router.get("/prices/{ticker}", response_model=PriceSeries)
def get_prices(
    ticker: Ticker,
    start: date | None = Query(None, description="Inclusive lower bound."),
    end: date | None = Query(None, description="Inclusive upper bound."),
) -> PriceSeries:
    """Daily OHLCV for one asset."""
    if start and end and start > end:
        raise HTTPException(400, "start must not be after end")
    with api_connection() as conn:
        resolved = _require_ticker(conn, ticker)
        rows = sql.fetch_all(
            conn, "price_history", {"ticker": resolved, "start": start, "end": end}
        )
    return PriceSeries(ticker=resolved, bars=[PriceBar(**r) for r in rows])


# ---------------------------------------------------------------------------
# Sector views
# ---------------------------------------------------------------------------

@router.get("/analytics/sector-performance", response_model=list[SectorPerformanceOut])
def sector_performance(window: WindowDays = 365) -> list[SectorPerformanceOut]:
    """Risk and return per sector over a trailing window."""
    with api_connection() as conn:
        rows = sql.fetch_all(conn, "sector_performance", {"window_days": window})
    return [SectorPerformanceOut(**r) for r in rows]


@router.get("/analytics/sector-index", response_model=list[SectorIndexPoint])
def sector_index(window: WindowDays = 365) -> list[SectorIndexPoint]:
    """Cumulative sector index, rebased to 100 at the start of the window."""
    with api_connection() as conn:
        rows = sql.fetch_all(conn, "sector_index", {"window_days": window})
    return [SectorIndexPoint(**r) for r in rows]


# ---------------------------------------------------------------------------
# Risk metrics — one query, two views
# ---------------------------------------------------------------------------

@router.get("/analytics/volatility", response_model=list[AssetRiskMetricOut])
def volatility_ranking(window: int = Query(90, description="30, 90 or 365.")) -> list[AssetRiskMetricOut]:
    """Assets ranked by annualised volatility, most volatile first."""
    _require_supported_window(window)
    with api_connection() as conn:
        rows = sql.fetch_all(conn, "asset_risk_metrics", {"window_days": window})
    return [AssetRiskMetricOut(**r) for r in rows]


@router.get("/analytics/risk-return", response_model=list[AssetRiskMetricOut])
def risk_return(window: int = Query(365, description="30, 90 or 365.")) -> list[AssetRiskMetricOut]:
    """Feed for the risk-vs-return scatter.

    Same rows as /analytics/volatility - one definition of volatility, two
    presentations.
    """
    _require_supported_window(window)
    with api_connection() as conn:
        rows = sql.fetch_all(conn, "asset_risk_metrics", {"window_days": window})
    return [AssetRiskMetricOut(**r) for r in rows]


# ---------------------------------------------------------------------------
# Correlation
# ---------------------------------------------------------------------------

@router.get("/analytics/correlation", response_model=CorrelationMatrix)
def correlation(
    window: WindowDays = 365,
    tickers: str | None = Query(
        None, description="Comma-separated subset; omit for the full matrix."
    ),
) -> CorrelationMatrix:
    """Pairwise correlation of daily returns.

    Cross-asset pairs are computed over the trading days both assets share, so
    a crypto/equity correlation is not diluted by equity weekends.
    """
    requested: list[str] | None = None
    if tickers:
        requested = [t.strip().upper() for t in tickers.split(",") if t.strip()]
        if not requested:
            raise HTTPException(400, "tickers must contain at least one symbol")

    with api_connection() as conn:
        if requested:
            known = _known_tickers(conn)
            unknown = [t for t in requested if t not in known]
            if unknown:
                raise HTTPException(404, f"Unknown ticker(s): {', '.join(unknown)}")
        rows = sql.fetch_all(
            conn, "correlation_matrix", {"window_days": window, "tickers": requested}
        )

    cells = [CorrelationCell(**r) for r in rows]
    return CorrelationMatrix(
        window_days=window,
        tickers=sorted({c.ticker_a for c in cells}),
        cells=cells,
    )


# ---------------------------------------------------------------------------
# Periods and moving averages
# ---------------------------------------------------------------------------

@router.get("/analytics/periods", response_model=list[PeriodOut])
def best_worst_periods(
    ticker: str = Query(..., description="Asset to analyse."),
    granularity: Literal["day", "week", "month"] = "month",
    window: WindowDays = 1095,
    n: int = Query(5, ge=1, le=50),
) -> list[PeriodOut]:
    """The n best and n worst periods for one asset."""
    with api_connection() as conn:
        resolved = _require_ticker(conn, ticker)
        rows = sql.fetch_all(
            conn,
            "best_worst_periods",
            {"ticker": resolved, "granularity": granularity, "window_days": window, "n": n},
        )
    return [PeriodOut(**r) for r in rows]


@router.get("/analytics/moving-averages/{ticker}", response_model=MovingAverageSeries)
def moving_averages(
    ticker: Ticker,
    windows: str = Query("20,50,200", description="Comma-separated bar counts."),
    window: WindowDays = 365,
) -> MovingAverageSeries:
    """Close price with simple moving averages.

    Averages are computed over full history and then trimmed to the display
    window, so the left edge of the chart is not calculated from a truncated
    series. `is_partial` flags points near the very start of history.
    """
    sizes = _parse_int_list(windows, field="windows", lo=2, hi=500, max_items=5)
    with api_connection() as conn:
        resolved = _require_ticker(conn, ticker)
        rows = sql.fetch_all(
            conn,
            "moving_averages",
            {"ticker": resolved, "windows": sizes, "window_days": window},
        )
    return MovingAverageSeries(
        ticker=resolved,
        windows=sizes,
        points=[MovingAveragePoint(**r) for r in rows],
    )
