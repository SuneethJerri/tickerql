"""Endpoint tests.

The maths is already covered by test_queries.py against the SQL directly. These
tests cover what the HTTP layer adds: parameter validation, error mapping,
response shape, and the guarantee that two endpoints sharing a query really do
return the same numbers.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


# ---------------------------------------------------------------------------
# Meta
# ---------------------------------------------------------------------------

def test_health_reports_freshness_not_just_liveness(client, universe) -> None:
    body = client.get("/api/health").json()
    assert body["database"] is True
    assert body["asset_count"] == universe["count"]
    assert body["price_rows"] > 12000
    # A reachable database full of stale prices is a broken platform, so the
    # endpoint has to surface staleness explicitly.
    assert body["stale_days"] is not None
    assert body["status"] == ("ok" if body["stale_days"] <= 7 else "degraded")


def test_openapi_documents_every_endpoint(client) -> None:
    paths = client.get("/openapi.json").json()["paths"]
    expected = {
        "/api/health", "/api/assets", "/api/prices/{ticker}",
        "/api/analytics/sector-performance", "/api/analytics/sector-index",
        "/api/analytics/volatility", "/api/analytics/risk-return",
        "/api/analytics/correlation", "/api/analytics/periods",
        "/api/analytics/moving-averages/{ticker}",
    }
    assert expected <= set(paths)


def test_cors_is_restricted_to_configured_origins(client) -> None:
    allowed = client.get("/api/assets", headers={"Origin": "http://localhost:5173"})
    assert allowed.headers.get("access-control-allow-origin") == "http://localhost:5173"

    # An arbitrary origin must not be echoed back.
    hostile = client.get("/api/assets", headers={"Origin": "https://evil.example"})
    assert hostile.headers.get("access-control-allow-origin") != "https://evil.example"


# ---------------------------------------------------------------------------
# Universe and prices
# ---------------------------------------------------------------------------

def test_assets_endpoint(client, universe) -> None:
    rows = client.get("/api/assets").json()
    assert len(rows) == universe["count"]
    assert {r["sector"] for r in rows} == {
        *universe["sectors"]
    }
    assert all(r["bar_count"] >= universe["min_bars"] for r in rows)


def test_prices_returns_ordered_bars(client) -> None:
    body = client.get("/api/prices/AAPL").json()
    assert body["ticker"] == "AAPL"
    dates = [b["date"] for b in body["bars"]]
    assert dates == sorted(dates)
    assert len(dates) > 700


def test_prices_ticker_is_case_insensitive(client) -> None:
    assert client.get("/api/prices/aapl").json()["ticker"] == "AAPL"


def test_prices_unknown_ticker_is_404_not_empty(client) -> None:
    """An empty series reads as 'no data for this asset'. A missing asset is a
    different thing and must say so."""
    r = client.get("/api/prices/NOPE")
    assert r.status_code == 404
    assert "NOPE" in r.json()["detail"]


def test_prices_date_range_filters(client) -> None:
    body = client.get("/api/prices/AAPL", params={"start": "2025-01-02", "end": "2025-01-31"}).json()
    dates = [b["date"] for b in body["bars"]]
    assert dates and all("2025-01-02" <= d <= "2025-01-31" for d in dates)


def test_prices_rejects_inverted_range(client) -> None:
    r = client.get("/api/prices/AAPL", params={"start": "2025-06-01", "end": "2025-01-01"})
    assert r.status_code == 400


def test_hostile_ticker_is_rejected_not_executed(client) -> None:
    r = client.get("/api/prices/AAPL'; DROP TABLE market.price_history; --")
    assert r.status_code in (404, 422)
    assert client.get("/api/assets").json(), "table should be intact"


# ---------------------------------------------------------------------------
# Sector endpoints
# ---------------------------------------------------------------------------

def test_sector_performance(client, universe) -> None:
    rows = client.get("/api/analytics/sector-performance", params={"window": 365}).json()
    assert len(rows) == len(universe["sectors"])
    by_sector = {r["sector"]: r for r in rows}
    assert by_sector["Crypto"]["observations"] > by_sector["Information Technology"]["observations"], (
        "crypto trades daily and must have more observations than equities"
    )


def test_sector_index_starts_at_100(client) -> None:
    rows = client.get("/api/analytics/sector-index", params={"window": 365}).json()
    first: dict[str, float] = {}
    for row in rows:
        first.setdefault(row["sector"], row["indexed_value"])
    assert all(v == pytest.approx(100.0) for v in first.values())


def test_window_bounds_are_enforced(client) -> None:
    assert client.get("/api/analytics/sector-index", params={"window": 0}).status_code == 422
    assert client.get("/api/analytics/sector-index", params={"window": 99999}).status_code == 422


# ---------------------------------------------------------------------------
# Risk metrics
# ---------------------------------------------------------------------------

def test_volatility_is_ranked_descending(client, universe) -> None:
    rows = client.get("/api/analytics/volatility", params={"window": 365}).json()
    vols = [r["annualized_volatility"] for r in rows]
    assert vols == sorted(vols, reverse=True)
    assert [r["volatility_rank"] for r in rows] == list(range(1, universe["count"] + 1))


def test_volatility_and_risk_return_agree(client) -> None:
    """Both endpoints wrap one query, so their numbers must be identical. If
    these ever diverge, someone has introduced a second definition of
    volatility."""
    a = client.get("/api/analytics/volatility", params={"window": 365}).json()
    b = client.get("/api/analytics/risk-return", params={"window": 365}).json()
    assert {r["ticker"]: r["annualized_volatility"] for r in a} == {
        r["ticker"]: r["annualized_volatility"] for r in b
    }


def test_unsupported_metric_window_is_rejected_with_guidance(client) -> None:
    """asset_metrics is materialized for 30/90/365 only. Any other window would
    return an empty list, which looks like 'no data' rather than 'bad input'."""
    r = client.get("/api/analytics/volatility", params={"window": 200})
    assert r.status_code == 400
    assert "30" in r.json()["detail"] and "365" in r.json()["detail"]


@pytest.mark.parametrize("window", [30, 90, 365])
def test_supported_metric_windows_all_return_data(client, window: int, universe) -> None:
    rows = client.get("/api/analytics/volatility", params={"window": window}).json()
    assert len(rows) == universe["count"]


# ---------------------------------------------------------------------------
# Correlation
# ---------------------------------------------------------------------------

def test_correlation_full_matrix_is_symmetric(client, universe) -> None:
    body = client.get("/api/analytics/correlation", params={"window": 365}).json()
    assert len(body["tickers"]) == universe["count"]
    cells = {(c["ticker_a"], c["ticker_b"]): c["correlation"] for c in body["cells"]}
    assert len(cells) == universe["count"] ** 2
    for (a, b), v in cells.items():
        assert v == pytest.approx(cells[(b, a)], abs=1e-12)
        if a == b:
            assert v == pytest.approx(1.0)


def test_correlation_subset(client) -> None:
    body = client.get(
        "/api/analytics/correlation", params={"window": 365, "tickers": "AAPL,btc"}
    ).json()
    assert body["tickers"] == ["AAPL", "BTC"]
    assert len(body["cells"]) == 4


def test_correlation_unknown_ticker_is_404(client) -> None:
    r = client.get("/api/analytics/correlation", params={"tickers": "AAPL,FAKE"})
    assert r.status_code == 404
    assert "FAKE" in r.json()["detail"]


# ---------------------------------------------------------------------------
# Periods
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("granularity", ["day", "week", "month"])
def test_periods(client, granularity: str) -> None:
    rows = client.get(
        "/api/analytics/periods",
        params={"ticker": "NVDA", "granularity": granularity, "window": 1095, "n": 3},
    ).json()
    best = [r for r in rows if r["kind"] == "best"]
    worst = [r for r in rows if r["kind"] == "worst"]
    assert len(best) == 3 and len(worst) == 3
    assert min(r["period_return"] for r in best) > max(r["period_return"] for r in worst)


def test_periods_rejects_bad_granularity(client) -> None:
    r = client.get(
        "/api/analytics/periods", params={"ticker": "NVDA", "granularity": "fortnight"}
    )
    assert r.status_code == 422


def test_periods_n_is_bounded(client) -> None:
    assert client.get(
        "/api/analytics/periods", params={"ticker": "NVDA", "n": 0}
    ).status_code == 422
    assert client.get(
        "/api/analytics/periods", params={"ticker": "NVDA", "n": 999}
    ).status_code == 422


# ---------------------------------------------------------------------------
# Moving averages
# ---------------------------------------------------------------------------

def test_moving_averages_default_windows(client) -> None:
    body = client.get("/api/analytics/moving-averages/AAPL").json()
    assert body["windows"] == [20, 50, 200]
    assert {p["window_size"] for p in body["points"]} == {20, 50, 200}


def test_moving_averages_custom_windows_are_deduplicated(client) -> None:
    body = client.get(
        "/api/analytics/moving-averages/AAPL", params={"windows": "10,10,30", "window": 90}
    ).json()
    assert body["windows"] == [10, 30]


@pytest.mark.parametrize(
    "windows", ["", "abc", "0", "501", "5,10,15,20,25,30"]
)
def test_moving_averages_rejects_bad_windows(client, windows: str) -> None:
    r = client.get(
        "/api/analytics/moving-averages/AAPL", params={"windows": windows}
    )
    assert r.status_code == 400


def test_moving_averages_flag_partial_points(client) -> None:
    """A 200-bar average near the start of history is computed from fewer bars
    and must say so rather than silently reporting a shorter average."""
    body = client.get(
        "/api/analytics/moving-averages/AAPL",
        params={"windows": "200", "window": 1200},
    ).json()
    partial = [p for p in body["points"] if p["is_partial"]]
    assert partial, "expected a ramp-up region"
    assert all(p["bars_used"] < 200 for p in partial)
