# Deployment runbook

Three services, deployed in this order because each one needs the previous
one's URL: **Neon** (database) → **Render** (API) → **Vercel** (frontend), then
**GitHub Actions** for the nightly refresh.

Every artifact referenced here is committed. Nothing below has been executed —
it needs accounts and credentials that live with you, not in the repository.

> **The one thing to get right:** the API and the agent connect as *different*
> Postgres roles. If you paste the same connection string into
> `DATABASE_URL_API` and `DATABASE_URL_AGENT`, the security model in
> [`db/003_roles.sql`](../db/003_roles.sql) is silently defeated — the app will
> work perfectly and the agent will be running with the API's privileges.
> `api/tests/test_db_privileges.py` proves the roles differ; nothing proves you
> pasted them into the right boxes.

---

## 1. Neon — the database

1. Create a project (Postgres 17, same region you will pick on Render).
2. Get **both** connection strings. The console shows only **one** at a time:
   click **Connect**, and use the **Connection pooling** toggle to switch which
   one is displayed. That toggle is **on by default**, so the string you see
   first is the *pooled* one.

   You do not actually need the toggle — the two strings are identical except
   for the hostname, so you can write the other one yourself:

   ```text
   pooled   ...@ep-cool-darkness-a1b2c3d4-pooler.us-east-2.aws.neon.tech/dbname?sslmode=require
   direct   ...@ep-cool-darkness-a1b2c3d4.us-east-2.aws.neon.tech/dbname?sslmode=require
                                          ^^^^^^^ the only difference
   ```

   Same role, same password, same database. They are still not
   interchangeable:

   | | Host | Used for |
   |---|---|---|
   | **Direct** | no `-pooler` | migrations, `backfill`, `REFRESH MATERIALIZED VIEW CONCURRENTLY`, the nightly job |
   | **Pooled** | `-pooler` | the Render API's two connection pools |

   The pooled endpoint runs pgbouncer in transaction mode, which discards
   session state between transactions. DDL and `REFRESH ... CONCURRENTLY` do
   not survive that. Using the pooled URL for migrations fails *after* partial
   work has already been committed.

3. Choose passwords for the two restricted roles — they are created by the
   migration, not by Neon:

   ```bash
   python -c "import secrets; print(secrets.token_urlsafe(24))"   # run twice
   ```

4. Run the migrations from your machine, as the **owner** role, over the
   **direct** endpoint:

   ```bash
   export DATABASE_URL='postgresql://<owner>:<pw>@ep-xxx.region.aws.neon.tech/<db>?sslmode=require'
   export SQLPROJ_API_PASSWORD='<generated>'
   export SQLPROJ_AGENT_PASSWORD='<generated>'

   .venv/bin/python -m ingest migrate
   ```

   This applies `001_schema.sql` → `002_derived.sql` → `003_roles.sql` →
   `seed_assets.sql`, then assigns the two role passwords. All of it is
   runnable by a non-superuser owner — Neon gives you no superuser, and the DDL
   was written for that constraint.

5. Load the history and build the derived layer (~1 minute for 135 assets):

   ```bash
   .venv/bin/python -m ingest backfill --years 3
   .venv/bin/python -m ingest refresh-views
   .venv/bin/python -m ingest coverage        # expect 752 bars/equity, 1096/crypto
   ```

6. **Verify the security boundary against the real deployment.** This is the
   step that turns the claim into a fact:

   ```bash
   export DATABASE_URL_AGENT='postgresql://sqlproj_agent:<pw>@ep-xxx.region.aws.neon.tech/<db>?sslmode=require'
   .venv/bin/python -m pytest api/tests/test_db_privileges.py -q
   ```

   33 tests. They attempt `INSERT`, `UPDATE`, `DELETE`, `DROP`, `CREATE`,
   `TRUNCATE` and `GRANT` as `sqlproj_agent` and assert each one is refused —
   including with `default_transaction_read_only` explicitly turned **off**, so
   what is being tested is the grants themselves and not a session flag.

---

## 2. Render — the API

1. **New → Blueprint**, point it at this repository. Render reads
   [`render.yaml`](../render.yaml).
