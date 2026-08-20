"""Proof that the text-to-SQL agent's database role cannot write.

This is the test that backs the platform's core security claim. It is
deliberately adversarial: it does not merely check that writes fail, it checks
that they fail *for the right reason* and that they still fail once an attacker
has disabled every session-level convenience setting.

If any test here starts failing, the security boundary is broken. Do not
"fix" it by relaxing the assertions.
"""

from __future__ import annotations

import psycopg
import pytest

# Statements the agent role must never be able to execute.
WRITE_STATEMENTS = [
    ("insert", "INSERT INTO market.assets (ticker,name,asset_type,sector) VALUES ('EVIL','E','stock','E')"),
    ("update", "UPDATE market.price_history SET close = 1"),
    ("delete", "DELETE FROM market.price_history"),
    ("truncate", "TRUNCATE market.price_history"),
    ("drop_table", "DROP TABLE market.price_history"),
    ("drop_view", "DROP MATERIALIZED VIEW market.daily_returns"),
    ("create_table", "CREATE TABLE market.evil (id int)"),
    ("create_table_public", "CREATE TABLE public.evil (id int)"),
    ("alter_table", "ALTER TABLE market.assets ADD COLUMN evil int"),
    ("create_role", "CREATE ROLE evil LOGIN"),
    ("copy_to_file", "COPY market.assets TO '/tmp/leak.csv'"),
]

# Relations the agent role must not be able to read.
FORBIDDEN_READS = [
    ("ingest_runs", "SELECT * FROM market.ingest_runs"),
    ("pg_authid", "SELECT * FROM pg_authid"),
]

# Relations the agent role legitimately needs.
ALLOWED_READS = [
    "market.assets",
    "market.price_history",
    "market.daily_returns",
    "market.asset_metrics",
    "market.sector_daily",
]


@pytest.mark.parametrize("label,stmt", WRITE_STATEMENTS, ids=[s[0] for s in WRITE_STATEMENTS])
def test_write_is_rejected(agent_url: str, label: str, stmt: str) -> None:
    """Every write must be rejected under default session settings."""
    with psycopg.connect(agent_url, autocommit=True) as conn, conn.cursor() as cur:
        with pytest.raises(
            (psycopg.errors.InsufficientPrivilege, psycopg.errors.ReadOnlySqlTransaction)
        ):
            cur.execute(stmt)


@pytest.mark.parametrize("label,stmt", WRITE_STATEMENTS, ids=[s[0] for s in WRITE_STATEMENTS])
def test_write_is_rejected_by_grants_not_just_session_flags(
    agent_url: str, label: str, stmt: str
) -> None:
    """The critical test.

    `default_transaction_read_only` is a role default, and a role may override
    its own defaults with SET. If that flag were the only thing stopping
    writes, the boundary would be cosmetic. Disable it first, then assert the
    write STILL fails - this time necessarily because of the grants.
    """
    with psycopg.connect(agent_url, autocommit=True) as conn, conn.cursor() as cur:
        cur.execute("SET default_transaction_read_only = off")
        cur.execute("SHOW default_transaction_read_only")
        assert cur.fetchone()[0] == "off", "override did not take effect; test is vacuous"

        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            cur.execute(stmt)


def test_self_grant_confers_nothing(agent_url: str) -> None:
    """A self-GRANT must not escalate privileges.

    PostgreSQL does NOT raise for a GRANT issued by a non-owner without grant
    option - it emits a warning ("no privileges were granted") and does
    nothing. So asserting that an exception is raised here would be asserting
    the wrong mechanism, and would pass for the wrong reason. Assert the
    EFFECT instead: after the attempt, the role still holds no write privilege
    and the write still fails.
    """
    with psycopg.connect(agent_url, autocommit=True) as conn, conn.cursor() as cur:
        cur.execute("SET default_transaction_read_only = off")
        cur.execute("GRANT ALL ON market.assets TO sqlproj_agent")  # warns, no-ops

        cur.execute("SELECT has_table_privilege('sqlproj_agent','market.assets','INSERT')")
        assert cur.fetchone()[0] is False, "self-GRANT conferred INSERT - real escalation"
        cur.execute("SELECT has_table_privilege('sqlproj_agent','market.assets','UPDATE')")
        assert cur.fetchone()[0] is False, "self-GRANT conferred UPDATE - real escalation"
        cur.execute("SELECT has_table_privilege('sqlproj_agent','market.assets','SELECT')")
        assert cur.fetchone()[0] is True, "agent lost its legitimate SELECT"

        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            cur.execute(
                "INSERT INTO market.assets (ticker,name,asset_type,sector) "
                "VALUES ('EVIL','E','stock','E')"
            )


