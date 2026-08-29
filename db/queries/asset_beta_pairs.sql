-- asset_beta_pairs.sql — the daily points behind one asset's beta.
-- Params: ticker, window_days
--
-- The scatter the regression is fitted to. A beta of 1.3 with an R-squared of
-- 0.6 and a beta of 1.3 with an R-squared of 0.1 are the same line through
-- very different clouds, and the number alone cannot tell them apart. Drawing
-- the points is the only honest way to show which one an asset is.
--
-- The market series is built exactly as asset_beta.sql builds it - same three
-- markets, same leave-one-out mean - so the line drawn through these points is
-- the line the table reports and not a second, subtly different fit.
WITH bounds AS (
    SELECT max(date) AS as_of FROM market.daily_returns
),
universe AS (
    SELECT
        a.id,
        a.ticker,
        CASE
            WHEN a.asset_type = 'crypto'    THEN 'Crypto'
            WHEN a.sector LIKE 'India:%%'   THEN 'Indian equities'
            ELSE 'US equities'
        END AS market
    FROM market.assets a
    WHERE a.is_active
),
target AS (
    SELECT id, market FROM universe WHERE ticker = %(ticker)s
),
rets AS (
    SELECT u.id, u.market, dr.date, dr.simple_return AS r
    FROM market.daily_returns dr
    JOIN universe u ON u.id = dr.asset_id
    CROSS JOIN bounds
    WHERE u.market = (SELECT market FROM target)
      AND dr.simple_return IS NOT NULL
      AND dr.date > bounds.as_of - make_interval(days => %(window_days)s)
),
market_day AS (
    SELECT date, sum(r) AS total_r, count(*)::int AS members
    FROM rets
    GROUP BY 1
)
SELECT
    rets.date,
    rets.r AS asset_return,
    (market_day.total_r - rets.r) / (market_day.members - 1) AS market_return
FROM rets
JOIN target ON target.id = rets.id
JOIN market_day ON market_day.date = rets.date
WHERE market_day.members > 1
ORDER BY rets.date;