2. It will prompt for the four values marked `sync: false`:

   | Variable | Value |
   |---|---|
   | `DATABASE_URL_API` | **pooled** endpoint, role `sqlproj_api` |
   | `DATABASE_URL_AGENT` | **pooled** endpoint, role `sqlproj_agent` |
   | `ANTHROPIC_API_KEY` | your key — or leave unset (see below) |
   | `CORS_ORIGINS` | filled in at step 3, after Vercel exists |

   Append `?sslmode=require` to both database URLs.

   Leaving `ANTHROPIC_API_KEY` unset is a supported state, not a broken one:
   every analytics endpoint works and `POST /api/query` returns `503` with
   setup instructions. Add the key later and the agent starts working with no
   redeploy of anything else.

   **Using OpenRouter instead of Anthropic directly.** Set four more variables
   and use your OpenRouter key as `ANTHROPIC_API_KEY`:

   | Variable | Value |
   |---|---|
   | `ANTHROPIC_BASE_URL` | `https://openrouter.ai/api` — **not** `.../api/v1` |
   | `ANTHROPIC_AUTH_STYLE` | `bearer` |
   | `ANTHROPIC_MODEL` | `meta-llama/llama-3.3-70b-instruct` — the committed default in [`render.yaml`](../render.yaml); `anthropic/claude-opus-5` also works and answers better |
   | `AGENT_EFFORT` | blank |

   The SDK appends `/v1/messages` to the base URL, so a trailing `/v1`
   double-paths into a 405; the config validator strips it, but the table
   above is the value to type. `AGENT_EFFORT` is blanked because
   `output_config` is Anthropic-specific — a gateway may reject an unknown
   field rather than ignore it. Prompt caching behaviour through a gateway is
   the other thing to watch: check `usage.cache_read_input_tokens` on a repeat
   question and, if it is zero, you are paying full price on every call.

3. First deploy will fail CORS for the browser until Vercel exists. Come back
   after step 3 and set `CORS_ORIGINS` to your Vercel origin, comma-separated
   if you want previews too:

   ```
   https://tickerql.vercel.app,https://text-to-sql-analytics-sql8.vercel.app,http://localhost:5173
   ```

   Both Vercel origins during the rename: the old hostname keeps resolving and
   keeps serving, so dropping it the moment the new domain exists 400s every
   request from it on the preflight. No trailing slashes, no spaces after the
   commas, scheme included — each is matched as an exact string.

   The API refuses `*` by design — a deployed API should not be drivable from
   an arbitrary page.

4. Confirm:

   ```bash
   curl -s https://<service>.onrender.com/api/health | jq
   ```

   Expect `"status": "ok"`. `"degraded"` with a populated `stale_days` means
   the database is fine and the data is old — run the refresh, not a redeploy.

**Free-tier behaviour worth knowing.** Render's free instances spin down after
~15 minutes idle; the next request pays a cold start of roughly 30–60 seconds.
Neon's free compute autosuspends too, which is why both pools are created with
`check=ConnectionPool.check_connection` — without it the first request after an
idle period fails on a dead pooled connection instead of transparently
reconnecting.

---

## 3. Vercel — the frontend

1. **Add New → Project**, import the repository.
2. Set **Root Directory** to `web`. Vercel then finds
   [`web/vercel.json`](../web/vercel.json) and the Vite preset.
3. Add one environment variable, for all environments:

   ```
   VITE_API_BASE = https://<service>.onrender.com
   ```

   No trailing slash. Vite inlines `VITE_*` at **build** time — if you set this
   after the first deploy, you must redeploy for it to take effect. A site
   built with it empty will call `/api/...` on the Vercel origin and 404.

4. Deploy, then go back and set Render's `CORS_ORIGINS` to the Vercel URL
   (step 2.3).

5. Confirm in the browser: all four views render, and the network tab shows
   requests going to the Render origin rather than to Vercel.

---

## 4. GitHub Actions — nightly refresh

[`.github/workflows/daily-refresh.yml`](../.github/workflows/daily-refresh.yml)
runs at 23:00 UTC and on demand.

1. **Settings → Secrets and variables → Actions → New repository secret**:

   | Secret | Value |
   |---|---|
   | `NEON_DATABASE_URL` | **direct** endpoint, **owner** role |
   | `COINGECKO_API_KEY` | optional; raises rate limits only |

   Direct, not pooled — the job ends with
   `REFRESH MATERIALIZED VIEW CONCURRENTLY`, which pgbouncer will not carry.

