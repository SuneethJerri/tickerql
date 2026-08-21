#!/usr/bin/env python
"""Pre-push gate: prove no real secret is in anything git would publish.

Rather than scanning for patterns that *look* like secrets, this takes the
actual values out of the local env files and searches the tracked tree and the
full commit history for each one. Pattern scanners miss whatever they were not
taught; this cannot miss a secret that is actually in the file, because it is
searching for that exact string.

Values are never printed. A finding reports the variable name and where the
value was found, never the value.

    .venv/bin/python scripts/check_no_secrets.py
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
ENV_FILES = (".env", ".env.neon", ".env.local", "web/.env.local")

# Values that legitimately appear in the repository. These are not credentials:
# they are defaults, public endpoints and identifiers that the committed
# templates and docs are supposed to contain.
PUBLIC = {
    "localdev",        # docker-compose password for the throwaway local database
    "changeme",        # placeholder in db/003_roles.sql and the templates
    "yfinance",
    "postgres",
    "sqlproj",
    "https://openrouter.ai/api",
    "anthropic/claude-opus-5",
    "claude-opus-5",
    "api_key",
    "bearer",
    "medium",
}

# Variables that are configuration by definition, never credentials. Their
# values legitimately appear in committed defaults and docs. Listed by name
# rather than by value so changing a CORS origin or model id does not require
# touching this file. Anything not listed here is treated as a secret.
NON_SECRET_KEYS = {
    "CORS_ORIGINS",
    "PRICE_SOURCE",
    "ANTHROPIC_MODEL",
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_AUTH_STYLE",
    "AGENT_EFFORT",
    "AGENT_MAX_TOKENS",
    "API_POOL_MAX_SIZE",
    "AGENT_POOL_MAX_SIZE",
    "VITE_API_BASE",
}

MIN_LENGTH = 8


def git(*args: str) -> str:
    return subprocess.run(
        ["git", *args], cwd=REPO, capture_output=True, text=True
    ).stdout


def collect() -> dict[str, str]:
    """Map "file:VARIABLE" -> secret value, including passwords inside URLs."""
    found: dict[str, str] = {}
    for name in ENV_FILES:
        path = REPO / name
        if not path.exists():
            continue
        for line in path.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key, value = key.strip(), value.strip().strip("\"'")
            if len(value) < MIN_LENGTH or value in PUBLIC or key in NON_SECRET_KEYS:
                continue
            match = re.match(r"^\w+://[^:/]+:([^@]+)@", value)
            if match and match.group(1) not in PUBLIC:
                found[f"{name}:{key} (password)"] = match.group(1)
            if not value.startswith(("postgres://", "postgresql://")):
                found[f"{name}:{key}"] = value
    return found


def main() -> int:
    secrets = collect()
    if not secrets:
        print("  no local secrets found to check — is .env populated?")
        return 0

    tracked = git("ls-files").split()
    blob = subprocess.run(
        "git ls-files -z | xargs -0 cat 2>/dev/null",
        shell=True, cwd=REPO, capture_output=True, text=True,
    ).stdout
    history = git("log", "-p", "--all")

    leaked = []
    for label, value in sorted(secrets.items()):
        in_tree, in_history = value in blob, value in history
        if in_tree or in_history:
            where = " and ".join(
                w for w, hit in (("tracked files", in_tree), ("commit history", in_history)) if hit
            )
            leaked.append((label, where))
            print(f"  [FAIL] {label:<46} found in {where}")
        else:
            print(f"  [PASS] {label:<46} absent")

    env_tracked = [f for f in tracked if Path(f).name.startswith(".env")]
    print(f"\n  {len(secrets)} secret(s) checked against {len(tracked)} tracked files and all history")
    print(f"  env files tracked: {env_tracked or 'none'}")
    for f in env_tracked:
        if not f.endswith(".example"):
            leaked.append((f, "tracked — only .env.example may be committed"))
            print(f"  [FAIL] {f} is tracked and is not a template")

    if leaked:
        print(f"\n  {len(leaked)} problem(s). DO NOT PUSH until resolved.")
        return 1
    print("\n  safe to push: no secret value appears anywhere git would publish")
    return 0


if __name__ == "__main__":
    sys.exit(main())
