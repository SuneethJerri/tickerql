"""CoinGecko source — crypto close/volume and market capitalisation.

SCOPE IS DELIBERATELY NARROW, and this is the single most important thing to
know about this module:

    The keyless CoinGecko API refuses any historical range beyond 365 days:

        HTTP 401
        {"error":{"status":{"error_code":10012,
          "error_message":"Your request exceeds the allowed time range.
           Public API users are limited to querying historical data within
           the past 365 days..."}}}

    A Demo key raises rate limits but does NOT lift this cap; full history is
    a paid plan feature.

So CoinGecko cannot supply the 2-3 years of crypto history the project
requires. yfinance does (BTC-USD / ETH-USD / SOL-USD, full daily OHLCV), and
is used for that. CoinGecko is retained for what it is genuinely better at and
what Yahoo does not provide at all:

  * market capitalisation
  * an independent cross-check of recent closes
  * the daily refresh path for crypto

`/market_chart/range` returns daily granularity automatically for ranges over
90 days. It has no open/high/low, so bars produced here carry close and volume
only — which is why price_history allows NULL intraday bounds.
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
        reject the whole request — a truncated series beats no series.
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

        # CoinGecko's granularity is range-dependent and NOT always daily:
        #   1-2 days   -> ~5 minute points
        #   3-90 days  -> hourly points
        #   91+ days   -> daily points
        # A 7-day refresh therefore returns ~168 hourly points, several per
        # calendar date. Collapsing to one bar per date is mandatory - taking
        # points as-is would store an arbitrary intraday price as the daily
        # close, silently corrupting every downstream return.
        #
        # Last observation of each UTC date wins, which is the daily close.
        # total_volumes is a rolling 24h figure, so last-of-day is correct
        # there too rather than a sum.
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
