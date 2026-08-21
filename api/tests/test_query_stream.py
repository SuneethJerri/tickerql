"""Tests for conversation memory and POST /api/query/stream.

Two things are being pinned here. First, that history is bounded before it
reaches the model - an unbounded transcript is a cost incident, not a bug that
shows up as an error. Second, that the stream reports the boundaries the agent
loop actually passes through, rather than a progress bar animated on a timer,
which is what "show that the model is thinking" usually degrades into.
"""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from app.agent.runner import SqlAgent
from app.main import app
from app.models import MAX_HISTORY_CHARS, MAX_HISTORY_TURNS, QueryRequest
from fake_anthropic import ScriptedClient, refuses, runs_sql, says


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def _agent(agent_url: str, *responses) -> tuple[SqlAgent, ScriptedClient]:
    from contextlib import contextmanager

    import psycopg

    @contextmanager
    def factory():
        with psycopg.connect(agent_url) as conn:
            yield conn

    double = ScriptedClient(*responses)
    return SqlAgent(double, factory, model="claude-opus-5", max_rows=100), double


def _install(monkeypatch, agent):
    from app.routers import query as query_router

    monkeypatch.setattr(query_router, "_build_agent", lambda: agent)


def _events(response) -> list[dict]:
    """Parse an SSE body into its JSON events, ignoring keep-alive comments."""
    out = []
    for line in response.text.splitlines():
        if line.startswith("data: "):
            out.append(json.loads(line[6:]))
    return out


# ---------------------------------------------------------------------------
# History bounds
# ---------------------------------------------------------------------------

def test_history_is_trimmed_to_the_turn_cap() -> None:
    turns = [
        {"role": "user" if i % 2 == 0 else "assistant", "content": f"turn {i}"}
        for i in range(40)
    ]
    request = QueryRequest(question="And now?", history=turns)
    assert len(request.history) <= MAX_HISTORY_TURNS
    # The turns kept are the ones nearest the question.
    assert request.history[-1].content == "turn 39"


def test_history_is_trimmed_to_the_character_cap() -> None:
    """The turn cap alone lets one enormous pasted table through."""
    turns = [
        {"role": "user", "content": "x" * 4_000},
        {"role": "assistant", "content": "y" * 4_000},
        {"role": "user", "content": "z" * 4_000},
        {"role": "assistant", "content": "w" * 4_000},
    ]
    request = QueryRequest(question="And now?", history=turns)
    total = sum(len(t.content) for t in request.history)
    assert total <= MAX_HISTORY_CHARS
    assert len(request.history) < len(turns), "nothing was trimmed"


def test_trimmed_history_still_opens_with_a_user_turn() -> None:
    """Trimming cuts mid-exchange, and the Messages API rejects a conversation
    that opens with an assistant turn. Left unhandled this fails at the model,
    not here, and only once a conversation is long enough to trim."""
    turns = [{"role": "assistant", "content": "an answer"} for _ in range(3)]
    turns.append({"role": "user", "content": "a question"})
    request = QueryRequest(question="follow up", history=turns)
    assert request.history
    assert request.history[0].role == "user"


def test_history_of_only_assistant_turns_becomes_empty() -> None:
    request = QueryRequest(
        question="follow up",
        history=[{"role": "assistant", "content": "an answer"}],
    )
    assert request.history == []


# ---------------------------------------------------------------------------
# History reaches the model
# ---------------------------------------------------------------------------

def test_prior_turns_are_sent_ahead_of_the_question(agent_url) -> None:
    agent, double = _agent(agent_url, says("Bitcoin, at 71%."))
    agent.answer(
        "And which was the most volatile?",
        history=[
            {"role": "user", "content": "How many crypto assets are there?"},
            {"role": "assistant", "content": "Twelve."},
        ],
    )
    sent = double.calls[0]["messages"]
    assert [m["role"] for m in sent] == ["user", "assistant", "user"]
    assert sent[0]["content"] == "How many crypto assets are there?"
    assert sent[-1]["content"] == "And which was the most volatile?"


