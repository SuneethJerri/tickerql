"""Tests for the text-to-SQL agent loop.

Uses a scripted model client but a REAL database connection and the REAL
guard, so everything except the language model itself is exercised. The
interesting cases are the ones where the model misbehaves.
"""

from __future__ import annotations

import psycopg
import pytest

from app.agent.runner import AgentRefused, MAX_MODEL_CALLS, SqlAgent
from fake_anthropic import ScriptedClient, refuses, runs_sql, says


@pytest.fixture
def connect(agent_url: str):
    """Connection factory bound to the restricted agent role."""
    from contextlib import contextmanager

    @contextmanager
    def factory():
        with psycopg.connect(agent_url) as conn:
            yield conn

    return factory


def build(connect, *responses) -> tuple[SqlAgent, ScriptedClient]:
    client = ScriptedClient(*responses)
    return SqlAgent(client, connect, model="claude-opus-5", max_rows=100), client


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------

def test_answers_a_question_end_to_end(connect) -> None:
    agent, client = build(
        connect,
        runs_sql("SELECT ticker, sector FROM market.assets ORDER BY ticker LIMIT 3"),
        says("The three assets are AAPL, BAC and BTC."),
    )
    result = agent.answer("List three assets.")

    assert result.answer.startswith("The three assets")
    assert result.row_count == 3
    assert result.columns == ["ticker", "sector"]
    assert result.model_calls == 2
    assert len(result.attempts) == 1 and result.attempts[0].accepted
    assert result.usage["input_tokens"] > 0


def test_system_prompt_is_sent_with_a_cache_breakpoint(connect) -> None:
    """The schema and few-shots are ~2.3k tokens on every call; without the
    breakpoint that is paid in full each time."""
    agent, client = build(connect, says("Hello."))
    agent.answer("Hi")

    system = client.calls[0]["system"]
    assert isinstance(system, list) and len(system) == 1
    assert system[0]["cache_control"] == {"type": "ephemeral"}


def test_question_is_not_interpolated_into_the_cached_prefix(connect) -> None:
    """If the question leaked into the system prompt the cache would miss on
    every single request."""
    agent, _ = build(connect, says("A."))
    agent.answer("what is the volatility of NVDA")
    agent2, client2 = build(connect, says("B."))
    agent2.answer("a totally different question")

    from app.agent.prompt import SYSTEM_PROMPT

    assert "volatility of NVDA" not in SYSTEM_PROMPT
    assert client2.calls[0]["system"][0]["text"] == SYSTEM_PROMPT


def test_tool_definition_is_advertised(connect) -> None:
    agent, client = build(connect, says("Hi."))
    agent.answer("Hi")
    tools = client.calls[0]["tools"]
    assert [t["name"] for t in tools] == ["run_sql"]
    assert tools[0]["input_schema"]["required"] == ["sql"]


# ---------------------------------------------------------------------------
# The model misbehaving
# ---------------------------------------------------------------------------

def test_hostile_sql_is_blocked_and_never_executed(connect) -> None:
    """The scenario the whole security design exists for."""
    agent, _ = build(
        connect,
        runs_sql("DROP TABLE market.price_history"),
        says("I cannot do that."),
    )
    result = agent.answer("Delete everything.")

    assert len(result.attempts) == 1
    attempt = result.attempts[0]
    assert attempt.accepted is False
    assert "DROP" in attempt.rejection
    assert result.sql is None, "no SQL should be reported as having produced an answer"

    # And the table is still there.
    with connect() as conn, conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM market.price_history")
        assert cur.fetchone()[0] > 12000


def test_data_modifying_cte_is_blocked(connect) -> None:
    agent, _ = build(
        connect,
        runs_sql(
            "WITH e AS (DELETE FROM market.price_history RETURNING *) SELECT * FROM e"
        ),
        says("Not permitted."),
    )
    result = agent.answer("Clear the prices.")
    assert result.attempts[0].accepted is False
    assert "DELETE" in result.attempts[0].rejection


