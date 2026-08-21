"""API configuration, loaded from the environment or the repo-root .env."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    """Runtime configuration for the API.

    Two database URLs, deliberately separate:

      database_url_api    - the analytics endpoints. Read-only across `market`.
      database_url_agent  - the text-to-SQL agent. SELECT on a five-relation
                            allowlist and nothing else. This is the only
                            connection that ever executes model-generated SQL.

    They are never interchangeable. Pointing the agent at the API URL would
    silently widen what generated SQL can reach.
    """

    database_url_api: str = "postgresql://sqlproj_api:changeme@localhost:5433/sqlproj"
    database_url_agent: str = "postgresql://sqlproj_agent:changeme@localhost:5433/sqlproj"

    # Pool ceilings. The agent role is capped at CONNECTION LIMIT 5 in
    # 003_roles.sql, so its pool must stay strictly under that.
    api_pool_max_size: int = 8
    agent_pool_max_size: int = 4

    # Comma-separated. Locked down rather than "*" so a deployed API cannot be
    # driven from an arbitrary origin.
    cors_origins: str = "http://localhost:5173,http://localhost:4173,http://localhost:3000"

    anthropic_api_key: str | None = None
    anthropic_model: str = "claude-opus-5"

    # Optional gateway. Leave unset to talk to api.anthropic.com directly.
    #
    # Set it to route through an Anthropic-Messages-compatible gateway such as
    # OpenRouter (https://openrouter.ai/api). The Anthropic SDK appends
    # "/v1/messages" itself, so a value ending in "/v1" produces
    # ".../v1/v1/messages" and a 405 — the single most common mistake here, so
    # the validator below strips it.
    anthropic_base_url: str | None = None

    # How the key is presented. Anthropic itself wants "x-api-key"; most
    # gateways, OpenRouter included, want "Authorization: Bearer".
    anthropic_auth_style: Literal["api_key", "bearer"] = "api_key"

    # Thinking depth for the agent. Empty string omits `output_config`
    # entirely, which is required for gateways that reject Anthropic-specific
    # request fields rather than ignoring them.
    agent_effort: str = "medium"

    # Ceiling on rows returned to a client from any single request.
    max_rows: int = 5000

    model_config = SettingsConfigDict(
        env_file=REPO_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @field_validator("anthropic_base_url")
    @classmethod
    def _normalise_base_url(cls, v: str | None) -> str | None:
        """Strip a trailing "/v1" (and any trailing slash).

        The Anthropic SDK always appends "/v1/messages" to the base URL, so a
        configured value ending in "/v1" double-paths. This is correct for the
        real API too — its base URL is "https://api.anthropic.com", not
        ".../v1" — so the rule is safe for every Anthropic-format endpoint.
        """
        if not v:
            return None
        v = v.rstrip("/")
        if v.endswith("/v1"):
            v = v[: -len("/v1")]
        return v or None

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
