-- tail_risk.sql — how much of one asset's year happened on a handful of days.
-- Params: ticker, window_days
--
-- The companion to the histogram: the histogram shows the shape, this counts
-- what the shape costs. Three facts, all of which a volatility figure hides.
--
-- 1. Skewness and excess kurtosis. Kurtosis is the one that matters here. A
--    normal distribution has excess kurtosis 0; daily returns routinely run
--    above 3, which means the extremes are far more common than the same
--    volatility figure would imply if the returns were normal.
--
-- 2. Days beyond 2 and 3 standard deviations, against what a normal
--    distribution predicts for the same number of days. This is the same
--    statement as kurtosis without the vocabulary: "12 days moved more than
--    3 sd; a normal curve predicts 0.7" is legible to a reader who has never
--    met a fourth moment.
--
-- 3. The window's return with its best five and worst five days removed.
--    The most concrete statement of concentration there is, and it is
--    routinely startling: a year of gains frequently lives in a week of it.
--
-- Removal is done in log space, where the total return is a sum and dropping
-- a day is a subtraction. Doing it on simple returns would need the product
-- reconstructed and would drift.
--
-- The normal expectations are 2 * (1 - Phi(2)) = 0.0455 and 2 * (1 - Phi(3))
-- = 0.0027, held as literals because Postgres has no normal CDF and pulling
-- one in for two constants is not worth it.
WITH bounds AS (
    SELECT max(date) AS as_of FROM market.daily_returns
),
rets AS (
    SELECT dr.date, dr.simple_return AS r, dr.log_return AS lr
    FROM market.daily_returns dr
    JOIN market.assets a ON a.id = dr.asset_id
    CROSS JOIN bounds
    WHERE a.ticker = %(ticker)s
      AND dr.simple_return IS NOT NULL
      AND dr.log_return IS NOT NULL
      AND dr.date > bounds.as_of - make_interval(days => %(window_days)s)
),
base AS (
    SELECT
        count(*)::int  AS n,
        avg(r)         AS mean,
        stddev_samp(r) AS sd,
        sum(lr)        AS total_lr
    FROM rets
),
moments AS (
    SELECT
        sum(power((r - base.mean) / nullif(base.sd, 0), 3)) AS m3,
        sum(power((r - base.mean) / nullif(base.sd, 0), 4)) AS m4,
        count(*) FILTER (WHERE abs(r - base.mean) > 2 * base.sd)::int AS beyond_2sd,
        count(*) FILTER (WHERE abs(r - base.mean) > 3 * base.sd)::int AS beyond_3sd
    FROM rets
    CROSS JOIN base
),
ranked AS (
    SELECT
        date, r, lr,
        row_number() OVER (ORDER BY lr DESC) AS best_rank,
        row_number() OVER (ORDER BY lr ASC)  AS worst_rank
    FROM rets
),
extremes AS (
    SELECT
        max(r)    FILTER (WHERE best_rank  = 1) AS best_return,
        max(date) FILTER (WHERE best_rank  = 1) AS best_date,
        min(r)    FILTER (WHERE worst_rank = 1) AS worst_return,
        max(date) FILTER (WHERE worst_rank = 1) AS worst_date,
        sum(lr)   FILTER (WHERE best_rank  <= 5) AS best5_lr,
        sum(lr)   FILTER (WHERE worst_rank <= 5) AS worst5_lr
    FROM ranked
)
SELECT
    base.n    AS observations,
    base.mean AS mean_daily_return,
    base.sd   AS daily_volatility,
    -- Fisher-Pearson adjusted moments, the same estimators pandas and Excel
    -- report, so a reader checking the number against their own tool agrees.
    CASE WHEN base.n > 2
         THEN moments.m3 * base.n
              / ((base.n - 1) * (base.n - 2))::double precision
    END AS skewness,
    CASE WHEN base.n > 3
         THEN moments.m4 * base.n * (base.n + 1)
              / ((base.n - 1) * (base.n - 2) * (base.n - 3))::double precision
              - 3.0 * power(base.n - 1, 2)
              / ((base.n - 2) * (base.n - 3))::double precision
    END AS excess_kurtosis,
    moments.beyond_2sd,
    moments.beyond_3sd,
    base.n * 0.04550026::double precision AS expected_beyond_2sd,
    base.n * 0.00269980::double precision AS expected_beyond_3sd,
    extremes.best_return,
    extremes.best_date,
    extremes.worst_return,
    extremes.worst_date,
    exp(base.total_lr) - 1                        AS total_return,
    exp(base.total_lr - extremes.best5_lr) - 1    AS total_return_without_best_5,
    exp(base.total_lr - extremes.worst5_lr) - 1   AS total_return_without_worst_5
FROM base
CROSS JOIN moments
CROSS JOIN extremes;