def test_agent_self_corrects_after_a_rejection(connect) -> None:
    """A rejection is fed back as an error so the model can fix it. Both the
    bad and the good attempt are recorded."""
    agent, client = build(
        connect,
        runs_sql("SELECT * FROM market.ingest_runs", tool_id="t1"),
        runs_sql("SELECT ticker FROM market.assets LIMIT 2", tool_id="t2"),
        says("Recovered and answered."),
    )
    result = agent.answer("Show me the ingest log.")

    assert [a.accepted for a in result.attempts] == [False, True]
    assert result.row_count == 2
    assert result.model_calls == 3

    # The rejection reason really did reach the model.
    followup = client.calls[1]["messages"][-1]["content"][0]
    assert followup["is_error"] is True
    assert "ingest_runs" in followup["content"]


def test_database_error_is_fed_back_for_correction(connect) -> None:
    """Valid per the guard, invalid per PostgreSQL — a misspelt column."""
    agent, client = build(
        connect,
        runs_sql("SELECT no_such_column FROM market.assets", tool_id="t1"),
        runs_sql("SELECT ticker FROM market.assets LIMIT 1", tool_id="t2"),
        says("Fixed."),
    )
    result = agent.answer("Show me something.")

    assert result.attempts[0].accepted is True   # the guard allowed it
    assert result.attempts[0].error is not None  # the database did not
    assert result.row_count == 1
    followup = client.calls[1]["messages"][-1]["content"][0]
    assert followup["is_error"] is True


def test_refusal_is_surfaced_not_swallowed(connect) -> None:
    """Opus 5 returns HTTP 200 with stop_reason='refusal' and empty content;
    reading content without checking would raise something unhelpful."""
    agent, _ = build(connect, refuses())
    with pytest.raises(AgentRefused):
        agent.answer("Do something disallowed.")


def test_loop_is_bounded(connect) -> None:
    """A model that never stops calling the tool must not loop forever."""
    agent, client = build(
        connect,
        *[runs_sql("SELECT 1 FROM market.assets LIMIT 1", tool_id=f"t{i}")
          for i in range(MAX_MODEL_CALLS)],
    )
    result = agent.answer("Loop forever.")

    assert result.model_calls == MAX_MODEL_CALLS
    assert len(client.calls) == MAX_MODEL_CALLS
    assert "could not produce a working query" in result.answer


# ---------------------------------------------------------------------------
# Result handling
# ---------------------------------------------------------------------------

def test_missing_limit_is_injected_before_execution(connect) -> None:
    agent, _ = build(
        connect,
        runs_sql("SELECT date FROM market.price_history"),  # 13k rows unbounded
        says("Done."),
    )
    result = agent.answer("Every date.")

    assert "LIMIT 100" in result.sql
    assert result.row_count == 100
    assert result.truncated is True


def test_rows_sent_to_the_model_are_capped(connect) -> None:
    """The API response carries every row; the model gets a sample. Otherwise
    a wide result set is re-billed as input tokens on the next turn."""
    from app.agent.runner import MAX_ROWS_TO_MODEL

    agent, client = build(
        connect,
        runs_sql("SELECT date FROM market.price_history ORDER BY date LIMIT 100"),
        says("Done."),
    )
    result = agent.answer("Dates please.")

    assert result.row_count == 100
    tool_result = client.calls[1]["messages"][-1]["content"][0]["content"]
    assert "more rows not shown" in tool_result
    assert tool_result.count("\n") <= MAX_ROWS_TO_MODEL + 3


def test_values_are_json_serialisable(connect) -> None:
    """Dates and Decimals must not reach the response as Python objects."""
    import json

    agent, _ = build(
        connect,
        runs_sql("SELECT date, close FROM market.price_history ORDER BY date DESC LIMIT 2"),
        says("Done."),
    )
    result = agent.answer("Latest closes.")
    json.dumps(result.rows)  # raises if anything is not serialisable
    assert isinstance(result.rows[0][0], str)    # date -> ISO string
    assert isinstance(result.rows[0][1], float)  # Decimal -> float
