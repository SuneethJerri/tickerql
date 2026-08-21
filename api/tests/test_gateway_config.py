"""Routing the agent through an Anthropic-Messages-compatible gateway.

The agent can talk to api.anthropic.com directly or to a gateway such as
OpenRouter. That is deliberately a configuration change rather than a code
change, so these tests pin the three things that make it work: the base URL is
normalised, the credential goes in the header the target expects, and the
Anthropic-specific `output_config` field can be dropped for gateways that
reject unknown fields instead of ignoring them.
"""

from __future__ import annotations

import pytest

from app.agent.runner import SqlAgent
from app.config import Settings
from fake_anthropic import ScriptedClient, runs_sql, says


# ---------------------------------------------------------------------------
# Base URL normalisation
#
# The Anthropic SDK appends "/v1/messages" itself. A configured value ending in
# "/v1" therefore produces ".../v1/v1/messages" and a 405 — the single most
# common mistake when pointing the SDK at a gateway.
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "configured, expected",
    [
        ("https://openrouter.ai/api/v1", "https://openrouter.ai/api"),
        ("https://openrouter.ai/api/v1/", "https://openrouter.ai/api"),
        ("https://openrouter.ai/api", "https://openrouter.ai/api"),
        ("https://openrouter.ai/api/", "https://openrouter.ai/api"),
        ("https://gateway.internal/anthropic", "https://gateway.internal/anthropic"),
        ("", None),
        (None, None),
    ],
)
def test_base_url_is_normalised(configured, expected) -> None:
    assert Settings(anthropic_base_url=configured).anthropic_base_url == expected


def test_base_url_defaults_to_none_meaning_direct() -> None:
    """Unset must mean api.anthropic.com, not an empty string that breaks the SDK."""
    assert Settings().anthropic_base_url is None


def test_auth_style_defaults_to_api_key() -> None:
    assert Settings().anthropic_auth_style == "api_key"


def test_auth_style_rejects_unknown_values() -> None:
    with pytest.raises(ValueError):
        Settings(anthropic_auth_style="oauth")


# ---------------------------------------------------------------------------
# The credential lands in the header the target actually expects
# ---------------------------------------------------------------------------

def test_api_key_style_sends_x_api_key() -> None:
    anthropic = pytest.importorskip("anthropic")
    client = anthropic.Anthropic(api_key="secret")
    assert "X-Api-Key" in client.auth_headers
    assert "Authorization" not in client.auth_headers


def test_bearer_style_sends_authorization() -> None:
    anthropic = pytest.importorskip("anthropic")
    client = anthropic.Anthropic(auth_token="secret", base_url="https://openrouter.ai/api")
    assert client.auth_headers == {"Authorization": "Bearer secret"}


def test_normalised_base_url_produces_a_single_v1_segment() -> None:
    """The whole point of the validator, asserted end to end against the SDK."""
    anthropic = pytest.importorskip("anthropic")
    settings = Settings(anthropic_base_url="https://openrouter.ai/api/v1")
    client = anthropic.Anthropic(auth_token="k", base_url=settings.anthropic_base_url)
    assert str(client.base_url).rstrip("/") == "https://openrouter.ai/api"
    assert "/v1/v1" not in str(client.base_url)


# ---------------------------------------------------------------------------
# output_config is Anthropic-specific and must be droppable
# ---------------------------------------------------------------------------

def _request_for(connect, effort):
    agent = SqlAgent(
        client := ScriptedClient(
            runs_sql("SELECT ticker FROM market.assets ORDER BY ticker LIMIT 1"),
            says("AAPL."),
        ),
        connect,
        model="claude-opus-5",
        max_rows=100,
        effort=effort,
    )
    agent.answer("Name one asset.")
    return client.calls[0]


@pytest.fixture
def connect(agent_url: str):
    from contextlib import contextmanager

    import psycopg

    @contextmanager
    def factory():
        with psycopg.connect(agent_url) as conn:
            yield conn

    return factory


def test_effort_is_sent_when_configured(connect) -> None:
    request = _request_for(connect, "high")
    assert request["output_config"] == {"effort": "high"}


def test_effort_is_omitted_entirely_when_blank(connect) -> None:
    """Not sent as null or empty — absent, so a strict gateway cannot reject it."""
    request = _request_for(connect, "")
    assert "output_config" not in request


def test_omitting_effort_does_not_disturb_the_rest_of_the_request(connect) -> None:
    with_effort = _request_for(connect, "medium")
    without = _request_for(connect, "")
    assert with_effort.keys() - without.keys() == {"output_config"}
    for field in ("model", "max_tokens", "system", "tools"):
        assert with_effort[field] == without[field]


def test_default_effort_is_medium() -> None:
    assert Settings().agent_effort == "medium"