def test_no_history_sends_only_the_question(agent_url) -> None:
    agent, double = _agent(agent_url, says("Twelve."))
    agent.answer("How many crypto assets are there?")
    assert len(double.calls[0]["messages"]) == 1


# ---------------------------------------------------------------------------
# Progress events
# ---------------------------------------------------------------------------

def test_progress_reports_every_boundary_in_order(agent_url) -> None:
    agent, _ = _agent(
        agent_url,
        runs_sql("SELECT ticker FROM market.assets ORDER BY ticker LIMIT 2"),
        says("AAPL and BAC."),
    )
    seen: list[dict] = []
    agent.answer("First two tickers?", on_event=seen.append)

    phases = [e["phase"] for e in seen]
    for expected in ("thinking", "thought", "sql", "guard", "executing", "rows", "answering"):
        assert expected in phases, f"no {expected} event: {phases}"
    assert phases.index("sql") < phases.index("guard") < phases.index("executing")
    assert phases.index("executing") < phases.index("rows")
    assert phases[-1] == "answering"

    rows_event = next(e for e in seen if e["phase"] == "rows")
    assert rows_event["row_count"] == 2
    assert rows_event["ms"] >= 0


def test_progress_reports_a_guard_rejection(agent_url) -> None:
    """The blocked query is visible while it happens, not only in the summary."""
    agent, _ = _agent(
        agent_url,
        runs_sql("DELETE FROM market.price_history"),
        says("I can only read data."),
    )
    seen: list[dict] = []
    agent.answer("Delete the prices.", on_event=seen.append)

    guard_events = [e for e in seen if e["phase"] == "guard"]
    assert guard_events and guard_events[0]["ok"] is False
    assert "DELETE" in guard_events[0]["reason"]
    assert not any(e["phase"] == "executing" for e in seen), (
        "a rejected statement must never reach the executing phase"
    )


def test_a_progress_consumer_that_raises_does_not_lose_the_answer(agent_url) -> None:
    """The consumer is a client that can hang up mid-answer. Letting its
    failure propagate would abandon a model call that has already been paid
    for, and lose the audit record with it."""
    agent, _ = _agent(agent_url, says("Twelve."))

    def hostile(_event):
        raise BrokenPipeError("client went away")

    result = agent.answer("How many crypto assets?", on_event=hostile)
    assert result.answer == "Twelve."


def test_model_time_is_measured_not_inferred(agent_url) -> None:
    agent, _ = _agent(
        agent_url,
        runs_sql("SELECT count(*) FROM market.assets"),
        says("135."),
    )
    result = agent.answer("How many assets?")
    assert result.model_ms >= 0
    assert result.model_ms <= result.elapsed_ms, (
        "model time cannot exceed total time"
    )


# ---------------------------------------------------------------------------
# The stream endpoint
# ---------------------------------------------------------------------------

def test_stream_ends_with_the_same_payload_as_the_plain_route(
    client, monkeypatch, agent_url
) -> None:
    agent, _ = _agent(
        agent_url,
        runs_sql("SELECT ticker FROM market.assets ORDER BY ticker LIMIT 2"),
        says("AAPL and BAC."),
    )
    _install(monkeypatch, agent)

    response = client.post("/api/query/stream", json={"question": "First two tickers?"})
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")

    events = _events(response)
    assert events[0]["phase"] == "accepted"
    assert events[-1]["phase"] == "done"

    result = events[-1]["result"]
    assert result["answer"] == "AAPL and BAC."
    assert result["columns"] == ["ticker"]
    assert result["row_count"] == 2
    assert result["attempts"][0]["accepted"] is True
    assert result["model_ms"] >= 0


def test_stream_reports_a_refusal_as_an_error_event(client, monkeypatch, agent_url) -> None:
    agent, _ = _agent(agent_url, refuses())
    _install(monkeypatch, agent)

    events = _events(client.post("/api/query/stream", json={"question": "Something odd."}))
    assert events[-1]["phase"] == "error"
    assert events[-1]["status"] == 422


