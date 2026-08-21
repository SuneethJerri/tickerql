"""Tests for POST /api/query.

No ANTHROPIC_API_KEY is configured in this environment, so the unconfigured
path is tested for real, and the configured path is tested by substituting the
agent the router builds.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.agent.runner import AgentRefused, SqlAgent
from app.main import app
from fake_anthropic import ScriptedClient, refuses, runs_sql, says


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def test_returns_503_with_setup_guidance_when_unconfigured(client, monkeypatch) -> None:
    """The analytics endpoints work without a key; only this one needs it, and
    the error should say so rather than looking like an outage.

    The unconfigured state is forced here rather than inherited from the
    environment: this test used to depend on the developer's .env having no
    ANTHROPIC_API_KEY, so it began failing the moment a real key was added.
    """
    from app.config import get_settings

    settings = get_settings()
    monkeypatch.setattr(settings, "anthropic_api_key", None)
    r = client.post("/api/query", json={"question": "Which sector is most volatile?"})
    assert r.status_code == 503
    detail = r.json()["detail"]
    assert "ANTHROPIC_API_KEY" in detail
    assert "analytics endpoints work without it" in detail


@pytest.mark.parametrize("question", ["", "ab", "x" * 1001])
def test_question_length_is_validated(client, question: str) -> None:
    assert client.post("/api/query", json={"question": question}).status_code == 422


def test_missing_body_is_rejected(client) -> None:
    assert client.post("/api/query", json={}).status_code == 422


def _install_agent(monkeypatch, agent_url: str, *responses):
    """Point the router at a scripted agent over a real database connection."""
    from contextlib import contextmanager

    import psycopg

    from app.routers import query as query_router

    @contextmanager
    def factory():
        with psycopg.connect(agent_url) as conn:
            yield conn

    client_double = ScriptedClient(*responses)
    agent = SqlAgent(client_double, factory, model="claude-opus-5", max_rows=100)
    monkeypatch.setattr(query_router, "_build_agent", lambda: agent)
    return client_double


def test_successful_query_returns_answer_sql_and_rows(client, monkeypatch, agent_url) -> None:
    _install_agent(
        monkeypatch, agent_url,
        runs_sql("SELECT ticker FROM market.assets ORDER BY ticker LIMIT 2"),
        says("The first two tickers are AAPL and BAC."),
    )
    body = client.post("/api/query", json={"question": "First two tickers?"}).json()

    assert body["answer"].startswith("The first two tickers")
    assert "SELECT" in body["sql"]
    assert body["columns"] == ["ticker"]
    assert body["row_count"] == 2
    assert body["model_calls"] == 2
    assert body["elapsed_ms"] >= 0
    assert body["attempts"][0]["accepted"] is True


def test_blocked_sql_is_surfaced_in_the_response(client, monkeypatch, agent_url) -> None:
    """A user should be able to see that the guard intervened. Hiding it would
    make the answer look unexplained."""
    _install_agent(
        monkeypatch, agent_url,
        runs_sql("DELETE FROM market.price_history"),
        says("I can only read data."),
    )
    body = client.post("/api/query", json={"question": "Delete the prices."}).json()

    assert body["sql"] is None
    assert body["attempts"][0]["accepted"] is False
    assert "DELETE" in body["attempts"][0]["rejection"]


def test_model_refusal_maps_to_422(client, monkeypatch, agent_url) -> None:
    _install_agent(monkeypatch, agent_url, refuses())
    r = client.post("/api/query", json={"question": "Something disallowed."})
    assert r.status_code == 422


def test_agent_failure_maps_to_502_without_leaking_internals(
    client, monkeypatch, agent_url
) -> None:
    from app.routers import query as query_router

    class Exploding:
        def answer(self, question):
            raise RuntimeError("upstream connection reset: key sk-ant-secret")

    monkeypatch.setattr(query_router, "_build_agent", lambda: Exploding())
    r = client.post("/api/query", json={"question": "Anything at all."})
    assert r.status_code == 502
    assert "sk-ant-secret" not in r.text, "internal detail leaked to the client"


def test_response_is_json_serialisable_with_dates_and_decimals(
    client, monkeypatch, agent_url
) -> None:
    _install_agent(
        monkeypatch, agent_url,
        runs_sql("SELECT date, close FROM market.price_history ORDER BY date DESC LIMIT 3"),
        says("Here are the latest closes."),
    )
    body = client.post("/api/query", json={"question": "Latest closes?"}).json()
    assert body["row_count"] == 3
    assert isinstance(body["rows"][0][0], str)
    assert isinstance(body["rows"][0][1], float)
