"""The agentic text-to-SQL endpoint.

This is the only route that executes SQL it did not author. It runs through
`SqlAgent`, which validates every candidate statement and executes it as
`sqlproj_agent` - a role with SELECT on five relations and no write grant.
"""

from __future__ import annotations

import json
import logging
import queue
import threading
from dataclasses import asdict
from typing import Any, Iterator

import secrets

from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import StreamingResponse

from app.agent.runner import AgentRefused, AgentResult, AgentUnavailable, ModelCallFailed, SqlAgent
from app.config import get_settings
from app.db import agent_connection
from app.models import QueryAttempt, QueryRequest, QueryResponse
from app.ratelimit import SlidingWindowLimiter, client_key

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["agent"])

# How long the stream waits on the agent before emitting an SSE comment. Model
# calls routinely run past 30s, and a connection that sends nothing for that
# long is one an intermediate proxy may decide to close.
HEARTBEAT_SECONDS = 10.0

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


def _to_response(result: AgentResult) -> QueryResponse:
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
        model_ms=result.model_ms,
        usage=result.usage,
    )



def _model_failure(exc: ModelCallFailed) -> tuple[int, str]:
    """Map an upstream model status onto one of ours.

    Only the status is used. The upstream body is never echoed, because on some
    gateways it repeats the request - and on at least one, the credential that
    was rejected.
    """
    if exc.status in (401, 403):
        # 503 for the same reason a missing key is 503 (D-58): the service is
        # fine, this one capability is unusable until an operator re-sets the
        # credential, and no amount of retrying will change that. A 502 here
        # says "try again", which is wrong and wastes the caller's time.
        return 503, (
            f"The model provider rejected this deployment's credential "
            f"(HTTP {exc.status}). It has to be re-set on the server."
        )
    if exc.status == 429:
        # Distinct from the 429 _enforce_limits raises: that one is this
        # service throttling the caller, this one is the provider throttling
        # the service. Same status, and the detail is what tells them apart.
        return 429, (
            "The model provider is rate limiting this deployment. "
            "Try again shortly."
        )
    return 502, f"The language model call failed upstream (HTTP {exc.status})."


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
        result = agent.answer(
            payload.question.strip(),
            history=[t.model_dump() for t in payload.history],
        )
    except AgentRefused as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except ModelCallFailed as exc:
        status, detail = _model_failure(exc)
        log.warning("model call failed upstream: HTTP %s", exc.status)
        raise HTTPException(status_code=status, detail=detail) from exc
    except Exception as exc:  # noqa: BLE001
        log.exception("agent failed")
        raise HTTPException(
            status_code=502, detail="The language model call failed."
        ) from exc

    return _to_response(result)


def _sse(event: dict[str, Any]) -> str:
    return f"data: {json.dumps(event, default=str)}\n\n"


@router.post("/query/stream")
def natural_language_query_stream(
    payload: QueryRequest,
    request: Request,
    x_api_key: str | None = Header(default=None, alias="X-API-Key"),
) -> StreamingResponse:
    """The same answer as POST /api/query, reported as it happens.

    Server-sent events, one JSON object per `data:` line, each carrying a
    `phase`. The terminal event is `done` (with the full QueryResponse) or
    `error`. The client can render the identical result from either route.

    Auth and rate limiting run BEFORE the response starts, deliberately: once a
    200 and the SSE headers are on the wire there is no status code left to
    send, and an error delivered inside the stream is much easier to miss.
    """
    _enforce_limits(request, x_api_key)

    try:
        agent = _build_agent()
    except AgentUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    question = payload.question.strip()
    history = [t.model_dump() for t in payload.history]

    def generate() -> Iterator[str]:
        # The agent loop is blocking and synchronous. It runs on its own thread
        # and reports through a queue, so a slow model call cannot stop the
        # heartbeat and the stream stays writable throughout.
        events: queue.Queue[dict[str, Any] | None] = queue.Queue()

        def run() -> None:
            try:
                result = agent.answer(question, history=history, on_event=events.put)
                events.put({
                    "phase": "done",
                    "result": _to_response(result).model_dump(mode="json"),
                })
            except AgentRefused as exc:
                events.put({"phase": "error", "status": 422, "detail": str(exc)})
            except ModelCallFailed as exc:
                status, detail = _model_failure(exc)
                log.warning("model call failed upstream (stream): HTTP %s", exc.status)
                events.put({"phase": "error", "status": status, "detail": detail})
            except Exception:  # noqa: BLE001
                log.exception("agent failed (stream)")
                events.put({
                    "phase": "error",
                    "status": 502,
                    "detail": "The language model call failed.",
                })
            finally:
                events.put(None)

        worker = threading.Thread(target=run, name="sql-agent", daemon=True)
        worker.start()

        yield _sse({"phase": "accepted", "question": question})
        while True:
            try:
                event = events.get(timeout=HEARTBEAT_SECONDS)
            except queue.Empty:
                yield ": keep-alive\n\n"
                continue
            if event is None:
                break
            yield _sse(event)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            # nginx and several CDNs buffer proxied responses by default, which
            # turns a progress stream into one delivery at the end.
            "X-Accel-Buffering": "no",
        },
    )
