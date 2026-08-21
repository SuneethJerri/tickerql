"""One dotenv reader, shared by every script and the test suite.

There were four hand-rolled copies of this, and they disagreed. Values in
`.env` are quoted because the Neon connection strings contain `&`, which an
unquoted shell `source` reads as job control (M-40). Three parsers stripped the
quotes; one did not, so it handed psycopg a connection string with a literal
leading `"`. psycopg rejected it and echoed the whole string - password
included - into a traceback (M-41, M-47).

A config format has as many parsers as it has readers. This is the reader.
"""

from __future__ import annotations

import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]


def load_env(path: Path | None = None) -> dict[str, str]:
    """Parse a dotenv file, stripping wrapping quotes. Process env wins."""
    env: dict[str, str] = {}
    path = path or REPO_ROOT / ".env"
    if path.exists():
        for line in path.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                value = value[1:-1]
            env[key.strip()] = value
    return {**env, **os.environ}


def require(name: str, path: Path | None = None) -> str:
    value = load_env(path).get(name, "").strip()
    if not value:
        raise SystemExit(f"{name} is not set in the environment or {path or '.env'}")
    return value
