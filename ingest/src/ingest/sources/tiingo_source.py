"""Tiingo OHLCV source - fallback provider.

Unused while yfinance works. Kept wired up because Yahoo blocking is a live
risk (it 429s plain HTTP clients from this network) and swapping providers
should be a config change, not a rewrite. Free tier: 500 requests/day, full
history, no card required.
"""

from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import Sequence

import httpx

from ingest.sources import Bar, ProbeResult
from ingest.retry import request_with_backoff

log = logging.getLogger(__name__)

BASE = "https://api.tiingo.com/tiingo/daily"


class TiingoSource:
    name = "tiingo"

    def __init__(self, api_key: str | None) -> None:
        self.api_key = api_key

    def _headers(self) -> dict[str, str]:
        return {
            "Content-Type": "application/json",
            "Authorization": f"Token {self.api_key}",
        }

    def fetch(
        self, symbols: Sequence[str], start: date, end: date
    ) -> dict[str, list[Bar]]:
        if not self.api_key:
            raise RuntimeError("TIINGO_API_KEY is not set")

        out: dict[str, list[Bar]] = {}
        with httpx.Client(timeout=30.0, headers=self._headers()) as client:
            for symbol in symbols:
                # Tiingo has no crypto on this endpoint; caller routes crypto
                # elsewhere. Skip rather than fail the whole batch.
                if symbol.endswith("-USD"):
                    log.warning("tiingo daily endpoint has no crypto: %s", symbol)
                    continue
                try:
                    resp = request_with_backoff(
                        client,
                        "GET",
                        f"{BASE}/{symbol}/prices",
                        params={
                            "startDate": start.isoformat(),
                            "endDate": end.isoformat(),
                            "format": "json",
                        },
                    )
                    rows = resp.json()
                except Exception as exc:  # noqa: BLE001
                    log.warning("tiingo fetch failed for %s: %s", symbol, exc)
                    continue

                bars = []
                for row in rows:
                    close = row.get("close")
                    if close is None or close <= 0:
                        continue
                    bars.append(
                        Bar(
                            date=date.fromisoformat(row["date"][:10]),
                            open=row.get("open"),
                            high=row.get("high"),
                            low=row.get("low"),
                            close=float(close),
                            adj_close=row.get("adjClose"),
                            volume=row.get("volume"),
                        )
                    )
                if bars:
                    out[symbol] = bars
        return out

    def probe(self) -> ProbeResult:
        if not self.api_key:
            return ProbeResult(self.name, False, "TIINGO_API_KEY not set")
        try:
            got = self.fetch(["AAPL"], date.today() - timedelta(days=10), date.today())
            bars = got.get("AAPL") or []
            if not bars:
                return ProbeResult(self.name, False, "reachable but returned no bars")
            return ProbeResult(self.name, True, f"{len(bars)} recent bars", bars[-1])
        except Exception as exc:  # noqa: BLE001
            return ProbeResult(self.name, False, f"{type(exc).__name__}: {exc}"[:200])
