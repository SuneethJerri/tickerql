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
        # **kwargs, not a bare (self, question): the router now passes history=,
        # so a narrow signature would raise TypeError and this test would pass
        # on the wrong exception without ever reaching the agent.
        def answer(self, question, **kwargs):
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


class _UpstreamError(Exception):
    """Stands in for an SDK exception carrying an HTTP status.

    Deliberately not an `anthropic` class: the agent duck-types `status_code`
    precisely so the model client stays a narrow Protocol, and a test that
    imported the real exception would stop proving that.
    """

    def __init__(self, status_code: int) -> None:
        super().__init__(f"upstream said {status_code}")
        self.status_code = status_code


def _install_failing_client(monkeypatch, status: int) -> None:
    from app.routers import query as query_router

    class Rejecting:
        def create(self, **kwargs):
            raise _UpstreamError(status)

    def factory():
        raise AssertionError("the model call fails before any SQL runs")

    agent = SqlAgent(Rejecting(), factory, model="claude-opus-5", max_rows=100)
    monkeypatch.setattr(query_router, "_build_agent", lambda: agent)


@pytest.mark.parametrize(
    ("upstream", "expected", "must_say"),
    [
        # A rejected credential is a configuration problem, not a gateway
        # hiccup: retrying cannot fix it, so it must not look retryable.
        (401, 503, "credential"),
        (403, 503, "credential"),
        # The provider throttling us, not us throttling the caller. Same
        # status; the detail is what tells the two apart.
        (429, 429, "rate limiting"),
        (500, 502, "HTTP 500"),
        (529, 502, "HTTP 529"),
    ],
)
def test_upstream_status_is_distinguishable(
    client, monkeypatch, upstream, expected, must_say
) -> None:
    _install_failing_client(monkeypatch, upstream)
    r = client.post("/api/query", json={"question": "how many assets are tracked?"})
    assert r.status_code == expected
    assert must_say in r.json()["detail"]


def test_upstream_failure_does_not_echo_the_provider_body(client, monkeypatch) -> None:
    """The provider's own message never reaches the caller.

    Some gateways repeat the request in the error body, and at least one
    repeats the key that was rejected. Only the status crosses the boundary.
    """
    from app.routers import query as query_router

    class Leaky:
        def create(self, **kwargs):
            exc = _UpstreamError(401)
            exc.args = ("invalid api key: sk-or-v1-secret-value",)
            raise exc

    agent = SqlAgent(Leaky(), lambda: None, model="claude-opus-5", max_rows=100)
    monkeypatch.setattr(query_router, "_build_agent", lambda: agent)
    r = client.post("/api/query", json={"question": "how many assets are tracked?"})
    assert r.status_code == 503
    assert "sk-or-v1" not in r.text
    assert "secret-value" not in r.text
