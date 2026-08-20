"""yfinance-backed OHLCV source — the verified primary provider.

Serves both equities and crypto history. Crypto is here rather than on
CoinGecko because CoinGecko's keyless API refuses any range beyond 365 days
(error_code 10012), which cannot satisfy the 2-3 year requirement.
"""

from __future__ import annotations

import logging
import warnings
from datetime import date, timedelta
from typing import Sequence

from ingest.sources import Bar, ProbeResult

log = logging.getLogger(__name__)


def _import_yf():
    warnings.filterwarnings("ignore", category=FutureWarning, module="yfinance")
    logging.getLogger("yfinance").setLevel(logging.CRITICAL)
    import yfinance as yf

    return yf


def _f(value) -> float | None:
    """Coerce a pandas cell to a clean float, mapping NaN/None to None."""
    if value is None:
        return None
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    return None if out != out else out  # NaN != NaN


class YFinanceSource:
    name = "yfinance"

    def fetch(
        self, symbols: Sequence[str], start: date, end: date
    ) -> dict[str, list[Bar]]:
        yf = _import_yf()
        symbols = list(symbols)
        if not symbols:
            return {}

        # yfinance treats `end` as exclusive.
        frame = yf.download(
            symbols,
            start=start.isoformat(),
            end=(end + timedelta(days=1)).isoformat(),
            interval="1d",
            auto_adjust=False,   # keep Close and Adj Close distinct
            group_by="ticker",
            threads=False,       # deterministic ordering, gentler on rate limits
            progress=False,
        )
        if frame is None or frame.empty:
            return {}

        import pandas as pd

        # yfinance returns MultiIndex columns (symbol, field) whenever
        # group_by="ticker" is set - including for a SINGLE symbol. Branching on
        # len(symbols) is wrong; branch on the actual column shape instead.
        multi = isinstance(frame.columns, pd.MultiIndex)

        out: dict[str, list[Bar]] = {}
        for symbol in symbols:
            try:
                sub = frame[symbol] if multi else frame
            except KeyError:
                log.warning("no data returned for %s", symbol)
                continue
            if "Close" not in sub.columns:
                log.warning("no Close column for %s", symbol)
                continue

            sub = sub.dropna(subset=["Close"])
            if sub.empty:
                log.warning("all-NaN close for %s", symbol)
                continue

            bars: list[Bar] = []
            for idx, row in sub.iterrows():
                close = _f(row.get("Close"))
                if close is None or close <= 0:
                    # A non-positive close violates a CHECK constraint and is
                    # meaningless as a price; drop rather than let it poison
                    # the return series.
                    continue
                bars.append(
                    Bar(
                        date=idx.date(),
                        open=_f(row.get("Open")),
                        high=_f(row.get("High")),
                        low=_f(row.get("Low")),
                        close=close,
                        adj_close=_f(row.get("Adj Close")),
                        volume=_f(row.get("Volume")),
                    )
                )
            if bars:
                out[symbol] = bars
        return out

    def probe(self) -> ProbeResult:
        try:
            got = self.fetch(["AAPL"], date.today() - timedelta(days=10), date.today())
            bars = got.get("AAPL") or []
            if not bars:
                return ProbeResult(self.name, False, "reachable but returned no bars")
            return ProbeResult(
                self.name, True, f"{len(bars)} recent bars for AAPL", bars[-1]
            )
        except Exception as exc:  # noqa: BLE001 — probe must never raise
            return ProbeResult(self.name, False, f"{type(exc).__name__}: {exc}"[:200])
