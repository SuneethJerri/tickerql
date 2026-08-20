-- best_worst_periods.sql — the n best and n worst periods for one asset.
-- Params: ticker, granularity ('day' | 'week' | 'month'), window_days, n
--
-- Period returns compound geometrically (exp(sum(ln(1+r)))-1) rather than
-- summing daily returns, which would overstate volatile periods.
WITH bounds AS (
    SELECT max(date) AS as_of FROM market.daily_returns
),
scoped AS (
    SELECT
        date_trunc(%(granularity)s, dr.date)::date AS period_start,
        dr.date,
        dr.simple_return
    FROM market.daily_returns dr
    JOIN market.assets a ON a.id = dr.asset_id
    CROSS JOIN bounds b
    WHERE a.ticker = %(ticker)s
      AND dr.simple_return IS NOT NULL
      AND dr.date > b.as_of - make_interval(days => %(window_days)s)
),
agg AS (
    SELECT
        period_start,
        min(date) AS first_date,
        max(date) AS last_date,
        count(*)  AS observations,
        exp(sum(ln(GREATEST(1 + simple_return, 1e-12)))) - 1 AS period_return
    FROM scoped
    GROUP BY period_start
),
ranked AS (
    SELECT
        agg.*,
        rank() OVER (ORDER BY period_return DESC) AS best_rank,
        rank() OVER (ORDER BY period_return ASC)  AS worst_rank
    FROM agg
)
SELECT period_start, first_date, last_date, observations, period_return,
       'best' AS kind, best_rank AS rank
FROM ranked WHERE best_rank <= %(n)s
UNION ALL
SELECT period_start, first_date, last_date, observations, period_return,
       'worst' AS kind, worst_rank AS rank
FROM ranked WHERE worst_rank <= %(n)s
ORDER BY kind, rank;
