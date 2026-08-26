# tickerql

Daily OHLCV for 135 assets — the 11 GICS sectors, seven Indian NSE sectors and
crypto — in Postgres, with a FastAPI analytics layer, a React dashboard, and an
LLM agent you can ask questions in plain English.

The agent cannot write to the database. That is enforced by Postgres role
grants, not by asking it nicely in the prompt.

The schema is still `market` and the database roles are still `sqlproj_*`.
Renaming them means a migration plus new credentials in four places, so the old
project name survives below the application layer.

## Architecture

```mermaid
flowchart LR
  subgraph Sources
    YF["yfinance<br/>daily OHLCV<br/>equities and crypto"]
    CG["CoinGecko<br/>market cap · 365d refresh"]
  end

  subgraph Ingest["ingest/ — Python CLI"]
    BF[backfill] --> UPS[("idempotent upsert<br/>ON CONFLICT DO UPDATE")]
    RF[refresh] --> UPS
  end

  subgraph DB["Postgres — schema: market"]
    T["assets · price_history · ingest_runs"]
    MV[["materialized views<br/>daily_returns · asset_metrics · sector_daily"]]
  end

  subgraph API["api/ — FastAPI"]
    AN["/api/analytics/*"]
    AG["/api/query · /api/query/stream<br/>text-to-SQL"]
  end

  WEB["web/ — React + Recharts"]
  LLM["LLM<br/>Anthropic API or gateway"]
  GHA["GitHub Actions<br/>nightly cron"]

  YF --> BF & RF
  CG --> RF
  UPS --> T --> MV
  T & MV -->|"role: sqlproj_api<br/>read-only"| AN
  MV -.->|"role: sqlproj_agent<br/>SELECT on 5 relations"| AG
  AG <-->|run_sql tool| LLM
  AN & AG --> WEB
  GHA --> RF
```

Three roles at three privilege levels: `sqlproj_owner` writes, `sqlproj_api`
reads everything, `sqlproj_agent` reads five relations. The agent's pool
authenticates as the third one, so it cannot reach the write path even if every
check above it is bypassed.

## The security model

The requirement was that the SQL-generating agent only ever run against a
SELECT-only role, enforced in the database rather than in the prompt. Three
layers do that. The grants are the real enforcement; the other two exist so a
bug in one layer does not get as far as Postgres.

**1. Postgres grants** — [`db/003_roles.sql`](db/003_roles.sql)

```sql
GRANT USAGE  ON SCHEMA market TO sqlproj_agent;
GRANT SELECT ON market.assets, market.price_history, market.daily_returns,
                market.asset_metrics, market.sector_daily
             TO sqlproj_agent;                        -- note: NOT ingest_runs

ALTER DEFAULT PRIVILEGES IN SCHEMA market REVOKE ALL ON TABLES FROM sqlproj_agent;

ALTER ROLE sqlproj_agent SET default_transaction_read_only = on;
ALTER ROLE sqlproj_agent SET statement_timeout = '5s';
ALTER ROLE sqlproj_agent CONNECTION LIMIT 5;
```

No `INSERT`, `UPDATE`, `DELETE` or `TRUNCATE` grant is ever issued to this role,
and `ALTER DEFAULT PRIVILEGES` means a table added next month does not quietly
become reachable. All of it runs as a plain owner role, since Neon does not hand
out superuser.

**2. AST validation** — [`api/src/app/agent/guard.py`](api/src/app/agent/guard.py)

Every candidate statement goes through sqlglot before it reaches the database:
one statement only, root node must be a `SELECT` or set operation, every
resolved table in a five-name allowlist, a function denylist (`pg_sleep`,
`pg_read_file`, `dblink`, `lo_import`, …), and a `LIMIT` injected or clamped.

The guard walks every node rather than just the root, because a data-modifying
CTE — `WITH x AS (DELETE FROM … RETURNING *) SELECT * FROM x` — has `Select` at
the root and would sail through a root-only check.

**3. Execution context**

`SET TRANSACTION READ ONLY` before anything else, `SET LOCAL statement_timeout`,
a row cap, and a truncation flag on the response.

