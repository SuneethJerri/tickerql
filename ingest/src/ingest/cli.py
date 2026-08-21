"""Ingestion CLI.

    python -m ingest probe          # are the data sources reachable?
    python -m ingest migrate        # apply db/*.sql in order
    python -m ingest backfill       # multi-year history
    python -m ingest refresh        # recent bars + crypto market cap
    python -m ingest refresh-views  # rebuild the derived layer
    python -m ingest coverage       # what do we actually have?
"""

from __future__ import annotations

import logging
import sys
from datetime import date, timedelta

import typer

from ingest.config import get_settings
from ingest.db import (
    apply_migrations,
    connect,
    coverage_report,
    finish_run,
    latest_dates,
    load_assets,
    refresh_views,
    start_run,
    upsert_bars,
)
from ingest.sources import get_source
from ingest.sources.coingecko import CoinGeckoSource

app = typer.Typer(add_completion=False, help="Market data ingestion.")


def _setup_logging(verbose: bool) -> None:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(levelname)-7s %(message)s",
        stream=sys.stderr,
    )


@app.command()
def probe(verbose: bool = typer.Option(False, "--verbose", "-v")) -> None:
    """Check every configured data source. Run this first."""
    _setup_logging(verbose)
    settings = get_settings()

    results = []
    for name in ("yfinance", "tiingo", "alphavantage"):
        try:
            results.append(get_source(name, settings).probe())
        except Exception as exc:  # noqa: BLE001
            from ingest.sources import ProbeResult

            results.append(ProbeResult(name, False, f"{type(exc).__name__}: {exc}"[:160]))
    results.append(CoinGeckoSource(settings.coingecko_api_key).probe())

    typer.echo("")
    for r in results:
        mark = typer.style("  OK  ", fg=typer.colors.GREEN) if r.reachable else typer.style(" FAIL ", fg=typer.colors.RED)
        active = "  <- PRICE_SOURCE" if r.source == settings.price_source else ""
        typer.echo(f"[{mark}] {r.source:<14} {r.detail}{active}")
        if r.sample:
            typer.echo(f"           sample: {r.sample.date} close={r.sample.close:,.2f}")
    typer.echo("")

    primary = next((r for r in results if r.source == settings.price_source), None)
    if primary and not primary.reachable:
        typer.secho(
            f"PRICE_SOURCE={settings.price_source} is unreachable. Set PRICE_SOURCE to a "
            "source marked OK above, supplying its API key if needed.",
            fg=typer.colors.RED,
        )
        raise typer.Exit(1)


@app.command()
def migrate(verbose: bool = typer.Option(False, "--verbose", "-v")) -> None:
    """Apply all migrations in order and assign restricted-role passwords."""
    _setup_logging(verbose)
    settings = get_settings()
    with connect(settings.database_url) as conn:
        applied = apply_migrations(conn, settings)
    for name in applied:
        typer.echo(f"  applied {name}")
    typer.secho("migrations complete", fg=typer.colors.GREEN)


@app.command()
def backfill(
    years: float = typer.Option(3.0, help="Years of history to fetch."),
    tickers: str = typer.Option("", help="Comma-separated subset; default all."),
    resume: bool = typer.Option(
        True, help="Skip assets already covering the requested range."
    ),
    verbose: bool = typer.Option(False, "--verbose", "-v"),
) -> None:
    """Fetch multi-year daily history for the tracked universe."""
    _setup_logging(verbose)
    settings = get_settings()
    source = get_source(settings.price_source, settings)

    end = date.today()
    start = end - timedelta(days=int(years * 365.25))
    only = [t.strip() for t in tickers.split(",") if t.strip()] or None

    with connect(settings.database_url) as conn:
        assets = load_assets(conn, only)
        if not assets:
            typer.secho("no active assets — did you run `migrate`?", fg=typer.colors.RED)
            raise typer.Exit(1)

        checkpoints = latest_dates(conn) if resume else {}
        # Resume from the data itself: an asset already covering the window is
        # skipped, one partially covered restarts a week before its last bar so
        # restated adjusted closes get picked up.
        pending, skipped = [], []
        for asset in assets:
            last = checkpoints.get(asset.id)
            if last and last >= end - timedelta(days=4):
                skipped.append(asset.ticker)
            else:
                pending.append(asset)

        if skipped:
            typer.echo(f"  up to date, skipping: {', '.join(skipped)}")
        if not pending:
            typer.secho("nothing to do", fg=typer.colors.GREEN)
            return

        run_id = start_run(conn, f"backfill --years {years}", source.name)
        by_symbol = {a.provider_symbol: a for a in pending}
        typer.echo(f"  fetching {len(by_symbol)} symbols from {source.name}: {start} -> {end}")

        total_rows, succeeded, gaps = 0, 0, {}
        try:
            fetched = source.fetch(list(by_symbol), start, end)
            for symbol, asset in by_symbol.items():
                bars = fetched.get(symbol)
                if not bars:
                    gaps[asset.ticker] = "no data returned"
                    typer.secho(f"    {asset.ticker:<6} NO DATA", fg=typer.colors.YELLOW)
                    continue
                n = upsert_bars(conn, asset.id, bars, source.name)
                conn.commit()
                total_rows += n
                succeeded += 1
                typer.echo(
                    f"    {asset.ticker:<6} {n:>5} bars  {bars[0].date} -> {bars[-1].date}"
                )
        except Exception as exc:  # noqa: BLE001
            conn.rollback()
            finish_run(
                conn, run_id, attempted=len(by_symbol), succeeded=succeeded,
                rows=total_rows, status="failed", detail={"gaps": gaps}, error=str(exc)[:500],
            )
            typer.secho(f"backfill failed: {exc}", fg=typer.colors.RED)
            raise typer.Exit(1)

        status = "ok" if succeeded == len(by_symbol) else ("partial" if succeeded else "failed")
        finish_run(
            conn, run_id, attempted=len(by_symbol), succeeded=succeeded,
            rows=total_rows, status=status, detail={"gaps": gaps},
        )

    typer.secho(
        f"backfill {status}: {succeeded}/{len(by_symbol)} assets, {total_rows:,} rows",
        fg=typer.colors.GREEN if status == "ok" else typer.colors.YELLOW,
    )


