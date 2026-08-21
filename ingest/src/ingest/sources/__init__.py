"""Pluggable market-data sources.

Yahoo returns 429 to plain HTTP clients from some networks; yfinance works
because it uses curl_cffi TLS impersonation. Adding a provider means adding a
module here, not conditionals at call sites.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Protocol, Sequence, runtime_checkable


@dataclass(frozen=True, slots=True)
class Bar:
    """One daily OHLCV bar.

    `open`/`high`/`low` are optional: CoinGecko-sourced crypto rows carry a
    real close and volume with no intraday bounds. `close` is the only price
    guaranteed present. `adj_close` is split/dividend adjusted where the
    provider supplies it; returns are computed from it in preference to close.
    """

    date: date
    close: float
    open: float | None = None
    high: float | None = None
    low: float | None = None
    adj_close: float | None = None
    volume: float | None = None


@dataclass(frozen=True, slots=True)
class ProbeResult:
    source: str
    reachable: bool
    detail: str
    sample: Bar | None = None


@runtime_checkable
class PriceSource(Protocol):
    """A provider of daily OHLCV history."""

    name: str

    def fetch(
        self, symbols: Sequence[str], start: date, end: date
    ) -> dict[str, list[Bar]]:
        """Return bars per symbol for [start, end].

        Implementations must not raise for a single bad symbol - omit it from
        the returned mapping and let the caller record the gap. Raising is
        reserved for total failure (auth, network, rate limit exhaustion).
        """
        ...

    def probe(self) -> ProbeResult:
        """Cheap reachability check. Must never raise."""
        ...


def get_source(name: str, settings) -> PriceSource:
    """Resolve a source by name, importing lazily."""
    key = name.strip().lower()
    if key == "yfinance":
        from ingest.sources.yfinance_source import YFinanceSource

        return YFinanceSource()
    if key == "tiingo":
        from ingest.sources.tiingo_source import TiingoSource

        return TiingoSource(settings.tiingo_api_key)
    if key == "alphavantage":
        from ingest.sources.alphavantage_source import AlphaVantageSource

        return AlphaVantageSource(settings.alphavantage_api_key)
    raise ValueError(
        f"Unknown PRICE_SOURCE {name!r}. Expected one of: yfinance, tiingo, alphavantage."
    )
