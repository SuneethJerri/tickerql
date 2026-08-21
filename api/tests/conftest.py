"""Shared test fixtures."""

from __future__ import annotations

import os
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]


def _load_env() -> dict[str, str]:
    """Read the repo-root .env without adding a dependency on the app package."""
    env: dict[str, str] = {}
    path = REPO_ROOT / ".env"
    if path.exists():
        for line in path.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, _, value = line.partition("=")
                value = value.strip()
                # Values are quoted in .env because the connection strings
                # contain '&', which an unquoted `source` treats as job
                # control. Strip the quotes as a dotenv parser would.
                if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                    value = value[1:-1]
                env[key.strip()] = value
    return {**env, **os.environ}


@pytest.fixture(scope="session")
def env() -> dict[str, str]:
    return _load_env()


@pytest.fixture(scope="session")
def agent_url(env) -> str:
    """Connection string for the restricted agent role.

    Prefers the direct endpoint when one is configured: these tests flip
    session-level settings, and a transaction pooler discards those between
    statements.
    """
    url = env.get("DATABASE_URL_AGENT_DIRECT") or env.get("DATABASE_URL_AGENT")
    if not url:
        pytest.skip("DATABASE_URL_AGENT not configured")
    return url


@pytest.fixture(scope="session")
def owner_url(env) -> str:
    url = env.get("DATABASE_URL")
    if not url:
        pytest.skip("DATABASE_URL not configured")
    return url
