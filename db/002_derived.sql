-- 002_derived.sql — the computed layer.
--
-- Materialized rather than plain views: the analytics endpoints and the
-- text-to-SQL agent both hit these on every request, and recomputing window
-- functions over ~12k bars per call is wasted work. Each carries a UNIQUE
-- index so REFRESH MATERIALIZED VIEW CONCURRENTLY can run without taking an
-- exclusive lock (i.e. the API keeps serving during the nightly refresh).
--
-- Returns are computed from adj_close when available, so splits and dividends
-- don't surface as phantom price moves.

DROP MATERIALIZED VIEW IF EXISTS market.sector_daily   CASCADE;
DROP MATERIALIZED VIEW IF EXISTS market.asset_metrics  CASCADE;
DROP MATERIALIZED VIEW IF EXISTS market.daily_returns  CASCADE;

-- ---------------------------------------------------------------------------
-- daily_returns: one row per asset per date, with simple and log returns.
-- ---------------------------------------------------------------------------
CREATE MATERIALIZED VIEW market.daily_returns AS
WITH px AS (
    SELECT
        asset_id,
        date,
        COALESCE(adj_close, close)::double precision AS px,
        close::double precision                      AS raw_close,
        volume::double precision                     AS volume
    FROM market.price_history
)
SELECT
    asset_id,
    date,
    px                                                    AS close,
    raw_close,
    volume,
    LAG(px) OVER w                                        AS prev_close,
    px / NULLIF(LAG(px) OVER w, 0) - 1                    AS simple_return,
    LN(NULLIF(px / NULLIF(LAG(px) OVER w, 0), 0))         AS log_return
FROM px
WINDOW w AS (PARTITION BY asset_id ORDER BY date);

COMMENT ON MATERIALIZED VIEW market.daily_returns IS
    'Daily simple and log returns per asset, derived from adjusted close.';

CREATE UNIQUE INDEX daily_returns_pk_idx  ON market.daily_returns (asset_id, date);
CREATE INDEX        daily_returns_date_idx ON market.daily_returns (date);

-- ---------------------------------------------------------------------------
-- asset_metrics: risk/return summary per asset per trailing window.
--
-- Annualisation uses 252 periods/year for equities (trading days) and 365 for
-- crypto (which trades every day) - using one constant for both would overstate
-- equity volatility by ~20%.
-- ---------------------------------------------------------------------------
CREATE MATERIALIZED VIEW market.asset_metrics AS
WITH bounds AS (
    SELECT max(date) AS as_of FROM market.price_history
),
windows AS (
    SELECT * FROM (VALUES (30), (90), (365)) AS w (window_days)
),
scoped AS (
    SELECT
        dr.asset_id,
        w.window_days,
        a.asset_type,
        dr.date,
        dr.close,
        dr.volume,
        dr.simple_return,
        dr.log_return,
        CASE WHEN a.asset_type = 'crypto' THEN 365.0 ELSE 252.0 END AS periods_per_year,
        -- Running peak within the window, for drawdown.
        MAX(dr.close) OVER (
            PARTITION BY dr.asset_id, w.window_days ORDER BY dr.date
        ) AS running_peak
    FROM market.daily_returns dr
    JOIN market.assets a ON a.id = dr.asset_id
    CROSS JOIN windows w
    CROSS JOIN bounds b
    WHERE dr.date > b.as_of - make_interval(days => w.window_days)
)
SELECT
    asset_id,
    window_days,
    min(date)                                             AS start_date,
    max(date)                                             AS end_date,
    count(*)                                              AS observations,
    (array_agg(close ORDER BY date))[1]                   AS first_close,
    (array_agg(close ORDER BY date DESC))[1]              AS last_close,
    (array_agg(close ORDER BY date DESC))[1]
        / NULLIF((array_agg(close ORDER BY date))[1], 0) - 1 AS total_return,
    -- Geometric annualisation: exp(mean log return * periods per year) - 1.
    CASE WHEN count(log_return) > 1
         THEN exp(sum(log_return) * min(periods_per_year) / count(log_return)) - 1
    END                                                   AS annualized_return,
    CASE WHEN count(log_return) > 1
         THEN stddev_samp(log_return) * sqrt(min(periods_per_year))
    END                                                   AS annualized_volatility,
    -- Return per unit of risk (risk-free rate assumed 0; documented in README).
    CASE WHEN count(log_return) > 1
          AND stddev_samp(log_return) > 0
         THEN (exp(sum(log_return) * min(periods_per_year) / count(log_return)) - 1)
              / (stddev_samp(log_return) * sqrt(min(periods_per_year)))
    END                                                   AS return_per_unit_risk,
    min(close / NULLIF(running_peak, 0) - 1)              AS max_drawdown,
    avg(volume)                                           AS avg_volume
FROM scoped
GROUP BY asset_id, window_days;

COMMENT ON MATERIALIZED VIEW market.asset_metrics IS
    'Per-asset risk/return metrics over trailing 30/90/365-day windows.';

CREATE UNIQUE INDEX asset_metrics_pk_idx ON market.asset_metrics (asset_id, window_days);

-- ---------------------------------------------------------------------------
-- sector_daily: equal-weighted sector return per date, plus a cumulative
-- index rebased to 100 at each sector's first observation.
--
-- Crypto trades weekends, equities don't, so the Crypto sector legitimately
-- has more dates than the others. Consumers align on date rather than assuming
-- equal row counts.
-- ---------------------------------------------------------------------------
CREATE MATERIALIZED VIEW market.sector_daily AS
WITH sector_ret AS (
    SELECT
        a.sector,
        dr.date,
        avg(dr.simple_return) AS equal_weighted_return,
        count(*)              AS asset_count
    FROM market.daily_returns dr
    JOIN market.assets a ON a.id = dr.asset_id
    WHERE dr.simple_return IS NOT NULL
    GROUP BY a.sector, dr.date
)
SELECT
    sector,
    date,
    equal_weighted_return,
    asset_count,
    100.0 * exp(
        sum(ln(GREATEST(1.0 + equal_weighted_return, 1e-12)))
            OVER (PARTITION BY sector ORDER BY date)
    ) AS cumulative_index
FROM sector_ret;

COMMENT ON MATERIALIZED VIEW market.sector_daily IS
    'Equal-weighted daily sector returns and a cumulative index rebased to 100.';

CREATE UNIQUE INDEX sector_daily_pk_idx   ON market.sector_daily (sector, date);
CREATE INDEX        sector_daily_date_idx ON market.sector_daily (date);
