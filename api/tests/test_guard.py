"""Adversarial tests for the model-generated SQL guard.

This is defence layer 2. Layer 1 (database grants) is proved separately in
test_db_privileges.py and remains the actual boundary — but a guard that leaks
would let hostile SQL reach the database at all, so it gets tested as if it
were the only thing standing there.

If a case here starts failing, do not relax the assertion.
"""

from __future__ import annotations

import pytest

from app.agent.guard import validate

# ---------------------------------------------------------------------------
# Must be rejected
# ---------------------------------------------------------------------------

WRITES = [
    ("insert", "INSERT INTO market.assets (ticker) VALUES ('X')"),
    ("update", "UPDATE market.price_history SET close = 1"),
    ("delete", "DELETE FROM market.price_history"),
    ("drop", "DROP TABLE market.price_history"),
    ("create", "CREATE TABLE market.evil (id int)"),
    ("alter", "ALTER TABLE market.assets ADD COLUMN evil int"),
    ("truncate", "TRUNCATE market.price_history"),
    ("grant", "GRANT ALL ON market.assets TO sqlproj_agent"),
    ("copy_out", "COPY market.assets TO '/tmp/leak.csv'"),
    ("copy_in", "COPY market.assets FROM '/tmp/evil.csv'"),
    ("set", "SET statement_timeout = 0"),
    ("begin", "BEGIN"),
]


@pytest.mark.parametrize("label,sql", WRITES, ids=[c[0] for c in WRITES])
def test_write_statements_are_rejected(label: str, sql: str) -> None:
    assert validate(sql).ok is False


STACKED = [
    ("select_then_drop", "SELECT 1 FROM market.assets; DROP TABLE market.assets"),
    ("select_then_insert", "SELECT 1 FROM market.assets; INSERT INTO market.assets VALUES ('x')"),
    ("trailing_semicolon_then_stmt", "SELECT ticker FROM market.assets;; DELETE FROM market.assets"),
]


@pytest.mark.parametrize("label,sql", STACKED, ids=[c[0] for c in STACKED])
def test_stacked_statements_are_rejected(label: str, sql: str) -> None:
    """The classic '; DROP TABLE' tail."""
    result = validate(sql)
    assert result.ok is False
    assert "one statement" in result.error.lower()


DATA_MODIFYING_CTES = [
    (
        "cte_insert",
        "WITH evil AS (INSERT INTO market.assets (ticker,name,asset_type,sector) "
        "VALUES ('X','X','stock','X') RETURNING *) SELECT * FROM evil",
    ),
    (
        "cte_update",
        "WITH evil AS (UPDATE market.price_history SET close = 1 RETURNING *) "
        "SELECT * FROM evil",
    ),
    (
        "cte_delete",
        "WITH evil AS (DELETE FROM market.price_history RETURNING *) SELECT * FROM evil",
    ),
    (
        "nested_cte_delete",
        "WITH outer_q AS (WITH inner_q AS (DELETE FROM market.assets RETURNING *) "
        "SELECT * FROM inner_q) SELECT * FROM outer_q",
    ),
]


@pytest.mark.parametrize("label,sql", DATA_MODIFYING_CTES, ids=[c[0] for c in DATA_MODIFYING_CTES])
def test_data_modifying_ctes_are_rejected(label: str, sql: str) -> None:
    """The important one.

    PostgreSQL permits DML inside a CTE, and such a statement parses with a
    SELECT at the root. A guard that inspected only the root node would wave
    every one of these through.
    """
    assert validate(sql).ok is False


FORBIDDEN_RELATIONS = [
    ("ingest_runs", "SELECT * FROM market.ingest_runs"),
    ("pg_authid", "SELECT * FROM pg_authid"),
    ("pg_shadow", "SELECT * FROM pg_catalog.pg_shadow"),
    ("information_schema", "SELECT * FROM information_schema.tables"),
    ("public_schema", "SELECT * FROM public.something"),
    ("subquery_reach", "SELECT * FROM market.assets WHERE id IN (SELECT id FROM market.ingest_runs)"),
    ("join_reach", "SELECT * FROM market.assets a JOIN market.ingest_runs r ON true"),
    ("union_reach", "SELECT ticker FROM market.assets UNION ALL SELECT command FROM market.ingest_runs"),
    ("cte_reach", "WITH x AS (SELECT * FROM market.ingest_runs) SELECT * FROM x"),
]


@pytest.mark.parametrize("label,sql", FORBIDDEN_RELATIONS, ids=[c[0] for c in FORBIDDEN_RELATIONS])
def test_relations_outside_the_allowlist_are_rejected(label: str, sql: str) -> None:
    """Reaching a forbidden relation must fail regardless of how it is nested."""
    assert validate(sql).ok is False


