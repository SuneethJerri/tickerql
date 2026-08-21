"""The agentic text-to-SQL endpoint.

This is the only route that executes SQL it did not author. It runs through
`SqlAgent`, which validates every candidate statement and executes it as
`sqlproj_agent` - a role with SELECT on five relations and no write grant.
"""

from __future__ import annotations

import logging
from dataclasses import asdict

import secrets

from fastapi import APIRouter, Header, HTTPException, Request

from app.agent.runner import AgentRefused, AgentUnavailable, SqlAgent
from app.config import get_settings
from app.db import agent_connection
from app.models import QueryAttempt, QueryRequest, QueryResponse
from app.ratelimit import SlidingWindowLimiter, client_key

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["agent"])

_settings = get_settings()
_limiter = SlidingWindowLimiter(
    limit=_settings.query_rate_limit,
    window_seconds=_settings.query_rate_window_seconds,
)


def _enforce_limits(request: Request, presented_key: str | None) -> None:
    """Shared secret first, then the per-client rate limit."""
    settings = get_settings()

    expected = settings.query_api_key
    if expected:
        # Constant-time: a plain == leaks the matching prefix length by timing.
        if not presented_key or not secrets.compare_digest(presented_key, expected):
            raise HTTPException(status_code=401, detail="Invalid or missing API key.")

    if settings.query_rate_limit <= 0:
        return

    allowed, retry_after = _limiter.check(client_key(request))
    if not allowed:
        raise HTTPException(
            status_code=429,
            detail=(
                f"Rate limit reached: {settings.query_rate_limit} questions per "
                f"{settings.query_rate_window_seconds // 60} minutes. "
                f"Try again in {int(retry_after) + 1}s."
            ),
            headers={"Retry-After": str(int(retry_after) + 1)},
        )


def _build_agent() -> SqlAgent:
    settings = get_settings()
    if not settings.anthropic_api_key:
        raise AgentUnavailable(
            "ANTHROPIC_API_KEY is not configured. Set it in the environment to "
            "enable natural-language queries; the analytics endpoints work "
            "without it."
        )
    import anthropic

    # Anthropic uses x-api-key; gateways use Authorization: Bearer.
    credential = (
        {"auth_token": settings.anthropic_api_key}
        if settings.anthropic_auth_style == "bearer"
        else {"api_key": settings.anthropic_api_key}
    )
    client = anthropic.Anthropic(
        base_url=settings.anthropic_base_url,  # None => api.anthropic.com
        **credential,
    )
    if settings.anthropic_base_url:
        log.info("agent routed through gateway %s", settings.anthropic_base_url)

    return SqlAgent(
        client.messages,
        agent_connection,
        model=settings.anthropic_model,
        max_rows=settings.max_rows,
        effort=settings.agent_effort,
        max_tokens=settings.agent_max_tokens,
    )


@router.post("/query", response_model=QueryResponse)
def natural_language_query(
    payload: QueryRequest,
    request: Request,
    x_api_key: str | None = Header(default=None, alias="X-API-Key"),
) -> QueryResponse:
    """Answer a natural-language question about the market data.

    Returns the plain-English answer, the SQL that produced it, and the rows,
    so the answer can always be audited against the query that backs it.
    """
    _enforce_limits(request, x_api_key)

    try:
        agent = _build_agent()
    except AgentUnavailable as exc:
        # 503 rather than 500: the service is fine, this capability is not
        # configured, and the message says how to configure it.
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    try:
        result = agent.answer(payload.question.strip())
    except AgentRefused as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        log.exception("agent failed")
        raise HTTPException(
            status_code=502, detail="The language model call failed."
        ) from exc

    return QueryResponse(
        question=result.question,
        answer=result.answer,
        sql=result.sql,
        columns=result.columns,
        rows=result.rows,
        row_count=result.row_count,
        truncated=result.truncated,
        attempts=[QueryAttempt(**asdict(a)) for a in result.attempts],
        model=get_settings().anthropic_model,
        model_calls=result.model_calls,
        elapsed_ms=result.elapsed_ms,
        usage=result.usage,
    )
