"""API configuration, loaded from the environment or the repo-root .env."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

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

    # Ceiling on rows returned to a client from any single request.
    max_rows: int = 5000

    model_config = SettingsConfigDict(
        env_file=REPO_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
