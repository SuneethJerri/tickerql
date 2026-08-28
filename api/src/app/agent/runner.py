"""The text-to-SQL agent loop.

question -> model proposes SQL via the `run_sql` tool -> guard validates ->
the restricted role executes -> rows go back -> model answers in prose.

A manual loop rather than the SDK's tool_runner, for a hard ceiling on model
calls and an audit record of every candidate SQL string, accepted or rejected.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Iterable, Protocol, Sequence

import psycopg
from psycopg import sql as pgsql

from app.agent import guard
from app.agent.prompt import system_blocks

log = logging.getLogger(__name__)

# A progress callback, fired at every boundary in the loop worth reporting.
ProgressEvent = dict[str, Any]
Progress = Callable[[ProgressEvent], None]

MAX_MODEL_CALLS = 3
# Rows handed back to the model. The API response carries the full result; the
# model only needs enough to describe the shape and quote figures, and every
# extra row is input tokens on the next turn.
MAX_ROWS_TO_MODEL = 50
STATEMENT_TIMEOUT = "5s"

RUN_SQL_TOOL: dict[str, Any] = {
    "name": "run_sql",
    "description": (
        "Execute a single read-only PostgreSQL SELECT against the market "
        "analytics database and return the resulting rows. The database role "
        "is physically read-only and can read only market.assets, "
        "market.price_history, market.daily_returns, market.asset_metrics and "
        "market.sector_daily. If the query is rejected or errors, you receive "
        "the reason and may correct it and call this tool again."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "sql": {
                "type": "string",
                "description": "One PostgreSQL SELECT statement. No semicolons, no DDL, no DML.",
            }
        },
        "required": ["sql"],
    },
}


class AgentUnavailable(RuntimeError):
    """Raised when the agent cannot run - typically a missing API key."""


_LEAKED_TOOL_CALL_MARKERS = (
    "<function",
    "<tool_call",
    "run_sql(",
    '"name": "run_sql"',
    '"name":"run_sql"',
)


def _looks_like_leaked_tool_call(text: str) -> bool:
    """True when the model printed its tool call instead of emitting one."""
    lowered = text.lower()
    return any(marker.lower() in lowered for marker in _LEAKED_TOOL_CALL_MARKERS)


class AgentRefused(RuntimeError):
    """Raised when the model declines the request (stop_reason == 'refusal')."""


class ModelCallFailed(RuntimeError):
    """An upstream model call that came back with an HTTP status.

    Carries the status so the router can tell a rejected credential - a
    configuration problem only an operator can fix - from a gateway hiccup the
    caller can usefully retry. Collapsed into one 502 they are indistinguishable
    from the response, and a revoked key means a dive through the deploy logs.
    """

    def __init__(self, status: int) -> None:
        super().__init__(f"The model provider returned HTTP {status}.")
        self.status = status


class MessagesClient(Protocol):
    """The slice of the Anthropic client this module uses.

    Narrow on purpose: it is the whole surface a test double has to implement.
    """

    def create(self, **kwargs: Any) -> Any: ...


@dataclass(slots=True)
class Attempt:
    """One candidate SQL string and what became of it."""

    sql: str
    accepted: bool
    rejection: str | None = None
    error: str | None = None
    row_count: int | None = None
    elapsed_ms: int | None = None


@dataclass(slots=True)
class AgentResult:
    question: str
    answer: str
    sql: str | None
    columns: list[str] = field(default_factory=list)
    rows: list[list[Any]] = field(default_factory=list)
    row_count: int = 0
    truncated: bool = False
    attempts: list[Attempt] = field(default_factory=list)
    model_calls: int = 0
    elapsed_ms: int = 0
    model_ms: int = 0
    usage: dict[str, int] = field(default_factory=dict)


def _execute(conn: psycopg.Connection, statement: str) -> tuple[list[str], list[tuple]]:
    """Run validated SQL inside an explicitly read-only, time-bounded transaction.

    The role already defaults to read-only with a 5s timeout, but a role
    default is overridable by the session (see D-24 / test_db_privileges.py),
    so the application asserts both per transaction rather than inheriting them.
    """
    with conn.transaction():
        with conn.cursor() as cur:
            # Must be the first statement in the transaction.
            cur.execute("SET TRANSACTION READ ONLY")
            cur.execute(
                pgsql.SQL("SET LOCAL statement_timeout = {}").format(
                    pgsql.Literal(STATEMENT_TIMEOUT)
                )
            )
            cur.execute(statement)
            columns = [d.name for d in cur.description] if cur.description else []
            return columns, cur.fetchall()


def _jsonable(value: Any) -> Any:
    from datetime import date, datetime
    from decimal import Decimal

    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return value


def _render_for_model(columns: Sequence[str], rows: Sequence[Sequence[Any]]) -> str:
    """Compact tabular rendering. Cheaper in tokens than JSON and easier for the
    model to read back as prose."""
    if not columns:
        return "Query succeeded and returned no columns."
    if not rows:
        return f"0 rows. Columns: {', '.join(columns)}"

    shown = rows[:MAX_ROWS_TO_MODEL]
    lines = [" | ".join(columns)]
    for row in shown:
        cells = []
        for value in row:
            value = _jsonable(value)
            cells.append("NULL" if value is None
                         else f"{value:.6g}" if isinstance(value, float)
                         else str(value))
        lines.append(" | ".join(cells))
    if len(rows) > len(shown):
        lines.append(f"... {len(rows) - len(shown)} more rows not shown")
    return f"{len(rows)} rows.\n" + "\n".join(lines)


class SqlAgent:
    """Runs the question -> SQL -> answer loop.

    `client` is anything exposing `.create(**kwargs)`; the router passes
    `anthropic.Anthropic().messages`, tests pass a scripted double.
    """

    def __init__(
        self,
        client: MessagesClient,
        connection_factory,
        *,
        model: str = "claude-opus-5",
        max_rows: int = 1000,
        effort: str | None = "medium",
        max_tokens: int = 8000,
    ) -> None:
        self._client = client
        self._connection_factory = connection_factory
        self._model = model
        self._max_rows = max_rows
        self._effort = effort
        self._max_tokens = max_tokens

    def _call_model(self, messages: list[dict]) -> Any:
        kwargs: dict[str, Any] = dict(
            model=self._model,
            max_tokens=self._max_tokens,
            system=system_blocks(),
            tools=[RUN_SQL_TOOL],
            messages=messages,
        )
        # output_config is Anthropic-specific; a gateway may reject an
        # unknown field, so a blank effort omits it entirely.
        if self._effort:
            kwargs["output_config"] = {"effort": self._effort}
        try:
            return self._client.create(**kwargs)
        except Exception as exc:  # noqa: BLE001
            # The client is a narrow Protocol, so this module must not import
            # one SDK's exception classes. The upstream status is duck-typed off
            # the exception; anything without one propagates and becomes a 502.
            status = getattr(exc, "status_code", None)
            if isinstance(status, int):
                raise ModelCallFailed(status) from exc
            raise

    def _run_tool(
        self, candidate: str, emit: Progress
    ) -> tuple[str, bool, Attempt, dict | None]:
        """Validate then execute one candidate. Returns the model-facing text,
        whether it errored, the audit record, and the payload on success."""
        verdict = guard.validate(candidate, max_rows=self._max_rows)
        emit({"phase": "guard", "ok": verdict.ok, "reason": verdict.reason})
        if not verdict.ok:
            attempt = Attempt(sql=candidate, accepted=False, rejection=verdict.reason)
            return (
                f"Query rejected before execution: {verdict.reason} "
                "Rewrite it as a single SELECT over the permitted relations.",
                True,
                attempt,
                None,
            )

        safe_sql = verdict.sql or candidate
        emit({"phase": "executing", "sql": safe_sql})
        started = time.perf_counter()
        try:
            with self._connection_factory() as conn:
                columns, rows = _execute(conn, safe_sql)
        except psycopg.errors.QueryCanceled:
            attempt = Attempt(sql=safe_sql, accepted=True, error="timeout")
            emit({"phase": "sql_failed", "message": "timeout"})
            return (
                f"Query exceeded the {STATEMENT_TIMEOUT} time limit. Narrow the "
                "date range, aggregate more, or add a tighter filter.",
                True, attempt, None,
            )
        except psycopg.errors.InsufficientPrivilege as exc:
            # The database refusing something the guard allowed is worth
            # knowing about: the two allowlists have drifted.
            log.error("guard/grant mismatch — guard passed SQL the role cannot run: %s", exc)
            attempt = Attempt(sql=safe_sql, accepted=True, error="insufficient privilege")
            emit({"phase": "sql_failed", "message": "insufficient privilege"})
            return (
                "That query touches data this role may not read. Use only the "
                "five documented relations.",
                True, attempt, None,
            )
        except psycopg.Error as exc:
            message = str(exc).splitlines()[0][:300]
            attempt = Attempt(sql=safe_sql, accepted=True, error=message)
            emit({"phase": "sql_failed", "message": message})
            return f"The database rejected the query: {message}", True, attempt, None

        elapsed = int((time.perf_counter() - started) * 1000)
        emit({"phase": "rows", "row_count": len(rows), "ms": elapsed})
        attempt = Attempt(
            sql=safe_sql, accepted=True, row_count=len(rows), elapsed_ms=elapsed
        )
        payload = {
            "sql": safe_sql,
            "columns": columns,
            "rows": [[_jsonable(v) for v in row] for row in rows],
        }
        return _render_for_model(columns, rows), False, attempt, payload

    def answer(
        self,
        question: str,
        *,
        history: Iterable[dict[str, str]] = (),
        on_event: Progress | None = None,
    ) -> AgentResult:
        """Answer one question, optionally in the context of prior turns.

        `history` is a sequence of {"role", "content"} dicts, oldest first, and
        is trusted to have been bounded by the caller - `QueryRequest` does it.
        Prior assistant turns are prose, not tool_use blocks, so replaying a
        conversation costs a fraction of what re-running its queries would.
        """

        def emit(event: ProgressEvent) -> None:
            if on_event is None:
                return
            try:
                on_event(event)
            except Exception:  # noqa: BLE001
                # A consumer that has hung up must not take the agent with it;
                # the answer is still worth finishing and logging.
                log.warning("progress consumer raised; continuing", exc_info=True)

        started = time.perf_counter()
        messages: list[dict] = [
            {"role": turn["role"], "content": turn["content"]} for turn in history
        ]
        messages.append({"role": "user", "content": question})
        attempts: list[Attempt] = []
        last_payload: dict | None = None
        usage = {"input_tokens": 0, "output_tokens": 0, "cache_read_input_tokens": 0}
        calls = 0
        model_ms = 0
        answer_text = ""

        for _ in range(MAX_MODEL_CALLS):
            emit({"phase": "thinking", "call": calls + 1, "of": MAX_MODEL_CALLS})
            call_started = time.perf_counter()
            response = self._call_model(messages)
            call_ms = int((time.perf_counter() - call_started) * 1000)
            model_ms += call_ms
            calls += 1

            for key in usage:
                usage[key] += getattr(response.usage, key, 0) or 0

            # Opus 5 can decline; content is empty or partial when it does, so
            # this must be checked before reading content.
            if getattr(response, "stop_reason", None) == "refusal":
                raise AgentRefused(
                    "The model declined to answer this question."
                )

            text_parts = [b.text for b in response.content if b.type == "text"]
            tool_uses = [b for b in response.content if b.type == "tool_use"]
            emit({
                "phase": "thought",
                "call": calls,
                "ms": call_ms,
                "tool_calls": len(tool_uses),
            })

            if not tool_uses:
                answer_text = "\n".join(t.strip() for t in text_parts if t.strip())

                # Neither a tool call nor any text - some gateways return an
                # empty content list. An empty turn carries nothing to feed
                # back, so the question is simply put again rather than
                # abandoning the remaining calls.
                if not answer_text and calls < MAX_MODEL_CALLS:
                    emit({"phase": "retrying", "reason": "empty response"})
                    messages.append({
                        "role": "user",
                        "content": (
                            "You returned an empty response. Answer the question "
                            "above, using the run_sql tool if you need data."
                        ),
                    })
                    continue

                # Some models emit the tool call as literal text instead of a
                # tool_use block. Returning that verbatim would show the user
                # raw function-call syntax as though it were an answer, so nudge
                # once and only give up if it happens again.
                if _looks_like_leaked_tool_call(answer_text) and calls < MAX_MODEL_CALLS:
                    emit({"phase": "retrying", "reason": "tool call written as text"})
                    messages.append({"role": "assistant", "content": answer_text})
                    messages.append({
                        "role": "user",
                        "content": (
                            "That was written as text. Call the run_sql tool "
                            "properly instead of describing the call."
                        ),
                    })
                    answer_text = ""
                    continue
                break

            messages.append({"role": "assistant", "content": response.content})

            results = []
            for block in tool_uses:
                candidate = (block.input or {}).get("sql", "")
                emit({"phase": "sql", "sql": candidate})
                rendered, is_error, attempt, payload = self._run_tool(candidate, emit)
                attempts.append(attempt)
                if payload is not None:
                    last_payload = payload
                results.append({
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": rendered,
                    "is_error": is_error,
                })
            messages.append({"role": "user", "content": results})
        else:
            # Loop exhausted without the model settling on an answer.
            answer_text = (
                "I could not produce a working query for that question within "
                f"{MAX_MODEL_CALLS} attempts."
            )

        rows = last_payload["rows"] if last_payload else []
        truncated = len(rows) >= self._max_rows
        emit({"phase": "answering"})
        return AgentResult(
            question=question,
            answer=answer_text or "The model returned no answer text.",
            sql=last_payload["sql"] if last_payload else None,
            columns=last_payload["columns"] if last_payload else [],
            rows=rows,
            row_count=len(rows),
            truncated=truncated,
            attempts=attempts,
            model_calls=calls,
            elapsed_ms=int((time.perf_counter() - started) * 1000),
            model_ms=model_ms,
            usage=usage,
        )
