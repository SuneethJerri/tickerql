"""AST validation for model-generated SQL.

The real boundary is the database (db/003_roles.sql): sqlproj_agent has no
write grant. This layer adds early, legible rejection the model can correct
from, using an allowlist rather than a denylist.

Checking the root node is not sufficient. A data-modifying CTE such as

    WITH evil AS (INSERT INTO market.assets VALUES (...) RETURNING *)
    SELECT * FROM evil

parses with a Select at the root, so every node is inspected.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import sqlglot
from sqlglot import exp

log = logging.getLogger(__name__)

DIALECT = "postgres"

# Mirrors the GRANT list in db/003_roles.sql. The two must stay in sync; the
# database is authoritative, this is the early check.
ALLOWED_RELATIONS: frozenset[str] = frozenset(
    {"assets", "price_history", "daily_returns", "asset_metrics", "sector_daily"}
)
ALLOWED_SCHEMAS: frozenset[str] = frozenset({"", "market"})

# Statement kinds that may appear at the root.
ALLOWED_ROOTS: tuple[type[exp.Expression], ...] = (
    exp.Select,
    exp.Union,
    exp.Intersect,
    exp.Except,
)

# Any of these anywhere in the tree rejects the statement.
FORBIDDEN_NODES: tuple[type[exp.Expression], ...] = (
    exp.Insert, exp.Update, exp.Delete, exp.Merge,
    exp.Drop, exp.Create, exp.Alter, exp.TruncateTable,
    exp.Grant, exp.Copy, exp.Set, exp.Transaction, exp.Commit, exp.Rollback,
    exp.Command,   # sqlglot's catch-all for statements it does not model
    exp.Lock,      # SELECT ... FOR UPDATE takes row locks
)

# Functions that read the filesystem, reach the network, sleep, or mutate
# session state. None are reachable via the agent's grants, but rejecting them
# here turns a confusing privilege error into a clear one.
FORBIDDEN_FUNCTIONS: frozenset[str] = frozenset({
    "pg_sleep", "pg_sleep_for", "pg_sleep_until",
    "pg_read_file", "pg_read_binary_file", "pg_ls_dir", "pg_stat_file",
    "lo_import", "lo_export",
    "dblink", "dblink_exec", "dblink_connect",
    "query_to_xml", "query_to_xml_and_xmlschema", "database_to_xml",
    "set_config", "pg_terminate_backend", "pg_cancel_backend",
    "pg_reload_conf", "pg_rotate_logfile",
})

MAX_SQL_LENGTH = 20_000


@dataclass(frozen=True, slots=True)
class GuardResult:
    ok: bool
    sql: str | None = None
    reason: str | None = None

    @property
    def error(self) -> str:
        return self.reason or "rejected"


def _reject(reason: str) -> GuardResult:
    log.warning("guard rejected generated SQL: %s", reason)
    return GuardResult(ok=False, reason=reason)


def _cte_aliases(tree: exp.Expression) -> set[str]:
    """Names bound by WITH clauses.

    sqlglot represents a reference to a CTE as a Table node, so without this
    every CTE name would look like an unauthorised relation.
    """
    aliases: set[str] = set()
    for cte in tree.find_all(exp.CTE):
        alias = cte.alias_or_name
        if alias:
            aliases.add(alias.lower())
    return aliases


def _relation_name(table: exp.Table) -> tuple[str, str]:
    schema = (table.text("db") or "").lower()
    name = (table.name or "").lower()
    return schema, name


def _function_names(tree: exp.Expression) -> set[str]:
    names: set[str] = set()
    for node in tree.find_all(exp.Anonymous):
        if node.name:
            names.add(node.name.lower())
    for node in tree.find_all(exp.Func):
        # Known functions expose a sql_name(); anonymous ones are covered above.
        try:
            name = node.sql_name()
        except Exception:  # noqa: BLE001 - defensive; sql_name is best effort
            continue
        if name:
            names.add(name.lower())
    return names


def validate(sql: str, *, max_rows: int = 1000) -> GuardResult:
    """Validate model-generated SQL, returning rewritten SQL on success.

    On success the returned SQL has a LIMIT applied when the model omitted one,
    so a well-formed but unbounded query cannot stream an entire table back.
    """
    if not sql or not sql.strip():
        return _reject("Empty query.")

    if len(sql) > MAX_SQL_LENGTH:
        return _reject(f"Query exceeds {MAX_SQL_LENGTH} characters.")

    try:
        statements = sqlglot.parse(sql, dialect=DIALECT)
    except Exception as exc:  # noqa: BLE001 - any parse failure is a rejection
        return _reject(f"Could not parse as PostgreSQL: {type(exc).__name__}.")

    statements = [s for s in statements if s is not None]
    if not statements:
        return _reject("No statement found.")
    if len(statements) > 1:
        # Blocks the classic "; DROP TABLE" tail as well as accidental batches.
        return _reject(
            f"Expected exactly one statement, found {len(statements)}. "
            "Submit a single SELECT."
        )

    tree = statements[0]

    if not isinstance(tree, ALLOWED_ROOTS):
        return _reject(
            f"Only SELECT queries are permitted; got {type(tree).__name__.upper()}."
        )

    # Every node, not just the root - see the module docstring on data-modifying CTEs.
    for node in tree.walk():
        if isinstance(node, FORBIDDEN_NODES):
            return _reject(
                f"{type(node).__name__.upper()} is not permitted; this role is read-only."
            )

    allowed_local = _cte_aliases(tree)
    for table in tree.find_all(exp.Table):
        schema, name = _relation_name(table)
        if not schema and name in allowed_local:
            continue  # a CTE reference, not a base relation
        if schema not in ALLOWED_SCHEMAS:
            return _reject(
                f"Schema {schema!r} is not readable. Use the market schema."
            )
        if name not in ALLOWED_RELATIONS:
            return _reject(
                f"Relation {name!r} is not readable. Available: "
                + ", ".join(sorted(ALLOWED_RELATIONS))
                + "."
            )

    used = _function_names(tree)
    banned = used & FORBIDDEN_FUNCTIONS
    if banned:
        return _reject(f"Function(s) not permitted: {', '.join(sorted(banned))}.")

    # Bound the result set when the model did not.
    try:
        if tree.args.get("limit") is None:
            tree = tree.limit(max_rows)
        else:
            existing = tree.args["limit"].expression
            if isinstance(existing, exp.Literal) and existing.is_int:
                if int(existing.name) > max_rows:
                    tree = tree.limit(max_rows)
    except Exception:  # noqa: BLE001 - never fail the request over LIMIT rewriting
        log.exception("could not apply LIMIT; passing query through unbounded")

    return GuardResult(ok=True, sql=tree.sql(dialect=DIALECT, pretty=True))
