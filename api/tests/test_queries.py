"""Tests for the hand-written analytics queries in db/queries/.

These run before any endpoint wraps them. Shape assertions (row counts,
columns) catch breakage; the invariant assertions below are the ones that
catch *wrong maths* — a query can return 753 tidy rows of nonsense.

The strongest test here is `test_moving_average_matches_independent_python`:
it recomputes the moving average from raw closes in Python and compares. If
the SQL LATERAL logic is subtly wrong, that is what will catch it.
"""

from __future__ import annotations

import statistics

import math
from statistics import fmean

import psycopg
import pytest

from app import sql


@pytest.fixture(scope="module")
def conn(owner_url: str):
    with psycopg.connect(owner_url) as c:
        yield c


def q(conn, name, **params):
    return sql.fetch_all(conn, name, params)


# ---------------------------------------------------------------------------
# Loader
# ---------------------------------------------------------------------------

def test_all_queries_are_discoverable() -> None:
    found = set(sql.available())
    expected = {
        "assets", "price_history", "sector_performance", "sector_index",
        "asset_risk_metrics", "correlation_matrix", "best_worst_periods",
        "moving_averages",
    }
    assert expected <= found, f"missing queries: {expected - found}"


def test_loader_rejects_path_traversal() -> None:
    with pytest.raises(ValueError):
        sql.load("../../db/001_schema")


# ---------------------------------------------------------------------------
# assets / price_history
# ---------------------------------------------------------------------------

def test_assets_covers_the_universe(conn, universe) -> None:
    rows = q(conn, "assets")
    assert len(rows) == universe["count"]
    assert {r["sector"] for r in rows} == {
        *universe["sectors"]
    }
    assert all(r["bar_count"] >= universe["min_bars"] for r in rows), "an asset has too little history"


def test_price_history_is_ordered_and_filterable(conn) -> None:
    rows = q(conn, "price_history", ticker="AAPL", start=None, end=None)
    assert len(rows) > 700
    dates = [r["date"] for r in rows]
    assert dates == sorted(dates), "price history must be returned in date order"
    assert len(set(dates)) == len(dates), "duplicate dates in price history"

    window = q(conn, "price_history", ticker="AAPL",
               start=dates[10], end=dates[20])
    assert len(window) == 11
    assert window[0]["date"] == dates[10] and window[-1]["date"] == dates[20]


def test_price_history_is_parameterised_not_interpolated(conn) -> None:
    """A hostile ticker must be treated as a value, never as SQL."""
    rows = q(conn, "price_history",
             ticker="AAPL'; DROP TABLE market.price_history; --",
             start=None, end=None)
    assert rows == []
    # The table is still there.
    assert q(conn, "assets")


# ---------------------------------------------------------------------------
# Sector queries
# ---------------------------------------------------------------------------

def test_sector_performance_annualises_by_asset_type(conn, universe) -> None:
    """Crypto trades daily, equities ~252 days/year. The observation counts
    are the visible proof the split factor is applied."""
    rows = {r["sector"]: r for r in q(conn, "sector_performance", window_days=365)}
    assert len(rows) == len(universe["sectors"])

    crypto = rows["Crypto"]
    equity = rows["Information Technology"]
    assert crypto["observations"] > 350, "crypto should have ~365 obs in a 365d window"
    assert 240 <= equity["observations"] <= 260, "equities should have ~252 obs"
    assert crypto["annualized_volatility"] > equity["annualized_volatility"]


def test_sector_performance_return_is_geometric_not_summed(conn) -> None:
    """Recompute total_return by compounding sector_index and compare."""
    perf = {r["sector"]: r for r in q(conn, "sector_performance", window_days=365)}
    series = q(conn, "sector_index", window_days=365)

    by_sector: dict[str, list[float]] = {}
    for row in series:
        by_sector.setdefault(row["sector"], []).append(row["equal_weighted_return"])

    for sector, returns in by_sector.items():
        compounded = math.prod(1.0 + r for r in returns) - 1.0
        assert compounded == pytest.approx(perf[sector]["total_return"], rel=1e-6), (
            f"{sector}: total_return is not the geometric product of its daily returns"
        )
        summed = sum(returns)
        if abs(summed - compounded) > 1e-4:
            assert perf[sector]["total_return"] != pytest.approx(summed, rel=1e-9), (
                f"{sector}: total_return equals the naive SUM of returns"
            )


def test_sector_index_is_rebased_to_100_at_window_start(conn) -> None:
    rows = q(conn, "sector_index", window_days=365)
    first_by_sector: dict[str, float] = {}
    for row in rows:
        first_by_sector.setdefault(row["sector"], row["indexed_value"])
    for sector, value in first_by_sector.items():
        assert value == pytest.approx(100.0), f"{sector} not rebased to 100"


# ---------------------------------------------------------------------------
# Risk metrics
# ---------------------------------------------------------------------------

