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
--
-- Each point carries a 95 per cent interval from the Fisher z-transform: z = atanh(r)
-- is approximately normal with standard error 1/sqrt(n-3), so the interval is
-- tanh(z +/- 1.96/sqrt(n-3)). Doing it in z space rather than around r is what
-- makes the interval asymmetric near the bounds, which is correct - there is
-- more room below 0.9 than above it.
--
-- THE INTERVAL IS A FLOOR ON THE UNCERTAINTY, NOT A MEASUREMENT OF IT. Fisher
-- assumes bivariate normal, independent observations. Daily returns are
-- fat-tailed and volatility-clustered, so the true interval is wider than this
-- one. It is honest about order of magnitude and about which differences are
-- too small to read; it is not a p-value.
--
-- atanh(+/-1) is +/-inf, and tanh brings it back to +/-1, so a pair with itself
-- gets a zero-width interval at 1.0 rather than an error. n <= 3 has no
-- interval at all and returns NULL rather than the NaN sqrt(negative) gives.
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
),
banded AS (
    SELECT
        rolled.date,
        rolled.correlation,
        rolled.observations,
        atanh(rolled.correlation) AS z,
        -- 1.959964 is the 97.5th percentile of the standard normal.
        CASE
            WHEN rolled.observations > 3
            THEN 1.959964 / sqrt((rolled.observations - 3)::double precision)
        END AS half_width
    FROM rolled
    CROSS JOIN bounds
    WHERE rolled.observations = %(rolling_days)s::int
      AND rolled.date > bounds.as_of - make_interval(days => %(span_days)s)
)
SELECT
    date,
    correlation,
    observations,
    tanh(z - half_width) AS ci_low,
    tanh(z + half_width) AS ci_high
FROM banded
ORDER BY date;
