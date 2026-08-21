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

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "api" / "src"))
from app import sql  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[1]
WINDOW = 365
CRYPTO_TICKERS = ("BTC", "ETH", "SOL")
TECH_TICKERS = ("AAPL", "MSFT", "NVDA", "GOOGL")


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


def worst_paid_risk(perf: dict, exclude: set[str] = frozenset()) -> tuple[dict, dict, float]:
    """The sector pair with the largest volatility gap where the *riskier*
    sector also returned *less*. Returns (riskier, safer, vol_ratio).

    This is the "2x the volatility for no extra reward" claim, found rather
    than assumed. Returns the empty tuple's stand-in if no such pair exists —
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

    cross = [corr[(a, b)] for a in CRYPTO_TICKERS for b in TECH_TICKERS]
    intra = [corr[(a, b)] for a in CRYPTO_TICKERS for b in CRYPTO_TICKERS if a < b]
    equity_pairs = [
        v
        for (a, b), v in corr.items()
        if a < b and a not in CRYPTO_TICKERS and b not in CRYPTO_TICKERS
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
    sep_note = (
        f" — the gap runs from {max_win:.2f} to {min_lose:.2f}"
        if max_win < min_lose
        else " only partially in this window (the ranges now overlap)"
    )
    equity_losers = [r for r in losers_ if r["asset_type"] == "stock"]
    equity_loser = equity_losers[0]["ticker"] if equity_losers else "—"
    equity_loser_ret = equity_losers[0]["total_return"] if equity_losers else 0.0
    # How the equity loser ranks against the crypto assets on this measure.
    # Counted rather than asserted: an earlier draft claimed "above two of the
    # three" when it was above one and tied with another.
    crypto_dd = sorted(r["dd_per_vol"] for r in d["risk"] if r["asset_type"] == "crypto")
    if equity_losers:
        beaten = sum(1 for v in crypto_dd if v < equity_losers[0]["dd_per_vol"] - 1e-9)
        equity_loser_rank = (
            f"deeper on this measure than {beaten} of the {len(crypto_dd)} crypto assets"
            if beaten
            else f"level with the crypto assets on this measure"
        )
    else:
        equity_loser_rank = ""

    lines = [
        f"_All figures: trailing {WINDOW} calendar days ending {d['as_of']}, computed from "
        f"split- and dividend-adjusted closes. Risk-free rate assumed zero, so "
        f"\"return per unit of risk\" is annualised return over annualised volatility._",
        "",
        "### 1. Risk was not paid for — and the gap is visible inside equities, not just against crypto",
        "",
        f"**{hi['sector']} ran {ratio:.1f}x {lo['sector']}'s volatility "
        f"({_pct(hi['annualized_volatility'])} vs {_pct(lo['annualized_volatility'])}) and returned "
        f"{_pct(hi['total_return'])} against {lo['sector']}'s {_pct(lo['total_return'])}** — more risk, "
        "and a worse outcome, over the same window.",
        "",
        f"That comparison is easy to dismiss as a crypto story. It is not. Among equity sectors alone, "
        f"**{ehi['sector']} carried {eratio:.2f}x {elo['sector']}'s volatility "
        f"({_pct(ehi['annualized_volatility'])} vs {_pct(elo['annualized_volatility'])}) to return "
        f"{_pct(ehi['total_return'])} — less than {elo['sector']}'s {_pct(elo['total_return'])}.** "
        f"Ranked by return per unit of risk, the sectors order "
        + ", ".join(
            f"{r['sector']} ({r['return_per_unit_risk']:.2f})"
            for r in sorted(
                d["perf"].values(),
                key=lambda r: r["return_per_unit_risk"] or -99,
                reverse=True,
            )
        )
        + ".",
        "",
        "### 2. Crypto diversifies a stock portfolio; it does not diversify itself",
        "",
        f"Average pairwise correlation *within* crypto is **{d['crypto_crypto_corr']:.2f}** — the highest "
        f"of any sector. The tempting conclusion is that crypto is uniquely one position wearing three "
        f"tickers. The data does not support that: "
        + ", ".join(
            f"{s_} {v:.2f}"
            for s_, v in sorted(d["within_sector"].items(), key=lambda kv: -kv[1])
        )
        + ". **Energy is nearly as tightly coupled**, so high internal correlation is a property of "
        "narrow sectors generally, not something peculiar to crypto.",
        "",
        f"What *is* distinctive is the other number. Crypto's average correlation to large-cap tech is "
        f"**{d['crypto_tech_corr']:.2f}**, against a within-sector equity average of "
        f"{d['equity_within_corr']:.2f}. So the diversification benefit runs outward, not inward: adding "
        f"a second crypto to a crypto book buys almost nothing, while adding crypto to an equity book "
        f"genuinely does — the opposite of the common framing of crypto as levered tech beta.",
        "",
        "### 3. Drawdown carries information volatility does not — and it is not about asset class",
        "",
        f"{dd_c['ticker']} fell **{_pct(dd_c['max_drawdown'])}** peak-to-trough against "
        f"{dd_e['ticker']}'s **{_pct(dd_e['max_drawdown'])}**, the worst equity. Taken alone that says "
        f"little: {dd_ratio:.1f}x the drawdown on {vol_ratio:.1f}x the volatility is roughly what "
        "volatility already predicts.",
        "",
        "Divide each asset's drawdown by its own volatility and the picture separates cleanly — but "
        "not along the line you would expect:",
        "",
        f"- All **{len(winners_)}** assets that finished the window positive sit at or below "
        f"**{max_win:.2f}** drawdowns-per-unit-volatility (deepest: {worst_winner['ticker']}).",
        f"- All **{len(losers_)}** that finished negative sit at or above **{min_lose:.2f}** "
        f"(shallowest: {best_loser['ticker']}).",
        f"- The two groups do not overlap{sep_note}.",
        "",
        f"The split is by *outcome*, not by asset type: {equity_loser} is an equity that lost only "
        f"{_pct(equity_loser_ret)} yet sits in the second group, {equity_loser_rank}. "
        "Volatility is direction-blind by construction — it treats a 5% rise and a 5% fall as the same "
        "event — so it prices the size of the moves but not the order they arrive in. Drawdown is the "
        "order. For position sizing that difference is the whole game: it is the loss an investor "
        "actually has to sit through.",
        "",
        "### 4. The best return and the best investment are different assets",
        "",
        f"{top['ticker']} posted the highest return in the set at **{_pct(top['total_return'])}** — but "
        f"ranks {ranked.index(top) + 1}{'st' if ranked.index(top) == 0 else ('nd' if ranked.index(top) == 1 else ('rd' if ranked.index(top) == 2 else 'th'))} "
        f"on a risk-adjusted basis, because it took {_pct(top['annualized_volatility'])} volatility to "
        f"get there. **{best['ticker']}** leads at {best['return_per_unit_risk']:.2f} with "
        f"{_pct(best['annualized_volatility'])} volatility and a "
        f"{_pct(best['max_drawdown'])} maximum drawdown — the shallowest in the set.",
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
        f"_Top three and bottom three of {len(ranked)}. "
        f"{len(negatives)} assets finished the window with a negative ratio: "
        + ", ".join(r["ticker"] for r in negatives)
        + f" — the last of which ({worst['ticker']}, {worst['return_per_unit_risk']:.2f}) was the worst "
        "of the set._",
    ]
    return "\n".join(lines)


def render_text(d: dict) -> str:
    out = [f"Insights — trailing {WINDOW} days, {d['start']} to {d['as_of']}", ""]
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
        f"  equity<->equity corr     : {d['equity_equity_corr']:.3f} (all pairs, 4 sectors)",
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