def test_asset_risk_metrics_ranking_is_consistent(conn, universe) -> None:
    rows = q(conn, "asset_risk_metrics", window_days=365)
    assert len(rows) == universe["count"]

    vols = [r["annualized_volatility"] for r in rows]
    assert vols == sorted(vols, reverse=True), "rows must be ordered by volatility desc"
    assert [r["volatility_rank"] for r in rows] == list(range(1, universe["count"] + 1))
    assert all(v > 0 for v in vols), "volatility must be positive"
    assert all(-1.0 <= r["max_drawdown"] <= 0.0 for r in rows), (
        "max drawdown must be a non-positive fraction"
    )


def test_return_per_unit_risk_is_consistent_with_its_components(conn) -> None:
    for row in q(conn, "asset_risk_metrics", window_days=365):
        expected = row["annualized_return"] / row["annualized_volatility"]
        assert row["return_per_unit_risk"] == pytest.approx(expected, rel=1e-9)


def test_crypto_is_the_high_volatility_block(conn) -> None:
    """A domain sanity check on the shape of the distribution.

    This compared min(crypto) against max(equity) while the universe was 16
    assets and every equity was a mega-cap. At 105 it is simply false - AMD
    runs hotter than TRX - and it was false about the market, not about the
    code, so its own docstring would have misdiagnosed it as an annualisation
    bug. Medians survive the universe growing; the tails do not.
    """
    rows = q(conn, "asset_risk_metrics", window_days=365)
    crypto = sorted(r["annualized_volatility"] for r in rows if r["asset_type"] == "crypto")
    equity = sorted(r["annualized_volatility"] for r in rows if r["asset_type"] == "stock")

    assert statistics.median(crypto) > 1.8 * statistics.median(equity)
    # The very top of the volatility ranking should still be crypto.
    hottest = sorted(rows, key=lambda r: -r["annualized_volatility"])[:3]
    assert all(r["asset_type"] == "crypto" for r in hottest)


# ---------------------------------------------------------------------------
# Correlation
# ---------------------------------------------------------------------------

def test_correlation_matrix_is_square_symmetric_with_unit_diagonal(conn, universe) -> None:
    rows = q(conn, "correlation_matrix", window_days=365, tickers=None)
    matrix = {(r["ticker_a"], r["ticker_b"]): r["correlation"] for r in rows}
    tickers = sorted({r["ticker_a"] for r in rows})

    assert len(tickers) == universe["count"]
    assert len(rows) == universe["count"] ** 2, "expected a full square matrix"

    for t in tickers:
        assert matrix[(t, t)] == pytest.approx(1.0), f"diagonal {t} is not 1.0"

    for a in tickers:
        for b in tickers:
            assert matrix[(a, b)] == pytest.approx(matrix[(b, a)], abs=1e-12), (
                f"matrix is not symmetric at ({a},{b})"
            )

    assert all(-1.0 <= v <= 1.0 for v in matrix.values())


def test_correlation_respects_ticker_filter(conn) -> None:
    subset = ["AAPL", "MSFT", "BTC"]
    rows = q(conn, "correlation_matrix", window_days=365, tickers=subset)
    assert {r["ticker_a"] for r in rows} == set(subset)
    assert len(rows) == 9


def test_correlation_uses_only_common_trading_days(conn) -> None:
    """Crypto trades weekends; equities do not. A crypto/equity pair must be
    computed over the intersection of their dates, not padded."""
    rows = q(conn, "correlation_matrix", window_days=365, tickers=["AAPL", "BTC"])
    by_pair = {(r["ticker_a"], r["ticker_b"]): r for r in rows}

    aapl_obs = by_pair[("AAPL", "AAPL")]["observations"]
    btc_obs = by_pair[("BTC", "BTC")]["observations"]
    cross_obs = by_pair[("AAPL", "BTC")]["observations"]

    assert btc_obs > aapl_obs, "crypto should have more observations than equities"
    assert cross_obs == aapl_obs, (
        "cross-asset correlation must use the intersection of trading days"
    )


# ---------------------------------------------------------------------------
# Best / worst periods
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("granularity", ["day", "week", "month"])
def test_best_worst_periods_are_ranked_correctly(conn, granularity: str) -> None:
    rows = q(conn, "best_worst_periods", ticker="NVDA",
             granularity=granularity, window_days=1095, n=3)
    best = [r for r in rows if r["kind"] == "best"]
    worst = [r for r in rows if r["kind"] == "worst"]

    assert len(best) == 3 and len(worst) == 3
    assert [r["rank"] for r in best] == [1, 2, 3]
    assert [r["period_return"] for r in best] == sorted(
        [r["period_return"] for r in best], reverse=True
    )
    assert [r["period_return"] for r in worst] == sorted(
        [r["period_return"] for r in worst]
    )
    assert min(r["period_return"] for r in best) > max(
        r["period_return"] for r in worst
    ), "best periods must all beat worst periods"