def test_stream_does_not_leak_internals_when_the_agent_explodes(
    client, monkeypatch, agent_url
) -> None:
    from app.routers import query as query_router

    class Exploding:
        def answer(self, question, **kwargs):
            raise RuntimeError("upstream reset: key sk-ant-secret")

    monkeypatch.setattr(query_router, "_build_agent", lambda: Exploding())
    response = client.post("/api/query/stream", json={"question": "Anything at all."})
    assert "sk-ant-secret" not in response.text
    assert _events(response)[-1]["status"] == 502


def test_stream_carries_history_through_to_the_model(client, monkeypatch, agent_url) -> None:
    agent, double = _agent(agent_url, says("Bitcoin."))
    _install(monkeypatch, agent)

    client.post(
        "/api/query/stream",
        json={
            "question": "Which was most volatile?",
            "history": [
                {"role": "user", "content": "How many crypto assets?"},
                {"role": "assistant", "content": "Twelve."},
            ],
        },
    )
    assert len(double.calls[0]["messages"]) == 3


def test_stream_is_rate_limited_like_the_plain_route(client, monkeypatch, agent_url) -> None:
    """The limit exists because this route costs money. A second, unlimited
    door to the same agent would make it decorative."""
    from app.config import get_settings
    from app.ratelimit import SlidingWindowLimiter
    from app.routers import query as query_router

    settings = get_settings()
    monkeypatch.setattr(settings, "query_rate_limit", 1)
    monkeypatch.setattr(settings, "query_rate_window_seconds", 3600)
    monkeypatch.setattr(
        query_router, "_limiter", SlidingWindowLimiter(limit=1, window_seconds=3600)
    )

    agent, _ = _agent(agent_url, says("First."), says("Second."))
    _install(monkeypatch, agent)

    first = client.post("/api/query/stream", json={"question": "A question."})
    assert first.status_code == 200
    second = client.post("/api/query/stream", json={"question": "Another question."})
    assert second.status_code == 429
    assert "Retry-After" in second.headers


def test_stream_requires_the_shared_secret_when_one_is_set(
    client, monkeypatch, agent_url
) -> None:
    from app.config import get_settings

    settings = get_settings()
    monkeypatch.setattr(settings, "query_api_key", "s3cret")
    monkeypatch.setattr(settings, "query_rate_limit", 0)

    agent, _ = _agent(agent_url, says("Answer."))
    _install(monkeypatch, agent)

    assert client.post("/api/query/stream", json={"question": "A question."}).status_code == 401
    ok = client.post(
        "/api/query/stream",
        json={"question": "A question."},
        headers={"X-API-Key": "s3cret"},
    )
    assert ok.status_code == 200


def test_stream_rejects_a_too_short_question_before_streaming(client) -> None:
    """422 has to arrive as a status code. Once the SSE headers are on the wire
    there is no status left to send."""
    r = client.post("/api/query/stream", json={"question": "ab"})
    assert r.status_code == 422
    assert not r.headers["content-type"].startswith("text/event-stream")


def test_an_empty_model_response_is_retried_not_returned(agent_url) -> None:
    """Observed against a gateway-hosted Llama: one call came back with an empty
    content list, and the loop returned "the model returned no answer text"
    while two of its three paid calls went unused."""
    from fake_anthropic import FakeResponse

    agent, double = _agent(agent_url, FakeResponse(content=[]), says("Twelve."))
    seen: list[dict] = []
    result = agent.answer("How many crypto assets?", on_event=seen.append)

    assert result.answer == "Twelve."
    assert result.model_calls == 2
    assert any(
        e["phase"] == "retrying" and e["reason"] == "empty response" for e in seen
    )


def test_an_empty_response_on_the_last_call_is_not_retried_forever(agent_url) -> None:
    from fake_anthropic import FakeResponse

    agent, _ = _agent(agent_url, *[FakeResponse(content=[]) for _ in range(3)])
    result = agent.answer("How many crypto assets?")
    assert result.model_calls == 3
    assert "no answer text" in result.answer
