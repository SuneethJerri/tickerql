"""HTTP retry with exponential backoff and jitter.

Every provider here is rate limited, and two of them (Yahoo, CoinGecko) were
observed returning 429 during initial probing. Retry policy lives in one place
so a provider module never has to reimplement it.
"""

from __future__ import annotations

import logging
import random
import time
from typing import Any

import httpx

log = logging.getLogger(__name__)

RETRY_STATUSES = {408, 425, 429, 500, 502, 503, 504}


class RateLimitExhausted(RuntimeError):
    """Raised when retries are exhausted against a rate-limited provider."""


def request_with_backoff(
    client: httpx.Client,
    method: str,
    url: str,
    *,
    max_attempts: int = 5,
    base_delay: float = 1.0,
    max_delay: float = 60.0,
    **kwargs: Any,
) -> httpx.Response:
    """Issue a request, retrying transient failures.

    Honours `Retry-After` when the provider sends it - guessing a backoff when
    the server has told you the answer just burns quota.
    """
    last_exc: Exception | None = None

    for attempt in range(max_attempts):
        try:
            resp = client.request(method, url, **kwargs)
        except httpx.HTTPError as exc:
            last_exc = exc
            resp = None

        if resp is not None:
            if resp.status_code not in RETRY_STATUSES:
                resp.raise_for_status()
                return resp
            if resp.status_code == 429:
                retry_after = resp.headers.get("Retry-After")
                if retry_after:
                    try:
                        delay = min(float(retry_after), max_delay)
                        log.warning(
                            "429 from %s; honouring Retry-After=%.1fs", url, delay
                        )
                        time.sleep(delay)
                        continue
                    except ValueError:
                        pass
            last_exc = httpx.HTTPStatusError(
                f"{resp.status_code} from {url}", request=resp.request, response=resp
            )

        if attempt == max_attempts - 1:
            break

        # Full jitter: avoids a thundering herd when several assets back off
        # against the same provider simultaneously.
        delay = min(base_delay * (2**attempt), max_delay)
        delay = random.uniform(0, delay)
        log.warning(
            "retry %d/%d for %s in %.1fs", attempt + 1, max_attempts, url, delay
        )
        time.sleep(delay)

    raise RateLimitExhausted(f"gave up on {url} after {max_attempts} attempts") from last_exc
