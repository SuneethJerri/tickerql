#!/usr/bin/env python
"""Validate .env.neon without ever printing a credential.

Written after M-38: the previous inline version masked passwords by parsing the
URL and reformatting it, so when parsing failed it fell through to printing the
raw string - the live password. The rule here is the inverse: nothing is
printed unless it was successfully parsed, and the password field is never
included in any output path at all.

It also fixes M-39: the "direct URL has no -pooler" check used to run against
`hostname or ""`, which passed vacuously when parsing failed. Every host
assertion is now gated behind an explicit "did this parse" precondition.

    .venv/bin/python scripts/check_neon_env.py
"""

from __future__ import annotations

import sys
from pathlib import Path
from urllib.parse import urlsplit

ENV_PATH = Path(__file__).resolve().parents[1] / ".env.neon"


def load(path: Path) -> dict[str, str]:
    env: dict[str, str] = {}
    for line in path.read_text().splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, _, value = stripped.partition("=")
        value = value.strip()
        # Values are stored quoted because Neon URLs contain '&', which an
        # unquoted `source` reads as job control (M-40).
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        env[key.strip()] = value
    return env


def describe(url: str) -> str | None:
    """Return a safe one-line description, or None if it did not parse.

    Never returns the password, and never falls back to the raw string.
    """
    if not url:
        return None
    parts = urlsplit(url)
    if not (parts.scheme and parts.hostname and parts.username):
        return None
    return f"{parts.scheme}://{parts.username}:***@{parts.hostname}{parts.path}"


def main() -> int:
    if not ENV_PATH.exists():
        print(f"  {ENV_PATH.name} not found")
        return 1

    env = load(ENV_PATH)
    failures: list[str] = []

    def check(label: str, ok: bool, detail: str = "") -> bool:
        if not ok:
            failures.append(label)
        suffix = f" — {detail}" if detail and not ok else ""
        print(f"  [{'PASS' if ok else 'FAIL'}] {label}{suffix}")
        return ok

    required = ("DATABASE_URL", "NEON_POOLED_URL")
    parsed: dict[str, object] = {}
    for key in required:
        safe = describe(env.get(key, ""))
        if safe is None:
            # Deliberately says nothing about the value itself.
            check(f"{key} parses as a connection URL", False, "unset or malformed")
            continue
        print(f"  {key:<16} {safe}")
        parsed[key] = urlsplit(env[key])

    # Precondition, stated separately so nothing below can pass vacuously.
    both = check("both URLs parsed", len(parsed) == len(required))

    if both:
        direct, pooled = parsed["DATABASE_URL"], parsed["NEON_POOLED_URL"]
        check("direct host has no '-pooler'", "-pooler" not in direct.hostname)
        check("pooled host has '-pooler'", "-pooler" in pooled.hostname)
        check("the two hosts differ", direct.hostname != pooled.hostname)
        check(
            "same role, password and database",
            (direct.username, direct.password, direct.path)
            == (pooled.username, pooled.password, pooled.path),
        )
        check("sslmode set on direct", "sslmode" in (direct.query or ""))

    for key in ("SQLPROJ_API_PASSWORD", "SQLPROJ_AGENT_PASSWORD"):
        check(f"{key} is set and long enough", len(env.get(key, "")) >= 20)
    check(
        "the two role passwords differ",
        env.get("SQLPROJ_API_PASSWORD") != env.get("SQLPROJ_AGENT_PASSWORD"),
    )

    derived = ("DATABASE_URL_API", "DATABASE_URL_AGENT")
    if all(k in env for k in derived):
        roles = {}
        for key in derived:
            safe = describe(env[key])
            if check(f"{key} parses", safe is not None):
                roles[key] = urlsplit(env[key]).username
                print(f"       role = {roles[key]}")
        # The single mistake that silently defeats the whole security model.
        check(
            "API and AGENT use DIFFERENT roles",
            len(set(roles.values())) == 2,
            "same role in both — the agent would run with the API's privileges",
        )
        check(
            "API and AGENT URLs are not identical",
            env["DATABASE_URL_API"] != env["DATABASE_URL_AGENT"],
        )

    print()
    if failures:
        print(f"  {len(failures)} check(s) failed: {', '.join(failures)}")
        return 1
    print("  all checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
