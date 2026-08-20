-- 003_roles.sql — the security boundary.
--
-- THIS FILE IS THE ENFORCEMENT MECHANISM for the platform's core requirement:
-- the text-to-SQL agent must be incapable of modifying the database. Everything
-- in the application layer (AST validation, read-only transactions) is defence
-- in depth layered on top of what is granted here.
--
-- Two restricted roles:
--   sqlproj_api    - reads everything in `market`; serves the analytics endpoints.
--   sqlproj_agent  - reads an explicit allowlist of market-data relations only.
--                    Never granted INSERT/UPDATE/DELETE/TRUNCATE on anything.
--
-- No passwords appear in this file. `ingest migrate` assigns them afterwards
-- from the environment, so the DDL stays safe to commit.
--
-- Runs as a plain (non-superuser) owner role, which is all Neon provides.
-- Must be applied AFTER 002_derived.sql: that file drops and recreates the
-- materialized views, which discards their grants. `ingest migrate` always runs
-- these in numeric order, so re-running the full migration re-establishes them.

DO $$
DECLARE
    dbname text := current_database();
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sqlproj_api') THEN
        EXECUTE 'CREATE ROLE sqlproj_api LOGIN NOSUPERUSER NOCREATEDB '
                'NOCREATEROLE NOINHERIT NOREPLICATION';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sqlproj_agent') THEN
        EXECUTE 'CREATE ROLE sqlproj_agent LOGIN NOSUPERUSER NOCREATEDB '
                'NOCREATEROLE NOINHERIT NOREPLICATION';
    END IF;

    -- Deny by default at the database level, then grant CONNECT back explicitly.
    EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', dbname);
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO sqlproj_api, sqlproj_agent', dbname);
END
$$;

-- Nothing is reachable via the PUBLIC pseudo-role.
REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA market FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA market FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- sqlproj_api — read-only across the whole market schema.
-- ---------------------------------------------------------------------------
GRANT USAGE  ON SCHEMA market TO sqlproj_api;
GRANT SELECT ON ALL TABLES IN SCHEMA market TO sqlproj_api;
-- Materialized views granted explicitly: ALL TABLES coverage of relkind 'm'
-- has varied across major versions, and this must not silently break.
GRANT SELECT ON market.daily_returns, market.asset_metrics, market.sector_daily
    TO sqlproj_api;
ALTER DEFAULT PRIVILEGES IN SCHEMA market GRANT SELECT ON TABLES TO sqlproj_api;

-- ---------------------------------------------------------------------------
-- sqlproj_agent — SELECT on an explicit allowlist, and nothing else.
--
-- market.ingest_runs is deliberately ABSENT: it is operational metadata, not
-- market data. The allowlist here is mirrored in the application-layer AST
-- validator (api/src/app/agent/guard.py); the two must stay in sync.
-- ---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA market TO sqlproj_agent;
GRANT SELECT ON
    market.assets,
    market.price_history,
    market.daily_returns,
    market.asset_metrics,
    market.sector_daily
TO sqlproj_agent;

-- A table added by a future migration must NOT become readable automatically.
ALTER DEFAULT PRIVILEGES IN SCHEMA market REVOKE ALL ON TABLES FROM sqlproj_agent;

-- ---------------------------------------------------------------------------
-- Session-level guarantees. These apply to every connection the role opens,
-- independently of what the application asks for.
-- ---------------------------------------------------------------------------

-- Belt and braces: even if a write grant were mis-issued, the transaction
-- itself refuses to write.
ALTER ROLE sqlproj_agent SET default_transaction_read_only = on;
-- A runaway or deliberately expensive generated query dies in 5 seconds.
ALTER ROLE sqlproj_agent SET statement_timeout = '5s';
ALTER ROLE sqlproj_agent SET lock_timeout = '2s';
ALTER ROLE sqlproj_agent SET idle_in_transaction_session_timeout = '10s';
-- Pinned search_path: unqualified names cannot resolve outside `market`.
ALTER ROLE sqlproj_agent SET search_path = market, pg_catalog;
-- Bounds the blast radius of a request flood on Neon's small connection budget.
ALTER ROLE sqlproj_agent CONNECTION LIMIT 5;

ALTER ROLE sqlproj_api SET default_transaction_read_only = on;
ALTER ROLE sqlproj_api SET statement_timeout = '15s';
ALTER ROLE sqlproj_api SET search_path = market, pg_catalog;
ALTER ROLE sqlproj_api CONNECTION LIMIT 20;