**The proof.**
[`api/tests/test_db_privileges.py`](api/tests/test_db_privileges.py) runs 33
tests that attempt `INSERT`, `UPDATE`, `DELETE`, `DROP`, `CREATE`, `TRUNCATE`
and `GRANT` as `sqlproj_agent` and check each one is refused. Every write is
retried with `SET default_transaction_read_only = off`, because that flag is
settable by the role itself — a suite that only tested with it on would be
testing a session default an attacker can just turn off. With it off the writes
still fail, which is what shows the grants are doing the work.

Two limits worth naming. `statement_timeout` is role-overridable too, so the 5s
ceiling is a resource guard and not a security guarantee; the row cap and the
read-only transaction are what bound the damage. And the agent can read every
row of the five relations it is granted — this is write protection and table
scoping, not row-level security.

## Quickstart

Needs Python 3.14, Node 20+, Docker and [`uv`](https://docs.astral.sh/uv/).

```bash
cp .env.example .env          # local defaults work as-is against docker compose

docker compose up -d db       # Postgres 17 on :5433

uv venv && uv pip install -r api/requirements.txt -r ingest/requirements.txt
uv pip install -e ./ingest -e ./api --no-deps

.venv/bin/python -m ingest probe             # check sources are reachable first
.venv/bin/python -m ingest migrate           # 001 → 002 → 003 → seed, in order
.venv/bin/python -m ingest backfill --years 3
.venv/bin/python -m ingest refresh-views
.venv/bin/python -m ingest coverage          # 752 bars/equity, 1096/crypto

.venv/bin/python -m pytest                   # 251 tests

.venv/bin/uvicorn app.main:app --reload      # :8000
cd web && npm install && npm run dev         # :5173
```

The frontend proxies `/api` to `127.0.0.1:8000` in dev, so CORS never comes up
locally. `/api/query` returns `503` with setup instructions until
`ANTHROPIC_API_KEY` is set; everything else works without it.

The agent can run against a gateway instead of api.anthropic.com — that is
configuration, not a code change. For OpenRouter:

```bash
ANTHROPIC_BASE_URL=https://openrouter.ai/api    # NOT .../api/v1
ANTHROPIC_AUTH_STYLE=bearer
ANTHROPIC_API_KEY=<your OpenRouter key>
ANTHROPIC_MODEL=anthropic/claude-opus-5
AGENT_EFFORT=                                   # blank omits output_config
```

The Anthropic SDK appends `/v1/messages` itself, so a trailing `/v1` double-paths
into a 405 and the config validator strips it. `output_config` is
Anthropic-specific and a gateway may reject it outright, which is what the blank
`AGENT_EFFORT` is for. Full runbook in [`docs/DEPLOY.md`](docs/DEPLOY.md).

## What the data says

Generated from the live database by
[`scripts/insights.py`](scripts/insights.py), so a refresh that falsifies a
claim rewrites it rather than leaving a stale one in place.

```bash
.venv/bin/python scripts/insights.py --markdown
```

<!-- INSIGHTS:START -->

_Trailing 365 days ending 2026-08-25, from split- and dividend-adjusted closes. Risk-free rate assumed zero, so "return per unit of risk" is annualised return over annualised volatility._

### 1. More risk did not mean more return

Crypto ran 4.0x India: Consumer's volatility (57.3% vs 14.2%) and returned -51.3% against 0.3% — more risk and a worse outcome over the same window.

That is easy to dismiss as a crypto story, but the same thing shows up inside equities: India: IT carried 1.67x India: Consumer's volatility (23.7% vs 14.2%) to return -14.9%, less than India: Consumer's 0.3%.

| Sector | Return | Ann. vol | Return/risk |
|---|---:|---:|---:|
| Health Care | 39.7% | 17.5% | 2.27 |
| Energy | 53.0% | 24.6% | 2.17 |
| Industrials | 31.2% | 17.4% | 1.80 |
| Communication Services | -2.6% | 15.8% | -0.17 |
| India: IT | -14.9% | 23.7% | -0.64 |
| Crypto | -51.3% | 57.3% | -0.90 |

_Best and worst three of 19 sectors._

### 2. Crypto diversifies a stock portfolio, not itself

Average pairwise correlation *within* crypto is **0.72**, the highest of any sector — but India: IT is right behind at 0.67, so tight internal correlation is a property of narrow sectors rather than something peculiar to crypto.

The distinctive number is the other one. Crypto's average correlation to large-cap tech is **0.17**, against 0.34 within equity sectors. Adding a second crypto to a crypto book buys almost nothing; adding crypto to an equity book does.

### 3. Drawdown carries information volatility does not

ADA fell **-84.6%** peak to trough against ORCL's **-64.6%**, the worst equity. On its own that is unremarkable: 1.3x the drawdown on 1.2x the volatility is roughly what volatility already predicts.

Divide each asset's drawdown by its own volatility and the split tracks outcome more than asset class, though the two ranges overlap in this window. The **84** assets that finished the window positive sit at or below **1.11**; the **51** that finished negative sit at or above **0.62**. AMT is an equity that lost only -10.6% and still lands in the second group.

Volatility treats a 5% rise and a 5% fall as the same event, so it prices the size of the moves but not the order they arrive in. Drawdown is the order, and it is the loss someone actually has to sit through.

### 4. The best return and the best investment are different assets

AMD posted the highest return in the set at **187.6%**, but ranks 5th risk-adjusted — it took 70.6% volatility to get there. **MPC** leads at 3.24 on 34.0% volatility, with a -18.3% maximum drawdown — the shallowest in the set.

| Asset | Sector | Return | Ann. vol | Return/risk | Max drawdown |
|---|---|---:|---:|---:|---:|
| MPC | Energy | 107.9% | 34.0% | 3.24 | -18.3% |
| JNJ | Health Care | 57.5% | 18.7% | 3.06 | -11.0% |
| MRK | Health Care | 90.2% | 29.9% | 3.01 | -11.4% |
| HDFCBANK | India: Financials | -23.9% | 20.8% | -1.19 | -27.5% |
| NKE | Consumer Discretionary | -48.4% | 36.7% | -1.33 | -48.9% |
| ITC | India: Consumer | -29.9% | 19.9% | -1.48 | -33.6% |

_Top and bottom three of 135. 52 assets finished the window with a negative ratio; the worst was ITC at -1.48._

<!-- INSIGHTS:END -->

## Data model

Schema is `market`, not `public`.

| Relation | Kind | Notes |
|---|---|---|
| `assets` | table | 135 rows across 19 sectors. `ticker` unique, `asset_type ∈ {stock, crypto}`, `source_symbol` maps `BTC` → `BTC-USD` and `RELIANCE` → `RELIANCE.NS`, `coingecko_id` for the mcap pass, `currency` `USD`/`INR` |
| `price_history` | table | PK `(asset_id, date)`. `close > 0` and `high >= low` enforced by CHECK |
| `ingest_runs` | table | Per-run audit. Deliberately not granted to the agent role |
| `daily_returns` | matview | Simple and log returns from `COALESCE(adj_close, close)` |
| `asset_metrics` | matview | Per `(asset_id, window_days ∈ {30, 90, 365})`: return, annualised return, annualised volatility, return/risk, max drawdown, avg volume |
| `sector_daily` | matview | Equal-weighted sector return plus a cumulative index rebased to 100 |

Every matview carries a `UNIQUE` index so `REFRESH MATERIALIZED VIEW
CONCURRENTLY` works. Without one the nightly refresh takes an `ACCESS
EXCLUSIVE` lock and stalls the API.

Four conventions that are easy to get wrong:

- **Money is `numeric`, statistics are `double precision`.** Exact storage,
  floating-point math. `exp()` and `power()` over `numeric` are slow and prone
  to overflow.
- **Returns come from `adj_close`, falling back to `close`.** Raw closes make
  splits look like crashes, and NVDA and AAPL both split inside this window.
- **Annualisation is 252 periods/year for equities, 365 for crypto.** One
  constant for both overstates equity volatility by roughly 20%.
- **Correlations intersect on common dates.** An equity–crypto pair is computed
  over the 251 shared trading days, not crypto's 365, so weekend crypto moves
  are not paired against nothing.

## API

| Method | Path | |
|---|---|---|
| `GET` | `/api/health` | liveness and data freshness — returns `degraded` with `stale_days` rather than a bare 200 |
| `GET` | `/api/assets` | universe with per-asset coverage |
| `GET` | `/api/prices/{ticker}` | OHLCV series, `start`/`end` optional |
| `GET` | `/api/analytics/sector-performance` | return, volatility, return/risk per sector |
| `GET` | `/api/analytics/sector-index` | equal-weighted cumulative index, rebased to 100 |
| `GET` | `/api/analytics/volatility` | volatility ranking |
| `GET` | `/api/analytics/correlation` | pairwise matrix; 18,225 cells for 135 assets |
| `GET` | `/api/analytics/periods` | best/worst days or months |
| `GET` | `/api/analytics/moving-averages/{ticker}` | 20/50/200-day, with an `is_partial` flag during ramp-up |
| `GET` | `/api/analytics/risk-return` | the scatter feed |
| `POST` | `/api/query` | natural language → SQL → answer |
| `POST` | `/api/query/stream` | the same answer as server-sent events, reported as the agent works |

Interactive docs at `/docs`.

Both query routes accept a bounded `history` of prior turns so follow-ups can
refer back. The bound is server-side — 12 turns and 12,000 characters, trimmed
rather than rejected — because an unbounded transcript is a billing problem, not
an error anyone would see.

`/api/query` always returns the SQL behind the answer plus every rejected
candidate and why, so an answer can be audited against the query that produced
it:

```jsonc
{
  "answer": "Crypto had the highest volatility at 57.1% annualised …",
  "sql": "SELECT sector, annualized_volatility FROM …",
  "columns": ["sector", "annualized_volatility"],
  "rows": [["Crypto", 0.571], …],
  "attempts": [ { "sql": "…", "accepted": false, "rejection": "table not in allowlist: pg_stat_activity" } ],
  "model_calls": 2,
  "truncated": false
}
```

## Frontend

Four views. The binding constraint turned out to be colour, not data: the
validated categorical palette clears eight hues on the *adjacent* pairlist
(lines, bars) and only three on *all-pairs* (scatter, small multiples). With 19
sectors neither is close, so past the cap `sectorColor()` returns `null` and the
caller has to fold or facet. It never wraps around and silently reuses a hue.
That rule shaped three of the four views.

| View | Form | Why |
|---|---|---|
| **Dashboard** | 19 sector small multiples, shared y-domain, one hue | No colour cap at all: identity is the panel label, comparison is the shared scale. A 19-line chart is unreadable at any palette size |
| **Risk vs return** | Scatter, two hues (equity/crypto), six labelled extremes | Labelling all 135 points printed one solid block of overlapping text. The six are computed from the data, so the set moves with the window |
| **Correlation** | 19×19 sector means, click a cell to drill into its assets | 135×135 is 18,225 cells and ~3,500 px tall. A sector cell is the mean of the pairwise correlations behind it, self-pairs excluded so intra-sector cells are not inflated by sector size |
| **Ask** | Conversational transcript with live progress | Follow-ups refer back to earlier turns; every step is a real boundary in the agent loop, not a timer |

Five themes (Light, Dark, Midnight, Graphite, Sepia) on one axis and four accents
on another, so any pairing works. Each theme surface goes through the dataviz
validator against the series palette before it ships —
[`web/scripts/README-themes.md`](web/scripts/README-themes.md) records the runs
and the validator is vendored beside it, so the result is reproducible from a
clone.

The validator only reads colour, so layout is checked by
[`web/scripts/screenshot.py`](web/scripts/screenshot.py), which shoots every view
in every theme at 1440px headless. Every layout defect found so far has been a
collision or an overflow no validator could have caught.

On the Ask page, `/api/query/stream` reports boundaries the agent loop already
passes through — model call started and finished, candidate SQL produced, guard
verdict, statement executing, rows returned. Only the elapsed clock is computed
in the browser, because a progress display that invents phases on a timer lies
exactly when the model is slow. Answers arrive as markdown and render as
markdown via a small renderer in
[`web/src/components/Markdown.tsx`](web/src/components/Markdown.tsx) rather than
react-markdown plus remark-gfm, which is about 100 kB for six constructs. It
builds React elements and never touches `dangerouslySetInnerHTML`.

## Data sources

yfinance is the OHLCV backbone for equities *and* crypto history: 100 tickers ×
3 years in 5.1 seconds, measured rather than assumed. Requests are chunked 40 at
a time so one bad ticker fails its own chunk instead of the whole run, which is
not theoretical — `APD` failed transiently mid-backfill and succeeded on retry.

CoinGecko's keyless API caps historical data at 365 days (`error_code 10012`),
probed and confirmed. It cannot supply the 2–3 years of crypto history the brief
called for, so crypto history comes from the same provider as equities and
CoinGecko is kept for what it is actually best at: market capitalisation, the
trailing-365-day cross-check, and the daily refresh. This is a deliberate
deviation from the original spec, forced by their pricing tier.

Yahoo rate-limits plain `curl` from some networks but not yfinance, which uses
`curl_cffi` TLS impersonation, so swapping in raw HTTP would bring the block
back. `PriceSource` is a protocol with swappable implementations in
[`ingest/src/ingest/sources/`](ingest/src/ingest/sources/); Tiingo and
AlphaVantage are wired up as alternates.

One thing to know before touching the CoinGecko path: `/market_chart/range`
granularity depends on the range length — ≤ 2 days returns 5-minute data, 3–90
days hourly, 91+ days daily. A 7-day refresh returned 187 points, which would
have upserted over each other and stored an arbitrary intraday price as the
daily close, corrupting every downstream figure with no error at any layer. The
fix is a `_last_per_date()` aggregation, logged as M-11.

## Layout

```
db/       DDL applied in numeric order: 001 tables → 002 matviews → 003 roles → seed
          queries/  hand-written analytics SQL, loaded from disk at runtime so the
                    text the tests validate is the text the endpoints execute
ingest/   Python CLI. Fetches OHLCV, upserts idempotently, refreshes views.
api/      FastAPI. routers/ = analytics, agent/ = guard + prompt + runner.
web/      Vite + React + TypeScript + Recharts.
scripts/  insights.py — regenerates the README's numbers from the database.
docs/     DECISIONS.md (every decision and every mistake, with what each cost),
          DEPLOY.md (the ordered runbook).
```

## Tests

```bash
.venv/bin/python -m pytest          # 251
```

| File | | Covers |
|---|---:|---|
| `test_guard.py` | 54 | AST validation, including data-modifying CTEs |
| `test_api.py` | 39 | endpoint contracts and error paths |
| `test_db_privileges.py` | 33 | the security boundary, adversarially |
| `test_gateway_config.py` | 28 | base-URL and auth-style handling for non-Anthropic gateways |
| `test_queries.py` | 22 | each analytics query against invariants — correlation symmetry, unit diagonal, moving-average ramp-up |
| `test_query_stream.py` | 19 | conversation-history bounds, SSE progress events, the streaming route |
| `test_agent.py` | 18 | the agent loop against a fake Anthropic client |
| `test_ratelimit.py` | 16 | the sliding window, client identification, the disable path |
| `test_prompt.py` | 12 | prompt structure, cache markers, and that it describes the schema that exists |
| `test_query_endpoint.py` | 10 | `/api/query` including the unconfigured 503 path |

The query tests recompute results independently in Python and compare, rather
than asserting the shape of whatever the SQL happened to return. Several suites
are also mutation-tested: a deliberate break is introduced and the run has to
fail, since a passing test that cannot fail proves nothing.

## Deployment

[`docs/DEPLOY.md`](docs/DEPLOY.md) has the ordered runbook: Neon → Render →
Vercel → GitHub Actions. The artifacts are committed
([`render.yaml`](render.yaml), [`api/Dockerfile`](api/Dockerfile),
[`web/vercel.json`](web/vercel.json),
[`.github/workflows/daily-refresh.yml`](.github/workflows/daily-refresh.yml));
the deploys themselves need accounts and are run by hand.
