-- correlation_matrix.sql — pairwise Pearson correlation of daily returns.
-- Params: window_days, tickers (text[]; empty/NULL means all assets)
--
-- The self-join on date is what aligns the series, and it matters here:
-- crypto trades every day while equities do not. An inner join restricts each
-- pair to the dates BOTH assets traded, so a crypto/equity correlation is
-- computed over trading days only. Padding weekends with zero returns would
-- mechanically drag every crypto/equity correlation toward zero.
--
-- Returns the full square matrix (both directions plus the diagonal) because
-- the frontend renders a heatmap and wants every cell.
WITH bounds AS (
    SELECT max(date) AS as_of FROM market.daily_returns
),
scoped AS (
    SELECT dr.asset_id, dr.date, dr.simple_return
    FROM market.daily_returns dr
    JOIN market.assets a ON a.id = dr.asset_id
    CROSS JOIN bounds b
    WHERE dr.simple_return IS NOT NULL
      AND dr.date > b.as_of - make_interval(days => %(window_days)s)
      AND (
            %(tickers)s::text[] IS NULL
            OR cardinality(%(tickers)s::text[]) = 0
            OR a.ticker = ANY(%(tickers)s::text[])
          )
)
SELECT
    a1.ticker                              AS ticker_a,
    a2.ticker                              AS ticker_b,
    corr(s1.simple_return, s2.simple_return) AS correlation,
    count(*)                               AS observations
FROM scoped s1
JOIN scoped s2 ON s2.date = s1.date
JOIN market.assets a1 ON a1.id = s1.asset_id
JOIN market.assets a2 ON a2.id = s2.asset_id
GROUP BY a1.ticker, a2.ticker
ORDER BY a1.ticker, a2.ticker;
