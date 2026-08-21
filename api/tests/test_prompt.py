"""Guards the hand-written system prompt against schema drift.

The prompt describes the schema in prose because the valuable parts — that
returns come from adjusted close, that annualisation differs by asset type —
cannot be generated from information_schema. The cost of hand-writing it is
that it can go stale, and a prompt describing a column that no longer exists
produces confidently wrong SQL.

These tests close that gap: every relation and column named in the prompt must
exist in the database, and every relation the agent is granted must be
documented.
"""

from __future__ import annotations

import re

import psycopg
import pytest

from app.agent.guard import ALLOWED_RELATIONS
from app.agent.prompt import FEW_SHOTS, SCHEMA, SYSTEM_PROMPT

RELATION_RE = re.compile(r"^market\.(\w+)\s+—", re.MULTILINE)
COLUMN_RE = re.compile(r"^  ([a-z_][a-z_0-9/]*)\s+\S")


def documented_schema() -> dict[str, set[str]]:
    """Parse relation -> column names out of the prompt's SCHEMA block."""
    out: dict[str, set[str]] = {}
    current: str | None = None
    for line in SCHEMA.splitlines():
        header = RELATION_RE.match(line)
        if header:
            current = header.group(1)
            out[current] = set()
            continue
        if current:
            column = COLUMN_RE.match(line)
            if column:
                # "open/high/low" documents three columns on one line.
                out[current].update(column.group(1).split("/"))
    return out


@pytest.fixture(scope="module")
def actual_schema(owner_url: str) -> dict[str, set[str]]:
    with psycopg.connect(owner_url) as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT c.relname, a.attname
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            JOIN pg_attribute a ON a.attrelid = c.oid
            WHERE n.nspname = 'market' AND a.attnum > 0 AND NOT a.attisdropped
              AND c.relkind IN ('r', 'v', 'm')
            """
        )
        schema: dict[str, set[str]] = {}
        for relation, column in cur.fetchall():
            schema.setdefault(relation, set()).add(column)
        return schema


def test_prompt_documents_relations(actual_schema) -> None:
    assert documented_schema(), "failed to parse any relation out of the prompt"


def test_every_documented_relation_exists(actual_schema) -> None:
    for relation in documented_schema():
        assert relation in actual_schema, (
            f"prompt documents market.{relation}, which does not exist"
        )


def test_every_documented_column_exists(actual_schema) -> None:
    """The failure this prevents: the model writing confident SQL against a
    column that was renamed or dropped."""
    problems = []
    for relation, columns in documented_schema().items():
        for column in columns:
            if column not in actual_schema.get(relation, set()):
                problems.append(f"market.{relation}.{column}")
    assert not problems, f"prompt documents non-existent columns: {problems}"


def test_prompt_documents_every_relation_the_agent_can_read(actual_schema) -> None:
    """If a relation is granted but undocumented, the model cannot use it and
    the grant is silently dead weight — or worse, it finds it by guessing."""
    documented = set(documented_schema())
    assert ALLOWED_RELATIONS <= documented, (
        f"granted but undocumented: {ALLOWED_RELATIONS - documented}"
    )


def test_prompt_documents_nothing_the_agent_cannot_read(actual_schema) -> None:
    """The inverse: describing ingest_runs would invite queries that can only
    ever fail."""
    documented = set(documented_schema())
    assert documented <= ALLOWED_RELATIONS, (
        f"documented but not granted: {documented - ALLOWED_RELATIONS}"
    )


def test_few_shot_sql_passes_the_guard() -> None:
    """Examples the model is told to imitate must themselves be legal. A
    few-shot the guard would reject teaches the model to produce rejects."""
    from app.agent.guard import validate

    for question, sql in FEW_SHOTS:
        result = validate(sql)
        assert result.ok, f"few-shot for {question!r} is rejected: {result.reason}"


def test_few_shot_sql_actually_runs(owner_url: str) -> None:
    """And they must execute — a syntactically valid example that errors would
    be teaching the model a broken pattern."""
    with psycopg.connect(owner_url) as conn:
        for question, sql in FEW_SHOTS:
            with conn.cursor() as cur:
                try:
                    cur.execute(sql)
                    cur.fetchall()
                except psycopg.Error as exc:
                    conn.rollback()
                    pytest.fail(f"few-shot for {question!r} failed: {exc}")
            conn.rollback()


def test_prompt_contains_no_volatile_content() -> None:
    """Anything that varies per request would invalidate the prompt cache on
    every call, silently turning a ~2.3k-token cached prefix into a full-price
    one."""
    for marker in ("timestamp", "session_id", "user_id", "request_id"):
        assert marker not in SYSTEM_PROMPT.lower()
    # A bare 4-digit year is fine; an embedded full date would not be.
    assert not re.search(r"\d{4}-\d{2}-\d{2}T", SYSTEM_PROMPT)


# ---------------------------------------------------------------------------
# The prompt states an asset count and enumerates the sectors. Nothing checked
# either, so growing the universe from 16 to 105 would have left the model
# being told there were 16 assets in five sectors that no longer exist -
# degrading every answer with no test failing anywhere.
# ---------------------------------------------------------------------------

def test_prompt_states_the_real_asset_count(owner_url) -> None:
    import re

    import psycopg

    with psycopg.connect(owner_url) as conn, conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM market.assets WHERE is_active")
        actual = cur.fetchone()[0]

    stated = re.search(r"the tracked universe \((\d+) rows", SYSTEM_PROMPT)
    assert stated, "the prompt no longer states an asset count"
    assert int(stated.group(1)) == actual, (
        f"prompt says {stated.group(1)} assets, database has {actual}"
    )


def test_prompt_lists_every_real_sector(owner_url) -> None:
    import psycopg

    with psycopg.connect(owner_url) as conn, conn.cursor() as cur:
        cur.execute("SELECT DISTINCT sector FROM market.assets WHERE is_active")
        sectors = {r[0] for r in cur.fetchall()}

    missing = {s for s in sectors if f"'{s}'" not in SYSTEM_PROMPT}
    assert not missing, f"sectors absent from the prompt: {sorted(missing)}"
