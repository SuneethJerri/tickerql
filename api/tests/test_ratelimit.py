"""Rate limiting and the optional shared secret on /api/query.

Every other endpoint is a cheap indexed read; this one calls a language model,
so an uncapped one spends someone else's budget. CORS does not help - it is a
browser rule and curl ignores it.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import app
from app.ratelimit import SlidingWindowLimiter, client_key
from app.routers import query as query_router


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture(autouse=True)
def _clean_limiter():
    query_router._limiter.reset()
    yield
    query_router._limiter.reset()


# ---------------------------------------------------------------------------
# The window itself
# ---------------------------------------------------------------------------

def test_allows_up_to_the_limit_then_blocks() -> None:
    limiter = SlidingWindowLimiter(limit=3, window_seconds=60)
    assert [limiter.check("a", now=t)[0] for t in (0, 1, 2)] == [True, True, True]
    assert limiter.check("a", now=3)[0] is False


def test_the_window_slides_rather_than_resetting_on_a_fixed_clock() -> None:
    limiter = SlidingWindowLimiter(limit=2, window_seconds=60)
    limiter.check("a", now=0)
    limiter.check("a", now=30)
    assert limiter.check("a", now=59)[0] is False
    # The first hit ages out at t=60, freeing exactly one slot - not both.
    assert limiter.check("a", now=61)[0] is True
    assert limiter.check("a", now=62)[0] is False


def test_clients_are_counted_separately() -> None:
    limiter = SlidingWindowLimiter(limit=1, window_seconds=60)
    assert limiter.check("a", now=0)[0] is True
    assert limiter.check("b", now=0)[0] is True
    assert limiter.check("a", now=1)[0] is False


def test_a_blocked_call_does_not_extend_its_own_lockout() -> None:
    """Recording a rejected attempt would let a hammering client starve itself."""
    limiter = SlidingWindowLimiter(limit=1, window_seconds=60)
    limiter.check("a", now=0)
    for t in range(1, 50):
        limiter.check("a", now=t)
    assert limiter.check("a", now=61)[0] is True


def test_retry_after_counts_down_toward_the_oldest_hit() -> None:
    limiter = SlidingWindowLimiter(limit=1, window_seconds=60)
    limiter.check("a", now=0)
    _, first = limiter.check("a", now=10)
    _, later = limiter.check("a", now=50)
    assert first == pytest.approx(50.0)
    assert later == pytest.approx(10.0)


def test_limit_of_zero_is_handled_by_the_caller_not_the_limiter() -> None:
    limiter = SlidingWindowLimiter(limit=0, window_seconds=60)
    assert limiter.check("a", now=0)[0] is False


# ---------------------------------------------------------------------------
# Client identification
# ---------------------------------------------------------------------------

class _Req:
    def __init__(self, headers=None, host="1.2.3.4"):
        self.headers = headers or {}
        self.client = type("C", (), {"host": host})()


def test_forwarded_header_wins_over_the_proxy_address() -> None:
    assert client_key(_Req({"x-forwarded-for": "9.9.9.9"})) == "9.9.9.9"


def test_leftmost_forwarded_entry_is_used() -> None:
    assert client_key(_Req({"x-forwarded-for": "9.9.9.9, 10.0.0.1, 10.0.0.2"})) == "9.9.9.9"


def test_falls_back_to_the_socket_address() -> None:
    assert client_key(_Req()) == "1.2.3.4"


# ---------------------------------------------------------------------------
# Endpoint behaviour
# ---------------------------------------------------------------------------

def test_query_endpoint_429s_after_the_limit(client, monkeypatch) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "query_rate_limit", 2)
    monkeypatch.setattr(settings, "anthropic_api_key", None)
    query_router._limiter.limit = 2

    body = {"question": "Which sector is most volatile?"}
    # 503 = unconfigured agent, which still means the request got past the gate.
    assert client.post("/api/query", json=body).status_code == 503
    assert client.post("/api/query", json=body).status_code == 503
    blocked = client.post("/api/query", json=body)
    assert blocked.status_code == 429
    assert "Retry-After" in blocked.headers
    assert "Rate limit reached" in blocked.json()["detail"]


def test_rate_limit_of_zero_disables_the_cap(client, monkeypatch) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "query_rate_limit", 0)
    monkeypatch.setattr(settings, "anthropic_api_key", None)
    body = {"question": "Which sector is most volatile?"}
    for _ in range(6):
        assert client.post("/api/query", json=body).status_code == 503


def test_analytics_endpoints_are_not_rate_limited(client, monkeypatch) -> None:
    """Only the endpoint that costs money is capped."""
    monkeypatch.setattr(get_settings(), "query_rate_limit", 1)
    query_router._limiter.limit = 1
    for _ in range(8):
        assert client.get("/api/analytics/sector-performance?window=365").status_code == 200


def test_shared_secret_rejects_a_missing_key(client, monkeypatch) -> None:
    monkeypatch.setattr(get_settings(), "query_api_key", "s3cret")
    r = client.post("/api/query", json={"question": "Which sector is most volatile?"})
    assert r.status_code == 401


def test_shared_secret_rejects_a_wrong_key(client, monkeypatch) -> None:
    monkeypatch.setattr(get_settings(), "query_api_key", "s3cret")
    r = client.post(
        "/api/query",
        json={"question": "Which sector is most volatile?"},
        headers={"X-API-Key": "wrong"},
    )
    assert r.status_code == 401


def test_shared_secret_accepts_the_right_key(client, monkeypatch) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "query_api_key", "s3cret")
    monkeypatch.setattr(settings, "anthropic_api_key", None)
    r = client.post(
        "/api/query",
        json={"question": "Which sector is most volatile?"},
        headers={"X-API-Key": "s3cret"},
    )
    assert r.status_code == 503  # past the gate, agent simply unconfigured


def test_no_secret_configured_means_no_key_required(client, monkeypatch) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "query_api_key", None)
    monkeypatch.setattr(settings, "anthropic_api_key", None)
    r = client.post("/api/query", json={"question": "Which sector is most volatile?"})
    assert r.status_code == 503
