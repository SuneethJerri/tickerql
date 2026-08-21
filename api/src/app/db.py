"""Connection pools.

Endpoints are sync `def`, so FastAPI runs them in its threadpool and psycopg
does not block the event loop.

Two pools, different credentials. The agent pool is the only one that executes
model-generated SQL.
"""

from __future__ import annotations

import logging
from contextlib import contextmanager
from typing import Iterator

import psycopg
from psycopg_pool import ConnectionPool

from app.config import Settings

log = logging.getLogger(__name__)

_api_pool: ConnectionPool | None = None
_agent_pool: ConnectionPool | None = None


def open_pools(settings: Settings) -> None:
    global _api_pool, _agent_pool
    _api_pool = ConnectionPool(
        conninfo=settings.database_url_api,
        min_size=1,
        max_size=settings.api_pool_max_size,
        open=True,
        name="api",
        # Neon autosuspends; without this a stale connection fails the
        # first request after an idle period.
        check=ConnectionPool.check_connection,
    )
    _agent_pool = ConnectionPool(
        conninfo=settings.database_url_agent,
        min_size=0,
        max_size=settings.agent_pool_max_size,
        open=True,
        name="agent",
        check=ConnectionPool.check_connection,
    )
    log.info(
        "pools open (api max=%d, agent max=%d)",
        settings.api_pool_max_size,
        settings.agent_pool_max_size,
    )


def close_pools() -> None:
    global _api_pool, _agent_pool
    for pool in (_api_pool, _agent_pool):
        if pool is not None:
            pool.close()
    _api_pool = _agent_pool = None


@contextmanager
def api_connection() -> Iterator[psycopg.Connection]:
    """A read-only connection for the analytics endpoints."""
    if _api_pool is None:
        raise RuntimeError("connection pools are not open")
    with _api_pool.connection() as conn:
        yield conn


@contextmanager
def agent_connection() -> Iterator[psycopg.Connection]:
    """The restricted connection for model-generated SQL. Nothing else."""
    if _agent_pool is None:
        raise RuntimeError("connection pools are not open")
    with _agent_pool.connection() as conn:
        yield conn


def pool_stats() -> dict[str, dict]:
    out: dict[str, dict] = {}
    for name, pool in (("api", _api_pool), ("agent", _agent_pool)):
        if pool is not None:
            stats = pool.get_stats()
            out[name] = {
                "size": stats.get("pool_size"),
                "available": stats.get("pool_available"),
                "waiting": stats.get("requests_waiting"),
            }
    return out
