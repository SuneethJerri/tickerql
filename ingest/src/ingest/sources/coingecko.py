"""CoinGecko: crypto close/volume and market capitalisation.

The keyless API refuses historical ranges beyond 365 days (error_code 10012),
and a Demo key raises rate limits without lifting that cap. It therefore
cannot supply the 2-3 years of crypto history this project needs; yfinance
does. CoinGecko is kept for market cap, a cross-check of recent closes, and
the daily refresh.

`/market_chart/range` carries no open/high/low, so bars from here have close
and volume only.
"""

from __future__ import annotations

import logging
from datetime import UTC, date, datetime, timedelta

import httpx

from ingest.retry import request_with_backoff
from ingest.sources import Bar, ProbeResult

log = logging.getLogger(__name__)

BASE = "https://api.coingecko.com/api/v3"
MAX_HISTORY_DAYS = 365  # hard limit of the free tier; see module docstring


class CoinGeckoSource:
    name = "coingecko"

    def __init__(self, api_key: str | None = None) -> None:
        self.api_key = api_key

    def _headers(self) -> dict[str, str]:
        return {"x-cg-demo-api-key": self.api_key} if self.api_key else {}

    def fetch_range(
        self, coingecko_id: str, start: date, end: date
    ) -> tuple[list[Bar], list[tuple[date, float]]]:
        """Return (bars, market_caps) for one coin.

        Clamps `start` into the free-tier window rather than letting the API
        reject the whole request - a truncated series beats no series.
        """
        earliest = date.today() - timedelta(days=MAX_HISTORY_DAYS - 5)
        if start < earliest:
            log.info(
                "coingecko: clamping %s start %s -> %s (free tier caps history at %d days)",
                coingecko_id,
                start,
                earliest,
                MAX_HISTORY_DAYS,
            )
            start = earliest

        params = {
            "vs_currency": "usd",
            "from": int(datetime.combine(start, datetime.min.time(), UTC).timestamp()),
            "to": int(datetime.combine(end, datetime.max.time(), UTC).timestamp()),
        }
        with httpx.Client(timeout=30.0, headers=self._headers()) as client:
            resp = request_with_backoff(
                client, "GET", f"{BASE}/coins/{coingecko_id}/market_chart/range",
                params=params,
            )
            payload = resp.json()

        # Granularity is range-dependent: <=2d gives 5-minute points, 3-90d
        # hourly, 91d+ daily. A 7-day refresh returns ~168 hourly points, so
        # collapsing to one bar per UTC date is mandatory - otherwise an
        # arbitrary intraday price is stored as the daily close. Last
        # observation wins; total_volumes is a rolling 24h figure, so
        # last-of-day is right there too rather than a sum.
        def _last_per_date(series) -> dict:
            latest: dict = {}
            for ts, value in series or []:
                if value is None:
                    continue
                d = datetime.fromtimestamp(ts / 1000, UTC).date()
                if d not in latest or ts >= latest[d][0]:
                    latest[d] = (ts, float(value))
            return {d: v for d, (_, v) in latest.items()}

        prices = _last_per_date(payload.get("prices"))
        volumes = _last_per_date(payload.get("total_volumes"))
        cap_by_date = _last_per_date(payload.get("market_caps"))

        bars = [
            Bar(date=d, close=close, volume=volumes.get(d))
            for d, close in sorted(prices.items())
            if close > 0
        ]
        caps = sorted(cap_by_date.items())
        return bars, caps

    def probe(self) -> ProbeResult:
        try:
            bars, _ = self.fetch_range(
                "bitcoin", date.today() - timedelta(days=7), date.today()
            )
            if not bars:
                return ProbeResult(self.name, False, "reachable but returned no bars")
            return ProbeResult(
                self.name,
                True,
                f"{len(bars)} recent bars for bitcoin (history capped at {MAX_HISTORY_DAYS}d)",
                bars[-1],
            )
        except Exception as exc:  # noqa: BLE001
            return ProbeResult(self.name, False, f"{type(exc).__name__}: {exc}"[:200])
