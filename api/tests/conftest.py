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
                env[key.strip()] = value.strip()
    return {**env, **os.environ}


@pytest.fixture(scope="session")
def env() -> dict[str, str]:
    return _load_env()


@pytest.fixture(scope="session")
def agent_url(env) -> str:
    url = env.get("DATABASE_URL_AGENT")
    if not url:
        pytest.skip("DATABASE_URL_AGENT not configured")
    return url


@pytest.fixture(scope="session")
def owner_url(env) -> str:
    url = env.get("DATABASE_URL")
    if not url:
        pytest.skip("DATABASE_URL not configured")
    return url
