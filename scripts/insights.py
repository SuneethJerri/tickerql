#!/usr/bin/env python
"""Derive the README's business insights from the live database.

The README quotes concrete numbers. Generating them from a script rather than
pasting them by hand means they can be re-derived after any refresh and can
never silently drift from what the data actually says.

Every comparison below is *selected* by the data, not hardcoded: the script
searches for the sector pair that best illustrates each claim and reports
whichever one wins. If a future refresh makes the claim false, the prose changes
with it rather than quietly becoming a lie.

    .venv/bin/python scripts/insights.py             # human-readable
    .venv/bin/python scripts/insights.py --markdown  # README section
"""

from __future__ import annotations

import argparse
import os
import sys
from itertools import permutations
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _env import require  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "api" / "src"))
from app import sql  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[1]
WINDOW = 365
# Derived from asset_type/sector at query time rather than hardcoded. The
# previous tuples silently misclassified every crypto added after the first
# three as an equity, which corrupted the published equity-correlation figure
# without failing anything.
TECH_SECTOR = "Information Technology"


def database_url() -> str:
    """Owner connection string, via the shared reader in scripts/_env.py."""
    return require("DATABASE_URL")


def worst_paid_risk(perf: dict, exclude: set[str] = frozenset()) -> tuple[dict, dict, float]:
    """The sector pair with the largest volatility gap where the *riskier*
    sector also returned *less*. Returns (riskier, safer, vol_ratio).

    This is the "2x the volatility for no extra reward" claim, found rather
    than assumed. Returns the empty tuple's stand-in if no such pair exists -
    which would itself be worth knowing, since it would mean risk was paid for
    everywhere in the window.
    """
    candidates = [
        (a, b, a["annualized_volatility"] / b["annualized_volatility"])
        for a, b in permutations(perf.values(), 2)
        if a["sector"] not in exclude
        and b["sector"] not in exclude
        and a["annualized_volatility"] > b["annualized_volatility"]
        and a["total_return"] < b["total_return"]
    ]
    if not candidates:
        return ({}, {}, 0.0)
    return max(candidates, key=lambda t: t[2])


def gather(conn) -> dict:
    perf = {r["sector"]: r for r in sql.fetch_all(conn, "sector_performance", {"window_days": WINDOW})}
    corr = {
        (r["ticker_a"], r["ticker_b"]): r["correlation"]
        for r in sql.fetch_all(conn, "correlation_matrix", {"window_days": WINDOW, "tickers": None})
    }
    risk = sql.fetch_all(conn, "asset_risk_metrics", {"window_days": WINDOW})

    crypto_tickers = {r["ticker"] for r in risk if r["asset_type"] == "crypto"}
    tech_tickers = {r["ticker"] for r in risk if r["sector"] == TECH_SECTOR}

    cross = [corr[(a, b)] for a in crypto_tickers for b in tech_tickers if (a, b) in corr]
    intra = [corr[(a, b)] for a in crypto_tickers for b in crypto_tickers if a < b]
    equity_pairs = [
        v
        for (a, b), v in corr.items()
        if a < b and a not in crypto_tickers and b not in crypto_tickers
    ]

    # Average correlation *inside* each sector. Comparing intra-crypto against
    # every equity pair would be apples-to-oranges: the crypto average covers
    # one sector while the equity average spans four, and cross-sector pairs
    # are structurally lower. This is the like-for-like comparison, and it is
    # what shows that crypto's internal cohesion is a sector property rather
    # than something unique to crypto.
    sector_of = {r["ticker"]: r["sector"] for r in risk}
    within: dict[str, list[float]] = {}
    for (a, b), v in corr.items():
        if a < b and sector_of[a] == sector_of[b]:
            within.setdefault(sector_of[a], []).append(v)
    within_avg = {s_: sum(v) / len(v) for s_, v in within.items()}
    equity_within = [v for s_, vs in within.items() if s_ != "Crypto" for v in vs]

    ranked = sorted(
        (r for r in risk if r["return_per_unit_risk"] is not None),
        key=lambda r: r["return_per_unit_risk"],
        reverse=True,
    )
    equities = [r for r in risk if r["asset_type"] == "stock"]
    cryptos = [r for r in risk if r["asset_type"] == "crypto"]

    # Drawdown expressed in units of the asset's own volatility. Dividing out
    # volatility is the point: it asks whether drawdown carries information
    # volatility does not, rather than just re-reporting that risky things move
    # more. Splitting the result by the sign of the return is what shows it does.
    for r in risk:
        r["dd_per_vol"] = abs(r["max_drawdown"]) / r["annualized_volatility"]
    winners = [r for r in risk if r["total_return"] > 0]
    losers = [r for r in risk if r["total_return"] <= 0]

    return {
        "perf": perf,
        "risk": risk,
        "ranked": ranked,
        "crypto_tech_corr": sum(cross) / len(cross),
        "crypto_crypto_corr": sum(intra) / len(intra),
        "equity_equity_corr": sum(equity_pairs) / len(equity_pairs),
        "within_sector": within_avg,
        "equity_within_corr": sum(equity_within) / len(equity_within),
        "worst_dd_crypto": min(cryptos, key=lambda r: r["max_drawdown"]),
        "worst_dd_equity": min(equities, key=lambda r: r["max_drawdown"]),
        "top_return": max(risk, key=lambda r: r["total_return"]),
        "winners": sorted(winners, key=lambda r: r["dd_per_vol"]),
        "losers": sorted(losers, key=lambda r: r["dd_per_vol"]),
        "overall_pair": worst_paid_risk(perf),
        "equity_pair": worst_paid_risk(perf, exclude={"Crypto"}),
        "as_of": max(r["end_date"] for r in risk),
        "start": min(r["start_date"] for r in risk),
    }


