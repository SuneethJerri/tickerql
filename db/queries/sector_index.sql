-- sector_index.sql — cumulative sector index time series, rebased to 100 at the
-- start of the requested window (the stored index is rebased to the start of
-- all history, which would misrepresent a shorter window).
-- Params: window_days
WITH bounds AS (
    SELECT max(date) AS as_of FROM market.sector_daily
),
scoped AS (
    SELECT sd.sector, sd.date, sd.equal_weighted_return, sd.cumulative_index
    FROM market.sector_daily sd, bounds b
    WHERE sd.date > b.as_of - make_interval(days => %(window_days)s)
)
SELECT
    sector,
    date,
    equal_weighted_return,
    100.0 * cumulative_index
        / first_value(cumulative_index) OVER (PARTITION BY sector ORDER BY date)
        AS indexed_value
FROM scoped
ORDER BY sector, date;
