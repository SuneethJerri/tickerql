-- correlation_sectors.sql — the correlation heatmap, aggregated where the data is.
-- Params: window_days
--
-- The frontend draws a 19x19 sector grid. Aggregating here rather than in the
-- browser is the difference between shipping 361 cells and shipping the full
-- 135x135 ticker matrix - 18,225 cells and 1.66 MB - to average it down.
--
-- A sector cell is the MEAN of the pairwise correlations spanning the two
-- sectors, not a correlation of sector indices: averaging the pairs answers
-- "do these two groups move together", which is the question the grid is read
-- for. Self-pairs are excluded, because the ticker diagonal is 1.0 by
-- construction and including it would pull every intra-sector cell toward 1 by
-- an amount that depends only on how many assets the sector has.
--
-- Each cell also carries the strongest single pair behind it. That is free here
-- - the pairwise correlations are already in hand - and it saves the caller
-- from re-fetching the ticker matrix just to find one pair to plot.
WITH bounds AS (
    SELECT max(date) AS as_of FROM market.daily_returns
),
scoped AS (
    SELECT dr.asset_id, dr.date, dr.simple_return
    FROM market.daily_returns dr
    CROSS JOIN bounds b
    WHERE dr.simple_return IS NOT NULL
      AND dr.date > b.as_of - make_interval(days => %(window_days)s)
),
pairwise AS (
    SELECT
        a1.sector AS sector_a,
        a2.sector AS sector_b,
        a1.ticker AS ticker_a,
        a2.ticker AS ticker_b,
        corr(s1.simple_return, s2.simple_return) AS correlation
    FROM scoped s1
    -- The join on date is what aligns each pair: crypto trades every day and
    -- equities do not, so an inner join restricts a cross-asset pair to the
    -- days both actually traded.
    JOIN scoped s2 ON s2.date = s1.date AND s2.asset_id <> s1.asset_id
    JOIN market.assets a1 ON a1.id = s1.asset_id
    JOIN market.assets a2 ON a2.id = s2.asset_id
    GROUP BY a1.sector, a2.sector, a1.ticker, a2.ticker
)
--
-- On nulls. `corr()` returns NULL only when one side has zero variance, which
-- no pair in this universe does, so a `WHERE correlation IS NOT NULL` filter
-- here would be unreachable and untestable. The handling lives in the
-- aggregates instead: `avg` and `count(correlation)` skip nulls natively, and
-- the `NULLS LAST` is load-bearing, because Postgres sorts NULLS FIRST under
-- DESC and would otherwise name a zero-variance pair as the strongest.
SELECT
    sector_a,
    sector_b,
    avg(correlation)                                             AS correlation,
    count(correlation)                                           AS pairs,
    (array_agg(ticker_a ORDER BY correlation DESC NULLS LAST))[1] AS top_ticker_a,
    (array_agg(ticker_b ORDER BY correlation DESC NULLS LAST))[1] AS top_ticker_b,
    max(correlation)                                             AS top_correlation
FROM pairwise
GROUP BY sector_a, sector_b
ORDER BY sector_a, sector_b;
