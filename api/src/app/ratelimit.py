"""Per-client rate limiting for the one endpoint that costs money.

Every analytics endpoint is a cheap indexed read. `/api/query` calls a language
model, so an open one is somebody else's budget to spend. CORS does not help:
it is a browser rule, and `curl` ignores it.

A fixed-size sliding window held in memory. That is sound here specifically
because the service runs a single uvicorn worker - see api/Dockerfile, where
the worker count is pinned so pool sizes stay under the agent role's
CONNECTION LIMIT. Under multiple workers or replicas each process would keep
its own counter and the effective limit would multiply; that is the point at
which this should move to Redis rather than be quietly trusted.
"""

from __future__ import annotations

import threading
import time
from collections import defaultdict, deque


class SlidingWindowLimiter:
    """Allow `limit` events per `window_seconds`, tracked per key."""

    def __init__(self, limit: int, window_seconds: float) -> None:
        self.limit = limit
        self.window = window_seconds
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def check(self, key: str, now: float | None = None) -> tuple[bool, float]:
        """Return (allowed, seconds_until_next_slot).

        Recording only happens when the call is allowed, so a client that keeps
        hammering a closed window does not push its own reset further away.
        """
        now = time.monotonic() if now is None else now
        with self._lock:
            hits = self._hits[key]
            cutoff = now - self.window
            while hits and hits[0] <= cutoff:
                hits.popleft()

            if len(hits) >= self.limit:
                # `hits` is empty when limit is 0, so there is no oldest hit to
                # count down from; the window never opens.
                retry_after = max(0.0, hits[0] + self.window - now) if hits else self.window
                return False, retry_after

            hits.append(now)
            return True, 0.0

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


def client_key(request) -> str:
    """Identify the caller, preferring the proxy's forwarded address.

    Render and Vercel both sit in front of the app, so `request.client.host` is
    the proxy. `X-Forwarded-For` is client-controlled and trivially spoofed,
    which would let one caller present as many; the left-most entry is used
    anyway because the alternative - limiting on the proxy address - collapses
    every visitor into a single bucket and rate-limits everyone at once. This
    slows down casual abuse and does not stop a determined one.
    """
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"
