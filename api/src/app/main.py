"""FastAPI application entrypoint."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from datetime import date

import psycopg
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import get_settings
from app.db import api_connection, close_pools, open_pools, pool_stats
from app.models import HealthResponse
from app.routers import analytics, query

logging.basicConfig(level=logging.INFO, format="%(levelname)-7s %(name)s: %(message)s")
log = logging.getLogger("app")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    open_pools(settings)
    try:
        yield
    finally:
        close_pools()


app = FastAPI(
    title="Stock & Crypto Analytics API",
    version="0.1.0",
    description=(
        "Analytics over daily OHLCV for 16 assets across four equity sectors "
        "and crypto, plus an agentic text-to-SQL endpoint that runs against a "
        "SELECT-only database role."
    ),
    lifespan=lifespan,
)

_settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    # Explicit origins rather than "*": a deployed API should not be drivable
    # from an arbitrary page.
    allow_origins=_settings.cors_origin_list,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)

app.include_router(analytics.router)
app.include_router(query.router)


# ---------------------------------------------------------------------------
# Error handling. Database errors are logged, never returned verbatim: the text
# of a failed statement discloses schema, and would echo model-generated SQL.
# ---------------------------------------------------------------------------

@app.exception_handler(psycopg.errors.QueryCanceled)
async def handle_query_timeout(request: Request, exc: psycopg.errors.QueryCanceled):
    log.warning("query timeout on %s: %s", request.url.path, exc)
    return JSONResponse(
        status_code=504,
        content={"detail": "The query exceeded its time limit. Try a narrower window."},
    )


@app.exception_handler(psycopg.errors.InsufficientPrivilege)
async def handle_privilege_error(request: Request, exc: psycopg.errors.InsufficientPrivilege):
    # Expected when generated SQL reaches beyond the agent's allowlist. That is
    # the security boundary doing its job, not a server fault.
    log.warning("privilege denied on %s: %s", request.url.path, exc)
    return JSONResponse(
        status_code=403,
        content={"detail": "That query touches data this role may not read."},
    )


@app.exception_handler(psycopg.Error)
async def handle_database_error(request: Request, exc: psycopg.Error):
    log.exception("database error on %s", request.url.path)
    return JSONResponse(
        status_code=503,
        content={"detail": "The database is unavailable or the query failed."},
    )


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

@app.get("/api/health", response_model=HealthResponse, tags=["meta"])
def health() -> HealthResponse:
    """Liveness plus data freshness.

    Reports staleness rather than just connectivity: a reachable database
    holding three-week-old prices is a broken analytics platform, and a plain
    200 would hide that.
    """
    try:
        with api_connection() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT (SELECT count(*) FROM market.assets),"
                "       (SELECT count(*) FROM market.price_history),"
                "       (SELECT max(date) FROM market.price_history)"
            )
            assets, rows, latest = cur.fetchone()
    except Exception as exc:  # noqa: BLE001
        log.exception("health check failed")
        return HealthResponse(
            status="degraded", database=False, detail=str(exc)[:200], pools=pool_stats()
        )

    stale = (date.today() - latest).days if latest else None
    # Equity markets close for weekends and holidays, so a few days of lag is
    # normal; beyond a week something has actually stopped working.
    healthy = bool(assets) and bool(rows) and stale is not None and stale <= 7

    return HealthResponse(
        status="ok" if healthy else "degraded",
        database=True,
        asset_count=assets,
        price_rows=rows,
        latest_bar=latest,
        stale_days=stale,
        pools=pool_stats(),
        detail=None if healthy else "Price data is stale; run `ingest refresh`.",
    )


@app.get("/", include_in_schema=False)
def root() -> dict:
    return {"service": "sqlproj-api", "docs": "/docs", "health": "/api/health"}
