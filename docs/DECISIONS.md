# Decision & Mistake Log

Running record of every choice made on this project and why, plus every mistake
and what it cost. Newest phase last. Entries are written as they happen, not
reconstructed afterwards.

---

## Phase 0 — Environment probing & scaffold

### Decisions

**D-01 · Probe the environment before writing the plan.**
The project directory was empty, so there was no codebase to explore. Instead of
assuming a stack, I checked runtime versions, network reachability, and
dependency resolvability first. This surfaced two blocking facts (D-04, D-05)
that would otherwise have been discovered mid-build.

**D-02 · Neon for the hosted database.** User's choice from the options offered.
Consequence: all DDL must run as a non-superuser owner role. Everything in
`db/003_roles.sql` is plain `CREATE ROLE` / `GRANT` / `REVOKE` / `ALTER ROLE SET`,
which Neon's owner role can execute. No `superuser`-only constructs anywhere.

**D-03 · Asset universe fixed at 15 + 4 sectors + crypto.** User accepted the
proposed set. Chosen for *contrast* rather than coverage: Energy and Tech have
very different volatility profiles, Healthcare is the defensive block, and crypto
sits far out on the risk axis. That spread is what makes the risk-vs-return
scatter and the README insights say something non-obvious.

**D-04 · yfinance is the primary OHLCV source for equities *and* crypto history;
CoinGecko is demoted to market cap, the trailing-365d window, and daily refresh.**
Forced, not preferred. CoinGecko's keyless API returns `HTTP 401 / error 10012`
for any range beyond 365 days — 2–3 years of crypto history is a paid feature.
yfinance serves `BTC-USD` / `ETH-USD` / `SOL-USD` with full daily OHLCV going
back years, for free. This is a real deviation from the original spec ("CoinGecko
API for crypto") and will be stated plainly in the README rather than glossed
over. CoinGecko stays in the pipeline because it is genuinely the better source
for market capitalisation, which Yahoo does not provide.

**D-05 · Ingestion is written against a `PriceSource` protocol with swappable
implementations.** Yahoo returned `HTTP 429` to plain curl from this IP. That
made a single-source design an unacceptable single point of failure, so the
source layer was abstracted before any source was written. Tiingo and Alpha
Vantage remain drop-in alternates via `PRICE_SOURCE=`. The abstraction is kept
even though yfinance turned out to work (see M-04) — the risk was real and the
cost of the seam is one small protocol.

**D-06 · Store both `close` and `adj_close`; compute all returns from
`adj_close`.** Unadjusted closes make splits and dividends look like price
crashes. NVDA and AAPL both have splits inside a 3-year window, so returns
computed from raw close would be materially wrong. `COALESCE(adj_close, close)`
in `daily_returns` handles crypto, which has no corporate actions.

**D-07 · Annualise with 252 periods/year for equities and 365 for crypto.**
Crypto trades every day; equities trade ~252 days a year. Using one constant for
both would overstate equity volatility by roughly 20% (`sqrt(365/252) ≈ 1.20`)
and make the whole risk-return comparison misleading — which is precisely the
comparison this platform exists to support.

**D-08 · Derived layer is materialized views, not plain views, each with a
UNIQUE index.** The analytics endpoints and the agent both read these on every
request; recomputing window functions over ~12k bars per call is wasted work.
The UNIQUE index is not decoration — it is the precondition for
`REFRESH MATERIALIZED VIEW CONCURRENTLY`, which lets the nightly refresh run
without taking an exclusive lock that would stall the live API.

**D-09 · Cast to `double precision` inside the derived layer.** `exp()` and
`power()` over `numeric` are slow and overflow-prone at the precisions involved.
Money is stored as `numeric` (exact) in `price_history`; only the *statistics*
are computed in floating point, where a 1e-15 rounding difference is irrelevant.

**D-10 · Name the risk-adjusted column `return_per_unit_risk`, not
`sharpe_ratio`.** It assumes a zero risk-free rate, so it is not a Sharpe ratio.
Calling it one would be a small, quiet lie in a schema that an LLM will read and
repeat to users. The README documents the assumption.

**D-11 · `ingest_runs` is deliberately excluded from the agent's grants.** It is
operational metadata, not market data. Excluding it demonstrates that the grant
list is a considered allowlist rather than a blanket `GRANT SELECT ON ALL TABLES`,
and keeps ingestion errors out of user-facing answers.

**D-12 · `CHECK (high >= low)` tolerates NULLs.** Rows sourced from CoinGecko can
carry a real close and volume with no open/high/low. A strict constraint would
reject legitimate data; the constraint fires only when both bounds are present.

**D-13 · Schema named `market`, not `public`.** `REVOKE ALL ON SCHEMA public FROM
PUBLIC` is a blunt instrument with surprising side effects (extensions, default
grants). A dedicated schema makes the agent's `search_path` pinning and the
default-privileges revocation clean and auditable.

**D-14 · Single root `.venv` shared by `ingest/` and `api/`.** Two packages that
share psycopg, pydantic, and test tooling. One environment is simpler to run and
matches how the deploy images will be built. Revisit only if their dependency
sets diverge.

**D-15 · Python 3.14 (the system default) rather than pinning to 3.12.**
Verified the full dependency set resolves cleanly on 3.14 before committing to
it, so the usual "new Python, no wheels" risk was measured rather than assumed.

### Mistakes

**M-01 · Wrote `uv pip compile -o /dev/null`, which failed with
`Permission denied at "/dev/.tmpXXXX"`.** uv writes to a temp file next to the
output path and renames it; `/dev/null` has no writable directory. Harmless — the
resolution itself had already succeeded and printed — but it cost a re-run.
*Fix:* write to a real scratch file.

**M-02 · Passed a file path to `ls` to check for a file's existence and got
`error: invalid value ... for '--icons <WHEN>'`.** `ls` on this machine is
aliased to `eza`, which parses arguments differently. *Fix:* use `test -f` or
`find` for existence checks rather than assuming coreutils behaviour.

**M-03 · First `curl` reachability check silently produced no output for PyPI.**
I batched several `curl` calls with `-s` and a short timeout; one produced nothing
and I nearly read that as "unreachable". *Fix:* re-ran with `-sS` (show errors)
and an explicit `rc=$?`. Lesson: a silent failure and a negative result look
identical unless you force the error channel open.

**M-04 · Planned around yfinance while holding evidence it might be blocked.**
Yahoo 429'd every curl attempt, including with a browser UA and a cookie jar. I
reasoned — correctly, as it turned out — that `yfinance` 1.6 uses `curl_cffi`
with Chrome TLS fingerprint impersonation and would likely get through, but I
*chose not to verify it* during planning because plan mode restricts writes and
installing a package touches the uv cache. The plan therefore shipped with its
single largest technical risk unresolved, mitigated only by a fallback design.
Verification took 90 seconds once execution began and came back clean: all 16
tickers, 3 years, 10 seconds.
*Judgement:* respecting the plan-mode constraint was right, but I should have
said explicitly in the plan that a 90-second check would collapse the risk, so
the cost of deferring it was visible. The fallback abstraction (D-05) is kept
regardless — it cost little and the risk was genuine.

**M-05 · Used `datetime.utcfromtimestamp()` in a throwaway probe script and
tripped a `DeprecationWarning` on Python 3.14.** Scratch code, no impact, but it
is the deprecated API. *Fix in any retained code:*
`datetime.fromtimestamp(ts, datetime.UTC)`.

**M-06 · Initially assumed CoinGecko could serve 2–3 years of daily crypto
history because the spec said so.** My first internal sketch of the ingestion
layer had CoinGecko as the crypto backbone. Probing the actual endpoint returned
`error_code 10012` and forced the redesign in D-04. *Lesson:* a requirement that
names a specific third-party API is still an assumption about that API's free
tier until it returns 200.

**M-07 · Overran the requested stop boundary.** The instruction to stop after
Phase 0 arrived after `db/001_schema.sql` and `db/002_derived.sql` had already
been written. Both are Phase 1 artifacts. They are kept (deleting finished work
helps nobody) but are **unverified** — no database has executed them. They must
be applied and tested before being trusted.

---

## Phase 1 — Schema + ingestion

Outcome: 16 assets, 13,077 real OHLCV rows spanning 3 years, derived layer
built, 11/11 data sanity gates green, 33/33 privilege tests green.

### Decisions

**D-16 · Moved `db/003_roles.sql` from Phase 4 into Phase 1.** The plan filed
roles under the agent phase, but `migrate` has to apply the complete migration
set or the database is in a half-configured state. Creating the roles early also
means the security boundary is testable from the moment data exists, rather than
three phases later.

**D-17 · No passwords in any SQL file.** `003_roles.sql` creates roles without
credentials; `migrate` assigns them afterwards via
`psycopg.sql.SQL(...).format(sql.Identifier(role), sql.Literal(password))`.
Keeps the DDL safe to commit while still being a single command to apply.

**D-18 · The resume checkpoint is the data, not a side file.** The plan proposed
`.ingest_checkpoints/`. Using `SELECT asset_id, max(date) ... GROUP BY asset_id`
instead means the checkpoint can never disagree with what was actually
persisted — a crash between "write rows" and "write checkpoint file" is not a
failure mode that exists.

**D-19 · Added `assets.source_symbol`.** yfinance wants `BTC-USD`; users and the
LLM should see `BTC`. Encoding that as a column beats a string convention like
`ticker + "-USD"`, which silently breaks the first time a provider disagrees.

**D-20 · Added `price_history.market_cap`.** Populated for crypto from
CoinGecko, NULL for equities. *Tension acknowledged:* no endpoint currently
reads it, so this is mild scope creep. Kept because it is the one datum
CoinGecko uniquely provides, and without it CoinGecko's presence in the pipeline
is decorative rather than functional.

**D-21 · CoinGecko points are aggregated to one bar per UTC date, last-observation-wins.**
Their granularity is range-dependent (see M-11). Volume is a *rolling 24h*
figure, so last-of-day is correct there too — summing hourly points would have
inflated it by ~24x.

**D-22 · The privilege test suite was written in Phase 1, not Phase 4.** It is
the proof of the platform's headline requirement. Once the roles existed, there
was no reason to leave that claim unverified for three phases.

**D-23 · The privilege tests assert *effects*, not *exceptions*, wherever the
two can diverge.** See M-12 — a test that asserts "this raises" can pass for
entirely the wrong reason.

**D-24 · `statement_timeout` is documented as a default, not a guarantee.**
Verified: the role can raise its own limit to 10 minutes with a plain `SET`. So
it bounds honest queries only. The real protection against a runaway generated
query is that the AST guard permits a single `SELECT` and no `SET`, plus an
app-set per-transaction timeout. A test asserts this explicitly so nobody later
mistakes the role setting for a hard control.

**D-25 · Commit granularity and the refusal to backdate.** The user asked for
frequent small pushes "so that it looks like I am committing something daily."
Small logical commits: yes, adopted — it is better practice regardless. Backdating
commit timestamps to manufacture activity on days no work happened: declined.
Contribution graphs are read by third parties as a record of when work occurred.
Genuine incremental commits make the history active because it *is* active.
Branch renamed `master` -> `main` to match GitHub's default.

### Mistakes

**M-08 · Repeated M-02 verbatim.** Ran `ls <path>` again and hit the same
`eza --icons` parse error. A logged mistake that recurs is a process failure,
not a slip. *Fix, now standing:* use `find` for listing, `test -f` for existence.

**M-09 · Package/directory name collision.** The project directory `ingest/`
(containing `pyproject.toml` and `src/`) shadows the installed package `ingest`
as an implicit namespace package when running from the repo root:
`ingest.__file__` was `None` and `python -m ingest` failed with
"No module named ingest.__main__". The editable install's path hook wins once
the package is installed, so the documented workflow works — but a fresh clone
that runs `python -m ingest` *before* `uv pip install -e ingest/` will hit a
confusing error. *Accepted with documentation* rather than renaming the
directory, since renaming risks missed references across CLAUDE.md, the plan,
and future CI. Revisit if it bites again.

**M-10 · yfinance MultiIndex bug — caught by the probe, not by reasoning.**
I wrote `frame[symbol] if len(symbols) > 1 else frame`, assuming a single-symbol
`yf.download` returns flat columns. It does not: with `group_by="ticker"`,
columns are a MultiIndex regardless of symbol count, so the single-symbol path
raised `KeyError: ['Close']`. *Root cause:* I validated the multi-symbol path
during Phase 0 and the single-symbol path with a *different API*
(`yf.Ticker().history()`), then wrote code assuming they behaved alike.
*Fix:* branch on `isinstance(frame.columns, pd.MultiIndex)` — the actual shape,
not a proxy for it.

**M-11 · CoinGecko granularity assumption — the most dangerous bug so far.**
I assumed `/market_chart/range` returns daily points. It does not: the
granularity depends on range width (≤2d -> 5-minute, 3–90d -> hourly, 91d+ -> daily).
The 7-day refresh returned **187 points for 7 days**. Because the primary key is
`(asset_id, date)`, those would have upserted over each other and stored an
essentially arbitrary intraday price as the official daily close — silently
corrupting every downstream return, volatility, and correlation figure with no
error anywhere. Caught only because the probe printed a bar count that was
obviously too large. *Fix:* explicit last-observation-per-date aggregation in
the source. *Lesson:* a row count that looks wrong is worth ten seconds of
attention; this would not have surfaced as an exception at any layer.

**M-12 · A privilege test that asserted the wrong mechanism.** I asserted that
`GRANT ALL ON market.assets TO sqlproj_agent` raises `InsufficientPrivilege`. It
does not — PostgreSQL treats a GRANT from a non-owner without grant option as a
**no-op with a warning** (`no privileges were granted for "assets"`), returning
success. The security was never actually broken (INSERT privilege stayed
`False`, the write stayed blocked), but the test was wrong, and the failure mode
of that wrongness is bad: someone could have "fixed" the failing test by
loosening the assertion and never noticed that the interesting property was
never being checked. *Fix:* assert the effect —
`has_table_privilege(...) is False` plus the write still failing.

**M-13 · Broke the test file with a careless string replacement.** Inserted a new
function at the `def test_forbidden_reads_are_rejected(` anchor, which sits
*below* its `@pytest.mark.parametrize` decorator — so the decorator bound to the
new function and pytest failed collection with "function uses no argument
'label'". *Fix:* deleted the stray decorator line. *Lesson:* when inserting
before a function, anchor on the decorator, not the `def`.

**M-14 · The plan said "15 assets" but lists 16.** 4 Tech + 3 Energy + 3
Financials + 3 Healthcare + 3 Crypto = 16. An arithmetic slip in my own plan,
carried from the user's original "~15 assets". The seed file and all docs now
say 16.

### Verification evidence

| Check | Result |
|---|---|
| Migrations 001/002/003/seed | Applied clean, first attempt |
| Backfill | 16/16 assets, 13,077 rows, ~10s |
| Coverage | 753 bars/equity, 1096/crypto, 2023-08-21 -> 2026-08-20 |
| Data sanity gates | 11/11 PASS (no dupes, no non-positive closes, no high<low, no interior NULL returns) |
| Annualisation split (D-07) | Confirmed: 251 observations/equity vs 365/crypto in the 365-day window |
| Metric plausibility | Crypto vol 44-69% w/ -53%..-75% drawdowns; equities 18-37%; JNJ lowest at 18.6% |
| Privilege suite | 33/33 PASS, including writes still blocked after `SET default_transaction_read_only = off` |


---

## Phase 2 — Core SQL

Outcome: 8 hand-written analytics queries in `db/queries/`, a loader shared by
tests and (later) endpoints, 22 query tests, 55 tests green overall.

### Decisions

**D-27 · Queries live in `.sql` files, not Python string literals.** The exact
text the test suite validates is the exact text the endpoints will execute.
With SQL embedded in Python, the tested query and the shipped query can drift
apart silently — usually the moment someone "just tweaks" an f-string. A small
loader (`app/sql.py`) reads them by name.

**D-28 · One query serves both the volatility ranking and the risk-vs-return
scatter.** They are the same rows ordered and projected differently. Two query
files would mean two definitions of "annualised volatility" free to diverge.
`asset_risk_metrics.sql` returns both plus a `volatility_rank`, and the callers
choose the projection.

**D-29 · Moving averages use a LATERAL with LIMIT, not a window frame.** A frame
bound (`ROWS BETWEEN n PRECEDING`) must be a literal and cannot be
parameterised, but the endpoint spec allows arbitrary window sizes. The LATERAL
takes the last `w` closes on or before each date and averages them — same
result, parameterisable. Because that substitution is exactly the kind of thing
that can be subtly wrong, it is verified against an independent Python
reimplementation rather than trusted.

**D-30 · The moving average is computed over full history, then trimmed to the
display window.** Otherwise a 200-day average at the left edge of a 365-day
chart would be computed from a truncated series and be quietly wrong. A
`bars_used` / `is_partial` pair makes the ramp-up at the very start of history
explicit instead of hiding it.

**D-31 · Correlation uses an inner join on date — the intersection of trading
days.** Crypto trades weekends, equities do not. Zero-padding equity weekends
would mechanically drag every crypto/equity correlation toward zero and
manufacture a diversification story that isn't there. A test asserts the
cross-pair observation count equals the equity's own count.

**D-32 · `sector_index` rebases to 100 at the start of the *requested window*.**
The stored `cumulative_index` is rebased to the start of all history, so
charting a 90-day window from it would start the lines at arbitrary values and
misrepresent relative performance over that window.

**D-33 · README insights are generated by `scripts/insights.py`, not pasted.**
Hand-copied figures rot the first time the data refreshes. The script emits
either human-readable output or the README section directly, so the numbers can
always be re-derived and can never silently contradict the database.

**D-34 · The query loader rejects path traversal.** `load()` resolves the path
and asserts it stays inside `db/queries/`. The name is developer-supplied today,
but the agent phase introduces a component whose whole job is to accept
untrusted input, and a loader that can read arbitrary files is a bad thing to
have lying around by then.

**D-35 · Created the `api/` package now rather than in Phase 3.** The loader
needs a home that both the tests and the future endpoints import from. Building
it here avoids writing a throwaway test-local loader and then deleting it.

### Mistakes

**M-15 · Assumed a fresh working directory between Bash calls.** Ran
`cd db/queries` in one call and `cd db/queries` again in the next; the second
failed with "No such file or directory" because the working directory persists
across calls and I was already there. The files landed correctly by luck, not by
design — had the relative path resolved to something that *did* exist, they
would have been written to the wrong place. *Fix, now standing:* `cd` to an
absolute path, or use paths relative to the repo root, never relative to
wherever the last command happened to leave me.

**M-16 · Used `\echo` inside `psql -c`.** Backslash commands are psql meta-syntax
and only work in interactive/`-f` mode; `-c` hands the whole string to the
server as SQL, which rejected it. Switched to running queries through Python,
which was the better tool anyway — it avoided sed-substituting parameters into
SQL text to make it psql-runnable, which is both fiddly and exactly the habit
this project should not be building.

**M-17 · Wrote a test whose most interesting branch never executed.**
`test_moving_average_matches_independent_python` asserts
`is_partial == (bars_used < window_size)` — but it ran with `window_days=365`,
a window that sits well inside 3 years of history, so `is_partial` was `False`
on every single row and the assertion never tested anything. Caught by explicitly
checking whether the flag was ever `True` (it is: 199 partial rows once the
window reaches the start of history). *Fix:* a dedicated ramp-up test asserting
`bars_used` climbs 1..199 exactly. *Lesson:* a passing parametrised assertion
is not evidence the interesting case was covered — check that the branch is
reachable in the data the test actually uses. This is the second time in two
phases that a green test was verifying less than it appeared to (see M-12).

### Verification evidence

| Check | Result |
|---|---|
| All 8 queries execute | 16 assets / 753 AAPL bars / 5 sectors / 256 correlation cells / 3+3 periods / 753 MA rows |
| Correlation matrix | Symmetric, unit diagonal, all values in [-1, 1], 16x16 |
| Cross-asset correlation | Uses trading-day intersection (verified: AAPL-BTC obs == AAPL obs) |
| Moving average | Matches an independent Python recomputation to 1e-9, all 753 rows |
| MA ramp-up | `bars_used` climbs exactly 1..199 before going complete |
| Sector return | Equals the geometric product of daily returns, not their sum |
| Sector index | Rebased to exactly 100.0 at window start for all 5 sectors |
| `return_per_unit_risk` | Equals `annualized_return / annualized_volatility` to 1e-9 |
| Monthly period return | Matches compounded daily returns to 1e-9 |
| SQL injection | Hostile ticker returns 0 rows; tables intact |
| Restricted role | All 8 queries run under `sqlproj_api` |
| Test suite | 55 passed (33 privilege + 22 query) |

---

## Phase 3 — FastAPI backend

Outcome: 10 endpoints over two credential-separated connection pools, 35 API
tests, 90 tests green overall, verified against a live uvicorn server.

### Decisions

**D-36 · Handlers are `def`, not `async def`.** FastAPI runs synchronous
handlers in its threadpool, which lets the endpoints use synchronous psycopg
without blocking the event loop. The alternative — `AsyncConnectionPool` and
async handlers — would mean maintaining an async path over queries that are
already tested synchronously, for no gain on this workload (short, indexed
reads against materialized views). Chosen for one code path over theoretical
concurrency headroom.

**D-37 · Two pools, two credentials, never interchangeable.** `sqlproj_api`
serves the analytics endpoints; `sqlproj_agent` is reserved for model-generated
SQL in Phase 4. The agent pool is capped at 4 against the role's
`CONNECTION LIMIT 5`, so the pool can never exhaust the role's budget and lock
itself out. `agent_connection()` carries a docstring warning against using it
for application queries — blurring that line would make the agent's reach
unauditable.

**D-38 · No SQL in the router.** Every endpoint is a thin wrapper over a named
query. The queries are tested independently in Phase 2, so an endpoint change
cannot quietly alter the maths, and reviewing "what SQL does this service run"
means reading one directory.

**D-39 · Unknown ticker returns 404, not an empty series.** An empty list reads
to a client as "this asset has no data"; a missing asset is a different
condition and should say so. The 404 body lists the known tickers, which makes
the frontend's error state useful instead of a dead end.

**D-40 · `/analytics/volatility` and `/risk-return` reject windows other than
30/90/365.** `asset_metrics` is materialized for exactly those, so any other
value would return an empty list — indistinguishable from "no data" — rather
than an error. The 400 names the supported values.

**D-41 · Health reports staleness, not just connectivity.** A reachable database
holding three-week-old prices is a broken analytics platform, and a plain 200
would hide that. `/api/health` returns `latest_bar` and `stale_days` and
degrades past a 7-day threshold (chosen to tolerate weekends and holidays).

**D-42 · Database exceptions are mapped centrally and never echoed.** The text
of a failed statement can disclose schema, and for the Phase 4 agent endpoint it
would reflect model-generated SQL straight back to the caller. Handlers log the
detail and return a shape: timeout -> 504, `InsufficientPrivilege` -> **403**,
other `psycopg.Error` -> 503. The 403 is deliberate: generated SQL reaching
past the allowlist is the security boundary working, not a server fault, and
classifying it as 500 would bury a signal worth alerting on.

**D-43 · Response models declare `float`, so `Decimal` is coerced on the way
out.** JSON has no decimal type and every consumer of these fields is a chart.
Exact values stay in Postgres; only the wire form is lossy, at a precision far
below anything a price chart can render. Documented in `models.py` rather than
left as an accident.

**D-44 · CORS lists explicit origins rather than `*`.** A deployed API should
not be drivable from an arbitrary page. Verified by a test that asserts a
hostile origin is not echoed back.

**D-45 · `/api/query` is deliberately absent.** The plan lists it under Phase 3's
endpoint block, but its implementation is Phase 4. Shipping a stub now would
mean a route that 501s and a second pass to replace it; the phase boundary is
cleaner with the route arriving alongside the agent that backs it.

### Mistakes

**M-18 · Debugged working code because I inspected a private internal.** After
wiring the router I printed `len(app.routes)`, saw 6 where I expected 11, and
started investigating a registration bug that did not exist. FastAPI 0.141
defers router flattening: included routers sit in `app.routes` as a single
`_IncludedRouter` entry and are expanded later. The routes were registered
correctly the whole time — confirmed instantly by requesting `/openapi.json`,
which listed all 10 paths. *Cost:* two wasted debugging calls. *Lesson:* check
the public surface (OpenAPI, an actual request) before reading framework
internals; internals change between versions and my mental model of them is
exactly the thing most likely to be stale.

**M-19 · Minor: a `StarletteDeprecationWarning` on every test run.** Starlette's
`TestClient` now wants `httpx2` rather than `httpx`. Harmless today and left
alone deliberately — `httpx` is a transitive dependency of the `anthropic` SDK,
and pulling in a second HTTP client to silence a warning is a worse trade than
the warning. Noted so it is a known quantity rather than a surprise later.

### Verification evidence

| Check | Result |
|---|---|
| OpenAPI schema | All 10 paths documented |
| Live uvicorn server | 8/8 endpoints 200, payloads 220 B - 31 KB |
| Health | `ok`, 16 assets, 13,077 rows, 1 day stale |
| Unknown ticker | 404 listing the valid tickers |
| Unsupported metric window | 400 naming 30/90/365 |
| Bad granularity | 422 from Pydantic literal validation |
| Hostile ticker in path | Rejected; tables intact |
| CORS | Configured origin echoed; hostile origin not |
| Endpoint agreement | `/volatility` and `/risk-return` return identical volatilities |
| Test suite | 90 passed (33 privilege + 22 query + 35 API) |

---

## Phase 4 — Text-to-SQL agent + guardrails

Outcome: AST guard, prompt with 8 few-shots, bounded agent loop, `POST /api/query`.
85 new tests; 175 green overall.

### Decisions

**D-46 · A manual tool loop rather than the SDK's beta `tool_runner`.** Two
things this buys that the runner does not: a hard ceiling of 3 model calls (a
self-correcting agent with an unbounded loop is a billing incident waiting to
happen), and an audit record of every candidate SQL string — accepted or
rejected — which is the artifact you actually want when asking "what did the
model try to run". Also avoids a beta dependency on the security-critical path.

**D-47 · The guard is an allowlist, not a denylist.** A denylist of dangerous
statements is a bet that you enumerated every dangerous thing; an allowlist of
"one SELECT over these five relations" is a bet that you enumerated what the
feature needs. The second claim is far smaller and can actually be checked.

**D-48 · The guard walks every node, not just the root.** PostgreSQL permits
data-modifying CTEs:

    WITH evil AS (DELETE FROM market.price_history RETURNING *) SELECT * FROM evil

which parses with a `Select` at the root. A root-only check — the obvious
implementation — waves every one of these through. Four such cases are tested,
and the rejection reason was verified to be the DML node rather than an
incidental parse failure.

**D-49 · Rejection reasons are written for the model, not for a log file.**
They name what was wrong *and* what is available ("Relation 'ingest_runs' is not
readable. Available: assets, price_history, ..."), because they are fed straight
back as the tool result for the model to self-correct from. A test asserts the
reason lists the permitted relations.

**D-50 · LIMIT is injected when absent and clamped when oversized.** A
well-formed `SELECT date FROM price_history` is 13,000 rows; a model asking for
a million gets the cap rather than the request.

**D-51 · The prompt is hand-written, with a drift test rather than generation.**
Generating from `information_schema` would guarantee accurate column lists but
cannot express what actually drives query quality — that returns come from
adjusted close, that annualisation is 252 vs 365, that `asset_metrics` exists
for three windows only. `test_prompt.py` parses the prompt and asserts every
documented relation and column exists, that every granted relation is
documented, and that nothing undocumented is granted. Accuracy is checked
without giving up semantics.

**D-52 · The few-shots are themselves validated.** Every example is asserted to
pass the guard *and* to execute against the real database. An example the guard
would reject teaches the model to produce rejects; one that errors teaches a
broken pattern.

**D-53 · The system prompt carries a cache breakpoint and nothing volatile.**
~2,300 tokens ride on every call, well over Opus 5's 512-token minimum. A test
asserts the question is not interpolated into the prompt and that no
timestamp/session/request identifier appears — any of which would invalidate
the cached prefix on every single request and silently convert a ~0.1x prefix
into a full-price one.

**D-54 · The agent's transaction asserts read-only and a timeout explicitly,
rather than inheriting the role defaults.** D-24 established that
`default_transaction_read_only` and `statement_timeout` are role *defaults* and
a session can raise them with a plain `SET`. The guard blocks `SET`, but the
application should not depend on that to hold: each execution opens a
transaction, issues `SET TRANSACTION READ ONLY` as its first statement, then
`SET LOCAL statement_timeout`.

**D-55 · Rows sent to the model are capped at 50; the API response carries all
of them.** The model needs enough to describe shape and quote figures; every
additional row is re-billed as input tokens on the following turn.

**D-56 · Blocked attempts are surfaced in the API response.** A user should be
able to see that the guard intervened and why. Hiding it would make the
answer look unexplained, and the boundary is a feature worth showing.

**D-57 · `SqlAgent` depends on a narrow `MessagesClient` Protocol.** The whole
surface is `.create(**kwargs)`, so the test double is ~30 lines and the entire
loop — guard, real database, result rendering — runs without an API key.

**D-58 · A missing API key is 503, not 500.** The service is healthy; one
capability is unconfigured. The message says so and points out that the
analytics endpoints work without it.

**D-59 · `InsufficientPrivilege` raised by agent SQL is logged at ERROR.** The
guard allowing something the grants refuse means the two allowlists have
drifted. That is a condition worth alerting on, not a routine rejection.

### Mistakes

**M-20 · The test double stored a reference to a mutable request.**
`ScriptedClient.create` recorded `kwargs` directly, but the agent appends to the
same `messages` list across turns — so every recorded call pointed at the same
object, and an assertion about "what was sent on call 2" silently inspected the
*final* state of the conversation. Two tests failed with a confusing
`assert False is True` before I spotted the aliasing. *Fix:* deep-copy on
capture, mirroring a real HTTP client, which serialises at call time. *Lesson:*
a test double that records arguments must snapshot them, or it is recording the
present rather than the past.

**M-21 · `vars()` on a `slots=True` dataclass.** The router built its response
with `QueryAttempt(**vars(a))`; slotted dataclasses have no `__dict__`, so this
raised `TypeError` on the happy path — a guaranteed 500 the moment a real query
succeeded. Every test that exercised a *successful* query caught it; the
error-path tests all passed. *Fix:* `dataclasses.asdict`. *Lesson:* worth noting
that the failure was invisible to two thirds of the endpoint tests, because they
exercised paths that never reached the serialisation.

**M-22 · Imported the test helper as `tests.fake_anthropic`.** `api/tests/` has
no `__init__.py`, and pytest puts the test file's own directory on `sys.path`,
so the import is `fake_anthropic`. Trivial, fixed immediately.

### Verification evidence

| Check | Result |
|---|---|
| Guard: write statements | 12/12 rejected |
| Guard: stacked statements | 3/3 rejected ("expected exactly one statement") |
| Guard: data-modifying CTEs | 4/4 rejected, by the DML node (reason verified) |
| Guard: relations outside allowlist | 9/9 rejected, incl. via subquery, join, union, CTE |
| Guard: forbidden functions | 7/7 rejected |
| Guard: `FOR UPDATE` | Rejected as LOCK |
| Guard: legitimate analytics | 9/9 allowed (CTEs, windows, unions, aggregates, corr) |
| Guard: LIMIT | Injected when absent, preserved when smaller, clamped when oversized |
| Agent: hostile SQL | Blocked, never executed; 13,077 rows still present afterwards |
| Agent: self-correction | Rejection fed back, second attempt succeeded |
| Agent: loop bound | Stops at 3 model calls |
| Agent: refusal | `stop_reason='refusal'` raises rather than reading empty content |
| Prompt: drift | Every documented relation/column exists; grants and docs match exactly |
| Prompt: few-shots | 8/8 pass the guard and execute successfully |
| Endpoint: no key | 503 with setup guidance (verified live) |
| Endpoint: internals | Exception detail not leaked to the client |
| Test suite | 175 passed (33 privilege, 22 query, 35 API, 54 guard, 13 agent, 8 prompt, 10 endpoint) |

---

## Phase 5 — React frontend

Outcome: four views (Dashboard, Risk vs return, Correlation, Ask) in React +
TypeScript + Recharts, light and dark themes, verified by screenshot in both.

### Decisions

**D-60 · Ran the palette validator instead of choosing colours by eye.** The
dataviz skill's rule is that the colour question is computable, so compute it.
Every palette in `charts/palette.ts` cites the run that justifies it.

**D-61 · The risk/return scatter does NOT colour by sector — proved, not
assumed.** A scatter is an *all-pairs* form: any two points can land side by
side, so every pair must clear the separation floors, not just adjacent ones.
Five sector hues hard-fail (magenta↔orange, normal-vision ΔE 12.9 against a
floor of 15). Rather than accept that on faith I searched the palette: **0 of 56
five-hue subsets pass all-pairs in both modes, and only 2 of 70 four-hue subsets
do** — neither a natural sector palette. So the scatter uses two hues (equities
vs crypto, which pass with ΔE 33.6) and puts identity in a direct label on all
16 points. Sector moves to the tooltip and the table. This is a better chart
than the one originally planned, and the search is why I trust that.

**D-62 · Sector lines keep five hues, because lines are an *adjacent* form.**
Those pass (worst adjacent ΔE 9.1). The validator's contrast WARN on three
light-mode slots obliges relief, which is why the chart carries direct
end-labels and a table view rather than relying on the legend alone.

**D-63 · Sector comparison is indexed to 100 at the window start.** Sector
levels are not comparable in raw units, and the alternative — a second y-axis —
is the single worst charting mistake: the alignment of two scales is arbitrary,
so the chart invents a relationship the data does not contain. Indexing puts
everything on one honest axis.

**D-64 · Price + moving averages is an EMPHASIS form, not a categorical one.**
The close is the subject; the averages are derived context. Four peer hues would
imply four peer series and bury the point. Price takes the accent hue; averages
take de-emphasis grays at a thinner stroke.

**D-65 · Correlation uses a diverging scale with a neutral gray midpoint.**
Correlation is polar data with a meaningful zero. A sequential ramp would imply
-1 and +1 are opposite ends of one magnitude; they are equally strong and
oppositely signed. Gray at the midpoint makes "uncorrelated" read as nothing
rather than as a third category.

**D-66 · Correlation axes are ordered by sector, not alphabetically.** A
correlation matrix earns its keep by showing block structure — the crypto
cluster at 0.88, the energy cluster at 0.8. Alphabetical order scatters those
blocks so the reader has to hunt for the thing the chart exists to show.

**D-67 · The heatmap is CSS grid, not Recharts.** A matrix of labelled cells is
a table that happens to be coloured. The grid gives exact 2px surface gaps, real
text nodes for screen readers, and no dependency on a charting library's cell
primitives.

**D-68 · Plain CSS custom properties rather than Tailwind.** The theming
contract the skill specifies — light values on `:root`, dark declared under both
a `prefers-color-scheme` media query and a `[data-theme]` scope so the toggle
wins both ways — is written directly in terms of custom properties. Tailwind
would add a build step and indirection for no benefit here.

**D-69 · Sector → colour slot is a fixed map.** Colour follows the entity, never
its rank: filtering or re-sorting must not repaint the survivors, because a
reader who learned "Energy is orange" is misled when it changes.

**D-70 · Partial moving averages are plotted as gaps, not as values.** Near the
start of history a 200-day average is computed from fewer than 200 bars.
Drawing it as if complete would mean the line silently changes meaning at the
left edge.

### Mistakes

All four of the chart bugs below were invisible to the validator, to
TypeScript, and to a clean console. Every one was found by rendering the page
and looking at it — which is exactly why the skill makes that a required step
rather than a nicety.

**M-23 · Equity sector lines rendered as dashes.** The pivot from long to wide
format leaves a hole wherever a sector has no bar on a date — and crypto trades
weekends while equities do not, so **114 of 365 dates carry only crypto**. Every
equity line was broken into **56 disconnected fragments** (confirmed by counting
`M` commands in the SVG path: 56 for equities, 1 for crypto). It read as a
deliberate dashed style rather than as broken data. *Fix:* `connectNulls` — a
non-trading day is not a missing observation.

**M-24 · The y-axis printed raw floats.** `domain={["dataMin - 4", "dataMax + 4"]}`
produced ticks like `37.79566314788631`, which the 44px axis width clipped into
visual mush ("788632"). I had read that as a data bug. *Fix:* `domain={["auto","auto"]}`
plus an explicit `tickFormatter`.

**M-25 · End-labels collided and then clipped.** Labelling all five sectors
overprinted Technology and Financials, which finish within a few points of each
other; after fixing the margin, "Healthcare" was still cut off by the chart
edge. *Fix:* label only the highest and lowest ending series — sparing labels
are the whole reason direct labels work — and widen the right margin to fit.

**M-26 · The scatter's point labels never rendered at all.** I wrote a custom
`label` renderer for `<Scatter>` assuming it receives the series data; it does
not. The result was a chart with **no labels on any point** — while the entire
justification for not colouring by sector was that identity would come from
labels. For one screenshot the design was strictly worse than the option I had
rejected on principle. *Fix:* `<LabelList dataKey="ticker" />`, the actual API.
*Lesson:* when a design decision has a load-bearing dependency ("this is fine
*because* X"), verify X actually happened.

**M-27 · Killed my own shell twice while stopping background servers.** Used
`pkill -f "vite"` and then `pgrep -f "[u]vicorn app.main"`; the harness wraps
each command in a shell whose command line contains my pattern literally, so the
pattern matched my own wrapper process and the command exited 144. The `[u]`
trick does not help when the pattern is echoed into the wrapper. *Fix:* kill by
recorded PID.

### Verification evidence

| Check | Result |
|---|---|
| Palette validation | Every set run through `validate_palette.js` in both modes |
| All-pairs search | 0/56 five-hue and 2/70 four-hue subsets pass — scatter design follows from this |
| Screenshots | 4 views x 2 themes, 1440x1000 at 2x |
| Console errors | None, either theme |
| Horizontal overflow | None, either theme |
| Line integrity | Every series a single unbroken path (was 56 fragments) |
| Axis ticks | Sector chart integers; scatter rounded to multiples of 10 |
| Scatter labels | 16/16 points labelled, none clipped |
| Correlation order | Tech → Energy → Financials → Healthcare → Crypto |
| Unconfigured Ask | Renders the 503 guidance, not a raw error |
| Typecheck / build | Clean; 666 kB bundle (191 kB gzip), Recharts-dominated |
| Backend suite | 175 passed, unchanged |

---

## Phase 6 — Deploy artifacts + docs

Outcome: a container image that runs the API against a real database, blueprint
and workflow files for Render / Vercel / GitHub Actions, a deployment runbook,
and a README whose numbers are generated from the database rather than typed.

### Decisions

**D-71 · Pinned dependencies to the versions that actually pass, not to
whatever resolves today.** A plain `uv pip compile api/pyproject.toml` resolved
`anthropic==1.0.0`; the 175-test suite passes against `0.125.0`. The declared
range (`anthropic>=0.40`) permits both, so a deploy built next week would have
shipped an untested **major** version of the SDK the entire agent is written
against — `output_config`, `cache_control`, and the `stop_reason == "refusal"`
check are all SDK-surface. `constraints.txt` records the verified environment
and both lockfiles compile against it, so the image installs what was tested.
Upgrading is now a deliberate, testable change rather than a build-day
accident.

**D-72 · The API image is not `pip install`-ed; it runs from the source tree.**
`app/sql.py` and `app/config.py` both derive the repository root as
`Path(__file__).resolve().parents[3]`, and `sql.py` loads the analytics queries
from `db/queries/` at runtime — deliberately, so the SQL the tests validate is
the SQL the endpoints execute. Installing the package into `site-packages`
moves `app/` to a different depth, `parents[3]` resolves elsewhere, and every
analytics endpoint fails on first request with `FileNotFoundError`. The image
therefore copies `api/src` and `db/queries` at their repository-relative paths
and sets `PYTHONPATH`. This also forces the Docker build context to be the repo
root rather than `api/`, which is why `render.yaml` sets `dockerContext: .`.

**D-73 · The Dockerfile asserts the layout at build time.** Because D-72 is an
invisible coupling — nothing in `api/` references `db/queries` textually — a
`RUN python -c "import app.main, app.sql; assert len(app.sql.available()) >= 8"`
step fails the *build* if the layout ever breaks, instead of failing the first
production request. It printed `layout ok: 8 queries visible`.

**D-74 · One uvicorn worker, and pool ceilings sized against a real limit.**
`003_roles.sql` sets `CONNECTION LIMIT 5` on `sqlproj_agent`. Pool sizes
multiply by worker count, so two workers at `agent_pool_max_size=3` would
exceed the role's own limit and turn a burst of questions into connection
errors. Single worker, `API_POOL_MAX_SIZE=4`, `AGENT_POOL_MAX_SIZE=3`. The
endpoints are synchronous `psycopg` reads served from FastAPI's threadpool, so
concurrency comes from the threadpool and the pools, not from workers.

**D-75 · `/api/health` returns 200 when degraded, and Render is pointed at it
anyway.** Stale data is an ingestion failure, not an API failure. Returning
non-2xx would make Render restart-loop a perfectly healthy service and would
not fix the data. The `status` field carries the distinction; `render.yaml`
says so in a comment so the next person does not "fix" it.

**D-76 · No SPA catch-all rewrite on Vercel.** `App.tsx` switches tabs with
`useState`; there is no client-side router, so `/` is the only real route. A
catch-all rewrite would convert genuine 404s into a silently blank
`index.html`.

**D-77 · `cancel-in-progress: false` on the nightly workflow.** Cancelling a
run mid-ingestion buys nothing — the next scheduled run is 24 hours away, not
24 seconds — and leaves an `ingest_runs` row marked started. Upserts are
idempotent, so queueing is strictly better than cancelling.

**D-78 · The workflow fails fast on a missing secret.** Without the explicit
check, an unset `NEON_DATABASE_URL` falls through to the localhost default in
`ingest/config.py` and the run dies with a connection error that reads like a
Neon outage. Three lines of `if [ -z ... ]` turn a misleading symptom into the
actual cause.

**D-79 · README insights are generated, and every comparison is *selected* by
the data.** `scripts/insights.py --inject` rewrites the section between two
markers. More importantly, the script does not hardcode which sectors to
compare: `worst_paid_risk()` searches all sector pairs for the largest
volatility gap where the riskier sector also returned less, and reports
whichever pair wins. A refresh that falsifies a claim rewrites the prose
instead of leaving a stale assertion. The drawdown claim goes further and
checks its own separation, emitting "the ranges now overlap" if a future window
breaks it.

### Mistakes

**M-28 · Nearly shipped an untested major SDK version.** The first
`uv pip compile` run silently pinned `anthropic==1.0.0` into
`api/requirements.txt` — a file whose entire purpose is reproducibility — and I
was one commit from baking it into the deployed image. Caught only by reading
the diff of a generated file instead of trusting it. *Cost:* none, caught
before commit. *Fix:* D-71. *Lesson:* "pin the dependencies" and "pin the
dependencies **you tested**" are different tasks, and a lockfile generated
fresh does the first one while looking like the second.

**M-29 · Three of the four README insights were wrong on first draft.** All
three were fixed by checking rather than by reasoning harder:

- *"The top of the table is dominated by low-volatility names."* False — LLY
  ranks third on risk-adjusted return with the second-highest volatility in the
  set (35.7%).
- *"Crypto is one position wearing three tickers."* True but not distinctive:
  crypto's internal correlation is 0.88 and **Energy's is 0.82**. High internal
  correlation is a property of narrow sectors, not of crypto. The claim as
  written implied a crypto-specific phenomenon the data does not show. The
  comparison was also unfair — average intra-crypto correlation (one sector)
  against average all-equity correlation (four sectors, structurally lower).
  Rewritten around within-sector averages, which is like-for-like.
- *"Volatility understates how bad the bad case gets."* The generated text
  **contradicted itself**: "2.2x deeper, while volatility is only 2.2x". The
  chosen pair (SOL vs MSFT) happened to have identical drawdown and volatility
  ratios, so the sentence disproved its own headline. Replaced with the finding
  that actually exists in the data — drawdown-per-unit-volatility separates
  cleanly by the *sign of the return* (all 12 positive-return assets ≤ 0.88,
  all 4 negative ones ≥ 1.03, no overlap), which is not an asset-class story at
  all: MSFT sits with the crypto assets.

*Cost:* none shipped. *Lesson:* generated prose reads as authoritative because
it contains real numbers. The numbers being real does not make the sentence
around them true.

**M-30 · Hardcoded a count inside generated text.** Insight 3 asserted MSFT was
"above two of the three crypto assets". I checked and believed it was above one
and tied with another; computing it showed the original was right — MSFT is
above two. Both my assertion and my correction were guesses about a number
sitting in the database. *Fix:* count it in the script. *Lesson:* the point of
generating prose from data is not to save typing, it is that hand-written
numbers inside generated text are the least trustworthy part of the output.

**M-31 · Asserted an unnecessary `PYTHONPATH` in the README quickstart.** Wrote
`PYTHONPATH=api/src .venv/bin/uvicorn ...` from habit; the editable install
already puts `app` on the path, verified by importing it from `/tmp`. Harmless
but wrong, and a reader would have concluded the install was incomplete.

### Verification evidence

| Check | Result |
|---|---|
| `docker build -f api/Dockerfile .` | Succeeds; build-time layout assertion prints `layout ok: 8 queries visible` |
| Container against live Postgres | `/api/health` → `status: ok`, 16 assets, 13,077 rows |
| Containerised analytics | `sector-performance` returns all five sectors with correct figures |
| Containerised `/api/query` unconfigured | 503, as designed |
| `render.yaml` | Valid YAML; 8 env vars, 4 marked `sync: false` |
| `web/vercel.json` | Valid JSON |
| `daily-refresh.yml` | Valid YAML; `schedule` + `workflow_dispatch`, 8 steps |
| README mermaid diagram | Parsed with mermaid 11 under jsdom — `block 1: PARSES OK` |
| README endpoint table | Cross-checked against `/openapi.json`, 11 paths |
| README test counts | Cross-checked against `pytest --collect-only` per file |
| Correlation claim (251 shared days) | Confirmed: equity×crypto pairs report `observations: 251` |
| Correlation query correctness | AAPL×MSFT and XOM×CVX reproduced to 4 dp by independent Python |
| Insights regeneration | `scripts/insights.py --inject` round-trips cleanly |

---

## Debug run — all phases

A full re-verification of Phases 0–6 against the committed tree, run after
Phase 6 was complete. Every phase passed. Three of the *checks I wrote for it*
did not, which is the part worth recording.

### Mistakes

**M-32 · Wrote a data-sanity gate on an assumption instead of on the schema.**
The gate asserted `count(daily_returns) == count(price_history) - 16`, reasoning
that the first bar per asset has no previous close and would be dropped. It is
not dropped: `daily_returns` is defined as one row per bar with `simple_return`
NULL on each asset's first date, and downstream consumers filter it
(`WHERE dr.simple_return IS NOT NULL` in `sector_daily`). The view was right and
the gate was wrong. *Cost:* one false alarm. *Fix:* replaced with four gates
that assert the real invariant — exactly 16 NULL returns, each on its asset's
minimum date, none after it, and no NaN leaking into `sector_daily`.

**M-33 · Repeated M-17 inside the debug harness itself.** Checked
`is_partial == (bars_used < 200)` for the 200-day moving average at
`window_days=365`. Every row in that window has `bars_used = 200`, so both sides
were `False` on all 251 rows and the assertion could not fail. This is the exact
error M-17 recorded against the test suite, reproduced by me while verifying
that the suite no longer has it. *Fix:* re-ran over full history, where the
window genuinely ramps (198 partial rows, 554 full), and added an explicit
"both partial and full rows present" precondition so a vacuous run reports
itself. *Lesson:* a passing assertion is not evidence until you know it could
have failed.

**M-34 · A DOM selector that matched nothing, reporting a clean zero.** The
render check counted `[data-corr-cell]` elements to verify the correlation
heatmap. No such attribute exists — the cells are `.heat-cell` — so the check
returned `0` on every page including the correlation page, and read as a
successful measurement of an empty result rather than as a broken selector.
Same shape as M-26. *Fix:* real selectors, and assertions with expected values
(`256` cells, `32` axis labels, `16` diagonal cells) so a zero fails loudly
instead of passing quietly. *Lesson:* a check whose failure mode is "returns 0"
must assert a non-zero expectation, or it is decorative.

### Verification evidence

| Phase | Check | Result |
|---|---|---|
| 0 | `ingest probe` | yfinance OK; CoinGecko OK returning **8 bars for 8 days** — M-11's aggregation holding (a naive range fetch returns ~187 intraday points) |
| 1 | `ingest migrate` re-run | Idempotent; all four migrations reapply cleanly |
| 1 | Data sanity gates | 17/17 after correcting M-32: no duplicate keys, no `close <= 0`, no `high < low`, 753 bars/equity, 1096/crypto, every matview has a UNIQUE index |
| 1 | Sector index rebasing | Matview compounds from all history; the API query rebases in-window, so all five sectors start at exactly 100.0000 |
| 2 | `test_queries.py` | 22 passed |
| 2 | Correlation invariants | Symmetric, unit diagonal, all values in [-1, 1] across 256 cells |
| 2 | Correlation correctness | AAPL×MSFT and XOM×CVX reproduced to 4 dp by independent Python over the same date intersection |
| 2 | Moving average | 20-day MA matches independent Python exactly; `bars_used` ramps 1→200 over full history |
| 3 | Live endpoints | 18/18 — 14 happy paths and 4 error paths (404 unknown ticker, 422 bad window, 422 bad granularity, 404 unknown route) |
| 3 | CORS | Allowed origin echoed; disallowed origin gets no `Access-Control-Allow-Origin` |
| 3 | `test_api.py` | 35 passed |
| 4 | Privilege suite | 33 passed |
| 4 | **Independent adversarial probe** | 18 attacks (DML, DDL, `COPY TO PROGRAM`, `CREATE EXTENSION`, `SET ROLE`, `ALTER ROLE ... SUPERUSER`, data-modifying CTE, catalog reads) — **18/18 blocked with `default_transaction_read_only` both on and off**. Error type shifts from `ReadOnlySqlTransaction` to `InsufficientPrivilege` when the flag is off, which is the evidence that the grants, not the session flag, are what block writes |
| 4 | Guard probe (freshly written) | 29/29 — 22 rejections each firing on the correct node, 7 legitimate queries accepted with LIMIT injected |
| 4 | Agent / prompt / endpoint suites | 13 + 8 + 10 passed |
| 5 | `npm ci` then build | Both clean; 666 kB bundle (191 kB gzip) |
| 5 | Render check, 4 views × 2 themes | No console errors, no horizontal overflow; **all 9 line paths unbroken** (M-23), integer y-ticks (M-24), 2 sparing end-labels (M-25), **16/16 scatter labels** (M-26) |
| 5 | Correlation heatmap | 256 cells, 32 axis labels, 16 diagonal cells reading 1.0, sector-ordered Tech → Energy → Financials → Healthcare → Crypto; tooltips confirm "251 shared days" for crypto/equity pairs |
| 5 | Ask page | Submitting a question renders "Natural-language queries are not configured." — the 503 guidance, not a raw error |
| 6 | Image rebuild | Succeeds; build-time layout assertion passes |
| 6 | Container against live DB | All endpoints 200; `/api/query` 503 for a valid question, 422 for one too short |
| 6 | Container hygiene | No `.env` or secret-like file in the image; runs as uid 10001; pool sizes honoured from env (`api max=4, agent max=3`) |
| 6 | Container CORS | Honours `CORS_ORIGINS` from the environment; rejects everything else |
| 6 | README quickstart | Reproduced in a clean venv — installs resolve and pin `anthropic==0.125.0`, confirming D-71 |
| all | `pytest` | **175 passed** |

### Known limitations, not defects

- Scatter point labels crowd slightly at `COP`/`GS` and `UNH`/`NVDA`. Recharts'
  `LabelList` has no collision avoidance. Readable at 1440px; would need a
  custom label layout to fix properly.
- The guard rejects `dblink(...)` via the table allowlist (`Relation '' is not
  readable`) rather than the function denylist, because sqlglot parses it as a
  table-valued function. Rejected either way, but the message is less
  informative than it could be.
- Bundle is 666 kB (191 kB gzip), Recharts-dominated. Fine for four views; would
  want code-splitting before it grows.

---

## Post-Phase-6 — gateway support for the agent

**D-80 · The agent's LLM endpoint is configurable, defaulting to Anthropic
direct.** Asked whether OpenRouter could be used instead. It can, and it is
worth supporting as configuration rather than as a fork, because the choice
belongs to whoever holds the key. Three settings do it: `ANTHROPIC_BASE_URL`
(unset means `api.anthropic.com`), `ANTHROPIC_AUTH_STYLE` (`api_key` sends
`x-api-key`, `bearer` sends `Authorization: Bearer` — the SDK exposes both via
`api_key=` and `auth_token=`, so no HTTP-level special casing was needed), and
`AGENT_EFFORT` (blank omits `output_config` entirely). No change to the guard,
the prompt, the loop, or the database boundary — the security model is
unaffected because it never depended on which model answered.

**D-81 · `output_config` is omitted, not nulled, when effort is blank.**
`output_config: {"effort": ...}` is Anthropic-specific. A Messages-compatible
gateway may reject an unrecognised field rather than ignore it, and sending
`null` is still sending the field. The request is built as a dict and the key
is only inserted when effort is truthy, which a test pins by asserting the key
is absent rather than falsy.

**D-82 · The base URL validator strips a trailing `/v1`.** The Anthropic SDK
appends `/v1/messages` itself, so `https://openrouter.ai/api/v1` becomes
`.../v1/v1/messages` and returns 405. This is the most commonly reported
mistake when pointing the SDK at OpenRouter. The rule is safe for the real API
too, whose base URL is `https://api.anthropic.com` and not `.../v1`, so it is
applied unconditionally rather than special-cased per host.

### Mistakes

**M-35 · Nearly answered a live-API question from a stale prior.** I believed
OpenRouter was OpenAI-compatible only and had no Anthropic Messages endpoint —
which would have made the answer "no, that needs a rewrite". It has one. Had I
answered from memory I would have talked the user out of something that works
and costs three config lines. *Fix:* fetched the docs before answering.
*Lesson:* third-party API surfaces move faster than any prior about them; the
cost of checking is a single fetch, and the cost of not checking is a confident
wrong answer.

### Verification evidence

| Check | Result |
|---|---|
| SDK auth surface | Verified against installed `anthropic 0.125.0`: `api_key=` → `X-Api-Key`, `auth_token=` → `Authorization: Bearer` |
| Base URL normalisation | 7 parametrised cases incl. `/v1`, `/v1/`, bare, trailing slash, empty, `None` |
| End-to-end URL | `Anthropic(base_url=Settings(...).anthropic_base_url)` resolves to `https://openrouter.ai/api` with no `/v1/v1` |
| Effort omitted when blank | Asserted the key is **absent**, and that nothing else in the request changes |
| **Mutation test** | Forcing `if True:` fails 2 tests; removing the `/v1` strip fails 2 more — the new tests are non-vacuous |
| Full suite | 192 passed (175 + 17 new) |

### Not verified

The live path through OpenRouter needs a key and has not been exercised. Two
things to check on the first real call: whether `cache_control: {"type":
"ephemeral"}` survives the gateway (watch `usage.cache_read_input_tokens` — a
persistent zero means the ~2,300-token system prompt is billed in full every
call), and whether `stop_reason: "refusal"` is passed through. Both are
handled in code; neither is confirmed against a gateway.

**M-36 · Documented a Neon console UI that does not exist.** `DEPLOY.md` told
the reader to "copy **both** connection strings" from Connection Details, as if
two were displayed. Neon shows **one**, with a Connection-pooling toggle that
switches which is rendered — and the toggle defaults to on, so the string a new
user sees is the pooled one, which is the wrong one for migrations. A reader
following the runbook literally would have looked for a second string that was
not there, and the most likely recovery — using the one string they had — is
the failure mode the surrounding paragraph warns about. *Fix:* describe the
toggle, and note that the two strings differ only by `-pooler` in the hostname
so either can be derived from the other by hand. *Lesson:* a runbook step that
describes someone else's UI is a claim about the world with a shelf life, and
this one was never checked against the product.

**M-37 · `.gitignore` covered `.env` and `.env.local` but nothing else.** About
to suggest a `.env.neon` holding live Neon credentials, I checked whether it
would be ignored. It would not have been — nor would `.env.production`,
`.env.prod`, or any other variant. The repo had gone 38 commits with a rule
that only happened to cover the two filenames actually in use. *Fix:* `.env*`
with a `!.env.example` exception, verified against six variants plus both
committed templates. *Lesson:* an ignore rule that lists the files that exist
today is a rule that fails the first time someone adds a file — and the failure
is silent and unrecoverable once pushed.

---

## Neon provisioning

The database is live on Neon (PostgreSQL 18.6, `ap-southeast-1`), migrated and
backfilled from this machine as a non-superuser owner.

### Mistakes

**M-38 · A credential-masking function that printed the credential.** The
`.env.neon` validator masked passwords by parsing the URL with `urlsplit` and
reformatting it. The pasted values were shell-quoted, so `urlsplit` failed,
returned `hostname=None`, and the fallback printed the **raw string** — the
live Neon password, in full, to the terminal. A masking routine whose failure
mode is "print the unmasked value" is worse than no masking, because it is
trusted. *Fix:* parse first, and refuse to print anything at all when parsing
fails. *Cost:* one credential exposed in a session transcript; rotation offered.

**M-39 · The same run produced a vacuous PASS on the check that mattered.**
With `urlsplit` failing, `hostname` was `None`, so the assertion
`"-pooler" not in (hostname or "")` evaluated `"-pooler" not in ""` → **True**,
and the direct-URL check reported PASS while the URL was in fact pooled. The
check could not fail for the input it was given. *Fix:* an explicit
precondition — assert both URLs parsed to a real host **before** asserting
anything about those hosts. *Lesson:* this is the fourth instance of the same
defect in this project (M-17, M-33, M-34, M-39). The common thread is a check
written against a value that can be empty, where empty passes.

**M-40 · Stripped quotes that shell `source` requires.** The repair script
unquoted the URL values. Neon connection strings contain
`?sslmode=require&channel_binding=require`; unquoted, `source` reads the `&` as
job control and splits the line, so `DATABASE_URL` silently never got exported
and the next command failed with `KeyError`. *Fix:* quote every value on write.
*Lesson:* a dotenv file consumed by both `source` and a dotenv parser has to
satisfy the stricter of the two, and the shell is stricter.

### Verification evidence

| Check | Result |
|---|---|
| Endpoints distinguished empirically | `inet_server_addr()` differs — `169.254.254.254` direct vs `::1` behind pgbouncer |
| `ingest migrate` | All four migrations applied in 2.4s as `neondb_owner`, `superuser=False` |
| `ingest backfill --years 3` | 16/16 assets, 13,064 rows, 20.3s |
| `refresh-views` | All three materialized views rebuilt |
| Coverage | 1096 bars/crypto, 752/equity |
| **Privilege suite against Neon** | **33/33 passed** on the direct endpoint |
| Analytics queries against Neon | 22/22 passed |
| `sqlproj_api` via **pooled** endpoint | Connects and returns all five sectors in 1.2s |
| `sqlproj_agent` via **pooled** endpoint | SELECT works; INSERT and UPDATE blocked; `ingest_runs` unreadable |
| Owner credential rotated after M-38 | Confirmed by reconstructing the leaked password and asserting it now fails authentication — the only check that actually proves rotation took effect |
| Post-rotation re-verification | 33/33 privilege tests passed again; both restricted roles connect via the pooler and are still write-blocked; 16 assets / 13,064 rows intact |

**D-83 · The pre-push secret check searches for the actual secrets, not for
patterns that look like secrets.** `scripts/check_no_secrets.py` reads the real
values out of the local `.env` files and searches the tracked tree and the full
commit history for each exact string. A regex scanner only finds the shapes it
was taught and silently misses a credential in an unanticipated format; this
cannot miss a value that is actually in the file. Non-credential values that
legitimately appear in the repo (`localdev`, `yfinance`, the OpenRouter base
URL, the model id) are listed explicitly rather than filtered by heuristic, so
adding one is a visible decision. Findings report the variable name and where
the value was found, never the value — the lesson from M-38. Verified
non-vacuous by planting a real password in a tracked file: the check fails, and
catches it both standalone and embedded in a derived connection URL.

---

## Switching the agent to Llama via OpenRouter

**D-84 · `max_tokens` is configurable.** It was hardcoded at 8000. OpenRouter
returns HTTP 402 when `max_tokens` exceeds what the account balance can cover
("you requested up to 8000 tokens, but can only afford 1600"), so a fixed value
makes the agent unusable on a small balance rather than merely limited.
`AGENT_MAX_TOKENS` defaults to 8000 and is set to 4000 locally.

**D-85 · The agent detects a tool call printed as text and retries once.**
Llama 3.3 answered one test question correctly and, on the next, replied with
the literal string `<function-run_sql>{"sql": ...}` as ordinary text instead of
emitting a `tool_use` block. The loop found no tool block, treated the text as
the final answer, and returned raw function-call syntax to the user as though
it were an answer. `_looks_like_leaked_tool_call` now spots the common markers,
nudges the model once, and only gives up if it repeats. This is a
weaker-model failure mode; Claude did not exhibit it.

**D-86 · The loop keys on content blocks, not `stop_reason`.** This was already
true and turned out to matter: Llama 3.3 returns `stop_reason: "end_turn"`
alongside a valid `tool_use` block, where Claude returns `"tool_use"`. Had the
loop branched on `stop_reason` the agent would have silently stopped without
running any SQL. Worth stating so nobody "tidies" it into a `stop_reason` check.

**D-87 · One `.env`, with the local docker values commented rather than
deleted.** Configuration was split across `.env` and `.env.neon`, which meant
two files to keep in sync and two places to look. Now one file, pointing at
Neon, with the docker alternative present but commented.

### Mistakes

**M-41 · Quoting `.env` values broke the test suite's own parser.** Values were
quoted so `source` would not choke on the `&` in Neon connection strings
(M-40). `api/tests/conftest.py` has its own minimal dotenv reader that did not
strip quotes, so every URL arrived wrapped in literal `"` characters and all 33
privilege tests failed. The failure looked like a pooling problem — the
plausible hypothesis, since the URL had just moved to the pooled endpoint —
and the actual cause was visible only in the parametrised test id. *Fix:* strip
quotes in `conftest`, and prefer `DATABASE_URL_AGENT_DIRECT` for the privilege
suite since those tests flip session settings a pooler discards. *Lesson:* a
config format has as many parsers as there are readers, and the hand-rolled one
is the one that breaks.

**M-42 · Nearly recommended a model without running it.** The plan was to name
a Llama model and move on. Actually calling it surfaced three things no amount
of reasoning would have: `stop_reason` differs from Claude's, tool calls leak
into text, and Llama 4 Maverick returns empty content for this prompt entirely.

### Verification evidence

| Check | Result |
|---|---|
| Llama tool calling via OpenRouter's Anthropic endpoint | Works; `stop_reason=end_turn` with a valid `tool_use` block |
| Llama 4 Maverick | Returned zero content blocks — not usable here |
| Leaked-tool-call detection | 5 tests; mutation-checked (disabling detection fails 3) |
| Live agent, Llama 3.3, 3 questions | 3/3 correct SQL and answers, 7-13s each, 2 model calls each |
| Full suite against Neon | 197 passed (90s; network-bound) |
