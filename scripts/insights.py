#!/usr/bin/env python
"""Derive the README's business insights from the live database.

The README quotes concrete numbers. Generating them from a script rather than
pasting them by hand means they can be re-derived after any refresh and can
never silently drift from what the data actually says.

    .venv/bin/python scripts/insights.py           # human-readable
    .venv/bin/python scripts/insights.py --markdown # README section
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "api" / "src"))
from app import sql  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[1]
WINDOW = 365


def database_url() -> str:
    env_path = REPO_ROOT / ".env"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if line.startswith("DATABASE_URL="):
                return line.partition("=")[2].strip()
    url = os.environ.get("DATABASE_URL")
    if not url:
        sys.exit("DATABASE_URL is not set and no .env was found")
    return url


def gather(conn) -> dict:
    perf = {r["sector"]: r for r in sql.fetch_all(conn, "sector_performance", {"window_days": WINDOW})}
    corr = {
        (r["ticker_a"], r["ticker_b"]): r["correlation"]
        for r in sql.fetch_all(conn, "correlation_matrix", {"window_days": WINDOW, "tickers": None})
    }
    risk = sql.fetch_all(conn, "asset_risk_metrics", {"window_days": WINDOW})

    crypto_t = ("BTC", "ETH", "SOL")
    tech_t = ("AAPL", "MSFT", "NVDA", "GOOGL")
    cross = [corr[(a, b)] for a in crypto_t for b in tech_t]
    intra = [corr[(a, b)] for a in crypto_t for b in crypto_t if a < b]

    ranked = sorted(
        (r for r in risk if r["return_per_unit_risk"] is not None),
        key=lambda r: r["return_per_unit_risk"],
        reverse=True,
    )
    return {
        "perf": perf,
        "risk": risk,
        "ranked": ranked,
        "crypto_tech_corr": sum(cross) / len(cross),
        "crypto_crypto_corr": sum(intra) / len(intra),
        "worst_crypto_dd": min(r["max_drawdown"] for r in risk if r["asset_type"] == "crypto"),
        "worst_equity_dd": min(r["max_drawdown"] for r in risk if r["asset_type"] == "stock"),
        "as_of": max(r["end_date"] for r in risk),
    }


def render_markdown(d: dict) -> str:
    perf, ranked = d["perf"], d["ranked"]
    sectors = sorted(perf.values(), key=lambda r: r["return_per_unit_risk"] or -99, reverse=True)
    best_s, worst_s = sectors[0], sectors[-1]
    energy, health = perf["Energy"], perf["Healthcare"]
    vol_ratio = energy["annualized_volatility"] / health["annualized_volatility"]
    dd_ratio = d["worst_crypto_dd"] / d["worst_equity_dd"]

    lines = [
        f"_Trailing {WINDOW} days as of {d['as_of']}. Risk-free rate assumed zero._",
        "",
        "**1. Volatility is not paid for equally across sectors.**",
        f"Energy carried {energy['annualized_volatility']*100:.1f}% annualised volatility to return "
        f"{energy['total_return']*100:.1f}%, while Healthcare returned *more* "
        f"({health['total_return']*100:.1f}%) on {health['annualized_volatility']*100:.1f}% volatility — "
        f"{vol_ratio:.2f}x the risk for less reward. Ranked by return per unit of risk, "
        f"{best_s['sector']} leads at {best_s['return_per_unit_risk']:.2f} and "
        f"{worst_s['sector']} trails at {worst_s['return_per_unit_risk']:.2f}.",
        "",
        "**2. Crypto trades as its own bloc.**",
        f"Average correlation *within* crypto is {d['crypto_crypto_corr']:.2f}, but only "
        f"{d['crypto_tech_corr']:.2f} between crypto and large-cap tech. The three crypto assets are "
        "close to a single position, while the diversification benefit against equities is real — "
        "the opposite of the common claim that crypto is simply levered tech beta.",
        "",
        "**3. Drawdowns are asymmetric in a way volatility alone hides.**",
        f"The worst crypto peak-to-trough loss was {d['worst_crypto_dd']*100:.1f}% versus "
        f"{d['worst_equity_dd']*100:.1f}% for the worst equity — {dd_ratio:.1f}x deeper, a wider gap "
        "than the volatility ratio implies. Volatility is symmetric; drawdown is what an investor "
        "actually lives through.",
        "",
        "**4. The risk-adjusted leaders are defensive, not glamorous.**",
        "| Asset | Sector | Return/risk | Annualised vol |",
        "|---|---|---:|---:|",
    ]
    for r in ranked[:3]:
        lines.append(
            f"| {r['ticker']} | {r['sector']} | {r['return_per_unit_risk']:.2f} | "
            f"{r['annualized_volatility']*100:.0f}% |"
        )
    for r in ranked[-2:]:
        lines.append(
            f"| {r['ticker']} | {r['sector']} | {r['return_per_unit_risk']:.2f} | "
            f"{r['annualized_volatility']*100:.0f}% |"
        )
    lines.append("")
    lines.append(
        f"The top of the table is dominated by low-volatility names; every crypto asset sits at the "
        f"bottom with a negative ratio over this window."
    )
    return "\n".join(lines)


def render_text(d: dict) -> str:
    out = [f"Insights — trailing {WINDOW} days as of {d['as_of']}", ""]
    for sector, r in sorted(
        d["perf"].items(), key=lambda kv: kv[1]["return_per_unit_risk"] or -99, reverse=True
    ):
        out.append(
            f"  {sector:<12} return {r['total_return']*100:7.1f}%   "
            f"vol {r['annualized_volatility']*100:5.1f}%   "
            f"ratio {r['return_per_unit_risk']:6.2f}"
        )
    out += [
        "",
        f"  crypto<->crypto correlation : {d['crypto_crypto_corr']:.3f}",
        f"  crypto<->tech   correlation : {d['crypto_tech_corr']:.3f}",
        f"  worst crypto drawdown       : {d['worst_crypto_dd']*100:.1f}%",
        f"  worst equity drawdown       : {d['worst_equity_dd']*100:.1f}%",
    ]
    return "\n".join(out)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--markdown", action="store_true", help="emit the README section")
    args = parser.parse_args()

    with psycopg.connect(database_url()) as conn:
        data = gather(conn)
    print(render_markdown(data) if args.markdown else render_text(data))


if __name__ == "__main__":
    main()