2. Trigger it once by hand (**Actions → daily-refresh → Run workflow**) rather
   than waiting for the cron. The run summary prints the coverage table; a
   failure summary lists the three causes that actually occur, in order.

3. Both steps are idempotent (`ON CONFLICT (asset_id, date) DO UPDATE`), so
   re-running after any failure is always safe and is the correct first move.

---

## 5. The `tickerql` rename — console steps

The repository is renamed; the deployments are not. Everything below needs a
console and cannot be done from here.

**Nothing is broken while these are pending.** The old Vercel hostname keeps
resolving and keeps working. Do them in this order — step 2 depends on step 1.

1. **Vercel → Settings → Domains → Add** `tickerql.vercel.app`, then set it as
   the **production** domain. The old
   `text-to-sql-analytics-sql8.vercel.app` keeps resolving; Vercel does not
   retire it.

2. **Render → Environment → `CORS_ORIGINS`**, set to both origins:

   ```
   https://tickerql.vercel.app,https://text-to-sql-analytics-sql8.vercel.app
   ```

   Do this **after** the domain exists and **before** you rely on it. The new
   origin is matched as an exact string, so until it is listed every request
   from it fails the preflight with a 400 — which in the browser console reads
   as a CORS error rather than a missing setting. Drop the old origin once
   nothing links to it.

3. **Redeploy both services.** This one is easy to skip and it is why the
   streaming Ask page will otherwise appear broken in production:

   - **Render** must redeploy to serve `POST /api/query/stream` at all. Until
     it does, the frontend's stream request 404s.
   - **Vercel** must rebuild because the Ask page calling that route only
     exists in the new bundle — and because `VITE_API_BASE` is inlined at
     build time, so a stale build keeps whatever value it was compiled with.

   Redeploying only one leaves a working dashboard and a dead Ask page.

4. **Vercel → Settings → Deployment Protection**: confirm it is off. With it
   on, every request — including the ones the dashboard makes — is 302'd to a
   Vercel SSO page, and the site looks broken to anyone who is not you.

The Render **service name** stays `sqlproj-api`, so the API hostname does not
move and `VITE_API_BASE` does not change. Renaming the service would relocate
it to `tickerql-api.onrender.com` and break every deployed frontend build until
`VITE_API_BASE` was updated *and* the frontend rebuilt. Nobody but the JS bundle
ever sees that hostname, so the rename buys nothing and costs an outage window.
The reasoning is repeated in [`render.yaml`](../render.yaml) next to the name,
so it does not read as an oversight.

---

## Verifying the whole chain

```bash
API=https://<service>.onrender.com

curl -s $API/api/health | jq '{status, asset_count, price_rows, latest_bar, stale_days}'
curl -s "$API/api/analytics/sector-performance?window=365" | jq '.[0]'
curl -s "$API/api/analytics/correlation?window=365" | jq '.cells | length'   # 18225 for 135 assets

curl -s -X POST $API/api/query \
  -H 'Content-Type: application/json' \
  -d '{"question":"Which sector had the highest volatility over the last year?"}' | jq '{answer, sql}'

# The streaming route the Ask page uses. -N is required: without it curl
# buffers and you see one burst at the end rather than progress.
curl -N -X POST $API/api/query/stream \
  -H 'Content-Type: application/json' \
  -d '{"question":"Which sector had the highest volatility over the last year?"}'
```

Both query calls return `503` with setup instructions until `ANTHROPIC_API_KEY`
is set. Every response from `/api/query` includes the SQL that produced it, so
any answer can be audited against the query behind it. The stream emits one
JSON object per `data:` line, ending in a `done` event carrying the identical
payload.

---

## Rollback

| Situation | Action |
|---|---|
| Bad API deploy | Render → **Deploys** → *Rollback* to the previous image |
| Bad frontend deploy | Vercel → **Deployments** → *Promote to Production* on the previous build |
| Bad data after a refresh | Re-run `backfill --years 3`; upserts overwrite in place, then `refresh-views` |
| Suspected credential leak | Rotate in Neon, re-run `ingest migrate` (it reassigns role passwords), update Render + the GitHub secret |

Schema changes are additive-only in `db/` — files are applied in numeric order
and each is written to be re-runnable, so a redeploy never destroys data.
