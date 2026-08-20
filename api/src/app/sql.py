"""Loader for the hand-written analytics queries in db/queries/.

Queries live as .sql files rather than as Python string literals so that the
exact text validated by the test suite is the exact text the endpoints
execute. Embedding SQL in Python would let the tested query and the shipped
query drift apart silently.

Parameters use psycopg's named placeholders (%(name)s) throughout, so no
value is ever interpolated into SQL text.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any, Sequence

import psycopg
from psycopg.rows import dict_row

# api/src/app/sql.py -> repo root is four levels up.
REPO_ROOT = Path(__file__).resolve().parents[3]
QUERY_DIR = REPO_ROOT / "db" / "queries"


@lru_cache(maxsize=None)
def load(name: str) -> str:
    """Return the text of a named query, e.g. load("sector_performance")."""
    filename = name if name.endswith(".sql") else f"{name}.sql"
    path = QUERY_DIR / filename
    # Defend against traversal: the resolved path must stay inside QUERY_DIR.
    resolved = path.resolve()
    if not resolved.is_relative_to(QUERY_DIR.resolve()):
        raise ValueError(f"query name escapes the query directory: {name!r}")
    if not resolved.exists():
        raise FileNotFoundError(f"no such query: {resolved}")
    return resolved.read_text()


def available() -> list[str]:
    return sorted(p.stem for p in QUERY_DIR.glob("*.sql"))


def fetch_all(
    conn: psycopg.Connection, name: str, params: dict[str, Any] | None = None
) -> list[dict[str, Any]]:
    """Run a named query and return rows as dicts."""
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(load(name), params or {})
        return cur.fetchall()


def fetch_columns(
    conn: psycopg.Connection, name: str, params: dict[str, Any] | None = None
) -> tuple[list[str], list[Sequence[Any]]]:
    """Run a named query and return (column names, rows) for tabular output."""
    with conn.cursor() as cur:
        cur.execute(load(name), params or {})
        columns = [d.name for d in cur.description] if cur.description else []
        return columns, cur.fetchall()