@pytest.mark.parametrize("label,stmt", FORBIDDEN_READS, ids=[s[0] for s in FORBIDDEN_READS])
def test_forbidden_reads_are_rejected(agent_url: str, label: str, stmt: str) -> None:
    """Operational and system tables are outside the allowlist."""
    with psycopg.connect(agent_url, autocommit=True) as conn, conn.cursor() as cur:
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            cur.execute(stmt)


@pytest.mark.parametrize("relation", ALLOWED_READS)
def test_allowed_reads_succeed(agent_url: str, relation: str) -> None:
    """The role must still be able to do its actual job."""
    with psycopg.connect(agent_url, autocommit=True) as conn, conn.cursor() as cur:
        cur.execute(f"SELECT count(*) FROM {relation}")
        assert cur.fetchone()[0] >= 0


def test_future_tables_are_not_readable_by_default(owner_url: str, agent_url: str) -> None:
    """ALTER DEFAULT PRIVILEGES must stop a newly created table leaking in.

    Without this, adding a table in a later migration would silently widen the
    agent's reach.
    """
    with psycopg.connect(owner_url, autocommit=True) as owner, owner.cursor() as cur:
        cur.execute("CREATE TABLE IF NOT EXISTS market.privilege_probe (id int)")
    try:
        with psycopg.connect(agent_url, autocommit=True) as conn, conn.cursor() as cur:
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                cur.execute("SELECT * FROM market.privilege_probe")
    finally:
        with psycopg.connect(owner_url, autocommit=True) as owner, owner.cursor() as cur:
            cur.execute("DROP TABLE IF EXISTS market.privilege_probe")


def test_role_attributes_are_locked_down(owner_url: str) -> None:
    """The role must not be superuser or able to create roles/databases."""
    with psycopg.connect(owner_url, autocommit=True) as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT rolsuper, rolcreatedb, rolcreaterole, rolbypassrls, rolconnlimit "
            "FROM pg_roles WHERE rolname = 'sqlproj_agent'"
        )
        row = cur.fetchone()
        assert row is not None, "sqlproj_agent role does not exist"
        superuser, createdb, createrole, bypassrls, connlimit = row
        assert not superuser
        assert not createdb
        assert not createrole
        assert not bypassrls
        assert 0 < connlimit <= 10, f"connection limit should be bounded, got {connlimit}"


def test_statement_timeout_is_a_default_not_a_guarantee(agent_url: str) -> None:
    """Documents a real limitation rather than asserting a false guarantee.

    `statement_timeout` is set via ALTER ROLE, which the role can override for
    its own session. It therefore bounds honest queries but is NOT a defence
    against a hostile one. The actual protection against a runaway generated
    query is that the AST guard permits a single SELECT and no SET, and that
    the application sets the timeout itself per transaction.
    """
    with psycopg.connect(agent_url, autocommit=True) as conn, conn.cursor() as cur:
        cur.execute("SHOW statement_timeout")
        assert cur.fetchone()[0] == "5s", "role default timeout is not applied"

        cur.execute("SET statement_timeout = '600s'")
        cur.execute("SHOW statement_timeout")
        assert cur.fetchone()[0] == "10min", (
            "if this now fails, PostgreSQL has made statement_timeout non-overridable "
            "and the guard comment in agent/guard.py can be relaxed"
        )