@app.command()
def refresh(
    lookback_days: int = typer.Option(
        7, help="Refetch this many recent days; catches restatements."
    ),
    skip_market_cap: bool = typer.Option(False, help="Skip the CoinGecko pass."),
    verbose: bool = typer.Option(False, "--verbose", "-v"),
) -> None:
    """Daily refresh: recent bars for everything, plus crypto market cap."""
    _setup_logging(verbose)
    settings = get_settings()
    source = get_source(settings.price_source, settings)

    end = date.today()
    start = end - timedelta(days=lookback_days)

    with connect(settings.database_url) as conn:
        assets = load_assets(conn)
        run_id = start_run(conn, f"refresh --lookback-days {lookback_days}", source.name)
        by_symbol = {a.provider_symbol: a for a in assets}

        total_rows, succeeded, gaps = 0, 0, {}
        try:
            fetched = source.fetch(list(by_symbol), start, end)
            for symbol, asset in by_symbol.items():
                bars = fetched.get(symbol)
                if not bars:
                    gaps[asset.ticker] = "no data returned"
                    continue
                total_rows += upsert_bars(conn, asset.id, bars, source.name)
                succeeded += 1
            conn.commit()

            # CoinGecko pass: market capitalisation, which no other configured
            # source provides. Best-effort - a failure here must not fail the
            # price refresh.
            if not skip_market_cap:
                cg = CoinGeckoSource(settings.coingecko_api_key)
                for asset in assets:
                    if not asset.coingecko_id:
                        continue
                    try:
                        bars, caps = cg.fetch_range(asset.coingecko_id, start, end)
                        upsert_bars(
                            conn, asset.id, bars, "coingecko", market_caps=dict(caps)
                        )
                        conn.commit()
                        typer.echo(f"    {asset.ticker:<6} market cap: {len(caps)} points")
                    except Exception as exc:  # noqa: BLE001
                        conn.rollback()
                        gaps[f"{asset.ticker}:market_cap"] = str(exc)[:160]
                        typer.secho(
                            f"    {asset.ticker:<6} market cap unavailable: {exc}"[:120],
                            fg=typer.colors.YELLOW,
                        )
        except Exception as exc:  # noqa: BLE001
            conn.rollback()
            finish_run(
                conn, run_id, attempted=len(by_symbol), succeeded=succeeded,
                rows=total_rows, status="failed", detail={"gaps": gaps}, error=str(exc)[:500],
            )
            typer.secho(f"refresh failed: {exc}", fg=typer.colors.RED)
            raise typer.Exit(1)

        status = "ok" if succeeded == len(by_symbol) else ("partial" if succeeded else "failed")
        finish_run(
            conn, run_id, attempted=len(by_symbol), succeeded=succeeded,
            rows=total_rows, status=status, detail={"gaps": gaps},
        )
        refreshed = refresh_views(conn)

    typer.secho(
        f"refresh {status}: {succeeded}/{len(by_symbol)} assets, {total_rows:,} rows, "
        f"views: {', '.join(refreshed)}",
        fg=typer.colors.GREEN if status == "ok" else typer.colors.YELLOW,
    )


@app.command(name="refresh-views")
def refresh_views_cmd(verbose: bool = typer.Option(False, "--verbose", "-v")) -> None:
    """Rebuild the derived materialized views."""
    _setup_logging(verbose)
    settings = get_settings()
    with connect(settings.database_url) as conn:
        done = refresh_views(conn)
    typer.secho(f"refreshed: {', '.join(done)}", fg=typer.colors.GREEN)


@app.command()
def coverage(verbose: bool = typer.Option(False, "--verbose", "-v")) -> None:
    """Show what history we actually hold, per asset."""
    _setup_logging(verbose)
    settings = get_settings()
    with connect(settings.database_url) as conn:
        rows = coverage_report(conn)

    typer.echo(f"\n{'TICKER':<8}{'TYPE':<8}{'SECTOR':<13}{'BARS':>6}  {'FIRST':<12}{'LAST':<12}")
    typer.echo("-" * 66)
    for ticker, atype, sector, bars, first, last in rows:
        typer.echo(
            f"{ticker:<8}{atype:<8}{sector:<13}{bars:>6}  "
            f"{str(first or '-'):<12}{str(last or '-'):<12}"
        )
    typer.echo("")


if __name__ == "__main__":
    app()