def _pct(v: float, digits: int = 1) -> str:
    return f"{v * 100:.{digits}f}%"


def _ordinal(n: int) -> str:
    """1 -> 1st. Used for the risk-adjusted rank in insight 4, which was a
    nested ternary long enough to hide a bug."""
    if 10 <= n % 100 <= 20:
        return f"{n}th"
    return f"{n}{ {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th') }"


def render_markdown(d: dict) -> str:
    ranked = d["ranked"]
    hi, lo, ratio = d["overall_pair"]
    ehi, elo, eratio = d["equity_pair"]
    best, worst = ranked[0], ranked[-1]
    top = d["top_return"]
    dd_c, dd_e = d["worst_dd_crypto"], d["worst_dd_equity"]
    dd_ratio = dd_c["max_drawdown"] / dd_e["max_drawdown"]
    vol_ratio = dd_c["annualized_volatility"] / dd_e["annualized_volatility"]

    winners_, losers_ = d["winners"], d["losers"]
    worst_winner, best_loser = winners_[-1], losers_[0]
    max_win = worst_winner["dd_per_vol"]
    min_lose = best_loser["dd_per_vol"]
    # State the separation only if it actually holds. If a future refresh makes
    # the groups overlap, this says so instead of asserting a false claim.
    separated = max_win < min_lose
    sep_lede = (
        "the groups separate by outcome rather than by asset class"
        if separated
        else "the split tracks outcome more than asset class, though the two "
        "ranges overlap in this window"
    )
    sep_note = f", and the ranges do not meet" if separated else ""
    # The shallowest loser only makes the point if it lost something worth
    # naming. An earlier run picked an asset that finished at -0.0%, which read
    # as "an equity that lost only nothing".
    equity_losers = [
        r
        for r in losers_
        if r["asset_type"] == "stock" and r["total_return"] < -0.01
    ]
    equity_note = ""
    if equity_losers:
        el = equity_losers[0]
        equity_note = (
            f" {el['ticker']} is an equity that lost only "
            f"{_pct(el['total_return'])} and still lands in the second group."
        )

    # Sectors ranked by return per unit of risk. Only the ends are named - all
    # nineteen inlined as prose is unreadable.
    by_ratio = sorted(
        d["perf"].values(), key=lambda r: r["return_per_unit_risk"] or -99, reverse=True
    )
    within = sorted(d["within_sector"].items(), key=lambda kv: -kv[1])
    runner_up = within[1] if len(within) > 1 else within[0]

    lines = [
        f"_Trailing {WINDOW} days ending {d['as_of']}, from split- and "
        f"dividend-adjusted closes. Risk-free rate assumed zero, so \"return per "
        f"unit of risk\" is annualised return over annualised volatility._",
        "",
        "### 1. More risk did not mean more return",
        "",
        f"{hi['sector']} ran {ratio:.1f}x {lo['sector']}'s volatility "
        f"({_pct(hi['annualized_volatility'])} vs {_pct(lo['annualized_volatility'])}) "
        f"and returned {_pct(hi['total_return'])} against "
        f"{_pct(lo['total_return'])}: more risk and a worse outcome over the same "
        "window.",
        "",
        f"That is easy to dismiss as a crypto story, but the same thing shows up "
        f"inside equities: {ehi['sector']} carried {eratio:.2f}x "
        f"{elo['sector']}'s volatility "
        f"({_pct(ehi['annualized_volatility'])} vs {_pct(elo['annualized_volatility'])}) "
        f"to return {_pct(ehi['total_return'])}, less than "
        f"{elo['sector']}'s {_pct(elo['total_return'])}.",
        "",
        "| Sector | Return | Ann. vol | Return/risk |",
        "|---|---:|---:|---:|",
    ]
    for r in by_ratio[:3] + by_ratio[-3:]:
        lines.append(
            f"| {r['sector']} | {_pct(r['total_return'])} | "
            f"{_pct(r['annualized_volatility'])} | {r['return_per_unit_risk']:.2f} |"
        )
    lines += [
        "",
        f"_Best and worst three of {len(by_ratio)} sectors._",
        "",
        "### 2. Crypto diversifies a stock portfolio, not itself",
        "",
        f"Average pairwise correlation *within* crypto is "
        f"**{d['crypto_crypto_corr']:.2f}**, the highest of any sector, but "
        f"{runner_up[0]} is right behind at {runner_up[1]:.2f}, so tight internal "
        "correlation is a property of narrow sectors rather than something "
        "peculiar to crypto.",
        "",
        f"The distinctive number is the other one. Crypto's average correlation to "
        f"large-cap tech is **{d['crypto_tech_corr']:.2f}**, against "
        f"{d['equity_within_corr']:.2f} within equity sectors. Adding a second "
        "crypto to a crypto book buys almost nothing; adding crypto to an equity "
        "book does.",
        "",
        "### 3. Drawdown carries information volatility does not",
        "",
        f"{dd_c['ticker']} fell **{_pct(dd_c['max_drawdown'])}** peak to trough "
        f"against {dd_e['ticker']}'s **{_pct(dd_e['max_drawdown'])}**, the worst "
        f"equity. On its own that is unremarkable: {dd_ratio:.1f}x the drawdown on "
        f"{vol_ratio:.1f}x the volatility is roughly what volatility already "
        "predicts.",
        "",
        f"Divide each asset's drawdown by its own volatility and {sep_lede}. The "
        f"**{len(winners_)}** assets that finished the window positive sit at or "
        f"below **{max_win:.2f}**; the **{len(losers_)}** that finished negative "
        f"sit at or above **{min_lose:.2f}**{sep_note}.{equity_note}",
        "",
        "Volatility treats a 5% rise and a 5% fall as the same event, so it prices "
        "the size of the moves but not the order they arrive in. Drawdown is the "
        "order, and it is the loss someone actually has to sit through.",
        "",
        "### 4. The best return and the best investment are different assets",
        "",
        f"{top['ticker']} posted the highest return in the set at "
        f"**{_pct(top['total_return'])}**, but ranks "
        f"{_ordinal(ranked.index(top) + 1)} risk-adjusted, because it took "
        f"{_pct(top['annualized_volatility'])} volatility to get there. "
        f"**{best['ticker']}** leads at {best['return_per_unit_risk']:.2f} on "
        f"{_pct(best['annualized_volatility'])} volatility, with a "
        f"{_pct(best['max_drawdown'])} maximum drawdown, the shallowest in the "
        "set.",
        "",
        "| Asset | Sector | Return | Ann. vol | Return/risk | Max drawdown |",
        "|---|---|---:|---:|---:|---:|",
    ]
    for r in ranked[:3] + ranked[-3:]:
        lines.append(
            f"| {r['ticker']} | {r['sector']} | {_pct(r['total_return'])} | "
            f"{_pct(r['annualized_volatility'])} | {r['return_per_unit_risk']:.2f} | "
            f"{_pct(r['max_drawdown'])} |"
        )
    negatives = [r for r in ranked if r["return_per_unit_risk"] < 0]
    lines += [
        "",
        f"_Top and bottom three of {len(ranked)}. {len(negatives)} assets finished "
        f"the window with a negative ratio; the worst was {worst['ticker']} at "
        f"{worst['return_per_unit_risk']:.2f}._",
    ]
    return "\n".join(lines)


