-- moving_averages.sql — close price with N-bar simple moving averages.
-- Params: ticker, windows (int[]), window_days
--
-- A window frame bound (ROWS BETWEEN n PRECEDING) must be a literal, so it
-- cannot be parameterised. The LATERAL below takes the last `w` closes on or
-- before each date and averages them, which IS parameterisable and gives the
-- same result. Output is long-format (one row per date per window) so the
-- frontend can map straight to one line per series.
--
-- The moving average is computed over ALL available history, then the output
-- is trimmed to the requested window - otherwise a 200-day average at the
-- start of a 365-day chart would be computed from a truncated series.
WITH bounds AS (
    SELECT max(date) AS as_of FROM market.price_history
),
px AS (
    SELECT p.date, COALESCE(p.adj_close, p.close)::double precision AS close
    FROM market.price_history p
    JOIN market.assets a ON a.id = p.asset_id
    WHERE a.ticker = %(ticker)s
)
SELECT
    px.date,
    px.close,
    w.window_size,
    ma.avg_close,
    ma.bars_used,
    -- Flags an average computed from fewer bars than requested (start of series).
    ma.bars_used < w.window_size AS is_partial
FROM px
CROSS JOIN unnest(%(windows)s::int[]) AS w(window_size)
CROSS JOIN LATERAL (
    SELECT avg(t.close) AS avg_close, count(*) AS bars_used
    FROM (
        SELECT q.close
        FROM px q
        WHERE q.date <= px.date
        ORDER BY q.date DESC
        LIMIT w.window_size
    ) t
) ma
CROSS JOIN bounds b
WHERE px.date > b.as_of - make_interval(days => %(window_days)s)
ORDER BY w.window_size, px.date;
