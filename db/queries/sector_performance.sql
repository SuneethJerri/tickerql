-- sector_performance.sql — summary risk/return per sector over a trailing window.
-- Params: window_days
--
-- Annualisation uses 365 periods/year for Crypto and 252 for equity sectors.
-- Sectors are homogeneous by asset_type, so deriving the factor from the
-- sector's constituents is exact rather than an approximation.
WITH bounds AS (
    SELECT max(date) AS as_of FROM market.sector_daily
),
sector_periods AS (
    SELECT
        sector,
        CASE WHEN bool_or(asset_type = 'crypto') THEN 365.0 ELSE 252.0 END AS periods_per_year
    FROM market.assets
    WHERE is_active
    GROUP BY sector
),
scoped AS (
    SELECT sd.sector, sd.date, sd.equal_weighted_return, sd.asset_count
    FROM market.sector_daily sd, bounds b
    WHERE sd.date > b.as_of - make_interval(days => %(window_days)s)
)
SELECT
    s.sector,
    min(s.date)                                   AS start_date,
    max(s.date)                                   AS end_date,
    count(*)                                      AS observations,
    max(s.asset_count)                            AS asset_count,
    -- Geometric compounding, not a sum of daily returns.
    exp(sum(ln(GREATEST(1 + s.equal_weighted_return, 1e-12)))) - 1        AS total_return,
    exp(sum(ln(GREATEST(1 + s.equal_weighted_return, 1e-12)))
        * sp.periods_per_year / count(*)) - 1                            AS annualized_return,
    stddev_samp(s.equal_weighted_return) * sqrt(sp.periods_per_year)     AS annualized_volatility,
    CASE WHEN stddev_samp(s.equal_weighted_return) > 0
         THEN (exp(sum(ln(GREATEST(1 + s.equal_weighted_return, 1e-12)))
                   * sp.periods_per_year / count(*)) - 1)
              / (stddev_samp(s.equal_weighted_return) * sqrt(sp.periods_per_year))
    END                                                                  AS return_per_unit_risk
FROM scoped s
JOIN sector_periods sp USING (sector)
GROUP BY s.sector, sp.periods_per_year
ORDER BY total_return DESC;
