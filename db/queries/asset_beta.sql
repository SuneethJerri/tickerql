-- asset_beta.sql — how much of each asset's movement is its market's.
-- Params: window_days
--
-- Volatility says how much an asset moves. It does not say whether the moving
-- was the asset's own or the whole market's, and those are different facts
-- about the same number. Beta and R-squared separate them: beta is how far the
-- asset moves when its market moves one per cent, R-squared is the share of
-- its day-to-day variation the market accounts for at all.
--
-- Three markets, not one. This universe holds US equities in USD, Indian
-- equities in INR, and crypto. Regressing an NSE stock on a USD index measures
-- the exchange rate as much as the company, and regressing bitcoin on either
-- measures nothing, so each asset is fitted against the equal-weighted index
-- of its own market. The market an asset belongs to is returned alongside the
-- fit; a beta is meaningless without knowing what it is a beta against.
--
-- The index is leave-one-out: each asset is regressed on the mean of the
-- others, not on a mean that includes itself. With 93 US equities the
-- self-inclusion bias is small, but Crypto has 12 members, where an asset
-- would be carrying a twelfth of its own benchmark and every beta would be
-- pulled toward 1 by construction. Correcting it costs one subtraction.
--
-- Days are matched by date within a market, so this inherits the same rule as
-- the correlation matrix: assets are compared on days both actually traded.
--
-- The interval on beta is the ordinary regression one:
-- se = sqrt((1 - r^2) / (n - 2)) * sd_asset / sd_market, and beta +/- 1.96 se.
-- Symmetric, unlike the Fisher interval on a correlation, because beta is not
-- bounded. Same caveat as everywhere else in this project: it assumes
-- independent, equal-variance residuals, and daily returns are neither, so it
-- is a floor on the uncertainty rather than a measurement of it.
WITH bounds AS (
    SELECT max(date) AS as_of FROM market.daily_returns
),
universe AS (
    SELECT
        a.id,
        a.ticker,
        a.name,
        a.sector,
        a.asset_type,
        CASE
            WHEN a.asset_type = 'crypto'    THEN 'Crypto'
            WHEN a.sector LIKE 'India:%%'   THEN 'Indian equities'
            ELSE 'US equities'
        END AS market
    FROM market.assets a
    WHERE a.is_active
),
rets AS (
    SELECT u.id, u.market, dr.date, dr.simple_return AS r
    FROM market.daily_returns dr
    JOIN universe u ON u.id = dr.asset_id
    CROSS JOIN bounds
    WHERE dr.simple_return IS NOT NULL
      AND dr.date > bounds.as_of - make_interval(days => %(window_days)s)
),
market_day AS (
    SELECT market, date, sum(r) AS total_r, count(*)::int AS members
    FROM rets
    GROUP BY 1, 2
),
paired AS (
    SELECT
        rets.id,
        rets.r,
        (market_day.total_r - rets.r) / (market_day.members - 1) AS market_r
    FROM rets
    JOIN market_day
      ON market_day.market = rets.market
     AND market_day.date   = rets.date
    WHERE market_day.members > 1
),
fit AS (
    SELECT
        id,
        count(*)::int          AS observations,
        regr_slope(r, market_r)     AS beta,
        regr_intercept(r, market_r) AS alpha_daily,
        corr(r, market_r)           AS market_correlation,
        stddev_samp(r)              AS sd_asset,
        stddev_samp(market_r)       AS sd_market
    FROM paired
    GROUP BY 1
    HAVING count(*) > 2
),
banded AS (
    SELECT
        fit.*,
        power(fit.market_correlation, 2) AS r_squared,
        CASE WHEN fit.observations > 2 AND fit.sd_market > 0
             THEN sqrt(
                      greatest(1 - power(fit.market_correlation, 2), 0)
                      / (fit.observations - 2)
                  ) * fit.sd_asset / fit.sd_market
        END AS beta_stderr
    FROM fit
)
SELECT
    u.ticker,
    u.name,
    u.sector,
    u.asset_type,
    u.market,
    b.observations,
    b.beta,
    b.beta - 1.959964 * b.beta_stderr AS beta_low,
    b.beta + 1.959964 * b.beta_stderr AS beta_high,
    b.market_correlation,
    b.r_squared,
    1 - b.r_squared AS idiosyncratic_share,
    -- Arithmetic annualisation, matching the periods-per-year split used for
    -- volatility everywhere else: crypto trades 365 days a year, equities 252.
    b.alpha_daily * CASE WHEN u.asset_type = 'crypto' THEN 365 ELSE 252 END
        AS alpha_annualized
FROM banded b
JOIN universe u ON u.id = b.id
ORDER BY b.beta DESC NULLS LAST;