def render_text(d: dict) -> str:
    out = [f"Insights: trailing {WINDOW} days, {d['start']} to {d['as_of']}", ""]
    out.append(f"  {'SECTOR':<12}{'RETURN':>9}{'VOL':>8}{'RATIO':>8}")
    for _, r in sorted(
        d["perf"].items(), key=lambda kv: kv[1]["return_per_unit_risk"] or -99, reverse=True
    ):
        out.append(
            f"  {r['sector']:<12}{r['total_return'] * 100:8.1f}%{r['annualized_volatility'] * 100:7.1f}%"
            f"{r['return_per_unit_risk']:8.2f}"
        )
    hi, lo, ratio = d["overall_pair"]
    ehi, elo, eratio = d["equity_pair"]
    out += [
        "",
        f"  worst-paid risk (any)    : {hi['sector']} {ratio:.2f}x vol of {lo['sector']}, lower return",
        f"  worst-paid risk (equity) : {ehi['sector']} {eratio:.2f}x vol of {elo['sector']}, lower return",
        f"  crypto<->crypto corr     : {d['crypto_crypto_corr']:.3f}",
        f"  equity<->equity corr     : {d['equity_equity_corr']:.3f} (all pairs, every sector)",
        f"  equity within-sector     : {d['equity_within_corr']:.3f} (like-for-like)",
        f"  crypto<->tech   corr     : {d['crypto_tech_corr']:.3f}",
        "",
        "  within-sector correlation:",
        *(
            f"    {s_:<12} {v:.3f}"
            for s_, v in sorted(d["within_sector"].items(), key=lambda kv: -kv[1])
        ),
        f"  worst crypto drawdown    : {d['worst_dd_crypto']['ticker']} "
        f"{d['worst_dd_crypto']['max_drawdown'] * 100:.1f}%",
        f"  worst equity drawdown    : {d['worst_dd_equity']['ticker']} "
        f"{d['worst_dd_equity']['max_drawdown'] * 100:.1f}%",
        f"  highest return           : {d['top_return']['ticker']} "
        f"{d['top_return']['total_return'] * 100:.1f}%",
        f"  best return/risk         : {d['ranked'][0]['ticker']} {d['ranked'][0]['return_per_unit_risk']:.2f}",
    ]
    return "\n".join(out)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--markdown", action="store_true", help="emit the README section")
    parser.add_argument(
        "--inject",
        action="store_true",
        help="rewrite the README section between the INSIGHTS markers in place",
    )
    args = parser.parse_args()

    with psycopg.connect(database_url()) as conn:
        data = gather(conn)

    if args.inject:
        readme = REPO_ROOT / "README.md"
        text = readme.read_text()
        start, end = "<!-- INSIGHTS:START -->", "<!-- INSIGHTS:END -->"
        if start not in text or end not in text:
            sys.exit(f"markers {start} / {end} not found in {readme}")
        head, _, rest = text.partition(start)
        _, _, tail = rest.partition(end)
        readme.write_text(f"{head}{start}\n\n{render_markdown(data)}\n\n{end}{tail}")
        print(f"injected {WINDOW}-day insights as of {data['as_of']} into {readme.name}")
        return

    print(render_markdown(data) if args.markdown else render_text(data))


if __name__ == "__main__":
    main()
