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

*Not started. Two DDL files written ahead of the stop instruction; see M-07.*
