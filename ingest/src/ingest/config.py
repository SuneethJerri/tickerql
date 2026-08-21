"""Configuration, loaded from the environment or a .env file at the repo root."""

from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[3]
DB_DIR = REPO_ROOT / "db"


class Settings(BaseSettings):
    """Runtime configuration.

    `database_url` is the owner connection. On Neon it must be the direct
    (non-pooled) endpoint: DDL and REFRESH ... CONCURRENTLY do not survive
    pgbouncer.
    """

    database_url: str = "postgresql://sqlproj_owner:localdev@localhost:5433/sqlproj"

    # Applied by `migrate`; kept out of the SQL so the DDL stays committable.
    sqlproj_api_password: str = "changeme"
    sqlproj_agent_password: str = "changeme"

    # yfinance | tiingo | alphavantage
    price_source: str = "yfinance"
    tiingo_api_key: str | None = None
    alphavantage_api_key: str | None = None
    # Raises rate limits; does not lift the 365-day history cap.
    coingecko_api_key: str | None = None

    model_config = SettingsConfigDict(
        env_file=REPO_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


def get_settings() -> Settings:
    return Settings()
