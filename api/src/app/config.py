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

    `database_url_api` and `database_url_agent` are never interchangeable:
    the agent role has SELECT on five relations and nothing else.
    """

    database_url_api: str = "postgresql://sqlproj_api:changeme@localhost:5433/sqlproj"
    database_url_agent: str = "postgresql://sqlproj_agent:changeme@localhost:5433/sqlproj"

    # sqlproj_agent has CONNECTION LIMIT 5 (003_roles.sql).
    api_pool_max_size: int = 8
    agent_pool_max_size: int = 4

    # Comma-separated; never "*".
    cors_origins: str = "http://localhost:5173,http://localhost:4173,http://localhost:3000"

    anthropic_api_key: str | None = None
    anthropic_model: str = "claude-opus-5"

    # Unset means api.anthropic.com. For a Messages-compatible gateway such as
    # OpenRouter use https://openrouter.ai/api - no /v1, the SDK appends it.
    anthropic_base_url: str | None = None

    # Anthropic wants x-api-key; most gateways want Authorization: Bearer.
    anthropic_auth_style: Literal["api_key", "bearer"] = "api_key"

    # Blank omits output_config, which some gateways reject.
    agent_effort: str = "medium"

    # Lower this if a gateway rejects the request on available credit.
    agent_max_tokens: int = 8000

    max_rows: int = 5000

    model_config = SettingsConfigDict(
        env_file=REPO_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @field_validator("anthropic_base_url")
    @classmethod
    def _normalise_base_url(cls, v: str | None) -> str | None:
        """Strip a trailing /v1; the SDK appends /v1/messages itself."""
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
