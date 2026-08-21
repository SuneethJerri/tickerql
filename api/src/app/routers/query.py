"""The agentic text-to-SQL endpoint.

This is the only route that executes SQL it did not author. It runs through
`SqlAgent`, which validates every candidate statement and executes it as
`sqlproj_agent` - a role with SELECT on five relations and no write grant.
"""

from __future__ import annotations

import logging
from dataclasses import asdict

from fastapi import APIRouter, HTTPException

from app.agent.runner import AgentRefused, AgentUnavailable, SqlAgent
from app.config import get_settings
from app.db import agent_connection
from app.models import QueryAttempt, QueryRequest, QueryResponse

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["agent"])


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
    )


@router.post("/query", response_model=QueryResponse)
def natural_language_query(payload: QueryRequest) -> QueryResponse:
    """Answer a natural-language question about the market data.

    Returns the plain-English answer, the SQL that produced it, and the rows,
    so the answer can always be audited against the query that backs it.
    """
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
