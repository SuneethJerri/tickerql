# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

A full-stack stock/crypto analytics platform with an **agentic text-to-SQL layer**.
Daily OHLCV for 15 assets (4 equity sectors + crypto) lands in Postgres; a FastAPI
service exposes analytics endpoints plus a `/query` endpoint where an LLM turns a
natural-language question into read-only SQL; a React dashboard renders it.

## The one non-negotiable constraint

**The SQL-generation agent must be physically incapable of writing to the database.**

This is enforced at three layers, and the *first* one is the real enforcement —
the other two are defence in depth:

1. **Postgres grants** (`db/003_roles.sql`) — the `sqlproj_agent` role is never
   granted `INSERT`/`UPDATE`/`DELETE` on anything, runs with
   `default_transaction_read_only = on`, and has `ALTER DEFAULT PRIVILEGES`
   revoking future tables. `api/tests/test_db_privileges.py` proves it.
2. **AST validation** (`api/src/app/agent/guard.py`) — sqlglot parse, single
   `Select` only, table allowlist, function denylist.
3. **Execution context** — `BEGIN READ ONLY`, `statement_timeout`, row cap.

If you are changing anything in this area: **never** add a write grant to
`sqlproj_agent`, and never weaken the privilege test to make something pass.
A prompt instruction is not a security control.

## Layout

```
db/       DDL, applied in numeric order. 001 tables → 002 materialized views
          → 003 roles/grants → seed_assets.sql
ingest/   Python CLI. Fetches OHLCV, upserts idempotently, refreshes views.
api/      FastAPI. routers/ = analytics endpoints, agent/ = text-to-SQL.
web/      Vite + React + TypeScript + Recharts.
docs/     DECISIONS.md (see below), DEPLOY.md.
```

## Always log decisions

`docs/DECISIONS.md` is a running record of **every** design decision and **every**
mistake, with reasoning. This is a standing requirement from the user, not a
one-off. When you make a non-obvious choice, add a `D-NN` entry. When something
goes wrong — a failed command, a wrong assumption, a boundary you overran — add
an `M-NN` entry saying what it cost and what the fix is. Do not quietly correct
mistakes; log them.

## Data sources — read before touching ingestion

- **yfinance is the OHLCV backbone for equities *and* crypto history.** Verified
  working: 16 tickers × 3 years in ~10s.
- **CoinGecko's keyless API caps historical data at 365 days** (`error_code 10012`).
  It cannot supply the 2–3 year crypto history. It is used for market cap, the
  trailing-365d window, and daily refresh only. This deviates from the original
  spec and is documented in the README on purpose.
- Yahoo 429s plain `curl` from this network but not `yfinance`, which uses
  `curl_cffi` TLS impersonation. Don't "fix" this by swapping in raw HTTP.
- `PriceSource` is a protocol with swappable implementations. Add sources there,
  not with conditionals at call sites.

## Conventions

- **Money is `numeric`, statistics are `double precision`.** Exact storage,
  floating-point math. Don't compute `exp()`/`power()` over `numeric`.
- **Returns come from `adj_close`**, falling back to `close`. Raw closes make
  splits look like crashes (NVDA and AAPL both split inside our window).
- **Annualisation: 252 periods/year for equities, 365 for crypto.** One constant
  for both overstates equity vol by ~20%.
- Materialized views carry a UNIQUE index so `REFRESH ... CONCURRENTLY` works.
  If you add a view, add the index too or the nightly refresh will lock the API.
- Schema is `market`, not `public`.
- `ingest_runs` is deliberately **not** granted to the agent role.

## Commands

```bash
docker compose up -d db                      # local Postgres 17
.venv/bin/python -m ingest probe             # source reachability
.venv/bin/python -m ingest migrate           # apply db/*.sql in order
.venv/bin/python -m ingest backfill --years 3
.venv/bin/python -m ingest refresh --lookback-days 7
.venv/bin/python -m ingest refresh-views
.venv/bin/python -m pytest
```

## Environment

Python 3.14 (verified: full dependency set resolves cleanly). Single root
`.venv` shared by `ingest/` and `api/`. Target DB is Neon — so all DDL must be
runnable by a **non-superuser owner role**. No superuser-only constructs.
