-- asset_risk_metrics.sql — per-asset risk/return for a trailing window.
--
-- Serves BOTH the volatility-ranking endpoint and the risk-vs-return scatter:
-- they are the same rows, ordered and projected differently, so keeping one
-- query avoids two definitions of "volatility" drifting apart.
--
-- Params: window_days
SELECT
    a.ticker,
    a.name,
    a.sector,
    a.asset_type,
    m.observations,
    m.start_date,
    m.end_date,
    m.total_return,
    m.annualized_return,
    m.annualized_volatility,
    m.return_per_unit_risk,
    m.max_drawdown,
    m.avg_volume,
    rank() OVER (ORDER BY m.annualized_volatility DESC NULLS LAST) AS volatility_rank
FROM market.asset_metrics m
JOIN market.assets a ON a.id = m.asset_id
WHERE m.window_days = %(window_days)s
ORDER BY m.annualized_volatility DESC NULLS LAST;
