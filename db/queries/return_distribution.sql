-- return_distribution.sql — the shape of one asset's daily returns.
-- Params: ticker, window_days
--
-- Every other view on this site summarises a distribution into one number:
-- volatility is its width, return its centre. Neither says whether the days
-- that produced them were a scatter of small moves or a few violent ones, and
-- for daily financial returns the answer is reliably the second. This returns
-- the histogram so the shape is visible rather than assumed.
--
-- Buckets are in units of standard deviation, not per cent, for two reasons.
-- A fixed per-cent width that resolves AAPL (roughly 1.7 per cent daily) puts
-- every crypto day in the outer two bars, and a width that suits crypto
-- collapses AAPL into three. More importantly, the normal curve this is meant
-- to be compared against is fixed in z units: bucket 17 holds the days between
-- 0 and +0.25 standard deviations whatever the asset, so the same reference
-- shape overlays every one of them.
--
-- 32 buckets across [-4, +4] at 0.25 sd each. width_bucket puts anything below
-- the range in bucket 0 and anything above in bucket 33, which is deliberate:
-- those two bars are the fat tails, and they are the point. A normal
-- distribution puts 6 days per 100,000 outside +/- 4 sd, so over a year those
-- bars should be empty and generally are not.
--
-- The grid is generated and left-joined so empty buckets come back as zero
-- rows rather than gaps. A histogram with missing bars is read as a histogram
-- with short bars.
--
-- n, mean and sd ride on every row. It is 34 rows, so the duplication costs
-- nothing, and it saves the caller a second round trip to draw the reference
-- curve over the bars.
WITH bounds AS (
    SELECT max(date) AS as_of FROM market.daily_returns
),
rets AS (
    SELECT dr.simple_return AS r
    FROM market.daily_returns dr
    JOIN market.assets a ON a.id = dr.asset_id
    CROSS JOIN bounds
    WHERE a.ticker = %(ticker)s
      AND dr.simple_return IS NOT NULL
      AND dr.date > bounds.as_of - make_interval(days => %(window_days)s)
),
base AS (
    SELECT
        count(*)::int      AS n,
        avg(r)             AS mean,
        stddev_samp(r)     AS sd
    FROM rets
),
bucketed AS (
    SELECT
        width_bucket((r - base.mean) / nullif(base.sd, 0), -4, 4, 32) AS bucket,
        count(*)::int AS days
    FROM rets
    CROSS JOIN base
    GROUP BY 1
),
grid AS (
    SELECT generate_series(0, 33) AS bucket
)
SELECT
    grid.bucket,
    -- NULL on an outer bucket means unbounded on that side, which is the
    -- honest edge for a bar holding "everything beyond 4 sd".
    -- Cast, because a bare -4.0 and 0.25 are numeric literals: without this
    -- the edges come back as decimals, and a bucket edge is a statistic.
    CASE WHEN grid.bucket > 0  THEN (-4.0 + (grid.bucket - 1) * 0.25)::double precision END AS z_low,
    CASE WHEN grid.bucket < 33 THEN (-4.0 + grid.bucket * 0.25)::double precision       END AS z_high,
    CASE WHEN grid.bucket > 0
         THEN base.mean + (-4.0 + (grid.bucket - 1) * 0.25)::double precision * base.sd END AS return_low,
    CASE WHEN grid.bucket < 33
         THEN base.mean + (-4.0 + grid.bucket * 0.25)::double precision * base.sd       END AS return_high,
    COALESCE(bucketed.days, 0) AS days,
    base.n         AS observations,
    base.mean      AS mean_daily_return,
    base.sd        AS daily_volatility
FROM grid
CROSS JOIN base
LEFT JOIN bucketed ON bucketed.bucket = grid.bucket
ORDER BY grid.bucket;
