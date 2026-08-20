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