FORBIDDEN_FUNCS = [
    ("pg_sleep", "SELECT pg_sleep(30)"),
    ("pg_read_file", "SELECT pg_read_file('/etc/passwd')"),
    ("pg_ls_dir", "SELECT pg_ls_dir('/')"),
    ("dblink", "SELECT dblink('host=evil', 'SELECT 1')"),
    ("lo_import", "SELECT lo_import('/etc/passwd')"),
    ("set_config", "SELECT set_config('statement_timeout','0',false)"),
    ("nested_sleep", "SELECT ticker FROM market.assets WHERE pg_sleep(10) IS NULL"),
]


@pytest.mark.parametrize("label,sql", FORBIDDEN_FUNCS, ids=[c[0] for c in FORBIDDEN_FUNCS])
def test_forbidden_functions_are_rejected(label: str, sql: str) -> None:
    assert validate(sql).ok is False


def test_row_locking_is_rejected() -> None:
    """SELECT ... FOR UPDATE takes write locks despite being a SELECT."""
    assert validate("SELECT * FROM market.assets FOR UPDATE").ok is False


@pytest.mark.parametrize("sql", ["", "   ", "\n\t "])
def test_empty_input_is_rejected(sql: str) -> None:
    assert validate(sql).ok is False


def test_unparseable_input_is_rejected() -> None:
    assert validate("this is not sql at all !!!").ok is False


def test_oversized_input_is_rejected() -> None:
    assert validate("SELECT 1 FROM market.assets WHERE " + "x=1 AND " * 5000 + "1=1").ok is False


# ---------------------------------------------------------------------------
# Must be allowed — a guard that blocks legitimate analytics is also broken
# ---------------------------------------------------------------------------

LEGITIMATE = [
    ("simple", "SELECT ticker, name FROM market.assets"),
    ("unqualified", "SELECT ticker FROM assets"),
    ("join", """
        SELECT a.ticker, m.annualized_volatility
        FROM market.asset_metrics m
        JOIN market.assets a ON a.id = m.asset_id
        WHERE m.window_days = 365
     """),
    ("cte", """
        WITH ranked AS (
            SELECT asset_id, annualized_volatility,
                   rank() OVER (ORDER BY annualized_volatility DESC) AS rnk
            FROM market.asset_metrics WHERE window_days = 90
        )
        SELECT * FROM ranked WHERE rnk <= 5
     """),
    ("aggregate", """
        SELECT a.sector, avg(m.annualized_return) AS avg_return
        FROM market.asset_metrics m JOIN market.assets a ON a.id = m.asset_id
        GROUP BY a.sector HAVING count(*) > 1 ORDER BY avg_return DESC
     """),
    ("window_fn", """
        SELECT date, close, avg(close) OVER (ORDER BY date ROWS BETWEEN 19 PRECEDING AND CURRENT ROW)
        FROM market.daily_returns WHERE asset_id = 1
     """),
    ("union", "SELECT ticker FROM market.assets UNION ALL SELECT sector FROM market.sector_daily"),
    ("subquery", "SELECT * FROM (SELECT ticker FROM market.assets) t"),
    ("correlation", """
        SELECT corr(r1.simple_return, r2.simple_return)
        FROM market.daily_returns r1 JOIN market.daily_returns r2 ON r1.date = r2.date
     """),
]


@pytest.mark.parametrize("label,sql", LEGITIMATE, ids=[c[0] for c in LEGITIMATE])
def test_legitimate_analytics_queries_are_allowed(label: str, sql: str) -> None:
    result = validate(sql)
    assert result.ok is True, f"rejected a legitimate query: {result.reason}"
    assert result.sql


# ---------------------------------------------------------------------------
# LIMIT rewriting
# ---------------------------------------------------------------------------

def test_limit_is_injected_when_absent() -> None:
    result = validate("SELECT ticker FROM market.assets", max_rows=500)
    assert result.ok
    assert "LIMIT 500" in result.sql


def test_existing_smaller_limit_is_preserved() -> None:
    result = validate("SELECT ticker FROM market.assets LIMIT 10", max_rows=500)
    assert result.ok
    assert "LIMIT 10" in result.sql
    assert "LIMIT 500" not in result.sql


def test_oversized_limit_is_clamped() -> None:
    """A model asking for a million rows gets the cap, not the request."""
    result = validate("SELECT ticker FROM market.assets LIMIT 1000000", max_rows=500)
    assert result.ok
    assert "LIMIT 500" in result.sql
    assert "1000000" not in result.sql


def test_rejection_reasons_are_actionable() -> None:
    """The reason is fed back to the model to self-correct, so it has to say
    what was wrong and what is available."""
    result = validate("SELECT * FROM market.ingest_runs")
    assert result.ok is False
    assert "ingest_runs" in result.reason
    assert "price_history" in result.reason  # lists what it may read instead
