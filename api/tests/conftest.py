"""Shared test fixtures."""

from __future__ import annotations

import os
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]


def _load_env() -> dict[str, str]:
    """Read the repo-root .env without adding a dependency on the app package."""
    env: dict[str, str] = {}
    path = REPO_ROOT / ".env"
    if path.exists():
        for line in path.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, _, value = line.partition("=")
                value = value.strip()
                # Values are quoted in .env because the connection strings
                # contain '&', which an unquoted `source` treats as job
                # control. Strip the quotes as a dotenv parser would.
                if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                    value = value[1:-1]
                env[key.strip()] = value
    return {**env, **os.environ}


@pytest.fixture(scope="session")
def env() -> dict[str, str]:
    return _load_env()


@pytest.fixture(scope="session")
def agent_url(env) -> str:
    """Connection string for the restricted agent role.

    Prefers the direct endpoint when one is configured: these tests flip
    session-level settings, and a transaction pooler discards those between
    statements.
    """
    url = env.get("DATABASE_URL_AGENT_DIRECT") or env.get("DATABASE_URL_AGENT")
    if not url:
        pytest.skip("DATABASE_URL_AGENT not configured")
    return url


@pytest.fixture(scope="session")
def owner_url(env) -> str:
    url = env.get("DATABASE_URL")
    if not url:
        pytest.skip("DATABASE_URL not configured")
    return url


# ---------------------------------------------------------------------------
# The universe is read from the database rather than hardcoded. Tests that
# asserted `== 16` had to be edited every time an asset was added, and the
# literal appeared in disguised forms (`256` for the correlation matrix,
# `range(1, 17)` for volatility ranks) that a grep for "16" would miss.
# ---------------------------------------------------------------------------

@pytest.fixture(scope="session")
def universe(owner_url) -> dict:
    import psycopg

    with psycopg.connect(owner_url) as conn, conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM market.assets WHERE is_active")
        count = cur.fetchone()[0]
        cur.execute("SELECT DISTINCT sector FROM market.assets WHERE is_active")
        sectors = {r[0] for r in cur.fetchall()}
        cur.execute(
            "SELECT min(n) FROM (SELECT count(*) n FROM market.price_history"
            " GROUP BY asset_id) x"
        )
        min_bars = cur.fetchone()[0]
    return {"count": count, "sectors": sectors, "min_bars": min_bars}


@pytest.fixture(scope="session")
def asset_count(universe) -> int:
    return universe["count"]