def test_monthly_period_return_compounds_daily_returns(conn) -> None:
    """Recompute one month's return from its daily returns."""
    rows = q(conn, "best_worst_periods", ticker="NVDA",
             granularity="month", window_days=1095, n=1)
    target = rows[0]

    daily = q(conn, "price_history", ticker="NVDA",
              start=target["first_date"], end=target["last_date"])
    assert len(daily) == target["observations"]

    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT dr.simple_return FROM market.daily_returns dr
            JOIN market.assets a ON a.id = dr.asset_id
            WHERE a.ticker = 'NVDA' AND dr.date BETWEEN %s AND %s
            ORDER BY dr.date
            """,
            (target["first_date"], target["last_date"]),
        )
        returns = [r[0] for r in cur.fetchall()]

    compounded = math.prod(1.0 + r for r in returns) - 1.0
    assert compounded == pytest.approx(target["period_return"], rel=1e-9)


# ---------------------------------------------------------------------------
# Moving averages — the strongest correctness test in this file
# ---------------------------------------------------------------------------

def test_moving_average_matches_independent_python(conn) -> None:
    """Recompute the SMA from raw closes and compare to what SQL produced.

    A window frame bound cannot be parameterised, so the query uses a LATERAL
    with LIMIT instead. That is exactly the kind of substitution that can be
    subtly wrong (off-by-one on the trailing window, or including future
    bars), so it is verified against a plain Python implementation.
    """
    windows = [20, 50, 200]
    rows = q(conn, "moving_averages", ticker="AAPL",
             windows=windows, window_days=365)

    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT p.date, COALESCE(p.adj_close, p.close)::double precision
            FROM market.price_history p
            JOIN market.assets a ON a.id = p.asset_id
            WHERE a.ticker = 'AAPL' ORDER BY p.date
            """
        )
        history = cur.fetchall()

    closes_by_date = {d: c for d, c in history}
    ordered_dates = [d for d, _ in history]
    position = {d: i for i, d in enumerate(ordered_dates)}

    checked = 0
    for row in rows:
        idx = position[row["date"]]
        size = row["window_size"]
        window_dates = ordered_dates[max(0, idx - size + 1): idx + 1]
        expected = fmean(closes_by_date[d] for d in window_dates)

        assert row["avg_close"] == pytest.approx(expected, rel=1e-9), (
            f"{size}-day SMA wrong on {row['date']}"
        )
        assert row["bars_used"] == len(window_dates)
        assert row["is_partial"] == (len(window_dates) < size)
        checked += 1

    assert checked > 700, "expected ~251 dates x 3 windows"


def test_moving_average_uses_full_history_not_just_the_window(conn) -> None:
    """A 200-day average at the start of a 365-day chart must be computed from
    the 200 bars preceding it, including bars outside the chart window."""
    rows = q(conn, "moving_averages", ticker="AAPL",
             windows=[200], window_days=365)
    first = min(rows, key=lambda r: r["date"])
    assert first["bars_used"] == 200, (
        "moving average was truncated to the display window"
    )
    assert first["is_partial"] is False


def test_moving_average_ramp_up_is_flagged_partial(conn) -> None:
    """At the very start of history there are fewer than `window_size` bars.

    The earlier tests all use a 365-day display window, which sits well inside
    3 years of history and therefore never reaches this branch - so it needed
    its own case with a window wide enough to touch the first bar.
    """
    rows = q(conn, "moving_averages", ticker="AAPL",
             windows=[200], window_days=1200)
    partial = [r for r in rows if r["is_partial"]]
    full = [r for r in rows if not r["is_partial"]]

    assert partial and full, "expected both partial and complete averages"
    assert len(partial) == 199, "ramp-up should be window_size - 1 bars"

    ordered = sorted(partial, key=lambda r: r["date"])
    assert ordered[0]["bars_used"] == 1
    assert [r["bars_used"] for r in ordered] == list(range(1, 200)), (
        "bars_used must increase by exactly one per bar during ramp-up"
    )
    # The first bar's average is just that bar's close.
    assert ordered[0]["avg_close"] == pytest.approx(ordered[0]["close"])


# ---------------------------------------------------------------------------
# The restricted roles must be able to run every analytics query
# ---------------------------------------------------------------------------

def test_every_query_runs_under_the_readonly_api_role(env) -> None:
    api_url = env.get("DATABASE_URL_API")
    if not api_url:
        pytest.skip("DATABASE_URL_API not configured")

    cases = {
        "assets": {},
        "price_history": {"ticker": "AAPL", "start": None, "end": None},
        "sector_performance": {"window_days": 365},
        "sector_index": {"window_days": 365},
        "asset_risk_metrics": {"window_days": 365},
        "correlation_matrix": {"window_days": 365, "tickers": None},
        "best_worst_periods": {"ticker": "AAPL", "granularity": "month",
                               "window_days": 365, "n": 2},
        "moving_averages": {"ticker": "AAPL", "windows": [20], "window_days": 90},
    }
    with psycopg.connect(api_url) as c:
        for name, params in cases.items():
            assert sql.fetch_all(c, name, params) is not None, name
