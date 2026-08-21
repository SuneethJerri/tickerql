-- sparklines.sql — one downsampled close series per asset, for the shape column
-- in the risk table.
--
-- Downsampled to one bar per ISO week deliberately. The alternative is 135
-- assets x ~250 daily bars = ~34,000 points on the wire to draw sparklines
-- roughly 90 px wide, where fewer than 90 of those points can occupy a distinct
-- pixel. A weekly close is the same shape at a twentieth of the payload.
--
-- The LAST bar of each week, not the average: a mean smooths away exactly the
-- drawdowns a sparkline exists to show, and the final bar is a real observed
-- close rather than a number that never traded.
--
-- adj_close with a close fallback, per the project convention — raw closes make
-- a split look like a crash.
-- Params: window_days
WITH bounds AS (
    SELECT max(date) AS as_of FROM market.price_history
),
scoped AS (
    SELECT
        ph.asset_id,
        ph.date,
        coalesce(ph.adj_close, ph.close) AS price,
        row_number() OVER (
            PARTITION BY ph.asset_id, date_trunc('week', ph.date)
            ORDER BY ph.date DESC
        ) AS rn_in_week
    FROM market.price_history ph, bounds b
    WHERE ph.date > b.as_of - make_interval(days => %(window_days)s)
)
SELECT
    a.ticker,
    s.date,
    s.price AS close
FROM scoped s
JOIN market.assets a ON a.id = s.asset_id
WHERE s.rn_in_week = 1
  AND a.is_active
  AND s.price > 0
ORDER BY a.ticker, s.date;
