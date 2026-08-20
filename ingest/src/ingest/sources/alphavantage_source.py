"""Alpha Vantage OHLCV source — second fallback provider.

Free tier is 25 requests/day, which is enough for a one-time backfill of 13
equities and a daily refresh, but not enough to retry casually. Wired up but
unused while yfinance works.
"""

from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import Sequence

import httpx

from ingest.retry import request_with_backoff
from ingest.sources import Bar, ProbeResult

log = logging.getLogger(__name__)

BASE = "https://www.alphavantage.co/query"


class AlphaVantageSource:
    name = "alphavantage"

    def __init__(self, api_key: str | None) -> None:
        self.api_key = api_key

    def fetch(
        self, symbols: Sequence[str], start: date, end: date
    ) -> dict[str, list[Bar]]:
        if not self.api_key:
            raise RuntimeError("ALPHAVANTAGE_API_KEY is not set")

        out: dict[str, list[Bar]] = {}
        with httpx.Client(timeout=30.0) as client:
            for symbol in symbols:
                if symbol.endswith("-USD"):
                    log.warning("alphavantage crypto not wired: %s", symbol)
                    continue
                try:
                    resp = request_with_backoff(
                        client,
                        "GET",
                        BASE,
                        params={
                            "function": "TIME_SERIES_DAILY_ADJUSTED",
                            "symbol": symbol,
                            "outputsize": "full",
                            "apikey": self.api_key,
                        },
                    )
                    payload = resp.json()
                except Exception as exc:  # noqa: BLE001
                    log.warning("alphavantage fetch failed for %s: %s", symbol, exc)
                    continue

                series = payload.get("Time Series (Daily)")
                if not series:
                    # Alpha Vantage reports quota exhaustion as a 200 with a
                    # "Note"/"Information" body rather than a 429.
                    log.warning(
                        "alphavantage returned no series for %s: %s",
                        symbol,
                        str(payload)[:160],
                    )
                    continue

                bars = []
                for day, row in series.items():
                    d = date.fromisoformat(day)
                    if d < start or d > end:
                        continue
                    close = float(row["4. close"])
                    if close <= 0:
                        continue
                    bars.append(
                        Bar(
                            date=d,
                            open=float(row["1. open"]),
                            high=float(row["2. high"]),
                            low=float(row["3. low"]),
                            close=close,
                            adj_close=float(row.get("5. adjusted close", close)),
                            volume=float(row.get("6. volume", 0)),
                        )
                    )
                if bars:
                    out[symbol] = sorted(bars, key=lambda b: b.date)
        return out

    def probe(self) -> ProbeResult:
        if not self.api_key:
            return ProbeResult(self.name, False, "ALPHAVANTAGE_API_KEY not set")
        try:
            got = self.fetch(["AAPL"], date.today() - timedelta(days=10), date.today())
            bars = got.get("AAPL") or []
            if not bars:
                return ProbeResult(self.name, False, "reachable but returned no bars")
            return ProbeResult(self.name, True, f"{len(bars)} recent bars", bars[-1])
        except Exception as exc:  # noqa: BLE001
            return ProbeResult(self.name, False, f"{type(exc).__name__}: {exc}"[:200])
