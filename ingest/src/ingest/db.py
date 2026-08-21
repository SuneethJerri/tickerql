"""Database access: migrations, idempotent upserts, and run auditing."""

from __future__ import annotations

import json
import logging
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import date
from typing import Iterable, Iterator, Sequence

import psycopg
from psycopg import sql

from ingest.config import DB_DIR, Settings
from ingest.sources import Bar

log = logging.getLogger(__name__)

# Applied in this order on every `migrate`. 003 must follow 002: 002 drops and
# recreates the materialized views, which discards their grants, and 003
# re-establishes them.
MIGRATIONS: tuple[str, ...] = (
    "001_schema.sql",
    "002_derived.sql",
    "003_roles.sql",
    "seed_assets.sql",
)

MATERIALIZED_VIEWS: tuple[str, ...] = (
    "daily_returns",
    "asset_metrics",
    "sector_daily",
)


@dataclass(frozen=True, slots=True)
class Asset:
    id: int
    ticker: str
    name: str
    asset_type: str
    sector: str
    source_symbol: str | None
    coingecko_id: str | None

    @property
    def provider_symbol(self) -> str:
        """Symbol to request from the OHLCV provider (e.g. BTC -> BTC-USD)."""
        return self.source_symbol or self.ticker


@contextmanager
def connect(url: str) -> Iterator[psycopg.Connection]:
    conn = psycopg.connect(url, autocommit=False)
    try:
        yield conn
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Migrations
# ---------------------------------------------------------------------------

def apply_migrations(conn: psycopg.Connection, settings: Settings) -> list[str]:
    """Apply every migration in order, then assign restricted-role passwords.

    Passwords are set here rather than in the SQL so the DDL contains no
    secrets and stays safe to commit.
    """
    applied: list[str] = []
    with conn.cursor() as cur:
        for filename in MIGRATIONS:
            path = DB_DIR / filename
            if not path.exists():
                raise FileNotFoundError(f"migration not found: {path}")
            log.info("applying %s", filename)
            cur.execute(path.read_text())
            applied.append(filename)

        for role, password in (
            ("sqlproj_api", settings.sqlproj_api_password),
            ("sqlproj_agent", settings.sqlproj_agent_password),
        ):
            cur.execute(
                sql.SQL("ALTER ROLE {} WITH PASSWORD {}").format(
                    sql.Identifier(role), sql.Literal(password)
                )
            )
    conn.commit()
    return applied


def refresh_views(conn: psycopg.Connection, concurrently: bool = True) -> list[str]:
    """Refresh the derived layer.

    CONCURRENTLY needs a UNIQUE index on each view (they all have one) and
    cannot run inside a transaction block, so this uses autocommit. It also
    cannot run against a view that has never been populated, hence the
    fallback to a plain refresh on the first pass.
    """
    done: list[str] = []
    previous = conn.autocommit
    conn.autocommit = True
    try:
        with conn.cursor() as cur:
            for view in MATERIALIZED_VIEWS:
                stmt = sql.SQL("REFRESH MATERIALIZED VIEW {} {}").format(
                    sql.SQL("CONCURRENTLY") if concurrently else sql.SQL(""),
                    sql.Identifier("market", view),
                )
                try:
                    cur.execute(stmt)
                except psycopg.errors.ObjectNotInPrerequisiteState:
                    # Never populated - CONCURRENTLY is not allowed yet.
                    log.info("%s not yet populated; plain refresh", view)
                    cur.execute(
                        sql.SQL("REFRESH MATERIALIZED VIEW {}").format(
                            sql.Identifier("market", view)
                        )
                    )
                done.append(view)
    finally:
        conn.autocommit = previous
    return done


# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------

def load_assets(conn: psycopg.Connection, only: Sequence[str] | None = None) -> list[Asset]:
    query = (
        "SELECT id, ticker, name, asset_type, sector, source_symbol, coingecko_id "
        "FROM market.assets WHERE is_active"
    )
    params: list = []
    if only:
        query += " AND ticker = ANY(%s)"
        params.append([t.upper() for t in only])
    query += " ORDER BY sector, ticker"

    with conn.cursor() as cur:
        cur.execute(query, params)
        return [Asset(*row) for row in cur.fetchall()]


def latest_dates(conn: psycopg.Connection) -> dict[int, date]:
    """Most recent bar per asset - the resume checkpoint.

    The checkpoint lives in the data itself rather than a side file, so it can
    never disagree with what was actually persisted.
    """
    with conn.cursor() as cur:
        cur.execute(
            "SELECT asset_id, max(date) FROM market.price_history GROUP BY asset_id"
        )
        return {asset_id: last for asset_id, last in cur.fetchall()}


def coverage_report(conn: psycopg.Connection) -> list[tuple]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT a.ticker, a.asset_type, a.sector,
                   count(p.date)  AS bars,
                   min(p.date)    AS first_date,
                   max(p.date)    AS last_date
            FROM market.assets a
            LEFT JOIN market.price_history p ON p.asset_id = a.id
            GROUP BY a.ticker, a.asset_type, a.sector
            ORDER BY a.sector, a.ticker
            """
        )
        return cur.fetchall()


# ---------------------------------------------------------------------------
# Writes
# ---------------------------------------------------------------------------

UPSERT = """
INSERT INTO market.price_history
    (asset_id, date, open, high, low, close, adj_close, volume, market_cap, source)
VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
ON CONFLICT (asset_id, date) DO UPDATE SET
    open        = EXCLUDED.open,
    high        = EXCLUDED.high,
    low         = EXCLUDED.low,
    close       = EXCLUDED.close,
    adj_close   = EXCLUDED.adj_close,
    volume      = EXCLUDED.volume,
    market_cap  = COALESCE(EXCLUDED.market_cap, market.price_history.market_cap),
    source      = EXCLUDED.source,
    ingested_at = now()
"""


def upsert_bars(
    conn: psycopg.Connection,
    asset_id: int,
    bars: Iterable[Bar],
    source: str,
    market_caps: dict[date, float] | None = None,
) -> int:
    """Insert-or-update bars. Idempotent: reruns are safe and pick up
    restatements (adjusted closes change after a split or dividend)."""
    caps = market_caps or {}
    rows = [
        (
            asset_id, b.date, b.open, b.high, b.low, b.close,
            b.adj_close, b.volume, caps.get(b.date), source,
        )
        for b in bars
    ]
    if not rows:
        return 0
    with conn.cursor() as cur:
        cur.executemany(UPSERT, rows)
    return len(rows)


# ---------------------------------------------------------------------------
# Run auditing
# ---------------------------------------------------------------------------

def start_run(conn: psycopg.Connection, command: str, source: str) -> int:
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO market.ingest_runs (command, source) VALUES (%s, %s) RETURNING id",
            (command, source),
        )
        run_id = cur.fetchone()[0]
    conn.commit()
    return run_id


def finish_run(
    conn: psycopg.Connection,
    run_id: int,
    *,
    attempted: int,
    succeeded: int,
    rows: int,
    status: str,
    detail: dict | None = None,
    error: str | None = None,
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE market.ingest_runs
               SET finished_at = now(), assets_attempted = %s, assets_succeeded = %s,
                   rows_upserted = %s, status = %s, detail = %s, error = %s
             WHERE id = %s
            """,
            (attempted, succeeded, rows, status, json.dumps(detail or {}), error, run_id),
        )
    conn.commit()
