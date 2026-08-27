-- rolling_correlation.sql — correlation between two assets as a time series.
-- Params: ticker_a, ticker_b, rolling_days, span_days
--
-- The correlation heatmap answers "how related are these two?" with one number
-- per pair, which is a summary of a quantity that moves. Two assets can average
-- 0.4 over a year while spending one quarter at 0.8 and the next at 0.0, and
-- the single number says nothing about which. This returns the trailing-window
-- correlation on every date instead.
--
-- The pair is aligned by an inner join on date, for the same reason the matrix
-- is: crypto trades every day and equities do not, so a cross-asset pair is
-- computed over the trading days both assets actually saw. That also makes the
-- window mean N shared observations rather than N calendar days.
--
-- Rows whose frame is not yet full are dropped. A "60-day correlation" built
-- from the twelve observations available on day twelve is not a 60-day
-- correlation, and plotting it puts a wild, unstable left edge on the chart
-- that reads as signal.
--
-- Scoping is deliberately loose - the pair is two assets, so the whole history
-- is at most a few thousand rows. Restricting the input to the plotted span
-- would leave the first `rolling_days` observations of that span without a
-- full frame; running over everything and trimming afterwards means the first
-- plotted point is as well-founded as the last.
WITH bounds AS (
    SELECT max(date) AS as_of FROM market.daily_returns
),
side_a AS (
    SELECT dr.date, dr.simple_return
    FROM market.daily_returns dr
    JOIN market.assets a ON a.id = dr.asset_id
    WHERE a.ticker = %(ticker_a)s AND dr.simple_return IS NOT NULL
),
side_b AS (
    SELECT dr.date, dr.simple_return
    FROM market.daily_returns dr
    JOIN market.assets a ON a.id = dr.asset_id
    WHERE a.ticker = %(ticker_b)s AND dr.simple_return IS NOT NULL
),
paired AS (
    SELECT side_a.date, side_a.simple_return AS ret_a, side_b.simple_return AS ret_b
    FROM side_a
    JOIN side_b ON side_b.date = side_a.date
),
rolled AS (
    SELECT
        date,
        corr(ret_a, ret_b) OVER w AS correlation,
        count(*)           OVER w AS observations
    FROM paired
    WINDOW w AS (
        ORDER BY date
        ROWS BETWEEN (%(rolling_days)s::int - 1) PRECEDING AND CURRENT ROW
    )
)
SELECT
    rolled.date,
    rolled.correlation,
    rolled.observations
FROM rolled
CROSS JOIN bounds
WHERE rolled.observations = %(rolling_days)s::int
  AND rolled.date > bounds.as_of - make_interval(days => %(span_days)s)
ORDER BY rolled.date;
